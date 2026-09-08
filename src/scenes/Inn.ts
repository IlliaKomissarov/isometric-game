/**
 * @module scenes/Inn
 * THE GILDED STAG INSIDE (it.92, rebuilt it.95): the inn's own floor, built
 * from the engine's pieces - plaster-and-timber wall blocks (the `inn` theme),
 * boards underfoot (KIND_PLANK), a timber door in the south wall and a stone
 * arch in the partition, the bar along the north wall with the keeper behind
 * it, a hearth burning in the west wall, round tables with stools and long
 * tables with chairs, bookcases and display cases along the walls, candle
 * stands, kegs and crates, a carpet from the door to the bar, wall sconces -
 * and, through the arch, the rented room: the bed, the chest (the town
 * stash), the bench (the camp forge), a table, a chair, a rug, a bookcase.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type Room } from '@/scenes/DungeonGenerator';
import { CLUTTER_KINDS, KIND_PLANK, type InnLayout, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { bareLayout } from './Forest';

export const INN_W = 30;
export const INN_H = 24;

export function buildInnLayout(seed: number): { layout: TownLayout; inn: InnLayout } {
  const W = INN_W;
  const H = INN_H;
  const grid = new Uint8Array(W * H).fill(TILE_FLOOR);
  const tileKind = new Uint8Array(W * H).fill(KIND_PLANK);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  // THE WALLS: two blocks thick all round, so the far faces read as masonry and nothing shows past them.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) grid[idx(x, y)] = TILE_WALL;
  // THE PARTITION: the rented room's wall, one block, with its doorway.
  const wallX = 20;
  const doorwayY = 11;
  for (let y = 2; y < H - 2; y++) if (y !== doorwayY) grid[idx(wallX, y)] = TILE_WALL;

  const props: TownProp[] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    if (CLUTTER_KINDS.has(p.kind)) return;
    for (let y = p.y; y < p.y + (p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) if (inside(x, y)) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };

  // THE DOOR: a timber door in the south wall; the threshold inside it is the way out, the party arrives a stride in.
  const door = { x: 10, y: H - 3 };
  const spawn = { x: 10, y: H - 5 };
  block({ kind: 'inndoor', x: door.x, y: door.y });
  grid[idx(door.x, door.y)] = TILE_FLOOR;
  // THE BAR along the north wall: a run of counters, the keeper behind, bottle shelves and kegs at his back.
  const keeper = { x: 9, y: 3 };
  block({ kind: 'barkeep', x: keeper.x, y: keeper.y });
  for (let x = 6; x <= 12; x += 2) block({ kind: 'inntable', x, y: 4, w: 2, h: 1, variant: 'inn_table_c' });
  block({ kind: 'shelf', x: 6, y: 2, w: 2, h: 1, variant: 'inn_shelf' });
  block({ kind: 'shelf', x: 11, y: 2, w: 2, h: 1, variant: 'inn_shelf_b' });
  block({ kind: 'potions', x: 9, y: 2 });
  block({ kind: 'barrels_stacked', x: 14, y: 3 });
  block({ kind: 'barrel', x: 4, y: 3, variant: 'barrel_c' });
  block({ kind: 'barrel', x: 15, y: 4, variant: 'barrel_d' });
  block({ kind: 'crates', x: 17, y: 3 });
  // THE HEARTH in the west wall, two chairs before it, a rug at its foot.
  block({ kind: 'hearth', x: 2, y: 9 });
  block({ kind: 'innchair', x: 4, y: 8 });
  block({ kind: 'innchair', x: 4, y: 10 });
  decal({ kind: 'carpet', x: 3, y: 11, variant: 'inn_carpet_s' });
  block({ kind: 'supports', x: 2, y: 13 });
  // THE HALL: round tables with stools, two long tables with chairs, candle stands, a carpet from the door to the bar.
  for (const [x, y] of [[5, 14], [8, 9], [15, 8], [16, 13], [6, 18], [15, 18]] as const) block({ kind: 'table_chairs', x, y });
  block({ kind: 'inntable', x: 10, y: 12, w: 2, h: 2, variant: 'inn_table_a' });
  block({ kind: 'inntable', x: 11, y: 16, w: 2, h: 2, variant: 'inn_table_b' });
  block({ kind: 'innchair', x: 13, y: 12 });
  block({ kind: 'innchair', x: 10, y: 18 });
  for (const [x, y, v] of [[3, 6, 'inn_candle2'], [17, 6, 'inn_candle'], [3, 20, 'inn_candle'], [17, 20, 'inn_candle2'], [9, 7, 'inn_candle']] as const) block({ kind: 'candle', x, y, variant: v });
  for (let y = 6; y <= 20; y += 2) decal({ kind: 'carpet', x: 9, y, w: 1, h: 2, variant: y === 6 ? 'inn_carpet_e' : 'inn_carpet' });
  // Along the walls: bookcases and a display case, kegs in the corners.
  block({ kind: 'shelf', x: 17, y: 2, w: 2, h: 1, variant: 'inn_shelf_b' });
  block({ kind: 'shelf', x: 2, y: 16, w: 1, h: 1, variant: 'inn_case' });
  block({ kind: 'barrels_stacked', x: 2, y: 20 });
  block({ kind: 'crates', x: 18, y: 20 });
  block({ kind: 'jar', x: 3, y: 21, variant: 'jar_b' });
  // Sconces on the walls throw their light over the hall.
  for (const [x, y] of [[2, 4], [2, 17], [6, 2], [16, 2], [19, 8], [19, 16], [6, 21], [15, 21]] as const) decal({ kind: 'sconce', x, y });
  // THE RENTED ROOM through the arch: the bed against the far wall, the chest at its foot, the bench, a table and chair, a rug, a bookcase, a candle.
  decal({ kind: 'doorway', x: wallX, y: doorwayY });
  const bed = { x: 26, y: 6 };
  const stash = { x: 26, y: 9 };
  const forge = { x: 22, y: 4 };
  block({ kind: 'bed', x: bed.x, y: bed.y, w: 1, h: 2 });
  block({ kind: 'stash', x: stash.x, y: stash.y, variant: 'room' });
  block({ kind: 'forge', x: forge.x, y: forge.y, variant: 'room' });
  block({ kind: 'shelf', x: 24, y: 2, w: 2, h: 1, variant: 'inn_shelf' });
  block({ kind: 'candle', x: 24, y: 6, variant: 'inn_candle' });
  decal({ kind: 'carpet', x: 24, y: 8, variant: 'inn_carpet_s' });
  block({ kind: 'inntable', x: 22, y: 14, w: 2, h: 1, variant: 'inn_table_c' });
  block({ kind: 'innchair', x: 24, y: 14 });
  block({ kind: 'shelf', x: 26, y: 16, w: 1, h: 1, variant: 'inn_case' });
  block({ kind: 'box', x: 22, y: 20, variant: 'box_a' });
  block({ kind: 'crates_wood', x: 26, y: 20 });
  for (const [x, y] of [[21, 4], [21, 18], [27, 12]] as const) decal({ kind: 'sconce', x, y });

  // Every pocket the furniture sealed is solid: no stroll is planned into it.
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
  const hall: Room = { x: 3, y: 5, w: 16, h: 16 };
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
