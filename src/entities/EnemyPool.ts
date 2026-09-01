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
  separate(): void {
    const list = [...this.active];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.hp <= 0) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.hp <= 0) continue;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= SEPARATION || dist < 1e-6) continue;
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
