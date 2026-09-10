/**
 * @module scenes/Riverside
 * THE RIVERSIDE FARM (it.106, doubled and bridged it.110) — the water meadow
 * past the river gate, and the family the free company's stragglers came for.
 *
 * The eastern quarter has had a river gate on it since it.91. This is what is
 * behind it, and since it.110 it is also the road on: the burned span that
 * closed this map off is gone, and a real span stands up-river with the city's
 * own knights on it, which Oscar's sealed pass is the way through.
 *
 * GEOGRAPHY. The gate is on the quarter's EAST edge, so the hero comes in at the
 * WEST of this map and the land runs away east along the water:
 *
 *   WEST end         the river gate, the signpost home, and the cart track in.
 *   MIDDLE           Oscar's steading - the farmhouse, the barn, the yard
 *                    between them. This is where the three have his family
 *                    against a wall.
 *   SOUTH            THE RIVER, a wide band of it running the length of the map,
 *                    with a shore of wet mud, reeds along the waterline, and
 *                    plank jetties out over it.
 *   EAST / UP-RIVER  the long headland the farm's upper acres lie on, and at the
 *                    end of it THE RIVER BRIDGE: a pristine stone-and-timber
 *                    span under a gate arch, kept by two knights of the watch.
 *
 * THE SHAPE is a union of eight lobes, so the meadow bulges and pinches instead
 * of being a rectangle - but the river is cut through it afterwards as a BAND,
 * not a lobe, because water runs in a line.
 *
 * THE FAR BANK IS DARK (it.110b). it.110 gave the river a far shore along its
 * whole length and planted a wood on it - and because a tile further from the
 * camera along the diagonal is drawn HIGHER but a tile nearer is drawn OVER, a
 * belt of timber on the far side stood between the player and the water and hid
 * the river the map is named for. There is now no far shore anywhere except the
 * one place the road needs one: a small landing at the crossing, with the gate
 * arch on it. Everywhere else the water simply runs out into the dark, which is
 * both what a river at night looks like and the only way to actually SEE it.
 *
 * IT.110 DOUBLED IT. The old meadow was 56x44 and 1,116 walkable tiles, all of
 * it west of the bridge; it is 84x60 and about 2,200 now, and every one of the
 * new ones is on the bank up-river of the steading, between Oscar's yard and the
 * span. The farm reads as a holding with acres rather than as a yard with a gate
 * at each end, and the walk to the crossing is a walk.
 *
 * Two states, and the layout is a pure function of which one it is in:
 *
 *   THREATENED  three bandits stand over Oscar and two of his family in the
 *               yard. Nothing else on the map is hostile - this is one fight,
 *               not a floor of them.
 *   SAFE        the three are down, the family is out on their land, the barn
 *               is open, and no hostile spawns here again. The farm is a haven.
 *
 * THE WATER is not art: the pack has none. It is baked phases of one generated
 * loop, laid down through the ordinary town ground path and then cycled in place
 * by `RiverWater`.
 */

