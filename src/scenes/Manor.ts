/**
 * @module scenes/Manor
 * THE MANOR ON THE BATTLEFIELD (it.110) — the great hall inside the one house
 * left standing, and the cellar under it.
 *
 * TWO FLOORS, ONE FILE, because they are one place:
 *
 *   `buildManorLayout`  THE HALL. Built out of the Ancient Isometric Tileset the
 *                       inn is built from, but longer, taller-ceilinged and
 *                       richer: a hearth in the west wall, two long feast tables
 *                       down the middle of it, a high table at the far end, and
 *                       a company of bandits holding a party in somebody else's
 *                       house. Behind the high table, a closet door - and behind
 *                       that, the merchant they are holding to ransom.
 *   `buildVaultLayout`  THE CELLAR. The manor's own vault, reached by a hatch in
 *                       the hall floor: three chambers of near-black stone, dark
 *                       enough to need the fog, with whatever has been living
 *                       down there since the household ran.
 *
 * THE HALL HAS TWO STATES and the layout is a pure function of which:
 *
 *   HELD     the chief is at the head of the high table with his men round the
 *            fires and the tables, the closet is shut, the hatch is under a rug.
 *   CLEARED  the hall is quiet, the merchant is standing in front of the closet
 *            he spent nine days in, and the hatch is uncovered and lit.
 *
 * A NOTE ON DIRECTION. The tileset only paints the two BACK walls of a room -
 * the north run along `y = 1` and the west run along `x = 1` - because in an
 * isometric view the other two would stand between the camera and the floor. So
 * everything that has to be IN a wall (the way out, the closet) is in one of
 * those two, and the hall opens toward the viewer.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type Room } from '@/scenes/DungeonGenerator';
import { CLUTTER_KINDS, KIND_CELLAR_DIRT, KIND_CELLAR_FLAG, KIND_INN_BOARDS, KIND_INN_STONE, type ManorLayout, type TownLayout, type TownMap, type TownProp, type VaultLayout } from '@/town/TownMap';
import { bareLayout } from './Forest';

export const MANOR_W = 36;
export const MANOR_H = 28;

/** The hall's four corners (inclusive). */
const HALL = { x0: 2, y0: 2, x1: 33, y1: 25 };
/** The way out to the field: an arch in the north wall over tiles (6,1) and (7,1). */
const OUT_PIECE_X = 6;
/** THE CLOSET: a door leaf in the north wall over (28,1) and (29,1); its opening is (29,2). */
const CLOSET_PIECE_X = 28;
/** THE BASEMENT DOOR: a leaf in the west wall over (1,18) and (1,19) (it.110b). */
const BASEMENT_PIECE_Y = 18;

/**
 * @param cleared the chief is down and the merchant is away: the hall is quiet,
 *                the closet stands open and the hatch is uncovered.
 */
