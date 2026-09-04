/**
 * @module ui/FitScaler
 * CONTAIN-FIT FOR PANELS (it.64): no window may ever be cropped.
 *
 * A panel is laid out at its natural size and then scaled to fit, exactly
 * the way `object-fit: contain` treats an image:
 *
 *     scale = min(1, availW / naturalW, availH / naturalH)
 *
 * `offsetWidth` / `offsetHeight` are read for the natural size because a CSS
 * transform does not affect them — the measurement stays stable no matter
 * what scale is already applied, so this can never spiral.
 *
 * The available box is a share of the layout's viewport (90% by default),
 * which comes from the OrientationManager rather than `vh` units, so a
 * simulated device and a real one behave identically and a mobile browser's
 * disappearing address bar cannot shift the maths.
 *
 * A floor (`minScale`) stops a long window from shrinking into unreadable
 * mist; below it the panel keeps its own `overflow: auto` and scrolls.
 */

import { layout } from '@/core/OrientationManager';

export interface FitOptions {
  /** Share of the viewport the panel may occupy (0..1). */
  max?: number;
  /** Never enlarge past this. */
  maxScale?: number;
  /** Never shrink past this; the panel scrolls instead. */
  minScale?: number;
  /** A transform applied BEFORE the scale (e.g. a centring translate). */
  base?: string;
}

interface Entry extends Required<Omit<FitOptions, 'base'>> {
  el: HTMLElement;
  base: string;
  ro: ResizeObserver | null;
}

class FitScaler {
  private readonly entries: Entry[] = [];
  private raf = 0;

  constructor() {
    layout.onReflow(() => this.schedule());
    window.addEventListener('resize', () => this.schedule());
  }

  /**
   * Register a panel. `base` must carry any transform the layout already
   * relies on (a centring `translate(-50%, -50%)`), because the scale is
   * appended to it rather than replacing it.
   */
  add(el: HTMLElement | null, opts: FitOptions = {}): void {
    if (!el || this.entries.some((e) => e.el === el)) return;
    const entry: Entry = {
      el,
      max: opts.max ?? 0.9,
      maxScale: opts.maxScale ?? 1,
      minScale: opts.minScale ?? 0.5,
      base: opts.base ?? '',
      ro: null,
    };
    // A panel that re-renders (the tree, the shop) changes size under us.
    if (typeof ResizeObserver !== 'undefined') {
      entry.ro = new ResizeObserver(() => this.schedule());
      entry.ro.observe(el);
    }
    this.entries.push(entry);
    this.apply(entry);
  }

  remove(el: HTMLElement): void {
    const i = this.entries.findIndex((e) => e.el === el);
    if (i < 0) return;
    this.entries[i].ro?.disconnect();
    this.entries[i].el.style.removeProperty('transform');
    this.entries.splice(i, 1);
  }

  /** Re-fit everything on the next frame (coalesced). */
  schedule(): void {
    // A hidden page never runs rAF, and a panel opened while hidden would
    // then be measured but never scaled. Nothing is on screen to batch for:
    // fit it now.
    if (document.hidden) {
      this.refresh();
      return;
    }
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.refresh();
    });
  }

  refresh(): void {
    for (const e of this.entries) this.apply(e);
  }

  private apply(e: Entry): void {
    const el = e.el;
    // Nothing to measure while it is display:none — its own opener re-fits.
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
    // The natural size is the CONTENT's size. `offsetWidth` alone lies when a
    // flex or grid parent has already clamped the box while its children
    // overflow it — the panel would then be scaled to a width it does not
    // actually occupy, and still spill. `scrollWidth` sees the overflow.
    const natW = Math.max(el.scrollWidth, el.offsetWidth);
    const natH = Math.max(el.scrollHeight, el.offsetHeight);
    if (natW < 2 || natH < 2) return;
    const s = layout.state;
    const availW = s.w * e.max;
    const availH = s.h * e.max;
    const scale = Math.max(e.minScale, Math.min(e.maxScale, availW / natW, availH / natH));
    const next = e.base ? `${e.base} scale(${scale.toFixed(4)})` : `scale(${scale.toFixed(4)})`;
    if (el.style.transform !== next) el.style.transform = next;
    el.style.setProperty('--fit-scale', scale.toFixed(4));
  }
}

export const fit = new FitScaler();
