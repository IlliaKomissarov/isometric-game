# Skill: Two-Layer Fog of War with Bresenham Line of Sight

## What & why
Classic ARPG fog (Diablo 1 model): three tile states — never seen (pitch
black), explored-but-unseen (static shroud), currently visible. Visibility is
radius-limited and blocked by walls, so rooms reveal only when actually
entered/peeked.

## Problem it solved
Atmosphere (oppressive unknown) + tactical information hiding, at negligible
runtime cost, with state that can sync to co-op peers.

## Implementation (`src/engine/Lighting.ts`, `src/utils/los.ts`)
> HISTORY: originally a per-tile black-diamond overlay (`FogOfWar.ts`). That
> approach darkened tall sprites incorrectly and was replaced by lightmap
> tinting — see `tile-lightmap-and-cutaway.md`. The LOS/visibility-set logic
> below is unchanged and lives on inside Lighting.
- **Event-driven**: the visible set recomputes only on `player:tileChanged`,
  never per frame.
- Visible set: all tiles within `FOG_RADIUS` (Euclidean) that pass a
  Bresenham line walk from the observer where no intermediate tile is opaque.
  The blocking wall tile itself IS visible so architecture lights up.
- **Delta updates**: previous visible set diffed against the new one; only
  changed tiles get alpha writes.
- `packExplored()` returns the explored bitset for save/net sync.

## Known symmetry caveat
Plain Bresenham LOS is slightly asymmetric (A may see B while B can't see A)
and produces minor corner artifacts. Acceptable for MVP. If the user wants
polished sightlines, upgrade to **recursive shadowcasting** (well-documented
on RogueBasin) — that change is isolated to `FogOfWar.update()`.

## Guidelines for sub-agents
- Gameplay queries (enemy visible? render health bar?) go through
  `lighting.isVisible(gx, gy)` / `lighting.getState(gx, gy)` — never read
  sprite tints or alphas.
- If the user wants polished symmetric sightlines, upgrade `updateVisibility`
  to recursive shadowcasting; the change stays inside that one method.
