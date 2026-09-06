/**
 * @module scenes/Mines
 * THE QUARRY MINES (it.85): one floor, three to five crypts long, under the
 * dark forest east of the town. The map is the crypt generator's at a
 * larger size; this module lays the rest over it:
 *
 *   THE LOCKED GATES. The way from the entrance to the deepest hall is
 *   walked once (breadth-first), and along it the corridor tiles that are
 *   ARTICULATION POINTS — remove the tile and the hall is cut off — become
 *   iron gates (TILE_DOOR: solid and opaque until opened). Up to three,
 *   spread along the way.
 *   THE KEYS. Each gate's key lies in a side room the hero can reach
 *   WITHOUT passing that gate (the component on the entrance's side with
 *   the gate shut), as far from the way as the rooms allow — a dead end,
 *   never the path itself. Keys are ground items; the minimap marks a key
 *   or a gate only once its tile has been explored.
 *   THE DEEPEST HALL holds the mini-boss. When it falls the way home opens
 *   there: a teleporter to town.
 *   THE DRESSING: pit props (supports, kegs, crates, rocks, jars), each
 *   placed only where it seals nothing, and torches on the room walls.
 *
 * Pure and seeded: every peer, and a reload, builds the same quarry.
 */

import { CLUTTER_KINDS, type TownProp } from '@/town/TownMap';
import { mulberry32 } from '@/utils/rng';
import { TILE_BLOCKED, TILE_DOOR, TILE_FLOOR, type DungeonMap, type Room } from './DungeonGenerator';

export interface MineDoor {
  x: number;
  y: number;
  /** Which key opens it (1-based). */
  key: number;
  open: boolean;
  /** Every tile the gate spans (a two-wide corridor takes two bars). */
  tiles: Array<{ x: number; y: number }>;
  /** Which way the corridor runs through the gate: the bars stand across it. */
  axis: 'x' | 'y';
}

export interface MineKey {
  x: number;
  y: number;
  key: number;
  /** The ground item's uid once spawned (-1 until then). */
  uid: number;
}

export interface MinesPlan {
  doors: MineDoor[];
  keys: MineKey[];
  bossRoom: Room;
  boss: { x: number; y: number };
  props: TownProp[];
  /** How many gate sites the way offered (a dev figure). */
  candidates: number;
  pathLength: number;
}

export const MINES_W = 104;
export const MINES_H = 88;
export const MAX_DOORS = 3;

const inRoom = (r: Room, x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** Breadth-first distances over walkable tiles; `passDoors` treats gates as open. */
function bfs(map: DungeonMap, sx: number, sy: number, passDoors: boolean, blocked?: ReadonlySet<number>): { dist: Int32Array; parent: Int32Array } {
  const { width, height, grid } = map;
  const dist = new Int32Array(width * height).fill(-1);
  const parent = new Int32Array(width * height).fill(-1);
  const start = sy * width + sx;
  dist[start] = 0;
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (blocked && blocked.has(j)) continue;
      if (dist[j] !== -1) continue;
      const t = grid[j];
      if (t !== TILE_FLOOR && !(passDoors && t === TILE_DOOR)) continue;
      dist[j] = dist[i] + 1;
      parent[j] = i;
      queue.push(j);
    }
  }
  return { dist, parent };
}

