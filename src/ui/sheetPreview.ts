/**
 * @module ui/sheetPreview
 * A LIVING PORTRAIT FROM AN ATLAS STRIP (it.115). The bestiary and the
 * menagerie's picker both show a creature breathing in a DOM card, straight
 * from the baked PNG (no Pixi, no atlas residency).
 *
 * The it.42 bestiary scaled the whole atlas cell with a CSS transform, read
 * the row "facing south" off a direction table that was wrong for eleven
 * packs (backs to the camera), and stepped every idle at 7 fps whatever its
 * length. Here:
 *   - the row is `rowForDir(anim, 6)` after the it.115 facing audit;
 *   - the sprite is sized with `background-size`, so the layout box IS the
 *     picture, and it is placed so the clip's CALIBRATED feet sit on the
 *     card's ground line and its painted centre over the card's centre;
 *   - it is scaled by the same yardstick the rig uses (`rigHeight`), so a
 *     brute is taller than a ghast in the grid as on the sand;
 *   - one shared ticker steps every visible preview: a long idle at 6 fps, a
 *     short one ping-ponged at 3 - a calm breath, not a twitch;
 *   - the atlas image is only requested once the card scrolls into view.
 */

import { atlasUrl, rowForDir, spriteLib } from '@/render/SpriteLibrary';

export interface PreviewSpec {
  /** The clip to animate (usually the idle). */
  anim: string;
  /** The rig's yardstick sheets: idle, walk, attack. */
  idle?: string;
  walk: string;
  attack?: string;
  /** Standard height x flavour, in hero pixels (56 = the hero). */
  height: number;
}

interface Live {
  el: HTMLElement;
  frames: number;
  fps: number;
  pingPong: boolean;
  step: number;
  shown: number;
  phase: number;
}

const live = new Set<Live>();
let ticker: number | null = null;
const t0 = performance.now();
let observer: IntersectionObserver | null = null;

function tick(): void {
  const t = (performance.now() - t0) / 1000;
  for (const l of live) {
    if (!l.el.isConnected) {
      live.delete(l);
      continue;
    }
    let f: number;
    if (l.pingPong) {
      const cycle = l.frames * 2 - 2;
      const i = Math.floor(t * l.fps + l.phase) % Math.max(1, cycle);
      f = i < l.frames ? i : cycle - i;
    } else f = Math.floor(t * l.fps + l.phase) % l.frames;
    if (f !== l.shown) {
      l.shown = f;
      const y = l.el.dataset.row ?? '0';
      l.el.style.backgroundPosition = `${-f * l.step}px ${y}px`;
    }
  }
  if (!live.size && ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

function lazy(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === 'undefined') return observer;
  observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target as HTMLElement;
      if (el.dataset.src) {
        el.style.backgroundImage = `url(${el.dataset.src})`;
        delete el.dataset.src;
      }
      observer?.unobserve(el);
    }
  }, { rootMargin: '200px' });
  return observer;
}

/**
 * The preview's HTML (an absolutely positioned div for a `position:relative`
 * stage of `stageW` x `stageH` with its ground line `groundFromBottom` px up).
 * Call `animatePreviews(root)` after it is in the DOM. Returns '' when the
 * sheet is unknown.
 */
export function previewHtml(spec: PreviewSpec, stageW: number, stageH: number, groundFromBottom = 10, extraStyle = ''): string {
  const e = spriteLib.entry(spec.anim);
  if (!e) return '';
  const ref = spriteLib.rigHeight(spec.idle, spec.walk, spec.attack) || e.painted.bottom - e.painted.top + 1;
  // Original px -> CSS px. Never taller than the stage allows.
  let k = spec.height / ref;
  const tallest = (spriteLib.feetY(spec.anim) - e.painted.top) * k;
  const room = stageH - groundFromBottom - 6;
  if (tallest > room) k *= room / tallest;
  const wide = (e.painted.right - e.painted.left + 1) * k;
  if (wide > stageW - 6) k *= (stageW - 6) / wide;
  const a = k / e.scale; // atlas px -> CSS px
  const cw = e.cellW * a;
  const ch = e.cellH * a;
  const row = e.dirCount === 8 ? rowForDir(spec.anim, 6) : 0;
  const cx = (e.painted.left + e.painted.right + 1) / 2;
  const left = stageW / 2 - (cx - e.trimX) * k;
  const top = stageH - groundFromBottom - (spriteLib.feetY(spec.anim) - e.trimY) * k;
  const frames = e.useFrames ? Math.min(e.frameCount, e.useFrames) : e.frameCount;
  const fps = frames <= 6 ? 3 : 6;
  return `<div class="sheet-pv" data-frames="${frames}" data-fps="${fps}" data-step="${cw.toFixed(2)}" data-row="${(-row * ch).toFixed(2)}" data-src="${atlasUrl(e.file)}" style="position:absolute;left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${cw.toFixed(1)}px;height:${ch.toFixed(1)}px;background-repeat:no-repeat;background-size:${(e.cellW * e.frameCount * a).toFixed(1)}px ${(e.cellH * e.dirCount * a).toFixed(1)}px;background-position:0px ${(-row * ch).toFixed(2)}px;${e.nearest ? 'image-rendering:pixelated;' : ''}${extraStyle}"></div>`;
}

/** Start every `.sheet-pv` under `root` breathing (and loading when seen). */
export function animatePreviews(root: ParentNode): void {
  const io = lazy();
  root.querySelectorAll<HTMLElement>('.sheet-pv').forEach((el, i) => {
    if (el.dataset.src) {
      if (io) io.observe(el);
      else {
        el.style.backgroundImage = `url(${el.dataset.src})`;
        delete el.dataset.src;
      }
    }
    const frames = Number(el.dataset.frames ?? '1');
    if (frames <= 1) return;
    live.add({ el, frames, fps: Number(el.dataset.fps ?? '6'), pingPong: frames <= 6, step: Number(el.dataset.step ?? '0'), shown: -1, phase: (i * 0.37) % frames });
  });
  if (live.size && ticker === null) ticker = window.setInterval(tick, 50);
}
