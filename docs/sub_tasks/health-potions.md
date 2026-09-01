# Sub-Task: Health Potions

## Goal
Restore the classic loop: enemies drop potions, potions stack in the
backpack, Q (or clicking the orb) drinks one for an instant heal with a
satisfying red flash on the orb.

## Files you may touch
- `src/items/catalog.ts` — add a `consumable` item category (potion def:
  heals 40). Keep ItemDef backward-compatible (optional `heal?: number`).
- `src/systems/Loot.ts` — potions join the drop table (~25% of drops).
- `src/core/InputQueue.ts` — add `{ type: 'DRINK'; playerId }`.
- `src/core/InputBindings.ts` — Q enqueues DRINK.
- `src/systems/Inventory.ts` — handle DRINK: consume first potion in the
  backpack, heal via a NEW CombatSystem method `heal(targetId, amount)`
  (hp may never be written outside CombatSystem).
- `src/systems/Combat.ts` — add `heal()` (clamp to hpMax, emit a new
  `entity:healed` event on the bus).
- `src/ui/Inventory.ts` — potions render with a count; `index.html` —
  COMMANDS row for Q.
- `docs/checklist.md`, `docs/development_log.md`.

## Constraints
- DRINK must ride the InputQueue (co-op determinism).
- Orb flash on heal: subscribe to `entity:healed` in main — CSS class pulse.
- Ground potion glyph: reuse the `glow` texture, red tint, small scale.

## Acceptance
Kill enemies until a potion drops, pick it up, Q heals +40 (clamped), count
decrements, orb pulses. Typecheck clean, no console errors.
