/**
 * @module core/GameLoop
 * Fixed-timestep simulation loop with render interpolation.
 *
 * Simulation advances in deterministic FIXED_DT increments (required for the
 * future 4-player lockstep/rollback co-op model). Rendering runs at display
 * refresh rate and receives an interpolation alpha in [0, 1) so visuals stay
 * smooth between simulation ticks.
 *
 * Pattern reference: Glenn Fiedler, "Fix Your Timestep!" — see
 * /docs/skills/fixed-timestep.md
 */

import { FIXED_DT, MAX_FRAME_TIME } from './config';

export interface LoopCallbacks {
  /** Deterministic simulation step. `tick` is the monotonically increasing step index. */
  update: (dt: number, tick: number) => void;
  /** Render step. `alpha` is interpolation fraction between previous and current sim state. */
  render: (alpha: number) => void;
}

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private rafId = 0;
  private _tick = 0;
  /**
   * LOCKSTEP GATE (it.59): when set, a tick executes only if the gate says
   * its frame is known. A closed gate drops the accumulator instead of
   * banking time — the party never "catches up" in a burst.
   */
  gate: ((tick: number) => boolean) | null = null;
  /**
   * HIDDEN-TAB CLOCK (it.59): browsers pause requestAnimationFrame in a
   * background tab, which would stall a lockstep party the moment one player
   * alt-tabs. With this on, a Web Worker (whose timers are not throttled)
   * drives the fixed steps while the tab is hidden; rAF takes over again on
   * return. Rendering is skipped while hidden.
   */
  keepAliveHidden = false;
  private worker: Worker | null = null;
  private frame: ((now: number) => void) | null = null;

  constructor(private readonly callbacks: LoopCallbacks) {}

  /** Current simulation tick index (deterministic, serializable). */
  get tick(): number {
    return this._tick;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      let frameTime = (now - this.lastTime) / 1000;
      this.lastTime = now;
      // Clamp to avoid the spiral of death after a background-tab stall.
      if (frameTime > MAX_FRAME_TIME) frameTime = MAX_FRAME_TIME;

      this.accumulator += frameTime;
      while (this.accumulator >= FIXED_DT) {
        if (this.gate && !this.gate(this._tick)) {
          this.accumulator = 0;
          break;
        }
        this.callbacks.update(FIXED_DT, this._tick);
        this._tick++;
        this.accumulator -= FIXED_DT;
      }
      if (!document.hidden) this.callbacks.render(this.accumulator / FIXED_DT);
      if (!document.hidden || !this.worker) this.rafId = requestAnimationFrame(frame);
    };
    this.frame = frame;
    this.rafId = requestAnimationFrame(frame);
    if (this.keepAliveHidden && !this.worker) this.startWorkerClock();
  }

  private startWorkerClock(): void {
    try {
      const src = 'setInterval(() => postMessage(0), 16);';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = () => {
        if (!this.running || !document.hidden || !this.frame) return;
        this.frame(performance.now());
      };
      // Back in the foreground: hand the clock back to rAF.
      document.addEventListener('visibilitychange', this.onVisibility);
    } catch {
      this.worker = null; // No worker: the tab simply pauses when hidden.
    }
  }

  private readonly onVisibility = (): void => {
    if (!this.running || document.hidden || !this.frame) return;
    cancelAnimationFrame(this.rafId);
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  };

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }

  /**
   * Manually advance N fixed ticks and render the result, ignoring the wall
   * clock. Deterministic driver for automated tests and future replay
   * tooling (rAF pauses in occluded windows — this does not).
   */
  step(count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.gate && !this.gate(this._tick)) break;
      this.callbacks.update(FIXED_DT, this._tick);
      this._tick++;
    }
    this.callbacks.render(1);
  }
}
