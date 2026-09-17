/**
 * @module systems/Loot
 * Ground loot: deterministic drops, world rendering, pickup bookkeeping.
 *
 * Drops roll from a seeded RNG stream (dungeonSeed-derived), so identical
 * kill orders produce identical loot on every co-op peer. Ground items are
 * lightweight records — NOT entities — rendered as a rarity-glow + tinted
 * item glyph that bobs gently and obeys fog visibility/lighting.
 *
 * GOLD ON THE GROUND (it.114). Coins are their own records (`dropGold`):
 * a foe leaves them one time in three, every chest spills them, and they
 * are SCOOPED by walking over them (`scoopGold`, the same 0.75-tile reach
 * as a pile) rather than picked up by hand. Each coin drop plays the baked
 * `coin_small/medium/large` bounce (six frames: four in the air, two
 * rested) once and settles on its rested frame under a warm glow. Before
 * the coin atlases are resident the flat `item_coin_*` singles stand in,
 * so a coin is never a blank.
 *
 * FOOD ON THE GROUND (it.114): a dish lies as its baked 64 px single at half
 * size; when its turntable atlas happens to be resident it turns slowly.
 */

import { Container, Sprite, type Texture } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { eventBus } from '@/core/EventBus';
import type { Camera } from '@/engine/Camera';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import { RARITY_COLOR, type ItemDef } from '@/items/catalog';
import { FOE_GOLD_CHANCE, itemDef, rollChestGold, rollChestItem, rollDrop, rollFoeGold, rollFood, rollMinorItem, rollRareItem } from '@/items/instance';
import { spriteLib, type AnimName } from '@/render/SpriteLibrary';
import { itemIconTexture } from '@/ui/itemIcons';
import { vec2 } from '@/utils/Vec2';
import { depthKey, worldToScreen } from '@/utils/iso';
import { mulberry32, type Rng } from '@/utils/rng';

export interface GroundItem {
  uid: number;
  itemId: string;
  x: number;
  y: number;
}

/** A coin drop on the floor (it.114): scooped by proximity, never a pack item. */
export interface GroundCoin {
  uid: number;
  amount: number;
  x: number;
  y: number;
}

interface GroundItemView extends GroundItem {
  root: Container;
  glyph: Sprite;
  /** THE BEACON (it.87): a key's silhouette and light column in the top layer, seen through walls. */
  beacon?: Container;
  /** A dish's turntable frames when resident (it.114): the glyph steps them. */
  spin?: Texture[];
}

interface GroundCoinView extends GroundCoin {
  root: Container;
  coin: Sprite;
  glow: Sprite;
  /** The bounce strip (six frames) or null when only the flat single was available. */
  frames: Texture[] | null;
  /** Render clock at the first frame drawn (-1 until then): the bounce plays once from here. */
  bornAt: number;
}

/** The scoop's reach in tiles - the same as a gold pile's (main). */
export const COIN_SCOOP_RADIUS = 0.75;
/** The coin bounce: 6 frames at this pace, then rested. */
const COIN_FPS = 10;
/** The coin atlases (`spriteLib.ensure` these with a floor's roster). */
export const COIN_ANIMS: readonly string[] = ['coin_small', 'coin_medium', 'coin_large'];

/** Which coin sprite an amount earns. */
export function coinSizeFor(amount: number): 'small' | 'medium' | 'large' {
  return amount < 12 ? 'small' : amount < 36 ? 'medium' : 'large';
}

export class LootSystem {
  private readonly items = new Map<number, GroundItemView>();
  private readonly coins = new Map<number, GroundCoinView>();
  private nextUid = 1;
  private readonly rand: Rng;
  /** The floor's item level (it.78): what its drops roll at. Set by the floor builder. */
  ilvl = 1;
  /** SEEKER (it.80): the party's best drop luck, read by the floor each tick. */
  luck = 1;

  /** The stream's position (a world snapshot carries it; it.73). */
  get rngState(): number {
    return this.rand.state;
  }
  set rngState(v: number) {
    this.rand.state = v;
  }