export function buildManorLayout(seed: number, cleared = false): { layout: TownLayout; manor: ManorLayout } {
  const W = MANOR_W;
  const H = MANOR_H;
  const grid = new Uint8Array(W * H).fill(TILE_WALL);
  const tileKind = new Uint8Array(W * H).fill(KIND_INN_BOARDS);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // ---- the floor ---------------------------------------------------------
  for (let y = HALL.y0; y <= HALL.y1; y++) for (let x = HALL.x0; x <= HALL.x1; x++) grid[idx(x, y)] = TILE_FLOOR;
  // Flagstone on the hearth's apron and under the high table: the two ends of
  // the room that were built to be looked at.
  for (let y = 6; y <= 14; y++) for (let x = 2; x <= 5; x++) tileKind[idx(x, y)] = KIND_INN_STONE;
  for (let y = 2; y <= 7; y++) for (let x = 24; x <= 33; x++) tileKind[idx(x, y)] = KIND_INN_STONE;

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
  const rug = (variant: string, x: number, y: number, ox = 0, oy = 0): void => decal({ kind: 'innrug', x, y, variant, ox, oy });
  const wallN = (x: number, y: number, variant: string): void => decal({ kind: 'innwall', x, y, w: 2, h: 1, variant });
  const wallW = (x: number, y: number, variant: string): void => decal({ kind: 'innwall', x, y, w: 1, h: 2, variant });

  // ---- THE WALLS ---------------------------------------------------------
  for (let x = HALL.x0; x <= HALL.x1; x += 2)
    wallN(x, 1, x === OUT_PIECE_X ? 'inn_arch_n' : x === CLOSET_PIECE_X ? (cleared ? 'inn_door_open' : 'inn_door_shut') : 'inn_wall_n');
  /**
   * THE WEST WALL, AND THE DOOR IN IT (it.110b). The hearth at 10, the basement
   * door at 18, and a blind arch at 22. The basement's leaf is a real door in a
   * real wall run - the same piece and the same idea as the Gilded Stag's own
   * cellar door (it.97) - rather than a trapdoor in the floorboards drawn with a
   * picture of a staircase going up.
   */
  for (let y = HALL.y0; y <= HALL.y1; y += 2)
    wallW(1, y, y === 10 ? 'inn_hearth_w' : y === BASEMENT_PIECE_Y ? (cleared ? 'inn_door_w_open' : 'inn_door_w_shut') : y === 22 ? 'inn_arch_w' : 'inn_wall_w');

  // ---- THE WAY OUT -------------------------------------------------------
  const out = { x: OUT_PIECE_X + 1, y: 2 };
  const spawn = { x: OUT_PIECE_X + 1, y: 4 };
  decal({ kind: 'manorout', x: out.x, y: out.y });

  // ---- THE HEARTH --------------------------------------------------------
  const hearth = { x: 2, y: 10 };
  decal({ kind: 'hearth', x: hearth.x, y: hearth.y });
  put('inn_chair_b', 4, 9, 0.15, 0.1, false);
  put('inn_chair_a', 4, 13, 0.15, -0.1, false);
  rug('inn_carpet_b', 4, 11, 0.4, 0);

  // ---- THE LONG TABLES ---------------------------------------------------
  // Two runs down the middle of the hall, laid for a party that was not the
  // household's. The tables are solid; the stools and chairs are not, so the
  // fight does not become a maze.
  const tableRows = [9, 17];
  for (const ty of tableRows) {
    for (let x = 9; x <= 25; x++) {
      put('inn_table', x, ty, (x * 1.5) % 1, 0.35);
      if (x % 3 === 0) put(x % 2 ? 'inn_chair_a' : 'inn_stool', x, ty - 1, 0.2, -0.15, false);
      if (x % 3 === 1) put(x % 2 ? 'inn_chair_b' : 'inn_stool', x, ty + 1, 0.2, 0.25, false);
      if (x % 4 === 0) decal({ kind: 'inndeco', x, y: ty, variant: x % 8 === 0 ? 'inn_plate' : 'inn_flasks', ox: 0.15, oy: -0.4 });
    }
    rug('inn_carpet_a', 13, ty + 3, 0.4, 0.2);
    rug('inn_carpet_a', 21, ty + 3, 0.2, 0.4);
  }

  // ---- THE HIGH TABLE ----------------------------------------------------
  // The far end, on the flagstones, with the chief's chair at the head of it and
  // the closet door in the wall behind him.
  const chief = { x: 28, y: 5 };
  for (let x = 26; x <= 31; x++) put('inn_bigtable', x, 4, 0.1, 0.2);
  put('inn_chair_b', 28, 3, 0.2, -0.2, false);
  put('inn_chair_a', 31, 3, 0.2, -0.2, false);
  put('inn_shelf_bottles', 25, 2, 0.35, -0.1);
  put('inn_bookshelf', 32, 2, 0.35, -0.1);
  decal({ kind: 'inndeco', x: 27, y: 4, variant: 'inn_plate', ox: 0.2, oy: -0.45 });
  decal({ kind: 'inndeco', x: 30, y: 4, variant: 'inn_flasks', ox: 0.1, oy: -0.45 });
  rug('inn_carpet_b', 28, 7, 0.3, 0.2);

  // ---- THE CLOSET --------------------------------------------------------
  // A cupboard door in the wall behind the high table. The leaf is part of the
  // wall run above; this is the mark under it, and the tile the man stands on
  // when he finally comes out of it.
  const closet = { x: CLOSET_PIECE_X + 1, y: 2 };
  /**
   * WHERE HE STANDS (it.110b). it.110 put him on the tile directly under the
   * closet door - which is BEHIND the high table, behind the bottle shelf and
   * behind the bookcase, all of which are drawn over him because they are nearer
   * the camera. He was a man-shaped hole in the furniture.
   *
   * He steps out onto the open flagstone in front of the dais instead: three
   * tiles clear of the table, nothing between him and the camera, and the light
   * and the name plate the dresser gives him make him the most obvious thing in
   * a room that no longer has anybody else standing in it.
   */
  const merchant = { x: CLOSET_PIECE_X - 1, y: 8 };
  if (cleared) {
    decal({ kind: 'merchantman', x: merchant.x, y: merchant.y });
    // WHAT THEY TOOK OFF HIS CARTS (it.111), set down beside him: a man with a
    // crate and a strongbox at his feet reads as a merchant before he says a
    // word, which no amount of livery does on its own. Clutter, so the tile in
    // front of him stays walkable and the hero can get to the prompt.
    decal({ kind: 'inndeco', x: merchant.x - 1, y: merchant.y + 1, variant: 'inn_goods_b', ox: 0.2, oy: 0.1 });
    decal({ kind: 'inndeco', x: merchant.x + 1, y: merchant.y + 1, variant: 'cellar_goods', ox: 0.2, oy: 0.1 });
    decal({ kind: 'innrug', x: merchant.x, y: merchant.y + 1, variant: 'inn_carpet_b', ox: 0.3, oy: 0.2 });
  }

  // ---- THE HOUSEHOLD'S GOODS, BEING DRUNK --------------------------------
  put('inn_barrels', 8, 2, 0.1, -0.1);
  put('inn_barrel', 12, 2, 0.3, 0);
  put('inn_crates', 16, 2, 0.2, -0.1);
  put('inn_crate', 20, 2, 0.2, -0.1);
  put('inn_pots', 22, 2, 0.3, -0.1);
  put('inn_cupboard', 2, 17, 0.35, 0);
  put('inn_barrels', 3, 23, 0.2, 0.1);
  put('inn_crates', 7, 24, 0.2, 0.1);
  put('inn_barrel', 15, 24, 0.3, 0.1);
  put('inn_crate', 24, 24, 0.2, 0.1);
  put('inn_bigtable', 30, 21, 0.2, 0.2);
  put('inn_cupboard', 32, 15, 0.2, 0);
  for (const [x, y, v] of [[11, 3, 'inn_goods_a'], [18, 3, 'inn_goods_c'], [26, 23, 'inn_goods_b'], [9, 23, 'inn_goods_d']] as const)
    decal({ kind: 'inndeco', x, y, variant: v, ox: 0.2, oy: -0.2 });

  // ---- THE AISLE ---------------------------------------------------------
  // The ground between the two table runs is where the whole fight happens, so
  // nothing may STAND in it - but eleven tiles of bare board down the middle of
  // a great hall reads as an unfinished room. It gets the household's own runner
  // and a line of candle stands, all of them clutter, all of them walk-through.
  for (let x = 8; x <= 26; x += 5) rug('inn_carpet_a', x, 13, 0.3, 0.2);
  for (let x = 10; x <= 25; x += 5) decal({ kind: 'candle', x, y: 13, ox: 0.3, oy: 0.1 });
  for (const [x, y] of [[12, 22], [20, 22], [28, 12], [6, 16]] as const) decal({ kind: 'candle', x, y, ox: 0.25, oy: 0.15 });
  rug('inn_carpet_b', 16, 23, 0.3, 0.2);
  rug('inn_carpet_b', 26, 20, 0.3, 0.2);

  // ---- LIGHT -------------------------------------------------------------
  // A hall this size has to be lit or it reads as a cave: torches along both
  // painted walls, and candles on the two long tables.
  for (const x of [4, 10, 14, 18, 22, 26, 32]) decal({ kind: 'sconce', x, y: 1, ox: 0.55, oy: 0.4 });
  for (const y of [4, 8, 14, 18, 22]) decal({ kind: 'sconce', x: 1, y, ox: 0.5, oy: 0.55 });
  // Two standing braziers at the south end, where no wall can carry a torch.
  for (const [x, y] of [[9, 24], [24, 23]] as const) decal({ kind: 'candle', x, y, ox: 0.3, oy: 0.1 });
  for (const [x, y] of [[12, 9], [22, 9], [12, 17], [22, 17]] as const) decal({ kind: 'candle', x, y, ox: 0.2, oy: -0.5 });
  for (const [x, y] of [[6, 1], [16, 1], [24, 1]] as const)
    decal({ kind: 'inndeco', x, y, variant: x === 16 ? 'inn_painting_b' : 'inn_painting_a', ox: 0.5, oy: 0.35, lift: 44 });

  // ---- THE WAY DOWN ------------------------------------------------------
  /**
   * THE BASEMENT DOOR (it.110b, made unmistakable it.111).
   *
   * it.110 drew a trapdoor here with the tileset's `cellar_stairs` - which is a
   * staircase going UP - so the way DOWN into the manor's vault was signposted
   * with a picture of the way out of one. It has been a real door in a real wall
   * run since it.110b; what it.111 adds is everything around it, because a leaf
   * in a thirty-two-tile wall is not by itself an announcement:
   *
   *   a flagged threshold in front of it, so the eye is led to that stretch of
   *   wall rather than to any of the other fifteen panels;
   *   a sconce either side of the leaf, which is the only pair on the run;
   *   and while it is BARRED, the bench the merchant says they kept across it,
   *   drawn on the threshold itself.
   */
  const basement = { x: 2, y: BASEMENT_PIECE_Y + 1 };
  for (let y = BASEMENT_PIECE_Y - 1; y <= BASEMENT_PIECE_Y + 2; y++)
    for (let x = 2; x <= 4; x++) if (inside(x, y)) tileKind[idx(x, y)] = KIND_INN_STONE;
  for (const y of [BASEMENT_PIECE_Y - 1, BASEMENT_PIECE_Y + 2]) decal({ kind: 'sconce', x: 1, y, ox: 0.5, oy: 0.55 });
  decal({ kind: 'manordown', x: basement.x, y: basement.y, variant: cleared ? 'open' : 'shut' });
  if (!cleared) decal({ kind: 'bench', x: basement.x, y: basement.y - 1, variant: 'bench_b', ox: 0.25, oy: 0.2 });
  rug('inn_carpet_a', 5, basement.y, 0.3, 0.1);

  // ---- THE COMPANY -------------------------------------------------------
  // Ten of them round the two tables and the fire, and the chief at the head of
  // the high one. Placed by the layout so every peer spawns the same room; the
  // cutscene wakes all of them at once when he gives the word.
  const bandits: Array<{ x: number; y: number }> = [];
  if (!cleared) {
    for (const [x, y] of [
      [11, 7], [15, 11], [19, 7], [23, 11],
      [11, 15], [15, 19], [19, 15], [23, 19],
      [6, 12], [26, 9], [9, 19], [27, 16],
    ] as const) {
      if (grid[idx(x, y)] !== TILE_FLOOR) continue;
      bandits.push({ x, y });
    }
  }

  // ---- nothing may be walled into a pocket -------------------------------
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

  const hall: Room = { x: 6, y: 6, w: 24, h: 16 };
  const map: TownMap = {
    width: W,
    height: H,
    grid,
    rooms: [{ x: 2, y: 2, w: W - 4, h: H - 4 }],
    spawn,
    seed,
    tileKind,
    wallsFromProps: true,
  };
  const layout = bareLayout(map, props, 'THE MANOR');
  layout.wander = hall;
  layout.houses = [];
  const manor: ManorLayout = { out, chief, bandits, closet, merchant, basement, hall, cleared };
  layout.manor = manor;
  return { layout, manor };
}

