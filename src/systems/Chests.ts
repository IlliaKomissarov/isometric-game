/**
 * @module systems/Chests
 * Lootable chests: seeded placement, click-to-open with walk-up approach,
 * guaranteed multi-item drops, glint VFX, and a bobbing loot indicator
 * (Lords of Pain `loot_indicator`) over unopened chests.
 *
 * Flow: InputBindings picks a chest → OPEN_CHEST command → MovementSystem
 * walks into reach → `chest:reached` event → `open()` rolls drops through
 * the LootSystem's forced table. Chest state (opened) is simulation state;
 * indicator bob/glint are render-side. Every chest spills coins as well
 * (it.114), and a crypt chest now and then a dish.
 */

import { Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { eventBus } from '@/core/EventBus';
import type { Camera } from '@/engine/Camera';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import { spriteLib } from '@/render/SpriteLibrary';
import type { DungeonMap } from '@/scenes/DungeonGenerator';
import { vec2 } from '@/utils/Vec2';
import { depthKey, worldToScreen } from '@/utils/iso';
import { mulberry32, type Rng } from '@/utils/rng';
import type { LootSystem } from './Loot';

export interface Chest {
  id: number;
  x: number;
  y: number;
  opened: boolean;
  /** THE COLISEUM CHEST (it.53): rare + legendary spoils. */
  grand?: boolean;
  /** A TOWN CHEST (it.92): a draught or two, a scrap, a plain piece. */
  minor?: boolean;
}

interface ChestView extends Chest {
  sprite: Sprite;
  indicator: Sprite | null;
  /** Pulsing gold halo marking the chest as interactable while unopened. */
  halo: Sprite;
}

const CHEST_ROOM_CHANCE = 0.45;
const DROPS_PER_CHEST_MIN = 2;
const DROPS_PER_CHEST_MAX = 3;

/**
 * SCATTERED, AND TUCKED (it.117)
 * ==============================
 * "Scatter chests around the world map, placing some hidden in corners of
 * locations but still visible." Every hand-written spot list in the scenes has
 * the same two failure modes: a coordinate that the map's own noise has since
 * turned into water, a hedge or a gable, and - worse - a chest that lands in
 * the middle of a field, which is scattered but not HIDDEN. This picks them
 * instead, out of the finished grid, against four rules:
 *
 *   FREE       the tile is one the hero can stand on and nothing stands on.
 *   REACHED    at least two of its four neighbours are walkable, so it is in
 *              the open ground and not at the end of a one-tile pocket the
 *              connectivity pass is about to seal.
 *   TUCKED     at least `tuck` of its EIGHT neighbours are not walkable - it
 *              sits in a nook: the inside of a hedge's elbow, the gap between
 *              a barn and a wall, the back of a ruin.
 *   SEEN       and yet nothing stands in FRONT of it. In this projection a
 *              sprite one tile south or east of a tile is drawn OVER it, so a
 *              nook whose open side faces away from the camera is a chest the
 *              player will never see. Both of those two tiles must be clear.
 *              This one rule is the whole difference between "hidden in a
 *              corner but still visible" and "lost behind the smithy".
 *
 *   UNSEALING  and the open neighbours must form ONE unbroken arc, so the tile
 *              is not the only way between two places. A chest claims its own
 *              tile, and this runs AFTER a floor's connectivity pass, so one
 *              set down in a doorway would wall off whatever is behind it with
 *              nothing left to catch it.
 *
 * Deterministic: the order is a seeded shuffle, so every peer and every reload
 * finds the same chests, and the caller's own hand-placed spots go in `avoid`
 * so the two never fight. Pure - it reads the grid through the callbacks and
 * writes nothing.
 */
export interface ScatterOpts {
  width: number;
  height: number;
  /** A tile a chest may be set down on (walkable, off the road, unclaimed). */
  free: (x: number, y: number) => boolean;
  /** A tile the hero can walk through - what "a corner" is measured against. */
  open: (x: number, y: number) => boolean;
  /** Spots already taken (other chests, the spawn, a quest mark). */
  avoid?: ReadonlyArray<{ x: number; y: number }>;
  /** How many to find. Fewer come back if the floor has no room for them. */
  count: number;
  /** Tiles between two chests, and between a chest and anything in `avoid`. */
  apart?: number;
  seed: number;
}

/** The eight neighbours, walked round the tile, so an arc is a run of trues. */
const RING: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

export function scatterChests(o: ScatterOpts): Array<{ x: number; y: number }> {
  const ring = [false, false, false, false, false, false, false, false];
  const { width: w, height: h } = o;
  const apart = o.apart ?? 9;
  const rand = mulberry32((o.seed ^ 0x9e3779b9) >>> 0);
  const taken: Array<{ x: number; y: number }> = [...(o.avoid ?? [])];
  const out: Array<{ x: number; y: number }> = [];
  const far = (x: number, y: number): boolean => !taken.some((p) => Math.hypot(p.x - x, p.y - y) < apart);

  // One pass over the floor scores every tile; the candidates are then walked
  // in a seeded order, tightest nooks first.
  const cand: Array<{ x: number; y: number; tuck: number; key: number }> = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!o.free(x, y)) continue;
      if (!o.open(x + 1, y) || !o.open(x, y + 1)) continue; // SEEN: nothing may stand in front of it
      // The eight neighbours IN RING ORDER, so the pinch test below can read them.
      let open4 = 0;
      let tuck = 0;
      for (let i = 0; i < 8; i++) {
        const ok = o.open(x + RING[i][0], y + RING[i][1]);
        ring[i] = ok;
        if (!ok) tuck++;
        else if (i % 2 === 0) open4++; // the even slots are N, E, S, W
      }
      if (open4 < 2) continue; // REACHED
      /**
       * AND NOT A PINCH. A chest claims its tile, so one set down in a doorway
       * or a one-wide passage seals whatever is behind it - and this runs after
       * a floor's own connectivity pass, which is therefore not going to catch
       * it. If the open neighbours form ONE unbroken arc around the tile, every
       * one of them still touches every other without going through the middle,
       * so taking the middle away cannot cut anything off. Two arcs or more
       * means the tile is the only way between them: leave it alone.
       */
      let arcs = 0;
      for (let i = 0; i < 8; i++) if (ring[i] && !ring[(i + 7) % 8]) arcs++;
      if (arcs > 1) continue;
      cand.push({ x, y, tuck, key: rand() });
    }
  }
  // Tightest first, ties broken by the seeded key - so a map with a hundred
  // equally snug corners still spreads its chests over all of them.
  cand.sort((a, b) => b.tuck - a.tuck || a.key - b.key);
  // Two sweeps: real nooks first, then anywhere that is far enough from the
  // rest, so a floor with few corners still gets its count.
  for (const min of [3, 1]) {
    for (const c of cand) {
      if (out.length >= o.count) break;
      if (c.tuck < min) continue;
      if (!far(c.x, c.y)) continue;
      out.push({ x: c.x, y: c.y });
      taken.push({ x: c.x, y: c.y });
    }
    if (out.length >= o.count) break;
  }
  return out;
}