  /** Everything on the floor, with the uid counter — a snapshot join re-lays it. Coins ride along (it.114). */
  snapshot(): { next: number; items: GroundItem[]; coins: GroundCoin[] } {
    return {
      next: this.nextUid,
      items: [...this.items.values()].map(({ uid, itemId, x, y }) => ({ uid, itemId, x, y })),
      coins: [...this.coins.values()].map(({ uid, amount, x, y }) => ({ uid, amount, x, y })),
    };
  }

  /** Re-lay a snapshot's ground items with the SAME uids, so a pickup command names the same thing here. */
  restore(s: { next: number; items: GroundItem[]; coins?: GroundCoin[] }): void {
    for (const it of this.items.values()) {
      it.root.destroy({ children: true });
      it.beacon?.destroy({ children: true });
    }
    this.items.clear();
    for (const c of this.coins.values()) c.root.destroy({ children: true });
    this.coins.clear();
    for (const it of s.items) {
      const def = itemDef(it.itemId);
      if (def) this.spawnAs(it.uid, def, it.x, it.y);
    }
    for (const c of s.coins ?? []) this.layCoin(c.uid, c.amount, c.x, c.y, true);
    this.nextUid = Math.max(s.next, this.nextUid);
  }
  private readonly scratch = vec2();

  constructor(
    private readonly viewport: Viewport,
    seed: number,
  ) {
    this.rand = mulberry32(seed ^ 0x517ab1e5);
  }

  /** Roll the drop table at a death location (deterministic stream); then the coin roll (it.114). */
  tryDropAt(x: number, y: number): void {
    const id = rollDrop(this.rand, this.ilvl, this.luck);
    if (id) this.spawnId(id, x, y);
    if (this.rand() < FOE_GOLD_CHANCE) {
      const amount = rollFoeGold(this.rand, this.ilvl);
      const a = this.rand() * Math.PI * 2;
      this.dropGold(x + Math.cos(a) * 0.35, y + Math.sin(a) * 0.35, amount);
    }
  }

  /** Guaranteed drop (chests): always yields gear, uncommon at least. */
  dropForced(x: number, y: number): void {
    this.spawnId(rollChestItem(this.rand, this.ilvl), x, y);
  }

  /** A TOWN CHEST's spoils (it.92): small things, always something. */
  dropMinor(x: number, y: number): void {
    this.spawnId(rollMinorItem(this.rand, this.ilvl), x, y);
  }

  /** A dish on the floor (it.114): chests and larders. */
  dropFood(x: number, y: number): void {
    this.spawnId(rollFood(this.rand, this.ilvl), x, y);
  }

  /** A chest's coins (it.114): rolled on the loot stream, so every peer sees the same purse. */
  dropChestGold(x: number, y: number, grand = false): void {
    this.dropGold(x, y, rollChestGold(this.rand, this.ilvl, grand));
  }

  /** Guaranteed RARE drop (boss trophies). */
  dropRareAt(x: number, y: number): void {
    this.spawnId(rollRareItem(this.rand, this.ilvl), x, y);
  }

  spawn(def: ItemDef, x: number, y: number): void {
    this.spawnAs(this.nextUid++, def, x, y);
  }

  /** Lay an item by id (an instance id resolves to its derived def). */
  spawnId(id: string, x: number, y: number): void {
    const def = itemDef(id);
    if (def) this.spawnAs(this.nextUid++, def, x, y);
  }

  /**
   * COINS (it.114): lay `amount` gold at a point as a bouncing coin sprite.
   * Nothing is enqueued and nothing is announced: the scoop (main, every
   * tick, per hero) takes it and shows the +N.
   */
  dropGold(x: number, y: number, amount: number): number {
    if (amount <= 0) return -1;
    const uid = this.nextUid++;
    this.layCoin(uid, amount, x, y, false);
    return uid;
  }

  /**
   * THE LEADER'S WORD (it.77): lay an item under a given uid. A matching
   * item already there is left alone; a different one under that uid is
   * replaced. Quiet — no tutorial chip, no glint — the local kill (if this
   * sim saw it) already announced the drop.
   */
  place(uid: number, def: ItemDef, x: number, y: number): void {
    const cur = this.items.get(uid);
    if (cur && cur.itemId === def.id) return;
    if (cur) this.remove(uid);
    this.spawnAs(uid, def, x, y, true);
    if (uid >= this.nextUid) this.nextUid = uid + 1;
  }

