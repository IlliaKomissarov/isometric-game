/**
 * @module scenes/Farmlands
 * THE FARMLANDS (it.100, rebuilt it.101) — the city's fields along the marsh
 * path, and the company that took them.
 *
 * A wide outdoor floor in the town's own idiom, so it sits beside the city
 * rather than beside the crypt: grass verges, ploughed dirt rows, and scorched
 * earth where the fire has already been through. It is built from the town's
 * existing prop set (farmhouses, barns, fences, carts, casks, stalls, a well,
 * spiked barricades, trees) and four pieces cut for this floor alone — ash
 * ground, standing corn, the blackened stubble the fire leaves, and live coals.
 *
 * GEOGRAPHY (it.101). The marsh gateway stands on the WEST side of the city, so
 * the road out of town runs west and the hero arrives on the field's EAST edge
 * and fights westward into it. That fixes the compass for everything else:
 *
 *   EAST edge   the road home (a signpost back to the marsh gate) and the
 *               muster ground the squad forms up on.
 *   WEST edge   the ground the company holds, its general at the head of it,
 *               and past them the western road — open, and leading on.
 *
 * THE SHAPE (it.101) is a union of five overlapping lobes, not a rectangle: the
 * field bulges and pinches the way worked land actually does, and every tile on
 * its border carries the hedge of trees that outlines the map.
 *
 * Two states, and the layout is a pure function of which one it is in:
 *
 *   BURNING  the crop is alight, the company holds the western rows, and the
 *            far lanes are barricaded. This is the battle.
 *   WON      the fires are out, the corn stands whole, the folk are back on the
 *            land, chests sit in the yards, and the western road is open.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL } from '@/scenes/DungeonGenerator';
import { CLUTTER_KINDS, KIND_DIRT, KIND_FARM_ASH, KIND_GRASS, type FarmLayout, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { mulberry32 } from '@/utils/rng';
import { bareLayout } from './Forest';

export const FARM_W = 64;
export const FARM_H = 48;

/**
 * THE FIELD'S LOBES (it.101). Five overlapping ellipses; their union is the
 * walkable land. Overlapping guarantees one connected field, and the seams
 * between them read as the pinches between one man's acre and the next.
 */
const LOBES: ReadonlyArray<{ cx: number; cy: number; rx: number; ry: number }> = [
  { cx: 14, cy: 14, rx: 13, ry: 11 }, // the western headland - the company's ground
  { cx: 16, cy: 33, rx: 13, ry: 10 }, // the south-west acre, and the burnt steading
  { cx: 33, cy: 22, rx: 16, ry: 17 }, // the great middle field
  { cx: 50, cy: 15, rx: 12, ry: 10 }, // the north-east acre
  { cx: 52, cy: 32, rx: 11, ry: 11 }, // the home acre, where the road comes in
];

/** Where the hero and the squad arrive from the city road, on the EAST edge. */
const ENTRY = { x: 57, y: 24 };
/** The signpost on the east verge: the way back to the marsh gate. */
const HOME = { x: 61, y: 24 };
/** The lane the enemy holds, and the general's ground at the far west of it. */
const GENERAL = { x: 9, y: 13 };
/** THE WESTERN ROAD (it.101): open ground leading on, past the fields. */
const WEST_WAY = { x: 1, y: 22, label: 'THE WESTERN ROAD' };
/** The one road out that is still barricaded. */
const GATES = [{ x: 30, y: 1, label: 'THE NORTH ROAD' }] as const;