export class ChestSystem {
  private readonly chests = new Map<number, ChestView>();
  private nextId = 1;
  private readonly rand: Rng;

  /** The stream's position (a world snapshot carries it; it.73). */
  get rngState(): number {
    return this.rand.state;
  }
  set rngState(v: number) {
    this.rand.state = v;
  }
  private readonly scratch = vec2();

  constructor(
    private readonly viewport: Viewport,
    private readonly lighting: Lighting,
    private readonly loot: LootSystem,
    seed: number,
  ) {
    this.rand = mulberry32((seed ^ 0xc4e57b01) >>> 0);
  }

  /** Seeded placement: one chest in ~45% of non-spawn rooms. */
  place(dungeon: DungeonMap, exclude: ReadonlyArray<{ x: number; y: number }>): void {
    for (let i = 1; i < dungeon.rooms.length; i++) {
      if (this.rand() >= CHEST_ROOM_CHANCE) continue;
      const room = dungeon.rooms[i];
      const gx = room.x + 1 + Math.floor(this.rand() * Math.max(1, room.w - 2));
      const gy = room.y + 1 + Math.floor(this.rand() * Math.max(1, room.h - 2));
      if (exclude.some((p) => p.x === gx && p.y === gy)) continue;
      // Never drop a chest onto a carved pillar tile (unreachable loot).
      if (dungeon.grid[gy * dungeon.width + gx] !== 1) continue;

      this.create(gx, gy);
    }
  }