  /** Take an item off the floor without a pickup (the leader says it is gone). */
  remove(uid: number): void {
    const item = this.items.get(uid);
    if (item) {
      this.items.delete(uid);
      item.root.destroy({ children: true });
      item.beacon?.destroy({ children: true });
      return;
    }
    const coin = this.coins.get(uid);
    if (coin) {
      this.coins.delete(uid);
      coin.root.destroy({ children: true });
    }
  }

  /** THE BEACONS (it.87): a key's top-layer light shows only where the fog has lifted, and breathes. */
  updateBeacons(isVisible: (gx: number, gy: number) => boolean, time: number): void {
    for (const item of this.items.values()) {
      if (!item.beacon) continue;
      const seen = isVisible(Math.floor(item.x), Math.floor(item.y));
      item.beacon.visible = seen;
      if (seen) item.beacon.alpha = 0.75 + 0.25 * Math.sin(time * 3 + item.uid);
    }
  }

  /** Never hand out a uid the leader has already used. */
  bumpUid(next: number): void {
    this.nextUid = Math.max(this.nextUid, next);
  }

  private spawnAs(uid: number, def: ItemDef, x: number, y: number, quiet = false): void {
    const root = new Container();

    const glow = new Sprite(assets.get('glow'));
    glow.anchor.set(0.5);
    glow.blendMode = 'add';
    glow.tint = def.slot === 'food' ? 0xe8a060 : RARITY_COLOR[def.rarity];
    glow.scale.set(0.42);
    glow.alpha = 0.75;
    glow.position.y = -6;
    root.addChild(glow);

    // Weapons show their REAL pixel icon on the ground; other gear keeps
    // the item-colored paperdoll glyph.
    let glyph: Sprite;
    let spin: Texture[] | undefined;
    if (def.spin && spriteLib.hasAnim(def.spin)) {
      // THE TURNTABLE ON THE FLOOR (it.114): a dish (or a flask) turns when its atlas is already here.
      const anim = spriteLib.anim(def.spin as AnimName);
      spin = anim.frames[0];
      glyph = new Sprite(spin[0]);
      glyph.anchor.set(0.5, 0.5);
      glyph.scale.set(0.4);
      glyph.position.y = -8;
    } else if (def.sprite && spriteLib.loaded && spriteLib.hasSingle(def.sprite)) {
      // THE BAKED SINGLE (it.114): 64 px art at half size, a readable dish or flask.
      glyph = new Sprite(spriteLib.single(def.sprite));
      glyph.anchor.set(0.5, 0.5);
      glyph.scale.set(0.5);
      glyph.position.y = -8;
    } else if (def.icon && spriteLib.loaded && spriteLib.hasSingle(`wicon_${def.icon}`)) {
      // COMPACT DROPS (it.37): ground icons stay ≤ 32 px so a boss loot
      // burst never carpets the floor.
      glyph = new Sprite(spriteLib.single(`wicon_${def.icon}`));
      glyph.anchor.set(0.5, 0.5);
      // The Raven icons are 64 px paintings (it.78): a third of that on the ground.
      // A quarry key (it.87) is a quarter: it lies on the floor, it does not tower over it.
      glyph.scale.set(def.use?.key ? 0.3 : def.icon.startsWith('raven') ? 0.42 : 1.0);
      glyph.position.y = def.use?.key ? -4 : -7;
    } else {
      // Non-pack gear drops as its crisp generated pixel icon (40 px source → 28 px).
      glyph = new Sprite(itemIconTexture(def));
      glyph.anchor.set(0.5, 0.5);
      glyph.scale.set(0.7);
      glyph.position.y = -7;
    }
    root.addChild(glyph);

    const s = worldToScreen(x, y, this.scratch);
    root.position.set(s.x, s.y);
    root.zIndex = depthKey(x, y);
    this.viewport.objectLayer.addChild(root);

    const view: GroundItemView = { uid, itemId: def.id, x, y, root, glyph, spin };
    if (def.use?.key) {
      // THE BEACON (it.87): the key drawn again in the top layer - a soft
      // light column and its own silhouette, additive, so a wall in front of
      // it never hides it. The fog still gates it (see updateBeacons).
      const beacon = new Container();
      const column = new Sprite(assets.get('glow'));
      column.anchor.set(0.5, 0.92);
      column.blendMode = 'add';
      column.tint = 0xffd070;
      column.scale.set(0.55, 2.2);
      column.alpha = 0.35;
      beacon.addChild(column);
      const ghost = new Sprite(glyph.texture);
      ghost.anchor.set(0.5, 0.5);
      ghost.scale.set(0.3);
      ghost.blendMode = 'add';
      ghost.tint = 0xffe8a0;
      ghost.alpha = 0.55;
      ghost.position.y = -4;
      beacon.addChild(ghost);
      beacon.position.set(s.x, s.y);
      beacon.visible = false;
      this.viewport.ambienceLayer.addChild(beacon);
      view.beacon = beacon;
    }
    this.items.set(uid, view);
    if (!quiet) eventBus.emit('item:dropped', { uid, itemId: def.id, x, y });
  }

