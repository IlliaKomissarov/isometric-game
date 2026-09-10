/**
 * @module scenes/Battlefield
 * THE BATTLEFIELD (it.110) — the ground on the far side of the river bridge,
 * a week after the battle that was fought over it.
 *
 * This is the first place in the game that is not an errand. Nothing here is
 * "won": the fighting finished before the hero arrived and the field was simply
 * left, so what the map has to do is READ as an aftermath and then get out of
 * the way. Everything on it is either something the armies brought and did not
 * take home, something they left lying, or somebody who came afterwards to go
 * through the pockets.
 *
 * GEOGRAPHY. The bridge lands on the WEST edge, so the hero walks in from there
 * and the ground opens out east:
 *
 *   WEST edge    the bridge road, the signpost back over the water, and the
 *                first of the dead - this end was the rout.
 *   MIDDLE       THE MANOR: a walled estate standing whole in the middle of a
 *                field that is not, with its gate open and its windows lit.
 *   NORTH        the siege line - three engines that still throw and the wrecks
 *                of three more, laid on the house they were battering.
 *   SOUTH        the war camp - pavilions, cook fires, cauldrons, and the
 *                spoil-heaps of an army that packed up in a hurry.
 *   EAST edge    THE EASTERN ROAD, barricaded behind a portcullis: the city
 *                beyond it is not built yet, and the map says so by name.
 *
 * THE BORDER is FOUR RINGS of heavy timber, thinning outward, grown with one BFS
 * out of the open ground - the same belt the farmlands use (it.103). There is no
 * way off this field except the bridge behind you and the road that is shut.
 *
 * WHAT IS NOT HERE. There is no catapult sprite in any pack in the repository,
 * so the engines are COMPOSED, in `TownProps`, out of pieces that are: the
 * pack's cart for the bed and wheels, its timber trestle for the frame, a plank
 * for the throwing arm and a cask for the counterweight. `siege` props carry
 * `catapult` (it still throws - walk up and press E) or `wreck` (it never will
 * again). The layout only says where they stand and which way they are laid.
 */

import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL } from '@/scenes/DungeonGenerator';
import { CLUTTER_KINDS, KIND_DIRT, KIND_FARM_ASH, KIND_GRASS, type FieldLayout, type TownLayout, type TownMap, type TownProp } from '@/town/TownMap';
import { mulberry32 } from '@/utils/rng';
import { bareLayout } from './Forest';

export const FIELD_W = 72;
export const FIELD_H = 56;

/** The open ground: seven overlapping lobes, so the field is a field and not a box. */
const LOBES: ReadonlyArray<{ cx: number; cy: number; rx: number; ry: number }> = [
  { cx: 16, cy: 28, rx: 13, ry: 13 }, // the bridge end - the rout came through here
  { cx: 34, cy: 22, rx: 14, ry: 13 }, // the manor's ground and the siege line above it
  { cx: 34, cy: 38, rx: 13, ry: 11 }, // the camp
  { cx: 50, cy: 28, rx: 14, ry: 13 }, // the middle of the field
  { cx: 62, cy: 26, rx: 10, ry: 11 }, // the ground before the eastern road
  { cx: 24, cy: 14, rx: 10, ry: 9 }, // the northern spur
  { cx: 48, cy: 44, rx: 10, ry: 9 }, // the southern spur
];

/** Where the bridge sets the hero down, and the signpost back across the water. */
const ENTRY = { x: 6, y: 27 };
const HOME = { x: 4, y: 27 };
/** The manor's footprint: five by five, in the middle of everything. */
const MANOR = { x: 31, y: 22, w: 5, h: 5 };
/** The barricaded road east, and the city that is not built yet. */
const CITY = { x: 66, y: 26, label: 'THE EASTERN ROAD' };

/**
 * THE ROAD ACROSS. Bridge, manor gate, eastern road - the line the whole map is
 * read along. It is carved three tiles wide and NOTHING is ever built on it, so
 * the way through is legible from the moment the hero steps off the span.
 */
const ROAD: ReadonlyArray<{ x: number; y: number }> = [
  { x: 3, y: 27 },
  { x: 12, y: 28 },
  { x: 22, y: 29 },
  { x: 33, y: 29 },
  { x: 44, y: 28 },
  { x: 56, y: 27 },
  { x: 66, y: 26 },
];

