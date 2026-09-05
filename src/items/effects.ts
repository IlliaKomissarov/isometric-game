/**
 * @module items/effects
 * WEAPON EFFECTS (it.80, described it.81): what a weapon DOES beyond its
 * numbers, and the words the codex and every card use to explain it.
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

export interface StatusInfo {
  name: string;
  color: number;
  adjective: string;
  /** The short card line. */
  line: (chance: number, power: number) => string;
  /** The full mechanics, for the codex and the card's detail line. */
  desc: string;
  /** How it shows on the foe. */
  visual: string;
}

export const STATUS_INFO: Record<StatusKind, StatusInfo> = {
  bleed: {
    name: 'Bleed',
    color: 0xe04040,
    adjective: 'Sanguine',
    line: (c, p) => `${pct(c)} chance to bleed: ${Math.round(60 * p)}% of the hit over 4 s`,
    desc: 'A physical wound. The foe loses 60% of the hit that opened it over 4 seconds, in 8 bites every half second. Bites ignore armor. A fresh or stronger bleed replaces a weaker one; it never stacks. Every foe bleeds, wardens included.',
    visual: 'A red mark above the head and a spatter on every bite; the body flushes red.',
  },
  poison: {
    name: 'Poison',
    color: 0x86c85a,
    adjective: 'Venomous',
    line: (c, p) => `${pct(c)} chance to poison: ${Math.round(80 * p)}% of the hit over 6 s`,
    desc: 'A slow venom. The foe loses 80% of the hit over 6 seconds, in 12 bites every half second — the most total damage of any status, the slowest to pay out. Bites ignore armor. Refreshes, never stacks. The rogue’s class path and Poison Blade lay the same venom.',
    visual: 'A green mark above the head, green wisps on every bite; the body sickens green.',
  },
  burn: {
    name: 'Burn',
    color: 0xff9040,
    adjective: 'Flaming',
    line: (c, p) => `${pct(c)} chance to burn: ${Math.round(50 * p)}% of the hit over 3 s`,
    desc: 'Fire clings. The foe loses 50% of the hit over 3 seconds, in 9 quick bites every third of a second — the fastest payout. Bites ignore armor. Refreshes, never stacks. The mage’s class path burns the same way.',
    visual: 'An ember mark above the head, sparks on every bite; the body glows orange.',
  },
  chill: {
    name: 'Chill',
    color: 0x9fd4f0,
    adjective: 'Frozen',
    line: (c, p) => `${pct(c)} chance to chill: foes move at ${Math.round(55 / p)}% for 3 s`,
    desc: 'Frost in the legs. The foe walks at 55% of its pace for 3 seconds; its swings are untouched. A new chill refreshes the time and keeps the deeper slow. Wardens shrug it off.',
    visual: 'A pale-blue mark above the head and a frost puff on the hit; the body pales blue.',
  },
  shock: {
    name: 'Shock',
    color: 0xa8c8ff,
    adjective: 'Storm',
    line: (c, p) => `${pct(c)} chance to shock: ${Math.round(45 * p)}% of the hit arcs to a second foe`,
    desc: 'Lightning leaps. The instant the hit lands, 45% of it strikes the nearest OTHER foe within 3 tiles, ignoring armor. Nothing lingers, nothing stacks; a lone foe takes no extra harm. Every foe conducts, wardens included.',
    visual: 'A white-blue flash on the struck foe and a second flash where the arc lands.',
  },
  stun: {
    name: 'Stun',
    color: 0xffd070,
    adjective: 'Crushing',
    line: (c, p) => `${pct(c)} chance to stun for ${(0.8 * p).toFixed(1)} s`,
    desc: 'The foe reels for 0.8 seconds: no walking, no swinging, its current attack cut short. A stun cannot be extended by another stun that would end sooner. Wardens take half the time, and none while they are mid-blow.',
    visual: 'A gold mark above the head and gold motes on the hit; the foe plays its flinch.',
  },
};