  /** The coin sprite: the bounce strip when resident, else the flat single; always a warm glow beneath. */
  private layCoin(uid: number, amount: number, x: number, y: number, rested: boolean): void {
    const size = coinSizeFor(amount);
    const anim = `coin_${size}`;
    const root = new Container();
    const glow = new Sprite(assets.get('glow'));
    glow.anchor.set(0.5);
    glow.blendMode = 'add';
    glow.tint = 0xffc850;
    glow.scale.set(size === 'large' ? 0.5 : size === 'medium' ? 0.42 : 0.36);
    glow.alpha = 0.7;
    glow.position.y = -3;
    root.addChild(glow);

    let frames: Texture[] | null = null;
    let coin: Sprite;
    if (spriteLib.hasAnim(anim)) {
      frames = spriteLib.anim(anim as AnimName).frames[0];
      coin = new Sprite(frames[rested ? frames.length - 1 : 0]);
      // The cell is a column (40×88): the coin bounces up it and lands at the foot.
      coin.anchor.set(0.5, 0.96);
      coin.scale.set(1.6);
      coin.position.y = 4;
    } else if (spriteLib.loaded && spriteLib.hasSingle(`item_coin_${size}`)) {
      coin = new Sprite(spriteLib.single(`item_coin_${size}`));
      coin.anchor.set(0.5, 0.5);
      coin.scale.set(2);
      coin.position.y = -2;
    } else {
      coin = new Sprite(assets.get('glow'));
      coin.anchor.set(0.5);
      coin.tint = 0xffd070;
      coin.scale.set(0.12);
    }
    root.addChild(coin);
    const s = worldToScreen(x, y, this.scratch);
    root.position.set(s.x, s.y);
    root.zIndex = depthKey(x, y) - 1; // Coins lie under whatever else fell there.
    this.viewport.objectLayer.addChild(root);
    this.coins.set(uid, { uid, amount, x, y, root, coin, glow, frames, bornAt: rested ? -2 : -1 });
  }

  getItem(uid: number): GroundItem | null {
    return this.items.get(uid) ?? null;
  }

  /** Coins on the floor (QA, the minimap). */
  coinList(): GroundCoin[] {
    return [...this.coins.values()].map(({ uid, amount, x, y }) => ({ uid, amount, x, y }));
  }

  /**
   * THE SCOOP (it.114): every coin within `radius` of a point leaves the
   * floor; the total is returned for the hero to pocket (main adds Fortune
   * and the +N label). Zero when nothing was in reach.
   */
  scoopGold(x: number, y: number, radius = COIN_SCOOP_RADIUS): number {
    let total = 0;
    for (const c of [...this.coins.values()]) {
      if (Math.hypot(c.x - x, c.y - y) > radius) continue;
      total += c.amount;
      this.coins.delete(c.uid);
      c.root.destroy({ children: true });
    }
    return total;
  }

