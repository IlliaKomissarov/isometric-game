/**
 * @module scenes/Riverside
 * THE RIVERSIDE FARM (it.106) — the water meadow past the river gate, and the
 * family the free company's stragglers came for.
 *
 * The eastern quarter has had a river gate on it since it.91, chained shut,
 * with the note "the bridge beyond it burned". This is what is behind it.
 *
 * GEOGRAPHY. The gate is on the quarter's EAST edge, so the hero comes in at the
 * WEST of this map and the land runs away east to the water:
 *
 *   WEST edge      the river gate, the signpost home, and the cart track in.
 *   MIDDLE         Oscar's steading - the farmhouse, the barn, the yard between
 *                  them. This is where the three have his family against a wall.
 *   EAST / SOUTH   THE RIVER, a wide band of it, with a shore of wet mud, reeds
 *                  along the waterline, and two plank jetties out over it.
 *   NORTH-EAST     the burned bridge. It is the one way out of here that is not
 *                  the way in, and Oscar's sealed pass is what opens it.
 *
 * THE SHAPE is a union of four lobes like the farmlands', so the meadow bulges
 * and pinches instead of being a rectangle - but the river is cut through it
 * afterwards as a BAND, not a lobe, because water runs in a line.
 *
 * Two states, and the layout is a pure function of which one it is in:
 *
 *   THREATENED  three bandits stand over Oscar and two of his family in the
 *               yard. Nothing else on the map is hostile - this is one fight,
 *               not a floor of them.
 *   SAFE        the three are down, the family is out on their land, the barn
 *               is open, and no hostile spawns here again. The farm is a haven.
 *
 * THE WATER is not art: the pack has none. It is eight phases of one generated
 * loop (`AssetManager.buildRiverGround`), laid down through the ordinary town
 * ground path and then cycled in place by `RiverWater` below.
 */

