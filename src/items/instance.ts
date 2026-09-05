/**
 * @module items/instance
 * ITEM INSTANCES (it.78). Everything the hero holds is still a STRING — the
 * backpack, the paperdoll, the stash, the ground, a save and every co-op
 * message carry item ids exactly as before — but an id can now encode an
 * instance:
 *
 *   steel_blade@L12R2U3Astr2.crt1
 *   ─────────── ─── ── ── ──────────
 *   base        lvl rarity up affixes(key+tier)
 *
 * A plain base id ("rusty_sword") is the base itself (iLvl 1, its catalog
 * rarity). Material ids may carry a stack count: `iron_scrap#5`.
 *
 * `itemDef(id)` derives the full definition (memoised): stats scale by
 *
 *   stat = base × 1.08^(iLvl − 1) × rarityMult × (1 + 0.05 × upgrade)
 *
 * and the affixes fold into `bonus`; the name takes the first prefix and
 * suffix; legendaries carry a unique effect, mythics a passive skill. Item
 * levels track depth (`ilvlForDepth`: two per floor, depth 20 = 39) and the
 * same power curve scales the foes, so a floor's drops match its threats.
 *
 * Rolling is deterministic: every generator takes the caller's seeded `rand`.
 */

import { AFFIXES, foldAffixes, affixLine, rollAffixes, type AffixKey, type AffixRoll } from './affixes';
import { ITEMS, RARITY_AFFIX_COUNT, RARITY_MULT, RARITY_ORDER, RARITY_WEIGHT, type ItemDef, type Rarity, type UniqueEffect } from './catalog';
import { RAVEN_ITEMS, gearBases } from './registry';
import { PASSIVE_BY_ID } from '@/systems/SkillTree';

// The registry joins the catalog once, at load.
for (const def of RAVEN_ITEMS) ITEMS[def.id] = def;

/** Power at an item level: 1.08 per level above the first. */
export function powerScale(ilvl: number): number {
  return Math.pow(1.08, Math.max(1, Math.min(100, ilvl)) - 1);
}

/** The item level a dungeon depth drops (and the level its foes fight at). */
export function ilvlForDepth(depth: number): number {
  return Math.max(1, Math.min(100, 1 + 2 * (Math.max(1, depth) - 1)));
}

export const UPGRADE_MAX = 15;

const AFFIX_RE = /^([a-z]{3})([1-5])$/;

export interface Decoded {
  base: string;
  ilvl: number;
  rarity: Rarity;
  upgrade: number;
  affixes: AffixRoll[];
  count: number;
}

/** Parse an id. A plain base id decodes to iLvl 1 / +0 / no affixes. */
export function decodeItemId(id: string): Decoded | null {
  const hash = id.indexOf('#');
  let count = 1;
  let core = id;
  if (hash >= 0) {
    count = Math.max(1, parseInt(id.slice(hash + 1), 10) || 1);
    core = id.slice(0, hash);
  }
  const at = core.indexOf('@');
  const base = at >= 0 ? core.slice(0, at) : core;
  const baseDef = ITEMS[base];
  if (!baseDef) return null;
  if (at < 0) return { base, ilvl: baseDef.ilvl ?? 1, rarity: baseDef.rarity, upgrade: 0, affixes: [], count };
  const m = /^L(\d+)R(\d)U(\d+)(?:A([a-z0-9.]*))?$/.exec(core.slice(at + 1));
  if (!m) return null;
  const rarity = RARITY_ORDER[Number(m[2])] ?? baseDef.rarity;
  const affixes: AffixRoll[] = [];
  if (m[4]) {
    for (const part of m[4].split('.')) {
      const a = AFFIX_RE.exec(part);
      if (a && a[1] in AFFIXES) affixes.push({ key: a[1] as AffixKey, tier: Number(a[2]) });
    }
  }
  return { base, ilvl: Math.max(1, Math.min(100, Number(m[1]) || 1)), rarity, upgrade: Math.max(0, Math.min(UPGRADE_MAX, Number(m[3]) || 0)), affixes, count };
}

export function encodeItemId(d: Omit<Decoded, 'count'> & { count?: number }): string {
  const r = RARITY_ORDER.indexOf(d.rarity);
  const a = d.affixes.length ? `A${d.affixes.map((x) => `${x.key}${Math.max(1, Math.min(5, x.tier))}`).join('.')}` : '';
  const core = `${d.base}@L${d.ilvl}R${r}U${d.upgrade}${a}`;
  return d.count && d.count > 1 ? `${core}#${d.count}` : core;
}

const UNIQUES: UniqueEffect[] = ['lifesteal', 'cull', 'thorns', 'echo'];
const PASSIVE_IDS = Object.keys(PASSIVE_BY_ID);

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const UNIQUE_LINE: Record<UniqueEffect, string> = {
  lifesteal: 'Unique: 8% of damage dealt returns as life',
  cull: 'Unique: strikes slay foes under 15% health',
  thorns: 'Unique: attackers take 20% of their blow back',
  echo: 'Unique: 10% chance a hit strikes twice',
};

