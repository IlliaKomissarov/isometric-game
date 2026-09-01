# Sub-Task: Depth-Themed Floor Palettes

## Goal
Deeper floors look different: church stone (floors 1–2) → catacombs bone/
rust (3–4) → hellish basalt/ember (5+), like Diablo 1's tilesets.

## Files you may touch
- `src/core/config.ts` — add `FLOOR_THEMES: ThemeDef[]` (floor tile colors,
  wall colors, ambient shadow RGB, brazier light color, mote tint).
- `src/core/AssetManager.ts` — `buildFloorTile`/`buildWallBlock` take a
  ThemeDef; register per-theme texture sets lazily (`floor_0_theme1` …)
  the first time a theme is needed.
- `src/scenes/SceneManager.ts` — pick the texture set from the theme.
- `src/engine/Lighting.ts` — LIGHT_SHADOW_RGB/LIGHT_WARM_RGB become
  theme-supplied constructor params (keep current values as defaults).
- `src/main.ts` — resolve theme from floor number in `buildWorld`.
- `docs/checklist.md`, `docs/development_log.md`.

## Constraints
- Theme selection must be a pure function of floor number (determinism).
- Do NOT touch projection, dungeon generation, or combat.
- Palettes must pass the same readability bar: floor vs wall contrast, and
  the explored-shroud tint must stay distinguishable from visible tiles.

## Acceptance
Descend 5 floors: three visibly distinct moods, lighting still correct
(walls lit by adjacent floors), no texture-memory growth per revisit
(themes cached). Typecheck clean.