export function buildFarmLayout(seed: number, won = false): { layout: TownLayout; farm: FarmLayout } {
  const W = FARM_W;
  const H = FARM_H;
  const rand = mulberry32((seed ^ 0xfa4d1a) >>> 0);
  const grid = new Uint8Array(W * H).fill(TILE_WALL);
  const tileKind = new Uint8Array(W * H).fill(KIND_GRASS);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const isFloor = (x: number, y: number): boolean => inside(x, y) && grid[idx(x, y)] === TILE_FLOOR;

  // ---- THE OPEN FIELD: the union of the lobes, with a ragged verge ------
  // The 0.06 wobble is deterministic in the tile's own coordinates, so the
  // border is irregular without a single call on the shared random stream.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const wobble = 1 + Math.sin(x * 0.7 + y * 0.31) * 0.06 + Math.cos(y * 0.53 - x * 0.19) * 0.05;
      for (const l of LOBES) {
        const dx = (x - l.cx) / l.rx;
        const dy = (y - l.cy) / l.ry;
        if (dx * dx + dy * dy <= wobble) {
          grid[idx(x, y)] = TILE_FLOOR;
          break;
        }
      }
    }
  }
  // ---- the two roads: the city's, coming in east; the western one, going on
  const lane = (x0: number, x1: number, y: number, half = 1): void => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let yy = y - half; yy <= y + half; yy++) if (inside(x, yy)) grid[idx(x, yy)] = TILE_FLOOR;
  };
  lane(52, 62, ENTRY.y); // in from the city
  lane(1, 9, WEST_WAY.y); // on, to the west

  // ---- THE PLOUGHING: wavy strips, so no two rows run quite parallel ----
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isFloor(x, y)) continue;
      const bend = Math.round(Math.sin(x * 0.16) * 2 + Math.cos(x * 0.07) * 1.5);
      if ((y + bend) % 7 < 4) tileKind[idx(x, y)] = KIND_DIRT;
    }
  }
  /** The cart track: a curved lane of beaten dirt from the city road westward. */
  const trackY = (x: number): number => Math.round(24 + Math.sin((x - 58) / 13) * 7);
  for (let x = 2; x <= 61; x++) {
    const ty = trackY(x);
    for (let y = ty - 1; y <= ty + 1; y++) if (isFloor(x, y)) tileKind[idx(x, y)] = KIND_DIRT;
  }
  // ---- THE BURN: while the company holds the west, the west is ash -------
  const BURN_X = 31; // everything west of this is in the fire's path
  if (!won) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < BURN_X; x++)
        if (isFloor(x, y) && (x + y * 3) % 7 < 5) tileKind[idx(x, y)] = KIND_FARM_ASH;
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
    if (!isFloor(x, y)) return;
    decal({ kind: 'farmcrop', x, y, variant, ox: (rand() - 0.5) * 0.5, oy: (rand() - 0.5) * 0.5 });
  };
  const put = (kind: TownProp['kind'], x: number, y: number, variant?: string): void => {
    if (!isFloor(x, y)) return;
    block({ kind, x, y, variant });
  };
  /** A building: only where its whole footprint is open ground, with a door column carved back out. */
  const steading = (kind: TownProp['kind'], x: number, y: number, w: number, h: number, variant?: string): boolean => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!isFloor(xx, yy)) return false;
    block({ kind, x, y, w, h, variant });
    const dx = x + Math.floor(w / 2);
    for (let yy = y + h - 1; yy < y + h + 1; yy++) {
      if (!inside(dx, yy)) continue;
      grid[idx(dx, yy)] = TILE_FLOOR;
      tileKind[idx(dx, yy)] = KIND_DIRT;
    }
    return true;
  };

  // ---- THE CROP --------------------------------------------------------
  // Standing corn on the ploughed ground; west of the burn line it is stubble
  // while the company holds it, and whole again once they do not.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isFloor(x, y) || tileKind[idx(x, y)] === KIND_GRASS) continue;
      if (Math.abs(y - trackY(x)) <= 1) continue; // the cart track stays clear
      if ((x * 5 + y * 3) % 4 !== 0) continue;
      const burnt = !won && x < BURN_X;
      crop(burnt ? (rand() < 0.5 ? 'farm_burnt_a' : 'farm_burnt_b') : rand() < 0.34 ? 'farm_crop_c' : rand() < 0.5 ? 'farm_crop_b' : 'farm_crop_a', x, y);
    }
  }

  // ---- THE FIRES -------------------------------------------------------
  // Set in the standing corn west of the track's head, where the line is held.
  const fires: Array<{ x: number; y: number }> = [];
  if (!won) {
    // Spaced wide on purpose (it.101): every fire is a looping sprite, a light
    // and an ember hotspot, and a phone pays for all three of them.
    for (let y = 5; y <= 42; y += 6) {
      for (let x = 4; x < BURN_X - 1; x += 7) {
        const fy = y + (x % 3);
        if (!isFloor(x, fy)) continue;
        fires.push({ x, y: fy });
        decal({ kind: 'fieldfire', x, y: fy });
      }
    }
    // Live coals where the fire has already passed, so the burnt ground glows.
    for (let y = 4; y <= 43; y += 3)
      for (let x = 3; x < BURN_X; x += 6) {
        const cy = y + (x % 2);
        if (isFloor(x, cy) && tileKind[idx(x, cy)] === KIND_FARM_ASH) decal({ kind: 'farmcrop', x, y: cy, variant: `farm_coals_${(x + cy) % 4}` });
      }
  }

  // ---- THE STEADINGS ---------------------------------------------------
  // Three farms on the land: the home farm by the city road, one in the middle
  // field, and the western steading the company overran on its way in.
  const yard = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let x = x0; x <= x1; x += 2) {
      decal({ kind: 'fence', x, y: y0 });
      decal({ kind: 'fence', x, y: y1 });
    }
    for (let y = y0 + 2; y < y1; y += 2) {
      decal({ kind: 'fence', x: x0, y });
      decal({ kind: 'fence', x: x1, y });
    }
  };
  // THE HOME FARM (east, by the road in)
  steading('house', 52, 26, 3, 3, 'house_a');
  steading('house', 55, 18, 3, 3, 'house_b');
  steading('barracks', 47, 20, 3, 3); // the great barn
  put('well', 51, 23);
  put('cart', 49, 29);
  put('barrels_stacked', 56, 30);
  put('wood_pile', 46, 27);
  put('stall', 58, 27, 'stall_a');
  yard(45, 17, 59, 31);
  // THE MIDDLE FARM
  steading('house', 33, 9, 3, 3, 'house_c');
  steading('smithy', 37, 12, 3, 3); // the implement shed
  put('cart', 31, 13, 'cart_b');
  put('crates_wood', 36, 8);
  put('barrel', 30, 10, 'barrel_b');
  yard(29, 7, 41, 16);
  // THE WESTERN STEADING - the company came through this one
  steading('house', 12, 30, 3, 3, 'house_d');
  steading('house', 17, 34, 3, 3, 'house_e');
  put('cart', 10, 35);
  put('barrels_stacked', 20, 30);
  put('crates_wood', 9, 28);
  put('wood_pile', 15, 38);
  yard(8, 27, 22, 40);
  // A watchtower on the northern verge, and stalls along the track.
  steading('watchtower', 24, 6, 2, 2);
  put('stall', 27, 26, 'stall_c');
  put('stall', 43, 34, 'stall_d');
  for (const [x, y] of [[6, 18], [21, 20], [38, 28], [44, 12], [26, 38], [54, 34]] as const) put('barrel', x, y, 'barrel_b');
  for (const [x, y] of [[19, 16], [35, 33], [46, 39], [11, 22], [58, 21]] as const) decal({ kind: 'rock', x, y, variant: 'rock_c' });

  // ---- THE HEDGE -------------------------------------------------------
  // Every tile on the field's border carries a tree, so the map is outlined in
  // wood instead of ending at a hard edge. The road mouths are left clear so
  // both ways on stay readable from inside the field.
  const roadMouth = (x: number, y: number): boolean =>
    (Math.abs(y - ENTRY.y) <= 2 && x >= 51) || (Math.abs(y - WEST_WAY.y) <= 2 && x <= 10) || (Math.abs(x - GATES[0].x) <= 2 && y <= 4);
  const TREES = ['pine_a', 'pine_b', 'pine_c', 'tree_a', 'tree_b', 'bigtree_a', 'bigtree_b', 'bigtree_c'] as const;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isFloor(x, y) || roadMouth(x, y)) continue;
      let touches = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) if (isFloor(x + dx, y + dy)) touches = true;
      if (!touches || (x * 3 + y * 5) % 4 === 0) continue; // three tiles in four wear a tree
      const v = TREES[(x * 7 + y * 11) % TREES.length];
      decal({ kind: v.startsWith('bigtree') ? 'bigtree' : v.startsWith('pine') ? 'pine' : 'tree', x, y, variant: v });
    }
  }

  // ---- THE WAYS ON AND THE WAY HOME -------------------------------------
  // The north road is still barricaded. The western road is open ground: the
  // company came up it, and it leads on past the fields.
  const gates = GATES.map((g) => ({ ...g }));
  for (const g of gates) {
    block({ kind: 'barricade', x: g.x, y: g.y, variant: 'barricade_a' });
    if (inside(g.x + 1, g.y)) block({ kind: 'barricade', x: g.x + 1, y: g.y, variant: 'barricade_b' });
    decal({ kind: 'farmgate', x: g.x, y: g.y, variant: g.label });
  }
  decal({ kind: 'farmway', x: WEST_WAY.x, y: WEST_WAY.y, variant: WEST_WAY.label });
  decal({ kind: 'farmroad', x: HOME.x, y: HOME.y });

  // ---- WHAT IS LEFT WHEN IT IS WON --------------------------------------
  const chestSpots = won ? [{ x: 50, y: 22 }, { x: 34, y: 14 }, { x: 14, y: 27 }, { x: 20, y: 37 }] : [];

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
    // rooms[0] is the muster ground by the road in and is never stocked; the
    // rest are the company's line, thickening westward toward the general.
    rooms: [
      { x: 52, y: 20, w: 8, h: 9 },
      { x: 38, y: 24, w: 10, h: 12 },
      { x: 28, y: 10, w: 12, h: 12 },
      { x: 16, y: 22, w: 12, h: 14 },
      { x: 5, y: 8, w: 14, h: 12 },
      { x: 10, y: 32, w: 12, h: 10 },
    ],
    spawn: { ...ENTRY },
    seed,
    tileKind,
    // NO CUBES ON A FIELD (it.101). The border of an organic map touches open
    // ground on every side, so the scene's grey wall blocks stood up in the corn
    // wherever the hedge did not happen to cover one. The fields draw no walls at
    // all: the tree line IS the border, and past it is night.
    wallsFromProps: true,
  };
  const layout = bareLayout(map, props, 'THE FARMLANDS');
  layout.wander = { x: 30, y: 16, w: 20, h: 18 };
  layout.houses = [];
  layout.chests = [];
  for (const c of chestSpots) {
    if (!isFloor(c.x, c.y)) continue;
    grid[idx(c.x, c.y)] = TILE_BLOCKED;
    layout.chests.push(c);
  }
  // The squad forms up between the hero and the field, facing west.
  const squad = [
    { x: ENTRY.x - 2, y: ENTRY.y - 1, officer: true },
    { x: ENTRY.x - 2, y: ENTRY.y + 1 },
    { x: ENTRY.x - 3, y: ENTRY.y },
    { x: ENTRY.x - 1, y: ENTRY.y - 2 },
    { x: ENTRY.x - 1, y: ENTRY.y + 2 },
    { x: ENTRY.x - 4, y: ENTRY.y - 1 },
    { x: ENTRY.x - 4, y: ENTRY.y + 1 },
  ].filter((s) => isFloor(s.x, s.y));
  const farm: FarmLayout = {
    entry: { ...ENTRY },
    home: { ...HOME },
    general: { ...GENERAL },
    squad,
    fires,
    gates: gates.map((g) => ({ x: g.x, y: g.y, label: g.label })),
    west: { ...WEST_WAY },
    won,
  };
  layout.farm = farm;
  return { layout, farm };
}
