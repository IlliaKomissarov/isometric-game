/**
 * @module utils/iso
 * Isometric (2:1 dimetric) coordinate projection.
 *
 * World space: continuous grid coordinates where 1 unit = 1 tile.
 * Screen space: pixels, +x right, +y down. The projection is the classic
 * classic-ARPG-style diamond mapping (see /docs/skills/iso-projection.md):
 *
 *   screenX = (wx - wy) * TILE_W / 2
 *   screenY = (wx + wy) * TILE_H / 2
 *
 * The inverse is exact, so mouse picking has zero drift. Rotation is
 * permanently disabled — these four functions are the ONLY place projection
 * math may live. Sub-agents must import from here, never re-derive.
 */

import { TILE_H, TILE_W } from '@/core/config';
import type { Vec2 } from './Vec2';

/** Project world (tile-space) coordinates to screen pixels. */
export function worldToScreen(wx: number, wy: number, out: Vec2): Vec2 {
  out.x = (wx - wy) * (TILE_W / 2);
  out.y = (wx + wy) * (TILE_H / 2);
  return out;
}

/** Unproject screen pixels (in world-container local space) to world coordinates. */
export function screenToWorld(sx: number, sy: number, out: Vec2): Vec2 {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  out.x = (a + b) / 2;
  out.y = (b - a) / 2;
  return out;
}

/** Snap continuous world coordinates to the integer tile containing them. */
export function worldToTile(wx: number, wy: number, out: Vec2): Vec2 {
  out.x = Math.floor(wx);
  out.y = Math.floor(wy);
  return out;
}

/** Center of a tile in world coordinates. */
export function tileCenter(gx: number, gy: number, out: Vec2): Vec2 {
  out.x = gx + 0.5;
  out.y = gy + 0.5;
  return out;
}

/**
 * Depth-sort key for the painter's algorithm. Objects in the sortable layer
 * set `zIndex = depthKey(wx, wy)` so southern/eastern objects draw on top.
 */
export function depthKey(wx: number, wy: number): number {
  return (wx + wy) * (TILE_H / 2);
}
