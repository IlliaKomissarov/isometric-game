/**
 * @module entities/EnemyPool
 * Pooled enemy lifecycle: typed spawns, mutual separation, floor teardown.
 *
 * `entity:died` is emitted by CombatSystem (the sole hp mutator); the pool
 * only reclaims bodies (after the death animation, via the AI dep
 * `onDeathComplete`) and never re-emits events.
 */

import { state } from '@/core/StateManager';
import type { Viewport } from '@/engine/Viewport';
import { canStandAt } from '@/systems/Collision';
import { ObjectPool } from '@/utils/ObjectPool';
import { Enemy, type EnemyAIDeps, type EnemyKind } from './Enemy';

/** Minimum spacing between enemy bodies (and from the player, enforced in AI). */
const SEPARATION = 0.55;

export class EnemyPool {
  private readonly pool: ObjectPool<Enemy>;
  private readonly active = new Set<Enemy>();
  private readonly created = new Set<Enemy>();

  constructor(
    viewport: Viewport,
    aiDeps: EnemyAIDeps,
    private readonly isWalkable: (gx: number, gy: number) => boolean,
    preallocate = 12,
  ) {
    this.pool = new ObjectPool<Enemy>(
      () => {
        const enemy = new Enemy(aiDeps);
        state.register(enemy);
        this.created.add(enemy);
        viewport.objectLayer.addChild(enemy.container);
        return enemy;
      },
      (enemy) => enemy.despawn(),
      preallocate,
    );
  }

  spawn(kind: EnemyKind, x: number, y: number, floor: number): Enemy {
    const enemy = this.pool.acquire();
    enemy.spawn(kind, x, y, floor);
    this.active.add(enemy);
    return enemy;
  }

  /** Reclaim a body once its death animation completed. */
  kill(enemy: Enemy): void {
    if (!this.active.delete(enemy)) return;
    this.pool.release(enemy);
  }

  /**
   * Pairwise separation so crowding enemies never stack on one tile.
   * O(n²) over live bodies (n ≤ ~16) — run once per tick after updates.
   */
  /** Spatial hash buckets, reused every tick (it.74): one tile per cell. */
  private readonly cells = new Map<number, Enemy[]>();
  private readonly cellKeys: number[] = [];

  /**
   * SEPARATION BY SPATIAL HASH (it.74). The pairwise scan copied the active
   * set into an array and tested every pair every tick — 780 pairs for a
   * 40-foe floor, most of them rooms apart. Foes are hashed into one-tile
   * cells; a foe only meets the foes in its own and the eight neighbouring
   * cells, and a pair is resolved once (by id order). No allocation on the
   * hot path: the bucket arrays are kept and emptied.
   */
  separate(): void {
    const cells = this.cells;
    for (const k of this.cellKeys) {
      const bucket = cells.get(k);
      if (bucket) bucket.length = 0;
    }
    this.cellKeys.length = 0;
    for (const e of this.active) {
      if (e.hp <= 0) continue;
      const key = (Math.floor(e.pos.y) + 64) * 4096 + (Math.floor(e.pos.x) + 64);
      let bucket = cells.get(key);
      if (!bucket) {
        bucket = [];
        cells.set(key, bucket);
      }
      if (bucket.length === 0) this.cellKeys.push(key);
      bucket.push(e);
    }
    for (const a of this.active) {
      if (a.hp <= 0) continue;
      const cx = Math.floor(a.pos.x) + 64;
      const cy = Math.floor(a.pos.y) + 64;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const bucket = cells.get((cy + oy) * 4096 + (cx + ox));
          if (!bucket) continue;
          for (let j = 0; j < bucket.length; j++) {
            const b = bucket[j];
            if (b === a || b.id < a.id || b.hp <= 0) continue;
            this.resolvePair(a, b);
          }
        }
      }
    }
  }

  private resolvePair(a: Enemy, b: Enemy): void {
    {
      {
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= SEPARATION || dist < 1e-6) return;
        const push = (SEPARATION - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        const ax = a.pos.x - nx * push;
        const ay = a.pos.y - ny * push;
        const bx = b.pos.x + nx * push;
        const by = b.pos.y + ny * push;
        // Radius-aware checks (it.14): tile-center tests let separation
        // shove a collider's EDGE into a wall corner — the wall-clipping bug.
        if (canStandAt(ax, ay, this.isWalkable)) {
          a.pos.x = ax;
          a.pos.y = ay;
        }
        if (canStandAt(bx, by, this.isWalkable)) {
          b.pos.x = bx;
          b.pos.y = by;
        }
      }
    }
  }

  forEachActive(fn: (enemy: Enemy) => void): void {
    for (const enemy of this.active) fn(enemy);
  }

  /** Full teardown for a floor transition: unregister + destroy every body. */
  destroyAll(): void {
    for (const enemy of this.created) {
      state.unregister(enemy.id);
      enemy.destroy();
    }
    this.created.clear();
    this.active.clear();
    this.pool.drain();
  }
}