  /** Nearest ground item to a world point within `range` (E-key pickup). */
  findNearest(x: number, y: number, range: number): GroundItem | null {
    let best: GroundItemView | null = null;
    let bestDist = range;
    for (const item of this.items.values()) {
      const d = Math.hypot(item.x - x, item.y - y);
      if (d <= bestDist) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  /** Remove a ground item and return its itemId (null if already gone). */
  pickup(uid: number): string | null {
    const item = this.items.get(uid);
    if (!item) return null;
    this.items.delete(uid);
    item.root.destroy({ children: true });
    item.beacon?.destroy({ children: true });
    eventBus.emit('item:pickedUp', { uid, itemId: item.itemId });
    return item.itemId;
  }

  /** Screen-space pick: the visible ground item whose glyph contains the point. */
  pickAtCanvas(canvasX: number, canvasY: number, camera: Camera, lighting: Lighting): number | null {
    const zoom = camera.currentZoom;
    const halfW = 16 * zoom + 6;
    const height = 28 * zoom + 8;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const item of this.items.values()) {
      if (!lighting.isVisible(Math.floor(item.x), Math.floor(item.y))) continue;
      const p = camera.worldToCanvas(item.x, item.y, this.scratch);
      const dx = canvasX - p.x;
      const dy = canvasY - (p.y - height / 2);
      if (Math.abs(dx) > halfW || Math.abs(dy) > height / 2 + 6) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestDist) {
        bestDist = d;
        best = item.uid;
      }
    }
    return best;
  }

  /** Per-frame: bob, fog gating, scene-light tinting for every ground item; the coins' bounce and twinkle. */
  updateRender(time: number, lighting: Lighting): void {
    for (const item of this.items.values()) {
      const visible = lighting.isVisible(Math.floor(item.x), Math.floor(item.y));
      item.root.visible = visible;
      if (!visible) continue;
      item.glyph.position.y = -4 + Math.sin(time * 2.4 + item.uid * 1.7) * 2.5;
      if (item.spin) item.glyph.texture = item.spin[Math.floor(time * 12 + item.uid) % item.spin.length];
      // All ground glyphs are pre-colored art now (pack icons or generated
      // pixel icons) — the scene light is the only tint applied.
      const light = lighting.getTintAt(item.x, item.y, 0.35);
      const base = 0xffffff;
      const r = Math.round((((base >> 16) & 0xff) * ((light >> 16) & 0xff)) / 255);
      const g = Math.round((((base >> 8) & 0xff) * ((light >> 8) & 0xff)) / 255);
      const b = Math.round(((base & 0xff) * (light & 0xff)) / 255);
      item.glyph.tint = (r << 16) | (g << 8) | b;
    }
    for (const c of this.coins.values()) {
      const visible = lighting.isVisible(Math.floor(c.x), Math.floor(c.y));
      c.root.visible = visible;
      if (!visible) continue;
      if (c.frames) {
        if (c.bornAt === -1) c.bornAt = time;
        // The bounce plays once (frames 0..4 in the air) and rests on the last frame.
        const f = c.bornAt < 0 ? c.frames.length - 1 : Math.min(c.frames.length - 1, Math.floor((time - c.bornAt) * COIN_FPS));
        if (c.coin.texture !== c.frames[f]) c.coin.texture = c.frames[f];
      } else {
        // A flat coin hops in for a beat, then lies still.
        if (c.bornAt === -1) c.bornAt = time;
        const t = c.bornAt < 0 ? 1 : Math.min(1, (time - c.bornAt) * 2);
        c.coin.position.y = -2 - Math.sin(t * Math.PI) * 10;
      }
      // THE TWINKLE: the glow breathes and the coin catches a glint now and then.
      const tw = 0.55 + 0.25 * Math.sin(time * 3.1 + c.uid * 0.9);
      c.glow.alpha = tw;
      c.glow.scale.set(c.glow.scale.x * 0.9 + (0.36 + tw * 0.12) * 0.1);
      const light = lighting.getTintAt(c.x, c.y, 0.55);
      const glint = Math.sin(time * 5 + c.uid * 2.3) > 0.94 ? 0xffffff : light;
      c.coin.tint = glint;
    }
  }
}
