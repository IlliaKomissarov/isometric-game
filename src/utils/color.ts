/**
 * @module utils/color
 * Tiny color helpers for tint composition (0xRRGGBB integers).
 */

/** Per-channel multiply of two tints (identity is 0xffffff). */
export function multiplyColors(a: number, b: number): number {
  const r = Math.round((((a >> 16) & 0xff) * ((b >> 16) & 0xff)) / 255);
  const g = Math.round((((a >> 8) & 0xff) * ((b >> 8) & 0xff)) / 255);
  const bl = Math.round(((a & 0xff) * (b & 0xff)) / 255);
  return (r << 16) | (g << 8) | bl;
}
