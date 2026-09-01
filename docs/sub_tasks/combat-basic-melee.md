# Sub-Task: Basic Melee Combat

## Goal
Left-clicking an enemy makes the player approach into melee range (1.2 tiles)
and swing on a cooldown, dealing damage through `CombatSystem.dealDamage`.

## Files you may touch
- `src/systems/Combat.ts` (extend — keep `dealDamage` as the sole hp mutator)
- `src/systems/Movement.ts` (handle the existing `ATTACK` command case)
- `src/core/InputBindings.ts` (hit-test enemies on pointerdown before falling
  back to MOVE_TO)
- `src/entities/Enemy.ts` (hit reaction visual only)
- `docs/checklist.md`, `docs/development_log.md`

## Design constraints
- Attack intent must flow as an `ATTACK` InputCommand (already defined in
  `src/core/InputQueue.ts`) — determinism rule, see
  `/docs/skills/fixed-timestep.md`.
- Enemy picking: iterate `EnemyPool.forEachActive`, pick the nearest enemy
  whose feet position is within 0.6 world units of the click; only if
  `fog.isVisible` on its tile.
- Damage numbers/bars are OUT of scope (separate task). Emitting the existing
  `entity:damaged` event is IN scope.
- Warrior baseline: 12 damage, 0.8 s swing cooldown (tick-counted: 48 ticks).

## Acceptance
- Click enemy → player paths adjacent → swings → enemy hp drops → at 0 hp the
  enemy despawns via `EnemyPool.kill` and `entity:died` fires.
- Clicking ground still walks normally. `npm run typecheck` clean.
