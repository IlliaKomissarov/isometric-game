/**
 * @module scenes/Inn
 * THE GILDED STAG (rebuilt it.96) - the inn's own floor, built from the
 * Ancient Isometric Tileset and the Dungeon Pry placeables:
 *
 *   - plaster-and-wainscot wall pieces standing on the far edges of the room
 *     (`innwall`, one piece every TWO tiles - see `assets96` for the scale),
 *   - board floors with flagstone by the bar and the hearth,
 *   - a long bar along the north-east wall, the keeper behind it, bottle
 *     shelves and kegs at his back, stools before it,
 *   - a stone hearth set in the north-west wall with a real fire, chairs and
 *     a rug before it,
 *   - five tables with chairs and stools, rugs, crates, casks and wall torches,
 *   - and THE RENTED ROOM behind a door in the partition: locked and black
 *     until the errand is paid, then opened on a bed and the warded chest -
 *     the same stash the town keeps, so anything left in it is in reach from
 *     every stash in the world and from every hero of the party.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type Room } from '@/scenes/DungeonGenerator';
import { CLUTTER_KINDS, KIND_INN_BOARDS, KIND_INN_STONE, type InnLayout, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { bareLayout } from './Forest';

export const INN_W = 28;
export const INN_H = 24;

/** The hall's four corners (inclusive), and the rented room carved out of its south-east. */
const HALL = { x0: 2, y0: 2, x1: 25, y1: 21 };
const ROOM = { x0: 20, y0: 14, x1: 25, y1: 21 };
/** The partition: a wall column at x = 19 and a wall row at y = 13, with the door in it. */
const PART_X = 19;
const PART_Y = 13;
/** The door piece spans tiles (22,13) and (23,13); its opening is over the second. */
const DOOR_PIECE_X = 22;
const DOOR_GAP = { x: 23, y: PART_Y };
/** The way out to the street: an arch in the north-east wall over tiles (8,1) and (9,1). */
const OUT_PIECE_X = 8;
/** THE CELLAR DOOR (it.97): a leaf in the north-west wall over tiles (1,18) and (1,19). */
const CELLAR_PIECE_Y = 18;

/**
 * @param roomOpen   the errand is paid: the rented room is carved and dressed.
 * @param cellarOpen the keeper has asked for his drink back: the back door opens.
 * @param rescued    his serving woman is out of the cellar: she stands by the bar.
 */
