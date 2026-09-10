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

import { Sprite } from 'pixi.js';
import { assets, WATER_PERIOD, WATER_PHASES } from '@/core/AssetManager';

/**
 * How long one full pass of the wave loop takes, in seconds.
 *
 * IT.111 SLOWED IT DOWN, because the loop now MOVES. The bake shifts each
 * phase's whole caustic field downstream by a tenth of its own period, so ten
 * phases carry the pattern exactly three tiles and then wrap - the river has a
 * current instead of a shimmer. At the old 2.6 s that current ran at better
 * than a tile a second, which is a millrace; five and a half seconds puts it at
 * about half a tile a second, which is a river.
 */
const PERIOD = 5.5;

interface WaterTile {
  sprite: Sprite;
  /**
   * THE CROSS-FADE LAYER (it.110b). The caustic loop is ten frames, so at any
   * period the eye can follow it the texture SNAPS ten times a pass and the
   * river ticks instead of flowing. Every tile carries a second sprite in the
   * same place holding the NEXT frame, and the pass dissolves one into the
   * other - which turns ten discrete frames into a continuous surface for the
   * cost of one alpha write per tile per frame.
   */
  next: Sprite;
  /** This tile's fixed offset into the loop, in phases. */
  offset: number;
  /** Which member of the 3x3 spatial block this tile is (it.108). */
  block: number;
  /** The phases currently on the two sprites, so an unchanged tile is not rewritten. */
  shown: number;
  shownNext: number;
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
    // The dissolve layer sits in the ground layer directly over its own tile,
    // added straight after it so nothing can ever be drawn between the two.
    const next = new Sprite(sprite.texture);
    next.position.copyFrom(sprite.position);
    next.anchor.copyFrom(sprite.anchor);
    next.scale.copyFrom(sprite.scale);
    next.alpha = 0;
    const parent = sprite.parent;
    if (parent) parent.addChildAt(next, parent.getChildIndex(sprite) + 1);
    this.tiles.push({ sprite, next, offset: along, block: by * WATER_PERIOD + bx, shown: -1, shownNext: -1 });
  }

  /** Render tick. `dt` is wall-clock seconds; never a sim tick. */
  update(dt: number): void {
    if (!this.ok || this.tiles.length === 0) return;
    this.clock += dt;
    const base = (this.clock / PERIOD) * WATER_PHASES;
    for (const t of this.tiles) {
      const raw = base + t.offset;
      const floor = Math.floor(raw);
      /**
       * A SMOOTHSTEP, NOT A RAMP (it.110b). A linear dissolve holds both frames
       * at half strength for most of the crossing, which reads as a blur rather
       * than as moving water. Easing the mix keeps each frame crisp for most of
       * its life and spends the motion in the middle of the handover.
       */
      const k = raw - floor;
      const mix = k * k * (3 - 2 * k);
      const a = ((floor % WATER_PHASES) + WATER_PHASES) % WATER_PHASES;
      const b = (a + 1) % WATER_PHASES;
      if (a !== t.shown) {
        t.shown = a;
        t.sprite.texture = assets.get(`water_${a}_${t.block}`);
      }
      if (b !== t.shownNext) {
        t.shownNext = b;
        t.next.texture = assets.get(`water_${b}_${t.block}`);
      }
      t.next.alpha = mix;
      // The lighting owns the tint and the culler owns `renderable`, and both of
      // them only know about the tile the SCENE made - the dissolve layer has to
      // be told what its own tile was told.
      if (t.next.tint !== t.sprite.tint) t.next.tint = t.sprite.tint;
      if (t.next.renderable !== t.sprite.renderable) t.next.renderable = t.sprite.renderable;
      if (t.next.visible !== t.sprite.visible) t.next.visible = t.sprite.visible;
    }
  }

  /** The tiles belong to the scene; the dissolve layers are ours and are freed. */
  destroy(): void {
    for (const t of this.tiles) t.next.destroy();
    this.tiles.length = 0;
  }
}
