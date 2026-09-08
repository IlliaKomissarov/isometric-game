/**
 * @module town/TownMap
 * FLOOR 0 — the handcrafted town (it.39 → organic it.43 → NORTH GATE +
 * dense it.44). A 60×54 map whose edge is a noise-carved blob:
 *
 *   outside the blob:  cliffs (the map's only true walls)
 *   the belt inside:   dense pines and dead trees, brush between them
 *   NORTH (top centre): the DUNGEON GATE — the ruin archway; touching its
 *                      front tile descends at once
 *   the interior:      a winding cobbled MAIN STREET from the gate down to
 *                      the MARKET SQUARE (six stalls, the shopkeeper, the
 *                      well), a HIGH STREET east–west, a SOUTH STREET to
 *                      the lower plaza, dirt lanes to seven cottages and
 *                      the TAVERN, the STASH VAULT (NW), the CAMPSITE
 *                      clearing (SW), the portal yard (SE), torch posts
 *                      along every street, two gate guards (the gate
 *                      is glued into the straight WEST shelf since it.47)
 *   every open patch:  tree clusters and bush tufts — no empty lawns
 *
 * Every standing object claims a TILE_BLOCKED footprint BEFORE the scene
 * builds; flat decals stay walkable. Cottages keep their door column
 * walkable (roof cutaway inside). After carving, a flood fill from the
 * spawn turns every unreachable floor pocket into brush; then a second
 * pass drops the dense fill only where it cannot cut a route.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type DungeonMap, type Room } from '@/scenes/DungeonGenerator';
import { mulberry32 } from '@/utils/rng';

/** THE EASTERN QUARTER (it.91): the map grew east; everything at x >= EAST_X is the burnt quarter. */
export const TOWN_W = 116;
/** Two districts since it.84: the old quarter (y < 52) and the Market Ward below the gate. */
export const TOWN_H = 98;
export const EAST_X = 60;
/** The barricade's column: the east road crosses it at x 61. */
export const EAST_GATE_X = 61;
/** Looters that hold the quarter (it.91). */
export const LOOTER_COUNT = 20;
/** The row of the ward gate: everything at or below it is the Market Ward. */
export const WARD_Y = 52;

/** Ground paint per tile in the town theme. */
export const KIND_COBBLE = 0;
export const KIND_GRASS = 1;
export const KIND_DIRT = 2;
/** Coliseum sand (it.55). */
export const KIND_SAND = 3;
/** THE GILDED STAG's boards (it.92). */
export const KIND_PLANK = 4;

export type TownPropKind =
  | 'house'
  | 'tavern'
  | 'stall'
  | 'campfire'
  | 'forge'
  | 'well'
  | 'stash'
  | 'pillar'
  | 'column'
  | 'torch'
  | 'brazier'
  | 'ruingate'
  | 'fence'
  | 'tree'
  | 'pine'
  | 'deadtree'
  | 'barrel'
  | 'barrels_stacked'
  | 'crates'
  | 'crates_wood'
  | 'wood_pile'
  | 'table_chairs'
  | 'supports'
  | 'stairs_stone'
  | 'signpost'
  | 'hanging_sign'
  | 'grassclump'
  | 'rock'
  | 'watchtower'
  | 'pots'
  | 'pentagram'
  | 'merchant'
  | 'alchemist'
  | 'board'
  | 'arenagate'
  | 'arenamaster'
  | 'guard'
  // THE MARKET WARD (it.84): the new part's props.
  | 'guildhall'
  | 'statue'
  | 'bench'
  | 'cart'
  | 'barricade'
  | 'dummy'
  | 'jar'
  | 'box'
  | 'trashbox'
  | 'table'
  | 'bigtree'
  | 'lamp'
  | 'banner'
  | 'rack'
  | 'chest_market'
  | 'potions'
  | 'notice'
  | 'gateway'
  | 'jeweler'
  | 'scribe'
  | 'bowyer'
  // THE FOREST AND THE QUARRY (it.85).
  | 'gate'
  | 'quarry'
  | 'townroad'
  | 'gatekeeper'
  // THE TRAINING GROUND (it.90): the sign that starts the tutorial.
  | 'trainpost'
  // THE EASTERN QUARTER (it.91): ruins, rubble, the fallen, the inn, its bed, the barricade.
  | 'ruin'
  | 'heap'
  | 'ruinwall'
  | 'rubble'
  | 'slab'
  | 'debris'
  | 'corpse'
  | 'embers'
  | 'tavern2'
  | 'innkeeper'
  | 'bed'
  | 'gatebar'
  | 'smithy'
  | 'barracks'
  // THE GILDED STAG INSIDE (it.92): the inn's own floor.
  | 'inndoor'
  | 'barkeep'
  | 'hearth'
  | 'inntable'
  | 'innchair'
  | 'candle'
  | 'carpet'
  | 'shelf'
  | 'chest';

/** THE GILDED STAG INSIDE (it.92): what main needs of the inn's floor. */
export interface InnLayout {
  keeper: { x: number; y: number };
  door: { x: number; y: number };
  bed: { x: number; y: number };
  stash: { x: number; y: number };
  forge: { x: number; y: number };
  /** The hall the patrons stroll. */
  hall: Room;
}

/** THE EASTERN QUARTER (it.91): how the barricade stands when the town is built. */
export type EastState = 'sealed' | 'open' | 'cleared';

export interface EastQuarter {
  state: EastState;
  /** The barricade's tiles (all in one column); `gap` is the one pulled aside when the errand is taken. */
  gateTiles: Array<{ x: number; y: number }>;
  gap: { x: number; y: number };
  /** A road tile before the gate (the refugees' side) and one past it. */
  approach: { x: number; y: number };
  inside: { x: number; y: number };
  /** Where the innkeeper stands: at the gate until the quarter is cleared, then behind the inn's counter. */
  innkeeper: { x: number; y: number };
  /** The refugees huddle here before the gate; the returned folk wander the square. */
  refuge: Room;
  wander3: Room;
  /** Twenty posts the looters hold, in the order they are counted. */
  banditPosts: Array<{ x: number; y: number; kind: 'bandit' | 'brigand' }>;
  tavern: { x: number; y: number; w: number; h: number };
  door: { x: number; y: number };
  bed: { x: number; y: number };
  roomStash: { x: number; y: number };
  roomForge: { x: number; y: number };
  square: { x: number; y: number };
}

/**
 * SMALL CLUTTER (it.88): decoration that stands in no one's way. A jar, a
 * pot, a box, a bin, a wood pile, a grass clump, a sign on a wall - drawn,
 * never a blocked tile. Every placer (the town, the forest, the quarry)
 * asks this before it claims a tile.
 */
export const CLUTTER_KINDS: ReadonlySet<TownPropKind> = new Set<TownPropKind>(['grassclump', 'jar', 'pots', 'box', 'trashbox', 'potions', 'hanging_sign', 'crates_wood', 'wood_pile', 'rubble', 'slab', 'debris', 'corpse', 'embers', 'carpet']);

export interface TownProp {
  kind: TownPropKind;
  /** Top-left tile of the footprint (or the tile itself for 1×1 props). */
  x: number;
  y: number;
  /** Blocked footprint in tiles (omit for flat decals). */
  w?: number;
  h?: number;
  /** Atlas single/anim variant (house_a…, stall_b…, pine_c…). */
  variant?: string;
  /** Mirror the sprite (it.87): a gate across a corridor running the other way. */
  flip?: boolean;
}

export interface TownLayout {
  map: DungeonMap;
  props: TownProp[];
  /** Front tile of the dungeon gate (touching it descends to depth I). */
  gate: { x: number; y: number };
  stash: { x: number; y: number };
  /** Tiles that count as "at the stall" for the TRADE prompt (the ARMORER, it.48). */
  merchant: { x: number; y: number; tiles: Array<{ x: number; y: number }> };
  /** The ALCHEMIST's stall (it.48): draughts and scrolls. */
  alchemist: { x: number; y: number; tiles: Array<{ x: number; y: number }> };
  /** The DUNGEON RECORDS board (it.48). */
  board: { x: number; y: number };
  /** THE TRIAL COLISEUM (it.53): the arch on the east road and its master. */
  arenaGate: { x: number; y: number };
  arenaMaster: { x: number; y: number };
  campfire: { x: number; y: number };
  /** THE CAMP FORGE (it.78): the anvil beside the fire. */
  forge: { x: number; y: number };
  /** Where the three unselected heroes rest (tile centres, facing the fire). */
  campSpots: Array<{ x: number; y: number }>;
  /** Where a town portal from the depths deposits the hero (and its return portal). */
  portal: { x: number; y: number };
  /** Villagers wander inside this room. */
  wander: Room;
  /** Cottage footprints (for the "inside" cutaway). */
  houses: Array<{ x: number; y: number; w: number; h: number }>;
  /** Gate guards (render-only sentries). */
  guards: Array<{ x: number; y: number }>;
  // ---- THE MARKET WARD (it.84) ----
  /** The ward's own vendors: rings and amulets, scrolls, bows and staves. */
  jeweler: { x: number; y: number; tiles: Array<{ x: number; y: number }> };
  scribe: { x: number; y: number; tiles: Array<{ x: number; y: number }> };
  bowyer: { x: number; y: number; tiles: Array<{ x: number; y: number }> };
  /** The guild's bounty board. */
  notice: { x: number; y: number };
  /** Passages: a `dest` leads somewhere (it.85: the forest); without one the way is not built yet. */
  gateways: Array<{ x: number; y: number; label: string; note: string; dest?: 'forest' }>;
  /** Street tiles (it.85): the ones a standing prop must never take. */
  road?: Uint8Array;
  /** THE GATEKEEPER (it.87): the sentry at the eastern road who hands out the forest's first errand. */
  gatekeeper?: { x: number; y: number };
  /** THE TRAINING GROUND (it.90): the sign at the yard, and the mark the party is placed on. */
  training?: { post: { x: number; y: number }; mark: { x: number; y: number } };
  /** The ward's folk wander here. */
  wander2: Room;
  /** The ward gate's sentries. */
  guards2: Array<{ x: number; y: number }>;
  /** Named districts, by tile rectangle (first match wins). */
  districts: Array<{ name: string; x: number; y: number; w: number; h: number }>;
  /** THE EASTERN QUARTER (it.91): the town only; the forest and the quarry have none. */
  east?: EastQuarter;
  /** THE GILDED STAG INSIDE (it.92): the inn's floor only. */
  inn?: InnLayout;
  /** LOOTABLE CHESTS (it.92): where the district's small chests stand (the `chest` props' tiles). */
  chests?: Array<{ x: number; y: number }>;
}