export interface TraitInfo {
  name: string;
  adjective: string;
  line: (power: number) => string;
  desc: string;
}

export const TRAIT_INFO: Record<TraitKey, TraitInfo> = {
  lifeOnKill: { name: 'Reaping', adjective: 'Reaping', line: (p) => `A slain foe returns ${Math.round(4 * p)}% of your life`, desc: 'Every foe that dies to your weapon, your wounds over time or your arcs heals you for 4% of your maximum life (a stronger weapon reaps more). A crowd is a meal.' },
  manaOnHit: { name: 'Siphon', adjective: 'Siphoning', line: (p) => `Every hit returns ${Math.round(3 * p)} resource`, desc: 'Every landed primary strike returns 3 points of mana or stamina. Fast weapons siphon more often; a caster with a scepter never runs dry.' },
  cleave: { name: 'Cleave', adjective: 'Cleaving', line: (p) => `Every strike also cuts a second foe in reach for ${Math.round(50 * p)}%`, desc: 'After every landed primary strike the blade continues into the nearest other foe within reach plus half a tile, for 50% of the blow. It stacks with the ordinary sweep arc; procs do not roll on the cleave.' },
  knockback: { name: 'Impact', adjective: 'Heavy', line: (p) => `Strikes throw foes ${Math.round(80 * p)}% further`, desc: 'Every hit throws the foe 80% further than the weapon family would. Room to breathe, and a thrown foe misses its swing.' },
  swift: { name: 'Swiftness', adjective: 'Swift', line: (p) => `+${Math.round(8 * p)}% movement speed`, desc: 'You walk and run 8% faster while the weapon is held. It stacks with Fleet Foot and with a Draught of Haste.' },
  guardian: { name: 'Guardian', adjective: 'Warding', line: (p) => `+${Math.round(12 * p)}% armor`, desc: 'Your total armor, every plate and passive included, counts 12% higher while the weapon is held.' },
  fortune: { name: 'Fortune', adjective: 'Gilded', line: (p) => `+${Math.round(25 * p)}% gold from piles`, desc: 'Every pile of gold you scoop yields 25% more. Merchants and sales are unchanged.' },
  seeker: { name: 'Seeker', adjective: 'Seeking', line: (p) => `Rarer finds: drop luck ×${(1 + 0.25 * p).toFixed(2)}`, desc: 'While anyone in the party holds a seeking weapon, every rarity above common weighs 25% more in the floor’s drop rolls. The best seeker in the party counts.' },
  berserk: { name: 'Berserk', adjective: 'Wrathful', line: (p) => `+${Math.round(18 * p)}% damage while under 40% life`, desc: 'All your damage — strikes, skills, wounds over time — rises 18% while your life is under 40% of its maximum.' },
  precise: { name: 'Precision', adjective: 'Keen', line: (p) => `Critical strikes deal ${(2 + 0.4 * p).toFixed(1)}× instead of 2×`, desc: 'A critical strike multiplies the blow by 2.4 instead of 2. Pairs with high-crit shapes (rapier, katana, warpick) and "of Precision" lines.' },
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

/** The full explanation behind an effect (the card's detail, the codex). */
export function effectDesc(e: Effect): string {
  if (e.proc) return STATUS_INFO[e.proc.status].desc;
  if (e.trait) return TRAIT_INFO[e.trait.key].desc;
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
  /** The recipe's own words: what it is for, and who wants it. */
  desc: string;
}

export const ENCHANTS: Record<string, EnchantRecipe> = {
  flame: { key: 'flame', name: 'Flaming Edge', effect: { proc: { status: 'burn', chance: 0.3, power: 1 } }, icon: 297, essence: 2, dust: 4, depth: 2, desc: 'Fire on the edge: three hits in ten burn for half the blow over three seconds. The fastest wound over time — best on fast blades that hit often.' },
  venom: { key: 'venom', name: 'Serpent Kiss', effect: { proc: { status: 'poison', chance: 0.3, power: 1 } }, icon: 299, essence: 2, dust: 4, depth: 2, desc: 'Venom in the wound: three hits in ten poison for eight tenths of the blow over six seconds. The most total damage of any enchantment, paid slowly — best on heavy, slow weapons.' },
  frost: { key: 'frost', name: 'Hoarfrost Bite', effect: { proc: { status: 'chill', chance: 0.3, power: 1 } }, icon: 298, essence: 2, dust: 4, depth: 3, desc: 'Frost in the legs: three hits in ten slow the foe to 55% for three seconds. Control, not damage — a bow or a polearm keeps a chilled foe at reach forever.' },
  storm: { key: 'storm', name: 'Stormcall', effect: { proc: { status: 'shock', chance: 0.25, power: 1 } }, icon: 301, essence: 3, dust: 5, depth: 5, desc: 'Lightning leaps: one hit in four sends 45% of the blow to the nearest other foe within three tiles. Worthless against a lone warden, brutal in a corridor.' },
  sanguine: { key: 'sanguine', name: 'Sanguine Edge', effect: { proc: { status: 'bleed', chance: 0.3, power: 1 } }, icon: 300, essence: 2, dust: 4, depth: 3, desc: 'A deep cut: three hits in ten bleed for six tenths of the blow over four seconds. Works on everything that bleeds, wardens included.' },
  crushing: { key: 'crushing', name: 'Crushing Blow', effect: { proc: { status: 'stun', chance: 0.2, power: 1 } }, icon: 302, essence: 3, dust: 5, depth: 4, desc: 'The knock of a mace on any weapon: one hit in five stuns for eight tenths of a second. Wardens take half; a foe mid-blow is not interrupted.' },
  reaping: { key: 'reaping', name: 'Reaping', effect: { trait: { key: 'lifeOnKill', power: 1 } }, icon: 303, essence: 3, dust: 6, depth: 4, desc: 'Every kill heals 4% of your maximum life. The sustain for crowd floors; it does nothing against a single warden.' },
  siphon: { key: 'siphon', name: 'Arcane Siphon', effect: { trait: { key: 'manaOnHit', power: 1 } }, icon: 304, essence: 3, dust: 6, depth: 4, desc: 'Every landed strike returns 3 mana or stamina. A caster never runs dry; a rogue chains skills without pause.' },
  cleaving: { key: 'cleaving', name: 'Cleaving', effect: { trait: { key: 'cleave', power: 1 } }, icon: 305, essence: 4, dust: 6, depth: 6, desc: 'Every strike also cuts the nearest other foe in reach for half the blow, on top of the ordinary sweep. The crowd enchantment.' },
  swiftness: { key: 'swiftness', name: 'Swiftness', effect: { trait: { key: 'swift', power: 1 } }, icon: 306, essence: 2, dust: 4, depth: 2, desc: 'Walk and run 8% faster while the weapon is held. Kiting, fleeing, and reaching the stairs first.' },
  keen: { key: 'keen', name: 'Keen Edge', effect: { trait: { key: 'precise', power: 1 } }, icon: 307, essence: 4, dust: 6, depth: 7, desc: 'Critical strikes deal 2.4× instead of 2×. Pairs with rapiers, katanas, warpicks and every "of Precision" line.' },
  fortune: { key: 'fortune', name: 'Gilded Hand', effect: { trait: { key: 'fortune', power: 1 } }, icon: 308, essence: 2, dust: 5, depth: 3, desc: 'Every pile of gold yields 25% more. The economy enchantment: reinforcement past +8 costs a fortune, and this pays for it.' },
};

export const ENCHANT_KEYS: readonly string[] = Object.keys(ENCHANTS);

/** The recipe scroll item id for an enchant key. */
export function recipeItemId(key: string): string {
  return `recipe_${key}`;
}
