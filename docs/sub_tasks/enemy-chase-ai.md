# Sub-Task: Enemy Aggro & Chase AI

## Goal
Enemies notice the player within 6 tiles (line of sight required), chase via
the shared Pathfinder, and stop adjacent (melee range) — no attacking yet
unless combat-basic-melee is merged.

## Files you may touch
- `src/entities/Enemy.ts` (add AI state machine: idle / chase)
- `src/main.ts` (pass Pathfinder + player reference into EnemyPool/Enemy update wiring)
- `docs/checklist.md`, `docs/development_log.md`

## Design constraints
- **Throttle pathfinding**: re-path only when the player's tile changed since
  the last path AND at most every 30 ticks. See
  `/docs/skills/astar-binary-heap.md`.
- LOS check via `hasLineOfSight` (`src/utils/los.ts`) with
  `SceneManager.isOpaque` — do not duplicate fog logic.
- Movement uses `moveWithCollision` at 60% of PLAYER_SPEED; all decisions in
  `update(dt)` (fixed tick) only.
- Aggro state is simulation state → must be added to `EntitySnapshot` if it
  affects behavior (it does: add `aiState?: 'idle' | 'chase'`).

## Acceptance
- Walk near a dummy → it chases; break LOS long enough (3 s) → it gives up
  and idles in place. No console errors, typecheck clean, framerate stable
  with all dummies chasing simultaneously.
