/**
 * @module scenes/DungeonGenerator
 * Seeded BSP room-and-corridor dungeon generator.
 *
 * Recursively splits the map into leaves, carves one room per leaf, then
 * connects sibling subtrees with L-shaped corridors — guaranteeing full
 * connectivity by construction (every merge step links two already-connected
 * regions). Deterministic from the seed, so co-op peers regenerate identical
 * layouts from `GameSnapshot.dungeonSeed`.
 *
 * Reference: /docs/skills/bsp-dungeon-generation.md
 */

import { mulberry32 } from '@/utils/rng';

export const TILE_WALL = 0;
export const TILE_FLOOR = 1;
/**
 * Floor tile occupied by a SOLID prop (candelabra hearth): blocks movement
 * and pathing, does NOT block sight, renders as floor under the prop.
 * classic ARPG-rule (it.16): if you can't walk through it, it has collision.
 */
export const TILE_BLOCKED = 2;
/** THE IRON GATE (it.85): solid and opaque until its key opens it; then TILE_FLOOR. */
export const TILE_DOOR = 3;

/**
 * Deterministically pick hearth tiles (one inner room corner in ~70% of
 * non-spawn rooms) and mark them TILE_BLOCKED in the grid. Called by main
 * BEFORE the scene/pathfinder are built so collision, sight, rendering and
 * prop placement all agree. Returns the tiles for Props to dress.
 */
export function planHearths(map: DungeonMap): Array<{ x: number; y: number }> {
  const rand = mulberry32(map.seed ^ 0x11ea57);
  const hearths: Array<{ x: number; y: number }> = [];
  for (let i = 1; i < map.rooms.length; i++) {
    const room = map.rooms[i];
    if (rand() >= 0.7 || room.w < 4 || room.h < 4) continue;
    const corners = [
      { x: room.x + 1, y: room.y + 1 },
      { x: room.x + room.w - 2, y: room.y + 1 },
      { x: room.x + 1, y: room.y + room.h - 2 },
      { x: room.x + room.w - 2, y: room.y + room.h - 2 },
    ];
    const c = corners[Math.floor(rand() * corners.length)];
    const idx = c.y * map.width + c.x;
    if (map.grid[idx] !== TILE_FLOOR) continue;
    // NOT IN THE WAY IN (it.115): a corner hearth sits one step in from two
    // walls, which is exactly where a corridor that enters along the wall
    // arrives. A corner whose neighbour is a doorway of this room is skipped.
    if (nextToDoorway(map, room, c.x, c.y) || nextToDoorway(map, room, c.x, c.y, true)) continue;
    map.grid[idx] = TILE_BLOCKED;
    hearths.push(c);
  }
  return hearths;
}

/** True when an orthogonal neighbour of (x, y) - or (x, y) itself, with `self` - is a tile of `room` with open ground outside the room beside it. */
function nextToDoorway(map: DungeonMap, room: Room, x: number, y: number, self = false): boolean {
  const { width, height, grid } = map;
  const openAt = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < width && ty < height && grid[ty * width + tx] !== TILE_WALL;
  const inRoom = (tx: number, ty: number): boolean => tx >= room.x && ty >= room.y && tx < room.x + room.w && ty < room.y + room.h;
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of self ? [[0, 0]] : steps) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inRoom(nx, ny)) continue;
    for (const [ex, ey] of steps) if (!inRoom(nx + ex, ny + ey) && openAt(nx + ex, ny + ey)) return true;
  }
  return false;
}

/**
 * THE WAYS IN (it.115): every room tile that is a doorway (open ground outside
 * the room beside it) or orthogonally next to one. A solid prop - a hearth, a
 * chest - is never placed on these, so no way into a room is ever narrowed.
 */
export function doorwayApproaches(map: DungeonMap): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const room of map.rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (nextToDoorway(map, room, x, y) || nextToDoorway(map, room, x, y, true)) out.push({ x, y });
      }
    }
  }
  return out;
}

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DungeonMap {
  readonly width: number;
  readonly height: number;
  /** Row-major tile grid: TILE_WALL | TILE_FLOOR. */
  readonly grid: Uint8Array;
  readonly rooms: ReadonlyArray<Room>;
  /** Guaranteed-walkable player spawn tile (center of the first room). */
  readonly spawn: { x: number; y: number };
  readonly seed: number;
  /**
   * THE CRYPT'S TORCH BRACKETS (it.115): filled in by `SceneManager.build` when
   * the tileset walls are up - every sixth wall piece on a room wall. The
   * integrator hangs the flames (`SceneManager.placeTorches`) once the torch
   * atlases are resident; nothing here draws them.
   */
  torchSpots?: TorchSpot[];
}

