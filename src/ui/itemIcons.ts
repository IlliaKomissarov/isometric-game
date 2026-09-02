/**
 * @module ui/itemIcons
 * Sharp dark-fantasy pixel icons for gear WITHOUT a pack sprite (bows,
 * wands, shields, helms, armor, boots, cloaks) — it.36 overhaul.
 *
 * Each icon is a 20×20 pixel painting built from a small palette per
 * item (base color → 5-step ramp: deepest shade, shade, base, light,
 * highlight) plus fixed metal/wood/leather accents, with a 1-px obsidian
 * outline so it reads crisply on the dark slot tiles. Icons are drawn once
 * per item on a 2D canvas and cached as data URLs (DOM grid) and as Pixi
 * textures (ground drops).
 *
 * Weapons that DO have oubliette pack icons never come through here — the
 * real sprite always wins (see ui/Inventory.iconHtml).
 */

import { Texture } from 'pixi.js';
import type { ItemDef } from '@/items/catalog';
import { uiAssetUrl, weaponIconUrl } from '@/render/SpriteLibrary';

const cache = new Map<string, string>();
const textureCache = new Map<string, Texture>();

const SIZE = 20;

/**
 * Pixel maps: 20 rows of 20 chars. Legend —
 *   '.' empty · 'o' outline · '1' deepest · '2' shade · '3' base ·
 *   '4' light · '5' highlight (all from the item color ramp) ·
 *   'w' wood · 'W' wood light · 'm' metal · 'M' metal light · 's' string ·
 *   'g' gold trim · 'G' gold light · 'r' red gem · 'k' black (leather dark)
 */
const SHAPES: Record<string, string[]> = {
  bow: [
    '.......oo...........',
    '......oW4o..........',
    '.......s4Wo.........',
    '.......s.o43o.......',
    '.......s..o43o......',
    '.......s..o43o......',
    '.......s...o43o.....',
    '.......s...o43o.....',
    '.......s...o43o.....',
    '.oMMmmwwwwwwwwwwWWo.',
    '.......s...o32o.....',
    '.......s...o32o.....',
    '.......s...o32o.....',
    '.......s..o32o......',
    '.......s..o32o......',
    '.......s.o32o.......',
    '.......s2Wo.........',
    '......oW2o..........',
    '.......oo...........',
    '....................',
  ],
  wand: [
    '................o...',
    '..............oo5o..',
    '.............o5G5o..',
    '.............o5Gg5o.',
    '..............o55o..',
    '.............oMo.o..',
    '............oMmo....',
    '...........oMmo.....',
    '..........o3mo......',
    '.........o32o.......',
    '........o32o........',
    '.......o32o.........',
    '......o321o.........',
    '.....o321o..........',
    '....o321o...........',
    '...o21o.............',
    '..o21o..............',
    '..o1o...............',
    '...o................',
    '....................',
  ],
  head: [
    '....................',
    '.......oooooo.......',
    '.....oo444444oo.....',
    '....o4455554444o....',
    '...o445555444333o...',
    '...o44554444333o....',
    '..o44444444333322o..',
    '..o44444333333222o..',
    '..o4gggggggggggg2o..',
    '..o3333ooooo33222o..',
    '..o33oo.....oo222o..',
    '..o3o.........o22o..',
    '..o3o..o...o..o2o...',
    '..o22ooo...ooo22o...',
    '..o2222o...o222o....',
    '...o221o...o11o.....',
    '....ooo.....oo......',
    '....................',
    '....................',
    '....................',
  ],
  offHand: [
    '....................',
    '....oooooooooooo....',
    '...o444444444443o...',
    '...o4555444443333o..',
    '...o455g444g43333o..',
    '...o44gGMMMMgg333o..',
    '...o44gMM5MMMg333o..',
    '...o44gM5rrMMg233o..',
    '...o44gMMrrMMg222o..',
    '...o43gMMMMMMg222o..',
    '...o33ggMMMMgg222o..',
    '....o3333gg32221o...',
    '....o33333322211o...',
    '.....o3333222111o...',
    '......o33222111o....',
    '.......o2221110.....',
    '........o2211o......',
    '.........o11o.......',
    '..........oo........',
    '....................',
  ],
  torso: [
    '....................',
    '....oo........oo....',
    '...o44o..oo..o44o...',
    '..o4444oo44oo4444o..',
    '..o4455544444554o...',
    '..o4455554455554o...',
    '..o444ggg44ggg44o...',
    '...o4444g44g4443o...',
    '...o44444gg44433o...',
    '...o444443344333o...',
    '...o4444333333322o..',
    '...o3333333332222o..',
    '...o33333g3322222o..',
    '...o3333ggg222222o..',
    '...o3322g2g222211o..',
    '....o22222222211o...',
    '....o2221111111o....',
    '.....ooooooooo......',
    '....................',
    '....................',
  ],
  legs: [
    '....................',
    '....................',
    '....oooo....oooo....',
    '...o4444o..o4444o...',
    '...o4443o..o3444o...',
    '...o4443o..o3444o...',
    '...o4433o..o3344o...',
    '...o4333o..o3334o...',
    '...o3333o..o3333o...',
    '...o3332o..o2333o...',
    '...o3322o..o2233o...',
    '...o3222o..o2223o...',
    '..o33222o..o22233o..',
    '..o32222o..o22223o..',
    '.o332221oo.o122233o.',
    '.o3222111o.o1112223o',
    '.o2211111o.o1111122o',
    '..ooooooo...ooooooo.',
    '....................',
    '....................',
  ],
  cloak: [
    '....................',
    '........oooo........',
    '.......o4gg4o.......',
    '......o44gg44o......',
    '.....o4444444 4o.....',
    '....o44444444444o...',
    '....o44443344444o...',
    '...o444433334444o...',
    '...o444433334444o...',
    '...o44433333344o....',
    '...o4443333333 4o....',
    '..o44333333333 44o...',
    '..o4433333333333o...',
    '..o3333322223333o...',
    '..o3332222222233o...',
    '..o3222222222223o...',
    '.o22222211122222o...',
    '.o2222111111112o....',
    '..oooooooooooooo....',
    '....................',
  ],
};

