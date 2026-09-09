/**
 * @module core/PerformanceScaler
 * THE FRAME BUDGET (it.63): keep 60 FPS on whatever the game lands on.
 *
 * A rolling 60-frame average decides one thing — the renderer's buffer
 * RESOLUTION. On a 4K phone a 2× buffer means four times the pixels for the
 * same picture; dropping to 1× (or 0.75× on the weakest hardware) is the
 * cheapest possible win and costs almost nothing visually, because the HUD
 * is DOM text that keeps rendering at the device's true resolution either
 * way.
 *
 * The ladder is walked with hysteresis: a full second under budget steps
 * down, three seconds comfortably over budget steps back up, and a step is
 * never taken twice inside two seconds. Without that a scaler oscillates,
 * which reads far worse than a steady lower resolution.
 *
 * `quality` also tells the atmosphere how much it may spend — the title's
 * ember and fog counts read it, so a weak device gets a calm sky instead of
 * a slideshow.
 */

import type { Application } from 'pixi.js';

export type Quality = 'high' | 'medium' | 'low';

/**
 * The rungs BELOW the device's own ratio. The top rung is always the device
 * itself - see `attach`.
 *
 * IT.105: this used to be a fixed `[2, 1.5, 1, 0.75]` that the start rung was
 * SEARCHED in with `findIndex(r => r <= ceiling)`. On any display whose ratio is
 * not exactly on the ladder that silently threw resolution away for ever: a
 * 1.25x screen (a very common Windows scaling) started at rung `1`, so the game
 * rendered at 80% of native and was upscaled to fill the window, on every
 * machine, from the first frame, with the budget nowhere near spent. That is
 * what "all the models look blurry" was - not the art, and not the load.
 */
const BELOW = [1.5, 1, 0.75];
const WINDOW = 60;
/** 60 FPS is 16.7 ms. Over SLOW and we are missing frames; under FAST there is room to spare. */
const SLOW_MS = 20.5;
const FAST_MS = 13.8;
const STEP_COOLDOWN_MS = 2000;

export class PerformanceScaler {
  private app: Application | null = null;
  private readonly samples: number[] = [];
  private cursor = 0;
  private last = 0;
  private raf = 0;
  private step = 0;
  private slowFor = 0;
  private fastFor = 0;
  private lastStepAt = 0;
  private ceiling = 2;
  /** The resolution rungs for THIS device, richest first (built in `attach`). */
  private ladder: number[] = [...BELOW];
  private running = false;
  /** Off means the ladder is frozen where it stands (a QA / settings switch). */
  auto = true;

  /** Attach at boot, after the renderer exists. */
  attach(app: Application): void {
    this.app = app;
    this.ceiling = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    // THE TOP RUNG IS THE DEVICE (it.105). Whatever the screen's ratio is, that
    // is what the game starts at and returns to; the ladder below it is the
    // usual steps down, minus any rung that is not actually a step down.
    this.ladder = [this.ceiling, ...BELOW.filter((r) => r < this.ceiling - 1e-6)];
    if (this.ladder.length === 1) this.ladder.push(this.ceiling * 0.75);
    this.step = 0;
    this.start();
  }

  start(): void {
    if (this.running || !this.app) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      const dt = now - this.last;
      this.last = now;
      // A tab that was hidden hands back one enormous frame — never sample it.
      if (dt > 0 && dt < 200) {
        this.samples[this.cursor % WINDOW] = dt;
        this.cursor++;
        if (this.cursor >= WINDOW && this.auto) this.judge(now);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Rolling mean frame time in ms (0 before the window fills). */
  get frameMs(): number {
    if (!this.samples.length) return 0;
    let sum = 0;
    for (const s of this.samples) sum += s;
    return sum / this.samples.length;
  }

  get fps(): number {
    const ms = this.frameMs;
    return ms > 0 ? 1000 / ms : 0;
  }

  get resolution(): number {
    return Math.min(this.ladder[this.step], this.ceiling);
  }

  /**
   * Quality is the RUNG, not the absolute number (it.105). Reading it off the
   * resolution meant a 1x display was permanently "medium" and a 1.25x one too -
   * a calm sky and no colour grade on hardware that was keeping 60 fps with room
   * to spare. The top rung is what the device can do; that is `high`.
   */
  get quality(): Quality {
    if (this.step === 0) return 'high';
    return this.step === 1 ? 'medium' : 'low';
  }

  /** How much atmosphere the device can afford (a multiplier on particle counts). */
  get particleBudget(): number {
    return this.quality === 'high' ? 1 : this.quality === 'medium' ? 0.6 : 0.25;
  }

  private judge(now: number): void {
    const ms = this.frameMs;
    if (ms > SLOW_MS) {
      this.slowFor += ms;
      this.fastFor = 0;
    } else if (ms < FAST_MS) {
      this.fastFor += ms;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    if (now - this.lastStepAt < STEP_COOLDOWN_MS) return;
    if (this.slowFor > 1000 && this.step < this.ladder.length - 1) {
      this.step++;
      this.applyResolution(now);
    } else if (this.fastFor > 3000 && this.step > 0 && this.ladder[this.step - 1] <= this.ceiling) {
      this.step--;
      this.applyResolution(now);
    }
  }

  private applyResolution(now: number): void {
    this.lastStepAt = now;
    this.slowFor = 0;
    this.fastFor = 0;
    this.samples.length = 0;
    this.cursor = 0;
    this.setResolution(this.resolution);
  }

  /** Resize the buffer without touching the CSS size the canvas occupies. */
  setResolution(res: number): void {
    const app = this.app;
    if (!app) return;
    try {
      app.renderer.resize(app.screen.width, app.screen.height, res);
      for (const fn of this.listeners) fn(this.quality);
    } catch (err) {
      console.warn('[perf] resolution change refused:', err);
    }
  }

  /** Force a rung for testing; `null` hands control back to the scaler. */
  force(res: number | null): void {
    if (res === null) {
      this.auto = true;
      return;
    }
    this.auto = false;
    const i = this.ladder.indexOf(res);
    this.step = i >= 0 ? i : this.step;
    this.setResolution(res);
  }

  private readonly listeners = new Set<(q: Quality) => void>();
  onQuality(fn: (q: Quality) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const perf = new PerformanceScaler();