/** Where a wall torch hangs (it.115): a bracket on a north (`n`, faces south) or west (`w`, faces east) wall piece. */
export interface TorchSpot {
  side: 'n' | 'w';
  /** The wall tile the bracket is on. */
  x: number;
  y: number;
  /** The floor tile the flame faces: fog gating and the light's home. */
  gx: number;
  gy: number;
  /** The wall piece's sort key; the flame draws one above it. */
  zIndex: number;
}

// ---------------------------------------------------------------------------
// THE TILESET WALL PLAN (it.115)
// ---------------------------------------------------------------------------

/**
 * One 128x256 tileset piece, in grid terms. `n` pieces face SOUTH: they stand
 * on the south edge of wall tiles (x, y) and (x + 1, y), which is the north
 * wall of the floor tiles below them. `w` pieces face EAST: the east edge of
 * wall tiles (x, y) and (x, y + 1). `corner` is the convex L of both, on wall
 * tiles (x, y), (x + 1, y) and (x + 1, y - 1): the block's bottom-left and
 * bottom-right edges meeting at its bottom vertex. `arch` and `door` are a
 * piece whose FIRST tile is an opening (a one-wide corridor mouth, or an iron
 * gate) and whose second is the pier. `(x, y)` is always the first wall tile.
 */
export interface WallPiece {
  kind: 'wall' | 'arch' | 'door' | 'corner';
  side: 'n' | 'w';
  x: number;
  y: number;
  /** True when the piece stands on a room's wall (torches go on those). */
  room: boolean;
}

/**
 * A NEAR-WALL STUB (it.115): one tile of low wall on a room's south (`s`) or
 * east (`e`) edge. `(x, y)` is the FLOOR tile it closes; the wall tile is
 * (x, y + 1) for `s` and (x + 1, y) for `e`. `shift` slides a corner filler
 * along its run by the wall's thickness (-1 back, +1 forward) so the run's
 * end cap closes the notch where two runs meet; 0 for an ordinary stub.
 */
export interface WallStub {
  side: 's' | 'e';
  x: number;
  y: number;
  shift: -1 | 0 | 1;
}

export interface WallPlan {
  pieces: WallPiece[];
  /** Free-standing wall tiles (three or four open sides): a 1x1 pillar each. */
  pillars: Array<{ x: number; y: number }>;
  /** The low near walls on every south and east floor edge (it.115). */
  stubs: WallStub[];
}

const FACE = 1;
const MOUTH = 2;

/**
 * Turn the grid's wall tiles into tileset runs (it.115). Pure and pixi-free,
 * so a node script can count and check it.
 *
 * THE RULE: a floor (or gate, or hearth) tile whose NORTH neighbour is wall
 * needs a north face; whose WEST neighbour is wall, a west face. South and
 * east edges take the low near-wall STUBS instead (it.115, see `WallStub`) -
 * a tall face there would hide the room. Faces are grouped into runs: along +x for north faces sharing a
 * row, along +y for west faces sharing a column. A piece covers TWO tiles of
 * run and goes at run offsets 0, 2, 4...; an ODD run puts its last piece at
 * L-2, overlapping the previous by one tile of identical art, so nothing ever
 * overhangs into open floor. A run of ONE leans onto whichever side has wall
 * behind it, and is skipped when neither has.
 *
 * MOUTHS: a one-wide corridor opening in a run (a floor tile with floor - or
 * a gate - behind it, walls either side of that) takes an `arch` (a `door`
 * over a gate) whose opening is the mouth and whose pier is the next face.
 * A mouth is only accepted when it will not leave a lone face on its left
 * (the stretch before it is 0 or >= 2 long), so the overlap rule never has
 * to draw a wall over an arch's opening; a lone face AFTER a pier overlaps
 * the pier, which narrows the arch by a tile and still reads.
 *
 * CORNERS: where a row run's last piece and a column run's last piece meet
 * on a convex corner (the wall tile with floor south AND east of it), both
 * are replaced by the one `corner` piece, on the row piece's block.
 *
 * PILLARS: a wall tile with three or four open orthogonal neighbours is a
 * free-standing pillar, drawn as one, and never a face for its neighbours.
 */
