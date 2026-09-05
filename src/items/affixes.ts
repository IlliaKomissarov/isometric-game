/**
 * @module items/affixes
 * THE AFFIX ENGINE (it.78). Every rolled piece of gear above common carries
 * one to five affixes drawn from three pools:
 *
 *   PRIMARY  (prefixes)  Strength · Agility · Intelligence — attribute points
 *   SECONDARY (suffixes) Crit Chance · Attack Speed · Cooldown Reduction
 *   DEFENSIVE (suffixes) Armor · Resistance · Health Regrowth
 *
 * An affix is `{ key, tier }` (tier 1–5); its numbers come from the table
 * below, and flat values (armor, regrowth) grow with the item level's power
 * curve so a tier-3 bulwark on an iLvl-60 plate is worth wearing. Attribute
 * points convert into the engine's real levers in `derivedBonus`:
 *
 *   1 STR → +1% damage, +2 max HP        1 AGI → +0.6% attack speed, +0.3% dodge
 *   1 INT → +0.8% cooldown reduction, +2 max resource
 *
 * Names: the first prefix and the first suffix decorate the base name
 * ("Brutal Steel Blade of Haste"); the card lists every line.
 */

export type AffixKey = 'str' | 'agi' | 'int' | 'crt' | 'asp' | 'cdr' | 'arm' | 'res' | 'rgn';

export interface AffixRoll {
  key: AffixKey;
  tier: number;
}

export interface AffixDef {
  key: AffixKey;
  kind: 'prefix' | 'suffix';
  pool: 'primary' | 'secondary' | 'defensive';
  /** The word that decorates the item name. */
  name: string;
  /** What the line says; `{v}` is the tier's value. */
  line: string;
  /** Tier 1–5 values. `flat` values are multiplied by the item's power scale. */
  values: [number, number, number, number, number];
  flat?: boolean;
  /** How the value prints: attribute points, a percentage, a flat number, hp per second. */
  fmt: 'pts' | 'pct' | 'flat' | 'ps';
}

export const AFFIXES: Record<AffixKey, AffixDef> = {
  str: { key: 'str', kind: 'prefix', pool: 'primary', name: 'Brutal', line: '+{v} Strength', values: [3, 6, 10, 15, 22], fmt: 'pts' },
  agi: { key: 'agi', kind: 'prefix', pool: 'primary', name: 'Nimble', line: '+{v} Agility', values: [3, 6, 10, 15, 22], fmt: 'pts' },
  int: { key: 'int', kind: 'prefix', pool: 'primary', name: 'Arcane', line: '+{v} Intelligence', values: [3, 6, 10, 15, 22], fmt: 'pts' },
  crt: { key: 'crt', kind: 'suffix', pool: 'secondary', name: 'of Precision', line: '+{v} Crit Chance', values: [0.02, 0.03, 0.045, 0.06, 0.08], fmt: 'pct' },
  asp: { key: 'asp', kind: 'suffix', pool: 'secondary', name: 'of Haste', line: '+{v} Attack Speed', values: [0.03, 0.05, 0.07, 0.1, 0.13], fmt: 'pct' },
  cdr: { key: 'cdr', kind: 'suffix', pool: 'secondary', name: 'of Focus', line: '{v} Cooldown Reduction', values: [0.03, 0.05, 0.07, 0.1, 0.13], fmt: 'pct' },
  arm: { key: 'arm', kind: 'suffix', pool: 'defensive', name: 'of the Bulwark', line: '+{v} Armor', values: [2, 4, 7, 11, 16], flat: true, fmt: 'flat' },
  res: { key: 'res', kind: 'suffix', pool: 'defensive', name: 'of Warding', line: '+{v} Resistance', values: [0.03, 0.05, 0.07, 0.1, 0.13], fmt: 'pct' },
  rgn: { key: 'rgn', kind: 'suffix', pool: 'defensive', name: 'of Regrowth', line: '+{v} Health Regrowth', values: [0.5, 1, 1.6, 2.5, 4], flat: true, fmt: 'ps' },
};

export const AFFIX_KEYS: readonly AffixKey[] = ['str', 'agi', 'int', 'crt', 'asp', 'cdr', 'arm', 'res', 'rgn'];

