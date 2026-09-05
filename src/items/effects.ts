/**
 * @module items/effects
 * WEAPON EFFECTS (it.80): what a weapon DOES beyond its numbers.
 *
 * Two families, both carried as `Effect` records on a weapon (an innate from
 * its shape and tier, plus one ENCHANTMENT applied at the forge):
 *
 *   PROCS  — a chance on every landed hit to inflict a STATUS on the foe:
 *     bleed   physical wound, 60% of the hit over 4 s (Baldur's Gate style)
 *     poison  80% of the hit over 6 s, slow drip (RuneScape's venom)
 *     burn    50% of the hit over 3 s, fast
 *     chill   the foe moves at 55% for 3 s
 *     shock   an arc: 45% of the hit leaps to the nearest other foe in 3 tiles
 *     stun    the foe reels for 0.8 s (a Diablo I mace's knock)
 *
 *   TRAITS — a granted ability while the weapon is held:
 *     lifeOnKill   a slain foe returns 4% of max life
 *     manaOnHit    every hit returns 3 resource
 *     cleave       every primary strike also cuts a second foe in reach for half
 *     knockback    strikes throw foes 80% further
 *     swift        +8% movement speed
 *     guardian     +12% armor
 *     fortune      +25% gold from piles
 *     seeker       rarer finds (drop luck ×1.25)
 *     berserk      +18% damage under 40% life
 *     precise      critical strikes deal 2.4× instead of 2×
 *
 * Every number lives here; the engine reads them through `Player`
 * (`weaponEffects`) and `CombatSystem` / `StatusSystem`.
 */

export type StatusKind = 'bleed' | 'poison' | 'burn' | 'chill' | 'shock' | 'stun';
export type TraitKey = 'lifeOnKill' | 'manaOnHit' | 'cleave' | 'knockback' | 'swift' | 'guardian' | 'fortune' | 'seeker' | 'berserk' | 'precise';

export interface Proc {
  status: StatusKind;
  /** 0–1 chance per landed hit. */
  chance: number;
  /** Multiplier on the status's base strength (1 = the table above). */
  power: number;
}

export interface Trait {
  key: TraitKey;
  /** Multiplier on the trait's base strength (1 = the table above). */
  power: number;
}

export interface Effect {
  proc?: Proc;
  trait?: Trait;
}

export const STATUS_INFO: Record<StatusKind, { name: string; color: number; adjective: string; line: (chance: number, power: number) => string }> = {
  bleed: { name: 'Bleed', color: 0xe04040, adjective: 'Sanguine', line: (c, p) => `${pct(c)} chance to bleed: ${Math.round(60 * p)}% of the hit over 4 s` },
  poison: { name: 'Poison', color: 0x86c85a, adjective: 'Venomous', line: (c, p) => `${pct(c)} chance to poison: ${Math.round(80 * p)}% of the hit over 6 s` },
  burn: { name: 'Burn', color: 0xff9040, adjective: 'Flaming', line: (c, p) => `${pct(c)} chance to burn: ${Math.round(50 * p)}% of the hit over 3 s` },
  chill: { name: 'Chill', color: 0x9fd4f0, adjective: 'Frozen', line: (c, p) => `${pct(c)} chance to chill: foes move at ${Math.round(55 / p)}% for 3 s` },
  shock: { name: 'Shock', color: 0xa8c8ff, adjective: 'Storm', line: (c, p) => `${pct(c)} chance to shock: ${Math.round(45 * p)}% of the hit arcs to a second foe` },
  stun: { name: 'Stun', color: 0xffd070, adjective: 'Crushing', line: (c, p) => `${pct(c)} chance to stun for ${(0.8 * p).toFixed(1)} s` },
};

export const TRAIT_INFO: Record<TraitKey, { name: string; adjective: string; line: (power: number) => string }> = {
  lifeOnKill: { name: 'Reaping', adjective: 'Reaping', line: (p) => `A slain foe returns ${Math.round(4 * p)}% of your life` },
  manaOnHit: { name: 'Siphon', adjective: 'Siphoning', line: (p) => `Every hit returns ${Math.round(3 * p)} resource` },
  cleave: { name: 'Cleave', adjective: 'Cleaving', line: (p) => `Every strike also cuts a second foe in reach for ${Math.round(50 * p)}%` },
  knockback: { name: 'Impact', adjective: 'Heavy', line: (p) => `Strikes throw foes ${Math.round(80 * p)}% further` },
  swift: { name: 'Swiftness', adjective: 'Swift', line: (p) => `+${Math.round(8 * p)}% movement speed` },
  guardian: { name: 'Guardian', adjective: 'Warding', line: (p) => `+${Math.round(12 * p)}% armor` },
  fortune: { name: 'Fortune', adjective: 'Gilded', line: (p) => `+${Math.round(25 * p)}% gold from piles` },
  seeker: { name: 'Seeker', adjective: 'Seeking', line: (p) => `Rarer finds: drop luck ×${(1 + 0.25 * p).toFixed(2)}` },
  berserk: { name: 'Berserk', adjective: 'Wrathful', line: (p) => `+${Math.round(18 * p)}% damage while under 40% life` },
  precise: { name: 'Precision', adjective: 'Keen', line: (p) => `Critical strikes deal ${(2 + 0.4 * p).toFixed(1)}× instead of 2×` },
};