const RING_SHAPE: string[] = [
  '....................',
  '....................',
  '........oooo........',
  '.......o5GG5o.......',
  '......o5GrrG5o......',
  '......oGrrrrGo......',
  '......o5GrrG5o......',
  '.......o5GG5o.......',
  '......oo4444oo......',
  '.....o44o..o44o.....',
  '....o44o....o44o....',
  '....o33o....o33o....',
  '....o33o....o33o....',
  '....o22o....o22o....',
  '.....o22o..o22o.....',
  '......oo2222oo......',
  '........oooo........',
  '....................',
  '....................',
  '....................',
];

const CONSUMABLE_SHAPES: Record<string, string[]> = {
  potion: [
    '....................',
    '.......ooooo........',
    '......oWWWWWo.......',
    '......oWwwwWo.......',
    '.......ooooo........',
    '.......o444o........',
    '.......o444o........',
    '......oo444oo.......',
    '.....o4455544o......',
    '....o445555544o.....',
    '...o44555555444o....',
    '...o44555555433o....',
    '...o4455554433 3o....',
    '...o445544333322o...',
    '...o444433332222o...',
    '...o333333222221o...',
    '....o33322222211o...',
    '.....o2222211111o...',
    '......oooooooooo....',
    '....................',
  ],
  scroll: [
    '....................',
    '..oooooooooooooo....',
    '.oWWWWWWWWWWWWWWo...',
    '.oW555555555555Wo...',
    '.oW5555555555555Wo..',
    '..oo555555555555Wo..',
    '...o55g5gg5g5555Wo..',
    '...o555555555555Wo..',
    '...o5g5gggg5g555Wo..',
    '...o555555555555Wo..',
    '...o5gg5g5ggg555Wo..',
    '...o555555555555Wo..',
    '...o55g5gg55g555Wo..',
    '...o555555555555Wo..',
    '...oWWWWWWWWWWWWo...',
    '..oWWWWWWWWWWWWWWo..',
    '..o4444444444444o...',
    '...ooooooooooooo....',
    '....................',
    '....................',
  ],
};

function shapeFor(def: ItemDef): string[] {
  if (def.slot === 'consumable') return def.use?.portal ? CONSUMABLE_SHAPES.scroll : CONSUMABLE_SHAPES.potion;
  if (def.slot === 'ring') return RING_SHAPE;
  if (def.slot === 'mainHand') return SHAPES[def.weaponKind ?? 'bow'] ?? SHAPES.bow;
  return SHAPES[def.slot] ?? SHAPES.torso;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** 5-step ramp from the item color (deep shade → highlight). */
function ramp(color: number): string[] {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const mix = (k: number, toward: number): string =>
    `rgb(${clamp(r + (toward - r) * k)},${clamp(g + (toward - g) * k)},${clamp(b + (toward - b) * k)})`;
  return [mix(0.62, 8), mix(0.34, 14), mix(0, 0), mix(0.28, 250), mix(0.6, 255)];
}

const FIXED: Record<string, string> = {
  o: '#0b090e',
  w: '#5a3a22',
  W: '#8a6238',
  m: '#8c8e98',
  M: '#d0d4dc',
  s: '#d8cfb0',
  g: '#a8843a',
  G: '#e6c66a',
  r: '#c0342a',
  k: '#1a1418',
};

/** Render an item's pixel icon onto a fresh canvas (20×20 grid at `scale`). */
function drawIconCanvas(def: ItemDef, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * scale;
  canvas.height = SIZE * scale;
  const ctx = canvas.getContext('2d')!;
  const shape = shapeFor(def);
  const colors = ramp(def.color);
  for (let y = 0; y < SIZE; y++) {
    const row = shape[y] ?? '';
    for (let x = 0; x < SIZE; x++) {
      const ch = row[x];
      if (!ch || ch === '.' || ch === ' ') continue;
      let fill: string | undefined;
      if (ch >= '1' && ch <= '5') fill = colors[Number(ch) - 1];
      else fill = FIXED[ch];
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas;
}

/**
 * The one icon resolver every panel uses (it.40): painted art from the
 * Ultimate Fantasy pack when the item has `art`, the oubliette weapon icon
 * when it has `icon`, else the generated pixel icon. `base` is the class
 * every variant carries; `px` is added only to the pixel fallback.
 */
export function itemIconHtml(def: ItemDef, base = '', px = 'px'): string {
  const cls = (extra: string): string => [base, extra].filter(Boolean).join(' ');
  if (def.art) return `<img class="${cls('art')}" src="${uiAssetUrl(`items/${def.art}.png`)}" alt="${def.name}" draggable="false">`;
  if (def.icon) return `<img class="${cls('')}" src="${weaponIconUrl(def.icon)}" alt="${def.name}" draggable="false">`;
  return `<img class="${cls(px)}" src="${itemIconDataUrl(def)}" alt="${def.name}" draggable="false">`;
}

/** Data-URL for an item's icon (cached) — DOM inventory cells. */
export function itemIconDataUrl(def: ItemDef): string {
  const cached = cache.get(def.id);
  if (cached) return cached;
  // CRISP (it.42): 2× source shown at exactly 40 px — integer scaling, no resample blur.
  const url = drawIconCanvas(def, 2).toDataURL();
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