/** The value an affix contributes at a tier (flat ones scaled by `power`). */
export function affixValue(roll: AffixRoll, power: number): number {
  const def = AFFIXES[roll.key];
  const t = Math.max(1, Math.min(5, Math.round(roll.tier)));
  const v = def.values[t - 1];
  return def.flat ? v * power : v;
}

/** The printed line ("+6 Strength", "+5% Attack Speed", "+7.2 Armor", "+1.6 HP/s"). */
export function affixLine(roll: AffixRoll, power: number): string {
  const def = AFFIXES[roll.key];
  const v = affixValue(roll, power);
  const text =
    def.fmt === 'pct' ? `${Math.round(v * 100)}%` : def.fmt === 'ps' ? `${(Math.round(v * 10) / 10).toFixed(1)} HP/s` : def.fmt === 'flat' ? String(Math.round(v * 10) / 10) : String(Math.round(v));
  return `${def.line.replace('{v}', text)} · T${Math.max(1, Math.min(5, roll.tier))}`;
}

/** Every lever the engine reads, flattened from a set of affix rolls. */
export interface DerivedBonus {
  dmg: number;
  hp: number;
  attackSpeed: number;
  dodge: number;
  cdr: number;
  resource: number;
  crit: number;
  armor: number;
  resist: number;
  hpRegen: number;
  str: number;
  agi: number;
  int: number;
}

export function emptyBonus(): DerivedBonus {
  return { dmg: 0, hp: 0, attackSpeed: 0, dodge: 0, cdr: 0, resource: 0, crit: 0, armor: 0, resist: 0, hpRegen: 0, str: 0, agi: 0, int: 0 };
}

/** Fold affix rolls into engine levers (attribute points convert here). */
export function foldAffixes(rolls: readonly AffixRoll[], power: number, into: DerivedBonus = emptyBonus()): DerivedBonus {
  for (const r of rolls) {
    const v = affixValue(r, power);
    switch (r.key) {
      case 'str':
        into.str += v;
        into.dmg += v * 0.01;
        into.hp += v * 2;
        break;
      case 'agi':
        into.agi += v;
        into.attackSpeed += v * 0.006;
        into.dodge += v * 0.003;
        break;
      case 'int':
        into.int += v;
        into.cdr += v * 0.008;
        into.resource += v * 2;
        break;
      case 'crt':
        into.crit += v;
        break;
      case 'asp':
        into.attackSpeed += v;
        break;
      case 'cdr':
        into.cdr += v;
        break;
      case 'arm':
        into.armor += v;
        break;
      case 'res':
        into.resist += v;
        break;
      case 'rgn':
        into.hpRegen += v;
        break;
    }
  }
  return into;
}

/** Affix tier for an item level: one per twenty levels, with a little spread. */
export function tierFor(ilvl: number, rand: () => number): number {
  let t = Math.ceil(Math.max(1, ilvl) / 20);
  const r = rand();
  if (r < 0.2) t += 1;
  else if (r > 0.85) t -= 1;
  return Math.max(1, Math.min(5, t));
}

/**
 * Roll `count` distinct affixes. Weapons lean to the offensive pools, armor to
 * the defensive; a piece never carries the same key twice.
 */
export function rollAffixes(count: number, ilvl: number, weapon: boolean, rand: () => number, keep: readonly AffixRoll[] = []): AffixRoll[] {
  const out: AffixRoll[] = [...keep];
  const taken = new Set(out.map((a) => a.key));
  const weights: Array<[AffixKey, number]> = AFFIX_KEYS.map((k) => {
    const def = AFFIXES[k];
    let w = 1;
    if (weapon && def.pool !== 'defensive') w = 1.6;
    if (!weapon && def.pool === 'defensive') w = 1.6;
    return [k, w];
  });
  while (out.length < count) {
    const open = weights.filter(([k]) => !taken.has(k));
    if (!open.length) break;
    const total = open.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    let pick = open[open.length - 1][0];
    for (const [k, w] of open) {
      r -= w;
      if (r <= 0) {
        pick = k;
        break;
      }
    }
    taken.add(pick);
    out.push({ key: pick, tier: tierFor(ilvl, rand) });
  }
  return out;
}
