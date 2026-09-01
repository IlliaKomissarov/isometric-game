# Skill: Fixed Timestep with Render Interpolation

## What & why
Glenn Fiedler's "Fix Your Timestep!" pattern (gafferongames.com): the
simulation advances in constant `FIXED_DT = 1/60 s` increments accumulated
from real frame time; rendering runs at display rate and interpolates between
the last two simulation states by `alpha = accumulator / FIXED_DT`.

## Problem it solved
1. **Determinism** — identical command streams must replay to identical
   states on every peer (4-player lockstep co-op). Variable dt makes floating
   point results machine/framerate dependent; fixed dt removes the variable.
2. **Smoothness on 144 Hz+ displays** without running physics faster.
3. **Spiral of death** after background-tab stalls — frame time is clamped to
   `MAX_FRAME_TIME = 0.25 s`.

## Implementation (`src/core/GameLoop.ts`, consumed in `src/main.ts`)
- Entities keep `prevPos` (copied in `beginTick()`) and `pos`; render uses
  `lerp(prevPos, pos, alpha)` (`Entity.syncRender`).
- Pixi's autonomous ticker is **stopped** (`app.ticker.stop()`); the loop
  calls `app.renderer.render(app.stage)` itself. One frame authority only.
- The camera also consumes the interpolated position, so follow is judder-free.

## Guidelines for sub-agents
- Gameplay logic goes in the `update(dt, tick)` phase ONLY. Visual-only
  effects (bobbing, particles, tweens) may run in render code but must not
  touch simulation fields.
- Never call `performance.now()` / `Math.random()` inside simulation logic —
  it breaks determinism. Use the tick counter and seeded PRNGs
  (`mulberry32`, see DungeonGenerator).
- New per-entity visual state that depends on sim position must interpolate
  via the entity's `prevPos`/`pos` pair, not read `pos` raw.