export interface TownMap extends DungeonMap {
  readonly tileKind: Uint8Array;
}

/** Build the town: grid + footprints + prop list. Pure and deterministic. */
export function buildTownLayout(opts: { east?: EastState } = {}): TownLayout {
  const eastState: EastState = opts.east ?? 'sealed';
  const W = TOWN_W;
  const H = TOWN_H;
  const rand = mulberry32(0x70712);
  const grid = new Uint8Array(W * H).fill(TILE_FLOOR);
  const tileKind = new Uint8Array(W * H).fill(KIND_GRASS);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // ---- THE BLOB: polar radius with three sines + a bump toward the gate (NORTH) ----
  const CX = 30;
  const CY = 27;
  const radiusAt = (theta: number): number => {
    // WEST GATE (it.46): a gentle bulge toward the west cliff where the archway is set.
    const bump = 2 * Math.exp(-((Math.PI - Math.abs(theta)) ** 2) / 0.2);
    return 24.5 + 2.6 * Math.sin(2 * theta + 1.3) + 1.8 * Math.sin(5 * theta + 0.4) + 1.4 * Math.sin(3 * theta + 2.6) + bump;
  };
  const polar = (x: number, y: number): { r: number; theta: number } => {
    const dx = (x + 0.5 - CX) / 1.12;
    const dy = (y + 0.5 - CY) / 0.94;
    return { r: Math.hypot(dx, dy), theta: Math.atan2(dy, dx) };
  };
  // THE MARKET WARD'S BLOB (it.84): a second clearing south of the first,
  // its own forest belt, joined to the old quarter by one road through
  // the woods between them.
  const CX2 = 31;
  const CY2 = 75;
  const radiusAt2 = (theta: number): number => 19.5 + 2.2 * Math.sin(2 * theta + 0.7) + 1.5 * Math.sin(5 * theta + 1.9) + 1.2 * Math.sin(3 * theta + 0.2);
  const polar2 = (x: number, y: number): { r: number; theta: number } => {
    const dx = (x + 0.5 - CX2) / 1.18;
    const dy = (y + 0.5 - CY2) / 0.94;
    return { r: Math.hypot(dx, dy), theta: Math.atan2(dy, dx) };
  };
  // THE EASTERN QUARTER'S BLOB (it.91): a third clearing east of the old
  // quarter, the largest of the three, dented toward the barricade so the
  // woods between the gate and the ruins stay two tiles deep.
  const CX3 = 87;
  const CY3 = 40;
  const radiusAt3 = (theta: number): number => {
    const dent = 2.5 * Math.exp(-((Math.PI - Math.abs(theta)) ** 2) / 0.3);
    return 25 + 2.2 * Math.sin(2 * theta + 0.9) + 1.5 * Math.sin(5 * theta + 2.1) + 1.1 * Math.sin(3 * theta + 0.5) - dent;
  };
  const polar3 = (x: number, y: number): { r: number; theta: number } => {
    const dx = (x + 0.5 - CX3) / 0.92;
    const dy = (y + 0.5 - CY3) / 1.35;
    return { r: Math.hypot(dx, dy), theta: Math.atan2(dy, dx) };
  };
  const belt = new Uint8Array(W * H);
  /** STREET TILES (it.85): a lamp or a store never stands in the road; a plaza is not a road. */
  const road = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p1 = polar(x, y);
      const R1 = radiusAt(p1.theta);
      const p2 = polar2(x, y);
      const R2 = radiusAt2(p2.theta);
      const p3 = polar3(x, y);
      const R3 = radiusAt3(p3.theta);
      const in1 = p1.r <= R1 && x <= EAST_X - 2; // The old quarter ends where its border wall stood before the map grew (it.91).
      const in2 = p2.r <= R2;
      const in3 = p3.r <= R3 && x >= EAST_X + 4;
      if ((!in1 && !in2 && !in3) || x === 0 || y === 0 || x === W - 1 || y === H - 1) grid[idx(x, y)] = TILE_WALL;
      else if ((in1 && p1.r > R1 - 2.6 && !in2) || (in2 && p2.r > R2 - 2.6 && !in1) || (in3 && p3.r > R3 - 2.6)) belt[idx(x, y)] = 1;
    }
  }

  const street = (pts: Array<[number, number]>, kind: number, half: number): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
      for (let s = 0; s <= n; s++) {
        const cx = x0 + ((x1 - x0) * s) / n;
        const cy = y0 + ((y1 - y0) * s) / n;
        for (let oy = -half; oy <= half; oy++) {
          for (let ox = -half; ox <= half; ox++) {
            const tx = Math.round(cx + ox);
            const ty = Math.round(cy + oy);
            if (!inside(tx, ty) || tx < 1 || ty < 1 || tx > W - 2 || ty > H - 2) continue;
            if (Math.hypot(ox, oy) > half + 0.3) continue;
            grid[idx(tx, ty)] = TILE_FLOOR;
            belt[idx(tx, ty)] = 0;
            tileKind[idx(tx, ty)] = kind;
            road[idx(tx, ty)] = 1;
          }
        }
      }
    }
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, kind: number): void => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (!inside(x, y)) continue;
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) {
          if (grid[idx(x, y)] === TILE_WALL) continue;
          grid[idx(x, y)] = TILE_FLOOR;
          tileKind[idx(x, y)] = kind;
          belt[idx(x, y)] = 0;
        }
      }
    }
  };

  // ---- STREETS ----
  const gate = { x: 3, y: 26 }; // WEST (it.49): the threshold INSIDE the archway, a 1×4 segment standing TWO tiles out from the west wall (x 3, y 25–28).
  ellipse(30, 22, 9.5, 6.5, KIND_COBBLE); // The market square.
  street([[13, 13], [17, 15], [21, 18], [24, 20]], KIND_COBBLE, 1.2); // The north-west quarter's lane -> square.
  street([[30, 28], [29, 33], [30, 38], [30, 44]], KIND_COBBLE, 1.3); // South street -> lower plaza.
  street([[5, 26], [8, 27], [15, 29], [22, 28], [38, 28], [45, 27], [52, 25]], KIND_COBBLE, 1.3); // High street: WEST gate -> square -> east.
  ellipse(30, 44.5, 3.5, 2.2, KIND_COBBLE); // Lower plaza.
  street([[36, 12], [34, 16]], KIND_DIRT, 1.0); // Tavern lane.
  street([[45, 27], [47, 20]], KIND_DIRT, 0.9); // NE cottage.
  street([[10, 19], [12, 16], [13, 13]], KIND_DIRT, 0.9); // NW cottage -> the quarter's lane (the west shelf cut the old lane).
  street([[15, 29], [12, 34]], KIND_DIRT, 0.9); // W cottage.
  street([[52, 25], [50, 33]], KIND_DIRT, 0.9); // E cottage.
  street([[22, 28], [19, 33], [17, 36]], KIND_DIRT, 1.0); // To the camp.
  street([[38, 28], [42, 34], [43, 37]], KIND_DIRT, 0.9); // To the portal stone.
  street([[15, 29], [14, 24]], KIND_DIRT, 0.9); // To the vault.
  street([[30, 38], [36, 42]], KIND_DIRT, 0.9); // SE cottage.
  street([[30, 38], [24, 42]], KIND_DIRT, 0.9); // SW cottage.
  street([[20, 13], [24, 16]], KIND_DIRT, 0.9); // N cottage.
  ellipse(17.5, 37.5, 4.5, 3.6, KIND_DIRT); // Camp clearing.
  ellipse(43.5, 37.5, 2.5, 2, KIND_DIRT); // Portal stone yard.
  // THE EASTERN QUARTER'S STREETS (it.91): the east road from the portal yard
  // through the woods to the barricade; past it the burnt avenue to the
  // square, three roads to the gateways, and the lanes of the ruined rows.
  street([[46, 38], [52, 36], [57, 34], [61, 32], [66, 31]], KIND_COBBLE, 1.3); // The east road: portal yard -> the east gate.
  ellipse(87, 40, 7.5, 5, KIND_COBBLE); // The burnt square.
  street([[66, 31], [72, 34], [80, 38]], KIND_COBBLE, 1.4); // The gate avenue -> the square.
  street([[87, 35], [88, 24], [88, 10]], KIND_COBBLE, 1.3); // North to the north road.
  street([[87, 45], [87, 56], [88, 66]], KIND_COBBLE, 1.3); // South to the south fields.
  street([[94, 40], [102, 40], [110, 40]], KIND_COBBLE, 1.3); // East to the river gate.
  street([[80, 38], [76, 44], [72, 54]], KIND_DIRT, 1.0); // The inn's lane (south-west).
  street([[88, 24], [98, 20], [104, 14]], KIND_DIRT, 1.0); // The north-east lane.
  street([[87, 56], [96, 58], [104, 62]], KIND_DIRT, 1.0); // The south-east lane.
  street([[88, 24], [78, 20], [72, 14]], KIND_DIRT, 0.9); // The north-west lane.
  street([[94, 40], [100, 30]], KIND_DIRT, 0.9); // The alley.
  street([[102, 40], [104, 50]], KIND_DIRT, 0.9); // The tanners' alley.
  ellipse(76.5, 52.5, 4, 3, KIND_DIRT); // The inn's yard.

  // ---- PROPS ----
  const props: TownProp[] = [];
  const houses: TownLayout['houses'] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    if (CLUTTER_KINDS.has(p.kind)) return; // Small clutter never blocks (it.88).
    const w = p.w ?? 1;
    const h = p.h ?? 1;
    for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) if (inside(x, y)) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };
  /**
   * OFF THE ROAD (it.85): the nearest open grass tile beside (x, y) when
   * (x, y) is a street tile — a lamp lights the road from its verge, it
   * never stands in it. Null when no verge is free.
   */
  const offRoad = (x: number, y: number): { x: number; y: number } | null => {
    const free = (tx: number, ty: number): boolean => inside(tx, ty) && grid[idx(tx, ty)] === TILE_FLOOR && !road[idx(tx, ty)] && !belt[idx(tx, ty)];
    if (free(x, y)) return { x, y };
    for (let r = 1; r <= 2; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && free(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    return null;
  };
  const placeLamp = (kind: 'torch' | 'lamp', x: number, y: number): void => {
    const at = offRoad(x, y);
    if (at) block({ kind, x: at.x, y: at.y });
  };
  const clearFor = (x: number, y: number, w: number, h: number, pad = 1, kind = KIND_GRASS): void => {
    for (let ty = y - pad; ty < y + h + pad; ty++) {
      for (let tx = x - pad; tx < x + w + pad; tx++) {
        if (!inside(tx, ty) || grid[idx(tx, ty)] === TILE_WALL) continue;
        grid[idx(tx, ty)] = TILE_FLOOR;
        belt[idx(tx, ty)] = 0;
        if (kind !== KIND_GRASS) tileKind[idx(tx, ty)] = kind;
      }
    }
  };
  const house = (x: number, y: number, variant: string): void => {
    clearFor(x, y, 3, 3);
    block({ kind: 'house', x, y, w: 3, h: 3, variant });
    grid[idx(x + 1, y + 1)] = TILE_FLOOR;
    grid[idx(x + 1, y + 2)] = TILE_FLOOR;
    tileKind[idx(x + 1, y + 2)] = KIND_DIRT;
    tileKind[idx(x + 1, y + 1)] = KIND_DIRT;
    houses.push({ x, y, w: 3, h: 3 });
  };

  // The DUNGEON GATE (WEST, it.47 — glued to the wall): the baked ruin
  // gate is a THIN WALL SEGMENT four tiles long whose arch faces EAST, so it
  // belongs IN the west wall, not in front of it. The west wall is a straight
  // two-tile column (x 0–1, y 19–34) whose lit east face is the flat wall the
  // town sees; the gate replaces its front tiles at x 1, y 25–28 (its sprite
  // is anchored on its own south corner, so it sits on the column with no
  // offset). The threshold is the tile INSIDE the arch opening (1,26):
  // touching it from the apron descends. The apron (x 2–10, y 21–32) is
  // bare cobble (x 2–10, y 19–34) — no props, trees, lights or collision.
  clearFor(2, 19, 9, 16, 0, KIND_COBBLE);
  for (let y = 19; y <= 34; y++) for (let x = 0; x <= 1; x++) if (inside(x, y)) grid[idx(x, y)] = TILE_WALL; // The straight west wall.
  // TWO TILES OUT (it.49): the segment stands on x 3; the strip behind it (x 2)
  // is solid rock so nothing walks between the gate and the wall.
  props.push({ kind: 'ruingate', x: 3, y: 25, w: 1, h: 4 });
  for (let y = 25; y <= 28; y++) grid[idx(3, y)] = TILE_BLOCKED; // The segment's piers.
  for (let y = 25; y <= 28; y++) grid[idx(2, y)] = TILE_BLOCKED; // The rock spur behind it (no cube: not adjacent to floor).
  grid[idx(gate.x, gate.y)] = TILE_FLOOR; // The opening — the threshold.
  tileKind[idx(gate.x, gate.y)] = KIND_COBBLE;
  belt[idx(gate.x, gate.y)] = 0; // Never a belt tile: the forest pass must not re-block the threshold.
  // The guards keep watch from the far end of the apron, off the wall.
  const guards = [
    { x: 14, y: 26 },
    { x: 14, y: 29 },
  ];
  for (const g of guards) block({ kind: 'guard', x: g.x, y: g.y });
  // The north-west quarter: cottages, stalls, stores and fences along its lane.
  house(16, 7, 'house_d');
  house(6, 14, 'house_b');
  for (const x of [16, 18, 19]) block({ kind: 'fence', x, y: 10 });
  for (const x of [6, 8, 9]) block({ kind: 'fence', x, y: 17 });
  block({ kind: 'stall', x: 15, y: 12, w: 3, h: 2, variant: 'stall_a' });
  block({ kind: 'stall', x: 19, y: 13, w: 3, h: 2, variant: 'stall_d' });
  block({ kind: 'crates_wood', x: 14, y: 14 });
  block({ kind: 'barrels_stacked', x: 18, y: 16 });
  block({ kind: 'barrel', x: 22, y: 16, variant: 'barrel_b' });
  block({ kind: 'wood_pile', x: 11, y: 14 });
  decal({ kind: 'pots', x: 16, y: 15 });
  decal({ kind: 'hanging_sign', x: 18, y: 15 });
  decal({ kind: 'signpost', x: 13, y: 15 });
  for (const [x, y] of [[9, 13], [13, 13], [15, 17], [20, 19]] as const) placeLamp('torch', x, y);

  // The tavern (NE of the square): 5×4, a stone stair and a table outside.
  clearFor(35, 9, 5, 4, 1);
  block({ kind: 'tavern', x: 35, y: 9, w: 5, h: 4, variant: 'tavern_a' });
  decal({ kind: 'stairs_stone', x: 37, y: 13 });
  block({ kind: 'table_chairs', x: 40, y: 12 });
  block({ kind: 'barrels_stacked', x: 34, y: 12 });
  block({ kind: 'supports', x: 33, y: 9 });
  placeLamp('torch', 40, 9);

  // Market square: six stalls, the shopkeeper, the well, stores, signs, torches.
  block({ kind: 'stall', x: 23, y: 17, w: 3, h: 2, variant: 'stall_a' });
  block({ kind: 'merchant', x: 24, y: 16 });
  block({ kind: 'alchemist', x: 24, y: 24 }); // The ALCHEMIST behind the south stall (it.48).
  block({ kind: 'board', x: 32, y: 31 }); // The DUNGEON RECORDS board off the south street (it.48).
  // THE TRIAL COLISEUM (it.53): a cobbled apron at the end of the high street,
  // the arch between two pillars, the Arena Master before it.
  clearFor(51, 22, 6, 6, 0, KIND_COBBLE);
  block({ kind: 'pillar', x: 53, y: 23 });
  block({ kind: 'pillar', x: 55, y: 23 });
  block({ kind: 'arenagate', x: 54, y: 23 });
  block({ kind: 'arenamaster', x: 53, y: 26 });
  block({ kind: 'brazier', x: 56, y: 26 });
  // THE WATCHTOWER (it.55): the town's east lookout beside the coliseum road.
  clearFor(48, 20, 2, 2, 1);
  block({ kind: 'watchtower', x: 48, y: 20, w: 2, h: 2 });
  block({ kind: 'stall', x: 34, y: 17, w: 3, h: 2, variant: 'stall_b' });
  block({ kind: 'stall', x: 23, y: 25, w: 3, h: 2, variant: 'stall_c' });
  block({ kind: 'stall', x: 34, y: 25, w: 3, h: 2, variant: 'stall_d' });
  block({ kind: 'stall', x: 20, y: 21, w: 3, h: 2, variant: 'stall_b' });
  block({ kind: 'stall', x: 37, y: 21, w: 3, h: 2, variant: 'stall_c' });
  block({ kind: 'well', x: 30, y: 21, w: 2, h: 2, variant: 'well_b' });
  block({ kind: 'crates_wood', x: 27, y: 16 });
  block({ kind: 'barrel', x: 37, y: 19, variant: 'barrel_a' });
  block({ kind: 'barrel', x: 22, y: 24, variant: 'barrel_b' });
  block({ kind: 'wood_pile', x: 36, y: 24 });
  block({ kind: 'barrels_stacked', x: 26, y: 27 });
  block({ kind: 'crates', x: 33, y: 27 });
  decal({ kind: 'pots', x: 26, y: 19 });
  decal({ kind: 'pots', x: 33, y: 24 });
  decal({ kind: 'hanging_sign', x: 26, y: 18 });
  decal({ kind: 'hanging_sign', x: 34, y: 19 });
  decal({ kind: 'signpost', x: 30, y: 27 });
  for (const [x, y] of [[21, 16], [39, 16], [21, 28], [39, 28]] as const) placeLamp('torch', x, y);
  block({ kind: 'column', x: 28, y: 29 });
  block({ kind: 'column', x: 32, y: 29 });

  // Stash vault (NW).
  clearFor(13, 22, 3, 2, 1);
  block({ kind: 'stash', x: 14, y: 23 });
  block({ kind: 'barrel', x: 13, y: 22, variant: 'barrel_a' });
  block({ kind: 'barrel', x: 15, y: 22, variant: 'barrel_b' });
  block({ kind: 'crates', x: 12, y: 23 });
  placeLamp('torch', 16, 23);

  // Cottages (seven).
  house(9, 16, 'house_a');
  house(46, 15, 'house_b');
  house(9, 32, 'house_c');
  house(48, 31, 'house_d');
  house(35, 41, 'house_a');
  house(22, 41, 'house_b');
  house(22, 9, 'house_c');
  for (const x of [8, 9, 11, 12]) block({ kind: 'fence', x, y: 19 });
  for (const x of [45, 46, 48, 49]) block({ kind: 'fence', x, y: 18 });
  placeLamp('torch', 13, 33);
  placeLamp('torch', 46, 34);
  placeLamp('torch', 25, 44);
  placeLamp('torch', 38, 44);

  // Campsite (SW): the fire, the heroes' spots, seats and stores.
  const campfire = { x: 17, y: 37 };
  block({ kind: 'campfire', x: campfire.x, y: campfire.y });
  // THE CAMP FORGE (it.78): an anvil two strides west of the fire.
  const forge = { x: 14, y: 36 };
  block({ kind: 'forge', x: forge.x, y: forge.y });
  const campSpots = [
    { x: 15.5, y: 36.4 },
    { x: 16.6, y: 39.5 },
    { x: 19.5, y: 37.6 },
  ];
  block({ kind: 'wood_pile', x: 20, y: 35 });
  block({ kind: 'barrels_stacked', x: 14, y: 39 });
  decal({ kind: 'pots', x: 19, y: 39 });
  placeLamp('torch', 21, 39);
  // THE CAMP (it.49): a few more comforts around the fire — a keg, a crate, cookware.
  block({ kind: 'barrel', x: 13, y: 36, variant: 'barrel_a' });
  block({ kind: 'crates', x: 21, y: 37 });
  decal({ kind: 'pots', x: 15, y: 41 });

  // Torch posts along the streets.
  for (const [x, y] of [[27, 32], [31, 32], [28, 36], [32, 36], [28, 41], [32, 41], [11, 26], [17, 27], [24, 27], [36, 27], [43, 26], [50, 24], [30, 8], [26, 12]] as const) {
    if (grid[idx(x, y)] === TILE_FLOOR) placeLamp('torch', x, y);
  }

  // ============================================================================
  // THE MARKET WARD (it.84): the road south, the gate, the plaza and its
  // monument, three new vendors, the guildhall and its bounty board, a
  // training yard, a park, three cottages, and two gateways to roads that
  // are not built yet. Every standing thing claims its footprint here, so
  // collision, pathing and the audit all agree before the scene draws.
  // ============================================================================
  const tryBlock = (p: TownProp, kind = KIND_GRASS): boolean => {
    // A prop that would seal a route, or land on paint, a door or another
    // prop, is not placed: the roads stay open by construction.
    const w = p.w ?? 1;
    const h = p.h ?? 1;
    for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) if (!inside(x, y) || grid[idx(x, y)] !== TILE_FLOOR || (kind === KIND_GRASS && tileKind[idx(x, y)] !== KIND_GRASS) || belt[idx(x, y)] || road[idx(x, y)]) return false;
    if (CLUTTER_KINDS.has(p.kind)) {
      props.push(p); // Drawn on its tile, the tile stays open (it.88).
      return true;
    }
    block(p);
    const seen0 = wardReach();
    for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) grid[idx(x, y)] = TILE_FLOOR;
    const seen1 = wardReach();
    if (seen1 - seen0 > w * h) {
      props.pop();
      return false;
    }
    // Re-claim the tiles WITHOUT pushing the prop again (it.90): the first
    // `block` already listed it - a second push drew every placed prop twice
    // and doubled its plate and interactable.
    for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) if (inside(x, y)) grid[idx(x, y)] = TILE_BLOCKED;
    return true;
  };
  /** Reachable floor from the old spawn (a cheap flood count for tryBlock). */
  const wardReach = (): number => {
    const seen = new Uint8Array(W * H);
    const stack = [idx(30, 30)];
    seen[stack[0]] = 1;
    let n = 1;
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
        n++;
        stack.push(j);
      }
    }
    return n;
  };

  // THE SOUTH ROAD: from the lower plaza through the woods to the ward gate and the plaza.
  street([[30, 45], [30, 49], [31, 53], [31, 58], [31, 63]], KIND_COBBLE, 1.4);
  // THE WARD GATE: a cobbled apron in the woods, two pillars with banners, two sentries.
  clearFor(27, 51, 8, 3, 0, KIND_COBBLE);
  block({ kind: 'banner', x: 28, y: 52 });
  block({ kind: 'banner', x: 34, y: 52 });
  const guards2 = [
    { x: 29, y: 55 },
    { x: 33, y: 55 },
  ];
  for (const g of guards2) block({ kind: 'guard', x: g.x, y: g.y });
  // THE PLAZA and its streets.
  ellipse(31, 70, 10.5, 6.5, KIND_COBBLE); // The market plaza.
  street([[31, 76], [31, 82], [31, 86]], KIND_COBBLE, 1.3); // South to the marsh gateway.
  street([[41, 70], [46, 71], [50, 72]], KIND_COBBLE, 1.3); // East to the road gateway.
  street([[21, 70], [16, 72]], KIND_DIRT, 1.1); // West to the training yard.
  street([[38, 65], [39, 62]], KIND_DIRT, 1.0); // The guildhall's lane.
  street([[43, 73], [45, 76]], KIND_DIRT, 0.9); // SE cottage.
  street([[22, 75], [19, 78]], KIND_DIRT, 0.9); // SW cottage.
  street([[44, 66], [46, 63]], KIND_DIRT, 0.9); // NE cottage.
  ellipse(16, 72.5, 4.5, 3.4, KIND_DIRT); // The training yard.
  ellipse(45.5, 68, 4.5, 3.6, KIND_GRASS); // The park (a lawn, kept open).
  // THE GUILDHALL: the timber-frame hall (4x4, solid) and the bounty board before it.
  clearFor(39, 57, 4, 4, 1);
  block({ kind: 'guildhall', x: 39, y: 57, w: 4, h: 4 });
  block({ kind: 'notice', x: 37, y: 62 });
  placeLamp('lamp', 38, 58);
  placeLamp('lamp', 43, 61);
  block({ kind: 'banner', x: 43, y: 57 });
  // THE MONUMENT: the seated king on the plaza, benches at his feet, banners on columns.
  block({ kind: 'statue', x: 30, y: 69, w: 2, h: 2, variant: 'statue_a' });
  block({ kind: 'bench', x: 27, y: 72, w: 2, h: 1, variant: 'bench_a' });
  block({ kind: 'bench', x: 33, y: 72, w: 2, h: 1, variant: 'bench_b' });
  block({ kind: 'banner', x: 26, y: 65 });
  block({ kind: 'banner', x: 36, y: 65 });
  // THE VENDORS: the jeweler (west), the scribe (east), the bowyer (south-west).
  block({ kind: 'stall', x: 23, y: 66, w: 3, h: 2, variant: 'stall_c' });
  block({ kind: 'jeweler', x: 24, y: 65 });
  block({ kind: 'stall', x: 36, y: 66, w: 3, h: 2, variant: 'stall_b' });
  block({ kind: 'scribe', x: 37, y: 65 });
  block({ kind: 'stall', x: 23, y: 74, w: 3, h: 2, variant: 'stall_d' });
  block({ kind: 'bowyer', x: 24, y: 73 });
  decal({ kind: 'potions', x: 39, y: 67 });
  block({ kind: 'crates_wood', x: 22, y: 65 });
  block({ kind: 'rack', x: 26, y: 73 });
  block({ kind: 'cart', x: 33, y: 77, w: 2, h: 1 });
  block({ kind: 'jar', x: 22, y: 68, variant: 'jar_a' });
  block({ kind: 'jar', x: 39, y: 68, variant: 'jar_b' });
  block({ kind: 'box', x: 27, y: 66, variant: 'box_a' });
  block({ kind: 'box', x: 35, y: 68, variant: 'box_b' });
  block({ kind: 'trashbox', x: 40, y: 75 });
  block({ kind: 'barrel', x: 21, y: 74, variant: 'barrel_c' });
  block({ kind: 'barrel', x: 38, y: 76, variant: 'barrel_d' });
  block({ kind: 'table', x: 36, y: 74 });
  decal({ kind: 'hanging_sign', x: 26, y: 67 });
  decal({ kind: 'hanging_sign', x: 39, y: 66 });
  decal({ kind: 'pots', x: 27, y: 75 });
  for (const [x, y] of [[22, 64], [40, 64], [22, 76], [40, 76]] as const) placeLamp('lamp', x, y);
  for (const [x, y] of [[28, 79], [34, 79], [28, 84], [34, 84], [44, 69], [47, 74], [18, 68]] as const) placeLamp('lamp', x, y);
  // THE TRAINING YARD (west): barricades, dummies, a rack, kegs.
  block({ kind: 'barricade', x: 13, y: 70, variant: 'barricade_a' });
  block({ kind: 'barricade', x: 19, y: 69, variant: 'barricade_b' });
  // THE TRAINING GROUND (it.90): the dummies are BODIES now (main spawns a
  // passive foe on each tile; the prop keeps the tile solid and draws nothing),
  // and a sign at the yard's head offers the tutorial.
  block({ kind: 'dummy', x: 14, y: 73, variant: 'dummy_a' });
  block({ kind: 'dummy', x: 17, y: 74, variant: 'dummy_b' });
  block({ kind: 'dummy', x: 15, y: 75, variant: 'dummy_a' });
  const training = { post: { x: 16, y: 70 }, mark: { x: 16, y: 72 } };
  if (!tryBlock({ kind: 'trainpost', x: training.post.x, y: training.post.y }, KIND_DIRT)) decal({ kind: 'trainpost', x: training.post.x, y: training.post.y });
  block({ kind: 'rack', x: 16, y: 69 });
  block({ kind: 'barrels_stacked', x: 12, y: 73 });
  placeLamp('torch', 19, 75);
  // THE PARK (east): the big trees, a bench, a jar, a table.
  block({ kind: 'bigtree', x: 43, y: 65, variant: 'bigtree_a' });
  block({ kind: 'bigtree', x: 48, y: 66, variant: 'bigtree_b' });
  block({ kind: 'bigtree', x: 46, y: 70, variant: 'bigtree_c' });
  block({ kind: 'bench', x: 44, y: 68, w: 2, h: 1, variant: 'bench_a' });
  block({ kind: 'jar', x: 48, y: 69, variant: 'jar_a' });
  block({ kind: 'table', x: 42, y: 68 });
  // COTTAGES of the ward.
  house(45, 77, 'house_b');
  house(17, 79, 'house_c');
  house(45, 60, 'house_d');
  for (const x of [45, 47, 48]) block({ kind: 'fence', x, y: 81 });
  for (const x of [16, 18, 19]) block({ kind: 'fence', x, y: 83 });
  placeLamp('torch', 44, 80);
  placeLamp('torch', 20, 80);
  // THE GATEWAYS: two passages to zones not built yet — pillars, the standing
  // light, a plate that says so. Their tiles are blocked: no one walks into a
  // road that is not there.
  const gateways: TownLayout['gateways'] = [
    { x: 31, y: 88, label: 'THE MARSH PATH', note: 'The marsh path is not open yet — the boards are still being laid.' },
    { x: 52, y: 72, label: 'THE EASTERN ROAD', note: 'The road runs east into the dark forest, and the quarry beyond it.', dest: 'forest' },
  ];
  clearFor(29, 86, 5, 3, 0, KIND_COBBLE);
  block({ kind: 'pillar', x: 29, y: 88 });
  block({ kind: 'pillar', x: 33, y: 88 });
  block({ kind: 'gateway', x: 31, y: 88 });
  clearFor(50, 70, 3, 5, 0, KIND_COBBLE);
  block({ kind: 'pillar', x: 52, y: 70 });
  block({ kind: 'pillar', x: 52, y: 74 });
  block({ kind: 'gateway', x: 52, y: 72 });
  // THE GATEKEEPER (it.87): a sentry in the gate yard, south-west of the
  // light - in the open, not behind the pines that crowd the gateway's north.
  const gatekeeper = { x: 50, y: 74 };
  block({ kind: 'gatekeeper', x: gatekeeper.x, y: gatekeeper.y });

  // ==== THE EASTERN QUARTER (it.91) ====================================
  // The barricade: every road tile in the gate's column is a wall of
  // carts and timber; the militia's apron before it holds the refugees.
  const gateTiles: EastQuarter['gateTiles'] = [];
  for (let y = 26; y <= 38; y++) if (grid[idx(EAST_GATE_X, y)] === TILE_FLOOR) gateTiles.push({ x: EAST_GATE_X, y });
  const gap = gateTiles[Math.floor(gateTiles.length / 2)] ?? { x: EAST_GATE_X, y: 32 };
  clearFor(56, 30, 4, 6, 0, KIND_COBBLE); // The militia's apron.
  const approach = { x: 58, y: gap.y };
  const eastIn = { x: 65, y: 31 };
  const refuge: Room = { x: 55, y: 30, w: 5, h: 6 };
  const innAtGate = { x: 57, y: 31 };
  if (eastState !== 'cleared') {
    for (const t of gateTiles) {
      if (eastState === 'open' && t.x === gap.x && t.y === gap.y) continue; // The cart pulled aside.
      block({ kind: 'gatebar', x: t.x, y: t.y, variant: (t.y & 1) === 0 ? 'barricade_a' : 'barricade_b' });
    }
    block({ kind: 'innkeeper', x: innAtGate.x, y: innAtGate.y });
    block({ kind: 'crates', x: 56, y: 35 });
    block({ kind: 'barrel', x: 59, y: 35, variant: 'barrel_c' });
    block({ kind: 'wood_pile', x: 56, y: 30 });
    placeLamp('torch', 59, 30);
  } else {
    // THE QUARTER RECLAIMED: banners on the road where the carts stood.
    for (const [x, y] of [[62, gateTiles[0]?.y ?? 30], [62, gateTiles[gateTiles.length - 1]?.y ?? 34]] as const) {
      const at = offRoad(x, y);
      if (at) block({ kind: 'banner', x: at.x, y: at.y });
    }
    placeLamp('torch', 59, 30);
    placeLamp('torch', 59, 35);
  }
  // THE GILDED STAG: the inn on its lane south-west of the square. The
  // footprint's rim is wall; the hall inside is floor, the door is the
  // south face's middle column; the keeper's counter, the corner room's
  // bed, chest and bench stand inside.
  // THE GILDED STAG INSIDE (it.92): the building is solid; its hall is its own
  // floor (`scenes/Inn.ts`), entered at the door tile in the south face.
  const tavern = { x: 74, y: 46, w: 6, h: 5 };
  const door = { x: tavern.x + 2, y: tavern.y + tavern.h - 1 };
  clearFor(tavern.x, tavern.y, tavern.w, tavern.h, 1);
  block({ kind: 'tavern2', x: tavern.x, y: tavern.y, w: tavern.w, h: tavern.h });
  grid[idx(door.x, door.y)] = TILE_FLOOR;
  tileKind[idx(door.x, door.y)] = KIND_COBBLE;
  grid[idx(door.x, door.y + 1)] = TILE_FLOOR;
  tileKind[idx(door.x, door.y + 1)] = KIND_DIRT;
  const keeperInn = { x: tavern.x + 1, y: tavern.y + 1 };
  const bed = { x: tavern.x + 4, y: tavern.y + 1 };
  const roomStash = { x: tavern.x + 4, y: tavern.y + 3 };
  const roomForge = { x: tavern.x + 1, y: tavern.y + 3 };
  block({ kind: 'barrels_stacked', x: tavern.x + tavern.w, y: tavern.y + 3 });
  block({ kind: 'cart', x: tavern.x - 2, y: tavern.y + 4, w: 2, h: 1 });
  placeLamp('lamp', door.x + 2, door.y + 2);
  placeLamp('lamp', door.x - 2, door.y + 2);
  // THE RUINED ROWS: shells of houses along every street, heaps where
  // houses were, wall stubs, columns, the fallen in the streets, embers
  // still breathing in a few cellars.
  const ruin = (x: number, y: number, w: number, h: number, variant: string, ember = false): void => {
    clearFor(x, y, w, h, 1);
    block({ kind: 'ruin', x, y, w, h, variant });
    if (ember) decal({ kind: 'embers', x: x + Math.floor(w / 2), y: y + h - 1 });
  };
  ruin(68, 26, 3, 3, 'ruin_a');
  ruin(70, 35, 3, 3, 'ruin_f', true);
  ruin(76, 28, 3, 3, 'ruin_b');
  ruin(80, 44, 3, 3, 'ruin_g');
  ruin(93, 32, 3, 3, 'ruin_c', true);
  ruin(94, 45, 3, 3, 'ruin_h');
  ruin(82, 18, 3, 3, 'ruin_i');
  ruin(92, 15, 3, 3, 'ruin_d', true);
  ruin(98, 24, 3, 3, 'ruin_j');
  ruin(104, 34, 3, 3, 'ruin_e');
  ruin(100, 45, 3, 3, 'ruin_k', true);
  ruin(79, 58, 3, 3, 'ruin_l');
  ruin(94, 61, 3, 3, 'ruin_f', true);
  ruin(72, 60, 3, 3, 'ruin_i');
  ruin(105, 54, 3, 3, 'ruin_j');
  ruin(80, 10, 3, 3, 'ruin_k');
  ruin(96, 8, 3, 3, 'ruin_g', true);
  // The square's centrepiece: the burnt fountain ring.
  clearFor(86, 39, 3, 3, 0, KIND_COBBLE);
  block({ kind: 'ruin', x: 86, y: 39, w: 3, h: 3, variant: 'ruin_ring' });
  // Houses that stood: the smithy, the old barracks, three cottages, the tall house.
  clearFor(90, 50, 3, 3, 1);
  block({ kind: 'smithy', x: 90, y: 50, w: 3, h: 3 });
  clearFor(70, 18, 4, 4, 1);
  block({ kind: 'barracks', x: 70, y: 18, w: 4, h: 4 });
  house(68, 44, 'house_e');
  house(82, 50, 'house_f');
  house(98, 55, 'house_g');
  clearFor(96, 30, 4, 4, 1);
  block({ kind: 'house', x: 96, y: 30, w: 4, h: 4, variant: 'house_h' });
  grid[idx(97, 32)] = TILE_FLOOR; // The tall house's door column, two deep like a cottage's.
  grid[idx(97, 33)] = TILE_FLOOR;
  tileKind[idx(97, 32)] = KIND_DIRT;
  tileKind[idx(97, 33)] = KIND_DIRT;
  houses.push({ x: 96, y: 30, w: 4, h: 4 });
  // Heaps and stubs where the fire went through.
  for (const [x, y, v] of [[74, 24, 'heap_a'], [90, 28, 'heap_b'], [84, 30, 'heap_c'], [78, 54, 'heap_d'], [100, 38, 'heap_e'], [88, 52, 'heap_a'], [76, 40, 'heap_c'], [104, 44, 'heap_b'], [92, 66, 'heap_d'], [84, 64, 'heap_e']] as const) {
    if (grid[idx(x, y)] === TILE_FLOOR && !road[idx(x, y)]) block({ kind: 'heap', x, y, variant: v });
  }
  for (const [x, y, v] of [[67, 33, 'ruinwall_a'], [67, 34, 'ruinwall_b'], [73, 31, 'ruinwall_c'], [74, 31, 'ruinwall_d'], [90, 36, 'ruinwall_e'], [91, 36, 'ruinwall_f'], [83, 46, 'ruinwall_g'], [97, 42, 'ruinwall_a'], [98, 42, 'ruinwall_b'], [75, 63, 'ruinwall_c'], [102, 18, 'ruinwall_d'], [88, 16, 'ruinwall_e'], [78, 33, 'ruinwall_h'], [95, 52, 'ruinwall_h']] as const) {
    if (grid[idx(x, y)] === TILE_FLOOR && !road[idx(x, y)]) block({ kind: 'ruinwall', x, y, variant: v });
  }
  for (const [x, y, v] of [[84, 36, 'ruincol_a'], [90, 43, 'ruincol_b'], [82, 43, 'ruincol_a'], [92, 37, 'ruincol_b']] as const) {
    if (grid[idx(x, y)] === TILE_FLOOR && !road[idx(x, y)]) block({ kind: 'ruinwall', x, y, variant: v });
  }
  // The fallen: bodies in the streets, each a death frame lying where it fell - buried once the quarter is reclaimed.
  if (eastState !== 'cleared') for (const [x, y, v] of [[66, 32, 'p3'], [70, 33, 'g1'], [78, 37, 'p6'], [85, 42, 'g5'], [89, 38, 'p0'], [87, 30, 'g2'], [88, 50, 'p4'], [97, 40, 'g7'], [73, 56, 'p2'], [93, 20, 'p5'], [100, 41, 'g3'], [86, 58, 'p1'], [104, 40, 'g6'], [72, 40, 'p7'], [83, 25, 'g0']] as const) {
    if (grid[idx(x, y)] === TILE_FLOOR) decal({ kind: 'corpse', x, y, variant: v });
  }
  // Blocked gateways: the north road, the river gate, the south fields.
  const eastGateways: TownLayout['gateways'] = [
    { x: 88, y: 10, label: 'THE NORTH ROAD', note: 'The north road is blocked with wrecked carts. Not open yet.' },
    { x: 110, y: 40, label: 'THE RIVER GATE', note: 'The river gate is chained shut. The bridge beyond it burned.' },
    { x: 88, y: 66, label: 'THE SOUTH FIELDS', note: 'The south fields are empty. The way is not open yet.' },
    { x: 105, y: 13, label: 'THE HILL ROAD', note: 'The hill road climbs out of the quarter. Not open yet.' },
  ];
  clearFor(86, 9, 5, 3, 0, KIND_COBBLE);
  block({ kind: 'pillar', x: 86, y: 10 });
  block({ kind: 'pillar', x: 90, y: 10 });
  block({ kind: 'gateway', x: 88, y: 10 });
  clearFor(108, 38, 3, 5, 0, KIND_COBBLE);
  block({ kind: 'pillar', x: 110, y: 38 });
  block({ kind: 'pillar', x: 110, y: 42 });
  block({ kind: 'gateway', x: 110, y: 40 });
  clearFor(86, 65, 5, 3, 0, KIND_COBBLE);
  block({ kind: 'pillar', x: 86, y: 66 });
  block({ kind: 'pillar', x: 90, y: 66 });
  block({ kind: 'gateway', x: 88, y: 66 });
  // THE HILL ROAD (it.92): the north-east lane was a dead end - a proper gateway now, and a lamp.
  street([[104, 14], [105, 13]], KIND_DIRT, 1.0);
  clearFor(103, 11, 5, 3, 0, KIND_COBBLE);
  block({ kind: 'pillar', x: 103, y: 13 });
  block({ kind: 'pillar', x: 107, y: 13 });
  block({ kind: 'gateway', x: 105, y: 13 });
  placeLamp('lamp', 104, 15);
  // The north-west lane's end: a well and a bench, so it is a place and not a dead end.
  clearFor(71, 13, 3, 3, 0, KIND_DIRT);
  block({ kind: 'well', x: 72, y: 13, variant: 'well_b' });
  tryBlock({ kind: 'bench', x: 70, y: 15, w: 2, h: 1, variant: 'bench_a' }, KIND_DIRT);
  gateways.push(...eastGateways);
  // LOOTABLE CHESTS (it.92): a few small chests in every district, off the roads, in the corners folk forget.
  const chestSpots: Array<{ x: number; y: number }> = [];
  const chestAt = (x: number, y: number): void => {
    if (grid[idx(x, y)] !== TILE_FLOOR || road[idx(x, y)]) return;
    block({ kind: 'chest', x, y });
    chestSpots.push({ x, y });
  };
  chestAt(12, 12); // Behind the north-west cottages.
  chestAt(44, 42); // The portal yard's corner.
  chestAt(17, 22); // Beside the vault.
  chestAt(14, 66); // The training yard's back.
  chestAt(48, 82); // The ward's south-east cottage.
  chestAt(43, 63); // Under the park's tree.
  chestAt(69, 24); // The east quarter: the first ruin's cellar.
  chestAt(95, 35); // The alley.
  chestAt(83, 62); // The south row.
  chestAt(101, 27); // The north-east lane.
  chestAt(75, 66); // The south-west lane's end.
  // Lights that still burn, and the looters' own fires.
  for (const [x, y] of [[68, 30], [74, 36], [80, 40], [93, 40], [88, 34], [88, 46], [82, 55], [96, 26], [100, 52], [86, 20], [90, 60], [104, 42]] as const) placeLamp('torch', x, y);
  for (const [x, y] of [[92, 42], [70, 30]] as const) {
    if (grid[idx(x, y)] === TILE_FLOOR && !road[idx(x, y)]) block({ kind: 'campfire', x, y, variant: 'looters' });
  }
  // Rubble, slabs and debris everywhere the fire went: on the streets too.
  for (let y = 6; y < 72; y++) {
    for (let x = EAST_X + 5; x < W - 1; x++) {
      const i = idx(x, y);
      if (grid[i] !== TILE_FLOOR || belt[i]) continue;
      if (x >= tavern.x - 1 && x < tavern.x + tavern.w + 1 && y >= tavern.y - 1 && y < tavern.y + tavern.h + 2) continue;
      const roll = rand();
      if (roll < 0.035) decal({ kind: 'rubble', x, y, variant: `rubble_${'abcdefg'[Math.floor(rand() * 7)]}` });
      else if (roll < 0.055) decal({ kind: 'debris', x, y, variant: `debris_${'abcd'[Math.floor(rand() * 4)]}` });
      else if (roll < 0.075 && road[i]) decal({ kind: 'slab', x, y, variant: `slab_${'abcdefgh'[Math.floor(rand() * 8)]}` });
    }
  }
  const wander3: Room = { x: 64, y: 8, w: 48, h: 62 }; // The whole quarter (it.92): the folk walk its streets.
  const square = { x: 87, y: 40 };

  // THE OLD QUARTER, DRESSED DEEPER (it.84): benches by the well, a cart on
  // the square, lamps on the high street, a monument at the lower plaza, big
  // trees in the lawns, stores by the stalls — each placed only where it
  // seals nothing (tryBlock).
  tryBlock({ kind: 'bench', x: 27, y: 23, w: 2, h: 1, variant: 'bench_a' }, KIND_COBBLE);
  tryBlock({ kind: 'bench', x: 32, y: 23, w: 2, h: 1, variant: 'bench_b' }, KIND_COBBLE);
  tryBlock({ kind: 'cart', x: 27, y: 20, w: 2, h: 1 }, KIND_COBBLE);
  tryBlock({ kind: 'statue', x: 33, y: 45, variant: 'statue_b' }, KIND_COBBLE);
  tryBlock({ kind: 'jar', x: 28, y: 19, variant: 'jar_a' }, KIND_COBBLE);
  tryBlock({ kind: 'box', x: 19, y: 15, variant: 'box_a' });
  tryBlock({ kind: 'trashbox', x: 41, y: 13 });
  tryBlock({ kind: 'table', x: 38, y: 24, variant: 'table_a' }, KIND_COBBLE);
  for (const [x, y] of [[26, 30], [34, 30], [45, 29], [12, 24]] as const) placeLamp('lamp', x, y);
  for (const [x, y, v] of [[42, 31, 'bigtree_a'], [18, 20, 'bigtree_c'], [40, 44, 'bigtree_b'], [12, 41, 'bigtree_a']] as const) tryBlock({ kind: 'bigtree', x, y, variant: v });
  tryBlock({ kind: 'banner', x: 34, y: 8 });
  tryBlock({ kind: 'banner', x: 41, y: 8 });

  /** THE GATE'S EAST FLANK (it.91): no tree may stand just past the barricade, where it would draw over the carts. */
  const gateFlank = (x: number, y: number): boolean => x > EAST_GATE_X && x <= EAST_GATE_X + 4 && Math.abs(y - gap.y) <= 3;
  const ROCKS = ['rock_a', 'rock_b', 'rock_c', 'rock_d', 'rock_e', 'rock_f'];
  // ---- FOREST BELT: pines and dead trees on belt tiles, brush between ----
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (!belt[i] || grid[i] !== TILE_FLOOR || road[i]) continue; // Never a tree in a street (it.85).
      grid[i] = TILE_BLOCKED;
      const roll = rand();
      if (roll < 0.72 && !gateFlank(x, y)) {
        // DENSER (it.50): three tiles in four carry a tree, the rest a bush.
        // Dark pines, twisted oaks and dead wood (it.57).
        const v = roll < 0.22 ? 'pine_a' : roll < 0.38 ? 'pine_b' : roll < 0.5 ? 'pine_c' : roll < 0.58 ? 'tree_a' : roll < 0.64 ? 'tree_b' : rand() < 0.5 ? 'dead_a' : 'dead_b';
        props.push({ kind: v.startsWith('dead') ? 'deadtree' : 'pine', x, y, variant: v });
      } else if (gateFlank(x, y) && roll < 0.5) {
        props.push({ kind: 'rock', x, y, variant: ROCKS[Math.floor(rand() * ROCKS.length)] }); // Boulders where a tree would hide the carts (it.92).
      } else {
        decal({ kind: 'grassclump', x, y });
      }
    }
  }
  // ---- THE OUTER RING (it.50): the cliff tiles just beyond the blob carry
  // their own forest — two tiles deep — so no raw cube edge ever shows. The
  // straight west wall stays bare (the gate's clean face).
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (grid[i] !== TILE_WALL) continue;
      if (x <= 4 && y >= 19 && y <= 34) continue; // The gate wall.
      let nearOpen = false;
      for (let oy = -2; oy <= 2 && !nearOpen; oy++)
        for (let ox = -2; ox <= 2 && !nearOpen; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (inside(nx, ny) && grid[idx(nx, ny)] !== TILE_WALL) nearOpen = true;
        }
      if (!nearOpen) continue;
      // NO BARE CUBE (it.92): every cliff tile by the open ground wears a tree - a boulder on the gate's flank - and brush besides.
      const roll = rand();
      if (!gateFlank(x, y)) {
        const v = roll < 0.36 ? 'pine_a' : roll < 0.64 ? 'pine_b' : roll < 0.8 ? 'pine_c' : rand() < 0.5 ? 'dead_a' : 'dead_b';
        props.push({ kind: v.startsWith('dead') ? 'deadtree' : 'pine', x, y, variant: v });
      } else {
        props.push({ kind: 'rock', x, y, variant: ROCKS[Math.floor(rand() * ROCKS.length)] });
      }
      if (rand() < 0.3) props.push({ kind: 'grassclump', x, y });
    }
  }

  // ---- THE ROADS STAY OPEN (it.85): clutter that landed in a street steps to
  // the verge (lights, columns, banners) or goes (stores, benches, carts,
  // trees, rocks). Stalls, cottages and fences define the street's sides and
  // stay; the plaza props stand on plaza paint, not road, and stay too.
  {
    const movable = new Set<TownPropKind>(['torch', 'lamp', 'column', 'banner']);
    const clutter = new Set<TownPropKind>(['barrel', 'barrels_stacked', 'crates', 'crates_wood', 'wood_pile', 'bench', 'cart', 'jar', 'box', 'table', 'trashbox', 'bigtree', 'pine', 'deadtree', 'tree', 'rock', 'statue', 'table_chairs', 'supports']);
    const onRoad = (p: TownProp): boolean => {
      for (let y = p.y; y < p.y + (p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) if (inside(x, y) && road[idx(x, y)]) return true;
      return false;
    };
    const free = (p: TownProp): void => {
      for (let y = p.y; y < p.y + (p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) if (inside(x, y) && grid[idx(x, y)] === TILE_BLOCKED) grid[idx(x, y)] = TILE_FLOOR;
    };
    for (let i = props.length - 1; i >= 0; i--) {
      const p = props[i];
      if (!onRoad(p)) continue;
      if (movable.has(p.kind) && (p.w ?? 1) === 1 && (p.h ?? 1) === 1) {
        free(p);
        const at = offRoad(p.x, p.y);
        if (at) {
          p.x = at.x;
          p.y = at.y;
          grid[idx(at.x, at.y)] = TILE_BLOCKED;
        } else props.splice(i, 1);
      } else if (clutter.has(p.kind) && !((p.kind === 'statue' && (p.w ?? 1) > 1))) {
        free(p);
        props.splice(i, 1);
      }
    }
  }

  // ---- SELF-HEAL #1: any floor the hero cannot reach becomes brush ----
  const spawn = { x: 30, y: 30 };
  grid[idx(spawn.x, spawn.y)] = TILE_FLOOR;
  grid[idx(eastIn.x, eastIn.y)] = TILE_FLOOR;
  const reachable = (): Uint8Array => {
    const seen = new Uint8Array(W * H);
    // THE EASTERN QUARTER (it.91) is sealed behind its barricade: the flood
    // starts on both sides of it, so the ruins are healed like the rest.
    const stack = [idx(spawn.x, spawn.y), idx(eastIn.x, eastIn.y)];
    seen[stack[0]] = 1;
    seen[stack[1]] = 1;
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
    return seen;
  };
  let seen = reachable();
  for (let i = 0; i < grid.length; i++) if (grid[i] === TILE_FLOOR && !seen[i]) grid[i] = TILE_BLOCKED;

  // ---- DENSE FILL (it.44): tree clusters and bush tufts on every open lawn ----
  // A tree may only land on plain grass whose four neighbours are open grass
  // (never beside paint, props, doors or the belt), so no route is ever cut;
  // a final flood fill re-checks and undoes any that still would.
  const openGrass = (x: number, y: number): boolean =>
    inside(x, y) && grid[idx(x, y)] === TILE_FLOOR && tileKind[idx(x, y)] === KIND_GRASS && !belt[idx(x, y)] && !road[idx(x, y)]; // A lawn is never a street (it.85).
  const candidates: number[] = [];
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      if (!openGrass(x, y)) continue;
      if (!openGrass(x + 1, y) || !openGrass(x - 1, y) || !openGrass(x, y + 1) || !openGrass(x, y - 1)) continue;
      candidates.push(idx(x, y));
    }
  }
  let before = seen.reduce((a, b) => a + b, 0); // Re-based after every kept prop (it.55 fix: it was stale, so only one cluster ever survived).
  for (const i of candidates) {
    const x = i % W;
    const y = (i - x) / W;
    const roll = rand();
    if (roll < 0.09 && grid[i] === TILE_FLOOR) {
      // Cluster seed: a tree here and maybe a companion beside it.
      const v = roll < 0.03 ? 'pine_a' : roll < 0.05 ? 'pine_b' : roll < 0.07 ? 'pine_c' : rand() < 0.5 ? 'dead_a' : 'dead_b';
      grid[i] = TILE_BLOCKED;
      props.push({ kind: v.startsWith('dead') ? 'deadtree' : 'pine', x, y, variant: v });
      const afterCount = reachable().reduce((a, b) => a + b, 0);
      if (afterCount < before - 1) {
        // It sealed something off — take it back.
        grid[i] = TILE_FLOOR;
        props.pop();
      } else before = afterCount;
    } else if (roll < 0.115 && grid[i] === TILE_FLOOR) {
      // ROCKS (it.55): a boulder in the lawn, taken back if it seals a route.
      const v = ['rock_a', 'rock_b', 'rock_c', 'rock_d', 'rock_e', 'rock_f'][Math.floor(rand() * 6)];
      grid[i] = TILE_BLOCKED;
      props.push({ kind: 'rock', x, y, variant: v });
      const afterCount = reachable().reduce((a, b) => a + b, 0);
      if (afterCount < before - 1) {
        grid[i] = TILE_FLOOR;
        props.pop();
      } else before = afterCount;
    } else if (roll < 0.26) {
      decal({ kind: 'grassclump', x, y }); // A bush tuft.
    }
  }
  seen = reachable();
  for (let i = 0; i < grid.length; i++) if (grid[i] === TILE_FLOOR && !seen[i]) grid[i] = TILE_BLOCKED;
  // THE STREETS' CLUTTER (it.91): a body or a slab whose tile the healing took (a tree, brush) goes with it.
  for (let i = props.length - 1; i >= 0; i--) {
    const q = props[i];
    if ((q.kind === 'corpse' || q.kind === 'rubble' || q.kind === 'slab' || q.kind === 'debris' || q.kind === 'embers') && grid[idx(q.x, q.y)] !== TILE_FLOOR) props.splice(i, 1);
  }

  // THE LOOTERS' POSTS (it.91): twenty open tiles of the quarter, well past
  // the gate and out of the inn, no two within four strides - rolled from
  // the same seed so every peer counts the same twenty.
  const banditPosts: EastQuarter['banditPosts'] = [];
  {
    const pool: number[] = [];
    for (let y = 6; y < 72; y++)
      for (let x = EAST_X + 8; x < W - 2; x++) {
        const i = idx(x, y);
        if (grid[i] !== TILE_FLOOR || belt[i]) continue;
        if (x >= tavern.x - 1 && x < tavern.x + tavern.w + 1 && y >= tavern.y - 1 && y < tavern.y + tavern.h + 3) continue;
        pool.push(i);
      }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (const i of pool) {
      if (banditPosts.length >= LOOTER_COUNT) break;
      const x = i % W;
      const y = (i - x) / W;
      if (banditPosts.some((b) => Math.hypot(b.x - x, b.y - y) < 4)) continue;
      const n = banditPosts.length;
      banditPosts.push({ x, y, kind: n % 5 < 3 ? 'bandit' : 'brigand' });
    }
  }
  const east: EastQuarter = {
    state: eastState,
    gateTiles,
    gap,
    approach,
    inside: eastIn,
    innkeeper: eastState === 'cleared' ? keeperInn : innAtGate,
    refuge,
    wander3,
    banditPosts,
    tavern,
    door,
    bed,
    roomStash,
    roomForge,
    square,
  };

  // THE STREETS (it.92): the folk range over their whole district and keep to the roads three times in four.
  const wander: Room = { x: 6, y: 6, w: 50, h: 42 };
  const wander2: Room = { x: 12, y: 56, w: 42, h: 32 };
  const map: TownMap = {
    width: W,
    height: H,
    grid,
    rooms: [{ x: 3, y: 3, w: W - 6, h: H - 6 }],
    spawn,
    seed: 0,
    tileKind,
  };
  return {
    map,
    props,
    gate,
    stash: { x: 14, y: 23 },
    merchant: {
      x: 24,
      y: 16,
      tiles: [
        { x: 23, y: 17 },
        { x: 24, y: 17 },
        { x: 25, y: 17 },
        { x: 23, y: 18 },
        { x: 24, y: 18 },
        { x: 25, y: 18 },
      ],
    },
    alchemist: {
      x: 24,
      y: 24,
      tiles: [
        { x: 23, y: 25 },
        { x: 24, y: 25 },
        { x: 25, y: 25 },
        { x: 23, y: 26 },
        { x: 24, y: 26 },
        { x: 25, y: 26 },
      ],
    },
    board: { x: 32, y: 31 },
    arenaGate: { x: 54, y: 23 },
    arenaMaster: { x: 53, y: 26 },
    campfire,
    forge,
    campSpots,
    portal: { x: 43, y: 37 },
    wander,
    houses,
    guards,
    jeweler: { x: 24, y: 65, tiles: [23, 24, 25].flatMap((x) => [{ x, y: 66 }, { x, y: 67 }]) },
    scribe: { x: 37, y: 65, tiles: [36, 37, 38].flatMap((x) => [{ x, y: 66 }, { x, y: 67 }]) },
    bowyer: { x: 24, y: 73, tiles: [23, 24, 25].flatMap((x) => [{ x, y: 74 }, { x, y: 75 }]) },
    notice: { x: 37, y: 62 },
    gateways,
    wander2,
    guards2,
    road,
    gatekeeper,
    training,
    chests: chestSpots,
    districts: [
      { name: 'THE EASTERN QUARTER', x: EAST_X, y: 0, w: W - EAST_X, h: H },
      { name: 'THE OLD QUARTER', x: 0, y: 0, w: EAST_X, h: WARD_Y },
      { name: 'THE MARKET WARD', x: 0, y: WARD_Y, w: EAST_X, h: H - WARD_Y },
    ],
    east,
  };
}

