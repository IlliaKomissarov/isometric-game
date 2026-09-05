/**
 * @module items/compare
 * Pure item-versus-item arithmetic for the hover card (it.76): every
 * comparable number an item carries, laid beside the piece worn in the same
 * slot, with a signed delta and a one-word verdict. No DOM, no player — the
 * caller resolves "yours" (see `ui/itemTip.wornFor`) so the shop, the stash
 * and the inventory all read the same table.
 */

import { WEAPON_FAMILY, WEAPON_TIMING, type ItemDef } from './catalog';
import { itemLevers } from './instance';

/** One line of the table: the candidate's value, the worn value, how to print them. */
export interface CompareRow {
  key: string;
  label: string;
  /** Candidate (the hovered item) and the worn piece, as numbers for the delta. */
  a: number;
  b: number;
  /** Printed forms (damage prints a range, not its average). */
  aText: string;
  bText: string;
  /** Signed delta text, or '' when equal / not comparable. */
  delta: string;
  /** Which way the delta leans for the hovered item. */
  lean: 'up' | 'down' | 'same';
}

export type Verdict = 'upgrade' | 'downgrade' | 'tradeoff' | 'equal';

export interface Comparison {
  rows: CompareRow[];
  verdict: Verdict;
}

/** The comparable numbers of an item, zero when absent. */
export interface ItemStats {
  dmgMin: number;
  dmgMax: number;
  /** Swings per second at the family's base timing (class speed cancels out). */
  speed: number;
  range: number;
  crit: number;
  stuns: boolean;
  armor: number;
  hp: number;
  dmgPct: number;
  dodge: number;
  regen: number;
  /** Affix levers (it.78). */
  aspd: number;
  cdr: number;
  resist: number;
  regrowth: number;
}

export function itemStats(def: ItemDef | null): ItemStats {
  if (!def) return { dmgMin: 0, dmgMax: 0, speed: 0, range: 0, crit: 0, stuns: false, armor: 0, hp: 0, dmgPct: 0, dodge: 0, regen: 0, aspd: 0, cdr: 0, resist: 0, regrowth: 0 };
  const lv = itemLevers(def);
  const weapon = def.slot === 'mainHand';
  const kind = def.weaponKind ?? 'blade';
  const timing = WEAPON_TIMING[kind];
  const family = WEAPON_FAMILY[kind];
  return {
    dmgMin: def.minDamage ?? 0,
    dmgMax: def.maxDamage ?? 0,
    speed: weapon ? (60 / (timing.windup + timing.recover)) * (1 + lv.attackSpeed) : 0,
    range: weapon ? (def.range ?? family.range) : 0,
    crit: (weapon ? family.critChance : 0) + lv.crit,
    stuns: weapon ? family.stuns : false,
    armor: (def.armor ?? 0) + (def.bonus?.armor ?? 0),
    hp: def.bonus?.hp ?? 0,
    dmgPct: def.bonus?.dmg ?? 0,
    dodge: def.bonus?.dodge ?? 0,
    regen: def.bonus?.regen ?? 0,
    aspd: lv.attackSpeed,
    cdr: lv.cdr,
    resist: lv.resist,
    regrowth: lv.hpRegen,
  };
}

const fmt1 = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const signed = (n: number, print: (v: number) => string): string => (n === 0 ? '' : `${n > 0 ? '+' : '−'}${print(Math.abs(n))}`);

interface RowSpec {
  key: keyof ItemStats;
  label: string;
  print: (v: number) => string;
  /** Damage prints the range; the delta uses the average. */
  text?: (s: ItemStats) => string;
  value?: (s: ItemStats) => number;
}

const ROWS: RowSpec[] = [
  { key: 'dmgMax', label: 'Damage', print: fmt1, text: (s) => (s.dmgMax ? `${s.dmgMin}–${s.dmgMax}` : '—'), value: (s) => (s.dmgMin + s.dmgMax) / 2 },
  { key: 'speed', label: 'Speed', print: (v) => `${fmt1(Math.round(v * 10) / 10)}/s` },
  { key: 'range', label: 'Reach', print: fmt1 },
  { key: 'crit', label: 'Crit', print: pct },
  { key: 'armor', label: 'Armor', print: fmt1 },
  { key: 'hp', label: 'Max HP', print: fmt1 },
  { key: 'dmgPct', label: 'Damage %', print: pct },
  { key: 'dodge', label: 'Dodge', print: pct },
  { key: 'regen', label: 'Regen', print: pct },
  { key: 'cdr', label: 'Cooldowns', print: pct },
  { key: 'resist', label: 'Resist', print: pct },
  { key: 'regrowth', label: 'Regrowth', print: (v) => `${fmt1(Math.round(v * 10) / 10)}/s` },
];

/**
 * Lay `candidate` beside `worn` (null = the slot is empty). Rows appear when
 * either side has a value; the verdict counts the leans.
 */
export function compareItems(candidate: ItemDef, worn: ItemDef | null): Comparison {
  const a = itemStats(candidate);
  const b = itemStats(worn);
  const rows: CompareRow[] = [];
  for (const spec of ROWS) {
    const av = spec.value ? spec.value(a) : (a[spec.key] as number);
    const bv = spec.value ? spec.value(b) : (b[spec.key] as number);
    if (av === 0 && bv === 0) continue;
    const d = Math.round((av - bv) * 100) / 100;
    rows.push({
      key: spec.key,
      label: spec.label,
      a: av,
      b: bv,
      aText: spec.text ? spec.text(a) : av ? spec.print(av) : '—',
      bText: spec.text ? spec.text(b) : bv ? spec.print(bv) : '—',
      delta: signed(d, spec.print),
      lean: d > 0 ? 'up' : d < 0 ? 'down' : 'same',
    });
  }
  if (a.stuns !== b.stuns) {
    rows.push({ key: 'stuns', label: 'Stagger', a: a.stuns ? 1 : 0, b: b.stuns ? 1 : 0, aText: a.stuns ? 'every hit' : '—', bText: b.stuns ? 'every hit' : '—', delta: a.stuns ? 'gained' : 'lost', lean: a.stuns ? 'up' : 'down' });
  } else if (a.stuns) {
    rows.push({ key: 'stuns', label: 'Stagger', a: 1, b: 1, aText: 'every hit', bText: 'every hit', delta: '', lean: 'same' });
  }
  const ups = rows.filter((r) => r.lean === 'up').length;
  const downs = rows.filter((r) => r.lean === 'down').length;
  const verdict: Verdict = ups && downs ? 'tradeoff' : ups ? 'upgrade' : downs ? 'downgrade' : 'equal';
  return { rows, verdict };
}

/** The stat rows of one item on its own (the worn piece hovered on the doll). */
export function soloRows(def: ItemDef): CompareRow[] {
  return compareItems(def, null).rows;
}