  /** One chest on a tile; grand chests are larger and gold-lit (it.53). */
  private create(gx: number, gy: number, grand = false, minor = false): number {
    const id = this.nextId++;
    const sprite = new Sprite(assets.get('chest_closed'));
    sprite.anchor.set(0.5, 1.0);
    if (grand) sprite.scale.set(1.35);
    const s = worldToScreen(gx + 0.5, gy + 0.5, this.scratch);
    sprite.position.set(s.x, s.y + 4);
    sprite.zIndex = depthKey(gx + 0.5, gy + 0.5);
    this.viewport.objectLayer.addChild(sprite);
    this.lighting.registerProp(gx, gy, sprite);

    let indicator: Sprite | null = null;
    if (spriteLib.loaded) {
      indicator = new Sprite(spriteLib.single('loot_indicator'));
      indicator.anchor.set(0.5, 1.0);
      indicator.scale.set(grand ? 0.5 : 0.35);
      indicator.visible = false;
      this.viewport.ambienceLayer.addChild(indicator);
    }

    // Interactable highlight: a warm halo under the chest until looted.
    const halo = new Sprite(assets.get('glow'));
    halo.anchor.set(0.5);
    halo.blendMode = 'add';
    halo.tint = grand ? 0xffd070 : 0xd8a85c;
    halo.position.set(s.x, s.y - 6);
    halo.scale.set(grand ? 1.2 : 0.7);
    halo.visible = false;
    this.viewport.ambienceLayer.addChild(halo);

    this.chests.set(id, { id, x: gx + 0.5, y: gy + 0.5, opened: false, grand, minor, sprite, indicator, halo });
    return id;
  }

  /** Drop a chest at runtime (the Coliseum's prize, it.53; a town's minor chests, it.92). Returns its id. */
  spawnAt(gx: number, gy: number, grand = false, minor = false): number {
    return this.create(gx, gy, grand, minor);
  }

  getChest(id: number): Chest | null {
    return this.chests.get(id) ?? null;
  }

  /** Indexes (placement order, id - 1) of chests already opened — for FloorMemory. */
  openedIndexes(): number[] {
    const out: number[] = [];
    for (const c of this.chests.values()) if (c.opened) out.push(c.id - 1);
    return out;
  }

  /** Re-apply a floor's memory: those chests stand open and yield nothing. */
  applyMemory(opened: ReadonlyArray<number>): void {
    for (const i of opened) {
      const chest = this.chests.get(i + 1);
      if (!chest || chest.opened) continue;
      chest.opened = true;
      chest.sprite.texture = assets.get('chest_open');
      if (chest.indicator) chest.indicator.visible = false;
      chest.halo.visible = false;
    }
  }

  /** Nearest unopened chest to a world point within `range` (E interaction). */
  findNearestUnopened(x: number, y: number, range: number): Chest | null {
    let best: ChestView | null = null;
    let bestDist = range;
    for (const chest of this.chests.values()) {
      if (chest.opened) continue;
      const d = Math.hypot(chest.x - x, chest.y - y);
      if (d <= bestDist) {
        bestDist = d;
        best = chest;
      }
    }
    return best;
  }

