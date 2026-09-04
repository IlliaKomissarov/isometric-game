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
  /**
   * Only manage this panel on small or touch screens, centring it while
   * managed. A desktop keeps the panel exactly where its own CSS puts it —
   * the inventory is a side panel there, not a centred sheet.
   */
  responsive?: boolean;
}

interface Entry extends Required<Omit<FitOptions, 'base' | 'responsive'>> {
  el: HTMLElement;
  base: string;
  responsive: boolean;
}

class FitScaler {
  private readonly entries: Entry[] = [];
  private raf = 0;
  /**
   * A fit toggles a class, the class-observer schedules a fit, and on a
   * hidden page `schedule` runs synchronously — so without this guard one
   * pass re-enters itself until the tab locks up. Found the hard way.
   */
  private busy = false;

  constructor() {
    layout.onReflow(() => this.schedule());
    window.addEventListener('resize', () => this.schedule());
    // THE HEARTBEAT: a panel can open from a key, a thumb, a click or a run
    // event, and chasing every one of those is how a case gets missed. Two
    // passes a second catch them all; a pass over a handful of panels that
    // are already correct costs a few reads and writes nothing.
    window.setInterval(() => this.refresh(), 450);
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
      responsive: opts.responsive ?? false,
    };
    // NO OBSERVERS HERE, deliberately. A fit writes a transform and toggles a
    // class; both change the element, so a ResizeObserver or a class
    // MutationObserver would schedule the next fit from inside the effects of
    // the last one. On a hidden page, where `schedule()` runs synchronously,
    // that loop never yields and the tab locks up — a re-entrancy flag does
    // not help, because the calls are sequential rather than nested. Fits are
    // driven instead by the layout, by window resizes, by the openers, and by
    // a cheap heartbeat below.
    this.entries.push(entry);
    this.apply(entry);
  }

  remove(el: HTMLElement): void {
    const i = this.entries.findIndex((e) => e.el === el);
    if (i < 0) return;
    this.entries[i].el.style.removeProperty('transform');
    this.entries.splice(i, 1);
  }

  /** Re-fit everything on the next frame (coalesced). */
  schedule(): void {
    if (this.busy) return; // A pass is already running; it will see this change.
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
    if (this.busy) return;
    this.busy = true;
    try {
      for (const e of this.entries) this.apply(e);
    } finally {
      this.busy = false;
    }
  }

  private apply(e: Entry): void {
    const el = e.el;
    const s0 = layout.state;
    const release = (): void => {
      if (!el.classList.contains('fit-centred')) return;
      el.classList.remove('fit-centred');
      el.style.removeProperty('transform');
      el.style.removeProperty('--fit-scale');
    };
    // A roomy pointer-driven screen keeps the panel's own CSS placement: the
    // inventory is a draggable side panel there, not a centred sheet.
    if (e.responsive && !(s0.touch || s0.minEdge < 560)) {
      release();
      return;
    }
    // The natural size is the CONTENT's size. `offsetWidth` alone lies when a
    // flex or grid parent has already clamped the box while its children
    // overflow it — the panel would then be scaled to a width it does not
    // actually occupy, and still spill. `scrollWidth` sees the overflow.
    const natW = Math.max(el.scrollWidth, el.offsetWidth);
    const natH = Math.max(el.scrollHeight, el.offsetHeight);
    // A closed panel measures zero. Centring it now and scaling it only when
    // it opens would leave it half a panel off-centre in between, so the
    // class and the transform are always applied together.
    if (natW < 2 || natH < 2) {
      release();
      return;
    }
    if (e.responsive) el.classList.add('fit-centred');
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
