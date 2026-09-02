/**
 * @module town/TownMap
 * FLOOR 0 — the handcrafted town (it.39 → organic it.43 → NORTH GATE +
 * dense it.44). A 60×54 map whose edge is a noise-carved blob:
 *
 *   outside the blob:  cliffs (the map's only true walls)
 *   the belt inside:   dense pines and dead trees, brush between them
 *   NORTH (top centre): the DUNGEON GATE — the ruin archway; touching its
 *                      front tile descends at once
 *   the interior:      a winding cobbled MAIN STREET from the gate down to
 *                      the MARKET SQUARE (six stalls, the shopkeeper, the
 *                      well), a HIGH STREET east–west, a SOUTH STREET to
 *                      the lower plaza, dirt lanes to seven cottages and
 *                      the TAVERN, the STASH VAULT (NW), the CAMPSITE
 *                      clearing (SW), the portal yard (SE), torch posts
 *                      along every street, two gate guards (the gate
 *                      is NORTH-WEST since it.45; no ritual circle)
 *   every open patch:  tree clusters and bush tufts — no empty lawns
 *
 * Every standing object claims a TILE_BLOCKED footprint BEFORE the scene
 * builds; flat decals stay walkable. Cottages keep their door column
 * walkable (roof cutaway inside). After carving, a flood fill from the
 * spawn turns every unreachable floor pocket into brush; then a second
 * pass drops the dense fill only where it cannot cut a route.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type DungeonMap, type Room } from '@/scenes/DungeonGenerator';
import { mulberry32 } from '@/utils/rng';

export const TOWN_W = 60;
export const TOWN_H = 54;

/** Ground paint per tile in the town theme. */
export const KIND_COBBLE = 0;
export const KIND_GRASS = 1;
export const KIND_DIRT = 2;

export type TownPropKind =
  | 'house'
  | 'tavern'
  | 'stall'
  | 'campfire'
  | 'well'
  | 'stash'
  | 'pillar'
  | 'column'
  | 'torch'
  | 'brazier'
  | 'ruingate'
  | 'fence'
  | 'tree'
  | 'pine'
  | 'deadtree'
  | 'barrel'
  | 'barrels_stacked'
  | 'crates'
  | 'crates_wood'
  | 'wood_pile'
  | 'table_chairs'
  | 'supports'
  | 'stairs_stone'
  | 'signpost'
  | 'hanging_sign'
  | 'grassclump'
  | 'pots'
  | 'pentagram'
  | 'merchant'
  | 'guard';

export interface TownProp {
  kind: TownPropKind;
  /** Top-left tile of the footprint (or the tile itself for 1×1 props). */
  x: number;
  y: number;
  /** Blocked footprint in tiles (omit for flat decals). */
  w?: number;
  h?: number;
  /** Atlas single/anim variant (house_a…, stall_b…, pine_c…). */
  variant?: string;
}

export interface TownLayout {
  map: DungeonMap;
  props: TownProp[];
  /** Front tile of the dungeon gate (touching it descends to depth I). */
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
  /** Gate guards (render-only sentries). */
  guards: Array<{ x: number; y: number }>;
}

export interface TownMap extends DungeonMap {
  readonly tileKind: Uint8Array;
}

