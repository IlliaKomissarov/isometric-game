/**
 * @module town/TownMap
 * FLOOR 0 — the handcrafted town (it.39, redesigned it.40, ORGANIC it.43).
 * A 56×50 map whose edge is a noise-carved blob, not a rectangle:
 *
 *   outside the blob:  cliffs (the map's only true walls)
 *   the belt inside:   dense pines and dead trees, brush between them
 *   the interior:      a winding cobbled MAIN STREET from the ruin gate
 *                      up to the MARKET SQUARE (stalls, the shopkeeper,
 *                      the well), a HIGH STREET east–west, dirt lanes to
 *                      five cottages and the TAVERN, the STASH VAULT (NW),
 *                      the CAMPSITE clearing (SW), the portal stone (SE),
 *                      torch posts along every street, two gate guards.
 *
 * Every standing object claims a TILE_BLOCKED footprint BEFORE the scene
 * builds (the Diablo collision rule); flat decals stay walkable. Cottages
 * keep their door column walkable (roof cutaway inside). After carving, a
 * flood fill from the spawn turns every unreachable floor pocket into
 * brush, so the organic edge can never trap anyone; `auditTownLayout()`
 * then verifies every point of interest is reachable.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type DungeonMap, type Room } from '@/scenes/DungeonGenerator';
import { mulberry32 } from '@/utils/rng';

export const TOWN_W = 56;
export const TOWN_H = 50;

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
  const rand = mulberry32(0x70711);
  const grid = new Uint8Array(W * H).fill(TILE_FLOOR);
  const tileKind = new Uint8Array(W * H).fill(KIND_GRASS);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // ---- THE BLOB: polar radius with three sines + a bump toward the gate (south) ----
  const CX = 28;
  const CY = 24.5;
  const radiusAt = (theta: number): number => {
    const bump = 4.5 * Math.exp(-((theta - Math.PI / 2) ** 2) / 0.12);
    return 22.5 + 2.6 * Math.sin(2 * theta + 1.3) + 1.8 * Math.sin(5 * theta + 0.4) + 1.4 * Math.sin(3 * theta + 2.6) + bump;
  };
  /** Distance from the centre in "blob units" (elliptical). */
  const polar = (x: number, y: number): { r: number; theta: number } => {
    const dx = (x + 0.5 - CX) / 1.12;
    const dy = (y + 0.5 - CY) / 0.94;
    return { r: Math.hypot(dx, dy), theta: Math.atan2(dy, dx) };
  };
  const belt = new Uint8Array(W * H); // 1 = forest belt tile (blocked unless a street forces it)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const { r, theta } = polar(x, y);
      const R = radiusAt(theta);
      if (r > R || x === 0 || y === 0 || x === W - 1 || y === H - 1) grid[idx(x, y)] = TILE_WALL;
      else if (r > R - 2.6) belt[idx(x, y)] = 1;
    }
  }

  /** A street: thick polyline painted `kind`, forced to open floor (through belt/brush). */
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
  /** A filled ellipse of paint (the square, the camp clearing). */
  const ellipse = (cx: number, cy: number, rx: number, ry: number, kind: number): void => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (!inside(x, y)) continue;
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) {
          if (grid[idx(x, y)] === TILE_WALL) continue;
          tileKind[idx(x, y)] = kind;
          belt[idx(x, y)] = 0;
        }
      }
    }
  };

  // ---- STREETS ----
  const gate = { x: 28, y: 43 }; // The archway's front-centre tile: walk in, descend.
  ellipse(30, 15.5, 8.5, 6, KIND_COBBLE); // The market square.
  street([[28, 45], [28, 41], [26.5, 37], [25.5, 32], [27, 27], [29, 23], [30, 20]], KIND_COBBLE, 1.4); // Main street.
  street([[9, 25], [14, 27], [20, 26], [26, 27], [33, 28], [40, 26], [47, 23]], KIND_COBBLE, 1.1); // High street.
  street([[21, 14], [16, 17], [13, 20], [11, 24]], KIND_DIRT, 1.0); // Tavern lane to the west road.
  street([[38, 19], [42, 18], [45, 15]], KIND_DIRT, 1.0); // To the east cottage.
  street([[14, 27], [12, 31]], KIND_DIRT, 0.9); // West cottage.
  street([[40, 26], [43, 31]], KIND_DIRT, 0.9); // East cottage.
  street([[33, 28], [37, 33], [38, 37]], KIND_DIRT, 0.9); // South-east cottage + portal.
  street([[20, 26], [17, 30], [17, 33]], KIND_DIRT, 1.0); // To the camp.
  street([[13, 20], [15, 22]], KIND_DIRT, 0.9); // To the vault.
  ellipse(17.5, 34.5, 4.5, 3.6, KIND_DIRT); // Camp clearing.
  ellipse(34.5, 33.5, 2.5, 2, KIND_DIRT); // Portal stone yard.

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
        if (ty >= y + h) tileKind[idx(tx, ty)] = kind === KIND_GRASS ? tileKind[idx(tx, ty)] : kind;
      }
    }
  };
  /** A cottage: 3×3 blocked, except the door column (inside + doorstep). */
  const house = (x: number, y: number, variant: string): void => {
    clearFor(x, y, 3, 3);
    block({ kind: 'house', x, y, w: 3, h: 3, variant });
    grid[idx(x + 1, y + 1)] = TILE_FLOOR; // The room.
    grid[idx(x + 1, y + 2)] = TILE_FLOOR; // The doorstep.
    tileKind[idx(x + 1, y + 2)] = KIND_DIRT;
    tileKind[idx(x + 1, y + 1)] = KIND_DIRT;
    houses.push({ x, y, w: 3, h: 3 });
  };

  // The tavern (NW of the square): a 5×4 footprint, a stone stair and a table outside.
  clearFor(19, 9, 5, 4, 1);
  block({ kind: 'tavern', x: 19, y: 9, w: 5, h: 4, variant: 'tavern_a' });
  decal({ kind: 'stairs_stone', x: 21, y: 13 });
  block({ kind: 'table_chairs', x: 24, y: 12 });
  block({ kind: 'barrels_stacked', x: 18, y: 12 });
  block({ kind: 'supports', x: 17, y: 9, w: 1, h: 1 });
  block({ kind: 'torch', x: 24, y: 9 });

  // Market square: four stalls, the shopkeeper, the well, crates and barrels, signs, torches.
  block({ kind: 'stall', x: 25, y: 11, w: 3, h: 2, variant: 'stall_a' });
  block({ kind: 'merchant', x: 26, y: 10 });
  block({ kind: 'stall', x: 33, y: 11, w: 3, h: 2, variant: 'stall_b' });
  block({ kind: 'stall', x: 25, y: 18, w: 3, h: 2, variant: 'stall_c' });
  block({ kind: 'stall', x: 33, y: 18, w: 3, h: 2, variant: 'stall_d' });
  block({ kind: 'well', x: 30, y: 15, w: 2, h: 2, variant: 'well_b' });
  block({ kind: 'crates_wood', x: 29, y: 10 });
  block({ kind: 'barrel', x: 36, y: 13, variant: 'barrel_a' });
  block({ kind: 'wood_pile', x: 23, y: 17 });
  block({ kind: 'barrels_stacked', x: 37, y: 17 });
  decal({ kind: 'pots', x: 28, y: 13 });
  decal({ kind: 'pots', x: 32, y: 20 });
  decal({ kind: 'hanging_sign', x: 28, y: 12 });
  decal({ kind: 'hanging_sign', x: 33, y: 13 });
  decal({ kind: 'signpost', x: 31, y: 21 });
  for (const [x, y] of [[23, 11], [38, 11], [23, 20], [38, 20]] as const) block({ kind: 'torch', x, y });
  // Columns flank the square's southern mouth.
  block({ kind: 'column', x: 28, y: 22 });
  block({ kind: 'column', x: 32, y: 22 });

  // Stash vault (NW).
  clearFor(14, 21, 3, 2, 1);
  block({ kind: 'stash', x: 15, y: 22 });
  block({ kind: 'barrel', x: 14, y: 21, variant: 'barrel_a' });
  block({ kind: 'barrel', x: 16, y: 21, variant: 'barrel_b' });
  block({ kind: 'crates', x: 13, y: 22 });
  block({ kind: 'torch', x: 17, y: 22 });

  // Cottages.
  house(11, 15, 'house_a');
  house(43, 13, 'house_b');
  house(11, 31, 'house_c');
  house(43, 31, 'house_d');
  house(37, 37, 'house_a');
  for (const x of [10, 11, 13, 14]) block({ kind: 'fence', x, y: 18 });
  for (const x of [42, 43, 45, 46]) block({ kind: 'fence', x, y: 16 }); // Door column (44) stays open.
  block({ kind: 'torch', x: 15, y: 32 });
  block({ kind: 'torch', x: 41, y: 33 });

  // Campsite (SW): the fire, the heroes' spots, seats and stores.
  const campfire = { x: 17, y: 34 };
  block({ kind: 'campfire', x: campfire.x, y: campfire.y });
  const campSpots = [
    { x: 15.5, y: 33.4 },
    { x: 16.6, y: 36.5 },
    { x: 19.5, y: 34.6 },
  ];
  block({ kind: 'wood_pile', x: 20, y: 32 });
  block({ kind: 'barrels_stacked', x: 14, y: 36 });
  decal({ kind: 'pots', x: 19, y: 36 });
  block({ kind: 'torch', x: 21, y: 36 });

  // Torch posts along the main and high streets.
  for (const [x, y] of [[26, 40], [30, 40], [24, 34], [28, 34], [25, 29], [29, 29], [12, 24], [18, 24], [24, 25], [31, 26], [38, 24], [45, 22]] as const) {
    if (grid[idx(x, y)] === TILE_FLOOR) block({ kind: 'torch', x, y });
  }

  // The DUNGEON GATE: the ruin archway across the main street, braziers, guards.
  clearFor(26, 42, 5, 3, 0, KIND_COBBLE);
  props.push({ kind: 'ruingate', x: 27, y: 43, w: 3, h: 2 });
  for (let y = 43; y <= 44; y++) for (let x = 27; x <= 29; x++) grid[idx(x, y)] = TILE_BLOCKED;
  grid[idx(gate.x, gate.y)] = TILE_FLOOR;
  tileKind[idx(gate.x, gate.y)] = KIND_COBBLE;
  block({ kind: 'brazier', x: 25, y: 43 });
  block({ kind: 'brazier', x: 31, y: 43 });
  const guards = [
    { x: 26, y: 41 },
    { x: 30, y: 41 },
  ];
  for (const g of guards) block({ kind: 'guard', x: g.x, y: g.y });
  for (let y = 45; y < H; y++) for (let x = 26; x <= 30; x++) if (inside(x, y)) grid[idx(x, y)] = TILE_WALL;

  // ---- FOREST BELT: pines and dead trees on belt tiles, brush between ----
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (!belt[i] || grid[i] !== TILE_FLOOR) continue;
      grid[i] = TILE_BLOCKED;
      const roll = rand();
      if (roll < 0.42) {
        const v = roll < 0.16 ? 'pine_a' : roll < 0.28 ? 'pine_b' : roll < 0.36 ? 'pine_c' : rand() < 0.5 ? 'dead_a' : 'dead_b';
        props.push({ kind: v.startsWith('dead') ? 'deadtree' : 'pine', x, y, variant: v });
      }
    }
  }
  // Thickets inside: a few pines shaping the quarters (never on paint).
  for (const [x, y, v] of [[20, 5, 'pine_a'], [40, 6, 'pine_c'], [8, 20, 'pine_b'], [48, 19, 'pine_a'], [8, 37, 'dead_a'], [47, 38, 'pine_b'], [22, 41, 'dead_b'], [35, 41, 'pine_c'], [40, 30, 'pine_a'], [22, 29, 'pine_c']] as const) {
    if (inside(x, y) && grid[idx(x, y)] === TILE_FLOOR && tileKind[idx(x, y)] === KIND_GRASS) block({ kind: v.startsWith('dead') ? 'deadtree' : 'pine', x, y, variant: v });
  }
  // Grass clumps on open grass.
  for (let n = 0; n < 40; n++) {
    const x = 2 + Math.floor(rand() * (W - 4));
    const y = 2 + Math.floor(rand() * (H - 4));
    if (grid[idx(x, y)] === TILE_FLOOR && tileKind[idx(x, y)] === KIND_GRASS && !belt[idx(x, y)]) decal({ kind: 'grassclump', x, y });
  }

  // ---- SELF-HEAL: any floor the hero cannot reach becomes brush ----
  const spawn = { x: 28, y: 30 };
  grid[idx(spawn.x, spawn.y)] = TILE_FLOOR;
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
  for (let i = 0; i < grid.length; i++) if (grid[i] === TILE_FLOOR && !seen[i]) grid[i] = TILE_BLOCKED;

  const wander: Room = { x: 23, y: 11, w: 15, h: 11 };
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
    stash: { x: 15, y: 22 },
    merchant: {
      x: 26,
      y: 10,
      tiles: [
        { x: 25, y: 11 },
        { x: 26, y: 11 },
        { x: 27, y: 11 },
        { x: 25, y: 12 },
        { x: 26, y: 12 },
        { x: 27, y: 12 },
      ],
    },
    campfire,
    campSpots,
    portal: { x: 34, y: 33 },
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
