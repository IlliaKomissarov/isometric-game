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
  | { type: 'SKILL'; playerId: number; slot: number }
  | { type: 'UNLOCK_SKILL'; playerId: number; id: string }
  | { type: 'UNLOCK_PASSIVE'; playerId: number; id: string }
  | { type: 'EQUIP_SKILL'; playerId: number; slot: number; id: string | null }
  /** Consumables (it.39): drink/read the backpack item; Q = quickest healing potion. */
  | { type: 'USE_ITEM'; playerId: number; backpackIndex: number }
  | { type: 'USE_QUICK'; playerId: number; kind: 'health' | 'mana' }
  | { type: 'TOWN_PORTAL'; playerId: number }
  /** Town economy (it.39). */
  | { type: 'BUY'; playerId: number; index: number; vendor?: 'armorer' | 'alchemist' }
  /** Respec (it.48): refund every learned skill and passive — town only. */
  | { type: 'RESET_SKILLS'; playerId: number }
  | { type: 'SELL'; playerId: number; backpackIndex: number }
  | { type: 'BUYBACK'; playerId: number; index: number }
  | { type: 'STASH_PUT'; playerId: number; backpackIndex: number }
  | { type: 'STASH_TAKE'; playerId: number; index: number }
  | { type: 'STASH_GOLD'; playerId: number; amount: number }
  /** CO-OP (it.59): where this player is aiming (world point) — swings and casts follow it on every peer. */
  | { type: 'AIM'; playerId: number; x: number; y: number }
  /** CO-OP (it.59): a floor change decided by the PARTY LEADER (solo: always honoured). */
  | { type: 'WARP'; playerId: number; to: 'coliseum' | 'town' | 'floor' | 'crown' | 'portalBack'; n?: number }
  /** CO-OP (it.59): the leader's frame says this hero left the party. */
  | { type: 'LEAVE'; playerId: number }
  /** CO-OP (it.60): a hero joins mid-run — every peer seats them on this tick. */
  | { type: 'JOIN'; playerId: number; name: string; cls: import('@/network/Serialization').ClassArchetype; hero: import('@/persist/SaveGame').PlayerSave | null };

export class InputQueue {
  private queue: InputCommand[] = [];
  /**
   * CO-OP (it.59): every locally produced command is stamped with this seat
   * before it enters the stream, so the HUD panels (which write playerId 0)
   * never need to know which seat the local hero holds.
   */
  stamp = 0;

  /** Enqueue a command from local input (or, later, from the network layer). */
  enqueue(cmd: InputCommand): void {
    this.queue.push(cmd.playerId === this.stamp ? cmd : { ...cmd, playerId: this.stamp });
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
