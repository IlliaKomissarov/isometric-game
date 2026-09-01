# Sub-Task: Sound Effect Trigger Layer

## Goal
An `AudioSystem` that subscribes to gameplay events and plays one-shot sounds
(WebAudio), with a master volume and graceful no-op when audio files are
missing.

## Files you may touch
- NEW: `src/systems/Audio.ts`
- `src/main.ts` (construct the system; ≤5 lines)
- `/public/assets/audio/` (drop placeholder .ogg/.mp3 files here)
- `docs/checklist.md`, `docs/development_log.md`

## Design constraints
- Subscribe via `eventBus.on(...)` ONLY — never call the audio system from
  gameplay code. Current wired events: `player:pathStarted`,
  `entity:damaged`, `entity:died`, `input:modeChanged`.
- Browsers block audio before user gesture: lazily create/resume the
  `AudioContext` on first `pointerdown` (one listener, `once: true`).
- Preload + decode buffers at boot via `fetch`; a missing file logs ONE
  warning and disables that mapping (no per-event spam, no throw).
- Audio is render-side; it must never mutate simulation state.

## Acceptance
- With placeholder files present: click-move plays a footstep cue, enemy
  death plays a cue. With files absent: console shows one warning per missing
  file, game runs normally. Typecheck clean.