const cache = new Map<string, ItemDef | null>();

/** The full definition behind an id (memoised). Null for an unknown id. */
export function itemDef(id: string | null | undefined): ItemDef | undefined {
  if (!id) return undefined;
  const hit = cache.get(id);
  if (hit !== undefined) return hit ?? undefined;
  const built = derive(id);
  cache.set(id, built);
  return built ?? undefined;
}

function scaled(v: number | undefined, mult: number): number | undefined {
  if (v === undefined) return undefined;
  return Math.max(v > 0 ? 1 : 0, Math.round(v * mult * 10) / 10);
}

function derive(id: string): ItemDef | null {
  const d = decodeItemId(id);
  if (!d) return null;
  const base = ITEMS[d.base];
  if (!base) return null;
  // A plain catalog id IS its base — the classic relics keep their numbers.
  if (!id.includes('@') && !id.includes('#')) return base;
  if (base.slot === 'material' || base.slot === 'consumable') {
    return { ...base, id, base: base.id, count: d.count, name: d.count > 1 ? `${base.name} ×${d.count}` : base.name };
  }
  const power = powerScale(d.ilvl);
  const mult = power * RARITY_MULT[d.rarity] * (1 + 0.05 * d.upgrade);
  const weapon = base.slot === 'mainHand';
  const derivedBonus = foldAffixes(d.affixes, power);
  const bonus: NonNullable<ItemDef['bonus']> = { ...(base.bonus ?? {}) };
  if (derivedBonus.hp) bonus.hp = (bonus.hp ?? 0) + Math.round(derivedBonus.hp * power);
  if (derivedBonus.dmg) bonus.dmg = (bonus.dmg ?? 0) + derivedBonus.dmg;
  if (derivedBonus.armor) bonus.armor = (bonus.armor ?? 0) + Math.round(derivedBonus.armor * 10) / 10;
  if (derivedBonus.dodge) bonus.dodge = (bonus.dodge ?? 0) + derivedBonus.dodge;
  const prefix = d.affixes.find((a) => AFFIXES[a.key].kind === 'prefix');
  const suffix = d.affixes.find((a) => AFFIXES[a.key].kind === 'suffix');
  let name = base.uniqueOnly ? base.name : `${prefix ? `${AFFIXES[prefix.key].name} ` : ''}${base.name}${suffix ? ` ${AFFIXES[suffix.key].name}` : ''}`;
  if (d.upgrade > 0) name += ` +${d.upgrade}`;
  const lines = d.affixes.map((a) => affixLine(a, power));
  let unique: UniqueEffect | undefined;
  let passive: string | undefined;
  if (d.rarity === 'legendary' || d.rarity === 'mythic') {
    unique = UNIQUES[hashStr(d.base) % UNIQUES.length];
    lines.push(UNIQUE_LINE[unique]);
  }
  if (d.rarity === 'mythic' && PASSIVE_IDS.length) {
    passive = PASSIVE_IDS[hashStr(`${d.base}:p`) % PASSIVE_IDS.length];
    const p = PASSIVE_BY_ID[passive];
    if (p) lines.push(`Passive: ${p.name} — ${p.hint}`);
  }
  const def: ItemDef = {
    ...base,
    id,
    name,
    rarity: d.rarity,
    base: d.base,
    ilvl: d.ilvl,
    upgrade: d.upgrade,
    affixes: d.affixes,
    affixLines: lines,
    unique,
    passive,
    minDamage: scaled(base.minDamage, mult),
    maxDamage: scaled(base.maxDamage, mult),
    armor: scaled(base.armor, mult),
    bonus: Object.keys(bonus).length ? bonus : undefined,
  };
  if (def.minDamage !== undefined && def.maxDamage !== undefined && def.maxDamage < def.minDamage) def.maxDamage = def.minDamage;
  // Weapons keep whole numbers for the roll; armor may carry a tenth.
  if (weapon) {
    if (def.minDamage !== undefined) def.minDamage = Math.round(def.minDamage);
    if (def.maxDamage !== undefined) def.maxDamage = Math.round(def.maxDamage);
  }
  return def;
}

/** Engine levers from a worn instance (affix points folded, plus unique / passive). */
export function itemLevers(def: ItemDef): ReturnType<typeof foldAffixes> {
  const power = powerScale(def.ilvl ?? 1);
  return foldAffixes(def.affixes ?? [], power);
}

// ---- Rolling ------------------------------------------------------------------

export interface RollOptions {
  /** Never below this rarity. */
  floor?: Rarity;
  /** Multiplies the weight of every rarity above common (deeper floors, bosses). */
  luck?: number;
  /** Custom weights (the forge's table). */
  weights?: Partial<Record<Rarity, number>>;
}

