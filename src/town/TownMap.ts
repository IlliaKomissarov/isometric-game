/**
 * @module town/TownMap
 * FLOOR 0 — the handcrafted town (it.39, redesigned it.40). A 46×40 map
 * ringed by cliffs and a two-deep forest belt instead of walls:
 *
 *   N  centre: the MARKET SQUARE — cobbled plaza, four canopied stalls,
 *              the shopkeeper, crates / barrels / signs, torch posts
 *   W / E:     two RESIDENTIAL quarters — cottages with fenced yards on
 *              dirt lanes off the east–west high street
 *   NW:        the STASH VAULT (iron-bound chest, barrels, crates)
 *   SW:        the CAMPSITE — campfire, the resting heroes, dirt clearing
 *   S:         the DUNGEON GATE — a stone archway with burning braziers
 *              at the end of the cobbled main street
 *
 * Every standing object claims a TILE_BLOCKED footprint BEFORE the scene
 * builds (the Diablo collision rule); flat decals stay walkable. Cottages
 * keep their door column walkable so the hero can step INSIDE (the roof
 * cuts away). The map is a plain `DungeonMap` (plus `tileKind` paint) so
 * pathing, lighting, minimap and rendering treat the town like any floor.
 *
 * `auditTownLayout()` flood-fills from the spawn and reports any walkable
 * tile the hero could never reach (a prop trap) — run once per build.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type DungeonMap, type Room } from '@/scenes/DungeonGenerator';

export const TOWN_W = 46;
export const TOWN_H = 40;

/** Ground paint per tile in the town theme. */
export const KIND_COBBLE = 0;
export const KIND_GRASS = 1;
export const KIND_DIRT = 2;

export type TownPropKind =
  | 'house'
  | 'stall'
  | 'campfire'
  | 'stash'
  | 'pillar'
  | 'torch'
  | 'brazier'
  | 'arch'
  | 'fence'
  | 'tree'
  | 'barrel'
  | 'crates'
  | 'signpost'
  | 'hanging_sign'
  | 'grassclump'
  | 'pots'
  | 'merchant';

export interface TownProp {
  kind: TownPropKind;
  /** Top-left tile of the footprint (or the tile itself for 1×1 props). */
  x: number;
  y: number;
  /** Blocked footprint in tiles (omit for flat decals). */
  w?: number;
  h?: number;
  /** Atlas single/anim variant (house_a…, stall_b…, barrel_b…). */
  variant?: string;
}

export interface TownLayout {
  map: DungeonMap;
  props: TownProp[];
  /** Stair tile of the dungeon gate (walking onto it descends to depth I). */
  gate: { x: number; y: number };
  stash: { x: number; y: number };
  /** Tiles that count as "at the stall" for the TRADE prompt. */
  merchant: { x: number; y: number; tiles: Array<{ x: number; y: number }> };
  campfire: { x: number; y: number };
  /** Where the three unselected heroes rest (tile centres, facing the fire). */
  campSpots: Array<{ x: number; y: number }>;
  /** Where a town portal from the depths deposits the hero (and its return portal). */
  portal: { x: number; y: number };
  /** Villagers wander inside this room. */
  wander: Room;
  /** Cottage footprints (for the "inside" cutaway). */
  houses: Array<{ x: number; y: number; w: number; h: number }>;
}

export interface TownMap extends DungeonMap {
  readonly tileKind: Uint8Array;
}

