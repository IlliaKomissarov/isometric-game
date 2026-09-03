/**
 * @module persist/SaveGame
 * Save slots in localStorage (it.39). The simulation is deterministic from
 * (seed + commands), so a save is small: the hero's sheet and bags, the
 * shared stash, the deepest depth, and a FloorMemory per visited floor
 * (what was opened, taken and killed, plus the explored-fog bitset) so a
 * town portal or a reload rebuilds the exact floor state from its seed.
 *
 * Three slots. Writes are guarded (private mode / quota) and versioned;
 * an unreadable or foreign-version blob reads as an empty slot.
 */

import type { ClassArchetype, EquipmentSlot } from '@/network/Serialization';

export const SAVE_VERSION = 3;
export const SAVE_SLOTS = 3;
const KEY = (slot: number): string => `iso-arpg-save-${slot}`;

/** Everything a rebuilt floor needs to look the way the player left it. */
export interface FloorMemory {
  /** Chest indexes (placement order) already opened. */
  openedChests: number[];
  /** Gold pile indexes already scooped. */
  takenGold: number[];
  /** Spawn indexes (roster order) already killed. */
  killedSpawns: number[];
  /** Explored-fog bitset, base64 (see Lighting.packExplored). */
  explored: string;
  /** Arena of a boss floor already cleared. */
  arenaCleared: boolean;
}

export interface StashState {
  items: string[];
  gold: number;
}

export interface PlayerSave {
  archetype: ClassArchetype;
  level: number;
  xp: number;
  gold: number;
  hp: number;
  hpMax: number;
  resource: number;
  backpack: string[];
  equipped: Array<{ slot: EquipmentSlot; itemId: string }>;
  /** Progression (it.41, save v2). */
  skillPoints: number;
  unlocked: string[];
  loadout: Array<string | null>;
  passives: string[];
  /** Bestiary (it.42): creatures seen / slain by kind. */
  bestiary?: Record<string, { seen: number; killed: number }>;
  /** Records board (it.48, save v3): every coin scooped this run. */
  goldCollected?: number;
}

export interface SaveGame {
  version: typeof SAVE_VERSION;
  slot: number;
  seed: number;
  createdAt: number;
  updatedAt: number;
  /** Floor the hero stands on when saved (0 = town). */
  floor: number;
  /**
   * DEEP SAVE (it.48, v3): the exact spot and whether it was the boss arena —
   * a load resumes RIGHT THERE (the floor rebuilds from its seed + memory),
   * not in town. Absent on older saves (they resume in town).
   */
  pos?: { x: number; y: number };
  arena?: boolean;
  deepestFloor: number;
  playtimeTicks: number;
  player: PlayerSave;
  stash: StashState;
  floors: Record<number, FloorMemory>;
}

export interface SaveMeta {
  slot: number;
  archetype: ClassArchetype;
  level: number;
  deepestFloor: number;
  gold: number;
  updatedAt: number;
  playtimeTicks: number;
}

export function emptyFloorMemory(): FloorMemory {
  return { openedChests: [], takenGold: [], killedSpawns: [], explored: '', arenaCleared: false };
}

function readRaw(slot: number): SaveGame | null {
  try {
    const raw = localStorage.getItem(KEY(slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SaveGame>;
    let ver = (parsed as { version?: number }).version;
    if (!parsed.player || !parsed.stash) return null;
    if (ver === 1) {
      // v1 → v2: a hero saved before the skill tree gets one point per level.
      const pl = parsed.player as Partial<PlayerSave>;
      pl.skillPoints = Math.max(1, pl.level ?? 1);
      pl.unlocked = [];
      pl.loadout = [null, null, null, null];
      pl.passives = [];
      ver = 2;
    }
    if (ver === 2) {
      // v2 → v3: no remembered position — the hero resumes in town.
      delete (parsed as { pos?: unknown }).pos;
      parsed.arena = false;
      ver = 3;
    }
    if (ver !== SAVE_VERSION) return null;
    parsed.version = SAVE_VERSION;
    return parsed as SaveGame;
  } catch {
    return null;
  }
}

export const saves = {
  read(slot: number): SaveGame | null {
    return readRaw(slot);
  },
  /** Returns false when storage refused the write (quota / private mode). */
  write(save: SaveGame): boolean {
    try {
      localStorage.setItem(KEY(save.slot), JSON.stringify(save));
      return true;
    } catch (err) {
      console.warn('[save] write failed:', err);
      return false;
    }
  },
  remove(slot: number): void {
    try {
      localStorage.removeItem(KEY(slot));
    } catch {
      /* ignore */
    }
  },
  /** One entry per slot (null = empty). */
  list(): Array<SaveMeta | null> {
    const out: Array<SaveMeta | null> = [];
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      const s = readRaw(slot);
      out.push(
        s
          ? {
              slot,
              archetype: s.player.archetype,
              level: s.player.level,
              deepestFloor: s.deepestFloor,
              gold: s.player.gold + s.stash.gold,
              updatedAt: s.updatedAt,
              playtimeTicks: s.playtimeTicks,
            }
          : null,
      );
    }
    return out;
  },
  /** First empty slot, or null when all three are taken. */
  firstFree(): number | null {
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) if (!readRaw(slot)) return slot;
    return null;
  },
  /** The most recently updated save, for CONTINUE. */
  latest(): SaveGame | null {
    let best: SaveGame | null = null;
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      const s = readRaw(slot);
      if (s && (!best || s.updatedAt > best.updatedAt)) best = s;
    }
    return best;
  },
};

/** Pack a Uint8Array bitset to base64 (explored fog). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