import { TILE_BLOCKED, TILE_FLOOR } from '@/scenes/DungeonGenerator';
import { KIND_DIRT, KIND_GRASS, KIND_SAND, KIND_WATER, type RiverLayout, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { mulberry32 } from '@/utils/rng';
import { bareLayout } from './Forest';

export const RIVER_W = 84;
export const RIVER_H = 60;

/**
 * THE MEADOW'S LOBES. Their union is the land; the river is cut out of it after.
 * The first four are the it.106 farm (moved down the map to make room above the
 * water); the last four are the acres it.110 added up-river of it.
 */
const LOBES: ReadonlyArray<{ cx: number; cy: number; rx: number; ry: number }> = [
  { cx: 12, cy: 32, rx: 11, ry: 11 }, // the gate end, where the hero comes in
  { cx: 26, cy: 28, rx: 14, ry: 13 }, // the steading and its yard
  { cx: 22, cy: 45, rx: 14, ry: 11 }, // the low meadow, down to the water
  { cx: 41, cy: 33, rx: 13, ry: 12 }, // the middle acre
  { cx: 37, cy: 15, rx: 14, ry: 12 }, // the north field, behind the steading
  { cx: 48, cy: 24, rx: 11, ry: 10 }, // the long pasture
  { cx: 55, cy: 12, rx: 15, ry: 11 }, // the upper acres
  { cx: 70, cy: 8, rx: 12, ry: 9 }, // the bridge headland
];

/**
 * THE LANDING. The only piece of far shore on the map: a small shelf the bridge
 * comes down on, placed AFTER the crossing is found rather than written down, so
 * it is always exactly where the span needs it and nowhere else. Nothing walks
 * on it - the connectivity pass seals every tile the hero cannot reach.
 */
const LANDING_RX = 6;
const LANDING_RY = 5;

/** Where the hero comes through the river gate, and the signpost beside it. */
const ENTRY = { x: 4, y: 31 };
const HOME = { x: 2, y: 31 };
/** Oscar's yard: the ground between the farmhouse and the barn. */
const YARD = { x: 26, y: 29 };

/**
 * THE BUILDINGS, AND THEIR REAL SIZE (it.107).
 *
 * Every one of these is drawn at its own pixel size and anchored at the SOUTH
 * corner of its footprint - the footprint is not a scale, it is where the thing
 * stands. So a footprint has to be derived from the art: `w + h` is the
 * footprint's screen width in half-tiles, so `w + h ~= px / 32` is the rule
 * these are measured against, and `px` is the sprite's own painted width.
 */
interface Steading {
  kind: TownProp['kind'];
  variant?: string;
  w: number;
  h: number;
  /** Painted width in pixels - what the no-clipping test is done against. */
  px: number;
  ph: number;
}
const STEADINGS: Record<string, Steading> = {
  // The blue-slate cottages: the well-kept houses of a working farm.
  cottage_a: { kind: 'house', variant: 'house_a', w: 4, h: 5, px: 276, ph: 253 },
  cottage_b: { kind: 'house', variant: 'house_b', w: 4, h: 4, px: 261, ph: 238 },
  cottage_c: { kind: 'house', variant: 'house_c', w: 4, h: 5, px: 276, ph: 232 },
  cottage_d: { kind: 'house', variant: 'house_d', w: 4, h: 4, px: 261, ph: 254 },
  // The timber-framed ones: older, lower, greener - the outbuildings.
  timber_e: { kind: 'house', variant: 'house_e', w: 3, h: 4, px: 231, ph: 183 },
  timber_f: { kind: 'house', variant: 'house_f', w: 3, h: 4, px: 228, ph: 182 },
  timber_g: { kind: 'house', variant: 'house_g', w: 4, h: 3, px: 231, ph: 178 },
  // The long shingled barn, and the walled yard behind it.
  longbarn: { kind: 'house', variant: 'house_h', w: 5, h: 5, px: 340, ph: 253 },
  greatbarn: { kind: 'barracks', w: 6, h: 5, px: 362, ph: 288 },
  workshop: { kind: 'smithy', w: 5, h: 6, px: 350, ph: 297 },
  tower: { kind: 'watchtower', w: 2, h: 2, px: 141, ph: 208 },
};

/**
 * THE RIVER'S COURSE. A polyline the water is painted around; the band is
 * `RIVER_HALF` wide either side of it, with a shore ring outside that. It comes
 * down out of the east (from above the bridge) and runs away to the south-west
 * corner, so it crosses the whole map behind the steading.
 */
const COURSE: ReadonlyArray<{ x: number; y: number }> = [
  { x: 90, y: 2 },
  { x: 78, y: 12 },
  { x: 66, y: 22 },
  { x: 56, y: 31 },
  { x: 46, y: 39 },
  { x: 36, y: 46 },
  { x: 24, y: 54 },
  { x: 12, y: 61 },
];
const RIVER_HALF = 3.0;
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
  /** 1 where a tile belongs to the far bank: land the hero may look at, never reach. */
  const farSide = new Uint8Array(W * H);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // ---- THE LAND ---------------------------------------------------------
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // A little noise on the rim so the lobes do not read as ellipses.
      const wob = 0.06 * Math.sin(x * 0.7 + y * 0.4) + 0.05 * Math.sin(x * 0.31 - y * 0.53);
      for (const l of LOBES) {
        const dx = (x + 0.5 - l.cx) / l.rx;
        const dy = (y + 0.5 - l.cy) / l.ry;
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
      const wob = 0.5 * Math.sin(y * 0.42 + 0.8) + 0.3 * Math.sin(x * 0.29 - 1.1);
      if (d <= RIVER_HALF + wob) {
        // Water reaches past the meadow's rim, so the river has its own edges
        // and does not stop dead where a lobe happens to end.
        grid[idx(x, y)] = TILE_BLOCKED;
        tileKind[idx(x, y)] = KIND_WATER;
        farSide[idx(x, y)] = 0;
        water.push({ x, y });
      } else if (d <= RIVER_HALF + wob + SHORE_BAND && grid[idx(x, y)] === TILE_FLOOR) {
        // The bank is the town's own sand (it.107), not a kind of its own.
        tileKind[idx(x, y)] = KIND_SAND;
      }
    }
  }

  const isFloor = (x: number, y: number): boolean => inside(x, y) && grid[idx(x, y)] === TILE_FLOOR;
  const isNear = (x: number, y: number): boolean => isFloor(x, y) && !farSide[idx(x, y)];
  const isWater = (x: number, y: number): boolean => inside(x, y) && tileKind[idx(x, y)] === KIND_WATER;

  /**
   * WHICH BANK A TILE BELONGS TO (it.110b). The signed side of the river's own
   * polyline: positive on the hero's bank, negative across the water. Everything
   * that decides whether to DRAW something - the tree belt above all - asks this
   * first, because anything drawn across the water is drawn in front of it.
   */
  const sideOf = (x: number, y: number): number => {
    let best = Infinity;
    let sign = 1;
    for (let i = 0; i + 1 < COURSE.length; i++) {
      const a = COURSE[i];
      const b = COURSE[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
      if (d >= best) continue;
      best = d;
      sign = Math.sign(dx * (y - a.y) - dy * (x - a.x)) || 1;
    }
    return sign;
  };
  /** The sign the hero's own bank has, taken from the tile they arrive on. */
  const NEAR_SIDE = sideOf(ENTRY.x + 0.5, ENTRY.y + 0.5);
  const acrossWater = (x: number, y: number): boolean => sideOf(x + 0.5, y + 0.5) !== NEAR_SIDE;

  /**
   * THERE IS NO OTHER BANK (it.111).
   *
   * it.110b stopped PLANTING on the far side, which took the tree belt off the
   * water - but the meadow's lobes still reached across the course, so a shelf
   * of lit grass and beach lay along the whole far edge of the river with black
   * behind it. That is the "opposite bank" the brief says must not be visible
   * anywhere except at the crossing, and it is also the thing that made the
   * river read as a trench cut in a lawn.
   *
   * Two passes, in this order:
   *
   *   1. THE WATER RUNS FURTHER OVER THERE. The far half of the band is widened
   *      by `FAR_EXTRA`, so there is room for the river to go dark gradually
   *      rather than ending at a drawn edge.
   *   2. EVERYTHING ELSE ACROSS THE COURSE IS UNMADE - back to `TILE_WALL`,
   *      which the scene never draws at all. The landing at the crossing is cut
   *      AFTER this, so the one piece of far shore in the map is the one the
   *      road comes down on.
   */
  const FAR_EXTRA = 4.0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!acrossWater(x, y)) continue;
      const d = toCourse(x + 0.5, y + 0.5);
      const wob = 0.5 * Math.sin(y * 0.42 + 0.8) + 0.3 * Math.sin(x * 0.29 - 1.1);
      if (d <= RIVER_HALF + wob + FAR_EXTRA) {
        if (tileKind[idx(x, y)] !== KIND_WATER) {
          tileKind[idx(x, y)] = KIND_WATER;
          water.push({ x, y });
        }
        grid[idx(x, y)] = TILE_BLOCKED;
      } else {
        grid[idx(x, y)] = 0;
        tileKind[idx(x, y)] = KIND_GRASS;
      }
    }
  }

  /**
   * THE CROSSING (it.110). Found, not written down: the meadow's rim wanders
   * with the lobes' noise and the river's banks wander with theirs, so a
   * hand-picked pair of tiles is as likely to sit in the water as on the shore.
   * Every row is walked from the top of the map down, and the FIRST one that has
   * near bank, then nothing but open water, then far bank, is the crossing - the
   * first such row is the one furthest up-river, which is where a bridge on a
   * road out of a valley belongs.
   */
  const findCrossing = (): { y: number; near: number; far: number } | null => {
    for (let y = 4; y < H - 4; y++) {
      let near = -1;
      for (let x = 0; x < W; x++) if (isNear(x, y)) near = x;
      if (near < 0) continue;
      // IT.110B: the far side no longer has to BE anything. Walk out over the
      // water from the near shore; wherever the water ends is where the far
      // abutment goes, and the landing is built there afterwards.
      let x = near + 1;
      while (x < W && isWater(x, y)) x++;
      const gap = x - near - 1;
      if (gap < 6 || gap > 16) continue;
      if (x >= W - 2) continue; // a span with no room to land on
      return { y, near, far: x };
    }
    return null;
  };
  const crossing = findCrossing();
  const BRIDGE = crossing ? { x: crossing.near, y: crossing.y } : { x: 66, y: 16 };

  /**
   * THE LANDING is cut now, before anything is placed: a small shelf of ground
   * on the far abutment, marked `farSide` so no steading, no reed and no cart
   * track can ever wander onto it, and sealed by the connectivity pass at the
   * end because nothing on this map can reach it on foot.
   */
  if (crossing) {
    const cx = crossing.far + LANDING_RX - 2;
    const cy = crossing.y;
    for (let y = cy - LANDING_RY - 1; y <= cy + LANDING_RY + 1; y++) {
      for (let x = crossing.far - 1; x <= cx + LANDING_RX; x++) {
        if (!inside(x, y) || isWater(x, y)) continue;
        const dx = (x + 0.5 - cx) / LANDING_RX;
        const dy = (y + 0.5 - cy) / LANDING_RY;
        const wob = 0.08 * Math.sin(x * 0.6 + y * 0.5);
        if (dx * dx + dy * dy > 1 + wob) continue;
        grid[idx(x, y)] = TILE_FLOOR;
        farSide[idx(x, y)] = 1;
        tileKind[idx(x, y)] = Math.abs(y - cy) <= 1 ? KIND_DIRT : KIND_GRASS;
      }
    }
  }

  // ---- THE CART TRACK ---------------------------------------------------
  // In at the gate, through the yard, on up the bank to the bridge. Dirt, and
  // kept clear: nothing is ever built on it.
  const TRACK: ReadonlyArray<{ x: number; y: number }> = [
    { x: 2, y: 31 }, { x: 9, y: 31 }, { x: 16, y: 30 }, { x: 22, y: 30 },
    { x: 26, y: 30 }, { x: 33, y: 27 }, { x: 40, y: 23 }, { x: 47, y: 19 },
    { x: 54, y: 16 }, { x: 60, y: 15 }, { x: BRIDGE.x - 2, y: BRIDGE.y }, { x: BRIDGE.x, y: BRIDGE.y },
  ];
  const onTrack = new Uint8Array(W * H);
  for (let i = 0; i + 1 < TRACK.length; i++) {
    const a = TRACK[i];
    const b = TRACK[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
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
          if (farSide[idx(tx, ty)]) continue;
          grid[idx(tx, ty)] = TILE_FLOOR;
          if (tileKind[idx(tx, ty)] !== KIND_SAND) tileKind[idx(tx, ty)] = KIND_DIRT;
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
  /** A standing piece: only on open, off-track ground on the hero's own bank. */
  const put = (kind: TownProp['kind'], x: number, y: number, variant?: string): void => {
    if (!isNear(x, y) || onTrack[idx(x, y)]) return;
    block({ kind, x, y, variant });
  };
  /**
   * ZERO CLIPPING, BY CONSTRUCTION (it.107).
   *
   * Every placed building's SCREEN BOX is kept, and a new one is refused if its
   * box overlaps any of them. The box is computed exactly the way `TownProps`
   * will draw the sprite - anchored (0.5, 0.96) on the south corner of the
   * footprint - so this is not an approximation of the render, it is the render.
   */
  const placed: Array<{ l: number; r: number; t: number; b: number }> = [];
  /** Footprints of every building put up, for the tree line to keep clear of. */
  const roofs: Array<{ x: number; y: number; w: number; h: number }> = [];
  /** True when a tile is close enough to a standing roof that a tree would bury it. */
  const nearBuilding = (x: number, y: number): boolean =>
    roofs.some((r) => x >= r.x - 2 && x < r.x + r.w + 2 && y >= r.y - 2 && y < r.y + r.h + 3);
  const screenBox = (st: Steading, x: number, y: number): { l: number; r: number; t: number; b: number } => {
    // worldToScreen of the footprint's south corner, in the same units iso.ts uses.
    const sx = (x + st.w - (y + st.h)) * 32;
    const sy = (x + st.w + (y + st.h)) * 16;
    return { l: sx - st.px / 2, r: sx + st.px / 2, t: sy - st.ph * 0.96, b: sy + st.ph * 0.04 };
  };
  /** A building: open ground, off the track, and clear of every other roof. */
  const steading = (key: string, x: number, y: number): boolean => {
    const st = STEADINGS[key];
    if (!st) return false;
    // NOTHING CROWDS THE CROSSING (it.110). The bridge is the one thing on this
    // map the eye has to find from a distance, and a gable four tiles from the
    // arch hides both it and the men standing under it.
    if (Math.abs(x + st.w / 2 - BRIDGE.x) < 8 && Math.abs(y + st.h / 2 - BRIDGE.y) < 7) return false;
    for (let yy = y - 1; yy <= y + st.h; yy++)
      for (let xx = x - 1; xx <= x + st.w; xx++) if (!isNear(xx, yy) || onTrack[idx(xx, yy)]) return false;
    const box = screenBox(st, x, y);
    // A small gap either side, so two roofs never even touch.
    const PAD = 10;
    for (const q of placed) {
      if (box.l < q.r + PAD && box.r > q.l - PAD && box.t < q.b + PAD && box.b > q.t - PAD) return false;
    }
    placed.push(box);
    roofs.push({ x, y, w: st.w, h: st.h });
    block({ kind: st.kind, x, y, w: st.w, h: st.h, variant: st.variant });
    // The door column: the tile in front of the south face stays walkable.
    const dx = x + Math.floor(st.w / 2);
    const dy = y + st.h;
    if (inside(dx, dy) && grid[idx(dx, dy)] !== 0) grid[idx(dx, dy)] = TILE_FLOOR;
    return true;
  };

  /**
   * Placed by SEARCH, not by coordinate (it.107). The meadow is eight
   * overlapping lobes with a river cut through it, so a hand-picked tile is as
   * likely to be water, wood or cart track as it is to be a yard. Each one
   * spirals out from where it WANTS to be until it finds ground that fits and is
   * clear of every roof already up, and only gives up if there is nowhere within
   * reach.
   */
  const steadingNear = (key: string, ax: number, ay: number, reach = 9): boolean => {
    if (steading(key, ax, ay)) return true;
    for (let r = 1; r <= reach; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          if (steading(key, ax + ox, ay + oy)) return true;
        }
      }
    }
    return false;
  };

  // The yard keeps its shape: the house north of it, the great barn south.
  steadingNear('cottage_a', YARD.x - 3, YARD.y - 8, 5);
  steadingNear('greatbarn', YARD.x - 3, YARD.y + 4, 5);
  steadingNear('timber_e', YARD.x + 6, YARD.y - 6, 5);
  // The rest of the home acres.
  steadingNear('cottage_c', 12, 22);
  steadingNear('timber_f', 13, 36);
  steadingNear('cottage_d', 8, 31);
  steadingNear('timber_g', 20, 43);
  steadingNear('longbarn', 38, 34);
  // THE UPPER ACRES (it.110): buildings on the land the map grew, so the walk to
  // the bridge passes a workshop, a byre and a watchtower rather than grass.
  steadingNear('workshop', 34, 12);
  steadingNear('cottage_b', 47, 21);
  steadingNear('timber_g', 52, 9);
  steadingNear('longbarn', 60, 12);
  steadingNear('cottage_a', 66, 6);
  steadingNear('tower', BRIDGE.x - 6, BRIDGE.y - 5, 6);

  put('well', YARD.x + 3, YARD.y - 1);
  put('cart', YARD.x - 5, YARD.y + 1, 'cart_b');
  put('wood_pile', YARD.x + 4, YARD.y + 2);
  put('barrels_stacked', YARD.x - 6, YARD.y - 3);
  put('crates_wood', YARD.x + 6, YARD.y + 1);
  // A little gear round the outbuildings, so none of them stands on bare grass.
  for (const [x, y, kind, variant] of [
    [17, 20, 'barrel', 'barrel_b'], [13, 27, 'wood_pile', undefined],
    [19, 40, 'cart', 'cart_b'], [43, 30, 'crates_wood', undefined],
    [30, 10, 'barrel', 'barrel_c'], [24, 44, 'wood_pile', undefined],
    [39, 20, 'barrels_stacked', undefined], [10, 34, 'crates_wood', undefined],
    [50, 15, 'wood_pile', undefined], [57, 8, 'barrel', 'barrel_b'],
    [63, 16, 'crates_wood', undefined], [69, 10, 'barrels_stacked', undefined],
    [45, 12, 'cart', undefined], [55, 20, 'barrel', 'barrel_c'],
  ] as const) put(kind as TownProp['kind'], x, y, variant);

  // The yard fence, with the yard's mouth left open onto the track.
  for (let x = YARD.x - 6; x <= YARD.x + 7; x += 2) {
    for (const y of [YARD.y - 8, YARD.y + 7]) if (isNear(x, y) && !onTrack[idx(x, y)]) decal({ kind: 'fence', x, y });
  }
  // And a field fence along the upper acres, so the new land is worked land.
  for (let x = 44; x <= 66; x += 2) {
    for (const y of [6, 20]) if (isNear(x, y) && !onTrack[idx(x, y)]) decal({ kind: 'fence', x, y });
  }

  // ---- THE WATERLINE ----------------------------------------------------
  // Reeds on every shore tile that actually touches water, thinned so they read
  // as rushes and not as a hedge. Never on the track, never on a jetty.
  const shoreTiles: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isNear(x, y)) continue;
      let touches = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (isWater(x + dx, y + dy)) touches = true;
      if (!touches) continue;
      shoreTiles.push({ x, y });
      if (onTrack[idx(x, y)]) continue;
      if ((x * 5 + y * 3) % 3 === 0) decal({ kind: 'reeds', x, y, variant: 'grassclump', ox: (rand() - 0.5) * 0.4, oy: (rand() - 0.5) * 0.4 });
    }
  }

  // ---- THE JETTIES ------------------------------------------------------
  // A plank walk out over the water. The planks are laid on WATER tiles and make
  // them walkable again, which is the only place on this map the hero stands
  // over the river - the bridge itself is a road, not a deck to loiter on.
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
        // which is open river - nothing is ever built out there.
        fishing.push({ x, y, toX: x + dx, toY: y + dy });
      }
    }
  };
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
    // Three of them now the bank is twice as long, well apart, near the places
    // people actually live rather than out at the corners.
    anchors.sort((a, b) => Math.hypot(a.x - YARD.x, a.y - YARD.y) - Math.hypot(b.x - YARD.x, b.y - YARD.y));
    const chosen: typeof anchors = [];
    for (const a of anchors) {
      if (chosen.every((c) => Math.hypot(c.x - a.x, c.y - a.y) > 11)) chosen.push(a);
      if (chosen.length === 3) break;
    }
    for (const [i, c] of chosen.entries()) jetty(c.x, c.y, c.dx, c.dy, i === 0 ? 4 : 3);
    // THE DOCK'S GEAR (it.106). There is NO BOAT: the packs contain no hull, and
    // the nearest thing in them read as a wall standing on the water. A working
    // river dock is its gear, so the jetty's root gets a cask and a crate on the
    // BANK, where they cannot occlude anyone out on the planks.
    for (const c of chosen) {
      const rootX = c.x - c.dx;
      const rootY = c.y - c.dy;
      for (const [ox, oy, kind] of [[-1, 0, 'barrel'], [0, -1, 'crates_wood']] as const) {
        const tx = rootX + ox;
        const ty = rootY + oy;
        if (!isNear(tx, ty) || onTrack[idx(tx, ty)]) continue;
        if (props.some((q) => q.x === tx && q.y === ty)) continue;
        block({ kind, x: tx, y: ty, variant: kind === 'barrel' ? 'barrel_c' : undefined });
      }
    }
  }
  // Plus fishing marks straight off the shore, so the mechanic is never more
  // than a short walk from wherever the hero happens to be.
  for (const s of shoreTiles) {
    if (onTrack[idx(s.x, s.y)]) continue;
    if (Math.hypot(s.x - BRIDGE.x, s.y - BRIDGE.y) < 6) continue; // not under the span
    if (fishing.some((f) => Math.hypot(f.x - s.x, f.y - s.y) < 9)) continue;
    let to: { x: number; y: number } | null = null;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) if (isWater(s.x + dx, s.y + dy)) to = { x: s.x + dx, y: s.y + dy };
    if (!to) continue;
    fishing.push({ x: s.x, y: s.y, toX: to.x, toY: to.y });
    // Gathered generously: some of these sit where the connectivity pass will
    // seal the ground under them, and those are thrown away further down.
    if (fishing.length >= 18) break;
  }

  // ---- THE RIVER BRIDGE -------------------------------------------------
  /**
   * IT.110. The span itself is a run of bays laid ON the water, and the water
   * tiles under them are LEFT BLOCKED on purpose: the hero is stopped at the
   * gate on the near bank and carried across by the transition, so there is no
   * tile sequence anywhere that walks a hero over the river without the watch
   * having looked at their pass first.
   */
  const span: Array<{ x: number; y: number }> = [];
  const knights: Array<{ x: number; y: number }> = [];
  if (crossing) {
    const { y, near, far } = crossing;
    /**
     * THE SPAN, AS PIERS WITH A ROAD ON THEM (it.111).
     *
     * it.110 laid the pack's little plank-deck tile end to end with a timber
     * fence either side, and it read as a fishing jetty with railings - which is
     * what it was. it.110b swapped in the tileset's raised paving and its white
     * balustrade and it still read as a ladder, because a roadway lying flat ON
     * the water is not a bridge whatever it is paved with.
     *
     * `scripts/bake-bridge.py` now composites the whole thing out of the Ancient
     * Isometric Tileset - the roadway, its underside, both parapets, and the
     * arched cube that carries it - against the projection this file uses. The
     * layout's job is only to say WHERE, and in what order:
     *
     *   the shadow the span throws on the water,   (first, on the river itself)
     *   an abutment at each bank and a pier every third bay,
     *   the roadway.                               (last, over what carries it)
     *
     * The dresser draws ground props in the order the layout lists them, so
     * that order is the depth sort.
     */
    for (let x = near + 1; x < far; x++) span.push({ x, y });
    for (const b of span) decal({ kind: 'bridgeshadow', x: b.x, y: b.y + 1 });
    decal({ kind: 'bridgepost', x: near + 1, y, variant: 'block' });
    decal({ kind: 'bridgepost', x: far - 1, y, variant: 'block' });
    // One arch every third bay: piers with open water between them, which is
    // what a bridge looks like, rather than a wall with notches cut in it.
    for (const b of span) {
      if ((b.x - near) % 3 !== 2) continue;
      if (b.x <= near + 1 || b.x >= far - 1) continue;
      decal({ kind: 'bridgepost', x: b.x, y });
    }
    for (const b of span) decal({ kind: 'bridgedeck', x: b.x, y, variant: (b.x - near) % 4 === 2 ? 'worn' : undefined });
    // The gate arch on the near bank, and the road under it.
    grid[idx(near, y)] = TILE_FLOOR;
    tileKind[idx(near, y)] = KIND_DIRT;
    onTrack[idx(near, y)] = 1;
    decal({ kind: 'bridgegate', x: near, y, variant: 'THE RIVER BRIDGE' });
    // The knights: one either side of the road, a step back from the arch so
    // the arch never draws over them, and never on the road tile itself. They
    // are handed to `Villagers` as this floor's SENTRIES (`layout.guards`), which
    // is what already knows how to stand a man in mail on a tile and let him
    // breathe - drawing a second body here would put two knights on one shadow.
    for (const side of [-1, 1]) {
      // BOTH OF THEM STAND (it.110). A fixed offset either side of the road put
      // the second knight in the water on the very first seed tried, because the
      // bank's rim wanders with the lobes' noise. Each one now takes the nearest
      // dry tile on his own side of the road, and only gives up if that side of
      // the crossing has no ground at all.
      let found = false;
      for (let d = 2; d <= 4 && !found; d++) {
        for (const back of [1, 2, 0]) {
          const kx = near - back;
          const ky = y + side * d;
          if (!isNear(kx, ky) || onTrack[idx(kx, ky)]) continue;
          if (knights.some((q) => q.x === kx && q.y === ky)) continue;
          grid[idx(kx, ky)] = TILE_FLOOR;
          knights.push({ x: kx, y: ky });
          found = true;
          break;
        }
      }
    }
    // A brazier at the post, so the crossing is lit at any hour.
    for (const dy of [-3, 3]) {
      const bx = near - 2;
      const by = y + dy;
      if (isNear(bx, by) && !onTrack[idx(bx, by)]) block({ kind: 'brazier', x: bx, y: by });
    }
    // The far end: the twin of the arch on the landing, and a few trunks behind
    // it to close the view. Nothing here is walkable - it is the picture of
    // where the road goes.
    if (inside(far, y)) decal({ kind: 'bridgegate', x: far, y, variant: 'THE FAR BANK' });
  }

  // ---- THE TREE LINE ----------------------------------------------------
  // Everything that is neither land nor river is wood, several rings deep, so
  // the map ends in a border rather than in a cliff. The river's own mouths are
  // left open: a river must run OFF the map, or it reads as a pond.
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
    const NEAR_SET = ['tree_a', 'tree_b', 'pine_a', 'pine_b'];
    const DEEP_SET = ['bigtree_a', 'pine_c', 'tree_c'];
    const FILL = [0, 1, 0.75, 0.4, 0] as const;
    const timber = (x: number, y: number, d: number): void => {
      const set = d <= 1 ? NEAR_SET : DEEP_SET;
      const v = set[(x * 7 + y * 11) % set.length];
      decal({
        kind: v.startsWith('bigtree') ? 'bigtree' : v.startsWith('pine') ? 'pine' : 'tree',
        x, y, variant: v,
        bare: d > 1, // only the ring the meadow touches can hide anything (it.105)
        ox: (((x * 5 + y * 3) % 7) - 3) * 0.06,
        oy: (((x * 3 + y * 11) % 7) - 3) * 0.06,
      });
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = depth[idx(x, y)];
        if (d <= 0 || d >= FILL.length) continue;
        const keep = FILL[d];
        if (keep <= 0) continue;
        if (keep < 1 && ((x * 13 + y * 7) % 100) / 100 >= keep) continue;
        // NO TREE THROUGH A ROOF (it.107). The border belt is grown from every
        // tile that is not land or water, and a meadow of overlapping lobes has
        // those notches INSIDE it too - so the wood was coming up in the farmyard
        // and burying the buildings it grew next to.
        if (nearBuilding(x, y)) continue;
        /**
         * AND NO TREE ACROSS THE WATER (it.110b). A tile on the far bank is
         * nearer the camera down the screen diagonal than the water in front of
         * it, so a belt of timber over there is drawn ON TOP of the river. This
         * one rule is what "trees are completely obscuring everything" was: the
         * far side is left as void, the water runs out into the dark, and the
         * river is visible along its whole length for the first time.
         */
        if (acrossWater(x, y)) continue;
        timber(x, y, d);
      }
    }
    /**
     * THE LANDING'S OWN WOOD (it.110b). The one place a far bank exists, and the
     * only trees ever planted across the water: a screen of trunks around the
     * BACK of the shelf, so the road off the span goes into a wood instead of
     * stopping at the edge of the drawn world. The road itself and the two rows
     * either side of it are left clear, and nothing is planted between the arch
     * and the water - that is the view the whole crossing is built to give.
     */
    if (crossing) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!farSide[idx(x, y)]) continue;
          if (Math.abs(y - crossing.y) <= 2) continue; // the road off the span
          if (x <= crossing.far + 1) continue; // never between the arch and the river
          if ((x * 11 + y * 5) % 3 === 0) continue; // thinned: a wood, not a wall
          timber(x, y, 2);
        }
      }
    }
  }

  // ---- THE WAY IN, AND THE WAY ON ---------------------------------------
  for (const t of [ENTRY, HOME]) if (inside(t.x, t.y)) grid[idx(t.x, t.y)] = TILE_FLOOR;
  decal({ kind: 'riverroad', x: HOME.x, y: HOME.y });

  // ---- THE PEOPLE -------------------------------------------------------
  // Oscar with his back to the barn, his two behind him, and the three of them
  // in a half ring in front. Every spot is nudged onto real ground.
  const nearestFloor = (x: number, y: number): { x: number; y: number } => {
    for (let r = 0; r < 6; r++)
      for (let oy = -r; oy <= r; oy++)
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          if (isNear(x + ox, y + oy)) return { x: x + ox, y: y + oy };
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
  decal({ kind: 'oscar', x: oscar.x, y: oscar.y });
  for (const k of kin) decal({ kind: 'oscarkin', x: k.x, y: k.y });

  // ---- CHESTS -----------------------------------------------------------
  // Off the track, out of the yard, in the corners of a working farm - and now
  // up the bank as well, so the walk to the bridge pays.
  const chestSpots: Array<{ x: number; y: number }> = [];
  for (const [x, y] of [
    [9, 24], [16, 38], [33, 20], [44, 33], [22, 47], [40, 8],
    [51, 26], [58, 6], [64, 18], [BRIDGE.x - 8, BRIDGE.y + 4], [30, 42], [12, 29],
  ] as const) {
    const c = nearestFloor(x, y);
    if (!isNear(c.x, c.y) || onTrack[idx(c.x, c.y)]) continue;
    if (chestSpots.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 6)) continue;
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
   * found by walking out from the water, and the water has TWO banks - so some
   * of the candidates were on the FAR one, which the pass above then blocked off
   * as unreachable. A fishing mark on ground nobody can reach is a mark that
   * never fires. Filtered here, after connectivity has had its say.
   */
  for (let i = fishing.length - 1; i >= 0; i--) {
    const f = fishing[i];
    if (grid[idx(f.x, f.y)] !== TILE_FLOOR || !isWater(f.toX, f.toY)) fishing.splice(i, 1);
  }
  fishing.length = Math.min(fishing.length, 8); // enough that one is always near
  for (const f of fishing) decal({ kind: 'fishspot', x: f.x, y: f.y });

  /**
   * THE FARM'S OWN ANGLERS (it.107). A river with nobody on it is a texture; a
   * river with men sat along it watching their lines is a place people live.
   * They are render-only bodies with an idle of their own - they never move,
   * never path, and never take part in a tick - and they are kept well clear of
   * the hero's own marks so the bank never has two rods on one tile.
   */
  const anglers: RiverLayout['anglers'] = [];
  for (const s2 of shoreTiles) {
    if (anglers.length >= 5) break;
    if (onTrack[idx(s2.x, s2.y)] || grid[idx(s2.x, s2.y)] !== TILE_FLOOR) continue;
    if (Math.hypot(s2.x - BRIDGE.x, s2.y - BRIDGE.y) < 7) continue; // not under the span
    if (fishing.some((f) => Math.hypot(f.x - s2.x, f.y - s2.y) < 4)) continue;
    if (anglers.some((a) => Math.hypot(a.x - s2.x, a.y - s2.y) < 8)) continue;
    if (props.some((q) => q.x === s2.x && q.y === s2.y && q.kind !== 'reeds')) continue;
    let to: { x: number; y: number } | null = null;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) if (isWater(s2.x + dx, s2.y + dy)) to = { x: s2.x + dx, y: s2.y + dy };
    if (!to) continue;
    anglers.push({ x: s2.x, y: s2.y, toX: to.x, toY: to.y });
  }
  for (const a of anglers) decal({ kind: 'angler', x: a.x, y: a.y });

  const map: TownMap = {
    width: W,
    height: H,
    grid,
    // One room, the meadow itself: this floor is never stocked from the pool.
    // Its only hostiles are the three the quest places by hand.
    rooms: [{ x: 8, y: 24, w: 14, h: 12 }],
    spawn: { ...ENTRY },
    seed,
    tileKind,
    wallsFromProps: true, // the tree line IS the border (it.101)
  };
  const layout = bareLayout(map, props, 'THE RIVERSIDE FARM');
  layout.wander = { x: YARD.x - 6, y: YARD.y - 4, w: 14, h: 10 };
  layout.houses = [];
  layout.guards = knights; // THE WATCH ON THE BRIDGE (it.110): Villagers stands them up.
  layout.chests = [];
  for (const c of chestSpots) {
    if (grid[idx(c.x, c.y)] !== TILE_FLOOR) continue;
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
    anglers,
    water: water.filter((w) => tileKind[idx(w.x, w.y)] === KIND_WATER && grid[idx(w.x, w.y)] !== TILE_FLOOR),
    bridge: { ...BRIDGE },
    span,
    knights,
    safe,
  };
  layout.river = river;
  return { layout, river };
}
