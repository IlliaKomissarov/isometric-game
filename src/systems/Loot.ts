/**
 * @module systems/Loot
 * Ground loot: deterministic drops, world rendering, pickup bookkeeping.
 *
 * Drops roll from a seeded RNG stream (dungeonSeed-derived), so identical
 * kill orders produce identical loot on every co-op peer. Ground items are
 * lightweight records — NOT entities — rendered as a rarity-glow + tinted
 * item glyph that bobs gently and obeys fog visibility/lighting.
 */

import { Container, Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { eventBus } from '@/core/EventBus';
import type { Camera } from '@/engine/Camera';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import { RARITY_COLOR, type ItemDef } from '@/items/catalog';
import { itemDef, rollChestItem, rollDrop, rollRareItem } from '@/items/instance';
import { spriteLib } from '@/render/SpriteLibrary';
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

interface GroundItemView extends GroundItem {
  root: Container;
  glyph: Sprite;
}

export class LootSystem {
  private readonly items = new Map<number, GroundItemView>();
  private nextUid = 1;
  private readonly rand: Rng;
  /** The floor's item level (it.78): what its drops roll at. Set by the floor builder. */
  ilvl = 1;

  /** The stream's position (a world snapshot carries it; it.73). */
  get rngState(): number {
    return this.rand.state;
  }
  set rngState(v: number) {
    this.rand.state = v;
  }

  /** Everything on the floor, with the uid counter — a snapshot join re-lays it. */
  snapshot(): { next: number; items: GroundItem[] } {
    return { next: this.nextUid, items: [...this.items.values()].map(({ uid, itemId, x, y }) => ({ uid, itemId, x, y })) };
  }

  /** Re-lay a snapshot's ground items with the SAME uids, so a pickup command names the same thing here. */
  restore(s: { next: number; items: GroundItem[] }): void {
    for (const it of this.items.values()) it.root.destroy({ children: true });
    this.items.clear();
    for (const it of s.items) {
      const def = itemDef(it.itemId);
      if (def) this.spawnAs(it.uid, def, it.x, it.y);
    }
    this.nextUid = Math.max(s.next, this.nextUid);
  }
  private readonly scratch = vec2();

  constructor(
    private readonly viewport: Viewport,
    seed: number,
  ) {
    this.rand = mulberry32(seed ^ 0x517ab1e5);
  }

  /** Roll the drop table at a death location (deterministic stream). */
  tryDropAt(x: number, y: number): void {
    const id = rollDrop(this.rand, this.ilvl);
    if (id) this.spawnId(id, x, y);
  }

  /** Guaranteed drop (chests): always yields gear, uncommon at least. */
  dropForced(x: number, y: number): void {
    this.spawnId(rollChestItem(this.rand, this.ilvl), x, y);
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
    if (!item) return;
    this.items.delete(uid);
    item.root.destroy({ children: true });
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
    glow.tint = RARITY_COLOR[def.rarity];
    glow.scale.set(0.42);
    glow.alpha = 0.75;
    glow.position.y = -6;
    root.addChild(glow);

    // Weapons show their REAL pixel icon on the ground; other gear keeps
    // the item-colored paperdoll glyph.
    let glyph: Sprite;
    if (def.icon && spriteLib.loaded && spriteLib.hasSingle(`wicon_${def.icon}`)) {
      // COMPACT DROPS (it.37): ground icons stay ≤ 32 px so a boss loot
      // burst never carpets the floor.
      glyph = new Sprite(spriteLib.single(`wicon_${def.icon}`));
      glyph.anchor.set(0.5, 0.5);
      // The Raven icons are 64 px paintings (it.78): a third of that on the ground.
      glyph.scale.set(def.icon.startsWith('raven') ? 0.42 : 1.0);
      glyph.position.y = -7;
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

    this.items.set(uid, { uid, itemId: def.id, x, y, root, glyph });
    if (!quiet) eventBus.emit('item:dropped', { uid, itemId: def.id, x, y });
  }

  getItem(uid: number): GroundItem | null {
    return this.items.get(uid) ?? null;
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

  /** Per-frame: bob, fog gating, scene-light tinting for every ground item. */
  updateRender(time: number, lighting: Lighting): void {
    for (const item of this.items.values()) {
      const visible = lighting.isVisible(Math.floor(item.x), Math.floor(item.y));
      item.root.visible = visible;
      if (!visible) continue;
      item.glyph.position.y = -4 + Math.sin(time * 2.4 + item.uid * 1.7) * 2.5;
      // All ground glyphs are pre-colored art now (pack icons or generated
      // pixel icons) — the scene light is the only tint applied.
      const light = lighting.getTintAt(item.x, item.y, 0.35);
      const base = 0xffffff;
      const r = Math.round((((base >> 16) & 0xff) * ((light >> 16) & 0xff)) / 255);
      const g = Math.round((((base >> 8) & 0xff) * ((light >> 8) & 0xff)) / 255);
      const b = Math.round(((base & 0xff) * (light & 0xff)) / 255);
      item.glyph.tint = (r << 16) | (g << 8) | b;
    }
  }
}
