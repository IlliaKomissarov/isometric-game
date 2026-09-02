/**
 * @module dev/TownBaker (DEV ONLY — one-shot tool, never imported by production code)
 *
 * Composites the TOWN assets picked from public/assets/test-models into the
 * atlas store (public/assets/atlas) through the dev `/__bake` endpoint, and
 * merges their entries into manifest.json. Run `await __bakeTown()` from
 * the dev console with the test-models folder present; the raw folder is
 * pruned afterwards (it.39). Singles are baked at their in-game scale;
 * anims become grid atlases (cols = frames, rows = dirs) exactly like the
 * it.36 baker produced, so SpriteLibrary loads them unchanged.
 */

const T = `${import.meta.env.BASE_URL}assets/test-models`;
const ATLAS = `${import.meta.env.BASE_URL}assets/atlas`;

interface Bounds { top: number; bottom: number; left: number; right: number }

async function post(file: string, payload: { base64?: string; text?: string }): Promise<void> {
  const r = await fetch('/__bake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, ...payload }),
  });
  if (!r.ok) throw new Error(`bake POST failed for ${file}: ${await r.text()}`);
}

function toBase64(c: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    c.toBlob((blob) => {
      if (!blob) return reject(new Error('toBlob null'));
      const fr = new FileReader();
      fr.onload = () => resolve((fr.result as string).split(',')[1]);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    }, 'image/png');
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = encodeURI(url);
  });
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext('2d')!];
}

