/**
 * @module core/Difficulty
 * THE DARK'S MEASURE (it.89): five settings, one table, read by the
 * simulation wherever a number depends on how hard the crypt is meant to be.
 *
 * The maths, in one place:
 *
 *   blow on a hero   = rolled × heroTaken × (foeDamage, when a foe struck)
 *                      → then armor, as always (`Combat.dealDamage`), min 1
 *   foe life         = def.hp × levelHpScale(level) × foeHp     (at spawn, per phase)
 *   foe sight        = AGGRO_RADIUS × aggro
 *   foe chase speed  = PLAYER_SPEED × def.speedMult × foeSpeed
 *   foe swing gap    = def.recoverTicks ÷ COMBAT_SPEED ÷ foeRate (the telegraph keeps its length)
 *   tourist's blade  = every hero blow is at least ceil(hpMax ÷ hits): a
 *                      common foe falls in 1, a champion in 2, a warden in 4
 *                      (per phase of a phased warden)
 *   hardcore         = the hard numbers with one life: the slot is wiped
 *                      the moment the death sheet shows
 *   every mode       = SPAWN_WARD_TICKS of invulnerability after rising
 *
 * Effective blow multipliers (hero × foe): tourist 5 %, easy 70 %, medium
 * 100 %, hard 150 %, hardcore 132 %.
 *
 * Deterministic: the setting is part of the run (saved with it, sent with a
 * party's start), never read from a wall clock or a DOM.
 */

export type DifficultyId = 'tourist' | 'easy' | 'medium' | 'hard' | 'hardcore';

export interface DifficultySpec {
  id: DifficultyId;
  name: string;
  /** Under the name on the picker. */
  tag: string;
  blurb: string;
  /** Multiplier on every blow a hero receives (before armor). */
  heroTaken: number;
  /** Multiplier on a foe's own strikes and shots (not a hero's reflected steel). */
  foeDamage: number;
  /** Multiplier on a foe's life at spawn. */
  foeHp: number;
  /** Multiplier on a foe's sight radius. */
  aggro: number;
  /** Multiplier on a foe's chase speed. */
  foeSpeed: number;
  /** Multiplier on a foe's swing cadence (the recovery between blows shrinks by it). */
  foeRate: number;
  /** Tourist only: the hits a hero needs. */
  hitsToKill: { normal: number; elite: number; boss: number } | null;
  /** 1 = one life (hardcore); null = as many as the dark allows. */
  lives: number | null;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultySpec> = {
  tourist: {
    id: 'tourist',
    name: 'TOURIST',
    tag: 'see the crypt, keep your skin',
    blurb: 'Blows barely scratch you. Common foes fall in one hit, champions in two, wardens in four.',
    heroTaken: 0.1,
    foeDamage: 0.5,
    foeHp: 1,
    aggro: 1,
    foeSpeed: 1,
    foeRate: 1,
    hitsToKill: { normal: 1, elite: 2, boss: 4 },
    lives: null,
  },
  easy: {
    id: 'easy',
    name: 'EASY',
    tag: 'a gentler dark',
    blurb: 'Foes hit for 70 % and carry 80 % of their life; they notice you a little later.',
    heroTaken: 1,
    foeDamage: 0.7,
    foeHp: 0.8,
    aggro: 0.9,
    foeSpeed: 1,
    foeRate: 0.9,
    hitsToKill: null,
    lives: null,
  },
  medium: {
    id: 'medium',
    name: 'MEDIUM',
    tag: 'the crypt as it was cut',
    blurb: 'Every number as the tables print it.',
    heroTaken: 1,
    foeDamage: 1,
    foeHp: 1,
    aggro: 1,
    foeSpeed: 1,
    foeRate: 1,
    hitsToKill: null,
    lives: null,
  },
  hard: {
    id: 'hard',
    name: 'HARD',
    tag: 'the dead press in',
    blurb: 'Blows land at 150 %, foes carry 140 % of their life, see further, run faster and swing sooner.',
    heroTaken: 1.25,
    foeDamage: 1.2,
    foeHp: 1.4,
    aggro: 1.35,
    foeSpeed: 1.1,
    foeRate: 1.15,
    hitsToKill: null,
    lives: null,
  },
  hardcore: {
    id: 'hardcore',
    name: 'HARDCORE',
    tag: 'one life',
    blurb: 'Blows at 132 %, foes at 125 % life and eager. Death wipes the slot: no rising, no reload.',
    heroTaken: 1.15,
    foeDamage: 1.15,
    foeHp: 1.25,
    aggro: 1.25,
    foeSpeed: 1.05,
    foeRate: 1.1,
    hitsToKill: null,
    lives: 1,
  },
};

export const DIFFICULTY_ORDER: DifficultyId[] = ['tourist', 'easy', 'medium', 'hard', 'hardcore'];

/** Five seconds at 60 Hz: the spawn ward every mode grants a risen delver. */
export const SPAWN_WARD_TICKS = 300;

/** The picker's remembered choice. */
export const DIFFICULTY_KEY = 'iso-arpg-difficulty';

export function isDifficultyId(x: unknown): x is DifficultyId {
  return typeof x === 'string' && x in DIFFICULTIES;
}

/** A saved or sent value, or medium when it is nothing the table knows. */
export function asDifficultyId(x: unknown, fallback: DifficultyId = 'medium'): DifficultyId {
  return isDifficultyId(x) ? x : fallback;
}

/** What the class screen last chose (medium until it chooses). */
export function readPreferredDifficulty(): DifficultyId {
  try {
    return asDifficultyId(localStorage.getItem(DIFFICULTY_KEY));
  } catch {
    return 'medium';
  }
}

/**
 * The live setting. One per page: a run sets it as it starts (from its save,
 * the picker, or the party leader) and every system reads `difficulty.current`.
 */
export const difficulty = {
  current: DIFFICULTIES.medium as DifficultySpec,
  set(id: DifficultyId): void {
    this.current = DIFFICULTIES[id];
  },
  get id(): DifficultyId {
    return this.current.id;
  },
};
