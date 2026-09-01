/**
 * @module systems/Pathfinding
 * A* grid pathfinding with a binary min-heap and typed-array node storage.
 *
 * 8-directional movement with strict no-corner-cutting: a diagonal step is
 * legal only when BOTH adjacent orthogonal tiles are walkable, so entities
 * with a collision radius never clip wall corners. Octile-distance heuristic
 * (admissible for 1 / √2 step costs) keeps paths natural.
 *
 * All per-search storage is preallocated and reused between calls — zero
 * garbage on the hot path. See /docs/skills/astar-binary-heap.md.
 */

const SQRT2 = Math.SQRT2;

export class Pathfinder {
  private readonly width: number;
  private readonly gScore: Float64Array;
  private readonly fScore: Float64Array;
  private readonly cameFrom: Int32Array;
  /** Search stamp per node — avoids clearing arrays between searches. */
  private readonly visited: Int32Array;
  private stamp = 0;

  // Binary min-heap over node indices, ordered by fScore.
  private readonly heap: Int32Array;
  private heapSize = 0;

  constructor(
    width: number,
    height: number,
    private readonly isWalkable: (gx: number, gy: number) => boolean,
  ) {
    this.width = width;
    const n = width * height;
    this.gScore = new Float64Array(n);
    this.fScore = new Float64Array(n);
    this.cameFrom = new Int32Array(n);
    this.visited = new Int32Array(n);
    this.heap = new Int32Array(n);
  }

  /**
   * Find a path between tiles. Returns waypoints (tile coords) EXCLUDING the
   * start tile, or null when unreachable. Start/goal outside walkable space
   * fail fast.
   */
  findPath(sx: number, sy: number, tx: number, ty: number): Array<{ x: number; y: number }> | null {
    if (!this.isWalkable(sx, sy) || !this.isWalkable(tx, ty)) return null;
    if (sx === tx && sy === ty) return [];

    const w = this.width;
    const start = sy * w + sx;
    const goal = ty * w + tx;
    this.stamp++;
    this.heapSize = 0;

    this.gScore[start] = 0;
    this.fScore[start] = this.octile(sx, sy, tx, ty);
    this.cameFrom[start] = -1;
    this.visited[start] = this.stamp;
    this.heapPush(start);

    while (this.heapSize > 0) {
      const current = this.heapPop();
      if (current === goal) return this.reconstruct(goal);

      const cx = current % w;
      const cy = (current / w) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.isWalkable(nx, ny)) continue;
          // No corner cutting on diagonals.
          if (dx !== 0 && dy !== 0 && (!this.isWalkable(cx + dx, cy) || !this.isWalkable(cx, cy + dy))) {
            continue;
          }
          const neighbor = ny * w + nx;
          const stepCost = dx !== 0 && dy !== 0 ? SQRT2 : 1;
          const tentativeG = this.gScore[current] + stepCost;

          if (this.visited[neighbor] !== this.stamp || tentativeG < this.gScore[neighbor]) {
            this.visited[neighbor] = this.stamp;
            this.gScore[neighbor] = tentativeG;
            this.fScore[neighbor] = tentativeG + this.octile(nx, ny, tx, ty);
            this.cameFrom[neighbor] = current;
            // On re-discovery the node may already sit in the heap with a
            // stale key; pushing a duplicate is cheaper than decrease-key
            // and remains correct (stale entries pop later and re-expand
            // to no effect).
            this.heapPush(neighbor);
          }
        }
      }
    }
    return null;
  }

  private octile(x0: number, y0: number, x1: number, y1: number): number {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
  }

  private reconstruct(goal: number): Array<{ x: number; y: number }> {
    const w = this.width;
    const path: Array<{ x: number; y: number }> = [];
    let node = goal;
    while (node !== -1 && this.cameFrom[node] !== -1) {
      path.push({ x: node % w, y: (node / w) | 0 });
      node = this.cameFrom[node];
    }
    path.reverse();
    return path;
  }

  // ---- Binary min-heap (index heap keyed by fScore) ----

  private heapPush(node: number): void {
    // Guard: duplicates can briefly exceed n on pathological maps; grow-free
    // design relies on the heap array being map-sized, so drop overflow
    // duplicates (the fresher entry is already ordered correctly).
    if (this.heapSize >= this.heap.length) return;
    let i = this.heapSize++;
    this.heap[i] = node;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.fScore[this.heap[parent]] <= this.fScore[this.heap[i]]) break;
      const tmp = this.heap[parent];
      this.heap[parent] = this.heap[i];
      this.heap[i] = tmp;
      i = parent;
    }
  }

  private heapPop(): number {
    const top = this.heap[0];
    this.heapSize--;
    if (this.heapSize > 0) {
      this.heap[0] = this.heap[this.heapSize];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.heapSize && this.fScore[this.heap[l]] < this.fScore[this.heap[smallest]]) smallest = l;
        if (r < this.heapSize && this.fScore[this.heap[r]] < this.fScore[this.heap[smallest]]) smallest = r;
        if (smallest === i) break;
        const tmp = this.heap[smallest];
        this.heap[smallest] = this.heap[i];
        this.heap[i] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}
