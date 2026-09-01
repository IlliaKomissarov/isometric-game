/**
 * @module systems/Collision
 * Grid collision with axis-separated wall sliding.
 *
 * An entity is a square collider of half-extent COLLIDER_RADIUS (tile units)
 * centered on its position. Movement resolves X then Y independently, so
 * pressing diagonally into a wall slides smoothly along it instead of
 * sticking — the classic ARPG feel.
 */

import { COLLIDER_RADIUS } from '@/core/config';
import type { Vec2 } from '@/utils/Vec2';

export type WalkableFn = (gx: number, gy: number) => boolean;

/** Can a collider of the standard radius sit at continuous position (x, y)? */
export function canStandAt(x: number, y: number, isWalkable: WalkableFn): boolean {
  const r = COLLIDER_RADIUS;
  return (
    isWalkable(Math.floor(x - r), Math.floor(y - r)) &&
    isWalkable(Math.floor(x + r), Math.floor(y - r)) &&
    isWalkable(Math.floor(x - r), Math.floor(y + r)) &&
    isWalkable(Math.floor(x + r), Math.floor(y + r))
  );
}

/**
 * Move `pos` by (dx, dy), sliding along walls. Mutates `pos` in place.
 * @returns true when any movement occurred.
 */
export function moveWithCollision(pos: Vec2, dx: number, dy: number, isWalkable: WalkableFn): boolean {
  let moved = false;
  if (dx !== 0 && canStandAt(pos.x + dx, pos.y, isWalkable)) {
    pos.x += dx;
    moved = true;
  }
  if (dy !== 0 && canStandAt(pos.x, pos.y + dy, isWalkable)) {
    pos.y += dy;
    moved = true;
  }
  return moved;
}