/** Build the town: grid + footprints + prop list. Pure and deterministic. */
export function buildTownLayout(): TownLayout {
  const W = TOWN_W;
  const H = TOWN_H;
  const rand = mulberry32(0x70712);
  const grid = new Uint8Array(W * H).fill(TILE_FLOOR);
  const tileKind = new Uint8Array(W * H).fill(KIND_GRASS);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // ---- THE BLOB: polar radius with three sines + a bump toward the gate (NORTH) ----
  const CX = 30;
  const CY = 27;
  const radiusAt = (theta: number): number => {
    const bump = 5 * Math.exp(-((theta + (3 * Math.PI) / 4) ** 2) / 0.14); // The gate sits NORTH-WEST (it.45).
    return 24.5 + 2.6 * Math.sin(2 * theta + 1.3) + 1.8 * Math.sin(5 * theta + 0.4) + 1.4 * Math.sin(3 * theta + 2.6) + bump;
  };
  const polar = (x: number, y: number): { r: number; theta: number } => {
    const dx = (x + 0.5 - CX) / 1.12;
    const dy = (y + 0.5 - CY) / 0.94;
    return { r: Math.hypot(dx, dy), theta: Math.atan2(dy, dx) };
  };
  const belt = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const { r, theta } = polar(x, y);
      const R = radiusAt(theta);
      if (r > R || x === 0 || y === 0 || x === W - 1 || y === H - 1) grid[idx(x, y)] = TILE_WALL;
      else if (r > R - 2.6) belt[idx(x, y)] = 1;
    }
  }

  const street = (pts: Array<[number, number]>, kind: number, half: number): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
      for (let s = 0; s <= n; s++) {
        const cx = x0 + ((x1 - x0) * s) / n;
        const cy = y0 + ((y1 - y0) * s) / n;
        for (let oy = -half; oy <= half; oy++) {
          for (let ox = -half; ox <= half; ox++) {
            const tx = Math.round(cx + ox);
            const ty = Math.round(cy + oy);
            if (!inside(tx, ty) || tx < 1 || ty < 1 || tx > W - 2 || ty > H - 2) continue;
            if (Math.hypot(ox, oy) > half + 0.3) continue;
            grid[idx(tx, ty)] = TILE_FLOOR;
            belt[idx(tx, ty)] = 0;
            tileKind[idx(tx, ty)] = kind;
          }
        }
      }
    }
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, kind: number): void => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (!inside(x, y)) continue;
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) {
          if (grid[idx(x, y)] === TILE_WALL) continue;
          grid[idx(x, y)] = TILE_FLOOR;
          tileKind[idx(x, y)] = kind;
          belt[idx(x, y)] = 0;
        }
      }
    }
  };

  // ---- STREETS ----
  const gate = { x: 11, y: 10 }; // NORTH-WEST (it.45): in front of the archway (footprint 10–12 × 8–9).
  ellipse(30, 22, 9.5, 6.5, KIND_COBBLE); // The market square.
  street([[11, 10], [13, 13], [17, 15], [21, 18], [24, 20]], KIND_COBBLE, 1.4); // Main street: NW gate -> square.
  street([[30, 28], [29, 33], [30, 38], [30, 44]], KIND_COBBLE, 1.3); // South street -> lower plaza.
  street([[8, 27], [15, 29], [22, 28], [38, 28], [45, 27], [52, 25]], KIND_COBBLE, 1.1); // High street.
  ellipse(30, 44.5, 3.5, 2.2, KIND_COBBLE); // Lower plaza.
  street([[36, 12], [34, 16]], KIND_DIRT, 1.0); // Tavern lane.
  street([[45, 27], [47, 20]], KIND_DIRT, 0.9); // NE cottage.
  street([[8, 27], [10, 20]], KIND_DIRT, 0.9); // NW cottage.
  street([[15, 29], [12, 34]], KIND_DIRT, 0.9); // W cottage.
  street([[52, 25], [50, 33]], KIND_DIRT, 0.9); // E cottage.
  street([[22, 28], [19, 33], [17, 36]], KIND_DIRT, 1.0); // To the camp.
  street([[38, 28], [42, 34], [43, 37]], KIND_DIRT, 0.9); // To the portal stone.
  street([[15, 29], [14, 24]], KIND_DIRT, 0.9); // To the vault.
  street([[30, 38], [36, 42]], KIND_DIRT, 0.9); // SE cottage.
  street([[30, 38], [24, 42]], KIND_DIRT, 0.9); // SW cottage.
  street([[20, 13], [24, 16]], KIND_DIRT, 0.9); // N cottage.
  ellipse(17.5, 37.5, 4.5, 3.6, KIND_DIRT); // Camp clearing.
  ellipse(43.5, 37.5, 2.5, 2, KIND_DIRT); // Portal stone yard.

  // ---- PROPS ----
  const props: TownProp[] = [];
  const houses: TownLayout['houses'] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    const w = p.w ?? 1;
    const h = p.h ?? 1;
    for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) if (inside(x, y)) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };
  const clearFor = (x: number, y: number, w: number, h: number, pad = 1, kind = KIND_GRASS): void => {
    for (let ty = y - pad; ty < y + h + pad; ty++) {
      for (let tx = x - pad; tx < x + w + pad; tx++) {
        if (!inside(tx, ty) || grid[idx(tx, ty)] === TILE_WALL) continue;
        grid[idx(tx, ty)] = TILE_FLOOR;
        belt[idx(tx, ty)] = 0;
        if (kind !== KIND_GRASS) tileKind[idx(tx, ty)] = kind;
      }
    }
  };
  const house = (x: number, y: number, variant: string): void => {
    clearFor(x, y, 3, 3);
    block({ kind: 'house', x, y, w: 3, h: 3, variant });
    grid[idx(x + 1, y + 1)] = TILE_FLOOR;
    grid[idx(x + 1, y + 2)] = TILE_FLOOR;
    tileKind[idx(x + 1, y + 2)] = KIND_DIRT;
    tileKind[idx(x + 1, y + 1)] = KIND_DIRT;
    houses.push({ x, y, w: 3, h: 3 });
  };

  // The DUNGEON GATE (NORTH-WEST, it.45): the ruin archway on its 3×2 footprint
  // set into the cliff, a cobbled forecourt, braziers and two guards; the
  // gate road runs south-east to the square through a built-up quarter.
  clearFor(8, 8, 7, 5, 0, KIND_COBBLE);
  props.push({ kind: 'ruingate', x: 10, y: 8, w: 3, h: 2 });
  for (let y = 8; y <= 9; y++) for (let x = 10; x <= 12; x++) grid[idx(x, y)] = TILE_BLOCKED;
  grid[idx(gate.x, gate.y)] = TILE_FLOOR;
  tileKind[idx(gate.x, gate.y)] = KIND_COBBLE;
  for (let y = 4; y <= 7; y++) for (let x = 8; x <= 14; x++) if (inside(x, y)) grid[idx(x, y)] = TILE_WALL;
  block({ kind: 'brazier', x: 8, y: 10 });
  block({ kind: 'brazier', x: 14, y: 10 });
  const guards = [
    { x: 9, y: 12 },
    { x: 13, y: 12 },
  ];
  for (const g of guards) block({ kind: 'guard', x: g.x, y: g.y });
  // The gate quarter: cottages, a stall, stores and fences crowd the road.
  house(16, 7, 'house_d');
  house(6, 14, 'house_b');
  for (const x of [16, 18, 19]) block({ kind: 'fence', x, y: 10 });
  for (const x of [6, 8, 9]) block({ kind: 'fence', x, y: 17 });
  block({ kind: 'stall', x: 15, y: 12, w: 3, h: 2, variant: 'stall_a' });
  block({ kind: 'stall', x: 19, y: 13, w: 3, h: 2, variant: 'stall_d' });
  block({ kind: 'crates_wood', x: 14, y: 14 });
  block({ kind: 'barrels_stacked', x: 18, y: 16 });
  block({ kind: 'barrel', x: 22, y: 16, variant: 'barrel_b' });
  block({ kind: 'wood_pile', x: 11, y: 14 });
  decal({ kind: 'pots', x: 16, y: 15 });
  decal({ kind: 'hanging_sign', x: 18, y: 15 });
  decal({ kind: 'signpost', x: 13, y: 15 });
  for (const [x, y] of [[9, 13], [13, 13], [15, 17], [20, 19]] as const) block({ kind: 'torch', x, y });

  // The tavern (NE of the square): 5×4, a stone stair and a table outside.
  clearFor(35, 9, 5, 4, 1);
  block({ kind: 'tavern', x: 35, y: 9, w: 5, h: 4, variant: 'tavern_a' });
  decal({ kind: 'stairs_stone', x: 37, y: 13 });
  block({ kind: 'table_chairs', x: 40, y: 12 });
  block({ kind: 'barrels_stacked', x: 34, y: 12 });
  block({ kind: 'supports', x: 33, y: 9 });
  block({ kind: 'torch', x: 40, y: 9 });

  // Market square: six stalls, the shopkeeper, the well, stores, signs, torches.
  block({ kind: 'stall', x: 23, y: 17, w: 3, h: 2, variant: 'stall_a' });
  block({ kind: 'merchant', x: 24, y: 16 });
  block({ kind: 'stall', x: 34, y: 17, w: 3, h: 2, variant: 'stall_b' });
  block({ kind: 'stall', x: 23, y: 25, w: 3, h: 2, variant: 'stall_c' });
  block({ kind: 'stall', x: 34, y: 25, w: 3, h: 2, variant: 'stall_d' });
  block({ kind: 'stall', x: 20, y: 21, w: 3, h: 2, variant: 'stall_b' });
  block({ kind: 'stall', x: 37, y: 21, w: 3, h: 2, variant: 'stall_c' });
  block({ kind: 'well', x: 30, y: 21, w: 2, h: 2, variant: 'well_b' });
  block({ kind: 'crates_wood', x: 27, y: 16 });
  block({ kind: 'barrel', x: 37, y: 19, variant: 'barrel_a' });
  block({ kind: 'barrel', x: 22, y: 24, variant: 'barrel_b' });
  block({ kind: 'wood_pile', x: 36, y: 24 });
  block({ kind: 'barrels_stacked', x: 26, y: 27 });
  block({ kind: 'crates', x: 33, y: 27 });
  decal({ kind: 'pots', x: 26, y: 19 });
  decal({ kind: 'pots', x: 33, y: 24 });
  decal({ kind: 'hanging_sign', x: 26, y: 18 });
  decal({ kind: 'hanging_sign', x: 34, y: 19 });
  decal({ kind: 'signpost', x: 30, y: 27 });
  for (const [x, y] of [[21, 16], [39, 16], [21, 28], [39, 28]] as const) block({ kind: 'torch', x, y });
  block({ kind: 'column', x: 28, y: 29 });
  block({ kind: 'column', x: 32, y: 29 });

  // Stash vault (NW).
  clearFor(13, 22, 3, 2, 1);
  block({ kind: 'stash', x: 14, y: 23 });
  block({ kind: 'barrel', x: 13, y: 22, variant: 'barrel_a' });
  block({ kind: 'barrel', x: 15, y: 22, variant: 'barrel_b' });
  block({ kind: 'crates', x: 12, y: 23 });
  block({ kind: 'torch', x: 16, y: 23 });

  // Cottages (seven).
  house(9, 16, 'house_a');
  house(46, 15, 'house_b');
  house(9, 32, 'house_c');
  house(48, 31, 'house_d');
  house(35, 41, 'house_a');
  house(22, 41, 'house_b');
  house(22, 9, 'house_c');
  for (const x of [8, 9, 11, 12]) block({ kind: 'fence', x, y: 19 });
  for (const x of [45, 46, 48, 49]) block({ kind: 'fence', x, y: 18 });
  block({ kind: 'torch', x: 13, y: 33 });
  block({ kind: 'torch', x: 46, y: 34 });
  block({ kind: 'torch', x: 25, y: 44 });
  block({ kind: 'torch', x: 38, y: 44 });

  // Campsite (SW): the fire, the heroes' spots, seats and stores.
  const campfire = { x: 17, y: 37 };
  block({ kind: 'campfire', x: campfire.x, y: campfire.y });
  const campSpots = [
    { x: 15.5, y: 36.4 },
    { x: 16.6, y: 39.5 },
    { x: 19.5, y: 37.6 },
  ];
  block({ kind: 'wood_pile', x: 20, y: 35 });
  block({ kind: 'barrels_stacked', x: 14, y: 39 });
  decal({ kind: 'pots', x: 19, y: 39 });
  block({ kind: 'torch', x: 21, y: 39 });

  // Torch posts along the streets.
  for (const [x, y] of [[27, 32], [31, 32], [28, 36], [32, 36], [28, 41], [32, 41], [11, 26], [17, 27], [24, 27], [36, 27], [43, 26], [50, 24], [30, 8], [26, 12]] as const) {
    if (grid[idx(x, y)] === TILE_FLOOR) block({ kind: 'torch', x, y });
  }

  // ---- FOREST BELT: pines and dead trees on belt tiles, brush between ----
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (!belt[i] || grid[i] !== TILE_FLOOR) continue;
      grid[i] = TILE_BLOCKED;
      const roll = rand();
      if (roll < 0.46) {
        const v = roll < 0.17 ? 'pine_a' : roll < 0.3 ? 'pine_b' : roll < 0.39 ? 'pine_c' : rand() < 0.5 ? 'dead_a' : 'dead_b';
        props.push({ kind: v.startsWith('dead') ? 'deadtree' : 'pine', x, y, variant: v });
      }
    }
  }

  // ---- SELF-HEAL #1: any floor the hero cannot reach becomes brush ----
  const spawn = { x: 30, y: 30 };
  grid[idx(spawn.x, spawn.y)] = TILE_FLOOR;
  const reachable = (): Uint8Array => {
    const seen = new Uint8Array(W * H);
    const stack = [idx(spawn.x, spawn.y)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W;
      const y = (i - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if (seen[j] || grid[j] !== TILE_FLOOR) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    return seen;
  };
  let seen = reachable();
  for (let i = 0; i < grid.length; i++) if (grid[i] === TILE_FLOOR && !seen[i]) grid[i] = TILE_BLOCKED;

  // ---- DENSE FILL (it.44): tree clusters and bush tufts on every open lawn ----
  // A tree may only land on plain grass whose four neighbours are open grass
  // (never beside paint, props, doors or the belt), so no route is ever cut;
  // a final flood fill re-checks and undoes any that still would.
  const openGrass = (x: number, y: number): boolean =>
    inside(x, y) && grid[idx(x, y)] === TILE_FLOOR && tileKind[idx(x, y)] === KIND_GRASS && !belt[idx(x, y)];
  const candidates: number[] = [];
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      if (!openGrass(x, y)) continue;
      if (!openGrass(x + 1, y) || !openGrass(x - 1, y) || !openGrass(x, y + 1) || !openGrass(x, y - 1)) continue;
      candidates.push(idx(x, y));
    }
  }
  const before = seen.reduce((a, b) => a + b, 0);
  for (const i of candidates) {
    const x = i % W;
    const y = (i - x) / W;
    const roll = rand();
    if (roll < 0.09 && grid[i] === TILE_FLOOR) {
      // Cluster seed: a tree here and maybe a companion beside it.
      const v = roll < 0.03 ? 'pine_a' : roll < 0.05 ? 'pine_b' : roll < 0.07 ? 'pine_c' : rand() < 0.5 ? 'dead_a' : 'dead_b';
      grid[i] = TILE_BLOCKED;
      props.push({ kind: v.startsWith('dead') ? 'deadtree' : 'pine', x, y, variant: v });
      const after = reachable();
      if (after.reduce((a, b) => a + b, 0) < before - 1) {
        // It sealed something off — take it back.
        grid[i] = TILE_FLOOR;
        props.pop();
      }
    } else if (roll < 0.26) {
      decal({ kind: 'grassclump', x, y }); // A bush tuft.
    }
  }
  seen = reachable();
  for (let i = 0; i < grid.length; i++) if (grid[i] === TILE_FLOOR && !seen[i]) grid[i] = TILE_BLOCKED;

  const wander: Room = { x: 21, y: 16, w: 19, h: 13 };
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
    stash: { x: 14, y: 23 },
    merchant: {
      x: 24,
      y: 16,
      tiles: [
        { x: 23, y: 17 },
        { x: 24, y: 17 },
        { x: 25, y: 17 },
        { x: 23, y: 18 },
        { x: 24, y: 18 },
        { x: 25, y: 18 },
      ],
    },
    campfire,
    campSpots,
    portal: { x: 43, y: 37 },
    wander,
    houses,
    guards,
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