export const VAULT_W = 32;
export const VAULT_H = 24;

/** The vault's four corners (inclusive), and the two runs that cut it in three. */
const VAULT = { x0: 2, y0: 2, x1: 29, y1: 21 };
const CROSS_Y = 9;
const CROSS_ARCH = [8, 20];
const SPUR_X = 16;
const SPUR_ARCH_Y = 14;
/** The stair back up into the hall, in the north-west corner. */
const STAIR = { x: 4, y: 3 };

/**
 * THE MANOR'S CELLAR. Medium, dark, and full of what moves into a house whose
 * people have run: the same near-black stone the inn's vault is built from, with
 * the family's own strongboxes still in the deep chamber.
 */
export function buildVaultLayout(seed: number): { layout: TownLayout; vault: VaultLayout } {
  const W = VAULT_W;
  const H = VAULT_H;
  const grid = new Uint8Array(W * H).fill(TILE_WALL);
  const tileKind = new Uint8Array(W * H).fill(KIND_CELLAR_FLAG);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  for (let y = VAULT.y0; y <= VAULT.y1; y++)
    for (let x = VAULT.x0; x <= VAULT.x1; x++) {
      if (y === CROSS_Y) continue;
      if (x === SPUR_X && y > CROSS_Y) continue;
      grid[idx(x, y)] = TILE_FLOOR;
    }
  for (const ax of CROSS_ARCH) grid[idx(ax + 1, CROSS_Y)] = TILE_FLOOR;
  grid[idx(SPUR_X, SPUR_ARCH_Y + 1)] = TILE_FLOOR;
  // Packed earth where the flags have gone: the two deep chambers' middles.
  for (let y = 12; y <= 19; y++) for (let x = 4; x <= 13; x++) tileKind[idx(x, y)] = KIND_CELLAR_DIRT;
  for (let y = 15; y <= 20; y++) for (let x = 20; x <= 27; x++) tileKind[idx(x, y)] = KIND_CELLAR_DIRT;

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

  for (let x = VAULT.x0; x <= VAULT.x1; x += 2) wallN(x, 1, 'cellar_wall_n');
  for (let y = VAULT.y0; y <= VAULT.y1; y += 2) wallW(1, y, 'cellar_wall_w');
  for (let x = VAULT.x0; x <= VAULT.x1; x += 2) wallN(x, CROSS_Y, CROSS_ARCH.includes(x) ? 'cellar_arch_n' : 'cellar_brick_n');
  for (let y = CROSS_Y + 1; y <= VAULT.y1; y += 2) wallW(SPUR_X, y, y === SPUR_ARCH_Y ? 'cellar_arch_w' : 'cellar_brick_w');

  // ---- THE WAY BACK UP ---------------------------------------------------
  const up = { x: STAIR.x, y: STAIR.y };
  const spawn = { x: STAIR.x, y: STAIR.y + 1 };
  put('cellar_stairs', STAIR.x, STAIR.y - 1, 0.1, 0.2);
  decal({ kind: 'vaultup', x: up.x, y: up.y });

  // ---- THE STORE ROOM ----------------------------------------------------
  for (const [x, y] of [[7, 3], [11, 7], [15, 4], [20, 7], [25, 4], [27, 7]] as const) put('cellar_pillar', x, y, 0.2, 0.1);
  put('cellar_crates', 12, 2, 0.2, -0.1);
  put('inn_barrels', 24, 2, 0.2, -0.1);
  put('inn_shelf_bottles', 18, 2, 0.35, -0.1);
  put('inn_barrel', 5, 6, 0.3, 0);
  put('cellar_pots', 21, 5, 0.3, 0);
  decal({ kind: 'inndeco', x: 9, y: 5, variant: 'cellar_goods', ox: 0.3, oy: 0.2 });

  // ---- THE WEST VAULT ----------------------------------------------------
  for (const [x, y] of [[4, 12], [8, 16], [12, 19], [13, 13]] as const) put('cellar_post', x, y, 0.2, 0.1);
  put('cellar_altar', 9, 18, 0.1, 0.1);
  put('cellar_crates', 14, 11, 0.2, 0.1);
  put('inn_barrel', 3, 16, 0.3, 0);
  for (const [x, y] of [[6, 15], [11, 20], [4, 13]] as const) decal({ kind: 'inndeco', x, y, variant: 'cellar_rubble_a', ox: 0.3, oy: 0.2 });

  // ---- THE DEEP CHAMBER --------------------------------------------------
  for (const [x, y] of [[19, 13], [26, 17], [21, 20]] as const) put('cellar_post', x, y, 0.2, 0.1);
  put('cellar_pillar', 23, 11, 0.2, 0.1);
  put('cellar_crates', 28, 12, 0.2, 0.1);
  put('inn_barrels', 18, 20, 0.2, 0.1);
  for (const [x, y] of [[24, 19], [20, 16]] as const) decal({ kind: 'inndeco', x, y, variant: 'cellar_rubble_b', ox: 0.3, oy: 0.2 });

  // webs in the corners, old stains on the flags, and a very few torches
  for (const [x, y] of [[2, 2], [29, 2], [2, 21], [29, 21], [17, 10]] as const)
    decal({ kind: 'inndeco', x, y, variant: 'cellar_web', ox: 0.4, oy: 0.1, lift: 58 });
  for (const [x, y] of [[9, 14], [22, 18], [6, 19]] as const) flat('cellar_stain_a', x, y, 0.3, 0.2);
  for (const [x, y] of [[12, 17], [25, 20]] as const) flat('cellar_stain_b', x, y, 0.3, 0.2);
  for (const [x, y] of [[6, 1], [20, 1]] as const) decal({ kind: 'sconce', x, y, ox: 0.55, oy: 0.4 });
  for (const y of [6, 16]) decal({ kind: 'sconce', x: 1, y, ox: 0.5, oy: 0.55 });

  // ---- WHAT MOVED IN -----------------------------------------------------
  // Spread by hand over the open middles of the three chambers, never within
  // reach of the stair, and never on a tile something already stands on.
  const posts: Array<{ x: number; y: number }> = [];
  for (const [px, py] of [
    [9, 4], [13, 6], [19, 4], [24, 6], [27, 3],
    [6, 13], [10, 16], [13, 19], [5, 19], [8, 20],
    [20, 13], [25, 15], [22, 18], [27, 19], [18, 16],
  ] as const) {
    if (grid[idx(px, py)] !== TILE_FLOOR) continue;
    if (Math.hypot(px - STAIR.x, py - STAIR.y) < 4) continue;
    posts.push({ x: px, y: py });
  }

  // ---- THE STRONGBOXES ---------------------------------------------------
  // Four of them, all in the deep chambers, so the whole cellar has to be walked.
  const chestSpots = [{ x: 27, y: 20 }, { x: 3, y: 20 }, { x: 13, y: 15 }, { x: 24, y: 13 }];

  // ---- nothing may be walled into a pocket -------------------------------
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
    // rooms[0] is the stair yard and is never filled; the rest is what the
    // spawner stocks, so the dark below the hall is never empty.
    // ROOMS THE SPAWNER CAN ACTUALLY USE (it.110). A spawn is dropped when the
    // tile it rolls is not open floor, and this vault is full of standing stock -
    // rooms drawn tight around the props put five monsters in a cellar that
    // wanted fifteen. These are the open middles of the three chambers.
    rooms: [
      { x: 3, y: 2, w: 4, h: 4 }, // the stair yard: never stocked
      { x: 5, y: 3, w: 10, h: 5 },
      { x: 17, y: 3, w: 11, h: 5 },
      { x: 3, y: 11, w: 12, h: 10 },
      { x: 18, y: 11, w: 11, h: 10 },
    ],
    spawn,
    seed,
    tileKind,
    wallsFromProps: true,
  };
  const layout = bareLayout(map, props, 'THE MANOR CELLAR');
  layout.wander = { x: 4, y: 3, w: 6, h: 5 };
  layout.houses = [];
  layout.chests = [];
  for (const c of chestSpots) {
    if (grid[idx(c.x, c.y)] !== TILE_FLOOR) continue;
    grid[idx(c.x, c.y)] = TILE_BLOCKED;
    layout.chests.push(c);
  }
  const vault: VaultLayout = { up, posts: posts.filter((q) => grid[idx(q.x, q.y)] === TILE_FLOOR) };
  layout.vault = vault;
  return { layout, vault };
}
