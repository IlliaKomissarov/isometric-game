/**
 * @module scenes/Farmlands
 * THE FARMLANDS (it.100) — the city's fields along the marsh path, and the
 * company that took them.
 *
 * A wide outdoor floor in the town's own idiom, so it sits beside the city
 * rather than beside the crypt: grass verges, ploughed dirt rows, and scorched
 * earth where the fire has already been through. It is built from the town's
 * existing prop set (fences, carts, casks, stalls, a well, spiked barricades)
 * and three pieces cut for this floor alone — ash ground, standing corn, and the
 * blackened stubble the fire leaves.
 *
 * Two states, and the layout is a pure function of which one it is in:
 *
 *   BURNING  the crop is alight, the company holds the rows, and the far lanes
 *            are barricaded. This is the battle.
 *   WON      the fires are out, the corn stands whole, the folk are back on the
 *            land, chests sit in the yards, and the barricades at the map's far
 *            edges mark the roads that are not built yet.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL } from '@/scenes/DungeonGenerator';
import { CLUTTER_KINDS, KIND_DIRT, KIND_FARM_ASH, KIND_GRASS, type FarmLayout, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { mulberry32 } from '@/utils/rng';
import { bareLayout } from './Forest';

export const FARM_W = 52;
export const FARM_H = 40;

/** The field's four corners (inclusive); everything outside is the hedgerow. */
const FIELD = { x0: 2, y0: 2, x1: 49, y1: 37 };
/** Where the company comes up from the city road, and where the officer plants himself. */
const ENTRY = { x: 5, y: 33 };
/** The lane the enemy holds, and the general's ground at the top of it. */
const GENERAL = { x: 43, y: 7 };
/** The two roads out that are not built yet. */
const GATES = [
  { x: 50, y: 20, label: 'THE MARSH PATH' },
  { x: 26, y: 1, label: 'THE NORTH ROAD' },
] as const;

