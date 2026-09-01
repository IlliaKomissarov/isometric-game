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
        this.callbacks.update(FIXED_DT, this._tick);
        this._tick++;
        this.accumulator -= FIXED_DT;
      }
      this.callbacks.render(this.accumulator / FIXED_DT);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /**
   * Manually advance N fixed ticks and render the result, ignoring the wall
   * clock. Deterministic driver for automated tests and future replay
   * tooling (rAF pauses in occluded windows — this does not).
   */
  step(count: number): void {
    for (let i = 0; i < count; i++) {
      this.callbacks.update(FIXED_DT, this._tick);
      this._tick++;
    }
    this.callbacks.render(1);
  }
}
