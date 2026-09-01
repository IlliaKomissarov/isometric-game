# Sub-Task Specifications — Contract for Downstream Agents

Each file in this directory is a **self-contained micro-task** scoped so a
smaller agent can execute it without touching core architecture.

## Rules every sub-agent MUST follow

1. **Stay inside the listed "Files you may touch."** If the task seems to
   require editing anything else, STOP and report back instead of improvising.
2. **Read the linked skill docs first** (`/docs/skills/`) — they encode
   hard-won constraints (determinism, projection, pooling).
3. **Simulation purity:** no `Math.random()` / `performance.now()` /
   DOM reads inside fixed-tick logic. Visual-only effects are exempt.
4. **Communicate via the EventBus** (`src/core/EventBus.ts`). Add new events
   to the `GameEvents` interface — never use string literals ad hoc.
5. **Spatial queries** go through `SceneManager.isWalkable` / `isOpaque` and
   `FogOfWar.isVisible`. Never read the tile grid or fog sprites directly.
6. **Verify before finishing:** `npm run typecheck` must pass with zero
   errors, and `npm run dev` must boot with a clean browser console.
7. **Log your work:** append a dated entry to `/docs/development_log.md` and
   tick the box in `/docs/checklist.md`.

## Sub-task board

| Spec | Est. size | Status |
| --- | --- | --- |
| `combat-basic-melee.md` | M | ✅ done 2026-08-31 (superseded by the full D1 combat model) |
| `enemy-chase-ai.md` | M | ✅ done 2026-08-31 (three archetypes + flee/kite) |
| `item-tooltip.md` | S | ✅ done 2026-08-31 (folded into `ui/Inventory.ts`) |
| `minimap.md` | S | ✅ done 2026-08-31 (`ui/Minimap.ts`, M toggle, stairs marker) |
| `sound-effect-triggers.md` | S | open — event list has grown: see `EventBus.GameEvents` |
| `health-potions.md` | S | open |
| `gamepad-support.md` | S | open — command layer is ready for it |
| `floor-themes.md` | M | open |

## System blueprints (read before touching a pillar)

| System | Owner modules | Skill doc |
| --- | --- | --- |
| Combat state machine & rolls | `systems/Combat.ts`, `entities/Entity.ts` (action fields) | `skills/diablo-combat-model.md` |
| Controls & command flow | `core/InputBindings.ts`, `core/InputQueue.ts` | `skills/hybrid-action-controls.md` |
| Animation & feedback | `entities/Player.ts` / `Enemy.ts` syncRender, `engine/Ambience.ts` | `skills/animation-weight-and-impact.md` |
| Lighting & fog | `engine/Lighting.ts` | `skills/tile-lightmap-and-cutaway.md` |
| Projectiles | `systems/Projectiles.ts` (faction/kind model; rolls stay in Combat) | `skills/diablo-combat-model.md` |
| Items & paperdoll | `items/catalog.ts` (data + `overlayTextureFor` + WEAPON_TIMING), `entities/Player.ts` | — |
| World lifecycle | `main.ts` buildWorld/destroyWorld (per-floor teardown contract) | — |
| External sprites | `render/SpriteLibrary.ts` (manifest, dir mapping, slicing) | `skills/external-sprite-pipeline.md` |
| Chests & interactables | `systems/Chests.ts` (place/pick/open + approach via OPEN_CHEST) | — |