/** Draw `img` scaled into a fresh canvas (smooth for painted art, crisp for pixel art). */
function scaled(img: CanvasImageSource, sw: number, sh: number, scale: number, smooth: boolean, sx = 0, sy = 0): HTMLCanvasElement {
  const [c, ctx] = canvasOf(sw * scale, sh * scale);
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

function bounds(c: HTMLCanvasElement): Bounds {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let top = c.height, bottom = -1, left = c.width, right = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (d[(y * c.width + x) * 4 + 3] > 24) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
  return bottom < 0 ? { top: 0, bottom: c.height - 1, left: 0, right: c.width - 1 } : { top, bottom, left, right };
}

export async function bakeTown(): Promise<void> {
  const manifest = (await (await fetch(`${ATLAS}/manifest.json`, { cache: 'no-cache' })).json()) as {
    anims: Record<string, unknown>;
    singles: Record<string, unknown>;
  };
  const TS = `${T}/Isometric tileset/tile_images`;
  const DP = `${T}/Dungeon Pry/Placeables`;

  // ---- singles: [name, url, scale, smooth] ---------------------------------
  const singles: Array<[string, string, number, boolean]> = [
    ['town_cobble', `${TS}/ground/cobble.png`, 0.25, true],
    ['town_grass', `${TS}/ground/grasstile1.png`, 0.25, true],
    ['town_dirt', `${TS}/ground/dirttextile.png`, 0.25, true],
    ['house_a', `${T}/house/rem_0002.png`, 0.28, true],
    ['house_b', `${T}/house/rem_0006.png`, 0.28, true],
    ['house_c', `${T}/house/rem_0010.png`, 0.28, true],
    ['house_d', `${T}/house/rem_0014.png`, 0.28, true],
    ['stall_a', `${TS}/wood_structure/stall1.png`, 0.5, true],
    ['stall_b', `${TS}/wood_structure/stall2.png`, 0.5, true],
    ['stall_c', `${TS}/wood_structure/stall3.png`, 0.5, true],
    ['stall_d', `${TS}/wood_structure/stall4.png`, 0.5, true],
    ['fence', `${TS}/wood_structure/fence1.png`, 0.5, true],
    ['pillar', `${TS}/blocks/pillar3.png`, 0.45, true],
    ['barrel_a', `${DP}/barrel_001.png`, 0.22, true],
    ['barrel_b', `${DP}/barrel_002.png`, 0.22, true],
    ['crates', `${TS}/clutter/crates_stacked.png`, 0.55, true],
    ['stash_closed', `${DP}/chest_01.png`, 0.3, true],
    ['stash_open', `${DP}/chest_01_open.png`, 0.3, true],
    ['tree_a', `${TS}/nature/tree2.png`, 0.42, true],
    ['tree_b', `${TS}/nature/tree3.png`, 0.42, true],
    ['signpost', `${TS}/clutter/signpost.png`, 0.6, true],
    ['hanging_sign', `${TS}/clutter/hanging_sign_1.png`, 0.6, true],
    ['grassclump', `${TS}/nature/grassclump1.png`, 0.6, true],
    ['pots', `${TS}/clutter/pots.png`, 0.5, true],
  ];
  for (const [name, url, scale, smooth] of singles) {
    const img = await loadImage(url);
    let c = scaled(img, img.width, img.height, scale, smooth);
    // Crop singles to their painted bounds (props are positioned by anchor).
    const b = bounds(c);
    const [cc, cctx] = canvasOf(b.right - b.left + 1, b.bottom - b.top + 1);
    cctx.drawImage(c, b.left, b.top, cc.width, cc.height, 0, 0, cc.width, cc.height);
    c = cc;
    await post(`single_${name}.png`, { base64: await toBase64(c) });
    manifest.singles[name] = { file: `single_${name}.png`, w: c.width, h: c.height, nearest: false };
    console.info(`[town] single ${name}: ${c.width}x${c.height}`);
  }

  // ---- single-direction anims -----------------------------------------------
  const anim1 = async (name: string, frames: HTMLCanvasElement[], nearest: boolean): Promise<void> => {
    const cellW = Math.max(...frames.map((f) => f.width));
    const cellH = Math.max(...frames.map((f) => f.height));
    const [c, ctx] = canvasOf(cellW * frames.length, cellH);
    let painted: Bounds | null = null;
    frames.forEach((f, i) => {
      ctx.drawImage(f, i * cellW + Math.floor((cellW - f.width) / 2), cellH - f.height);
      const b = bounds(f);
      painted = painted
        ? { top: Math.min(painted.top, b.top), bottom: Math.max(painted.bottom, b.bottom), left: Math.min(painted.left, b.left), right: Math.max(painted.right, b.right) }
        : b;
    });
    await post(`${name}.png`, { base64: await toBase64(c) });
    manifest.anims[name] = {
      file: `${name}.png`, cellW, cellH, frameCount: frames.length, dirCount: 1, nearest,
      origW: cellW, origH: cellH, trimX: 0, trimY: 0, scale: 1,
      painted: painted ?? { top: 0, bottom: cellH - 1, left: 0, right: cellW - 1 },
    };
    console.info(`[town] anim ${name}: ${frames.length}f ${cellW}x${cellH}`);
  };

  // Campfire: 216x48 palette sheet, 6 frames of 36x48, pixel art ×2.
  const camp = await loadImage(`${T}/campfire-Sheet.png`);
  await anim1('campfire', Array.from({ length: 6 }, (_, i) => scaled(camp, 36, 48, 2, false, i * 36, 0)), true);
  // Torch: 4 painted frames 128².
  const torches: HTMLCanvasElement[] = [];
  for (let i = 1; i <= 4; i++) { const im = await loadImage(`${TS}/torch/torch_${i}.png`); torches.push(scaled(im, im.width, im.height, 0.5, true)); }
  await anim1('torch', torches, false);
  // Well: 12 frames 83×103.
  const well: HTMLCanvasElement[] = [];
  for (let i = 0; i < 12; i++) { const im = await loadImage(`${T}/FreeSpritesDifferent/WellWork01/${String(i).padStart(3, '0')}.png`); well.push(scaled(im, im.width, im.height, 1.15, true)); }
  await anim1('well', well, false);

  // ---- villagers: coc_chars sheets, 8 cols × 12 rows of 64² (rows 0-7 = 8 walk dirs) ----
  const sheet8 = async (name: string, stem: string): Promise<void> => {
    // The palette PNG carries its own transparency index; the separate
    // "Alpha" sheets are faint edge masks and only speckle the result.
    const src = await loadImage(`${T}/coc_chars/${stem}.png`);
    const cell = 64, frames = 8, dirs = 8, up = 1.5;
    const [c, ctx] = canvasOf(cell * up * frames, cell * up * dirs);
    ctx.imageSmoothingEnabled = false;
    let painted: Bounds | null = null;
    for (let d = 0; d < dirs; d++)
      for (let f = 0; f < frames; f++) {
        ctx.drawImage(src, f * cell, d * cell, cell, cell, f * cell * up, d * cell * up, cell * up, cell * up);
        if (d === 4) {
          const [fc, fctx] = canvasOf(cell * up, cell * up);
          fctx.imageSmoothingEnabled = false;
          fctx.drawImage(src, f * cell, d * cell, cell, cell, 0, 0, cell * up, cell * up);
          const b = bounds(fc);
          painted = painted
            ? { top: Math.min(painted.top, b.top), bottom: Math.max(painted.bottom, b.bottom), left: Math.min(painted.left, b.left), right: Math.max(painted.right, b.right) }
            : b;
        }
      }
    await post(`${name}.png`, { base64: await toBase64(c) });
    manifest.anims[name] = {
      file: `${name}.png`, cellW: cell * up, cellH: cell * up, frameCount: frames, dirCount: dirs, nearest: true,
      origW: cell * up, origH: cell * up, trimX: 0, trimY: 0, scale: 1,
      painted: painted ?? { top: 0, bottom: cell * up - 1, left: 0, right: cell * up - 1 },
    };
    console.info(`[town] anim ${name}: 8 dirs × 8 frames`);
  };
  await sheet8('villager_walk', 'peasant');
  await sheet8('merchant_walk', 'peasantGold');

  await post('manifest.json', { text: JSON.stringify(manifest, null, 1) });
  console.info('[town] DONE');
}
