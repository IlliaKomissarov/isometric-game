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
 * GEOGRAPHY (it.101, re-cornered it.102). The marsh gateway stands on the WEST
 * side of the city, so the road out of town runs west and comes down onto the
 * fields at their NORTH-EAST corner — the far corner from the company, which is
 * dug in at the south-west. The assault therefore runs corner to corner, on the
 * long diagonal, instead of straight across the middle:
 *
 *   NORTH-EAST corner  the city road, the signpost home, and the muster ground
 *                      the squad forms up on.
 *   WEST edge          the ground the company holds, its general at the head of
 *                      it, and behind them THE ONE LOCKED GATE on the map — the
 *                      western road, barricaded, for a country not built yet.
 *
 * THE SHAPE (it.101) is a union of five overlapping lobes, not a rectangle: the
 * field bulges and pinches the way worked land actually does.
 *
 * THE BELT (it.103). The border is not a line of trees any more, it is FOUR
 * RINGS of them, thinning outward: two solid rings of hedge and pine at the
 * field's edge, and heavy timber behind those, so the map ends in a wood instead
 * of in a row. The rings are found with one BFS out of the open ground, and the
 * whole floor is revealed on arrival, so the belt is drawn from the first frame
 * rather than fading in as the hero walks toward it.
 *
 * Two states, and the layout is a pure function of which one it is in:
 *
 *   BURNING  the crop is alight, the company holds the western rows, and the
 *            far lanes are barricaded. This is the battle.
 *   WON      the fires are out, the corn stands whole, the folk are back on the
 *            land, and the yards are quiet.
 *
 * Chests are scattered over the whole map in BOTH states (it.102): a field
 * fought across should pay while it is being fought across, not only after.
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

/** Where the hero and the squad arrive from the city road: the NE corner (it.102). */
const ENTRY = { x: 55, y: 8 };
/** The signpost at the head of the city road: the way back to the marsh gate. */
const HOME = { x: 60, y: 4 };
/**
 * THE CITY ROAD (it.102). It comes down off the corner in a bend rather than a
 * straight run, so the arrival reads as a road and not as a corridor. Carved
 * three tiles wide, and every point on it counts as a road mouth for the hedge.
 */
const ROAD: ReadonlyArray<{ x: number; y: number }> = [
  { x: 62, y: 3 },
  { x: 60, y: 4 },
  { x: 58, y: 6 },
  { x: 55, y: 8 },
  { x: 52, y: 11 },
];
/** The lane the enemy holds, and the general's ground at the far west of it. */
const GENERAL = { x: 9, y: 13 };
/**
 * THE ONE LOCKED GATE (it.102). The map has exactly one road that does not go
 * anywhere yet, it is on the WEST edge, and it is barricaded. Everything else
 * the hero can walk up to on this floor is a place they may actually go, so no
 * signpost on the fields ever has to say "not open".
 */
