/**
 * @module scenes/Cellar
 * THE CELLAR UNDER THE GILDED STAG (it.97) — the inn's own floor below the
 * taproom, built from the Ancient Isometric Tileset's darkest stone:
 *
 *   - near-black rough-stone wall runs (`cellar_wall_n/w`) around the whole
 *     vault, one piece every TWO tiles, seated the way the inn's are,
 *   - two internal wall runs that cut the vault into three chambers, opened by
 *     REAL ROUND STONE ARCHES (`cellar_arch_n/w`, the tileset's doorway_3),
 *   - damp flagstone underfoot with packed earth where the floor has worn
 *     through, stone piers and columns holding the roof up,
 *   - the taproom's stock — casks, crates, the bottle shelves the keeper wants
 *     back — webs, rubble and old stains,
 *   - three lockable chests, and an alcove at the deep end where the keeper's
 *     serving woman has been hiding since the looters came.
 *
 * Unlike the taproom this floor is DARK: it takes the dungeon's fog, so the
 * chambers open up a few tiles at a time and the woman is not seen until the
 * hero reaches her.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL } from '@/scenes/DungeonGenerator';
import { CLUTTER_KINDS, KIND_CELLAR_DIRT, KIND_CELLAR_FLAG, type CellarLayout, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { bareLayout } from './Forest';

export const CELLAR_W = 34;
export const CELLAR_H = 26;

/** The vault's four corners (inclusive). */
const VAULT = { x0: 2, y0: 2, x1: 31, y1: 23 };
/** The cross wall that splits the stock room from the deep chambers, and its two arches. */
const CROSS_Y = 10;
const CROSS_ARCH = [8, 22]; // the arch PIECES; each opening is over the piece's second tile
/** The spur wall between the two deep chambers, and its arch. */
const SPUR_X = 17;
const SPUR_ARCH_Y = 15;
/** The stair back up to the taproom, in the north-west corner. */
const STAIR = { x: 4, y: 3 };