export function buildFarmLayout(seed: number, won = false): { layout: TownLayout; farm: FarmLayout } {
  const W = FARM_W;
  const H = FARM_H;
  const rand = mulberry32((seed ^ 0xfa4d1a) >>> 0);
  const grid = new Uint8Array(W * H).fill(TILE_WALL);
  const tileKind = new Uint8Array(W * H).fill(KIND_GRASS);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // ---- the open field
  for (let y = FIELD.y0; y <= FIELD.y1; y++) for (let x = FIELD.x0; x <= FIELD.x1; x++) grid[idx(x, y)] = TILE_FLOOR;

  // ---- the rows: six ploughed strips running the length of the field, with
  //      grass headlands between them and a cart track down the middle.
  const strips: Array<{ y0: number; y1: number }> = [];
  for (let i = 0; i < 6; i++) {
    const y0 = 4 + i * 6;
    const y1 = y0 + 3;
    strips.push({ y0, y1 });
    for (let y = y0; y <= y1; y++) for (let x = 4; x <= 47; x++) tileKind[idx(x, y)] = KIND_DIRT;
  }
  for (let y = FIELD.y0; y <= FIELD.y1; y++) for (let x = 23; x <= 26; x++) tileKind[idx(x, y)] = KIND_DIRT; // the track
  // ---- and the burn: while the field is held, the eastern half is ash.
  if (!won) {
    for (let y = 3; y <= 30; y++)
      for (let x = 27; x <= 47; x++)
        if ((x + y * 3) % 7 < 5) tileKind[idx(x, y)] = KIND_FARM_ASH;
  }

  const props: TownProp[] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    if (CLUTTER_KINDS.has(p.kind)) return;
    for (let y = p.y; y < p.y + (p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) if (inside(x, y)) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };
  /** A crop stand: paint, never a wall - a field you cannot walk into is not a field. */
  const crop = (variant: string, x: number, y: number): void => {
    if (!inside(x, y) || grid[idx(x, y)] !== TILE_FLOOR) return;
    decal({ kind: 'farmcrop', x, y, variant, ox: (rand() - 0.5) * 0.5, oy: (rand() - 0.5) * 0.5 });
  };
  const put = (kind: TownProp['kind'], x: number, y: number, variant?: string): void => {
    if (!inside(x, y) || grid[idx(x, y)] !== TILE_FLOOR) return;
    block({ kind, x, y, variant });
  };

  // ---- THE CROP -------------------------------------------------------
  // Standing corn on every ploughed strip; east of the track it is burnt while
  // the company holds the ground, and whole again once they do not.
  for (const s of strips) {
    for (let y = s.y0; y <= s.y1; y++) {
      for (let x = 4; x <= 47; x++) {
        if (x >= 23 && x <= 26) continue; // the cart track stays clear
        if ((x * 5 + y * 3) % 4 !== 0) continue;
        const burnt = !won && x > 26 && y <= 30;
        crop(burnt ? (rand() < 0.5 ? 'farm_burnt_a' : 'farm_burnt_b') : rand() < 0.34 ? 'farm_crop_c' : rand() < 0.5 ? 'farm_crop_b' : 'farm_crop_a', x, y);
      }
    }
  }

  // ---- THE FIRES ------------------------------------------------------
  // Set in the standing corn east of the track, where the line is being held.
  const fires: Array<{ x: number; y: number }> = [];
  if (!won) {
    for (const s of strips) {
      for (let x = 29; x <= 46; x += 4) {
        const y = s.y0 + (x % 3);
        if (y > 30 || !inside(x, y) || grid[idx(x, y)] !== TILE_FLOOR) continue;
        fires.push({ x, y });
        decal({ kind: 'fieldfire', x, y });
      }
    }
  }

  // ---- THE FARM -------------------------------------------------------
  // The steading at the west end: the well, the carts, the casks, the stalls.
  put('well', 8, 20);
  put('cart', 11, 24);
  put('cart', 9, 15, 'cart_b');
  put('barrels_stacked', 7, 25);
  put('crates_wood', 12, 19);
  put('wood_pile', 6, 17);
  put('stall', 10, 28, 'stall_a');
  put('stall', 13, 12, 'stall_c');
  for (const [x, y] of [[6, 12], [15, 27], [19, 9], [17, 33]] as const) put('barrel', x, y, 'barrel_b');
  // The hedgerow: a fence line down both headlands, so the field reads as worked land.
  for (let y = 3; y <= 36; y += 3) {
    decal({ kind: 'fence', x: 3, y });
    decal({ kind: 'fence', x: 48, y });
  }
  for (let x = 5; x <= 46; x += 6) {
    decal({ kind: 'fence', x, y: 2 });
    decal({ kind: 'fence', x, y: 37 });
  }
  // A few trees on the verges, and stones the plough turned up.
  for (const [x, y] of [[3, 8], [3, 30], [48, 5], [48, 33], [30, 38], [14, 2]] as const) put('tree', x, y, rand() < 0.5 ? 'tree_a' : 'bigtree_b');
  for (const [x, y] of [[20, 6], [35, 34], [44, 26], [16, 20]] as const) decal({ kind: 'rock', x, y, variant: 'rock_c' });

  // ---- THE ROADS THAT ARE NOT BUILT ------------------------------------
  // Spiked barricades across both far gateways, whether the field is won or not:
  // the fields are the city's now, but the marsh beyond them is not.
  const gates = GATES.map((g) => ({ ...g }));
  for (const g of gates) {
    block({ kind: 'barricade', x: g.x, y: g.y, variant: 'barricade_a' });
    if (inside(g.x, g.y + 1)) block({ kind: 'barricade', x: g.x, y: g.y + 1, variant: 'barricade_b' });
    decal({ kind: 'farmgate', x: g.x, y: g.y, variant: g.label });
  }

  // ---- WHAT IS LEFT WHEN IT IS WON --------------------------------------
  const chestSpots = won ? [{ x: 44, y: 12 }, { x: 33, y: 27 }, { x: 20, y: 16 }] : [];

  // ---- nothing may be walled into a pocket ------------------------------
  {
    const seen = new Uint8Array(W * H);
    const stack = [idx(ENTRY.x, ENTRY.y)];
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
    // rooms[0] is the muster ground and is never stocked; the rest are the company's line.
    rooms: [
      { x: 4, y: 30, w: 8, h: 7 },
      { x: 20, y: 24, w: 10, h: 10 },
      { x: 32, y: 20, w: 12, h: 12 },
      { x: 30, y: 4, w: 14, h: 12 },
      { x: 16, y: 6, w: 10, h: 10 },
    ],
    spawn: { ...ENTRY },
    seed,
    tileKind,
  };
  const layout = bareLayout(map, props, 'THE FARMLANDS');
  layout.wander = { x: 6, y: 14, w: 16, h: 20 };
  layout.houses = [];
  layout.chests = [];
  for (const c of chestSpots) {
    if (grid[idx(c.x, c.y)] !== TILE_FLOOR) continue;
    grid[idx(c.x, c.y)] = TILE_BLOCKED;
    layout.chests.push(c);
  }
  // The squad forms up behind the hero on the muster ground.
  const squad = [
    { x: ENTRY.x - 1, y: ENTRY.y - 1, officer: true },
    { x: ENTRY.x + 1, y: ENTRY.y - 1 },
    { x: ENTRY.x + 2, y: ENTRY.y },
    { x: ENTRY.x - 1, y: ENTRY.y + 1 },
    { x: ENTRY.x + 1, y: ENTRY.y + 2 },
    { x: ENTRY.x + 3, y: ENTRY.y + 1 },
  ].filter((s) => inside(s.x, s.y) && grid[idx(s.x, s.y)] === TILE_FLOOR);
  const farm: FarmLayout = { entry: { ...ENTRY }, general: { ...GENERAL }, squad, fires, gates: gates.map((g) => ({ x: g.x, y: g.y, label: g.label })), won };
  layout.farm = farm;
  return { layout, farm };
}
