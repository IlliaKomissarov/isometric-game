/**
 * @module dev/cryptAudit
 * THE CRYPT'S GEOMETRY AUDIT (it.115). The owner's standing complaint is that
 * objects are not placed by their geometry: a prop standing in a wall, a torch
 * on nothing, a chest on a gold pile, a candelabra in a doorway. This checks a
 * built crypt floor against the rules the dressers are meant to follow, and
 * returns every breach as a line of text (empty = clean):
 *
 *   FLOOR PROPS    stand on an open tile of their own kind (a hearth on its
 *                  TILE_BLOCKED tile, everything else on TILE_FLOOR), never on
 *                  a wall or the map's edge.
 *   WALL PROPS     (torches) hang on a WALL tile, and the tile they face is open.
 *   FOOTPRINTS     no two props share a tile.
 *   DOORWAYS       no solid prop stands on, or orthogonally next to, a tile
 *                  where a corridor meets a room (the way in stays clear),
 *                  nor on the eight tiles around the stair.
 *   REACH          every walkable tile is reachable from the spawn (a solid
 *                  prop never cuts a room off), and so is every floor prop.
 *   WALL PIECES    a tall run's wall tiles are wall (an arch's opening is the
 *                  one open tile it may span); a near-wall stub's wall is wall.
 *
 * Pure and pixi-free: main runs it in DEV on every crypt build and puts the
 * result on `window.__cryptAudit`; a node script can run it on a bare map.
 */

import { TILE_BLOCKED, TILE_DOOR, TILE_FLOOR, TILE_WALL, planWallPieces, type DungeonMap, type TorchSpot } from '@/scenes/DungeonGenerator';

export interface AuditProp {
  kind: string;
  x: number;
  y: number;
  /** A solid prop (it has collision): it may not stand in a doorway. */
  solid?: boolean;
}

export interface CryptAuditResult {
  issues: string[];
  counts: { props: number; torches: number; pieces: number; stubs: number; pillars: number };
}

export function auditCrypt(map: DungeonMap, props: ReadonlyArray<AuditProp>, torches: ReadonlyArray<TorchSpot>): CryptAuditResult {
  const { width, height, grid, rooms } = map;
  const issues: string[] = [];
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const at = (x: number, y: number): number => (inside(x, y) ? grid[y * width + x] : TILE_WALL);
  const open = (x: number, y: number): boolean => at(x, y) !== TILE_WALL;
  // A shut quarry gate opens with its key: it counts as a way through.
  const walkable = (x: number, y: number): boolean => at(x, y) === TILE_FLOOR || at(x, y) === TILE_DOOR;

  // Room membership, to find the doorways (an in-room tile with an open
  // orthogonal neighbour outside every room).
  const inRoom = new Uint8Array(width * height);
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (inside(x, y)) inRoom[y * width + x] = 1;
  const doorway = (x: number, y: number): boolean => {
    if (!inside(x, y) || !inRoom[y * width + x] || !open(x, y)) return false;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    return n.some(([dx, dy]) => inside(x + dx, y + dy) && open(x + dx, y + dy) && !inRoom[(y + dy) * width + x + dx]);
  };

  // FLOOR PROPS and FOOTPRINTS.
  const taken = new Map<number, string>();
  for (const p of props) {
    const tag = `${p.kind}@${p.x},${p.y}`;
    const t = at(p.x, p.y);
    if (p.kind === 'hearth') {
      if (t !== TILE_BLOCKED) issues.push(`${tag}: a hearth off its blocked tile (tile ${t})`);
    } else if (t !== TILE_FLOOR) {
      issues.push(`${tag}: stands on a ${t === TILE_WALL ? 'WALL' : `non-floor (${t})`} tile`);
    }
    const key = p.y * width + p.x;
    const other = taken.get(key);
    if (other) issues.push(`${tag}: shares its tile with ${other}`);
    else taken.set(key, tag);
    if (p.solid) {
      if (doorway(p.x, p.y)) issues.push(`${tag}: stands IN a doorway`);
      else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => doorway(p.x + dx, p.y + dy))) issues.push(`${tag}: stands in front of a doorway`);
    }
  }

  // THE STAIR STANDS CLEAR: no solid prop on the eight tiles around it.
  for (const st of props) {
    if (st.kind !== 'stairs') continue;
    for (const p of props) {
      if (p === st || !p.solid) continue;
      if (Math.abs(p.x - st.x) <= 1 && Math.abs(p.y - st.y) <= 1) issues.push(`${p.kind}@${p.x},${p.y}: crowds the stair at ${st.x},${st.y}`);
    }
  }

  // WALL PROPS.
  for (const t of torches) {
    const tag = `torch(${t.side})@${t.x},${t.y}`;
    if (at(t.x, t.y) !== TILE_WALL) issues.push(`${tag}: hangs on an open tile`);
    const fx = t.side === 'n' ? t.x : t.x + 1;
    const fy = t.side === 'n' ? t.y + 1 : t.y;
    if (!open(fx, fy)) issues.push(`${tag}: faces a wall at ${fx},${fy}`);
    if (fx !== t.gx || fy !== t.gy) issues.push(`${tag}: lit from ${t.gx},${t.gy}, not the tile it faces`);
  }

  // REACH: a flood from the spawn over walkable tiles.
  const seen = new Uint8Array(width * height);
  const queue: number[] = [];
  if (walkable(map.spawn.x, map.spawn.y)) {
    seen[map.spawn.y * width + map.spawn.x] = 1;
    queue.push(map.spawn.y * width + map.spawn.x);
  } else {
    issues.push(`spawn@${map.spawn.x},${map.spawn.y}: not walkable`);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % width;
    const y = (i / width) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!walkable(nx, ny) || seen[ny * width + nx]) continue;
      seen[ny * width + nx] = 1;
      queue.push(ny * width + nx);
    }
  }
  let cut = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === TILE_FLOOR && !seen[i]) cut++;
  if (cut > 0) issues.push(`${cut} walkable tile(s) cannot be reached from the spawn`);
  for (const p of props) {
    if (p.kind === 'hearth' || p.solid) continue;
    if (inside(p.x, p.y) && !seen[p.y * width + p.x]) issues.push(`${p.kind}@${p.x},${p.y}: cannot be reached`);
  }

  // WALL PIECES.
  const plan = planWallPieces(map);
  for (const pc of plan.pieces) {
    const second = pc.side === 'n' ? { x: pc.x + 1, y: pc.y } : { x: pc.x, y: pc.y + 1 };
    const tag = `${pc.kind}(${pc.side})@${pc.x},${pc.y}`;
    if (pc.kind === 'wall' || pc.kind === 'corner') {
      if (open(pc.x, pc.y) || open(second.x, second.y)) issues.push(`${tag}: a wall run over an open tile`);
    } else if (open(second.x, second.y)) {
      issues.push(`${tag}: an ${pc.kind} whose pier stands on an open tile`);
    }
  }
  for (const st of plan.stubs) {
    const wx = st.side === 's' ? st.x : st.x + 1;
    const wy = st.side === 's' ? st.y + 1 : st.y;
    if (open(wx, wy)) issues.push(`stub(${st.side})@${st.x},${st.y}: its wall tile ${wx},${wy} is open`);
    if (!open(st.x, st.y)) issues.push(`stub(${st.side})@${st.x},${st.y}: closes a tile that is not open`);
  }

  return {
    issues,
    counts: { props: props.length, torches: torches.length, pieces: plan.pieces.length, stubs: plan.stubs.length, pillars: plan.pillars.length },
  };
}