const GATES = [{ x: 1, y: 22, label: 'THE WESTERN ROAD' }] as const;

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
  /** A straight run of open ground between two points, `half` tiles either side. */
  const path = (a: { x: number; y: number }, b: { x: number; y: number }, half = 1): void => {
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 2));
    for (let i = 0; i <= steps; i++) {
      const cx = Math.round(a.x + ((b.x - a.x) * i) / steps);
      const cy = Math.round(a.y + ((b.y - a.y) * i) / steps);
      for (let y = cy - half; y <= cy + half; y++)
        for (let x = cx - half; x <= cx + half; x++) if (inside(x, y) && x > 0 && y > 0 && x < W - 1 && y < H - 1) grid[idx(x, y)] = TILE_FLOOR;
    }
  };
  for (let i = 1; i < ROAD.length; i++) path(ROAD[i - 1], ROAD[i]); // down off the corner, in from the city
  lane(1, 9, GATES[0].y); // west, to the barricade and the road that is not cut yet

  // ---- THE PLOUGHING: wavy strips, so no two rows run quite parallel ----
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isFloor(x, y)) continue;
      const bend = Math.round(Math.sin(x * 0.16) * 2 + Math.cos(x * 0.07) * 1.5);
      if ((y + bend) % 7 < 4) tileKind[idx(x, y)] = KIND_DIRT;
    }
  }
  /**
   * The cart track: a curved lane of beaten dirt running the long diagonal, from
   * the city road at the north-east corner down and across to the company's
   * ground in the west (it.102). It is the line the whole battle is fought along.
   */
  const trackY = (x: number): number => Math.round(22 - ((x - 2) / 59) * 13 + Math.sin((x - 30) / 11) * 3);
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
  const roadMouth = (x: number, y: number): boolean => {
    if (Math.abs(y - GATES[0].y) <= 2 && x <= 10) return true; // the barricaded western road
    for (const r of ROAD) if (Math.abs(x - r.x) <= 2 && Math.abs(y - r.y) <= 2) return true; // the city road off the corner
    return false;
  };
  const NEAR_TREES = ['tree_a', 'tree_b', 'pine_a', 'pine_b', 'pine_c'] as const;
  const DEEP_TREES = ['bigtree_a', 'bigtree_b', 'bigtree_c', 'pine_a', 'pine_c', 'tree_b'] as const;
  {
    // HOW FAR EACH CLOSED TILE IS FROM OPEN GROUND. One BFS out of the field
    // over the tiles that are not field, to `BELT` rings deep. Ring 1 is the
    // tile line the corn actually ends at; the rings behind it are the wood
    // standing behind the hedge.
    const BELT = 4;
    const depth = new Int8Array(W * H).fill(-1);
    let frontier: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (isFloor(x, y)) {
          depth[idx(x, y)] = 0;
          frontier.push(idx(x, y));
        }
    for (let ring = 1; ring <= BELT && frontier.length; ring++) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % W;
        const y = (i - x) / W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inside(nx, ny)) continue;
          const j = idx(nx, ny);
          if (depth[j] !== -1) continue;
          depth[j] = ring;
          next.push(j);
        }
      }
      frontier = next;
    }
    // How thickly each ring is planted. The first two are solid - that is the
    // wall of wood - and it thins behind them so the far edge is a wood rather
    // than a fence. Deterministic in the tile's own coordinates: the border must
    // not move the shared random stream (it.98).
    const FILL = [0, 1, 1, 0.72, 0.5] as const;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = depth[idx(x, y)];
        if (d <= 0) continue;
        if (roadMouth(x, y) && d <= 2) continue; // both ways on stay readable from inside
        const fill = FILL[d] ?? 0;
        if (fill < 1 && ((x * 13 + y * 7) % 100) / 100 >= fill) continue;
        // The near ring is the hedge itself - ordinary trees and pines, so the
        // field's edge stays readable. Behind it the wood is heavy timber.
        const set = d <= 1 ? NEAR_TREES : DEEP_TREES;
        const v = set[(x * 7 + y * 11) % set.length];
        decal({ kind: v.startsWith('bigtree') ? 'bigtree' : v.startsWith('pine') ? 'pine' : 'tree', x, y, variant: v, ox: (((x * 5 + y * 3) % 7) - 3) * 0.06, oy: (((x * 3 + y * 11) % 7) - 3) * 0.06 });
      }
    }
  }

  // ---- THE WAY ON AND THE WAY HOME --------------------------------------
  // ONE LOCKED GATE, ON THE WEST EDGE (it.102). The company came up the western
  // road and barricaded it behind them; it is the only thing on this floor the
  // hero can walk up to and be told no. Everything else goes somewhere.
  const gates = GATES.map((g) => ({ ...g }));
  for (const g of gates) {
    block({ kind: 'barricade', x: g.x, y: g.y, variant: 'barricade_a' });
    if (inside(g.x, g.y + 1)) block({ kind: 'barricade', x: g.x, y: g.y + 1, variant: 'barricade_b' });
    decal({ kind: 'farmgate', x: g.x, y: g.y, variant: g.label });
  }
  decal({ kind: 'farmroad', x: HOME.x, y: HOME.y });

  // ---- WHAT IS ON THE LAND ----------------------------------------------
  // CHESTS IN BOTH STATES (it.102). Scattered the length of the diagonal, so
  // the march west is worth making slowly, and so the quiet field afterwards
  // still has something in its yards. A spot that is not open ground is dropped.
  const chestSpots = [
    { x: 51, y: 15 },
    { x: 44, y: 6 },
    { x: 37, y: 26 },
    { x: 33, y: 14 },
    { x: 25, y: 34 },
    { x: 14, y: 27 },
    { x: 20, y: 37 },
    { x: 7, y: 15 },
  ];

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
      { x: 49, y: 4, w: 10, h: 9 }, // the muster ground under the city road (it.102)
      { x: 40, y: 12, w: 11, h: 12 },
      { x: 28, y: 10, w: 12, h: 14 },
      { x: 30, y: 28, w: 12, h: 12 },
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
  // The squad forms up on the muster ground below the road head, facing down the
  // diagonal (it.102) - south-west, at the company.
  const squad = [
    { x: ENTRY.x - 2, y: ENTRY.y + 1, officer: true },
    { x: ENTRY.x - 1, y: ENTRY.y + 2 },
    { x: ENTRY.x - 3, y: ENTRY.y },
    { x: ENTRY.x - 4, y: ENTRY.y + 2 },
    { x: ENTRY.x, y: ENTRY.y + 3 },
    { x: ENTRY.x - 5, y: ENTRY.y },
    { x: ENTRY.x - 2, y: ENTRY.y + 4 },
    { x: ENTRY.x - 6, y: ENTRY.y + 2 },
  ].filter((s) => isFloor(s.x, s.y));
  const farm: FarmLayout = {
    entry: { ...ENTRY },
    home: { ...HOME },
    general: { ...GENERAL },
    squad,
    fires,
    gates: gates.map((g) => ({ x: g.x, y: g.y, label: g.label })),
    won,
  };
  layout.farm = farm;
  return { layout, farm };
}
