/**
 * @module core/OrientationManager
 * THE LAYOUT SPINE (it.63): one place that decides how big the play area is,
 * which way the device is held, and where the HUD hangs.
 *
 * WHY A MANAGER AND NOT MEDIA QUERIES: the canvas is not the page. In
 * PORTRAIT the crypt gets the upper ~62% and a gothic control pad takes the
 * rest, so the renderer must be sized to a box the CSS also has to agree
 * with. Both read the same source of truth — the custom properties this
 * manager writes (`--app-w`, `--app-h`, `--stage-h`, `--pad-h`,
 * `--hud-scale`) — so the DOM HUD and the WebGL stage can never disagree,
 * and a simulated viewport exercises exactly the same path as a real one.
 *
 * ROTATION IS LIVE: `screen.orientation`, `resize`, `visualViewport` and a
 * `matchMedia` listener all feed the same recompute. Nothing reloads,
 * nothing re-initialises, no input is dropped — the numbers spring to their
 * new values on a `dt * 12` lerp so the HUD glides to its new anchors while
 * the simulation keeps ticking underneath.
 */

export type Orientation = 'portrait' | 'landscape';
/** Size bands, smallest first. The tier drives HUD density, not the orientation. */
export type SizeTier = 'micro' | 'compact' | 'standard' | 'tablet' | 'desktop' | 'huge';

export interface LayoutState {
  /** Usable viewport in CSS pixels. */
  w: number;
  h: number;
  orientation: Orientation;
  tier: SizeTier;
  /** A touch-capable device (a pointer that is not a mouse). */
  touch: boolean;
  /** Chrome multiplier for the HUD's fixed furniture. */
  hudScale: number;
  /** Portrait: the control pad's height. Landscape: 0. */
  padH: number;
  /** The canvas box's height (h − padH). */
  stageH: number;
  /** Device safe-area insets (notches, home indicators). */
  safe: { top: number; right: number; bottom: number; left: number };
  /** The shorter edge — what actually limits a layout. */
  minEdge: number;
  aspect: number;
  /**
   * How far the resource globes scale down. In portrait the control cluster
   * owns the right of the pad, so the pair has to fit the strip left of it —
   * a ratio CSS cannot derive, because a length divided by a length is not a
   * number there.
   */
  orbScale: number;
}

type Listener = (s: LayoutState) => void;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The band a viewport falls in, judged on its SHORT edge (rotation-stable). */
export function tierFor(minEdge: number, maxEdge: number): SizeTier {
  if (minEdge < 330) return 'micro';
  if (minEdge < 400) return 'compact';
  if (minEdge < 600) return 'standard';
  if (minEdge < 900) return 'tablet';
  if (maxEdge >= 2400) return 'huge';
  return 'desktop';
}

export class OrientationManager {
  private readonly listeners = new Set<Listener>();
  private readonly reflowListeners = new Set<Listener>();
  private readonly abort = new AbortController();
  /** A forced viewport for the device matrix (QA). */
  private sim: { w: number; h: number; touch?: boolean } | null = null;
  private target!: LayoutState;
  /** What the page is actually showing — springs toward `target`. */
  private applied!: LayoutState;
  private raf = 0;
  private lastT = 0;
  private settled = true;

  constructor() {
    this.target = this.compute();
    this.applied = { ...this.target, safe: { ...this.target.safe } };
    this.write(this.applied, true);
    const { signal } = this.abort;
    const bump = (): void => this.recompute();
    window.addEventListener('resize', bump, { signal });
    window.addEventListener('orientationchange', bump, { signal });
    window.visualViewport?.addEventListener('resize', bump, { signal });
    try {
      screen.orientation?.addEventListener('change', bump, { signal });
    } catch {
      /* not every browser exposes screen.orientation */
    }
    // Coming back to a visible page mid-spring: finish it now.
    document.addEventListener(
      'visibilitychange',
      () => {
        if (!document.hidden && !this.settled) this.startSpring();
      },
      { signal },
    );
    const mq = window.matchMedia('(orientation: portrait)');
    // Safari < 14 only has the legacy listener API.
    if (mq.addEventListener) mq.addEventListener('change', bump, { signal });
    else mq.addListener?.(bump);
  }

