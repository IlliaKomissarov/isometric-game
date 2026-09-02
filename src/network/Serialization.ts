/**
 * @module network/Serialization
 * Serialization contracts for future 4-player co-op synchronization.
 *
 * ARCHITECTURE: the game uses a deterministic lockstep-ready model —
 * simulation state is a pure function of (initial seed + ordered command
 * stream). The network layer will therefore ship `CommandEnvelope`s, not
 * entity positions, with periodic `GameSnapshot`s for late-join and drift
 * correction. Everything here must remain structured-clone / JSON safe:
 * no class instances, no functions, no Pixi objects.
 */

import type { InputCommand } from '@/core/InputQueue';

/** Objects that can round-trip through the network/save layer. */
export interface ISerializable<TSnapshot> {
  serialize(): TSnapshot;
  deserialize(snapshot: TSnapshot): void;
}

/** Player class archetypes for the 4-player co-op roster. */
export type ClassArchetype = 'warrior' | 'mage' | 'ranger' | 'rogue';

/** Paperdoll equipment slots — mirrors the visual layer stack on the model. */
export type EquipmentSlot = 'head' | 'torso' | 'legs' | 'mainHand' | 'offHand' | 'cloak' | 'ring';

/** Minimal wire representation of an equipped item. */
export interface ItemSnapshot {
  itemId: string;
  slot: EquipmentSlot;
}

/** Wire representation of any live entity. */
export interface EntitySnapshot {
  id: number;
  kind: 'player' | 'enemy';
  /** Continuous world position (tile units). */
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  /** Player-only fields. */
  archetype?: ClassArchetype;
  equipment?: ItemSnapshot[];
  /** Unequipped item ids carried by a player. */
  backpack?: string[];
  /** Enemy-only: current AI behavior state (simulation-relevant). */
  aiState?: 'idle' | 'chase' | 'flee';
  /** Enemy-only: archetype id. */
  enemyKind?: string;
}

/** Full deterministic state snapshot (late-join sync / save games). */
export interface GameSnapshot {
  /** Simulation tick this snapshot was taken at. */
  tick: number;
  /** RNG seed the dungeon was generated from — peers regenerate identical maps. */
  dungeonSeed: number;
  entities: EntitySnapshot[];
  /** Explored-fog bitset, base64-packed per player (index = playerId). */
  exploredFog: string[];
}

/** A command as shipped over the wire: stamped with issuing peer + target tick. */
export interface CommandEnvelope {
  /** Tick at which every peer must apply this command (lockstep delay). */
  executeTick: number;
  playerId: number;
  command: InputCommand;
}

/**
 * Transport stub. A sub-agent implementing networking provides a WebSocket or
 * WebRTC DataChannel version of this; the simulation never talks to sockets
 * directly.
 */
export interface INetworkTransport {
  send(envelope: CommandEnvelope): void;
  onReceive(handler: (envelope: CommandEnvelope) => void): void;
  requestSnapshot(): Promise<GameSnapshot>;
}