/**
 * COLLISION AUDIT: every walkable tile must be reachable from the spawn
 * (4-connected), and every point of interest must touch reachable ground.
 * Returns the unreachable tiles; the caller warns (dev) — never throws.
 */
export function auditTownLayout(layout: TownLayout): { unreachable: Array<{ x: number; y: number }>; missing: string[] } {
  const { width, height, grid } = layout.map;
  const seen = new Uint8Array(width * height);
  const stack = [layout.map.spawn.y * width + layout.map.spawn.x];
  if (layout.east) stack.push(layout.east.inside.y * width + layout.east.inside.x); // Past the barricade (it.91).
  for (const s of stack) seen[s] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (seen[j] || grid[j] !== TILE_FLOOR) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  const unreachable: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === TILE_FLOOR && !seen[i]) unreachable.push({ x: i % width, y: Math.floor(i / width) });
  const touches = (x: number, y: number): boolean =>
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < width && ny < height && seen[ny * width + nx] === 1;
    });
  const missing: string[] = [];
  if (!touches(layout.gate.x, layout.gate.y)) missing.push('gate');
  if (!touches(layout.stash.x, layout.stash.y)) missing.push('stash');
  if (!layout.merchant.tiles.some((t) => touches(t.x, t.y))) missing.push('merchant');
  if (!layout.alchemist.tiles.some((t) => touches(t.x, t.y))) missing.push('alchemist');
  if (!touches(layout.board.x, layout.board.y)) missing.push('board');
  if (!touches(layout.arenaGate.x, layout.arenaGate.y)) missing.push('arena gate');
  if (!touches(layout.portal.x, layout.portal.y)) missing.push('portal');
  if (!touches(layout.campfire.x, layout.campfire.y)) missing.push('campfire');
  for (const [i, h] of layout.houses.entries()) if (!seen[(h.y + 2) * width + h.x + 1]) missing.push(`house ${i} door`);
  // THE MARKET WARD (it.84).
  if (!layout.jeweler.tiles.some((t) => touches(t.x, t.y))) missing.push('jeweler');
  if (!layout.scribe.tiles.some((t) => touches(t.x, t.y))) missing.push('scribe');
  if (!layout.bowyer.tiles.some((t) => touches(t.x, t.y))) missing.push('bowyer');
  if (!touches(layout.notice.x, layout.notice.y)) missing.push('notice board');
  for (const [i, g] of layout.gateways.entries()) if (!touches(g.x, g.y)) missing.push(`gateway ${i}`);
  if (!seen[(layout.wander2.y + 7) * width + layout.wander2.x + 8]) missing.push('ward plaza');
  return { unreachable, missing };
}