  get state(): LayoutState {
    return this.applied;
  }

  get targetState(): LayoutState {
    return this.target;
  }

  get isPortrait(): boolean {
    return this.applied.orientation === 'portrait';
  }

  /** Discrete changes: orientation flips, tier crossings, touch appearing. */
  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Every animated frame of a reflow (the renderer resizes from here). */
  onReflow(fn: Listener): () => void {
    this.reflowListeners.add(fn);
    return () => this.reflowListeners.delete(fn);
  }

  /** QA / the device matrix: pretend the viewport is this big. */
  simulate(w: number, h: number, opts: { touch?: boolean } = {}): LayoutState {
    this.sim = { w, h, touch: opts.touch };
    document.body.classList.add('sim-viewport');
    this.recompute(true);
    return this.applied;
  }

  clearSimulation(): void {
    this.sim = null;
    document.body.classList.remove('sim-viewport');
    this.recompute(true);
  }

  get simulating(): boolean {
    return this.sim !== null;
  }

  /** Rotate the simulated viewport (or report what a rotation would give). */
  simulateRotate(): LayoutState {
    const cur = this.sim ?? { w: this.applied.w, h: this.applied.h, touch: undefined };
    return this.simulate(cur.h, cur.w, { touch: cur.touch });
  }

  // --- The computation ---------------------------------------------------------

