# Skill: Hybrid Action Controls (classic ARPG Mouse + Dark Alliance Buttons)

## What & why
Pure click-to-fight "feels terrible and unresponsive" (user verdict) because
every action costs a precision click. Baldur's Gate: Dark Alliance (GBA)
proves the alternative: move with the stick, MASH the attack button, and the
game auto-targets whatever is in front of you. This skill is the fusion:
both schemes live simultaneously and the player flows between them.

## The control contract (`src/core/InputBindings.ts`)
| Input | Command | Behavior |
| --- | --- | --- |
| LMB on enemy | `ATTACK` | Lock target, path into reach, auto-swing until dead |
| LMB on loot | `PICKUP` | Path to it, collect on arrival |
| LMB on ground | `MOVE_TO` | A* click-to-move |
| WASD/arrows | `DIRECT_MOVE` | Instant direct control (cancels orders) |
| SPACE / F (hold ok) | `ATTACK_DOWN/UP` | Auto-targeted swing; whiffs the air when nothing is near |
| E | `PICKUP_NEAREST` | Grab the closest ground item (≤2.5 tiles) |
| I | (UI only) | Inventory panel |

Everything except UI toggles flows through the deterministic InputQueue.

## Battle-tested rules encoded here (violate at your peril)
1. **Selection range ≤ resolution reach.** The button's auto-target radius
   (BUTTON_TARGET_RANGE) must not exceed STRIKE_REACH, or a foe acquired at
   the selection edge whiffs forever — we shipped that livelock for an hour.
2. **Held button = re-swing when idle**, not command spam: ATTACK_DOWN sets
   a flag; CombatSystem starts a new swing whenever the player returns to
   'idle' with the flag up. One command pair per press/release.
3. **Air swings are a feature.** Pressing attack with no target still plays
   the full swing (miss arc). Mashing feels responsive; refusing to swing
   feels broken.
4. **Button swings always complete; click swings can be move-cancelled.**
   Click orders carry a standing target that a newer order clears —
   detecting that mid-windup cancels the swing. Button swings are short
   commitments (BG:DA style).
5. **`blur` releases everything** (movement keys AND attack hold), or
   alt-tab leaves phantom held keys.
6. **Targeting must be visible**: the pulsing ring (main.ts render loop,
   `combat.getDisplayTarget()`) shows the locked/candidate target at all
   times. If the player can't tell who they're hitting, the scheme fails.

## Enemy-side pairing (`src/entities/Enemy.ts`)
Close-range pursuit uses straight steering FIRST (`moveDirect`), falling
back to A* only when the straight line is wall-blocked — A*'s
no-corner-cutting rule refuses the final diagonal step and idles the enemy
just out of reach otherwise (second livelock we shipped and fixed).
