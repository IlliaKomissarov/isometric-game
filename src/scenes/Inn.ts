/**
 * @module scenes/Inn
 * THE GILDED STAG INSIDE (it.92): the inn's own floor. A stone-walled hall
 * with boards underfoot, the bar along the north wall with the keeper behind
 * it, a hearth in the west wall, long tables and chairs, candle stands, a
 * carpet from the door to the bar - and, through a doorway in the east
 * partition, the corner room the errand pays for: the bed, the chest (the
 * town stash), the bench (the camp forge).
 *
 * Built like the forest: a TownMap with a `tileKind` layer (KIND_PLANK), a
 * prop list the town's dresser draws, a `TownLayout` main treats as a town
 * (villagers, interactables, no foes), and an `InnLayout` naming the spots.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type Room } from '@/scenes/DungeonGenerator';
import { CLUTTER_KINDS, KIND_PLANK, type InnLayout, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { bareLayout } from './Forest';

export const INN_W = 24;
export const INN_H = 20;

export function buildInnLayout(seed: number): { layout: TownLayout; inn: InnLayout } {
  const W = INN_W;
  const H = INN_H;
  const grid = new Uint8Array(W * H).fill(TILE_FLOOR);
  const tileKind = new Uint8Array(W * H).fill(KIND_PLANK);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  // The walls: two thick, so the cubes read as masonry and nothing shows past them.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) grid[idx(x, y)] = TILE_WALL;
  // The partition: the corner room's wall, with its doorway.
  const wallX = 16;
  for (let y = 9; y < H - 2; y++) if (y !== 12) grid[idx(wallX, y)] = TILE_WALL;

  const props: TownProp[] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    if (CLUTTER_KINDS.has(p.kind)) return;
    for (let y = p.y; y < p.y + (p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) if (inside(x, y)) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };

  // THE DOOR: the middle of the south wall; the party arrives just inside it.
  const door = { x: 9, y: H - 3 };
  const spawn = { x: 9, y: H - 5 };
  block({ kind: 'inndoor', x: door.x, y: door.y });
  grid[idx(door.x, door.y)] = TILE_FLOOR; // The threshold is floor: E stands on it.
  // THE BAR: a counter of long tables along the north wall, the keeper behind it, shelves and kegs at his back.
  const keeper = { x: 10, y: 3 };
  block({ kind: 'barkeep', x: keeper.x, y: keeper.y });
  block({ kind: 'inntable', x: 8, y: 4, w: 2, h: 1, variant: 'inn_table_c' });
  block({ kind: 'inntable', x: 10, y: 4, w: 2, h: 1, variant: 'inn_table_c' });
  block({ kind: 'inntable', x: 12, y: 4, w: 2, h: 1, variant: 'inn_table_c' });
  block({ kind: 'shelf', x: 8, y: 2, w: 2, h: 1, variant: 'inn_shelf' });
  block({ kind: 'shelf', x: 12, y: 2, w: 2, h: 1, variant: 'inn_shelf_b' });
  block({ kind: 'barrels_stacked', x: 14, y: 3 });
  block({ kind: 'barrel', x: 7, y: 3, variant: 'barrel_c' });
  block({ kind: 'potions', x: 11, y: 2 });
  // THE HEARTH in the west wall, a bench of chairs before it.
  block({ kind: 'hearth', x: 3, y: 5 });
  block({ kind: 'innchair', x: 5, y: 6 });
  block({ kind: 'innchair', x: 5, y: 4 });
  block({ kind: 'supports', x: 2, y: 8 });
  // THE HALL: three long tables with their chairs, candle stands, a carpet to the bar.
  block({ kind: 'inntable', x: 4, y: 9, w: 2, h: 2, variant: 'inn_table_a' });
  block({ kind: 'inntable', x: 9, y: 8, w: 2, h: 2, variant: 'inn_table_b' });
  block({ kind: 'inntable', x: 4, y: 13, w: 2, h: 2, variant: 'inn_table_a' });
  block({ kind: 'inntable', x: 11, y: 12, w: 2, h: 2, variant: 'inn_table_d' });
  block({ kind: 'innchair', x: 13, y: 9 });
  block({ kind: 'innchair', x: 8, y: 14 });
  block({ kind: 'candle', x: 3, y: 12, variant: 'inn_candle2' });
  block({ kind: 'candle', x: 14, y: 6, variant: 'inn_candle' });
  block({ kind: 'candle', x: 7, y: 16, variant: 'inn_candle' });
  block({ kind: 'candle', x: 14, y: 16, variant: 'inn_candle2' });
  for (let y = 6; y <= 16; y += 2) decal({ kind: 'carpet', x: 9, y, w: 1, h: 2, variant: y === 6 ? 'inn_carpet_e' : 'inn_carpet' });
  block({ kind: 'crates', x: 2, y: 16 });
  block({ kind: 'jar', x: 15, y: 17, variant: 'jar_a' });
  // THE CORNER ROOM past the doorway: the bed, the chest, the bench, a candle, a rug.
  const bed = { x: 20, y: 10 };
  const stash = { x: 20, y: 16 };
  const forge = { x: 18, y: 16 };
  block({ kind: 'bed', x: bed.x, y: bed.y });
  block({ kind: 'stash', x: stash.x, y: stash.y, variant: 'room' });
  block({ kind: 'forge', x: forge.x, y: forge.y, variant: 'room' });
  block({ kind: 'candle', x: 18, y: 10, variant: 'inn_candle' });
  block({ kind: 'shelf', x: 18, y: 12, w: 1, h: 1, variant: 'inn_case' });
  decal({ kind: 'carpet', x: 19, y: 13, variant: 'inn_carpet_s' });
  block({ kind: 'box', x: 21, y: 12, variant: 'box_a' });

  // Behind the bar and in every corner the furniture seals: solid, so no stroll is planned into a pocket.
  {
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
  }
  const hall: Room = { x: 3, y: 5, w: 12, h: 12 };
  const map: TownMap = {
    width: W,
    height: H,
    grid,
    rooms: [{ x: 2, y: 2, w: W - 4, h: H - 4 }],
    spawn,
    seed,
    tileKind,
  };
  const layout = bareLayout(map, props, 'THE GILDED STAG');
  layout.wander = hall;
  layout.houses = [];
  const inn: InnLayout = { keeper, door, bed, stash, forge, hall };
  layout.inn = inn;
  return { layout, inn };
}