/** Build the town: grid + footprints + prop list. Pure and deterministic. */
export function buildTownLayout(): TownLayout {
  const W = TOWN_W;
  const H = TOWN_H;
  const grid = new Uint8Array(W * H).fill(TILE_FLOOR);
  const tileKind = new Uint8Array(W * H).fill(KIND_GRASS);
  const idx = (x: number, y: number): number => y * W + x;

  // Cliff ring: the only true walls (opaque, drawn as mossy rock).
  for (let x = 0; x < W; x++) {
    grid[idx(x, 0)] = TILE_WALL;
    grid[idx(x, H - 1)] = TILE_WALL;
  }
  for (let y = 0; y < H; y++) {
    grid[idx(0, y)] = TILE_WALL;
    grid[idx(W - 1, y)] = TILE_WALL;
  }

  const paint = (x0: number, y0: number, x1: number, y1: number, kind: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tileKind[idx(x, y)] = kind;
  };
  // The market square, the main street south to the gate, the high street.
  paint(15, 6, 30, 15, KIND_COBBLE);
  paint(21, 16, 23, 35, KIND_COBBLE);
  paint(4, 19, 41, 20, KIND_COBBLE);
  // Dirt: house lanes, the vault lane, the camp clearing.
  paint(6, 12, 8, 18, KIND_DIRT);
  paint(6, 21, 8, 27, KIND_DIRT);
  paint(12, 21, 14, 28, KIND_DIRT);
  paint(37, 12, 39, 18, KIND_DIRT);
  paint(37, 21, 39, 27, KIND_DIRT);
  paint(31, 21, 33, 28, KIND_DIRT);
  paint(8, 15, 12, 18, KIND_DIRT);
  paint(14, 22, 20, 29, KIND_DIRT);
  paint(24, 22, 28, 27, KIND_DIRT);

  const props: TownProp[] = [];
  const houses: TownLayout['houses'] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    const w = p.w ?? 1;
    const h = p.h ?? 1;
    for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };
  /** A cottage: 3×3 blocked, except the door column (inside + doorstep). */
  const house = (x: number, y: number, variant: string): void => {
    block({ kind: 'house', x, y, w: 3, h: 3, variant });
    grid[idx(x + 1, y + 1)] = TILE_FLOOR; // The room.
    grid[idx(x + 1, y + 2)] = TILE_FLOOR; // The doorstep.
    tileKind[idx(x + 1, y + 2)] = KIND_DIRT;
    tileKind[idx(x + 1, y + 1)] = KIND_DIRT;
    houses.push({ x, y, w: 3, h: 3 });
  };
  const tree = (x: number, y: number): void => block({ kind: 'tree', x, y, variant: (x * 7 + y * 3) % 3 === 0 ? 'tree_b' : 'tree_a' });

  // ---- FOREST BELT: two staggered rows inside the cliffs, a gap at the gate ----
  for (let x = 1; x < W - 1; x++) {
    if (x % 2 === 1) tree(x, 1);
    if (x % 2 === 0 && x > 1 && x < W - 2) tree(x, 2);
    if (x < 20 || x > 24) {
      if (x % 2 === 0) tree(x, H - 2);
      if (x % 2 === 1 && x > 2 && x < W - 3) tree(x, H - 3);
    }
  }
  for (let y = 3; y < H - 3; y++) {
    if (y % 2 === 0) tree(1, y);
    if (y % 2 === 1) tree(2, y);
    if (y % 2 === 1) tree(W - 2, y);
    if (y % 2 === 0) tree(W - 3, y);
  }
  // Thickets that shape the quarters (never on a street).
  for (const [x, y] of [[11, 5], [33, 5], [12, 9], [34, 9], [10, 30], [35, 30], [16, 33], [28, 33], [5, 31], [40, 31], [30, 17], [14, 17]] as const) tree(x, y);

  // ---- MARKET SQUARE ----
  block({ kind: 'stall', x: 16, y: 7, w: 3, h: 2, variant: 'stall_a' });
  block({ kind: 'merchant', x: 17, y: 6 });
  block({ kind: 'stall', x: 27, y: 7, w: 3, h: 2, variant: 'stall_b' });
  block({ kind: 'stall', x: 16, y: 13, w: 3, h: 2, variant: 'stall_c' });
  block({ kind: 'stall', x: 27, y: 13, w: 3, h: 2, variant: 'stall_d' });
  block({ kind: 'crates', x: 20, y: 6 });
  block({ kind: 'barrel', x: 25, y: 6, variant: 'barrel_a' });
  block({ kind: 'barrel', x: 30, y: 10, variant: 'barrel_b' });
  block({ kind: 'crates', x: 15, y: 11 });
  block({ kind: 'barrel', x: 30, y: 12, variant: 'barrel_a' });
  decal({ kind: 'pots', x: 19, y: 9 });
  decal({ kind: 'pots', x: 26, y: 14 });
  decal({ kind: 'hanging_sign', x: 19, y: 12 });
  decal({ kind: 'hanging_sign', x: 26, y: 9 });
  decal({ kind: 'signpost', x: 24, y: 16 });
  for (const [x, y] of [[15, 6], [30, 6], [15, 15], [30, 15]] as const) block({ kind: 'torch', x, y });

  // ---- STASH VAULT (NW) ----
  block({ kind: 'stash', x: 9, y: 14 });
  block({ kind: 'barrel', x: 8, y: 13, variant: 'barrel_a' });
  block({ kind: 'barrel', x: 10, y: 13, variant: 'barrel_b' });
  block({ kind: 'crates', x: 7, y: 14 });
  block({ kind: 'torch', x: 11, y: 14 });

  // ---- RESIDENTIAL WEST ----
  house(5, 8, 'house_a');
  house(5, 22, 'house_c');
  house(11, 24, 'house_b');
  for (const x of [4, 5, 7, 8]) block({ kind: 'fence', x, y: 11 }); // Gap at the door column.
  for (const x of [4, 5]) block({ kind: 'fence', x, y: 25 });
  block({ kind: 'torch', x: 9, y: 22 });
  // ---- RESIDENTIAL EAST ----
  house(36, 8, 'house_b');
  house(36, 22, 'house_d');
  house(30, 24, 'house_c');
  for (const x of [36, 38, 39, 40]) block({ kind: 'fence', x, y: 11 }); // Gap at the door column.
  for (const x of [39, 40]) block({ kind: 'fence', x, y: 25 });
  block({ kind: 'torch', x: 35, y: 22 });

  // ---- CAMPSITE (SW): the fire, the resting heroes, seats ----
  const campfire = { x: 17, y: 26 };
  block({ kind: 'campfire', x: campfire.x, y: campfire.y });
  const campSpots = [
    { x: 15.5, y: 25.5 },
    { x: 16.5, y: 28.4 },
    { x: 19.4, y: 26.6 },
  ];
  block({ kind: 'barrel', x: 19, y: 24, variant: 'barrel_b' });
  block({ kind: 'crates', x: 14, y: 28 });
  decal({ kind: 'pots', x: 15, y: 27 });
  block({ kind: 'torch', x: 20, y: 29 });

  // ---- THE HIGH STREET + MAIN STREET: torch posts ----
  for (const [x, y] of [[20, 18], [24, 18], [20, 23], [24, 23], [20, 31], [24, 31], [10, 18], [34, 18], [10, 21], [34, 21]] as const) {
    block({ kind: 'torch', x, y });
  }

  // ---- THE DUNGEON GATE (S): archway across the street, braziers on pillars ----
  const gate = { x: 22, y: 35 };
  props.push({ kind: 'arch', x: 21, y: 35, w: 3, h: 1 });
  grid[idx(21, 35)] = TILE_BLOCKED; // Piers.
  grid[idx(23, 35)] = TILE_BLOCKED;
  block({ kind: 'brazier', x: 20, y: 34 });
  block({ kind: 'brazier', x: 24, y: 34 });
  block({ kind: 'pillar', x: 20, y: 36 });
  block({ kind: 'pillar', x: 24, y: 36 });
  for (const x of [21, 22, 23]) grid[idx(x, 36)] = TILE_BLOCKED; // Nothing walks past the stairwell.
  grid[idx(22, 37)] = TILE_BLOCKED;
  grid[idx(21, 37)] = TILE_BLOCKED;
  grid[idx(23, 37)] = TILE_BLOCKED;
  grid[idx(gate.x, gate.y)] = TILE_FLOOR;

  // UNDERGROWTH: every belt tile that is not a tree is brush — nothing
  // walks the forest edge, so no pocket back there can trap the hero.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const belt = x <= 2 || y <= 2 || x >= W - 3 || y >= H - 3;
      if (belt && grid[idx(x, y)] === TILE_FLOOR) grid[idx(x, y)] = TILE_BLOCKED;
    }
  }
  grid[idx(gate.x, gate.y)] = TILE_FLOOR;

  // Flat dressing.
  for (const [x, y] of [[13, 7], [32, 7], [9, 20], [36, 20], [26, 30], [18, 31], [4, 15], [41, 15], [28, 22], [12, 32]] as const) decal({ kind: 'grassclump', x, y });

  const spawn = { x: 22, y: 21 };
  const wander: Room = { x: 16, y: 6, w: 14, h: 10 };
  const map: TownMap = {
    width: W,
    height: H,
    grid,
    rooms: [{ x: 3, y: 3, w: W - 6, h: H - 6 }],
    spawn,
    seed: 0,
    tileKind,
  };
  return {
    map,
    props,
    gate,
    stash: { x: 9, y: 14 },
    merchant: {
      x: 17,
      y: 6,
      tiles: [
        { x: 16, y: 7 },
        { x: 17, y: 7 },
        { x: 18, y: 7 },
        { x: 16, y: 8 },
        { x: 17, y: 8 },
        { x: 18, y: 8 },
      ],
    },
    campfire,
    campSpots,
    portal: { x: 26, y: 24 },
    wander,
    houses,
  };
}

