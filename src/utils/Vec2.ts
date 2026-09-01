/**
 * @module utils/Vec2
 * Minimal allocation-conscious 2D vector helpers.
 *
 * Functions operate on plain `{x, y}` objects and offer `out`-parameter
 * variants so hot loops (movement, camera) can reuse scratch vectors instead
 * of allocating per frame.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function copy(out: Vec2, src: Vec2): Vec2 {
  out.x = src.x;
  out.y = src.y;
  return out;
}

export function add(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

export function sub(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

export function scale(out: Vec2, a: Vec2, s: number): Vec2 {
  out.x = a.x * s;
  out.y = a.y * s;
  return out;
}

export function lengthOf(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Normalize in place; zero vectors stay zero (no NaN propagation). */
export function normalize(out: Vec2, a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y);
  if (len < 1e-8) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  out.x = a.x / len;
  out.y = a.y / len;
  return out;
}

/** Linear interpolation between a and b by t in [0, 1]. */
export function lerpVec(out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}
