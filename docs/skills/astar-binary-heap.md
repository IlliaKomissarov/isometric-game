# Skill: A* on Grids with Binary Heap + Typed-Array Node Storage

## What & why
Textbook A* implementations allocate node objects and use array `sort()` or
linear scans for the open set — fine for one search, ruinous when every click
(and later, every chasing enemy every second) triggers a search. This skill
is the production-grade variant used by pathfinding libraries (and by the
Diablo web ports' movement code): flat typed arrays + an index-based binary
min-heap + search stamps.

## Problem it solved
Click-to-move latency and future enemy AI scale. On the 44×44 grid a search
touches ≤1,936 nodes with **zero allocations** except the returned waypoint
list.

## Implementation (`src/systems/Pathfinding.ts`)
- `gScore/fScore: Float64Array`, `cameFrom/visited: Int32Array`, sized once
  to `width·height` and reused forever.
- **Search stamps**: `visited[i] === stamp` marks membership in the current
  search; incrementing `stamp` "clears" all arrays in O(1).
- **Binary min-heap** over node indices keyed by `fScore`. Instead of
  decrease-key, re-discovered nodes are pushed again (duplicate entries);
  stale pops re-expand to no effect. Simpler and empirically faster on grids.
- **Octile heuristic** `max + (√2−1)·min` — admissible for 8-way movement
  with √2 diagonal cost → optimal paths.
- **No corner cutting**: diagonal (dx,dy) allowed only if `(cx+dx, cy)` AND
  `(cx, cy+dy)` are walkable. Pairs with the square-collider slide in
  `systems/Collision.ts` so followers never wedge on corners.

## Guidelines for sub-agents
- Reuse the shared `Pathfinder` instance; never construct one per search.
- Enemy AI should throttle searches (e.g., re-path every 500 ms or on target
  tile change), not per tick.
- Returned paths EXCLUDE the start tile and are tile coords; convert with
  `tileCenter()` before steering.
- If maps grow past ~128×128, consider hierarchical A* — new skill entry
  required before implementing.