export function planMines(map: DungeonMap, seed: number): MinesPlan {
  const { width, height, grid, rooms, spawn } = map;
  const rand = mulberry32((seed ^ 0x51ab1e) >>> 0);
  const idx = (x: number, y: number): number => y * width + x;
  const centre = (r: Room): { x: number; y: number } => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });
  /** The nearest floor tile to a room's centre (a pillar may sit on it). */
  const floorNear = (r: Room): { x: number; y: number } => {
    const c = centre(r);
    for (let ring = 0; ring < 4; ring++)
      for (let dy = -ring; dy <= ring; dy++)
        for (let dx = -ring; dx <= ring; dx++) {
          const x = c.x + dx;
          const y = c.y + dy;
          if (inRoom(r, x, y) && grid[idx(x, y)] === TILE_FLOOR) return { x, y };
        }
    return c;
  };

  // ---- THE DEEPEST HALL: the room farthest (by walking) from the entrance ----
  const base = bfs(map, spawn.x, spawn.y, true);
  let bossRoom = rooms[rooms.length - 1];
  let bestD = -1;
  for (let i = 1; i < rooms.length; i++) {
    const c = floorNear(rooms[i]);
    const d = base.dist[idx(c.x, c.y)];
    if (d > bestD) {
      bestD = d;
      bossRoom = rooms[i];
    }
  }
  const boss = floorNear(bossRoom);

  // ---- THE WAY: the walked path from the entrance to the hall ----
  const path: number[] = [];
  for (let i = idx(boss.x, boss.y); i !== -1 && i !== idx(spawn.x, spawn.y); i = base.parent[i]) path.push(i);
  path.reverse();

  // ---- THE GATES: corridor articulation points along the way ----
  const isCorridor = (x: number, y: number): boolean => !rooms.some((r) => inRoom(r, x, y));
  const narrow = (x: number, y: number): boolean => {
    const wall = (ax: number, ay: number): boolean => ax < 0 || ay < 0 || ax >= width || ay >= height || grid[idx(ax, ay)] !== TILE_FLOOR;
    return (wall(x - 1, y) && wall(x + 1, y)) || (wall(x, y - 1) && wall(x, y + 1));
  };
  /** The corridor's cross-section at a path tile: the tile and its floor neighbours across the way. */
  const axisAt = (k: number): 'x' | 'y' => {
    const prev = path[k - 1];
    const next = path[k + 1];
    return Math.abs((prev % width) - (next % width)) >= Math.abs(Math.floor(prev / width) - Math.floor(next / width)) ? 'x' : 'y';
  };
  const crossSection = (k: number): Array<{ x: number; y: number }> => {
    const i = path[k];
    const x = i % width;
    const y = (i - x) / width;
    const along = axisAt(k);
    const out = [{ x, y }];
    const side = along === 'x' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
    for (const [dx, dy] of side) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (grid[idx(nx, ny)] === TILE_FLOOR && isCorridor(nx, ny)) out.push({ x: nx, y: ny });
    }
    return out;
  };
  const cuts = (tiles: Array<{ x: number; y: number }>): boolean => bfs(map, spawn.x, spawn.y, true, new Set(tiles.map((t) => idx(t.x, t.y)))).dist[idx(boss.x, boss.y)] === -1;
  const candidates: number[] = [];
  const sections = new Map<number, Array<{ x: number; y: number }>>();
  for (let k = 4; k < path.length - 4; k++) {
    const i = path[k];
    const x = i % width;
    const y = (i - x) / width;
    if (!isCorridor(x, y)) continue;
    const sec = narrow(x, y) ? [{ x, y }] : crossSection(k);
    if (sec.length > 3) continue;
    if (cuts(sec)) {
      candidates.push(k);
      sections.set(k, sec);
    }
  }
  const doors: MineDoor[] = [];
  const wanted = Math.min(MAX_DOORS, candidates.length);
  const targets = wanted === 1 ? [0.55] : wanted === 2 ? [0.4, 0.75] : [0.3, 0.55, 0.8];
  for (let n = 0; n < wanted; n++) {
    const goal = Math.round(targets[n] * path.length);
    let best = -1;
    let bestGap = Infinity;
    for (const k of candidates) {
      if (doors.some((d) => Math.abs(path.indexOf(idx(d.x, d.y)) - k) < 8)) continue;
      const gap = Math.abs(k - goal);
      if (gap < bestGap) {
        bestGap = gap;
        best = k;
      }
    }
    if (best < 0) break;
    const i = path[best];
    doors.push({ x: i % width, y: Math.floor(i / width), key: 0, open: false, tiles: sections.get(best) ?? [{ x: i % width, y: Math.floor(i / width) }], axis: axisAt(best) });
  }
  doors.sort((a, b) => path.indexOf(idx(a.x, a.y)) - path.indexOf(idx(b.x, b.y)));
  doors.forEach((d, i) => {
    d.key = i + 1;
  });

  // ---- THE KEYS: a side room on the near side of each gate ----
  const keys: MineKey[] = [];
  const used = new Set<Room>([rooms[0], bossRoom]);
  const onPath = new Set(path);
  for (const door of doors) {
    // With this gate (and every later one) shut, what can the hero reach?
    for (const d of doors) for (const t of d.tiles) grid[idx(t.x, t.y)] = d.key >= door.key ? TILE_DOOR : TILE_FLOOR;
    const reach = bfs(map, spawn.x, spawn.y, false);
    const fromGate = bfs(map, door.x, door.y, true);
    let bestRoom: Room | null = null;
    let bestScore = -1;
    for (const r of rooms) {
      if (used.has(r)) continue;
      const c = floorNear(r);
      if (reach.dist[idx(c.x, c.y)] === -1) continue;
      // Off the way scores double; farther from the gate scores higher.
      const score = fromGate.dist[idx(c.x, c.y)] * (onPath.has(idx(c.x, c.y)) ? 1 : 2) + rand() * 3;
      if (score > bestScore) {
        bestScore = score;
        bestRoom = r;
      }
    }
    if (!bestRoom) {
      // No side room: the key lies in the corridor before the gate.
      const i = path[Math.max(0, path.indexOf(idx(door.x, door.y)) - 4)];
      keys.push({ x: i % width, y: Math.floor(i / width), key: door.key, uid: -1 });
      continue;
    }
    used.add(bestRoom);
    // A corner of the room, not its middle: the key is hidden, not served.
    const corners = [
      { x: bestRoom.x, y: bestRoom.y },
      { x: bestRoom.x + bestRoom.w - 1, y: bestRoom.y },
      { x: bestRoom.x, y: bestRoom.y + bestRoom.h - 1 },
      { x: bestRoom.x + bestRoom.w - 1, y: bestRoom.y + bestRoom.h - 1 },
    ].filter((c) => grid[idx(c.x, c.y)] === TILE_FLOOR && reach.dist[idx(c.x, c.y)] !== -1);
    const spot = corners.length ? corners[Math.floor(rand() * corners.length)] : floorNear(bestRoom);
    keys.push({ x: spot.x, y: spot.y, key: door.key, uid: -1 });
  }
  // Every gate shut for the hero's arrival.
  for (const d of doors) for (const t of d.tiles) grid[idx(t.x, t.y)] = TILE_DOOR;

  // ---- THE DRESSING: pit props that seal nothing ----
  const props: TownProp[] = [];
  const reserved = new Set<number>([idx(spawn.x, spawn.y), idx(boss.x, boss.y), ...keys.map((k) => idx(k.x, k.y)), ...doors.flatMap((d) => d.tiles.map((t) => idx(t.x, t.y)))]);
  const reaches = (): boolean => {
    const r = bfs(map, spawn.x, spawn.y, true).dist;
    if (r[idx(boss.x, boss.y)] === -1) return false;
    return keys.every((k) => r[idx(k.x, k.y)] !== -1);
  };
  const tryProp = (p: TownProp): void => {
    const i = idx(p.x, p.y);
    if (grid[i] !== TILE_FLOOR || reserved.has(i)) return;
    // Never beside a gate or in a corridor: rooms only.
    if (isCorridor(p.x, p.y)) return;
    if (doors.some((d) => Math.abs(d.x - p.x) + Math.abs(d.y - p.y) <= 2)) return;
    if (CLUTTER_KINDS.has(p.kind)) {
      props.push(p); // Small clutter is drawn on an open tile (it.88).
      reserved.add(i);
      return;
    }
    grid[i] = TILE_BLOCKED;
    if (!reaches()) {
      grid[i] = TILE_FLOOR;
      return;
    }
    props.push(p);
    reserved.add(i);
  };
  const pit: Array<[TownProp['kind'], string | undefined]> = [
    ['supports', undefined],
    ['wood_pile', undefined],
    ['crates', undefined],
    ['barrel', 'barrel_c'],
    ['barrel', 'barrel_d'],
    ['jar', 'jar_a'],
    ['box', 'box_b'],
    ['rock', 'rock_b'],
    ['rock', 'rock_d'],
    ['barrels_stacked', undefined],
    ['crates_wood', undefined],
  ];
  for (let ri = 1; ri < rooms.length; ri++) {
    const r = rooms[ri];
    if (r === bossRoom) continue;
    const n = 1 + Math.floor(rand() * Math.min(4, Math.max(1, Math.floor((r.w * r.h) / 14))));
    for (let k = 0; k < n; k++) {
      const [kind, variant] = pit[Math.floor(rand() * pit.length)];
      const x = r.x + Math.floor(rand() * r.w);
      const y = r.y + Math.floor(rand() * r.h);
      tryProp({ kind, x, y, variant });
    }
    // A torch on the room's north wall, most rooms.
    if (rand() < 0.7) {
      const tx = r.x + Math.floor(rand() * r.w);
      const ty = r.y;
      tryProp({ kind: 'torch', x: tx, y: ty });
    }
  }
  // The hall of the boss is lit and bare.
  for (const [dx, dy] of [[1, 1], [bossRoom.w - 2, 1], [1, bossRoom.h - 2], [bossRoom.w - 2, bossRoom.h - 2]] as const) {
    tryProp({ kind: 'lamp', x: bossRoom.x + dx, y: bossRoom.y + dy });
  }
  // The gates themselves, drawn by the dressing.
  // The gate sprite is a wall piece running along x (its door faces south-west,
  // +y). Bars must stand ACROSS the corridor: a corridor running along x
  // needs the piece mirrored so it spans y; a corridor along y takes it as is (it.87).
  for (const d of doors) for (const t of d.tiles) props.push({ kind: 'gate', x: t.x, y: t.y, variant: 'gate_closed', flip: d.axis === 'x' });

  return { doors, keys, bossRoom, boss, props, candidates: candidates.length, pathLength: path.length };
}
