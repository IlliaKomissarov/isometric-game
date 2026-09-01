/**
 * @module ui/itemIcons
 * Crisp pixel-style icons for gear WITHOUT an oubliette pack sprite (bows,
 * armor, cloaks). Drawn once per item on a tiny 2D canvas in the same
 * 14×14-ish pixel language as the pack's weapon icons, tinted by the item's
 * color, and cached as data URLs for the DOM inventory grid.
 *
 * Weapons that DO have pack icons never come through here — the real
 * sprite always wins (see ui/Inventory.iconHtml).
 */

import { Texture } from 'pixi.js';
import type { ItemDef } from '@/items/catalog';

const cache = new Map<string, string>();
const textureCache = new Map<string, Texture>();

type Px = ReadonlyArray<readonly [number, number]>;

/** Pixel maps (x,y in a 14×14 grid) per slot/kind silhouette. */
const SHAPES: Record<string, Px> = {
  bow: [
    [9, 1], [10, 2], [11, 3], [11, 4], [12, 5], [12, 6], [12, 7], [12, 8], [11, 9], [11, 10], [10, 11], [9, 12],
    [8, 2], [8, 11], // Tips.
    [7, 3], [7, 10], // String anchors.
    [6, 4], [6, 5], [6, 6], [6, 7], [6, 8], [6, 9], // String.
    [2, 6], [3, 6], [4, 6], [5, 6], // Nocked arrow.
  ],
  wand: [
    [3, 11], [4, 10], [5, 9], [6, 8], [7, 7], [8, 6], [9, 5],
    [10, 3], [11, 3], [10, 4], [11, 4], // Focus orb.
  ],
  head: [
    [5, 3], [6, 2], [7, 2], [8, 3], [4, 4], [9, 4], [4, 5], [9, 5], [4, 6], [9, 6],
    [4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [5, 8], [8, 8], [6, 5], [7, 5],
  ],
  offHand: [
    [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [3, 3], [10, 3], [3, 4], [10, 4],
    [3, 5], [10, 5], [4, 6], [9, 6], [4, 7], [9, 7], [5, 8], [8, 8], [6, 9], [7, 9],
    [6, 4], [7, 4], [6, 5], [7, 5], // Boss.
  ],
  torso: [
    [4, 2], [9, 2], [3, 3], [10, 3], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4],
    [4, 5], [9, 5], [4, 6], [9, 6], [4, 7], [9, 7], [5, 8], [6, 8], [7, 8], [8, 8],
    [6, 5], [7, 5], [6, 6], [7, 6],
  ],
  legs: [
    [4, 2], [5, 2], [8, 2], [9, 2], [4, 3], [5, 3], [8, 3], [9, 3], [4, 4], [8, 4],
    [4, 5], [8, 5], [4, 6], [8, 6], [3, 7], [4, 7], [5, 7], [7, 7], [8, 7], [9, 7],
  ],
  cloak: [
    [6, 1], [7, 1], [5, 2], [8, 2], [4, 3], [9, 3], [4, 4], [9, 4], [3, 5], [10, 5],
    [3, 6], [10, 6], [3, 7], [10, 7], [2, 8], [11, 8], [2, 9], [4, 9], [6, 9], [8, 9], [10, 9],
  ],
};

function shapeFor(def: ItemDef): Px {
  if (def.slot === 'mainHand') return SHAPES[def.weaponKind ?? 'bow'] ?? SHAPES.bow;
  return SHAPES[def.slot] ?? SHAPES.torso;
}

/** Render an item's pixel icon onto a fresh canvas (14×14 grid at `scale`). */
function drawIconCanvas(def: ItemDef, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 14 * scale;
  canvas.height = 14 * scale;
  const ctx = canvas.getContext('2d')!;
  const r = (def.color >> 16) & 0xff;
  const g = (def.color >> 8) & 0xff;
  const b = def.color & 0xff;

  const shape = shapeFor(def);
  // Dark outline pass, then the colored body with a simple top-light ramp.
  ctx.fillStyle = '#0d0b10';
  for (const [x, y] of shape) ctx.fillRect((x - 1) * scale + 1, (y - 1) * scale + 1, scale + 4, scale + 4);
  for (const [x, y] of shape) {
    const lightRow = y < 5 ? 1.25 : y > 9 ? 0.75 : 1;
    ctx.fillStyle = `rgb(${Math.min(255, r * lightRow) | 0},${Math.min(255, g * lightRow) | 0},${Math.min(255, b * lightRow) | 0})`;
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }
  return canvas;
}

/** Data-URL for an item's icon (cached) — DOM inventory cells. */
export function itemIconDataUrl(def: ItemDef): string {
  const cached = cache.get(def.id);
  if (cached) return cached;
  const url = drawIconCanvas(def, 3).toDataURL();
  cache.set(def.id, url);
  return url;
}

/** Pixi texture of the same icon (crisp) — GROUND drops of non-pack gear. */
export function itemIconTexture(def: ItemDef): Texture {
  const cached = textureCache.get(def.id);
  if (cached) return cached;
  const tex = Texture.from(drawIconCanvas(def, 2));
  tex.source.scaleMode = 'nearest';
  textureCache.set(def.id, tex);
  return tex;
}
