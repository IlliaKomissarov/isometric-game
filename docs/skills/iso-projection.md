# Skill: Isometric (2:1 Dimetric) Projection & Exact Inverse Picking

## What & why
Classic classic-ARPG-style rendering is not true isometric (120° axes) but 2:1
dimetric: tiles are diamonds twice as wide as tall. This is the projection
used by the open-source classic ARPG web ports (the Devilution web port renders the
original 64×32 tile assets) and by virtually all "isometric" 2D engines,
because 2:1 slopes rasterize without jaggies.

## Problem it solved
We need (a) world→screen placement for tiles/entities, (b) an **exact**
screen→world inverse for mouse picking (click-to-move must never drift), and
(c) a painter's-algorithm depth key.

## Implementation (`src/utils/iso.ts`)
```
screenX = (wx − wy) · TILE_W/2
screenY = (wx + wy) · TILE_H/2
// inverse (exact, no approximation):
a = sx / (TILE_W/2);  b = sy / (TILE_H/2)
wx = (a + b) / 2;     wy = (b − a) / 2
depthKey(wx, wy) = (wx + wy) · TILE_H/2   // larger = closer to camera
```
World space is continuous tile units (1.0 = one tile), which makes speeds,
radii, and collision math resolution-independent.

## Guidelines for sub-agents
- **Never re-derive projection math.** Import from `@/utils/iso` only.
- Mouse picking: convert pointer → world-container local space first
  (`Camera.pointerToWorld` handles zoom/pan), then `screenToWorld`.
- Anything placed in the sortable object layer must set
  `zIndex = depthKey(...)`. Walls subtract 4 (see SceneManager comment) —
  keep that convention for static blockers.
- Rotation is permanently disabled; do not add rotated projections.
