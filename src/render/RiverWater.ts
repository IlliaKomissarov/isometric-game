/**
 * @module render/RiverWater
 * THE RIVER RUNS (it.106, real art it.107) — the animation pass over the
 * riverside's water.
 *
 * RENDER-ONLY, like `Ambience` and `Vfx`. It never touches the grid, never
 * moves anything the sim can see, and takes no part in a tick: two peers with
 * different frame rates see the same river at different phases and agree about
 * everything that matters. It is driven from the render callback, on the wall
 * clock, so the current keeps flowing while the sim is frozen for a cutscene.
 *
 * HOW IT MOVES. `scripts/bake-water.py` bakes the pack's own ten-frame caustic
 * loop into ten isometric ground diamonds. Every water tile holds a fixed offset
 * into that loop, derived from its position ALONG the current, so neighbouring
 * tiles are a fraction of a period apart and the light reads as one pattern
 * travelling downstream rather than as a whole river blinking together.
 *
 * IT.107: this used to also scatter procedural ripple rings over the shore. The
 * real caustics carry the motion by themselves, and the rings on top of them
 * read as two different waters at once - so they are gone with the generator
 * that drew them.
 *
 * Swapping `sprite.texture` costs nothing here: the textures are already
 * resident, the sprites already exist, and Pixi rebatches a same-size swap
 * without reuploading anything. Lighting still owns their tint - this pass only
 * ever writes `texture`.
 */

import type { Sprite } from 'pixi.js';
import { assets, WATER_PERIOD, WATER_PHASES } from '@/core/AssetManager';

/** How long one full pass of the wave loop takes, in seconds. */
const PERIOD = 1.9;

interface WaterTile {
  sprite: Sprite;
  /** This tile's fixed offset into the loop, in phases. */
  offset: number;
  /** Which member of the 3x3 spatial block this tile is (it.108). */
  block: number;
  /** The phase currently on the sprite, so an unchanged tile is not rewritten. */
  shown: number;
}

export class RiverWater {
  private readonly tiles: WaterTile[] = [];
  private clock = 0;
  private ok = false;

  /**
   * Take one of the floor's ground sprites. Called from `SceneManager.build`
   * through its `onFloor` hook, for every tile - the caller decides which are
   * water, because only the floor's own layout knows.
   */
  add(gx: number, gy: number, sprite: Sprite): void {
    if (this.tiles.length === 0) this.ok = assets.has('water_0_0');
    if (!this.ok) return;
    // The current runs down the map's diagonal, so the offset is taken along it:
    // that is what makes the light travel instead of pulsing in place.
    const along = gx * 0.55 - gy * 0.8;
    // ...and WHERE in the caustic field this tile sits, so the pattern is
    // continuous with its neighbours rather than a copy of them (it.108).
    const bx = ((gx % WATER_PERIOD) + WATER_PERIOD) % WATER_PERIOD;
    const by = ((gy % WATER_PERIOD) + WATER_PERIOD) % WATER_PERIOD;
    this.tiles.push({ sprite, offset: along, block: by * WATER_PERIOD + bx, shown: -1 });
  }

  /** Render tick. `dt` is wall-clock seconds; never a sim tick. */
  update(dt: number): void {
    if (!this.ok || this.tiles.length === 0) return;
    this.clock += dt;
    const base = (this.clock / PERIOD) * WATER_PHASES;
    for (const t of this.tiles) {
      const phase = Math.floor(base + t.offset) % WATER_PHASES;
      const p = phase < 0 ? phase + WATER_PHASES : phase;
      if (p === t.shown) continue;
      t.shown = p;
      t.sprite.texture = assets.get(`water_${p}_${t.block}`);
    }
  }

  /** The water TILES belong to the scene, so there is nothing of ours to free. */
  destroy(): void {
    this.tiles.length = 0;
  }
}
