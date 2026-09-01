/**
 * @module utils/los
 * Grid line-of-sight via Bresenham traversal.
 *
 * Used by the fog-of-war system: a tile is visible only if the straight line
 * from the observer reaches it without crossing an opaque (wall) tile. The
 * blocking tile itself IS visible (so wall faces light up when you approach).
 *
 * Reference: /docs/skills/fog-of-war-los.md
 */

/**
 * Walk the Bresenham line from (x0,y0) to (x1,y1).
 * @param isOpaque Returns true when a tile blocks sight.
 * @returns true when (x1,y1) is visible from (x0,y0).
 */
export function hasLineOfSight(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  isOpaque: (x: number, y: number) => boolean,
): boolean {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    if (x === x1 && y === y1) return true;
    // The origin tile never blocks; intermediate opaque tiles block everything past them.
    if ((x !== x0 || y !== y0) && isOpaque(x, y)) return false;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