export function buildCellarLayout(seed: number, rescued = false): { layout: TownLayout; cellar: CellarLayout } {
  const W = CELLAR_W;
  const H = CELLAR_H;
  const grid = new Uint8Array(W * H).fill(TILE_WALL);
  const tileKind = new Uint8Array(W * H).fill(KIND_CELLAR_FLAG);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // ---- the floor: the vault less its two internal wall runs
  for (let y = VAULT.y0; y <= VAULT.y1; y++)
    for (let x = VAULT.x0; x <= VAULT.x1; x++) {
      const onCross = y === CROSS_Y;
      const onSpur = x === SPUR_X && y > CROSS_Y;
      if (onCross || onSpur) continue;
      grid[idx(x, y)] = TILE_FLOOR;
    }
  // the archways themselves: each arch piece spans two tiles, the opening is the second
  for (const ax of CROSS_ARCH) grid[idx(ax + 1, CROSS_Y)] = TILE_FLOOR;
  grid[idx(SPUR_X, SPUR_ARCH_Y + 1)] = TILE_FLOOR;
  // packed earth where the flags have worn through: the deep chambers' middles
  for (let y = 13; y <= 21; y++) for (let x = 4; x <= 13; x++) tileKind[idx(x, y)] = KIND_CELLAR_DIRT;
  for (let y = 16; y <= 22; y++) for (let x = 21; x <= 29; x++) tileKind[idx(x, y)] = KIND_CELLAR_DIRT;

  const props: TownProp[] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    if (CLUTTER_KINDS.has(p.kind)) return;
    for (let y = p.y; y < p.y + (p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) if (inside(x, y)) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };
  const put = (variant: string, x: number, y: number, ox = 0, oy = 0, solid = true): void => {
    const p: TownProp = { kind: solid ? 'innprop' : 'inndeco', x, y, variant, ox, oy };
    if (solid) block(p);
    else decal(p);
  };
  const flat = (variant: string, x: number, y: number, ox = 0, oy = 0): void => decal({ kind: 'innrug', x, y, variant, ox, oy });
  const wallN = (x: number, y: number, variant: string): void => decal({ kind: 'innwall', x, y, w: 2, h: 1, variant });
  const wallW = (x: number, y: number, variant: string): void => decal({ kind: 'innwall', x, y, w: 1, h: 2, variant });

  // ---- THE WALLS -------------------------------------------------------
  for (let x = VAULT.x0; x <= VAULT.x1; x += 2) wallN(x, 1, 'cellar_wall_n');
  for (let y = VAULT.y0; y <= VAULT.y1; y += 2) wallW(1, y, 'cellar_wall_w');
  for (let x = VAULT.x0; x <= VAULT.x1; x += 2) wallN(x, CROSS_Y, CROSS_ARCH.includes(x) ? 'cellar_arch_n' : 'cellar_brick_n');
  for (let y = CROSS_Y + 1; y <= VAULT.y1; y += 2) wallW(SPUR_X, y, y === SPUR_ARCH_Y ? 'cellar_arch_w' : 'cellar_brick_w');

  // ---- THE WAY BACK UP -------------------------------------------------
  const up = { x: STAIR.x, y: STAIR.y };
  const spawn = { x: STAIR.x, y: STAIR.y + 1 };
  put('cellar_stairs', STAIR.x, STAIR.y - 1, 0.1, 0.2);
  decal({ kind: 'cellarup', x: up.x, y: up.y });

  // ---- THE STOCK ROOM (the keeper's drink, which is the whole errand) ----
  put('cellar_pier_a', 12, 2, 0, 0, true);
  put('cellar_pier_b', 26, 2, 0, 0, true);
  for (const [x, y] of [[7, 3], [10, 8], [16, 4], [20, 8], [25, 5], [29, 8]] as const) put('cellar_pillar', x, y, 0.2, 0.1);
  put('inn_shelf_bottles', 6, 2, 0.35, -0.1);
  put('inn_shelf_bottles', 18, 2, 0.35, -0.1);
  put('inn_barrels', 3, 6, 0.2, 0.1);
  put('inn_barrels', 22, 3, 0.2, 0.1);
  put('inn_barrel', 14, 8, 0.3, 0);
  put('inn_barrel', 28, 4, 0.3, 0);
  put('cellar_crates', 8, 6, 0.2, 0.1);
  put('cellar_crate', 24, 7, 0.3, 0.1);
  put('cellar_pots', 19, 6, 0.3, 0);
  decal({ kind: 'inndeco', x: 11, y: 5, variant: 'cellar_goods', ox: 0.3, oy: 0.2 });

  // ---- THE WEST VAULT (dirt floor, fallen stone) ------------------------
  put('cellar_vault_a', 3, 12, 0, 0, true);
  put('cellar_vault_b', 13, 20, 0, 0, true);
  for (const [x, y] of [[7, 13], [11, 17], [5, 21], [14, 14]] as const) put('cellar_post', x, y, 0.2, 0.1);
  put('cellar_altar', 9, 19, 0.1, 0.1);
  put('inn_barrel', 3, 17, 0.3, 0);
  put('cellar_crates', 15, 12, 0.2, 0.1);
  for (const [x, y] of [[6, 16], [12, 22], [4, 14]] as const) decal({ kind: 'inndeco', x, y, variant: 'cellar_rubble_a', ox: 0.3, oy: 0.2 });
  for (const [x, y] of [[10, 13], [8, 22]] as const) decal({ kind: 'inndeco', x, y, variant: 'cellar_rubble_b', ox: 0.3, oy: 0.2 });

  // ---- THE DEEP CHAMBER (the far end, where she is) ---------------------
  put('cellar_vault_a', 24, 12, 0, 0, true);
  for (const [x, y] of [[20, 14], [28, 18], [22, 21]] as const) put('cellar_post', x, y, 0.2, 0.1);
  put('cellar_crates', 30, 13, 0.2, 0.1);
  put('inn_barrels', 19, 22, 0.2, 0.1);
  put('cellar_pots', 26, 16, 0.3, 0);
  for (const [x, y] of [[25, 20], [21, 17]] as const) decal({ kind: 'inndeco', x, y, variant: 'cellar_rubble_a', ox: 0.3, oy: 0.2 });

  // webs in the corners, damp and old blood on the flags
  for (const [x, y] of [[2, 2], [31, 2], [2, 23], [31, 23], [18, 11], [16, 23]] as const)
    decal({ kind: 'inndeco', x, y, variant: 'cellar_web', ox: 0.4, oy: 0.1, lift: 58 });
  for (const [x, y] of [[9, 15], [23, 19], [6, 20]] as const) flat('cellar_stain_a', x, y, 0.3, 0.2);
  for (const [x, y] of [[12, 18], [27, 21]] as const) flat('cellar_stain_b', x, y, 0.3, 0.2);

  // a few torches, and no more: the point of a cellar is that it is dark
  for (const [x, y] of [[6, 1], [20, 1]] as const) decal({ kind: 'sconce', x, y, ox: 0.55, oy: 0.4 });
  for (const y of [6, 18]) decal({ kind: 'sconce', x: 1, y, ox: 0.5, oy: 0.55 });
  decal({ kind: 'sconce', x: SPUR_X, y: 20, ox: 0.5, oy: 0.55 });

  // ---- THE WOMAN, until she is walked back up ---------------------------
  const girl = { x: 29, y: 22 };
  if (!rescued) {
    block({ kind: 'cellargirl', x: girl.x, y: girl.y });
    put('cellar_crate', 30, 21, 0.2, 0.1); // the crates she has been hiding behind
  }

  // ---- three chests, off the paths --------------------------------------
  const chestSpots = [{ x: 30, y: 17 }, { x: 3, y: 22 }, { x: 15, y: 5 }];

  // ---- nothing may be walled into a pocket ------------------------------
  {
    const seen = new Uint8Array(W * H);
    const stack = [idx(spawn.x, spawn.y)];
    grid[stack[0]] = TILE_FLOOR;
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
  }

  const map: TownMap = {
    width: W,
    height: H,
    grid,
    // rooms[0] is the stair yard and is never filled; the rest are what the spawner stocks.
    rooms: [
      { x: 3, y: 2, w: 5, h: 5 },
      { x: 12, y: 3, w: 9, h: 6 },
      { x: 4, y: 13, w: 11, h: 9 },
      { x: 20, y: 13, w: 9, h: 8 },
    ],
    spawn,
    seed,
    tileKind,
    wallsFromProps: true,
  };
  const layout = bareLayout(map, props, 'THE CELLAR');
  layout.wander = { x: 4, y: 3, w: 6, h: 5 };
  layout.houses = [];
  layout.chests = [];
  for (const c of chestSpots) {
    if (grid[idx(c.x, c.y)] !== TILE_FLOOR) continue;
    grid[idx(c.x, c.y)] = TILE_BLOCKED;
    layout.chests.push(c);
  }
  const cellar: CellarLayout = { up, girl, rescued };
  layout.cellar = cellar;
  return { layout, cellar };
}