export function planWallPieces(map: DungeonMap): WallPlan {
  const { width, height, grid, rooms } = map;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= width || y >= height ? TILE_WALL : grid[y * width + x]);
  const open = (x: number, y: number): boolean => at(x, y) !== TILE_WALL;

  const pillar = new Uint8Array(width * height);
  const pillars: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y * width + x] !== TILE_WALL) continue;
      const n = (open(x, y - 1) ? 1 : 0) + (open(x + 1, y) ? 1 : 0) + (open(x, y + 1) ? 1 : 0) + (open(x - 1, y) ? 1 : 0);
      if (n >= 3) {
        pillar[y * width + x] = 1;
        pillars.push({ x, y });
      }
    }
  }
  const solid = (x: number, y: number): boolean => at(x, y) === TILE_WALL && !(x >= 0 && y >= 0 && x < width && y < height && pillar[y * width + x]);

  const inRoom = new Uint8Array(width * height);
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (x >= 0 && y >= 0 && x < width && y < height) inRoom[y * width + x] = 1;
  }

  const pieces: WallPiece[] = [];
  const cls = new Uint8Array(Math.max(width, height));

  /**
   * One line of run positions `0..n-1`. `face(i)` / `mouth(i)` classify the
   * OPEN tile at position i by what is behind it; `behindSolid(i)` says whether
   * the wall tile behind position i is real wall (for a run of one's lean).
   */
  const scanLine = (
    n: number,
    face: (i: number) => boolean,
    mouth: (i: number) => boolean,
    behindSolid: (i: number) => boolean,
    emit: (kind: WallPiece['kind'], i: number) => void,
  ): void => {
    for (let i = 0; i < n; i++) cls[i] = face(i) ? FACE : mouth(i) ? MOUTH : 0;
    let i = 0;
    let prev: 'none' | 'wall' | 'arch' = 'none';
    let lastStretch = -1;
    while (i < n) {
      const c = cls[i];
      if (c === MOUTH && i + 1 < n && cls[i + 1] === FACE && lastStretch !== 1) {
        emit('arch', i); // `emit` turns it into a door over a gate.
        i += 2;
        prev = 'arch';
        lastStretch = 0;
        continue;
      }
      if (c !== FACE) {
        i++;
        prev = 'none';
        lastStretch = -1;
        continue;
      }
      let j = i;
      while (j < n && cls[j] === FACE) j++;
      const L = j - i;
      if (L === 1) {
        if (prev === 'arch') emit('wall', i - 1); // Over the pier: the arch narrows, the wall stays whole.
        else if (i - 1 >= 0 && behindSolid(i - 1)) emit('wall', i - 1);
        else if (i + 1 < n && behindSolid(i + 1)) emit('wall', i);
      } else {
        for (let o = 0; o + 2 <= L; o += 2) emit('wall', i + o);
        if (L % 2 === 1) emit('wall', i + L - 2);
      }
      i = j;
      prev = 'wall';
      lastStretch = L;
    }
  };

  // North faces: row by row, along +x. The wall tiles are the row above.
  for (let fy = 1; fy < height; fy++) {
    scanLine(
      width,
      (x) => open(x, fy) && solid(x, fy - 1),
      (x) => open(x, fy) && open(x, fy - 1) && solid(x - 1, fy - 1) && solid(x + 1, fy - 1), // One wide (it.115): not a room's open corner.
      (x) => solid(x, fy - 1),
      (kind, x) => {
        const gate = kind === 'arch' && at(x, fy - 1) === TILE_DOOR;
        pieces.push({ kind: gate ? 'door' : kind, side: 'n', x, y: fy - 1, room: inRoom[fy * width + x] === 1 });
      },
    );
  }
  // West faces: column by column, along +y. The wall tiles are the column to the left.
  for (let fx = 1; fx < width; fx++) {
    scanLine(
      height,
      (y) => open(fx, y) && solid(fx - 1, y),
      (y) => open(fx, y) && open(fx - 1, y) && solid(fx - 1, y - 1) && solid(fx - 1, y + 1),
      (y) => solid(fx - 1, y),
      (kind, y) => {
        const gate = kind === 'arch' && at(fx - 1, y) === TILE_DOOR;
        pieces.push({ kind: gate ? 'door' : kind, side: 'w', x: fx - 1, y, room: inRoom[y * width + fx] === 1 });
      },
    );
  }

  // Convex corners: the row piece on (x..x+1, y) and the column piece on
  // (x+1, y-1..y) meet on wall tile (x+1, y), which has floor south and east.
  const byKey = new Map<string, number>();
  pieces.forEach((p, i) => byKey.set(`${p.side}:${p.x},${p.y}`, i));
  const dead = new Set<number>();
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.side !== 'n' || p.kind !== 'wall') continue;
    const j = byKey.get(`w:${p.x + 1},${p.y - 1}`);
    if (j === undefined || dead.has(j) || pieces[j].kind !== 'wall') continue;
    if (!(solid(p.x + 1, p.y) && open(p.x + 1, p.y + 1) && open(p.x + 2, p.y))) continue;
    p.kind = 'corner';
    dead.add(j);
  }

  // THE NEAR WALLS (it.115). The rule above never drew a south or east face, so
  // every room ended in open void on the two edges nearest the camera. Each
  // open tile with real wall to its south (or east) now takes a one-tile LOW
  // stub there. Where a south run meets the east edge (or the west wall) the
  // two runs leave a notch the wall's thickness wide; a second stub slid along
  // the run by that thickness closes it with its own end cap.
  const stubs: WallStub[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!open(x, y)) continue;
      if (solid(x, y + 1)) {
        stubs.push({ side: 's', x, y, shift: 0 });
        if (solid(x + 1, y) && solid(x + 1, y + 1)) stubs.push({ side: 's', x, y, shift: 1 });
        if (solid(x - 1, y) && solid(x - 1, y + 1)) stubs.push({ side: 's', x, y, shift: -1 });
      }
      if (solid(x + 1, y)) stubs.push({ side: 'e', x, y, shift: 0 });
    }
  }
  return { pieces: pieces.filter((_, i) => !dead.has(i)), pillars, stubs };
}