export function rollRarity(rand: () => number, opts: RollOptions = {}): Rarity {
  const luck = opts.luck ?? 1;
  const floorIx = opts.floor ? RARITY_ORDER.indexOf(opts.floor) : 0;
  const weights = RARITY_ORDER.map((r, i) => {
    if (i < floorIx) return 0;
    const w = opts.weights ? (opts.weights[r] ?? 0) : RARITY_WEIGHT[r];
    return i === 0 ? w : w * luck;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let x = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return RARITY_ORDER[i];
  }
  return RARITY_ORDER[floorIx];
}

const SLOT_WEIGHT: Array<[ItemDef['slot'], number]> = [
  ['mainHand', 34],
  ['torso', 16],
  ['head', 12],
  ['legs', 10],
  ['offHand', 10],
  ['cloak', 8],
  ['ring', 10],
];

/** Pick a base for a rarity at a level: registry bases whose band holds the level. */
export function pickBase(rand: () => number, ilvl: number, rarity: Rarity, slot?: ItemDef['slot']): ItemDef {
  const unique = (rarity === 'legendary' || rarity === 'mythic') && rand() < 0.6;
  let pool = gearBases().filter((d) => (unique ? d.uniqueOnly : !d.uniqueOnly) && (!d.band || (d.band[0] <= ilvl + 2 && d.band[1] >= ilvl - 2)));
  if (!slot) {
    const total = SLOT_WEIGHT.reduce((s, [, w]) => s + w, 0);
    let x = rand() * total;
    slot = SLOT_WEIGHT[SLOT_WEIGHT.length - 1][0];
    for (const [s, w] of SLOT_WEIGHT) {
      x -= w;
      if (x <= 0) {
        slot = s;
        break;
      }
    }
  }
  const bySlot = pool.filter((d) => d.slot === slot);
  if (bySlot.length) pool = bySlot;
  if (!pool.length) pool = gearBases().filter((d) => !d.uniqueOnly);
  return pool[Math.floor(rand() * pool.length)];
}

/** Roll a full instance id at a level. */
export function rollGear(rand: () => number, ilvl: number, opts: RollOptions & { slot?: ItemDef['slot']; base?: string } = {}): string {
  const rarity = rollRarity(rand, opts);
  const base = opts.base ? ITEMS[opts.base] : pickBase(rand, ilvl, rarity, opts.slot);
  const lvl = Math.max(1, Math.min(100, ilvl + Math.floor(rand() * 4) - 1));
  const affixes = rollAffixes(RARITY_AFFIX_COUNT[rarity], lvl, base.slot === 'mainHand', rand);
  return encodeItemId({ base: base.id, ilvl: lvl, rarity, upgrade: 0, affixes });
}

/** Materials fall too (it.78): scraps mostly, dust sometimes, an essence rarely. */
export function rollMaterial(rand: () => number, ilvl: number): string {
  const tier = 1 + Math.floor(ilvl / 25);
  const r = rand();
  if (r < 0.7) return `iron_scrap#${1 + Math.floor(rand() * 2 * tier)}`;
  if (r < 0.95) return `arcane_dust#${Math.max(1, Math.floor(rand() * tier))}`;
  return 'essence#1';
}

/**
 * A slain foe's drop: nothing 40% of the time; otherwise gear (55%), a
 * draught (30%) or materials (15%). Luck grows with the level.
 */
export function rollDrop(rand: () => number, ilvl: number): string | null {
  if (rand() >= 0.6) return null;
  const kind = rand();
  if (kind < 0.3) {
    const r = rand();
    return r < 0.55 ? 'health_potion' : r < 0.85 ? 'mana_potion' : 'elixir';
  }
  if (kind < 0.45) return rollMaterial(rand, ilvl);
  return rollGear(rand, ilvl, { luck: 1 + ilvl / 40 });
}

/** A chest's item: gear, never below uncommon. */
export function rollChestItem(rand: () => number, ilvl: number): string {
  return rollGear(rand, ilvl, { floor: 'uncommon', luck: 1.2 + ilvl / 40 });
}

/** A boss trophy: rare at least; one in six comes up legendary, mythic once in sixty. */
export function rollRareItem(rand: () => number, ilvl: number): string {
  const r = rand();
  if (r < 1 / 60) return rollGear(rand, ilvl, { floor: 'mythic' });
  if (r < 1 / 6) return rollGear(rand, ilvl, { floor: 'legendary', weights: { legendary: 9, mythic: 1 } });
  return rollGear(rand, ilvl, { floor: 'rare', weights: { rare: 70, epic: 30 } });
}

/** The economy's rarity multiplier, for panels. */
export function rarityMult(r: Rarity): number {
  return RARITY_MULT[r];
}

/** Quick check for the catalog's bases (a saved id is valid when its base is). */
export function isKnownItem(id: string): boolean {
  return !!itemDef(id);
}
