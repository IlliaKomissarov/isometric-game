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
import { assets } from '@/core/AssetManager';
import { claimProp, KIND_COBBLE, KIND_DIRT, KIND_GRASS, sweepRoads, type RoadCtx, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { mulberry32 } from '@/utils/rng';

export const FOREST_W = 56;
export const FOREST_H = 40;

/**
 * THE OVERWORLD'S OWN GROUND (it.115). Four kinds past the battlefield's 14,
 * baked in it.114 as `ow_<stem>_0..3` (four gain-matched 64x32 diamonds each)
 * and never laid until now: leaf litter, moss, gravel and wet mud. Every
 * outdoor floor paints them as PATCHES over its own base, laid by the map's
 * geometry (a bank, a verge, a yard, the ground under a wood) - the town's, the
 * farm's and the meadow's earlier tiles stay underneath (the it.113 rule).
 *
 * `main.ts` registers them by index next to `field_*` (stems `ow_forest`,
 * `ow_moss`, `ow_gravel`, `ow_mud`, and since the re-bake `ow_meadow`,
 * `ow_flowers`, `ow_poppies`). A floor painting a kind the atlas has not
 * registered throws in `AssetManager.get`, so every painter asks `owGround()`
 * first and a build without the registration simply keeps its old ground.
 *
 * THE RE-BAKE (it.115). The kinds are colour-matched to the grass they lie on
 * (`scripts/bake-buildings.py`, "TONED, NOT GAINED"), and `GroundBlend` feathers
 * every patch into its neighbours, so a patch is a soft, ragged shape and not a
 * staircase of diamonds.
 */
export const KIND_OW_FOREST = 15;
export const KIND_OW_MOSS = 16;
export const KIND_OW_GRAVEL = 17;
export const KIND_OW_MUD = 18;
/** LUSH GRASS (it.115): the Overworld forest sheet's long grass, toned onto the town's green - variety inside a meadow. */
export const KIND_OW_MEADOW = 19;
/** FLOWER BEDS (it.115): Screaming Brain's Flora sheets - pale wildflowers on green, and red poppies. */
export const KIND_OW_FLOWERS = 20;
export const KIND_OW_POPPIES = 21;
const OW_KINDS = [KIND_OW_FOREST, KIND_OW_MOSS, KIND_OW_GRAVEL, KIND_OW_MUD, KIND_OW_MEADOW, KIND_OW_FLOWERS, KIND_OW_POPPIES] as const;

/** True when all seven overworld kinds are registered as floor textures (it.115). */
export function owGround(): boolean {
  return OW_KINDS.every((k) => assets.has(`floor_town_${k}`) || assets.has(`floor_town_${k}_0`));
}

/**
 * A PATCH'S EDGE (it.115): a smooth, low-frequency wobble, so a patch is one
 * shape with a ragged outline and never a dither of single diamonds (the
 * it.112 chequer lesson). A pure function of the tile - no shared random.
 */
function edgeWobble(x: number, y: number): number {
  return 0.16 * Math.sin(x * 0.93 + y * 0.41) + 0.12 * Math.cos(y * 0.77 - x * 0.29);
}

/** One ground painter per floor (it.115): patches and strips, each guarded by the floor's own rule. */
export interface GroundPainter {
  /** An elliptical patch centred on (cx, cy). */
  patch(cx: number, cy: number, rx: number, ry: number, kind: number): void;
  /** A band `half` tiles either side of a polyline (a road's shoulder, a bank). */
  strip(pts: ReadonlyArray<readonly [number, number]>, half: number, kind: number): void;
  /** One tile, if the rule allows it. */
  tile(x: number, y: number, kind: number): void;
}

/**
 * `ok(x, y)` is the floor's rule for what may be repainted (never water, never
 * the road, never the far bank...). When the overworld kinds are not
 * registered every call is a no-op.
 */
export function groundPainter(W: number, H: number, tileKind: Uint8Array, ok: (x: number, y: number) => boolean): GroundPainter {
  const live = owGround();
  const tile = (x: number, y: number, kind: number): void => {
    if (!live || x < 0 || y < 0 || x >= W || y >= H || !ok(x, y)) return;
    tileKind[y * W + x] = kind;
  };
  return {
    tile,
    patch(cx, cy, rx, ry, kind) {
      for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
        for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
          const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
          if (d <= 1 + edgeWobble(x, y) * 1.6) tile(x, y, kind);
        }
    },
    strip(pts, half, kind) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3) + 1;
        for (let s = 0; s <= n; s++) {
          const cx = x0 + ((x1 - x0) * s) / n;
          const cy = y0 + ((y1 - y0) * s) / n;
          const r = half + 1;
          for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
              if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= half + edgeWobble(x, y) * 2) tile(x, y, kind);
        }
      }
    },
  };
}

