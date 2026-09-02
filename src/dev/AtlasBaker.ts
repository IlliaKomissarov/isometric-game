/**
 * @module dev/AtlasBaker (DEV ONLY — never imported by production code)
 *
 * Bakes every loaded SpriteLibrary animation into ONE grid atlas PNG
 * (columns = frames, rows = directions) exactly as the running game
 * renders it (post-rebake, post-composite, post-chroma-key), and POSTs
 * the files + a manifest to the Vite dev endpoint `/__bake`, which writes
 * them under public/assets/atlas/.
 *
 * Why bake from the running game: the raw packs go through renderer-side
 * processing (downscale rebakes, layer composites, canvas tone-baking) that
 * only exists in WebGL. Extracting the finished textures guarantees the
 * atlases are pixel-identical to what shipped before the purge.
 *
 * The manifest also records the PAINTED bounds of the south-facing frames
 * (alpha-scanned) so rigs can normalize character heights from data.
 */

import { Sprite, type Application, type Texture } from 'pixi.js';
import { spriteLib } from '@/render/SpriteLibrary';

export interface PaintedBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface AtlasAnimEntry {
  file: string;
  /** Atlas cell size in ATLAS pixels (already cropped, already downscaled). */
  cellW: number;
  cellH: number;
  frameCount: number;
  dirCount: number;
  nearest: boolean;
  /** Original (uncropped, full-res) frame size — anchors are relative to it. */
  origW: number;
  origH: number;
  /** Crop offset of the cell inside the original frame (full-res px). */
  trimX: number;
  trimY: number;
  /** Atlas pixels per original pixel (0.5 = half-resolution bake). */
  scale: number;
  /** Painted bounds (ORIGINAL px) of the south-facing frames, union over frames. */
  painted: PaintedBounds;
}

export interface AtlasSingleEntry {
  file: string;
  w: number;
  h: number;
  nearest: boolean;
}

export interface AtlasManifest {
  generated: string;
  anims: Record<string, AtlasAnimEntry>;
  singles: Record<string, AtlasSingleEntry>;
}

async function post(file: string, payload: { base64?: string; text?: string }): Promise<void> {
  const r = await fetch('/__bake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, ...payload }),
  });
  if (!r.ok) throw new Error(`bake POST failed for ${file}: ${await r.text()}`);
}

function canvasToBase64(c: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    c.toBlob((blob) => {
      if (!blob) {
        reject(new Error('toBlob returned null'));
        return;
      }
      const fr = new FileReader();
      fr.onload = () => resolve((fr.result as string).split(',')[1]);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    }, 'image/png');
  });
}

function scanBounds(c: HTMLCanvasElement): PaintedBounds | null {
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  let top = c.height;
  let bottom = -1;
  let left = c.width;
  let right = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (img[(y * c.width + x) * 4 + 3] > 24) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return bottom < 0 ? null : { top, bottom, left, right };
}

function union(a: PaintedBounds | null, b: PaintedBounds | null): PaintedBounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
  };
}

/** Anims nothing in the game references any more (dead loads) — not baked. */
const SKIP = new Set(['warrior_walk', 'warrior_idle', 'skeleton_walk', 'skeleton_death']);
/**
 * Packs rendered at ≤0.42 rig scale bake at HALF resolution: their 320/512
 * source cells only ever reach ~0.9× on screen at max zoom, so half-res
 * atlases are visually lossless and a quarter of the bytes.
 */
const HALF_RES = ['wolf_', 'lizard_', 'guard_', 'hydra_', 'shambler_', 'zombie_'];

/** Bake every loaded anim + single into public/assets/atlas/. Returns the manifest. */
export async function bakeAtlases(app: Application): Promise<AtlasManifest> {
  const { anims, singles } = spriteLib.debugEntries();
  const extract = (t: Texture): HTMLCanvasElement => {
    const s = new Sprite(t);
    const c = app.renderer.extract.canvas({ target: s, resolution: 1 }) as HTMLCanvasElement;
    s.destroy();
    return c;
  };
  const manifest: AtlasManifest = { generated: new Date().toISOString(), anims: {}, singles: {} };
  const warnings: string[] = [];

  for (const [name, anim] of anims) {
    if (SKIP.has(name)) continue;
    // Pass 1: extract every frame, measure the original cell, union the
    // painted bounds over ALL dirs/frames (the crop) and over the S dir
    // (the height-normalization data).
    let origW = 0;
    let origH = 0;
    const cells: HTMLCanvasElement[][] = [];
    let crop: PaintedBounds | null = null;
    let painted: PaintedBounds | null = null;
    const sDir = anim.dirCount === 1 ? 0 : 6;
    for (let d = 0; d < anim.dirCount; d++) {
      const row: HTMLCanvasElement[] = [];
      for (let f = 0; f < anim.frameCount; f++) {
        const c = extract(anim.frames[d][f]);
        origW = Math.max(origW, c.width);
        origH = Math.max(origH, c.height);
        const b = scanBounds(c);
        crop = union(crop, b);
        if (d === sDir) painted = union(painted, b);
        row.push(c);
      }
      cells.push(row);
    }
    if (!crop) {
      warnings.push(`${name}: fully transparent — skipped`);
      continue;
    }
    // One pixel of padding keeps linear filtering from bleeding neighbors.
    const pad = 1;
    const trimX = Math.max(0, crop.left - pad);
    const trimY = Math.max(0, crop.top - pad);
    const cropW = Math.min(origW, crop.right + pad + 1) - trimX;
    const cropH = Math.min(origH, crop.bottom + pad + 1) - trimY;
    const scale = HALF_RES.some((p) => name.startsWith(p)) ? 0.5 : 1;
    const cellW = Math.ceil(cropW * scale);
    const cellH = Math.ceil(cropH * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cellW * anim.frameCount;
    canvas.height = cellH * anim.dirCount;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = scale !== 1;
    ctx.imageSmoothingQuality = 'high';
    for (let d = 0; d < anim.dirCount; d++) {
      for (let f = 0; f < anim.frameCount; f++) {
        ctx.drawImage(cells[d][f], trimX, trimY, cropW, cropH, f * cellW, d * cellH, cellW, cellH);
      }
    }
    const file = `${name}.png`;
    await post(file, { base64: await canvasToBase64(canvas) });
    manifest.anims[name] = {
      file,
      cellW,
      cellH,
      frameCount: anim.frameCount,
      dirCount: anim.dirCount,
      nearest: anim.frames[0][0].source.scaleMode === 'nearest',
      origW,
      origH,
      trimX,
      trimY,
      scale,
      painted: painted ?? { top: 0, bottom: origH - 1, left: 0, right: origW - 1 },
    };
    console.info(`[bake] ${name}: ${canvas.width}x${canvas.height} cell ${cellW}x${cellH} of ${origW}x${origH} @${scale}`);
  }

  for (const [name, tex] of singles) {
    const c = extract(tex);
    const file = `single_${name}.png`;
    await post(file, { base64: await canvasToBase64(c) });
    manifest.singles[name] = { file, w: c.width, h: c.height, nearest: tex.source.scaleMode === 'nearest' };
    console.info(`[bake] single ${name}: ${c.width}x${c.height}`);
  }

  await post('manifest.json', { text: JSON.stringify(manifest, null, 1) });
  if (warnings.length) console.warn('[bake] warnings:\n' + warnings.join('\n'));
  console.info(`[bake] DONE: ${Object.keys(manifest.anims).length} anims, ${Object.keys(manifest.singles).length} singles`);
  return manifest;
}