function pct(c: number): string {
  return `${Math.round(c * 100)}%`;
}

/** The printed line for an effect. */
export function effectLine(e: Effect): string {
  if (e.proc) return STATUS_INFO[e.proc.status].line(e.proc.chance, e.proc.power);
  if (e.trait) return TRAIT_INFO[e.trait.key].line(e.trait.power);
  return '';
}

/** The word an effect adds to a name ("Flaming", "Reaping"). */
export function effectAdjective(e: Effect): string {
  if (e.proc) return STATUS_INFO[e.proc.status].adjective;
  if (e.trait) return TRAIT_INFO[e.trait.key].adjective;
  return '';
}

// ---- Enchantment recipes -------------------------------------------------------

export interface EnchantRecipe {
  key: string;
  name: string;
  effect: Effect;
  /** Raven icon of the recipe scroll and of the enchant line. */
  icon: number;
  /** Essence and dust the forge asks for; gold is 30% of the weapon's value. */
  essence: number;
  dust: number;
  /** The depth from which the scroll can be found. */
  depth: number;
}

export const ENCHANTS: Record<string, EnchantRecipe> = {
  flame: { key: 'flame', name: 'Flaming Edge', effect: { proc: { status: 'burn', chance: 0.3, power: 1 } }, icon: 297, essence: 2, dust: 4, depth: 2 },
  venom: { key: 'venom', name: 'Serpent Kiss', effect: { proc: { status: 'poison', chance: 0.3, power: 1 } }, icon: 299, essence: 2, dust: 4, depth: 2 },
  frost: { key: 'frost', name: 'Hoarfrost Bite', effect: { proc: { status: 'chill', chance: 0.3, power: 1 } }, icon: 298, essence: 2, dust: 4, depth: 3 },
  storm: { key: 'storm', name: 'Stormcall', effect: { proc: { status: 'shock', chance: 0.25, power: 1 } }, icon: 301, essence: 3, dust: 5, depth: 5 },
  sanguine: { key: 'sanguine', name: 'Sanguine Edge', effect: { proc: { status: 'bleed', chance: 0.3, power: 1 } }, icon: 300, essence: 2, dust: 4, depth: 3 },
  crushing: { key: 'crushing', name: 'Crushing Blow', effect: { proc: { status: 'stun', chance: 0.2, power: 1 } }, icon: 302, essence: 3, dust: 5, depth: 4 },
  reaping: { key: 'reaping', name: 'Reaping', effect: { trait: { key: 'lifeOnKill', power: 1 } }, icon: 303, essence: 3, dust: 6, depth: 4 },
  siphon: { key: 'siphon', name: 'Arcane Siphon', effect: { trait: { key: 'manaOnHit', power: 1 } }, icon: 304, essence: 3, dust: 6, depth: 4 },
  cleaving: { key: 'cleaving', name: 'Cleaving', effect: { trait: { key: 'cleave', power: 1 } }, icon: 305, essence: 4, dust: 6, depth: 6 },
  swiftness: { key: 'swiftness', name: 'Swiftness', effect: { trait: { key: 'swift', power: 1 } }, icon: 306, essence: 2, dust: 4, depth: 2 },
  keen: { key: 'keen', name: 'Keen Edge', effect: { trait: { key: 'precise', power: 1 } }, icon: 307, essence: 4, dust: 6, depth: 7 },
  fortune: { key: 'fortune', name: 'Gilded Hand', effect: { trait: { key: 'fortune', power: 1 } }, icon: 308, essence: 2, dust: 5, depth: 3 },
};

export const ENCHANT_KEYS: readonly string[] = Object.keys(ENCHANTS);

/** The recipe scroll item id for an enchant key. */
export function recipeItemId(key: string): string {
  return `recipe_${key}`;
}
