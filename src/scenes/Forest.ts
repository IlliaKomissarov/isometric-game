/**
 * @module scenes/Forest
 * THE DARK FOREST (it.85): the outdoor road east of the Market Ward. A
 * 56×40 clearing map in the town's own idiom — grass and dirt paint, cliff
 * cubes at the edge, trees as solid props — with one winding road from the
 * town gate on the west edge to the QUARRY MOUTH on the east, four
 * clearings along it where the wolves and poachers wait, and no room for
 * a wrong turn: every tile the flood fill cannot reach from the road is
 * forest.
 *
 * It is dressed by `placeTownProps` (trees, rocks, torches, the two
 * passages), so it returns a full TownLayout with the town's vendor and
 * landmark fields parked off the map.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type Room } from '@/scenes/DungeonGenerator';
import { KIND_COBBLE, KIND_DIRT, KIND_GRASS, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { mulberry32 } from '@/utils/rng';

export const FOREST_W = 56;
export const FOREST_H = 40;

const OFF = { x: -9, y: -9 };
const NO_VENDOR = { x: -9, y: -9, tiles: [] as Array<{ x: number; y: number }> };

/** A TownLayout with every landmark off the map: the base for any dressed outdoor floor. */
export function bareLayout(map: TownMap, props: TownProp[], name: string): TownLayout {
  return {
    map,
    props,
    gate: { ...OFF },
    stash: { ...OFF },
    merchant: NO_VENDOR,
    alchemist: NO_VENDOR,
    board: { ...OFF },
    arenaGate: { ...OFF },
    arenaMaster: { ...OFF },
    campfire: { ...OFF },
    forge: { ...OFF },
    campSpots: [
      { x: -30, y: -30 },
      { x: -31, y: -30 },
      { x: -32, y: -30 },
    ],
    portal: { ...OFF },
    wander: { x: 0, y: 0, w: 1, h: 1 },
    houses: [],
    guards: [],
    jeweler: NO_VENDOR,
    scribe: NO_VENDOR,
    bowyer: NO_VENDOR,
    notice: { ...OFF },
    gateways: [],
    wander2: { x: 0, y: 0, w: 1, h: 1 },
    guards2: [],
    districts: [{ name, x: 0, y: 0, w: map.width, h: map.height }],
  };
}

export interface ForestLayout {
  layout: TownLayout;
  /** Where the hero arrives from town, and the two passages. */
  entry: { x: number; y: number };
  townRoad: { x: number; y: number };
  quarry: { x: number; y: number };
}