/**
 * BOSS ARENA MAP (it.28): one vast open fighting hall — no internal walls,
 * no dividers, a 1-tile solid border all around. The player enters from the
 * west; the keeper holds the east. Decoration (the candelabra hearth ring)
 * is planned by the caller before systems read the grid.
 */
export function generateArenaMap(width: number, height: number, seed: number): DungeonMap {
  const grid = new Uint8Array(width * height).fill(TILE_WALL);
  const room: Room = { x: 2, y: 2, w: width - 4, h: height - 4 };
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      grid[y * width + x] = TILE_FLOOR;
    }
  }
  return {
    width,
    height,
    grid,
    rooms: [room],
    spawn: { x: room.x + 2, y: room.y + Math.floor(room.h / 2) },
    seed,
  };
}

interface BspLeaf {
  x: number;
  y: number;
  w: number;
  h: number;
  left?: BspLeaf;
  right?: BspLeaf;
  room?: Room;
}

const MIN_LEAF = 10;
const MIN_ROOM = 4;

/** Per-depth generation flavor (architectural variety, it.14). */
export interface DungeonFlavor {
  /** Carve rows of pillar columns inside large rooms (ruined halls). */
  pillars?: boolean;
  /** Minimum carved room dimension (bigger = grander halls). */
  minRoom?: number;
}

