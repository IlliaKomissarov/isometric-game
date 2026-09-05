# Skill: Tile Lightmap Tinting + Cutaway Vision (Occlusion Fading)

## What & why
Two rendering techniques from classic isometric ARPGs:

1. **Tile lightmap** (classic ARPG's lighting model): every world sprite is
   multiplied by a per-tile light color instead of being covered by overlay
   darkness. Chosen after the overlay approach FAILED: a black fog diamond
   only covers its own tile's ground footprint, so tall sprites (walls, unit
   markers) were darkened by the *neighboring* tile's fog — lit walls had
   black tops, and edge-of-map sprites escaped the overlay entirely.
2. **Cutaway vision**: architecture that sorts in front of the player and
   overlaps them on screen fades to ~0.32 alpha so the hero is never hidden.

## Implementation (`src/engine/Lighting.ts`)
- `tintForLight(L)` maps light [0,1] → a color ramp from cool shadow
  `LIGHT_SHADOW_RGB` to warm torch `LIGHT_WARM_RGB` (smoothstepped). Applied
  as Pixi `sprite.tint` (a per-sprite multiply — free on the GPU).
- Light per tile = radial falloff from the player's **continuous render
  position** (full inside `LIGHT_FULL_RADIUS`, fading to 0 at `FOG_RADIUS`)
  × a layered-sine torch flicker. Because the falloff follows the
  interpolated position, light glides smoothly instead of stepping per tile.
- Visibility SET (LOS Bresenham, radius-limited) still recomputes only on
  `player:tileChanged`; per-frame work is tinting ~150 visible tiles.
- States: HIDDEN → sprite `visible=false` (NEVER black-tint: a black
  silhouette against the near-black background leaks the layout);
  EXPLORED → static `tintForLight(0)` shadow; VISIBLE → live falloff tint.
- Entities: render loop calls `Enemy.setLight(lighting.getLightAt(pos))` —
  creatures dim with distance from the torch. Hit-flash tint overrides
  lighting for a few ticks.
- **Cutaway**: each frame, scan wall sprites in a small window around the
  player; fade those with `depthKey(wall) > depthKey(player)` AND
  screen-rect overlap with the player's body box; ease alpha with
  `1 - exp(-14·dt)` damping both directions. Released walls ease back to 1.

## Guidelines for sub-agents
- New world sprites MUST register with Lighting (`registerFloor`/`registerWall`
  or entity `setLight`) or they will glow full-bright in darkness.
- Light queries for gameplay/UI go through `getLightAt` / `isVisible` /
  `getState` — never read sprite tints.
- Do not add a second darkness overlay on top of tinting; the two models
  don't compose.
- Tuning lives in config: `LIGHT_FULL_RADIUS`, `LIGHT_SHADOW_RGB`,
  `LIGHT_WARM_RGB`, `WALL_FADE_ALPHA`, `FOG_RADIUS`.
