/**
 * @module render/Culling
 * OFF-SCREEN CULLING (it.74): a floor is ~4,000 sprites (tiles, walls,
 * props, decals) and the camera sees a few hundred of them. Pixi batches
 * every child it is handed and lets the GPU discard the rest, so the CPU
 * cost of a frame scaled with the FLOOR, not with the SCREEN.
 *
 * WHY NOT PIXI'S CULLER: it measures every child's bounds (a matrix walk
 * per sprite per frame). World sprites here are positioned in the world
 * container's own space — the iso-projected screen pixel — so a sprite's
 * place on screen is `pos * zoom + offset`, two multiplies and four
 * compares, no bounds. Sprites outside the screen plus a margin are marked
 * `renderable = false` (NOT `visible`: the lighting owns `visible` for
 * fog-hidden tiles, and a sim must never read either).
 *
 * Entities are never culled: their containers are handed in as `keep`, so a
 * creature's simulation and animation state stay exactly what they were.
 */

import type { Container } from 'pixi.js';
import type { Viewport } from '@/engine/Viewport';

/** Screen-space margin around the viewport, so nothing pops at the edge. */
const MARGIN = 192;
/** Walls and props stand up to this many world pixels above their anchor. */
const TALL = 176;

export interface CullStats {
  total: number;
  culled: number;
}

const stats: CullStats = { total: 0, culled: 0 };

export function cullWorld(viewport: Viewport, screenW: number, screenH: number, keep: ReadonlySet<Container>): CullStats {
  const world = viewport.world;
  const z = world.scale.x;
  const ox = world.position.x;
  const oy = world.position.y;
  const left = -MARGIN;
  const right = screenW + MARGIN;
  const top = -MARGIN - TALL * z;
  const bottom = screenH + MARGIN;
  let total = 0;
  let culled = 0;
  for (const layer of [viewport.groundLayer, viewport.objectLayer]) {
    const kids = layer.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (keep.has(c)) {
        c.renderable = true;
        continue;
      }
      const sx = c.position.x * z + ox;
      const sy = c.position.y * z + oy;
      const ok = sx > left && sx < right && sy > top && sy < bottom;
      // Assign only on a change: a write to `renderable` marks the render
      // group's structure dirty and Pixi v8 rebuilds its cached instruction
      // set — the very thing that makes 4,000 static sprites cheap.
      if (c.renderable !== ok) c.renderable = ok;
      total++;
      if (!ok) culled++;
    }
  }
  stats.total = total;
  stats.culled = culled;
  return stats;
}

/** Everything back on, for a screenshot or a teardown. */
export function uncullWorld(viewport: Viewport): void {
  for (const layer of [viewport.groundLayer, viewport.objectLayer]) for (const c of layer.children) c.renderable = true;
}
