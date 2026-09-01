/**
 * @module core/InputQueue
 * Deterministic input command queue.
 *
 * Raw browser events (pointer, keyboard) are translated into serializable
 * `InputCommand` objects and queued. The simulation drains the queue exactly
 * once per fixed tick, so identical command streams always reproduce identical
 * game states — the foundation for 4-player co-op synchronization, where remote
 * players' commands will be injected into the same queue with a `playerId`.
 *
 * SUB-AGENT BOUNDARY: add new command variants to `InputCommand` and handle
 * them in the consuming system. Never bypass the queue by mutating entity
 * state directly from a DOM event handler.
 */

import type { EquipmentSlot } from '@/network/Serialization';

/** All player intents. Must stay JSON-serializable for network transport. */
export type InputCommand =
  | { type: 'MOVE_TO'; playerId: number; gx: number; gy: number }
  | { type: 'DIRECT_MOVE'; playerId: number; dx: number; dy: number }
  | { type: 'STOP'; playerId: number }
  | { type: 'ATTACK'; playerId: number; targetId: number }
  /** Action-button combat (BG:DA style): held swings auto-target nearby foes. */
  | { type: 'ATTACK_DOWN'; playerId: number }
  | { type: 'ATTACK_UP'; playerId: number }
  | { type: 'PICKUP'; playerId: number; itemUid: number }
  /** Action-button interaction: grab the nearest visible ground item. */
  | { type: 'PICKUP_NEAREST'; playerId: number }
  /** Walk to and open a lootable chest. */
  | { type: 'OPEN_CHEST'; playerId: number; chestId: number }
  | { type: 'EQUIP'; playerId: number; backpackIndex: number }
  | { type: 'UNEQUIP'; playerId: number; slot: EquipmentSlot }
  /** Active skill hotkeys 1–4 (it.32): cast the class skill in `slot`. */
  | { type: 'SKILL'; playerId: number; slot: number };

export class InputQueue {
  private queue: InputCommand[] = [];

  /** Enqueue a command from local input (or, later, from the network layer). */
  enqueue(cmd: InputCommand): void {
    this.queue.push(cmd);
  }

  /**
   * Drain all pending commands for consumption by this simulation tick.
   * Returns commands in arrival order; the internal queue is reset.
   */
  drain(): InputCommand[] {
    if (this.queue.length === 0) return this.queue;
    const drained = this.queue;
    this.queue = [];
    return drained;
  }

  clear(): void {
    this.queue.length = 0;
  }
}
