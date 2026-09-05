# Skill: classic ARPG Combat Model (Animated Actions, To-Hit, Hit Recovery)

## What & why
The user's verdict on cooldown-timer combat: "it doesn't look like a combat
system at all." What makes classic ARPG's melee feel real is that attacks are
**animated actions with commitment**, resolved probabilistically:

1. **Windup → strike frame → recovery.** Damage happens at ONE frame of the
   animation, not when the button is pressed. Because range is re-checked at
   the strike frame, telegraphed attacks are dodgeable — step out of a
   zombie's 40-tick windup and it whiffs.
2. **To-hit rolls.** Attacks miss (player 80%, monsters 65–72% base). Misses
   read as a grey whiff arc; hits as warm; crits (10%, ×2) as fiery + bigger.
3. **Damage ranges** (weapon min–max), never fixed numbers.
4. **Hit recovery / stunlock.** A hit ≥ threshold (4 post-armor) interrupts
   the victim into a flinch for their per-type recovery ticks. Fast hits can
   chain-stagger a Fallen (24-tick recovery); a Zombie (6) barely notices.
5. **Knockback** on hits (bigger on crits), wall-collision-checked.

## Implementation map
- `src/systems/Combat.ts` — the state machine + ALL rolls (seeded stream:
  identical kill order ⇒ identical outcomes on every peer). `dealDamage`
  stays the single hp mutator; `enemyStrike`/`projectileHit` are the
  monster-side entry points.
- `src/entities/Entity.ts` — `action` ('idle'|'attack'|'hit'|'dead'),
  `actionTicks`, `facing`, `hitRecoveryTicks`.
- `src/entities/Enemy.ts` — per-type action machines; ENEMY_TYPES data
  (fallen/zombie/archer): windup/recover/reach/stun/speed/flee/kite.
- `src/systems/Projectiles.ts` — pooled arrows; fly where AIMED at loose
  time (dodgeable in flight); resolve via `combat.projectileHit`.
- Render feedback: `Player.syncRender` (weapon-arc swing keyed to the same
  tick constants, slash arc tinted by outcome), `Enemy.syncRender`
  (rear-back telegraph, flinch jitter, topple-and-fade death), corpse splat
  props, `Ambience.burst` blood.
- Movement roots the actor while `action !== 'idle'` (attack commitment),
  and a new move order cancels a windup via the cleared attack target.

## Guidelines for sub-agents
- New attacks/spells MUST be actions with a strike frame resolved in
  CombatSystem — never instant damage on input.
- Keep animation timing constants in sync with combat timing constants
  (Player mirrors SWING_WINDUP/SWING_RECOVER; a drift makes visuals lie).
- All combat randomness through the CombatSystem's seeded `rand` — one
  stray Math.random() breaks co-op determinism.
- Per-type tuning lives in ENEMY_TYPES — do not scatter constants.
