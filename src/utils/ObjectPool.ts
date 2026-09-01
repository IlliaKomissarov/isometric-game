/**
 * @module utils/ObjectPool
 * Generic object pool for zero-GC-pressure entity and effect reuse.
 *
 * Hot-path allocations (projectiles, damage numbers, path nodes) must come
 * from a pool. `reset` is invoked on release so stale state never leaks into
 * the next acquisition.
 */

export class ObjectPool<T> {
  private readonly free: T[] = [];
  private _liveCount = 0;

  /**
   * @param factory Creates a fresh instance when the pool is empty.
   * @param reset   Restores an instance to a pristine state on release.
   * @param preallocate Number of instances to create up front.
   */
  constructor(
    private readonly factory: () => T,
    private readonly reset: (item: T) => void,
    preallocate = 0,
  ) {
    for (let i = 0; i < preallocate; i++) {
      this.free.push(this.factory());
    }
  }

  /** Number of instances currently checked out. */
  get liveCount(): number {
    return this._liveCount;
  }

  acquire(): T {
    this._liveCount++;
    return this.free.pop() ?? this.factory();
  }

  release(item: T): void {
    this.reset(item);
    this.free.push(item);
    this._liveCount = Math.max(0, this._liveCount - 1);
  }

  /** Drop all pooled instances (scene teardown / memory cleanup). */
  drain(): void {
    this.free.length = 0;
    this._liveCount = 0;
  }
}
