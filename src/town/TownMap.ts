/**
 * @module town/TownMap
 * FLOOR 0 — the handcrafted town (it.39). A 34×30 walled square:
 *
 *   NW: the STASH VAULT (iron-bound chest, barrels, crates)
 *   NE: the MERCHANT CORNER (canopied stall + shopkeeper)
 *   centre: the CAMPFIRE, the well, torch posts
 *   S:  the SEALED DUNGEON GATE (pillars + torches around the stairwell)
 *   corners: four cottages (the same rendered house at four rotations)
 *
 * Every standing object claims a TILE_BLOCKED footprint BEFORE the scene
 * builds (the Diablo collision rule from it.16); flat decals stay walkable.
 * The map is a plain `DungeonMap` so pathing, lighting and rendering treat
 * the town like any floor — plus a `tileKind` layer (cobble / grass / dirt)
 * that the SceneManager paints in the 'town' theme.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type DungeonMap, type Room } from '@/scenes/DungeonGenerator';

export const TOWN_W = 34;
export const TOWN_H = 30;

/** Ground paint per tile in the town theme. */
export const KIND_COBBLE = 0;
export const KIND_GRASS = 1;
export const KIND_DIRT = 2;

export type TownPropKind =
  | 'house'
  | 'stall'
  | 'campfire'
  | 'well'
  | 'stash'
  | 'pillar'
  | 'torch'
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
  /** Where a town portal from the depths deposits the hero (and its return portal). */
  portal: { x: number; y: number };
  /** Villagers wander inside this room. */
  wander: Room;
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

  // Walled border.
  for (let x = 0; x < W; x++) {
    grid[idx(x, 0)] = TILE_WALL;
    grid[idx(x, H - 1)] = TILE_WALL;
  }
  for (let y = 0; y < H; y++) {
    grid[idx(0, y)] = TILE_WALL;
    grid[idx(W - 1, y)] = TILE_WALL;
  }

  // Ground paint: the cobbled square, dirt lanes to the gate and the corners.
  const paint = (x0: number, y0: number, x1: number, y1: number, kind: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tileKind[idx(x, y)] = kind;
  };
  paint(10, 9, 24, 23, KIND_COBBLE);
  paint(16, 23, 18, 27, KIND_DIRT); // Lane to the gate.
  paint(6, 6, 10, 9, KIND_DIRT); // Lane to the vault.
  paint(22, 6, 27, 9, KIND_DIRT); // Lane to the merchant.
  paint(6, 20, 9, 24, KIND_DIRT);
  paint(25, 20, 28, 24, KIND_DIRT);

  const props: TownProp[] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    const w = p.w ?? 1;
    const h = p.h ?? 1;
    for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };

  // Cottages in the four corners (four rotations of the rendered house).
  block({ kind: 'house', x: 3, y: 3, w: 3, h: 3, variant: 'house_a' });
  block({ kind: 'house', x: 27, y: 3, w: 3, h: 3, variant: 'house_b' });
  block({ kind: 'house', x: 3, y: 22, w: 3, h: 3, variant: 'house_c' });
  block({ kind: 'house', x: 27, y: 22, w: 3, h: 3, variant: 'house_d' });

  // Merchant corner (NE): canopied stall, the shopkeeper behind it.
  block({ kind: 'stall', x: 24, y: 10, w: 3, h: 2, variant: 'stall_a' });
  block({ kind: 'merchant', x: 25, y: 9 });
  block({ kind: 'crates', x: 28, y: 10 });
  decal({ kind: 'hanging_sign', x: 23, y: 12 });

  // Stash vault (NW): the iron-bound chest with its barrels.
  block({ kind: 'stash', x: 8, y: 11 });
  block({ kind: 'barrel', x: 7, y: 10, variant: 'barrel_a' });
  block({ kind: 'barrel', x: 9, y: 10, variant: 'barrel_b' });
  block({ kind: 'crates', x: 6, y: 11 });
  decal({ kind: 'signpost', x: 10, y: 12 });

  // Centre: the campfire and the well.
  block({ kind: 'campfire', x: 17, y: 15 });
  block({ kind: 'well', x: 12, y: 18 });

  // Torch posts at the square's corners and flanking the gate.
  for (const [x, y] of [[11, 10], [23, 10], [11, 22], [23, 22], [15, 26], [19, 26]] as const) {
    block({ kind: 'torch', x, y });
  }
  // The dungeon gate: pillars either side of the stairwell (the stair tile stays walkable).
  block({ kind: 'pillar', x: 15, y: 27 });
  block({ kind: 'pillar', x: 19, y: 27 });
  // Fences hemming the cottages' yards.
  for (const x of [3, 4, 5]) block({ kind: 'fence', x, y: 7 });
  for (const x of [27, 28, 29]) block({ kind: 'fence', x, y: 7 });
  for (const x of [3, 4, 5]) block({ kind: 'fence', x, y: 21 });
  for (const x of [27, 28, 29]) block({ kind: 'fence', x, y: 21 });
  // Trees along the walls.
  for (const [x, y] of [[2, 13], [2, 17], [31, 13], [31, 17], [12, 2], [21, 2], [9, 27], [25, 27]] as const) {
    block({ kind: 'tree', x, y, variant: (x + y) % 2 ? 'tree_a' : 'tree_b' });
  }
  // Flat dressing.
  for (const [x, y] of [[8, 16], [26, 16], [13, 24], [21, 24], [7, 8], [27, 13]] as const) decal({ kind: 'grassclump', x, y });
  decal({ kind: 'pots', x: 26, y: 12 });
  decal({ kind: 'pots', x: 10, y: 9 });

  const gate = { x: 17, y: 27 };
  const spawn = { x: 17, y: 20 };
  const wander: Room = { x: 11, y: 11, w: 13, h: 12 };
  const map: TownMap = {
    width: W,
    height: H,
    grid,
    rooms: [{ x: 1, y: 1, w: W - 2, h: H - 2 }],
    spawn,
    seed: 0,
    tileKind,
  };
  return {
    map,
    props,
    gate,
    stash: { x: 8, y: 11 },
    merchant: {
      x: 25,
      y: 9,
      tiles: [
        { x: 24, y: 10 },
        { x: 25, y: 10 },
        { x: 26, y: 10 },
        { x: 24, y: 11 },
        { x: 25, y: 11 },
        { x: 26, y: 11 },
      ],
    },
    campfire: { x: 17, y: 15 },
    portal: { x: 20, y: 19 },
    wander,
  };
}