  private compute(): LayoutState {
    const vv = window.visualViewport;
    const w = Math.round(this.sim?.w ?? vv?.width ?? window.innerWidth);
    const h = Math.round(this.sim?.h ?? vv?.height ?? window.innerHeight);
    const orientation: Orientation = h >= w ? 'portrait' : 'landscape';
    const minEdge = Math.min(w, h);
    const maxEdge = Math.max(w, h);
    const tier = tierFor(minEdge, maxEdge);
    const touch = this.sim?.touch ?? (navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches);

    // The HUD's furniture shrinks with the short edge and never overwhelms a
    // small screen; on very large ones it grows a little so it is not lost.
    const hudScale = clamp(
      orientation === 'portrait' ? minEdge / 430 : Math.min(h / 760, maxEdge / 1500),
      tier === 'micro' ? 0.5 : 0.58,
      1.35,
    );

    // PORTRAIT: the crypt keeps the top, the pad takes the bottom. The pad is
    // a share of the height, floored so thumbs always have room and capped so
    // the view never becomes a letterbox.
    // THE CONTROL PAD is a PHONE architecture. Held upright, a phone's lower
    // third is where the thumbs live, so the crypt takes the upper band and a
    // slate pad takes the rest. A tablet (or a pivoted monitor) held upright
    // is far too tall for that: a thumb's arc is the same few centimetres
    // whatever the glass, so a 35% band would waste half the screen. Above a
    // 600 px short edge the controls float over a full-height canvas instead.
    let padH = 0;
    if (orientation === 'portrait' && touch && minEdge < 600) {
      padH = Math.round(clamp(h * 0.35, 150, 340));
      padH = Math.min(padH, Math.round(h * 0.4));
      // A micro screen cannot hold three rows of 44 px targets inside 40%,
      // so the split evens out and the cluster carries a reduced set (see
      // the CSS for `tier-micro`).
      if (tier === 'micro') padH = Math.round(clamp(h * 0.52, 150, 220));
    }
    const stageH = Math.max(120, h - padH);

    // The globe pair is ~370 px of art at scale 1. With a pad, the cluster
    // takes max(200 px, 52%) of the width on the right, so the globes get
    // what is left of the dividing border.
    const clusterW = Math.max(200, w * 0.52);
    const orbScale = padH > 0 ? clamp((w - clusterW - 16) / 370, 0.3, 0.62) : 0.6;

    const cs = getComputedStyle(document.documentElement);
    const readInset = (name: string): number => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : 0;
    };
    return {
      w,
      h,
      orientation,
      tier,
      touch,
      hudScale,
      padH,
      stageH,
      minEdge,
      aspect: w / Math.max(1, h),
      orbScale,
      safe: {
        top: readInset('--sat'),
        right: readInset('--sar'),
        bottom: readInset('--sab'),
        left: readInset('--sal'),
      },
    };
  }

  private recompute(instant = false): void {
    // A hidden page has no rAF, so a spring there would leave the CSS numbers
    // frozen while the body classes already say "landscape". Nothing is on
    // screen to animate anyway: snap, and the page is correct the moment it
    // comes back.
    if (document.hidden) instant = true;
    const next = this.compute();
    const discrete =
      next.orientation !== this.target.orientation ||
      next.tier !== this.target.tier ||
      next.touch !== this.target.touch;
    this.target = next;
    if (instant) {
      this.applied = { ...next, safe: { ...next.safe } };
      this.write(this.applied, true);
      for (const fn of this.reflowListeners) fn(this.applied);
      for (const fn of this.listeners) fn(this.applied);
      return;
    }
    // Discrete parts (classes) switch at once; the numbers spring.
    this.applied.orientation = next.orientation;
    this.applied.tier = next.tier;
    this.applied.touch = next.touch;
    this.applied.safe = { ...next.safe };
    this.settled = false;
    this.startSpring();
    if (discrete) for (const fn of this.listeners) fn(this.applied);
  }

  /**
   * THE SPRING (it.63): `dt * 12` exponential damping. A rotation is a big
   * jump in every number at once, so easing them together is what makes the
   * HUD slide to its new anchors instead of snapping.
   */
  private startSpring(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(0.05, (now - this.lastT) / 1000);
      this.lastT = now;
      const k = 1 - Math.exp(-12 * dt);
      const a = this.applied;
      const t = this.target;
      a.w += (t.w - a.w) * k;
      a.h += (t.h - a.h) * k;
      a.padH += (t.padH - a.padH) * k;
      a.stageH += (t.stageH - a.stageH) * k;
      a.hudScale += (t.hudScale - a.hudScale) * k;
      a.orbScale += (t.orbScale - a.orbScale) * k;
      const done =
        Math.abs(t.w - a.w) < 0.6 &&
        Math.abs(t.h - a.h) < 0.6 &&
        Math.abs(t.padH - a.padH) < 0.6 &&
        Math.abs(t.hudScale - a.hudScale) < 0.002;
      if (done) {
        a.w = t.w;
        a.h = t.h;
        a.padH = t.padH;
        a.stageH = t.stageH;
        a.hudScale = t.hudScale;
        a.orbScale = t.orbScale;
        a.minEdge = t.minEdge;
        a.aspect = t.aspect;
      }
      this.write(a, false);
      for (const fn of this.reflowListeners) fn(a);
      if (done) {
        this.raf = 0;
        this.settled = true;
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  get isSettled(): boolean {
    return this.settled;
  }

  /** Publish the layout to CSS. Everything visual reads these. */
  private write(s: LayoutState, discrete: boolean): void {
    const root = document.documentElement.style;
    root.setProperty('--app-w', `${Math.round(s.w)}px`);
    root.setProperty('--app-h', `${Math.round(s.h)}px`);
    root.setProperty('--stage-h', `${Math.round(s.stageH)}px`);
    root.setProperty('--pad-h', `${Math.round(s.padH)}px`);
    root.setProperty('--hud-scale', s.hudScale.toFixed(3));
    root.setProperty('--orb-scale', s.orbScale.toFixed(3));
    if (discrete || true) {
      const b = document.body.classList;
      b.toggle('orient-portrait', s.orientation === 'portrait');
      b.toggle('orient-landscape', s.orientation === 'landscape');
      b.toggle('input-touch', s.touch);
      b.toggle('has-pad', s.padH > 1);
      for (const t of ['micro', 'compact', 'standard', 'tablet', 'desktop', 'huge']) b.toggle(`tier-${t}`, s.tier === t);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.listeners.clear();
    this.reflowListeners.clear();
  }
}

/** Shared instance — created at boot, before the renderer. */
export const layout = new OrientationManager();
