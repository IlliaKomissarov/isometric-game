# Sub-Task: Gamepad Support (Dark Alliance Native Feel)

## Goal
Full Gamepad API support: left stick = direct movement, A (south button) =
attack, X = pickup, Y = inventory, start = map. The command layer already
speaks button-combat — this task only translates gamepad state to commands.

## Files you may touch
- NEW: `src/core/GamepadBindings.ts` — poll `navigator.getGamepads()` once
  per render frame (gamepads have no events for analog); translate to the
  SAME InputCommands the keyboard emits (DIRECT_MOVE from stick vector with
  a 0.25 deadzone, ATTACK_DOWN/UP edges from button state, PICKUP_NEAREST,
  STOP on stick release).
- `src/main.ts` — construct it; call `.poll()` in the render callback
  (input sampling render-side is fine; command APPLICATION stays in ticks).
- `index.html` — COMMANDS panel shows gamepad glyphs when one is connected
  (listen to `gamepadconnected`).
- `docs/checklist.md`, `docs/development_log.md`.

## Constraints
- Emit DIRECT_MOVE only when the quantized stick direction CHANGES (8-way
  snap), not every frame — the queue must not flood.
- Stick vector is screen-space intent: reuse the exact `(sy+sx, sy-sx)`
  world mapping from InputBindings (import a shared helper; do not fork).
- Read /docs/skills/hybrid-action-controls.md first.

## Acceptance
With a controller: walk, fight (held A chains swings), loot, open panels.
Keyboard/mouse unaffected. Typecheck clean.
