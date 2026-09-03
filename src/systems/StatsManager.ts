/**
 * @module systems/StatsManager
 * RECORDS (it.54): two independent ledgers — the DUNGEON (deepest depth,
 * kills, wardens slain, per-floor clear times) and the ARENA (best wave,
 * kills, clear times per trial length, the gladiator rank). Records live
 * in localStorage across every slot and ride along inside the save file;
 * loading merges (best of both). Times are ACTIVE ticks — the clock only
 * runs on dungeon floors and during a live arena wave.
 */

export interface RunRecord {
  cls: string;
  /** Active ticks spent on that floor. */
  ticks: number;
  floor: number;
  date: number;
}

export interface ArenaRecord {
  cls: string;
  /** Active ticks for the whole trial. */
  ticks: number;
  wave: number;
  date: number;
}

export type ArenaLength = 5 | 10 | 15 | 20;
export const ARENA_LENGTHS: ReadonlyArray<ArenaLength> = [5, 10, 15, 20];

export interface DungeonStats {
  deepestFloor: number;
  kills: number;
  bossKills: number;
  /** Floor clears — deepest first, fastest within a depth; top 10. */
  records: RunRecord[];
}

export interface ArenaStats {
  bestWave: number;
  kills: number;
  bossKills: number;
  clears: Record<ArenaLength, ArenaRecord[]>;
}

export interface RecordsSnapshot {
  dungeon: DungeonStats;
  arena: ArenaStats;
}

const KEY = 'iso-arpg-records';
const TOP = 10;

function emptyDungeon(): DungeonStats {
  return { deepestFloor: 0, kills: 0, bossKills: 0, records: [] };
}
function emptyArena(): ArenaStats {
  return { bestWave: 0, kills: 0, bossKills: 0, clears: { 5: [], 10: [], 15: [], 20: [] } };
}

/** Gladiator rank from the best wave survived. */
export function gladiatorRank(bestWave: number): string {
  if (bestWave >= 20) return 'Crown of the Sand';
  if (bestWave >= 15) return 'Arena Champion';
  if (bestWave >= 10) return 'Veteran Gladiator';
  if (bestWave >= 5) return 'Novice Gladiator';
  if (bestWave >= 1) return 'Sand-blooded';
  return 'Untested';
}

export class StatsManager {
  dungeon: DungeonStats = emptyDungeon();
  arena: ArenaStats = emptyArena();

  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.merge(JSON.parse(raw) as Partial<RecordsSnapshot>);
    } catch {
      /* unreadable: start clean */
    }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.snapshot()));
    } catch {
      /* quota / private mode */
    }
  }

  snapshot(): RecordsSnapshot {
    return {
      dungeon: { ...this.dungeon, records: this.dungeon.records.map((r) => ({ ...r })) },
      arena: {
        ...this.arena,
        clears: { 5: [...this.arena.clears[5]], 10: [...this.arena.clears[10]], 15: [...this.arena.clears[15]], 20: [...this.arena.clears[20]] },
      },
    };
  }

  /** Best of both: tallies take the max, record tables union and re-rank. */
  merge(other: Partial<RecordsSnapshot> | null | undefined): void {
    if (!other) return;
    const d = other.dungeon;
    if (d) {
      this.dungeon.deepestFloor = Math.max(this.dungeon.deepestFloor, d.deepestFloor ?? 0);
      this.dungeon.kills = Math.max(this.dungeon.kills, d.kills ?? 0);
      this.dungeon.bossKills = Math.max(this.dungeon.bossKills, d.bossKills ?? 0);
      for (const r of d.records ?? []) this.pushDungeon(r);
    }
    const a = other.arena;
    if (a) {
      this.arena.bestWave = Math.max(this.arena.bestWave, a.bestWave ?? 0);
      this.arena.kills = Math.max(this.arena.kills, a.kills ?? 0);
      this.arena.bossKills = Math.max(this.arena.bossKills, a.bossKills ?? 0);
      for (const len of ARENA_LENGTHS) for (const r of a.clears?.[len] ?? []) this.pushArena(len, r);
    }
    // Every trial length always has a table (it.58): an old or partial snapshot never leaves a hole.
    for (const len of ARENA_LENGTHS) if (!Array.isArray(this.arena.clears[len])) this.arena.clears[len] = [];
  }

  private pushDungeon(r: RunRecord): void {
    const list = this.dungeon.records;
    if (list.some((x) => x.date === r.date && x.floor === r.floor && x.ticks === r.ticks)) return;
    list.push({ ...r });
    list.sort((x, y) => y.floor - x.floor || x.ticks - y.ticks);
    if (list.length > TOP) list.length = TOP;
  }

  private pushArena(len: ArenaLength, r: ArenaRecord): void {
    if (!Array.isArray(this.arena.clears[len])) this.arena.clears[len] = [];
    const list = this.arena.clears[len];
    if (list.some((x) => x.date === r.date && x.ticks === r.ticks)) return;
    list.push({ ...r });
    list.sort((x, y) => x.ticks - y.ticks);
    if (list.length > TOP) list.length = TOP;
  }

  noteDepth(floor: number): void {
    if (floor > this.dungeon.deepestFloor) {
      this.dungeon.deepestFloor = floor;
      this.save();
    }
  }

  private unsaved = 0;

  noteKill(inArena: boolean, boss: boolean): void {
    const ledger = inArena ? this.arena : this.dungeon;
    ledger.kills++;
    if (boss) ledger.bossKills++;
    // Persist in batches (it.55): a browser closed mid-wave keeps its tally.
    if (++this.unsaved >= 10 || boss) {
      this.unsaved = 0;
      this.save();
    }
  }

  /** A floor delved: its active clear time joins the speedrun table. */
  recordFloorClear(cls: string, floor: number, ticks: number): void {
    if (floor <= 0) return;
    this.pushDungeon({ cls, floor, ticks, date: Date.now() });
    this.save();
  }

  noteArenaWave(wave: number): void {
    if (wave > this.arena.bestWave) {
      this.arena.bestWave = wave;
      this.save();
    }
  }

  /** A whole trial survived: its active time joins that length's table. */
  recordArenaClear(cls: string, len: number, ticks: number): void {
    const L = ARENA_LENGTHS.includes(len as ArenaLength) ? (len as ArenaLength) : null;
    if (!L) return;
    this.pushArena(L, { cls, wave: len, ticks, date: Date.now() });
    this.noteArenaWave(len);
    this.save();
  }

  rank(): string {
    return gladiatorRank(this.arena.bestWave);
  }
}

/** MM:SS from active ticks (60 per second). */
export function clockFromTicks(ticks: number): string {
  const s = Math.max(0, Math.floor(ticks / 60));
  const m = Math.floor(s / 60);
  return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}
