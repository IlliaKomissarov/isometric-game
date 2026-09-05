/**
 * @module core/EventBus
 * Strongly-typed publish/subscribe event bus.
 *
 * All cross-module communication flows through this bus so systems stay
 * decoupled — a sub-agent adding a feature (e.g. a sound trigger on
 * `entity:damaged`) subscribes here and never touches the emitting system.
 */

/** Central registry of every event and its payload type. Extend here only. */
export interface GameEvents {
  /** Player switched between click-to-move and direct (WASD) control. */
  'input:modeChanged': { mode: 'path' | 'direct'; playerId: number };
  /** A path was computed and the player started following it. */
  'player:pathStarted': { path: ReadonlyArray<{ x: number; y: number }> };
  /** Player entered a new grid tile (drives fog-of-war recomputation). */
  'player:tileChanged': { gx: number; gy: number; playerId: number };
  /** A strike frame resolved (feedback: slash arc color, whiff, audio, VFX). */
  'combat:swing': { sourceId: number; targetId: number; result: 'hit' | 'crit' | 'miss' };
  /** An entity took damage (drives hit flash, health bars, orb UI, blood).
   *  dirX/dirY: unit direction the blow traveled (splatter spray axis). */
  'entity:damaged': { entityId: number; amount: number; dirX?: number; dirY?: number };
  /** Vampiric champions drink (it.53). */
  'entity:healed': { entityId: number; amount: number };
  /** An entity died and was released back to its pool. */
  'entity:died': { entityId: number };
  /** An idle enemy noticed the player (growl audio / alert feedback). */
  'enemy:aggro': { entityId: number };
  /** A multi-phase boss entered a new phase (2 = quicken, 3 = model swap). */
  'boss:phase': { entityId: number; phase: number };
  /** A projectile terminated (wall, range, or flesh) — spark/dust VFX hook. */
  'projectile:impact': { x: number; y: number; kind: 'arrow' | 'bolt' | 'fireball'; hitFlesh: boolean };
  /** A ground item appeared (loot roll succeeded). */
  'item:dropped': { uid: number; itemId: string; x: number; y: number };
  /** The player reached a chest they ordered opened. */
  'chest:reached': { chestId: number; playerId: number };
  /** A chest spilled its loot (glint VFX + audio hook). */
  'chest:opened': { chestId: number; x: number; y: number };
  /** The player walked into pickup range of their targeted ground item. */
  'item:pickupArrived': { uid: number; playerId: number };
  /** An item left the ground and entered an inventory. */
  'item:pickedUp': { uid: number; itemId: string };
  /** Backpack or equipment changed — UI should re-render. */
  'inventory:changed': Record<string, never>;
  /** Simulation tick completed (deterministic hook for state sync). */
  'sim:tick': { tick: number };
  /** Town (it.39): stock/stash changed, a trade happened, a trade was refused. */
  'town:changed': Record<string, never>;
  'town:traded': { kind: 'buy' | 'sell'; itemId: string; gold: number };
  'town:refused': { reason: 'gold' | 'stashFull' };
  /** A creature was first seen or slain (it.42 bestiary). */
  'bestiary:changed': Record<string, never>;
  /** Skill points spent / hotbar changed (it.41). */
  'skills:changed': Record<string, never>;
  /** A consumable was used (potion drunk, scroll read). */
  'item:used': { itemId: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private readonly handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  /** Unsubscribe a previously registered handler. */
  off<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  /** Emit an event synchronously to all subscribers. */
  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as Handler<GameEvents[K]>)(payload);
    }
  }

  /** Remove every subscription (scene teardown / memory cleanup). */
  clear(): void {
    this.handlers.clear();
  }
}

/** Shared singleton bus. Systems may also receive a bus via constructor for testability. */
export const eventBus = new EventBus();
