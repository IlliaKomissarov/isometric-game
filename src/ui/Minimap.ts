/**
 * @module ui/Minimap
 * Corner minimap (toggle: M) rendering ONLY what the fog of war has
 * revealed: explored floors/walls in shadow tones, currently-visible tiles
 * brighter, the stairs in gold once discovered, and a pulsing player dot.
 *
 * Top-down orthographic (not isometric) for instant readability. Pure
 * DOM/canvas render layer: reads `Lighting.getState` + the dungeon grid and
 * writes nothing back. The explored base layer redraws only when the fog
 * changes (`markDirty`, wired to player:tileChanged); the player dot
 * composites every frame from the cached base.
 */

import { audio } from '@/engine/AudioManager';
import type { Lighting } from '@/engine/Lighting';
import { TILE_FLOOR, type DungeonMap } from '@/scenes/DungeonGenerator';

const SCALE = 4; // Canvas pixels per dungeon tile.

const COLOR_FLOOR_EXPLORED = '#3c372e';
const COLOR_FLOOR_VISIBLE = '#6a5f48';
const COLOR_WALL_EXPLORED = '#23202b';
const COLOR_WALL_VISIBLE = '#3a3444';
const COLOR_STAIRS = '#d8a83c';
const COLOR_PLAYER = '#e04a2f';

export class MinimapUI {
  private readonly wrap: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;

  private dungeon: DungeonMap | null = null;
  private lighting: Lighting | null = null;
  private stairs: { x: number; y: number } | null = null;
  private dirty = true;
  private visible = true;
  private readonly abort = new AbortController();
  /** CO-OP (it.59): the other heroes, drawn in their seat colours. */
  party: (() => Array<{ x: number; y: number; color: string; dead: boolean }>) | null = null;

  constructor() {
    this.wrap = document.createElement('div');
    this.wrap.id = 'minimap';
    this.canvas = document.createElement('canvas');
    this.base = document.createElement('canvas');
    this.wrap.appendChild(this.canvas);
    document.body.appendChild(this.wrap);
    this.ctx = this.canvas.getContext('2d')!;
    this.baseCtx = this.base.getContext('2d')!;

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'KeyM' && !e.repeat) {
          this.visible = !this.visible;
          this.wrap.classList.toggle('hidden', !this.visible);
          audio.sfx(this.visible ? 'mapOpen' : 'mapClose');
        }
      },
      { signal: this.abort.signal },
    );
  }

  /** Run teardown (it.36). */
  destroy(): void {
    this.abort.abort();
    this.wrap.remove();
  }

  /** Bind to a floor's dungeon + fog state (called by each world build). */
  setWorld(dungeon: DungeonMap, lighting: Lighting, stairs: { x: number; y: number }): void {
    this.dungeon = dungeon;
    this.lighting = lighting;
    this.stairs = stairs;
    this.canvas.width = dungeon.width * SCALE;
    this.canvas.height = dungeon.height * SCALE;
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    this.dirty = true;
  }

  /** Fog changed — the explored base layer needs a redraw. */
  markDirty(): void {
    this.dirty = true;
  }

  /** Per-render-frame composite: cached base + live player dot. */
  update(px: number, py: number, time: number): void {
    if (!this.visible || !this.dungeon || !this.lighting) return;
    if (this.dirty) {
      this.redrawBase();
      this.dirty = false;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);

    // Party (it.59): steady colour-coded dots under the local pulse.
    if (this.party) {
      for (const m of this.party()) {
        ctx.fillStyle = m.color;
        ctx.globalAlpha = m.dead ? 0.35 : 1;
        ctx.beginPath();
        ctx.arc(m.x * SCALE, m.y * SCALE, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Player: pulsing dot.
    const r = 2.6 + Math.sin(time * 6) * 0.7;
    ctx.fillStyle = COLOR_PLAYER;
    ctx.beginPath();
    ctx.arc(px * SCALE, py * SCALE, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private redrawBase(): void {
    const { dungeon, lighting } = this;
    if (!dungeon || !lighting) return;
    const ctx = this.baseCtx;
    ctx.clearRect(0, 0, this.base.width, this.base.height);

    for (let gy = 0; gy < dungeon.height; gy++) {
      for (let gx = 0; gx < dungeon.width; gx++) {
        const state = lighting.getState(gx, gy);
        if (state === 0) continue; // HIDDEN: reveal nothing.
        const isFloor = dungeon.grid[gy * dungeon.width + gx] === TILE_FLOOR;
        const visible = state === 2;
        ctx.fillStyle = isFloor
          ? visible
            ? COLOR_FLOOR_VISIBLE
            : COLOR_FLOOR_EXPLORED
          : visible
            ? COLOR_WALL_VISIBLE
            : COLOR_WALL_EXPLORED;
        ctx.fillRect(gx * SCALE, gy * SCALE, SCALE, SCALE);
      }
    }

    // Stairs, once their tile has been revealed.
    if (this.stairs && lighting.getState(this.stairs.x, this.stairs.y) !== 0) {
      ctx.fillStyle = COLOR_STAIRS;
      ctx.fillRect(this.stairs.x * SCALE - 1, this.stairs.y * SCALE - 1, SCALE + 2, SCALE + 2);
    }
  }
}
