# Sub-Task: Minimap from Explored Fog

## Goal
A small (180×180 px) top-right overview: explored floor tiles as dim
rectangles, walls slightly lighter, the player as a bright dot. Unexplored
tiles invisible. Top-down orthographic (NOT isometric) for readability.

## Files you may touch
- NEW: `src/ui/Minimap.ts`
- `src/main.ts` (construct + one update call in the render callback)
- `docs/checklist.md`, `docs/development_log.md`

The read accessor already exists: `Lighting.getState(gx, gy)` returns
0 hidden / 1 explored / 2 visible.

## Design constraints
- Render into a `<canvas>` DOM overlay (like `#hud`), 4 px per tile.
- Redraw the explored-tiles base ONLY on `player:tileChanged` (event-driven,
  matches fog philosophy); the player dot may redraw per frame.
- Read map data from `SceneManager.dungeon` and fog state via
  `Lighting.getState` — never read world sprite tints.
- No pan/zoom/click interactions (out of scope).

## Acceptance
- Exploring the dungeon progressively fills the minimap; the dot tracks the
  player smoothly; hidden rooms stay invisible until entered. Typecheck clean.