  /** Screen-space pick: the nearest UNOPENED, fog-visible chest at a canvas point. */
  pickAtCanvas(canvasX: number, canvasY: number, camera: Camera): number | null {
    const zoom = camera.currentZoom;
    const halfW = 20 * zoom + 4;
    const height = 34 * zoom + 4;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const chest of this.chests.values()) {
      if (chest.opened) continue;
      if (!this.lighting.isVisible(Math.floor(chest.x), Math.floor(chest.y))) continue;
      const p = camera.worldToCanvas(chest.x, chest.y, this.scratch);
      const dx = canvasX - p.x;
      const dy = canvasY - (p.y - height / 2);
      if (Math.abs(dx) > halfW || Math.abs(dy) > height / 2 + 6) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestDist) {
        bestDist = d;
        best = chest.id;
      }
    }
    return best;
  }

  /** Open a chest: swap art, hide the indicator, spill guaranteed loot. */
  open(id: number): void {
    const chest = this.chests.get(id);
    if (!chest || chest.opened) return;
    chest.opened = true;
    chest.sprite.texture = assets.get('chest_open');
    if (chest.indicator) chest.indicator.visible = false;
    chest.halo.visible = false;

    if (chest.grand) {
      // THE COLISEUM CHEST (it.53): three rare-or-better trophies and two more rolls,
      // and three purses of coins between them (it.114).
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 + this.rand() * 0.5;
        const r = 0.7 + this.rand() * 0.5;
        if (i < 3) this.loot.dropRareAt(chest.x + Math.cos(angle) * r, chest.y + Math.sin(angle) * r);
        else this.loot.dropForced(chest.x + Math.cos(angle) * r, chest.y + Math.sin(angle) * r);
      }
      for (let i = 0; i < 3; i++) {
        const angle = ((i + 0.5) / 3) * Math.PI * 2 + this.rand() * 0.4;
        this.loot.dropChestGold(chest.x + Math.cos(angle) * 1.1, chest.y + Math.sin(angle) * 1.1, true);
      }
    } else {
      const count = DROPS_PER_CHEST_MIN + Math.floor(this.rand() * (DROPS_PER_CHEST_MAX - DROPS_PER_CHEST_MIN + 1));
      for (let i = 0; i < count; i++) {
        const angle = this.rand() * Math.PI * 2;
        const r = 0.5 + this.rand() * 0.5;
        if (chest.minor) this.loot.dropMinor(chest.x + Math.cos(angle) * r, chest.y + Math.sin(angle) * r);
        else this.loot.dropForced(chest.x + Math.cos(angle) * r, chest.y + Math.sin(angle) * r);
      }
      // EVERY CHEST HOLDS COINS (it.114): a purse beside the spoils; a crypt chest may also hold a dish.
      {
        const angle = this.rand() * Math.PI * 2;
        this.loot.dropChestGold(chest.x + Math.cos(angle) * 0.6, chest.y + Math.sin(angle) * 0.6, false);
      }
      if (!chest.minor && this.rand() < 0.35) {
        const angle = this.rand() * Math.PI * 2;
        this.loot.dropFood(chest.x + Math.cos(angle) * 0.8, chest.y + Math.sin(angle) * 0.8);
      }
    }
    eventBus.emit('chest:opened', { chestId: id, x: chest.x, y: chest.y });
  }

  /** Per-frame: indicator bob + interactable halo pulse + fog gating. */
  updateRender(time: number): void {
    for (const chest of this.chests.values()) {
      if (chest.opened) continue;
      const visible = this.lighting.isVisible(Math.floor(chest.x), Math.floor(chest.y));
      chest.halo.visible = visible;
      if (chest.indicator) chest.indicator.visible = visible;
      if (!visible) continue;
      const pulse = Math.sin(time * 2.6 + chest.id);
      chest.halo.alpha = 0.4 + pulse * 0.15;
      chest.halo.scale.set(0.66 + pulse * 0.05);
      if (chest.indicator) {
        const s = worldToScreen(chest.x, chest.y, this.scratch);
        chest.indicator.position.set(s.x, s.y - 30 + pulse * 4);
        chest.indicator.alpha = 0.75 + pulse * 0.2;
      }
    }
  }
}