export function buildForestLayout(seed: number): ForestLayout {
  const W = FOREST_W;
  const H = FOREST_H;
  const rand = mulberry32((seed ^ 0xf0a357) >>> 0);
  const grid = new Uint8Array(W * H).fill(TILE_FLOOR);
  const tileKind = new Uint8Array(W * H).fill(KIND_GRASS);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // The cliff rim: two tiles, ragged.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (edge < 2 || (edge === 2 && rand() < 0.45)) grid[idx(x, y)] = TILE_WALL;
    }

  const road = new Uint8Array(W * H);
  const street = (pts: Array<[number, number]>, kind: number, half: number): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
      for (let s = 0; s <= n; s++) {
        const cx = x0 + ((x1 - x0) * s) / n;
        const cy = y0 + ((y1 - y0) * s) / n;
        for (let oy = -half; oy <= half; oy++)
          for (let ox = -half; ox <= half; ox++) {
            const tx = Math.round(cx + ox);
            const ty = Math.round(cy + oy);
            if (!inside(tx, ty) || tx < 1 || ty < 1 || tx > W - 2 || ty > H - 2) continue;
            if (Math.hypot(ox, oy) > half + 0.3) continue;
            grid[idx(tx, ty)] = TILE_FLOOR;
            tileKind[idx(tx, ty)] = kind;
            road[idx(tx, ty)] = 1;
          }
      }
    }
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, kind: number): void => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (!inside(x, y) || x < 2 || y < 2 || x > W - 3 || y > H - 3) continue;
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) {
          grid[idx(x, y)] = TILE_FLOOR;
          tileKind[idx(x, y)] = kind;
          road[idx(x, y)] = 1;
        }
      }
  };

  // THE ROAD: town gate (west) to the quarry mouth (east), by four clearings.
  const entry = { x: 4, y: 20 };
  const townRoad = { x: 2, y: 20 };
  const quarry = { x: 53, y: 18 };
  street([[2, 20], [8, 20], [14, 17], [20, 21], [26, 24], [32, 19], [38, 15], [44, 19], [49, 18], [53, 18]], KIND_DIRT, 1.2);
  const clearings: Room[] = [
    { x: 11, y: 14, w: 7, h: 6 },
    { x: 22, y: 21, w: 8, h: 6 },
    { x: 35, y: 12, w: 7, h: 6 },
    { x: 41, y: 17, w: 8, h: 6 },
  ];
  ellipse(14.5, 17, 4.5, 3.4, KIND_GRASS);
  ellipse(26, 24, 5, 3.6, KIND_GRASS);
  ellipse(38.5, 15, 4.5, 3.4, KIND_GRASS);
  ellipse(45, 20, 4.8, 3.6, KIND_GRASS);
  ellipse(4.5, 20, 3, 2.6, KIND_DIRT); // The gate yard.
  ellipse(52, 18, 3.2, 2.8, KIND_COBBLE); // The quarry apron: broken stone.
  grid[idx(townRoad.x, townRoad.y)] = TILE_FLOOR;
  tileKind[idx(townRoad.x, townRoad.y)] = KIND_DIRT;

  // ---- THE PASSAGES AND THE DRESSING ----
  const props: TownProp[] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    const w = p.w ?? 1;
    const h = p.h ?? 1;
    for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) if (inside(x, y)) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };
  // The town road: a column each side of the way in, the passage plate on the west tile.
  block({ kind: 'townroad', x: townRoad.x, y: townRoad.y });
  block({ kind: 'pillar', x: 3, y: 18 });
  block({ kind: 'pillar', x: 3, y: 22 });
  block({ kind: 'torch', x: 6, y: 18 });
  block({ kind: 'torch', x: 6, y: 22 });
  // The quarry mouth: the arch into the rock, rocks and a broken cart about it.
  block({ kind: 'quarry', x: quarry.x, y: quarry.y });
  block({ kind: 'rock', x: 52, y: 16, variant: 'rock_e' });
  block({ kind: 'rock', x: 54, y: 20, variant: 'rock_c' });
  block({ kind: 'rock', x: 50, y: 15, variant: 'rock_f' });
  block({ kind: 'cart', x: 49, y: 20, w: 2, h: 1 });
  block({ kind: 'wood_pile', x: 51, y: 21 });
  block({ kind: 'crates', x: 55, y: 17 });
  block({ kind: 'lamp', x: 51, y: 16 });
  block({ kind: 'lamp', x: 54, y: 21 });
  // The clearings: a felled camp in each — kegs, a fire's remains, a rack.
  block({ kind: 'wood_pile', x: 13, y: 15 });
  block({ kind: 'barrel', x: 16, y: 19, variant: 'barrel_c' });
  block({ kind: 'crates_wood', x: 23, y: 26 });
  block({ kind: 'trashbox', x: 28, y: 22 });
  block({ kind: 'rack', x: 37, y: 13 });
  block({ kind: 'barricade', x: 40, y: 17, variant: 'barricade_b' });
  block({ kind: 'jar', x: 46, y: 22, variant: 'jar_b' });
  block({ kind: 'statue', x: 42, y: 14, variant: 'statue_b' });
  for (const [x, y] of [[12, 19], [29, 25], [36, 17], [47, 17], [20, 19], [32, 17]] as const) if (grid[idx(x, y)] === TILE_FLOOR && !road[idx(x, y)]) block({ kind: 'torch', x, y });

  // ---- THE WOODS: everything off the road and the clearings ----
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (grid[i] !== TILE_FLOOR || road[i]) continue;
      let nearRoad = false;
      for (let oy = -1; oy <= 1 && !nearRoad; oy++) for (let ox = -1; ox <= 1 && !nearRoad; ox++) if (inside(x + ox, y + oy) && road[idx(x + ox, y + oy)]) nearRoad = true;
      const roll = rand();
      if (nearRoad) {
        // The verge: brush and the odd rock, never a wall of trees.
        if (roll < 0.35) decal({ kind: 'grassclump', x, y });
        else if (roll < 0.42) block({ kind: 'rock', x, y, variant: ['rock_a', 'rock_b', 'rock_c'][Math.floor(rand() * 3)] });
        continue;
      }
      if (roll < 0.7) {
        const v = roll < 0.2 ? 'pine_a' : roll < 0.34 ? 'pine_b' : roll < 0.44 ? 'pine_c' : roll < 0.52 ? 'tree_a' : roll < 0.58 ? 'tree_b' : roll < 0.64 ? 'bigtree_a' : rand() < 0.5 ? 'dead_a' : 'dead_b';
        block({ kind: v.startsWith('dead') ? 'deadtree' : v.startsWith('bigtree') ? 'bigtree' : 'pine', x, y, variant: v });
      } else if (roll < 0.86) {
        decal({ kind: 'grassclump', x, y });
      }
    }
  // The cliff ring wears its own trees, so no raw cube edge shows.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (grid[i] !== TILE_WALL) continue;
      let nearOpen = false;
      for (let oy = -2; oy <= 2 && !nearOpen; oy++) for (let ox = -2; ox <= 2 && !nearOpen; ox++) if (inside(x + ox, y + oy) && grid[idx(x + ox, y + oy)] !== TILE_WALL) nearOpen = true;
      if (!nearOpen) continue;
      const roll = rand();
      if (roll < 0.6) {
        const v = roll < 0.25 ? 'pine_a' : roll < 0.42 ? 'pine_b' : roll < 0.5 ? 'pine_c' : rand() < 0.5 ? 'dead_a' : 'dead_b';
        props.push({ kind: v.startsWith('dead') ? 'deadtree' : 'pine', x, y, variant: v });
      }
    }

  // ---- SELF-HEAL: any floor the road cannot reach becomes forest ----
  const seen = new Uint8Array(W * H);
  const stack = [idx(entry.x, entry.y)];
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
  for (let i = 0; i < grid.length; i++)
    if (grid[i] === TILE_FLOOR && !seen[i]) {
      grid[i] = TILE_BLOCKED;
      const x = i % W;
      const y = (i - x) / W;
      props.push({ kind: 'pine', x, y, variant: rand() < 0.5 ? 'pine_b' : 'pine_c' });
    }

  const map: TownMap = {
    width: W,
    height: H,
    grid,
    // The clearings are the "rooms" the spawner fills; the gate yard is the spawn room.
    rooms: [{ x: 3, y: 18, w: 4, h: 4 }, ...clearings],
    spawn: entry,
    seed,
    tileKind,
  };
  return { layout: bareLayout(map, props, 'THE DARK FOREST'), entry, townRoad, quarry };
}
