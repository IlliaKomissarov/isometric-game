/**
 * @module render/RiverWater
 * THE RIVER RUNS (it.106) — the animation pass over the riverside's water.
 *
 * RENDER-ONLY, like `Ambience` and `Vfx`. It never touches the grid, never
 * moves anything the sim can see, and takes no part in a tick: two peers with
 * different frame rates see the same river at different phases and agree about
 * everything that matters. It is driven from the render callback, on the wall
 * clock, so the current keeps flowing while the sim is frozen for a cutscene.
 *
 * HOW IT MOVES. `AssetManager.buildRiverGround` cuts one wave loop into
 * `WATER_PHASES` textures. Every water tile holds a fixed offset into that loop,
 * derived from its position ALONG the current, so neighbouring tiles are a
 * fraction of a period apart and the crests read as one wave travelling
 * downstream rather than as a whole river blinking together.
 *
 * Swapping `sprite.texture` costs nothing here: the textures are already
 * resident, the sprites already exist, and Pixi rebatches a same-size swap
 * without reuploading anything. Lighting still owns their tint - this pass only
 * ever writes `texture`.
 */

import { Sprite, type Container } from 'pixi.js';
import { assets, WATER_PHASES } from '@/core/AssetManager';
import { worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';
import { depthKey } from '@/utils/iso';

/** How long one full pass of the wave loop takes, in seconds. */
const PERIOD = 1.9;
/** How many shoreline ripples are alive at once. */
const RIPPLES = 14;
/** How long one ripple takes to swell and fade. */
const RIPPLE_LIFE = 2.4;

interface WaterTile {
  sprite: Sprite;
  /** This tile's fixed offset into the loop, in phases. */
  offset: number;
  /** The phase currently on the sprite, so an unchanged tile is not rewritten. */
  shown: number;
}

interface Ripple {
  sprite: Sprite;
  /** Seconds into its life. */
  t: number;
  life: number;
  scale: number;
}

export class RiverWater {
  private readonly tiles: WaterTile[] = [];
  private readonly ripples: Ripple[] = [];
  private readonly scratch = vec2();
  private clock = 0;
  private ok = false;

  /**
   * Take one of the floor's ground sprites. Called from `SceneManager.build`
   * through its `onFloor` hook, for every tile - the caller decides which are
   * water, because only the floor's own layout knows.
   */
  add(gx: number, gy: number, sprite: Sprite): void {
    // The current runs down the map's diagonal, so the offset is taken along it:
    // that is what makes the crests travel instead of pulsing in place.
    const along = gx * 0.55 - gy * 0.8;
    this.tiles.push({ sprite, offset: along, shown: -1 });
  }

  /**
   * Scatter the shoreline ripples over the tiles given (the water tiles that
   * touch land). Safe to call with an empty list.
   */
  seedRipples(layer: Container, shore: ReadonlyArray<{ x: number; y: number }>): void {
    this.ok = assets.has('water_ripple') && assets.has('water_phase_0');
    if (!this.ok || shore.length === 0) return;
    for (let i = 0; i < Math.min(RIPPLES, shore.length); i++) {
      const spot = shore[Math.floor((i * 7919) % shore.length)];
      const spr = new Sprite(assets.get('water_ripple'));
      spr.anchor.set(0.5);
      spr.blendMode = 'add';
      spr.alpha = 0;
      const s = worldToScreen(spot.x + 0.5, spot.y + 0.5, this.scratch);
      spr.position.set(s.x, s.y);
      spr.zIndex = depthKey(spot.x + 0.5, spot.y + 0.5) - 2;
      layer.addChild(spr);
      // Spread their lives so they are never all at the same size at once.
      this.ripples.push({ sprite: spr, t: (i / RIPPLES) * RIPPLE_LIFE, life: RIPPLE_LIFE * (0.8 + ((i * 13) % 7) / 20), scale: 0.7 + ((i * 5) % 6) / 10 });
    }
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
      t.sprite.texture = assets.get(`water_phase_${p}`);
    }
    for (const r of this.ripples) {
      r.t += dt;
      if (r.t > r.life) r.t -= r.life;
      const u = r.t / r.life;
      // Swell out and fade: a ring opening on the surface.
      r.sprite.scale.set(r.scale * (0.35 + u * 1.15));
      r.sprite.alpha = Math.sin(u * Math.PI) * 0.32;
    }
  }

  /** Free the ripples. The water TILES belong to the scene and are not ours. */
  destroy(): void {
    for (const r of this.ripples) r.sprite.destroy();
    this.ripples.length = 0;
    this.tiles.length = 0;
  }
}
