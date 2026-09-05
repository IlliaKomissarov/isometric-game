/**
 * @module core/StateManager
 * Authoritative, serializable game-state container.
 *
 * Owns everything the simulation needs to reproduce itself: tick counter,
 * dungeon seed, and the entity registry. Rendering state (sprites, cameras,
 * fog alpha) intentionally lives OUTSIDE this class — only deterministic
 * simulation data belongs here, so `snapshot()` fully captures a game moment
 * for co-op sync and save games.
 */

import type { Entity } from '@/entities/Entity';
import type { GameSnapshot } from '@/network/Serialization';

export class StateManager {
  /** Current simulation tick (mirrors GameLoop.tick after each update). */
  tick = 0;

  /** Seed used to generate the current dungeon — peers regenerate from it. */
  dungeonSeed = 0;

  private readonly entities = new Map<number, Entity>();
  private nextEntityId = 1;

  /**
   * THE ID COUNTER (it.73). Entity ids are the one thing a command may name
   * across the wire (a target), so a peer joining from a snapshot must hand
   * out the SAME ids for the floor's foes the leader did: it sets the
   * counter to where the leader's stood when that floor was built.
   */
  get nextId(): number {
    return this.nextEntityId;
  }
  set nextId(v: number) {
    this.nextEntityId = Math.max(this.nextEntityId, v);
  }

  /** Register an entity and assign its deterministic id. */
  register(entity: Entity): number {
    const id = this.nextEntityId++;
    entity.id = id;
    this.entities.set(id, entity);
    return id;
  }

  unregister(id: number): void {
    this.entities.delete(id);
  }

  getEntity(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  /** Iterate all live entities (stable insertion order = deterministic). */
  forEach(fn: (entity: Entity) => void): void {
    for (const entity of this.entities.values()) fn(entity);
  }

  /** Capture a full serializable snapshot of simulation state. */
  snapshot(): GameSnapshot {
    const entities = [];
    for (const entity of this.entities.values()) {
      entities.push(entity.serialize());
    }
    return {
      tick: this.tick,
      dungeonSeed: this.dungeonSeed,
      entities,
      exploredFog: [], // Packed by FogOfWar when the sync sub-task lands.
    };
  }

  /** Wipe all entities (scene transition / restart). */
  clear(): void {
    this.entities.clear();
    this.nextEntityId = 1;
    this.tick = 0;
  }
}

export const state = new StateManager();
