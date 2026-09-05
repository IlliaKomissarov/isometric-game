/**
 * @module systems/Chests
 * Lootable chests: seeded placement, click-to-open with walk-up approach,
 * guaranteed multi-item drops, glint VFX, and a bobbing loot indicator
 * (Lords of Pain `loot_indicator`) over unopened chests.
 *
 * Flow: InputBindings picks a chest → OPEN_CHEST command → MovementSystem
 * walks into reach → `chest:reached` event → `open()` rolls drops through
 * the LootSystem's forced table. Chest state (opened) is simulation state;
 * indicator bob/glint are render-side.
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
  private create(gx: number, gy: number, grand = false): number {
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

    this.chests.set(id, { id, x: gx + 0.5, y: gy + 0.5, opened: false, grand, sprite, indicator, halo });
    return id;
  }

  /** Drop a chest at runtime (the Coliseum's prize, it.53). Returns its id. */
  spawnAt(gx: number, gy: number, grand = false): number {
    return this.create(gx, gy, grand);
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
      // THE COLISEUM CHEST (it.53): three rare-or-better trophies and two more rolls.
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 + this.rand() * 0.5;
        const r = 0.7 + this.rand() * 0.5;
        if (i < 3) this.loot.dropRareAt(chest.x + Math.cos(angle) * r, chest.y + Math.sin(angle) * r);
        else this.loot.dropForced(chest.x + Math.cos(angle) * r, chest.y + Math.sin(angle) * r);
      }
    } else {
      const count = DROPS_PER_CHEST_MIN + Math.floor(this.rand() * (DROPS_PER_CHEST_MAX - DROPS_PER_CHEST_MIN + 1));
      for (let i = 0; i < count; i++) {
        const angle = this.rand() * Math.PI * 2;
        const r = 0.5 + this.rand() * 0.5;
        this.loot.dropForced(chest.x + Math.cos(angle) * r, chest.y + Math.sin(angle) * r);
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
