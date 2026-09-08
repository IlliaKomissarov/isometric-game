/**
 * @module scenes/Inn
 * THE GILDED STAG INSIDE (it.92, redrawn it.94): the inn's hall is one
 * painted backdrop - the isometric tavern artwork the project was given -
 * with the walkable floor authored tile by tile over it (`HALL`), the bar
 * counter cut out and drawn in front of the keeper, the hearth's flame and
 * the wall sconces lit for real, patrons strolling the stone floor, and the
 * rented corner under the loft stair: the bed, the chest (the town stash),
 * the bench (the camp forge). The scene draws no floor or wall tiles of its
 * own (`backdrop` on the map): the picture is the room.
 */

import { TILE_BLOCKED, TILE_FLOOR, type Room } from '@/scenes/DungeonGenerator';
import { CLUTTER_KINDS, KIND_PLANK, type InnLayout, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { bareLayout } from './Forest';

export const INN_W = 28;
export const INN_H = 28;
/** The artwork's tile: 228 px a diamond; ours is 64. */
export const INN_ART_SCALE = 64 / 228;
/** The picture's pixel that sits on the top corner of tile (8, 4). */
const ART_ORIGIN = { u: 2378, v: 60, tx: 8, ty: 4 };

/** The hall, tile by tile: `.` is stone or rug the folk walk, `#` is wall, counter, table or stair. */
const HALL = [
  '############################',
  '#########.........##########',
  '#########.........##########',
  '############################',
  '#################..#########',
  '#################..#########',
  '###############....#########',
  '#################..#########',
  '##########.........#########',
  '##########.........#########',
  '##########.........#########',
  '########...........#########',
  '#######............#########',
  '######..............########',
  '######..............########',
  '#######.#....#...#...#######',
  '########.#...........#######',
  '#######..............#######',
  '#######..##...##..#...######',
  '########..#........#..######',
  '#########.............######',
  '#########..............#####',
  '#######....#...........#####',
  '##########....##############',
  '############################',
  '############################',
  '############################',
  '############################'
];

export function buildInnLayout(seed: number): { layout: TownLayout; inn: InnLayout } {
  const W = INN_W;
  const H = INN_H;
  const grid = new Uint8Array(W * H).fill(TILE_BLOCKED);
  const tileKind = new Uint8Array(W * H).fill(KIND_PLANK);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (HALL[y]?.[x] === '.') grid[idx(x, y)] = TILE_FLOOR;
  // The way round the counter's end: the dais joins the hall at the right of the bar.
  for (const [x, y] of [[17, 2], [18, 2], [17, 3], [18, 3], [17, 4], [18, 4]] as const) grid[idx(x, y)] = TILE_FLOOR;

  const props: TownProp[] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    if (CLUTTER_KINDS.has(p.kind)) return;
    for (let y = p.y; y < p.y + (p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) if (inside(x, y)) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };

  // THE PICTURE: the whole hall, seated so its tile grid is ours.
  const s = INN_ART_SCALE;
  decal({ kind: 'backdrop', x: ART_ORIGIN.tx, y: ART_ORIGIN.ty, variant: 'tavern_hall', ox: -ART_ORIGIN.u * s, oy: -ART_ORIGIN.v * s });
  // THE BAR COUNTER, cut from the picture and drawn in front of whoever stands behind it.
  decal({ kind: 'barfront', x: ART_ORIGIN.tx, y: ART_ORIGIN.ty, variant: 'tavern_bar', ox: (2132 - ART_ORIGIN.u) * s, oy: (215 - ART_ORIGIN.v) * s, w: 9, h: 2 }); // Sorted at the counter's south edge.
  // THE DOOR: the double doors on the north-east wall; the party arrives on the dais just inside.
  const door = { x: 13, y: 2 };
  const spawn = { x: 14, y: 2 };
  block({ kind: 'inndoor', x: door.x, y: door.y });
  grid[idx(door.x, door.y)] = TILE_FLOOR;
  // THE KEEPER behind the counter's middle.
  const keeper = { x: 11, y: 2 };
  block({ kind: 'barkeep', x: keeper.x, y: keeper.y, variant: 'wide' });
  // THE HEARTH: the painted fire burns for real, and the sconces on the walls throw their light.
  decal({ kind: 'hearth', x: 5, y: 15, variant: 'painted' });
  for (const [x, y] of [[9, 7], [13, 3], [16, 0], [17, 4], [19, 6]] as const) decal({ kind: 'sconce', x, y });
  for (const [x, y] of [[8, 15], [9, 18], [14, 15], [15, 18], [17, 15], [18, 18]] as const) decal({ kind: 'tablelight', x, y });
  // THE RENTED CORNER by the hearth, under the loft: the bed, the chest, the bench, a rug, a candle.
  const bed = { x: 7, y: 12 };
  const stash = { x: 7, y: 14 };
  const forge = { x: 8, y: 14 };
  block({ kind: 'bed', x: bed.x, y: bed.y, w: 1, h: 2 });
  block({ kind: 'stash', x: stash.x, y: stash.y, variant: 'room' });
  block({ kind: 'forge', x: forge.x, y: forge.y, variant: 'room' });
  block({ kind: 'candle', x: 6, y: 13, variant: 'inn_candle' });
  decal({ kind: 'carpet', x: 8, y: 12, variant: 'inn_carpet_s' });

  // Only what the door reaches is floor: no stroll is planned into a pocket the picture closed.
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
  const hall: Room = { x: 6, y: 7, w: 17, h: 16 };
  const map: TownMap = {
    width: W,
    height: H,
    grid,
    rooms: [{ x: 2, y: 2, w: W - 4, h: H - 4 }],
    spawn,
    seed,
    tileKind,
    backdrop: true,
  };
  const layout = bareLayout(map, props, 'THE GILDED STAG');
  layout.wander = hall;
  layout.houses = [];
  const inn: InnLayout = { keeper, door, bed, stash, forge, hall };
  layout.inn = inn;
  return { layout, inn };
}