export function generateDungeon(
  width: number,
  height: number,
  seed: number,
  flavor: DungeonFlavor = {},
): DungeonMap {
  const rand = mulberry32(seed);
  const minRoom = Math.max(MIN_ROOM, flavor.minRoom ?? MIN_ROOM);
  const grid = new Uint8Array(width * height).fill(TILE_WALL);
  const rooms: Room[] = [];

  const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

  // Keep a 1-tile solid border so entities can never sample out of bounds.
  const root: BspLeaf = { x: 1, y: 1, w: width - 2, h: height - 2 };

  const split = (leaf: BspLeaf, depth: number): void => {
    if (depth > 5) return;
    const canSplitH = leaf.w >= MIN_LEAF * 2;
    const canSplitV = leaf.h >= MIN_LEAF * 2;
    if (!canSplitH && !canSplitV) return;

    // Prefer splitting the longer axis to avoid corridor-thin leaves.
    const splitHorizontally =
      canSplitH && canSplitV ? leaf.w / leaf.h > 1.15 || (leaf.h / leaf.w <= 1.15 && rand() < 0.5) : canSplitH;

    if (splitHorizontally) {
      const cut = randInt(MIN_LEAF, leaf.w - MIN_LEAF);
      leaf.left = { x: leaf.x, y: leaf.y, w: cut, h: leaf.h };
      leaf.right = { x: leaf.x + cut, y: leaf.y, w: leaf.w - cut, h: leaf.h };
    } else {
      const cut = randInt(MIN_LEAF, leaf.h - MIN_LEAF);
      leaf.left = { x: leaf.x, y: leaf.y, w: leaf.w, h: cut };
      leaf.right = { x: leaf.x, y: leaf.y + cut, w: leaf.w, h: leaf.h - cut };
    }
    split(leaf.left, depth + 1);
    split(leaf.right, depth + 1);
  };
  split(root, 0);

  const carveRect = (x: number, y: number, w: number, h: number): void => {
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        if (tx > 0 && ty > 0 && tx < width - 1 && ty < height - 1) {
          grid[ty * width + tx] = TILE_FLOOR;
        }
      }
    }
  };

  // Carve one room per leaf (inset randomly inside the leaf bounds).
  const carveRooms = (leaf: BspLeaf): void => {
    if (leaf.left && leaf.right) {
      carveRooms(leaf.left);
      carveRooms(leaf.right);
      return;
    }
    const rw = randInt(minRoom, Math.max(minRoom, leaf.w - 3));
    const rh = randInt(minRoom, Math.max(minRoom, leaf.h - 3));
    const rx = leaf.x + randInt(1, Math.max(1, leaf.w - rw - 1));
    const ry = leaf.y + randInt(1, Math.max(1, leaf.h - rh - 1));
    const room: Room = { x: rx, y: ry, w: rw, h: rh };
    leaf.room = room;
    rooms.push(room);
    carveRect(rx, ry, rw, rh);
  };
  carveRooms(root);

  // L-shaped corridor between two points, 1–2 tiles wide for a dungeon feel.
  const carveCorridor = (x0: number, y0: number, x1: number, y1: number): void => {
    const wide = rand() < 0.35 ? 2 : 1;
    if (rand() < 0.5) {
      carveRect(Math.min(x0, x1), y0, Math.abs(x1 - x0) + 1, wide);
      carveRect(x1, Math.min(y0, y1), wide, Math.abs(y1 - y0) + 1);
    } else {
      carveRect(x0, Math.min(y0, y1), wide, Math.abs(y1 - y0) + 1);
      carveRect(Math.min(x0, x1), y1, Math.abs(x1 - x0) + 1, wide);
    }
  };

  /** Pick any carved room center within a subtree (walkable guaranteed). */
  const roomCenter = (leaf: BspLeaf): { x: number; y: number } => {
    if (leaf.room) {
      return {
        x: leaf.room.x + Math.floor(leaf.room.w / 2),
        y: leaf.room.y + Math.floor(leaf.room.h / 2),
      };
    }
    return roomCenter(rand() < 0.5 && leaf.left ? leaf.left : (leaf.right ?? leaf.left!));
  };

  // Connect siblings bottom-up: each merge joins two connected regions.
  const connect = (leaf: BspLeaf): void => {
    if (!leaf.left || !leaf.right) return;
    connect(leaf.left);
    connect(leaf.right);
    const a = roomCenter(leaf.left);
    const b = roomCenter(leaf.right);
    carveCorridor(a.x, a.y, b.x, b.y);
  };
  connect(root);

  // Ruined-hall pillars: rows of column tiles inside large rooms. Carved
  // AFTER corridors so a pillar can never sever a connection: single wall
  // tiles in ≥7-wide rooms always leave a walkable ring around themselves
  // (spacing 3, inset 2 from every room edge, room centers kept clear for
  // spawn/stairs/waystone placement).
  if (flavor.pillars) {
    for (const room of rooms) {
      if (room.w < 7 || room.h < 7 || rand() < 0.35) continue;
      const cx = room.x + Math.floor(room.w / 2);
      const cy = room.y + Math.floor(room.h / 2);
      for (let py = room.y + 2; py <= room.y + room.h - 3; py += 3) {
        for (let px = room.x + 2; px <= room.x + room.w - 3; px += 3) {
          if (Math.abs(px - cx) <= 1 && Math.abs(py - cy) <= 1) continue; // Center stays clear.
          if (rand() < 0.25) continue; // Some pillars have crumbled away.
          grid[py * width + px] = TILE_WALL;
        }
      }
    }
  }

  const first = rooms[0];
  const spawn = { x: first.x + Math.floor(first.w / 2), y: first.y + Math.floor(first.h / 2) };

  return { width, height, grid, rooms, spawn, seed };
}