export function buildFieldLayout(seed: number): { layout: TownLayout; field: FieldLayout } {
  const W = FIELD_W;
  const H = FIELD_H;
  const rand = mulberry32((seed ^ 0xba771e) >>> 0);
  const grid = new Uint8Array(W * H).fill(TILE_WALL);
  const tileKind = new Uint8Array(W * H).fill(KIND_GRASS);
  const idx = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const isFloor = (x: number, y: number): boolean => inside(x, y) && grid[idx(x, y)] === TILE_FLOOR;

  // ---- THE OPEN GROUND ---------------------------------------------------
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

  // ---- THE ROAD ----------------------------------------------------------
  const onRoad = new Uint8Array(W * H);
  const carve = (a: { x: number; y: number }, b: { x: number; y: number }, half = 1): void => {
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 2));
    for (let i = 0; i <= steps; i++) {
      const cx = Math.round(a.x + ((b.x - a.x) * i) / steps);
      const cy = Math.round(a.y + ((b.y - a.y) * i) / steps);
      for (let y = cy - half; y <= cy + half; y++)
        for (let x = cx - half; x <= cx + half; x++) {
          if (!inside(x, y) || x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          grid[idx(x, y)] = TILE_FLOOR;
          tileKind[idx(x, y)] = KIND_DIRT;
          onRoad[idx(x, y)] = 1;
        }
    }
  };
  for (let i = 1; i < ROAD.length; i++) carve(ROAD[i - 1], ROAD[i]);
  // The manor's own approach: off the road, up to the gate in its south wall.
  carve({ x: MANOR.x + 2, y: 29 }, { x: MANOR.x + 2, y: MANOR.y + MANOR.h }, 1);

  /**
   * ONE FIELD, NOT SEVEN (it.110). Seven overlapping ellipses leave DEEP
   * INTRUSIONS between them - fingers of not-field reaching in from the rim -
   * and the border belt is grown out of every tile that is not open ground. So
   * the wood came up in the MIDDLE of the battlefield: a hundred and eighteen
   * trees standing where the fighting was, and a field that read as a clearing
   * with copses in it.
   *
   * A tile is INSIDE the field if there is open ground six tiles away on three
   * of its four sides. Those are filled in - twice, because filling changes the
   * answer for the tiles beside them - and what is left is one continuous field
   * whose only not-field is genuinely around the outside of it.
   */
  {
    const surrounded = (x: number, y: number): boolean => {
      let n = 0;
      for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6]] as const) if (isFloor(x + dx, y + dy)) n++;
      return n >= 3;
    };
    for (let pass = 0; pass < 2; pass++) {
      const fill: number[] = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (!isFloor(x, y) && surrounded(x, y)) fill.push(idx(x, y));
      for (const i of fill) grid[i] = TILE_FLOOR;
    }
  }

  /**
   * THE CHURN. A field two armies manoeuvred over is not a lawn: broad bands of
   * beaten earth run across it where the lines stood, with grass surviving only
   * between them, and the ground the fires took is ash. All of it is a pure
   * function of the tile, so none of it moves the shared random stream (it.98).
   */
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isFloor(x, y) || onRoad[idx(x, y)]) continue;
      const band = Math.sin(x * 0.11 + Math.cos(y * 0.09) * 1.6);
      /**
       * MOSTLY BEATEN EARTH (it.110b). it.110 left more than half the field in
       * green pasture, which is what a battlefield looks like a summer later,
       * not a week. The grass survives only in the pockets the lines never
       * crossed, and the broad bands where they stood are churned to mud.
       */
      /**
       * IT.111: less green still. A week after two armies manoeuvred over it,
       * pasture survives only in pockets the lines never reached - at -0.35 the
       * field was a third grass, and grass is the single most cheerful thing on
       * the palette.
       */
      if (band > -0.62) tileKind[idx(x, y)] = KIND_DIRT;
      // And where it burned it is ash - in BANDS, which read as fire scars,
      // never as the scattered single tiles it.110 speckled and which read as
      // pits in the ground.
      const burn = Math.sin(x * 0.075 - y * 0.055 + 1.1);
      if (burn > 0.86) tileKind[idx(x, y)] = KIND_FARM_ASH;
    }
  }
  // Two burnt scars where the camp fires got into the grass. These are the only
  // ash on the map: a black diamond is a strong mark and it has to mean something.
  for (const [bx, by, br] of [[27, 41, 3], [46, 17, 3]] as const) {
    for (let y = by - br; y <= by + br; y++)
      for (let x = bx - br; x <= bx + br; x++)
        if (isFloor(x, y) && Math.hypot(x - bx, y - by) <= br && !onRoad[idx(x, y)]) tileKind[idx(x, y)] = KIND_FARM_ASH;
  }

  // ---- PROPS -------------------------------------------------------------
  const props: TownProp[] = [];
  const block = (p: TownProp): void => {
    props.push(p);
    if (CLUTTER_KINDS.has(p.kind)) return;
    for (let y = p.y; y < p.y + (p.h ?? 1); y++)
      for (let x = p.x; x < p.x + (p.w ?? 1); x++) if (inside(x, y)) grid[idx(x, y)] = TILE_BLOCKED;
  };
  const decal = (p: TownProp): void => {
    props.push(p);
  };
  /** A standing piece: open ground, never on the road. */
  const put = (kind: TownProp['kind'], x: number, y: number, variant?: string): boolean => {
    if (!isFloor(x, y) || onRoad[idx(x, y)]) return false;
    if (props.some((q) => q.x === x && q.y === y && !CLUTTER_KINDS.has(q.kind))) return false;
    block({ kind, x, y, variant });
    return true;
  };
  /** Paint on the ground: anywhere open, road included - a body fell where it fell. */
  const lay = (kind: TownProp['kind'], x: number, y: number, variant?: string): void => {
    if (!isFloor(x, y)) return;
    decal({ kind, x, y, variant, ox: (rand() - 0.5) * 0.5, oy: (rand() - 0.5) * 0.5 });
  };
  /** A wide piece, placed by search: spirals out until its whole footprint is clear. */
  const structure = (kind: TownProp['kind'], ax: number, ay: number, w: number, h: number, variant?: string, reach = 6, extra?: Partial<TownProp>): { x: number; y: number } | null => {
    const fits = (x: number, y: number): boolean => {
      for (let yy = y - 1; yy <= y + h; yy++)
        for (let xx = x - 1; xx <= x + w; xx++) if (!isFloor(xx, yy) || onRoad[idx(xx, yy)]) return false;
      return true;
    };
    for (let r = 0; r <= reach; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const x = ax + ox;
          const y = ay + oy;
          if (!fits(x, y)) continue;
          block({ kind, x, y, w, h, variant, ...extra });
          return { x, y };
        }
      }
    }
    return null;
  };

  // ---- THE MANOR ---------------------------------------------------------
  // The one building on the field that is still whole, and the only reason
  // anybody is still here. Its wall is a low ring of stone with the gate in the
  // south face, and the door column in front of it stays open.
  block({ kind: 'manor', x: MANOR.x, y: MANOR.y, w: MANOR.w, h: MANOR.h });
  const manorDoor = { x: MANOR.x + 2, y: MANOR.y + MANOR.h };
  const manorYard = { x: MANOR.x + 2, y: MANOR.y + MANOR.h + 2 };
  grid[idx(manorDoor.x, manorDoor.y)] = TILE_FLOOR;
  tileKind[idx(manorDoor.x, manorDoor.y)] = KIND_DIRT;
  onRoad[idx(manorDoor.x, manorDoor.y)] = 1;
  decal({ kind: 'manordoor', x: manorDoor.x, y: manorDoor.y, variant: 'THE MANOR' });
  // The estate wall: a ring of low ruin-wall stubs with the gate left open.
  for (let x = MANOR.x - 3; x <= MANOR.x + MANOR.w + 2; x += 2) {
    for (const y of [MANOR.y - 3, MANOR.y + MANOR.h + 2]) {
      if (Math.abs(x - manorDoor.x) <= 2 && y > MANOR.y) continue; // the gateway
      if (isFloor(x, y) && !onRoad[idx(x, y)]) decal({ kind: 'fence', x, y });
    }
  }
  for (let y = MANOR.y - 1; y <= MANOR.y + MANOR.h; y += 2) {
    for (const x of [MANOR.x - 3, MANOR.x + MANOR.w + 2]) {
      if (isFloor(x, y) && !onRoad[idx(x, y)]) decal({ kind: 'fence', x, y });
    }
  }
  // Two braziers at the gateposts: the house is LIT, which is how you know
  // somebody is in it, and it is the only warm light on the whole field. They
  // stand beside the approach, not on it - `put` refuses a road tile, and both
  // of the obvious spots in front of the door are road.
  for (const dx of [-3, 3]) put('brazier', manorDoor.x + dx, manorDoor.y - 1);
  put('statue', MANOR.x - 4, MANOR.y + 2, 'statue_a');
  put('statue', MANOR.x + MANOR.w + 3, MANOR.y + 2, 'statue_b');

  // ---- THE SIEGE LINE ----------------------------------------------------
  // North of the house, laid on it. Three engines still stand; three are wrecks.
  // Each one's facing points at the manor, because that is what they were for.
  const catapults: FieldLayout['catapults'] = [];
  const aimAtManor = (x: number, y: number): { dx: number; dy: number } => {
    const dx = MANOR.x + MANOR.w / 2 - x;
    const dy = MANOR.y + MANOR.h / 2 - y;
    const d = Math.hypot(dx, dy) || 1;
    return { dx: dx / d, dy: dy / d };
  };
  for (const [ax, ay] of [[26, 13], [36, 11], [46, 15]] as const) {
    // The aim has to be known BEFORE the piece is placed, because the dresser
    // lays the arm along it - so it is measured from where the engine wants to
    // stand and carried in on the prop itself.
    const want = aimAtManor(ax, ay);
    const at = structure('siege', ax, ay, 2, 2, 'catapult', 7, { aim: { x: want.dx, y: want.dy } });
    if (!at) continue;
    catapults.push({ x: at.x, y: at.y, ...want });
  }
  for (const [ax, ay] of [[20, 17], [42, 8], [52, 12], [31, 16]] as const) {
    const want = aimAtManor(ax, ay);
    structure('siege', ax, ay, 2, 2, 'wreck', 7, { aim: { x: want.dx, y: want.dy } });
  }
  // The engines' spoil: shot piles, timber, and the stakes that screened them.
  for (const [x, y] of [[24, 16], [34, 14], [44, 18], [29, 11], [39, 15], [49, 11]] as const) put('rock', x, y, (x + y) % 2 ? 'rock_c' : 'rock_e');
  for (const [x, y] of [[22, 14], [38, 17], [48, 9], [27, 18]] as const) put('wood_pile', x, y);
  for (let x = 18; x <= 52; x += 3) {
    const y = 19 + ((x * 5) % 3);
    if (isFloor(x, y) && !onRoad[idx(x, y)]) block({ kind: 'barricade', x, y, variant: (x % 2) ? 'barricade_a' : 'barricade_b' });
  }

  // ---- THE WAR CAMP ------------------------------------------------------
  // South of the road: pavilions still pitched, fires long cold, and the gear of
  // an army that struck camp in a hurry and left half of it standing.
  const camp: Array<{ x: number; y: number }> = [];
  for (const [ax, ay, v, w, h] of [
    [20, 38, 'tent_a', 4, 3], [28, 42, 'tent_b', 4, 3], [38, 40, 'tent_a', 4, 3],
    [46, 38, 'tent_c', 3, 2], [24, 46, 'tent_d', 2, 2], [34, 46, 'tent_e', 2, 2],
    [44, 45, 'tent_d', 2, 2], [15, 35, 'tent_c', 3, 2], [52, 42, 'tent_e', 2, 2],
  ] as const) {
    const at = structure('tent', ax, ay, w, h, v, 5);
    if (at) camp.push({ x: at.x + w / 2, y: at.y + h / 2 });
  }
  for (const [x, y, v] of [
    [24, 40, 'firepit_a'], [33, 44, 'firepit_b'], [42, 42, 'firepit_a'],
    [19, 42, 'firepit_b'], [49, 41, 'firepit_a'], [29, 37, 'firepit_b'],
  ] as const) lay('firepit', x, y, v);
  for (const [x, y] of [[25, 40], [43, 42], [20, 43]] as const) lay('tripod', x, y);
  for (const [x, y, k, v] of [
    [22, 41, 'barrel', 'barrel_b'], [31, 45, 'crates', undefined], [40, 39, 'barrels_stacked', undefined],
    [47, 44, 'crates_wood', undefined], [17, 39, 'barrel', 'barrel_d'], [36, 37, 'crates', undefined],
    [27, 48, 'wood_pile', undefined], [50, 39, 'barrel', 'barrel_c'], [43, 47, 'crates_wood', undefined],
  ] as const) put(k as TownProp['kind'], x, y, v);
  for (const [x, y] of [[26, 43], [39, 44], [21, 37]] as const) put('rack', x, y); // the armourers' racks, left standing
  for (const [x, y] of [[30, 40], [45, 40], [23, 44]] as const) put('table', x, y, 'table_a');

  // ---- THE DEAD, AND WHAT THEY DROPPED -----------------------------------
  /**
   * The bodies are laid in BANDS, not scattered evenly: the two lines met west
   * of the manor and the rout ran back toward the bridge, so the dead thicken
   * where the fighting was and thin toward the east where it was already over.
   * They are `corpse` props - a death frame lying on the ground over a pool, and
   * nothing a blade can reach - so a field of them costs no simulation at all.
   */
  const SHEETS = ['g', 'c', 'p'] as const; // the city's mail, the company's plate, the levy
  let fallen = 0;
  for (let y = 4; y < H - 4; y++) {
    for (let x = 4; x < W - 4; x++) {
      if (!isFloor(x, y)) continue;
      if (props.some((q) => q.x === x && q.y === y && !CLUTTER_KINDS.has(q.kind))) continue;
      // Thickest on the line the armies met, thinning east. STREWN, NOT PAVED
      // (it.110): the first pass laid two hundred bodies and the field read as a
      // carpet of them - which is both worse to look at and a great deal of
      // paint. This is about half that, and the eye still cannot see a gap.
      const line = Math.exp(-Math.pow((x - 24) / 13, 2)) * 0.42 + 0.07;
      if (((x * 17 + y * 29) % 100) / 100 >= line) continue;
      if ((x + y * 3) % 4 !== 0) continue;
      const sheet = SHEETS[(x + y) % SHEETS.length];
      decal({ kind: 'corpse', x, y, variant: `${sheet}${(x * 3 + y) % 8}` });
      fallen++;
      /**
       * A BODY BLEEDS WHERE IT FELL (it.110b). `gore_*` is cut out of the pack's
       * bloody-wall photographs and flattened onto the ground plane - a real
       * pool, not the cellar's little damp smear that it.110 borrowed.
       */
      if ((x * 5 + y) % 3 === 0) decal({ kind: 'gore', x, y, variant: `gore_${'abcdef'[(x * 3 + y) % 6]}`, ox: (rand() - 0.5) * 0.6, oy: (rand() - 0.5) * 0.6 });
      // ...and thrown spatter beside a good half of them, which is what actually
      // covers the ground round a body: fine, dark, and much smaller than a pool.
      if ((x * 3 + y * 7) % 2 === 0) decal({ kind: 'gore', x: x + ((x + y) % 2 ? 1 : -1), y, variant: `spatter_${'abc'[(x + y * 5) % 3]}`, ox: (rand() - 0.5) * 0.8, oy: (rand() - 0.5) * 0.8 });
      if ((x * 7 + y * 3) % 11 === 0) lay('debris', x + 1, y, `debris_${'abcd'[(x + y) % 4]}`);
      if ((x * 11 + y * 5) % 17 === 0) lay('rubble', x, y + 1, `rubble_${'abcdefg'[(x * 3 + y) % 7]}`);
    }
  }
  /**
   * AND SOME OF IT IS NOT UNDER ANYBODY (it.110b), because most of the blood on
   * a field is not, by the time somebody comes to look at it.
   *
   * SPARINGLY. The first pass at this laid seven hundred pools and the field
   * came out a red CARPET - which reads as a lake, not as a battle, and buries
   * the ground it is supposed to be staining. A stain has to have clean earth
   * round it to read as a stain. This is about a tenth as much, kept to the line
   * the armies actually met on, plus three real slicks where the press was
   * worst.
   */
  for (let y = 5; y < H - 5; y++) {
    for (let x = 5; x < W - 5; x++) {
      if (!isFloor(x, y)) continue;
      const line = Math.exp(-Math.pow((x - 26) / 14, 2)) * 0.20;
      if (((x * 41 + y * 13) % 100) / 100 >= line) continue;
      lay('gore', x, y, (x * 7 + y) % 3 === 0 ? `spatter_${'abc'[(x + y) % 3]}` : `gore_${'abcdef'[(x * 5 + y * 3) % 6]}`);
    }
  }
  // Three slicks where the press was worst, and nothing dragged out of them.
  for (const [bx, by, br] of [[24, 26, 4], [21, 33, 3], [29, 20, 3], [17, 29, 3], [33, 24, 2]] as const) {
    for (let y = by - br; y <= by + br; y++)
      for (let x = bx - br; x <= bx + br; x++) {
        if (!isFloor(x, y) || Math.hypot(x - bx, y - by) > br) continue;
        if ((x * 3 + y) % 3) continue;
        lay('gore', x, y, `gore_${'abcdef'[(x + y) % 6]}`);
      }
  }

  // Heaps of stripped gear where the scavengers have already been through.
  for (const [x, y] of [[14, 24], [19, 31], [30, 33], [12, 30], [23, 25], [37, 31], [9, 26]] as const)
    lay('heap', x, y, `heap_${'abcde'[(x + y) % 5]}`);
  // Dead trees standing in the middle of it, stripped by the fires.
  for (const [x, y] of [[13, 20], [29, 34], [41, 22], [55, 33], [18, 33], [47, 25], [60, 20]] as const) put('deadtree', x, y, (x + y) % 2 ? 'dead_a' : 'dead_b');
  // Broken carts on the road, pushed aside where the rout came through.
  for (const [x, y] of [[10, 24], [17, 31], [28, 25], [51, 30]] as const) put('cart', x, y, (x + y) % 2 ? 'cart_b' : undefined);

  // ---- THE EASTERN ROAD --------------------------------------------------
  // The one thing on this map the hero walks up to and is told no.
  const cityGate = { ...CITY };
  {
    const gx = cityGate.x;
    const gy = cityGate.y;
    for (let y = gy - 2; y <= gy + 2; y++) if (inside(gx, y)) grid[idx(gx, y)] = TILE_BLOCKED;
    if (inside(gx - 1, gy)) {
      grid[idx(gx - 1, gy)] = TILE_FLOOR;
      tileKind[idx(gx - 1, gy)] = KIND_DIRT;
      onRoad[idx(gx - 1, gy)] = 1;
    }
    decal({ kind: 'citygate', x: gx, y: gy, variant: cityGate.label });
    for (const dy of [-2, 2]) if (isFloor(gx - 1, gy + dy)) block({ kind: 'barricade', x: gx - 1, y: gy + dy, variant: dy < 0 ? 'barricade_a' : 'barricade_b' });
  }
  decal({ kind: 'fieldroad', x: HOME.x, y: HOME.y });
  for (const t of [ENTRY, HOME]) if (inside(t.x, t.y)) grid[idx(t.x, t.y)] = TILE_FLOOR;

  // ---- THE WOOD ----------------------------------------------------------
  // Four rings of it, thinning outward, so the field ends in forest and there is
  // demonstrably no way out of it but the two roads.
  {
    const BELT = 4;
    const depth = new Int8Array(W * H).fill(-1);
    let frontier: number[] = [];
    /**
     * A TREE NEVER GROWS OUT OF A TENT (it.110). The belt is grown from every
     * tile that is not open ground, and a tile a PROP stands on is not open
     * ground - so a tree came up inside every tent, every siege engine, the
     * manor and each of its gateposts, a hundred-odd of them scattered through
     * the middle of the field. The wood grows out of everything that is not
     * MAP: floor and prop alike are seeds, and only the void beyond the field
     * is ever planted.
     */
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (grid[idx(x, y)] !== TILE_WALL) {
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
    const NEAR_TREES = ['tree_a', 'tree_b', 'pine_a', 'pine_b', 'pine_c'] as const;
    const DEEP_TREES = ['bigtree_a', 'bigtree_b', 'bigtree_c', 'pine_a', 'pine_c', 'tree_b'] as const;
    const FILL = [0, 1, 1, 0.6, 0.3] as const;
    const roadMouth = (x: number, y: number): boolean => {
      if (Math.abs(y - CITY.y) <= 2 && x >= CITY.x - 1) return true;
      for (const r of ROAD.slice(0, 2)) if (Math.abs(x - r.x) <= 2 && Math.abs(y - r.y) <= 2) return true;
      return false;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = depth[idx(x, y)];
        if (d <= 0) continue;
        if (roadMouth(x, y) && d <= 2) continue;
        const fill = FILL[d] ?? 0;
        if (fill < 1 && ((x * 13 + y * 7) % 100) / 100 >= fill) continue;
        const set = d <= 1 ? NEAR_TREES : DEEP_TREES;
        const v = set[(x * 7 + y * 11) % set.length];
        decal({ kind: v.startsWith('bigtree') ? 'bigtree' : v.startsWith('pine') ? 'pine' : 'tree', x, y, variant: v, bare: d > 1, ox: (((x * 5 + y * 3) % 7) - 3) * 0.06, oy: (((x * 3 + y * 11) % 7) - 3) * 0.06 });
      }
    }
  }

  // ---- THE SCAVENGERS ----------------------------------------------------
  // Not a garrison and not a pack: men who came for the pockets, working the
  // field in twos, spread the length of it so crossing is never quiet for long.
  const looterPosts: FieldLayout['looterPosts'] = [];
  for (const [x, y] of [
    [14, 22], [16, 33], [24, 20], [26, 34], [33, 17], [35, 35],
    [43, 21], [45, 34], [52, 24], [54, 33], [60, 22], [61, 31],
    [20, 27], [39, 26],
  ] as const) {
    for (let r = 0; r < 5; r++) {
      let placed = false;
      for (let oy = -r; oy <= r && !placed; oy++) {
        for (let ox = -r; ox <= r && !placed; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const tx = x + ox;
          const ty = y + oy;
          if (!isFloor(tx, ty)) continue;
          if (looterPosts.some((q) => q.x === tx && q.y === ty)) continue;
          looterPosts.push({ x: tx, y: ty, kind: (tx + ty) % 3 === 0 ? 'brigand' : 'bandit' });
          placed = true;
        }
      }
      if (placed) break;
    }
  }

  // ---- WHAT IS WORTH PICKING UP ------------------------------------------
  const chestSpots: Array<{ x: number; y: number }> = [
    { x: 12, y: 21 }, { x: 21, y: 34 }, { x: 30, y: 19 }, { x: 41, y: 34 },
    { x: 49, y: 20 }, { x: 58, y: 31 }, { x: 25, y: 45 }, { x: 44, y: 46 },
    { x: 61, y: 21 }, { x: 15, y: 29 },
  ];

  // ---- nothing may be walled into a pocket -------------------------------
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
    // rooms[0] is the bridge landing and is never stocked; nothing else on this
    // floor is stocked either - every hostile here stands on a post the layout
    // chose, the way the eastern quarter's looters do (it.91).
    rooms: [{ x: 8, y: 23, w: 10, h: 9 }],
    spawn: { ...ENTRY },
    seed,
    tileKind,
    wallsFromProps: true, // the wood IS the border (it.101)
  };
  const layout = bareLayout(map, props, 'THE BATTLEFIELD');
  layout.wander = { x: 20, y: 24, w: 20, h: 12 };
  layout.houses = [{ x: MANOR.x, y: MANOR.y, w: MANOR.w, h: MANOR.h }];
  layout.chests = [];
  for (const c of chestSpots) {
    if (!isFloor(c.x, c.y) || onRoad[idx(c.x, c.y)]) continue;
    grid[idx(c.x, c.y)] = TILE_BLOCKED;
    layout.chests.push(c);
  }

  const field: FieldLayout = {
    entry: { ...ENTRY },
    home: { ...HOME },
    manorDoor,
    manorYard,
    catapults,
    cityGate,
    looterPosts: looterPosts.filter((p) => grid[idx(p.x, p.y)] === TILE_FLOOR),
  };
  layout.field = field;
  // The camp's own dead reeds of smoke are the ambience's job, not the layout's;
  // `fallen` is kept only so a build can be eyeballed in the console.
  if (fallen === 0) console.warn('[battlefield] no dead were laid - the bands missed the ground');
  return { layout, field };
}