/**
 * COLLISION AUDIT: every walkable tile must be reachable from the spawn
 * (4-connected), and every point of interest must touch reachable ground.
 * Returns the unreachable tiles; the caller warns (dev) — never throws.
 */
export function auditTownLayout(layout: TownLayout): { unreachable: Array<{ x: number; y: number }>; missing: string[] } {
  const { width, height, grid } = layout.map;
  const seen = new Uint8Array(width * height);
  const stack = [layout.map.spawn.y * width + layout.map.spawn.x];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (seen[j] || grid[j] !== TILE_FLOOR) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  const unreachable: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === TILE_FLOOR && !seen[i]) unreachable.push({ x: i % width, y: Math.floor(i / width) });
  const touches = (x: number, y: number): boolean =>
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < width && ny < height && seen[ny * width + nx] === 1;
    });
  const missing: string[] = [];
  if (!touches(layout.gate.x, layout.gate.y)) missing.push('gate');
  if (!touches(layout.stash.x, layout.stash.y)) missing.push('stash');
  if (!layout.merchant.tiles.some((t) => touches(t.x, t.y))) missing.push('merchant');
  if (!touches(layout.portal.x, layout.portal.y)) missing.push('portal');
  if (!touches(layout.campfire.x, layout.campfire.y)) missing.push('campfire');
  for (const [i, h] of layout.houses.entries()) if (!seen[(h.y + 2) * width + h.x + 1]) missing.push(`house ${i} door`);
  return { unreachable, missing };
}
