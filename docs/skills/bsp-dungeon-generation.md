# Skill: Seeded BSP Dungeon Generation with Connectivity by Construction

## What & why
Binary Space Partitioning generation (the RogueBasin-classic algorithm):
recursively split the map into leaves, carve one room per leaf, then connect
sibling subtrees bottom-up with corridors. Chosen over cellular automata for
Milestone 1 because it natively produces the **room-and-corridor** gothic
dungeon topology the design calls for (cellular caves are a later biome).

## Problem it solved
Procedural layouts that are (a) always fully connected, (b) deterministic
from a seed, (c) tunable (room density, corridor width) without graph
post-processing.

## Implementation (`src/scenes/DungeonGenerator.ts`)
- `mulberry32` seeded PRNG — 32-bit, fast, good distribution; the SAME seed
  always yields the same dungeon (co-op peers regenerate from
  `GameSnapshot.dungeonSeed` instead of downloading tile grids).
- Split preference follows the longer axis (ratio gate 1.15) to avoid sliver
  leaves; recursion capped at depth 5; `MIN_LEAF = 10`, `MIN_ROOM = 4`.
- **Connectivity proof**: every leaf contains a carved room; every internal
  node connects one room-center from its left subtree to one from its right.
  Induction: leaves are connected regions; each merge joins two connected
  regions with a corridor → the root is one connected region. No flood-fill
  validation needed.
- Corridors are L-shaped, 1–2 tiles wide (35% wide), elbow direction random.
- A 1-tile solid border ring is reserved so movement/LOS never sample out of
  bounds.

## Guidelines for sub-agents
- New generation features (themed rooms, doors, water) must keep the
  `DungeonMap` interface stable — downstream systems depend only on it.
- All randomness MUST come from the passed seed's PRNG stream. One stray
  `Math.random()` silently breaks co-op determinism.
- Spawn safety: `spawn` is a room center, walkable by construction. Enemy
  placement should use `rooms[i]` data, not random tile probing.
