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
    map.grid[idx] = TILE_BLOCKED;
    hearths.push(c);
  }
  return hearths;
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