import { TILE_BLOCKED, TILE_FLOOR } from '@/scenes/DungeonGenerator';
import { KIND_DIRT, KIND_GRASS, KIND_SHORE, KIND_WATER, type RiverLayout, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { mulberry32 } from '@/utils/rng';
import { bareLayout } from './Forest';

export const RIVER_W = 56;
export const RIVER_H = 44;

/**
 * THE MEADOW'S LOBES. Their union is the land; the river is cut out of it after.
 */
const LOBES: ReadonlyArray<{ cx: number; cy: number; rx: number; ry: number }> = [
  { cx: 13, cy: 20, rx: 12, ry: 11 }, // the gate end, where the hero comes in
  { cx: 27, cy: 17, rx: 14, ry: 13 }, // the steading and its yard
  { cx: 30, cy: 31, rx: 13, ry: 10 }, // the low meadow, down to the water
  { cx: 43, cy: 15, rx: 12, ry: 12 }, // the north-east headland and the bridge
];

/** Where the hero comes through the river gate, and the signpost beside it. */
const ENTRY = { x: 5, y: 20 };
const HOME = { x: 3, y: 20 };
/** The burned bridge out of the north-east: the one way on from here. */
const BRIDGE = { x: 50, y: 9 };
/** Oscar's yard: the ground between the farmhouse and the barn. */
const YARD = { x: 27, y: 20 };

/**
 * THE RIVER'S COURSE. A polyline the water is painted around; the band is
 * `RIVER_HALF` wide either side of it, with a shore ring outside that. It comes
 * down out of the north-east (under the bridge) and runs away to the south-west
 * corner, so it crosses the map diagonally behind the steading.
 */
const COURSE: ReadonlyArray<{ x: number; y: number }> = [
  { x: 53, y: 4 },
  { x: 49, y: 10 },
  { x: 45, y: 17 },
  { x: 41, y: 24 },
  { x: 36, y: 30 },
  { x: 30, y: 36 },
  { x: 22, y: 40 },
  { x: 13, y: 42 },
];
const RIVER_HALF = 3.4;
const SHORE_BAND = 1.5;

/** Distance from a point to the river's course, in tiles. */
function toCourse(x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < COURSE.length; i++) {
    const a = COURSE[i];
    const b = COURSE[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
    if (d < best) best = d;
  }
  return best;
}

export function buildRiversideLayout(seed: number, safe = false): { layout: TownLayout; river: RiverLayout } {
  const W = RIVER_W;
  const H = RIVER_H;
  const rand = mulberry32((seed ^ 0x21ce2) >>> 0);
  const grid = new Uint8Array(W * H).fill(0);
  const tileKind = new Uint8Array(W * H).fill(KIND_GRASS);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // ---- THE LAND ---------------------------------------------------------
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (const l of LOBES) {
        const dx = (x + 0.5 - l.cx) / l.rx;
        const dy = (y + 0.5 - l.cy) / l.ry;
        // A little noise on the rim so the lobes do not read as ellipses.
        const wob = 0.06 * Math.sin(x * 0.7 + y * 0.4) + 0.05 * Math.sin(x * 0.31 - y * 0.53);
        if (dx * dx + dy * dy <= 1 + wob) {
          grid[idx(x, y)] = TILE_FLOOR;
          break;
        }
      }
    }
  }

  // ---- THE RIVER --------------------------------------------------------
  // Cut through the land: water is BLOCKED (you do not walk into a river), the
  // shore either side of it is walkable mud, and both are painted, not propped.
  const water: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = toCourse(x + 0.5, y + 0.5);
      // The banks wander: the river is not a ruler-straight canal.
      const wob = 0.55 * Math.sin(y * 0.42 + 0.8) + 0.35 * Math.sin(x * 0.29 - 1.1);
      if (d <= RIVER_HALF + wob) {
        // Water reaches past the meadow's rim, so the river has its own edges
        // and does not stop dead where a lobe happens to end.
        grid[idx(x, y)] = TILE_BLOCKED;
        tileKind[idx(x, y)] = KIND_WATER;
        water.push({ x, y });
      } else if (d <= RIVER_HALF + wob + SHORE_BAND && grid[idx(x, y)] === TILE_FLOOR) {
        tileKind[idx(x, y)] = KIND_SHORE;
      }
    }
  }

  const isFloor = (x: number, y: number): boolean => inside(x, y) && grid[idx(x, y)] === TILE_FLOOR;
  const isWater = (x: number, y: number): boolean => inside(x, y) && tileKind[idx(x, y)] === KIND_WATER;

  // ---- THE CART TRACK ---------------------------------------------------
  // In at the gate, through the yard, on to the bridge. Dirt, and kept clear.
  const TRACK: ReadonlyArray<{ x: number; y: number }> = [
    { x: 3, y: 20 }, { x: 9, y: 20 }, { x: 16, y: 19 }, { x: 22, y: 20 },
    { x: 27, y: 21 }, { x: 33, y: 18 }, { x: 40, y: 14 }, { x: 46, y: 11 }, { x: 50, y: 9 },
  ];
  const onTrack = new Uint8Array(W * H);
  for (let i = 0; i + 1 < TRACK.length; i++) {
    const a = TRACK[i];
    const b = TRACK[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = 0; s <= len; s += 0.35) {
      const cx = a.x + ((b.x - a.x) * s) / len;
      const cy = a.y + ((b.y - a.y) * s) / len;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const tx = Math.round(cx) + ox;
          const ty = Math.round(cy) + oy;
          if (!inside(tx, ty)) continue;
          // The track bridges nothing: it stops at the water's edge.
          if (tileKind[idx(tx, ty)] === KIND_WATER) continue;
          grid[idx(tx, ty)] = TILE_FLOOR;
          if (tileKind[idx(tx, ty)] !== KIND_SHORE) tileKind[idx(tx, ty)] = KIND_DIRT;
          onTrack[idx(tx, ty)] = 1;
        }
    }
  }

  // ---- PROPS ------------------------------------------------------------
  const props: TownProp[] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    for (let yy = p.y; yy < p.y + (p.h ?? 1); yy++)
      for (let xx = p.x; xx < p.x + (p.w ?? 1); xx++) if (inside(xx, yy)) grid[idx(xx, yy)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };
  /** A standing piece: only on open, off-track ground. */
  const put = (kind: TownProp['kind'], x: number, y: number, variant?: string): void => {
    if (!isFloor(x, y) || onTrack[idx(x, y)]) return;
    block({ kind, x, y, variant });
  };
  /** A building: only where its whole footprint is open ground, door carved back. */
  const steading = (kind: TownProp['kind'], x: number, y: number, w: number, h: number, variant?: string): boolean => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!isFloor(xx, yy) || onTrack[idx(xx, yy)]) return false;
    block({ kind, x, y, w, h, variant });
    const dx = x + Math.floor(w / 2);
    const dy = y + h;
    if (inside(dx, dy) && grid[idx(dx, dy)] !== 0) grid[idx(dx, dy)] = TILE_FLOOR;
    return true;
  };

  // OSCAR'S STEADING: the farmhouse north of the yard, the great barn south of
  // it, so the yard between them is the enclosed ground the ambush happens in.
  steading('house', YARD.x - 2, YARD.y - 6, 3, 3, 'house_b');
  steading('barracks', YARD.x - 1, YARD.y + 3, 3, 3); // the barn
  steading('house', YARD.x + 5, YARD.y - 5, 3, 3, 'house_d'); // the kin's cottage
  put('well', YARD.x + 3, YARD.y - 1);
  put('cart', YARD.x - 4, YARD.y + 1, 'cart_b');
  put('wood_pile', YARD.x + 4, YARD.y + 3);
  put('barrels_stacked', YARD.x - 5, YARD.y - 3);
  put('crates_wood', YARD.x + 6, YARD.y + 1);

  // The yard fence, with the yard's mouth left open onto the track.
  for (let x = YARD.x - 6; x <= YARD.x + 7; x += 2) {
    for (const y of [YARD.y - 8, YARD.y + 7]) if (isFloor(x, y) && !onTrack[idx(x, y)]) decal({ kind: 'fence', x, y });
  }

  // ---- THE WATERLINE ----------------------------------------------------
  // Reeds on every shore tile that actually touches water, thinned so they read
  // as rushes and not as a hedge. Never on the track, never on a jetty.
  const shoreTiles: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isFloor(x, y)) continue;
      let touches = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (isWater(x + dx, y + dy)) touches = true;
      if (!touches) continue;
      shoreTiles.push({ x, y });
      if (onTrack[idx(x, y)]) continue;
      if ((x * 5 + y * 3) % 3 === 0) decal({ kind: 'reeds', x, y, variant: (x + y) % 2 ? 'grassclump' : 'grassclump', ox: (rand() - 0.5) * 0.4, oy: (rand() - 0.5) * 0.4 });
    }
  }

  // ---- THE JETTIES ------------------------------------------------------
  // A plank walk out over the water, and a boat moored at the end of the long
  // one. The planks are laid on WATER tiles and make them walkable again, which
  // is the only place on this map the hero stands over the river.
  const fishing: RiverLayout['fishing'] = [];
  const jetty = (fromX: number, fromY: number, dx: number, dy: number, len: number): void => {
    for (let i = 0; i < len; i++) {
      const x = fromX + dx * i;
      const y = fromY + dy * i;
      if (!inside(x, y) || !isWater(x, y)) break;
      grid[idx(x, y)] = TILE_FLOOR; // the planks carry you
      decal({ kind: 'jetty', x, y });
      onTrack[idx(x, y)] = 1;
      if (i === len - 1) {
        // The mark is the last plank; the water it faces is the next tile ON,
        // which is open river - nothing is ever built out there (see above).
        fishing.push({ x, y, toX: x + dx, toY: y + dy });
      }
    }
  };
  // Found by walking out from the steading toward the water.
  {
    const anchors: Array<{ x: number; y: number; dx: number; dy: number }> = [];
    for (const s of shoreTiles) {
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]] as const) {
        if (isWater(s.x + dx, s.y + dy) && isWater(s.x + dx * 3, s.y + dy * 3)) {
          anchors.push({ x: s.x + dx, y: s.y + dy, dx, dy });
          break;
        }
      }
    }
    // Two of them, well apart, near the steading rather than out at the corners.
    anchors.sort((a, b) => Math.hypot(a.x - YARD.x, a.y - YARD.y) - Math.hypot(b.x - YARD.x, b.y - YARD.y));
    const chosen: typeof anchors = [];
    for (const a of anchors) {
      if (chosen.every((c) => Math.hypot(c.x - a.x, c.y - a.y) > 9)) chosen.push(a);
      if (chosen.length === 2) break;
    }
    for (const [i, c] of chosen.entries()) jetty(c.x, c.y, c.dx, c.dy, i === 0 ? 4 : 3);
    // THE DOCK'S GEAR (it.106). There is NO BOAT: the packs contain no hull, and
    // the nearest thing in them - the cellar's pier - is a block of stone that
    // read as a wall standing on the water and hid whoever was fishing behind
    // it. A working river dock is its gear, so the jetty's root gets a cask and
    // a crate on the BANK, where they cannot occlude anyone out on the planks.
    for (const c of chosen) {
      const rootX = c.x - c.dx;
      const rootY = c.y - c.dy;
      for (const [ox, oy, kind] of [[-1, 0, 'barrel'], [0, -1, 'crates_wood']] as const) {
        const tx = rootX + ox;
        const ty = rootY + oy;
        if (!isFloor(tx, ty) || onTrack[idx(tx, ty)]) continue;
        if (props.some((q) => q.x === tx && q.y === ty)) continue;
        block({ kind, x: tx, y: ty, variant: kind === 'barrel' ? 'barrel_c' : undefined });
      }
    }
  }
  // Plus a couple of fishing marks straight off the shore, so the mechanic is
  // never more than a short walk from wherever the hero happens to be.
  for (const s of shoreTiles) {
    if (onTrack[idx(s.x, s.y)]) continue;
    if (fishing.some((f) => Math.hypot(f.x - s.x, f.y - s.y) < 8)) continue;
    let to: { x: number; y: number } | null = null;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) if (isWater(s.x + dx, s.y + dy)) to = { x: s.x + dx, y: s.y + dy };
    if (!to) continue;
    fishing.push({ x: s.x, y: s.y, toX: to.x, toY: to.y });
    // Gathered generously: half of these sit on the FAR bank and are thrown
    // away by the reachability filter further down, so the pool has to be
    // bigger than the number of marks actually wanted (it.106).
    if (fishing.length >= 14) break;
  }

  // ---- THE TREE LINE ----------------------------------------------------
  // Everything that is neither land nor river is wood, two rings deep, so the
  // map ends in a border rather than in a cliff. The river's own mouths are left
  // open: a river must run OFF the map, or it reads as a pond.
  {
    const depth = new Int16Array(W * H).fill(-1);
    const q: number[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (grid[idx(x, y)] === TILE_FLOOR || tileKind[idx(x, y)] === KIND_WATER) {
        depth[idx(x, y)] = 0;
        q.push(idx(x, y));
      }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % W;
      const y = (i - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny) || depth[idx(nx, ny)] >= 0) continue;
        depth[idx(nx, ny)] = depth[i] + 1;
        q.push(idx(nx, ny));
      }
    }
    const NEAR = ['tree_a', 'tree_b', 'pine_a', 'pine_b'];
    const DEEP = ['bigtree_a', 'pine_c', 'tree_c'];
    const FILL = [0, 1, 0.75, 0.4, 0] as const;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = depth[idx(x, y)];
        if (d <= 0 || d >= FILL.length) continue;
        const keep = FILL[d];
        if (keep <= 0) continue;
        if (keep < 1 && ((x * 13 + y * 7) % 100) / 100 >= keep) continue;
        const set = d <= 1 ? NEAR : DEEP;
        const v = set[(x * 7 + y * 11) % set.length];
        decal({
          kind: v.startsWith('bigtree') ? 'bigtree' : v.startsWith('pine') ? 'pine' : 'tree',
          x, y, variant: v,
          bare: d > 1, // only the ring the meadow touches can hide anything (it.105)
          ox: (((x * 5 + y * 3) % 7) - 3) * 0.06,
          oy: (((x * 3 + y * 11) % 7) - 3) * 0.06,
        });
      }
    }
  }

  // ---- THE WAY IN, AND THE WAY ON ---------------------------------------
  for (const t of [ENTRY, HOME]) if (inside(t.x, t.y)) grid[idx(t.x, t.y)] = TILE_FLOOR;
  decal({ kind: 'riverroad', x: HOME.x, y: HOME.y });
  // The burned bridge: an arch on the far bank, and the carts still across it.
  if (inside(BRIDGE.x, BRIDGE.y)) {
    grid[idx(BRIDGE.x, BRIDGE.y)] = TILE_FLOOR;
    decal({ kind: 'bridgegate', x: BRIDGE.x, y: BRIDGE.y, variant: 'THE RIVER BRIDGE' });
  }

  // ---- THE PEOPLE -------------------------------------------------------
  // Oscar with his back to the barn, his two behind him, and the three of them
  // in a half ring in front. Every spot is nudged onto real ground.
  const nearestFloor = (x: number, y: number): { x: number; y: number } => {
    for (let r = 0; r < 6; r++)
      for (let oy = -r; oy <= r; oy++)
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          if (isFloor(x + ox, y + oy)) return { x: x + ox, y: y + oy };
        }
    return { x, y };
  };
  const oscar = nearestFloor(YARD.x, YARD.y + 1);
  const kin = [nearestFloor(YARD.x - 1, YARD.y + 2), nearestFloor(YARD.x + 1, YARD.y + 2)];
  const bandits = [
    nearestFloor(YARD.x - 2, YARD.y - 2),
    nearestFloor(YARD.x, YARD.y - 3),
    nearestFloor(YARD.x + 2, YARD.y - 2),
  ];
  if (safe) {
    // The farm is theirs again: Oscar out by the water, his kin on the land.
    decal({ kind: 'oscar', x: oscar.x, y: oscar.y });
    for (const k of kin) decal({ kind: 'oscarkin', x: k.x, y: k.y });
  } else {
    decal({ kind: 'oscar', x: oscar.x, y: oscar.y });
    for (const k of kin) decal({ kind: 'oscarkin', x: k.x, y: k.y });
  }

  // ---- CHESTS -----------------------------------------------------------
  // Off the track, out of the yard, in the corners of a working farm.
  const chestSpots: Array<{ x: number; y: number }> = [];
  for (const [x, y] of [[10, 13], [17, 27], [36, 9], [44, 22], [24, 33], [47, 16], [8, 26], [33, 27]] as const) {
    const c = nearestFloor(x, y);
    if (!isFloor(c.x, c.y) || onTrack[idx(c.x, c.y)]) continue;
    if (chestSpots.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 5)) continue;
    if (Math.hypot(c.x - YARD.x, c.y - YARD.y) < 5) continue;
    chestSpots.push(c);
  }

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

  /**
   * THE MARKS ARE ONLY REAL WHERE THE HERO CAN STAND (it.106). The shore is
   * found by walking out from the water, and the water has TWO banks - so half
   * the candidates were on the FAR one, which the pass above then blocked off
   * as unreachable. A fishing mark on ground nobody can reach is a mark that
   * never fires, and three of six were exactly that. Filtered here, after
   * connectivity has had its say, and only the survivors are drawn.
   */
  for (let i = fishing.length - 1; i >= 0; i--) {
    const f = fishing[i];
    if (grid[idx(f.x, f.y)] !== TILE_FLOOR || !isWater(f.toX, f.toY)) fishing.splice(i, 1);
  }
  fishing.length = Math.min(fishing.length, 6); // enough that one is always near
  for (const f of fishing) decal({ kind: 'fishspot', x: f.x, y: f.y });

  const map: TownMap = {
    width: W,
    height: H,
    grid,
    // One room, the meadow itself: this floor is never stocked from the pool.
    // Its only hostiles are the three the quest places by hand.
    rooms: [{ x: 8, y: 14, w: 14, h: 12 }],
    spawn: { ...ENTRY },
    seed,
    tileKind,
    wallsFromProps: true, // the tree line IS the border (it.101)
  };
  const layout = bareLayout(map, props, 'THE RIVERSIDE FARM');
  layout.wander = { x: YARD.x - 6, y: YARD.y - 4, w: 14, h: 10 };
  layout.houses = [];
  layout.chests = [];
  for (const c of chestSpots) {
    if (!isFloor(c.x, c.y)) continue;
    grid[idx(c.x, c.y)] = TILE_BLOCKED;
    layout.chests.push(c);
  }

  const river: RiverLayout = {
    entry: { ...ENTRY },
    home: { ...HOME },
    oscar,
    kin,
    bandits,
    fishing,
    water: water.filter((w) => tileKind[idx(w.x, w.y)] === KIND_WATER && grid[idx(w.x, w.y)] !== TILE_FLOOR),
    bridge: { ...BRIDGE },
    safe,
  };
  layout.river = river;
  return { layout, river };
}