export function buildInnLayout(seed: number, roomOpen = false, cellarOpen = false, rescued = false): { layout: TownLayout; inn: InnLayout } {
  const W = INN_W;
  const H = INN_H;
  const grid = new Uint8Array(W * H).fill(TILE_WALL);
  const tileKind = new Uint8Array(W * H).fill(KIND_INN_BOARDS);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // ---- the floor: the hall, less the partition; the room only once it is opened
  for (let y = HALL.y0; y <= HALL.y1; y++)
    for (let x = HALL.x0; x <= HALL.x1; x++) {
      const inRoom = x >= ROOM.x0 && x <= ROOM.x1 && y >= ROOM.y0 && y <= ROOM.y1;
      const onPartition = (x === PART_X && y >= PART_Y) || (y === PART_Y && x >= ROOM.x0);
      if (onPartition) continue;
      if (inRoom && !roomOpen) continue;
      grid[idx(x, y)] = TILE_FLOOR;
    }
  if (roomOpen) grid[idx(DOOR_GAP.x, DOOR_GAP.y)] = TILE_FLOOR; // the doorway itself
  // flagstone behind and before the bar, and on the hearth's apron
  for (let y = 2; y <= 6; y++) for (let x = 15; x <= 25; x++) tileKind[idx(x, y)] = KIND_INN_STONE;
  for (let y = 6; y <= 11; y++) for (let x = 2; x <= 5; x++) tileKind[idx(x, y)] = KIND_INN_STONE;

  const props: TownProp[] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    if (CLUTTER_KINDS.has(p.kind)) return;
    for (let y = p.y; y < p.y + (p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) if (inside(x, y)) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };
  /** A standing piece of furniture, placed by its tile with a fractional nudge. */
  const put = (variant: string, x: number, y: number, ox = 0, oy = 0, solid = true): void => {
    const p: TownProp = { kind: solid ? 'innprop' : 'inndeco', x, y, variant, ox, oy };
    if (solid) block(p);
    else decal(p);
  };
  const rug = (variant: string, x: number, y: number, ox = 0, oy = 0): void => decal({ kind: 'innrug', x, y, variant, ox, oy });
  /** A wall piece: `n` runs along +x over two tiles, `w` runs along +y over two tiles. */
  const wallN = (x: number, y: number, variant: string): void => decal({ kind: 'innwall', x, y, w: 2, h: 1, variant });
  const wallW = (x: number, y: number, variant: string): void => decal({ kind: 'innwall', x, y, w: 1, h: 2, variant });

  // ---- THE WALLS -------------------------------------------------------
  for (let x = HALL.x0; x <= HALL.x1; x += 2) wallN(x, 1, x === OUT_PIECE_X ? 'inn_arch_n' : 'inn_wall_n');
  for (let y = HALL.y0; y <= HALL.y1; y += 2) wallW(1, y, y === 8 ? 'inn_hearth_w' : y === CELLAR_PIECE_Y ? (cellarOpen ? 'inn_door_w_open' : 'inn_door_w_shut') : 'inn_wall_w');
  for (let x = ROOM.x0; x <= ROOM.x1; x += 2) wallN(x, PART_Y, x === DOOR_PIECE_X ? (roomOpen ? 'inn_door_open' : 'inn_door_shut') : 'inn_wall_n');
  for (let y = PART_Y; y <= ROOM.y1; y += 2) wallW(PART_X, y, 'inn_wall_w');

  // ---- THE WAY OUT -----------------------------------------------------
  const door = { x: OUT_PIECE_X + 1, y: 2 };
  const spawn = { x: OUT_PIECE_X + 1, y: 3 };
  decal({ kind: 'inndoor', x: door.x, y: door.y });

  // ---- THE BAR ---------------------------------------------------------
  const keeper = { x: 20, y: 2 };
  block({ kind: 'barkeep', x: keeper.x, y: keeper.y });
  for (let i = 0; i < 7; i++) put('inn_table', 15 + i, 3, (i * 1.5) % 1, 0.55);
  put('inn_shelf_bottles', 17, 2, 0.4, -0.15);
  put('inn_bookshelf', 23, 2, 0.4, -0.15);
  put('inn_barrels', 15, 2, 0.1, -0.1);
  put('inn_crates', 25, 2, 0, -0.1);
  for (const x of [16, 18, 22, 24]) put('inn_stool', x, 5, 0.2, -0.2, false);
  decal({ kind: 'inndeco', x: 19, y: 3, variant: 'inn_plate', ox: 0.2, oy: -0.35 });
  decal({ kind: 'inndeco', x: 21, y: 3, variant: 'inn_flasks', ox: 0.1, oy: -0.4 });

  // ---- THE CELLAR DOOR -------------------------------------------------
  const cellarDoor = { x: 1, y: CELLAR_PIECE_Y + 1 };
  decal({ kind: 'cellardoor', x: cellarDoor.x, y: cellarDoor.y, variant: cellarOpen ? 'open' : 'shut' });

  // ---- THE HEARTH ------------------------------------------------------
  const hearth = { x: 2, y: 8 };
  decal({ kind: 'hearth', x: hearth.x, y: hearth.y });
  put('inn_chair_b', 4, 7, 0.15, 0.1, false);
  put('inn_chair_a', 4, 10, 0.15, -0.1, false);
  rug('inn_carpet_b', 3, 11, 0.4, 0);

  // ---- THE HALL: tables, rugs, casks -----------------------------------
  for (const [tx, ty] of [[7, 14], [12, 8], [14, 18], [7, 19], [16, 12]] as const) {
    put('inn_table', tx, ty, 0.1, 0.1);
    put('inn_chair_a', tx - 1, ty, -0.1, 0.25, false);
    put('inn_chair_b', tx + 1, ty, 0.35, -0.1, false);
    put('inn_stool', tx, ty + 1, 0.3, 0.25, false);
  }
  rug('inn_carpet_a', 9, 16, 0.4, 0.2);
  rug('inn_carpet_a', 11, 10, 0.2, 0.4);
  put('inn_cupboard', 2, 15, 0.35, 0);
  put('inn_barrel', 4, 21, 0.3, 0.1); // Clear of the cellar door's approach at (2,19).
  put('inn_crates', 5, 2, 0.2, -0.1);
  put('inn_crate', 12, 2, 0.2, -0.1);
  decal({ kind: 'inndeco', x: 10, y: 2, variant: 'inn_goods_a', ox: 0.2, oy: -0.2 });
  decal({ kind: 'inndeco', x: 11, y: 2, variant: 'inn_goods_c', ox: 0.2, oy: -0.2 });
  put('inn_pots', 13, 2, 0.3, -0.1);
  put('inn_bigtable', 4, 4, 0.2, 0.2);

  // wall decoration and torches, hung on the far walls
  for (const [x, y] of [[6, 1], [14, 1], [22, 1]] as const) decal({ kind: 'inndeco', x, y, variant: x === 14 ? 'inn_painting_b' : 'inn_painting_a', ox: 0.5, oy: 0.35, lift: 44 });
  for (const [x, y] of [[4, 1], [12, 1], [18, 1], [24, 1]] as const) decal({ kind: 'sconce', x, y, ox: 0.55, oy: 0.4 });
  for (const y of [4, 12, 16, 20]) decal({ kind: 'sconce', x: 1, y, ox: 0.5, oy: 0.55 });

  // ---- THE SERVING WOMAN, once she is out of the cellar -----------------
  if (rescued) block({ kind: 'cellargirl', x: 17, y: 5 });

  // ---- THE RENTED ROOM -------------------------------------------------
  const bed = { x: 22, y: 16 };
  const stash = { x: 24, y: 19 };
  if (roomOpen) {
    block({ kind: 'bed', x: bed.x, y: bed.y, w: 2, h: 1 });
    block({ kind: 'stash', x: stash.x, y: stash.y, variant: 'room' });
    rug('inn_carpet_b', 21, 19, 0.3, 0.2);
    put('inn_cupboard', 25, 15, 0.2, 0);
    put('inn_crate', 20, 21, 0.3, 0.1);
    // Four torches, so the room reads as lived in rather than as a cellar.
    decal({ kind: 'sconce', x: PART_X, y: 16, ox: 0.5, oy: 0.55 });
    decal({ kind: 'sconce', x: PART_X, y: 20, ox: 0.5, oy: 0.55 });
    decal({ kind: 'sconce', x: 20, y: PART_Y, ox: 0.55, oy: 0.4 });
    decal({ kind: 'sconce', x: 25, y: PART_Y, ox: 0.55, oy: 0.4 });
    // A candle on the cupboard and one by the chest: the corners are lit too.
    decal({ kind: 'inndeco', x: 25, y: 15, variant: 'inn_flasks', ox: 0.2, oy: -0.45, lift: 22 });
    decal({ kind: 'inndeco', x: 22, y: 13, variant: 'inn_poster_a', ox: 0.5, oy: 0.35, lift: 40 });
    decal({ kind: 'inndeco', x: 24, y: 13, variant: 'inn_painting_b', ox: 0.5, oy: 0.35, lift: 44 });
  }

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

  const hall: Room = { x: 4, y: 6, w: 13, h: 14 };
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
  const layout = bareLayout(map, props, 'THE GILDED STAG');
  layout.wander = hall;
  layout.houses = [];
  const inn: InnLayout = { keeper, door, bed, stash, forge: hearth, hall, roomOpen, cellarDoor, cellarOpen };
  layout.inn = inn;
  return { layout, inn };
}