/** The twelve baked tufts (`tuft_a..l`), picked by tile so no two neighbours match. */
export function tuftVariant(x: number, y: number): string {
  return `tuft_${'abcdefghijkl'[(x * 7 + y * 13) % 12]}`;
}
/** The five little rock groups of the ancient set, by tile. */
export function rocksVariant(x: number, y: number): string {
  return `anc_prop_rocks0${1 + ((x * 3 + y * 5) % 5)}`;
}
/** The five mushroom clumps of the ancient set, by tile. */
export function mushroomVariant(x: number, y: number): string {
  return `anc_prop_mushroom0${1 + ((x * 5 + y * 3) % 5)}`;
}
/** The eight carts and carriages of the ancient set, by tile. */
export function carriageVariant(x: number, y: number): string {
  return `anc_prop_carriage0${1 + ((x * 11 + y * 7) % 8)}`;
}
/**
 * A SMALL PIECE UNDERFOOT (it.115). `rock` is paint (`PROP_FOOTPRINT` says
 * `none`) and its dresser draws whatever single the variant names, depth-sorted
 * on its tile - so a tuft, a stone group or a mushroom clump is a `rock` with
 * that variant, and the hero walks through it.
 */
export function smallPiece(x: number, y: number, variant: string): TownProp {
  return { kind: 'rock', x, y, variant, ox: ((((x * 5 + y * 3) % 7) - 3) * 0.07), oy: ((((x * 3 + y * 11) % 7) - 3) * 0.07) };
}
/** Hash in [0, 1) of a tile and a salt: a pure density test that never touches the shared stream. */
export function tileHash(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

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

export function buildForestLayout(seed: number, safe = false): ForestLayout {
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

  /** Road AND clearings: what the woods keep off. */
  const road = new Uint8Array(W * H);
  /** THE WAY ITSELF (it.114): the dirt road only - what a post keeps off and the sweep clears. A clearing is open ground, not a street. */
  const way = new Uint8Array(W * H);
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
            way[idx(tx, ty)] = 1;
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
  const ctx: RoadCtx = { width: W, height: H, grid, road: way };
  /** The one placer (it.114): paint is listed, a post keeps off the way, the rest is solid. */
  const block = (p: TownProp): boolean => claimProp(ctx, props, p) !== null;
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
        // FUNGUS IN THE SHADE (it.115): one clump in four of the undergrowth is a mushroom ring, off the shared stream.
        decal(tileHash(x, y, 3) < 0.25 ? smallPiece(x, y, mushroomVariant(x, y)) : { kind: 'grassclump', x, y });
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
        // SCENERY ONLY (it.114): a tree on the cliff has the wall behind it and the woods before it - nothing stands behind one.
        props.push({ kind: v.startsWith('dead') ? 'deadtree' : 'pine', x, y, variant: v, bare: true });
      }
    }
  // THE WAY STAYS OPEN (it.114): a post that landed on the road steps to the verge; a boulder or a store on it goes.
  sweepRoads(ctx, props);

  /**
   * THE FOREST FLOOR (it.115). "The tiles have no variety": the whole wood was
   * one grass diamond with trees on it. The ground is now laid by what stands
   * on it - leaf litter under the wood, moss where the wood meets a clearing
   * and in the damp hollows, mud where the road dips, and the road turning to
   * gravel as it climbs to the quarry, round the cobbled apron.
   */
  {
    const offWay = groundPainter(W, H, tileKind, (x, y) => grid[idx(x, y)] !== TILE_WALL && !road[idx(x, y)]);
    const glade = groundPainter(W, H, tileKind, (x, y) => grid[idx(x, y)] !== TILE_WALL && !!road[idx(x, y)] && !way[idx(x, y)] && tileKind[idx(x, y)] === KIND_GRASS);
    const onWay = groundPainter(W, H, tileKind, (x, y) => !!way[idx(x, y)] && tileKind[idx(x, y)] === KIND_DIRT);
    // Leaf litter: every tile of the wood itself.
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) offWay.tile(x, y, KIND_OW_FOREST);
    // Moss where the canopy opens: the rim of each clearing, one tile deep.
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        if (!road[idx(x, y)] || way[idx(x, y)]) continue;
        let rim = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (!road[idx(x + dx, y + dy)]) rim = true;
        if (rim) glade.tile(x, y, KIND_OW_MOSS);
      }
    // The damp hollows in the wood, by hand.
    for (const [cx, cy, rx, ry] of [[9, 10, 3.2, 2.4], [20, 8, 2.8, 2.2], [31, 31, 3.6, 2.6], [45, 9, 3, 2.4], [47, 29, 3.4, 2.6], [17, 30, 2.6, 2.2], [36, 26, 2.4, 2]] as const)
      offWay.patch(cx, cy, rx, ry, KIND_OW_MOSS);
    /**
     * THE GLADES FLOWER (it.115): long grass drifting through every clearing,
     * wildflowers where the canopy is widest, and one bed of poppies - so a
     * clearing reads as a clearing and not as a lawn cut out of the wood.
     */
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const drift = Math.sin(x * 0.37 + y * 0.29) + Math.cos(y * 0.41 - x * 0.17 + 0.6);
        if (drift > 0.9) glade.tile(x, y, KIND_OW_MEADOW);
      }
    glade.patch(38.5, 14.2, 1.9, 1.3, KIND_OW_FLOWERS);
    glade.patch(13.2, 16.4, 1.7, 1.2, KIND_OW_FLOWERS);
    glade.patch(46.4, 19.2, 1.4, 1.0, KIND_OW_POPPIES);
    // A mossy bed in the heart of the second and fourth clearings.
    glade.patch(25.5, 24.5, 2.2, 1.4, KIND_OW_MOSS);
    glade.patch(45.5, 21, 1.8, 1.2, KIND_OW_MOSS);
    // Mud where the road dips between the clearings, and at the gate yard's low side.
    onWay.patch(20, 21, 1.8, 1.4, KIND_OW_MUD);
    onWay.patch(32, 19, 1.6, 1.3, KIND_OW_MUD);
    onWay.patch(5, 21.5, 1.6, 1.2, KIND_OW_MUD);
    // The last stretch to the quarry is gravel, and the apron is ringed with it.
    onWay.strip([[42, 17], [44, 19], [49, 18], [53, 18]], 1.6, KIND_OW_GRAVEL);
    // The apron itself is gravel too (it.115): its cobble diamonds alternated
    // light and dark and read as a chequer at the quarry's mouth.
    const apron = groundPainter(W, H, tileKind, (x, y) => grid[idx(x, y)] !== TILE_WALL);
    apron.patch(52, 18, 4.8, 4.2, KIND_OW_GRAVEL);

    // THE SMALL THINGS (it.115): tufts in the glades, stones on the gravel, never under a standing piece or a chest.
    const taken = new Set<number>();
    for (const p of props) taken.add(idx(p.x, p.y));
    for (const c of [{ x: 12, y: 15 }, { x: 28, y: 26 }, { x: 43, y: 21 }]) taken.add(idx(c.x, c.y));
    for (let y = 2; y < H - 2; y++)
      for (let x = 2; x < W - 2; x++) {
        const i = idx(x, y);
        if (taken.has(i) || grid[i] !== TILE_FLOOR || way[i]) continue;
        const k = tileKind[i];
        if (road[i] && (k === KIND_GRASS || k === KIND_OW_MOSS || k === KIND_OW_MEADOW) && tileHash(x, y, 1) < 0.16) decal(smallPiece(x, y, tuftVariant(x, y)));
        else if (k === KIND_OW_GRAVEL && tileHash(x, y, 2) < 0.22) decal(smallPiece(x, y, rocksVariant(x, y)));
      }
    // And the verge of the road itself: stones where the way climbs.
    for (let y = 2; y < H - 2; y++)
      for (let x = 30; x < W - 2; x++) {
        const i = idx(x, y);
        if (!way[i] || taken.has(i) || grid[i] !== TILE_FLOOR) continue;
        let edge = false;
        for (const [dx, dy] of [[0, 1], [0, -1]] as const) if (!way[idx(x + dx, y + dy)]) edge = true;
        if (edge && tileHash(x, y, 4) < 0.1) decal(smallPiece(x, y, rocksVariant(x, y)));
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
  const layout = bareLayout(map, props, 'THE DARK FOREST');
  // LOOTABLE CHESTS (it.92): one in three of the clearings, off the road.
  layout.chests = [];
  for (const c of [{ x: 12, y: 15 }, { x: 28, y: 26 }, { x: 43, y: 21 }]) {
    if (grid[idx(c.x, c.y)] !== TILE_FLOOR) continue; // A clearing counts as road here; the spots are its edges, off the way through.
    grid[idx(c.x, c.y)] = TILE_BLOCKED;
    layout.chests.push(c);
  }
  if (safe) {
    // THE FOREST CLEARED (it.87): sentries at the gate yard, folk in the second clearing.
    layout.guards = [
      { x: 5, y: 18 },
      { x: 5, y: 22 },
    ];
    for (const g of layout.guards) if (grid[idx(g.x, g.y)] === TILE_FLOOR) grid[idx(g.x, g.y)] = TILE_BLOCKED;
    layout.wander = { x: 23, y: 21, w: 7, h: 5 };
  }
  return { layout, entry, townRoad, quarry };
}
