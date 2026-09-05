/**
 * @module ui/itemFilter
 * FILTERS AND SORTING FOR EVERY ITEM LIST (it.81): the inventory pack, the
 * merchants' counters, the stash, the forge. One toolbar, one state per
 * panel (remembered in localStorage), one comparator. Lists render in the
 * chosen order but every row keeps its ORIGINAL index, so the commands
 * the rows enqueue (equip, sell, salvage…) still name the right item.
 *
 * Also the EFFECT BORDER classes (`effectClass`): an item that procs a
 * status, grants a trait, carries an enchantment or a legendary unique
 * wears a distinct border wherever it is drawn, so the special pieces are
 * spotted at a glance. The codex explains the colours.
 */

import { RARITY_ORDER, type ItemDef } from '@/items/catalog';
import { itemValue } from '@/items/catalog';

export type FilterKey = 'all' | 'weapon' | 'armor' | 'jewelry' | 'draught' | 'scroll' | 'effect';
export type SortKey = 'default' | 'level' | 'rarity' | 'name' | 'type' | 'value';

export interface FilterState {
  filter: FilterKey;
  sort: SortKey;
  desc: boolean;
}

const FILTERS: Array<[FilterKey, string, string]> = [
  ['all', 'ALL', 'Everything'],
  ['weapon', 'ARMS', 'Weapons'],
  ['armor', 'ARMOR', 'Head, body, legs, shields, cloaks'],
  ['jewelry', 'JEWELS', 'Rings and amulets'],
  ['draught', 'DRAUGHTS', 'Potions and brews'],
  ['scroll', 'SCROLLS', 'Recipes and portal scrolls'],
  ['effect', 'SPECIAL', 'Pieces with an effect: procs, traits, enchantments, uniques'],
];

const SORTS: Array<[SortKey, string]> = [
  ['default', 'AS FOUND'],
  ['level', 'LEVEL'],
  ['rarity', 'RARITY'],
  ['type', 'TYPE'],
  ['name', 'NAME'],
  ['value', 'VALUE'],
];

const SLOT_RANK: Record<string, number> = { mainHand: 0, offHand: 1, head: 2, torso: 3, legs: 4, cloak: 5, ring: 6, consumable: 7, material: 8 };

export function matchesFilter(def: ItemDef, f: FilterKey): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'weapon':
      return def.slot === 'mainHand';
    case 'armor':
      return def.slot === 'head' || def.slot === 'torso' || def.slot === 'legs' || def.slot === 'offHand' || def.slot === 'cloak';
    case 'jewelry':
      return def.slot === 'ring';
    case 'draught':
      return def.slot === 'consumable' && !def.use?.recipe && !def.use?.portal;
    case 'scroll':
      return def.slot === 'consumable' && (!!def.use?.recipe || !!def.use?.portal);
    case 'effect':
      return !!effectClass(def);
  }
}

export function compareItems(a: ItemDef, b: ItemDef, s: SortKey): number {
  switch (s) {
    case 'level':
      return (b.ilvl ?? 0) - (a.ilvl ?? 0) || (b.upgrade ?? 0) - (a.upgrade ?? 0);
    case 'rarity':
      return RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || (b.ilvl ?? 0) - (a.ilvl ?? 0);
    case 'type':
      return (SLOT_RANK[a.slot] ?? 9) - (SLOT_RANK[b.slot] ?? 9) || (a.weaponKind ?? '').localeCompare(b.weaponKind ?? '') || (b.ilvl ?? 0) - (a.ilvl ?? 0);
    case 'name':
      return a.name.localeCompare(b.name);
    case 'value':
      return itemValue(b) - itemValue(a);
    default:
      return 0;
  }
}

/** Order the list's original indexes by the state; `defs[i]` may be undefined (skipped). */
export function orderIndexes(defs: Array<ItemDef | undefined>, state: FilterState): number[] {
  const out: number[] = [];
  defs.forEach((d, i) => {
    if (d && matchesFilter(d, state.filter)) out.push(i);
  });
  if (state.sort !== 'default') {
    out.sort((i, j) => {
      const c = compareItems(defs[i]!, defs[j]!, state.sort);
      return state.desc ? -c : c;
    });
  } else if (state.desc) out.reverse();
  return out;
}

/** The border class for a piece with an effect, or '' for a plain one. */
export function effectClass(def: ItemDef): string {
  if (def.unique) return 'fx-unique';
  if (def.enchant) return 'fx-ench';
  const fx = def.effects ?? [];
  if (fx.some((e) => e.proc)) return 'fx-proc';
  if (fx.some((e) => e.trait)) return 'fx-trait';
  return '';
}

const KEY = (panel: string): string => `iso-arpg-filter-${panel}`;

export function loadFilter(panel: string): FilterState {
  try {
    const raw = localStorage.getItem(KEY(panel));
    if (raw) {
      const v = JSON.parse(raw) as Partial<FilterState>;
      if (v && typeof v === 'object') return { filter: (v.filter as FilterKey) ?? 'all', sort: (v.sort as SortKey) ?? 'default', desc: !!v.desc };
    }
  } catch {
    /* ignore */
  }
  return { filter: 'all', sort: 'default', desc: false };
}

export function saveFilter(panel: string, s: FilterState): void {
  try {
    localStorage.setItem(KEY(panel), JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** The toolbar's markup: filter chips and a sort menu. `compact` drops the chip labels to glyphs on a phone. */
export function filterBarHtml(state: FilterState, opts: { filters?: FilterKey[]; sorts?: SortKey[]; id?: string } = {}): string {
  const fl = FILTERS.filter(([k]) => !opts.filters || opts.filters.includes(k));
  const sl = SORTS.filter(([k]) => !opts.sorts || opts.sorts.includes(k));
  const chips = fl.map(([k, label, tip]) => `<button type="button" class="if-chip${state.filter === k ? ' on' : ''}" data-if-filter="${k}" title="${tip}">${label}</button>`).join('');
  const sorts = sl.map(([k, label]) => `<option value="${k}"${state.sort === k ? ' selected' : ''}>${label}</option>`).join('');
  return `<div class="if-bar"${opts.id ? ` id="${opts.id}"` : ''}><div class="if-chips">${chips}</div><label class="if-sort"><span>SORT</span><select data-if-sort>${sorts}</select><button type="button" class="if-dir${state.desc ? ' on' : ''}" data-if-dir title="Reverse the order">${state.desc ? '▲' : '▼'}</button></label></div>`;
}

/** Wire a rendered toolbar: every change updates `state`, saves it and calls `rerender`. */
export function wireFilterBar(root: HTMLElement, panel: string, state: FilterState, rerender: () => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-if-filter]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      state.filter = (b.dataset.ifFilter as FilterKey) ?? 'all';
      saveFilter(panel, state);
      rerender();
    });
  });
  root.querySelector<HTMLSelectElement>('[data-if-sort]')?.addEventListener('change', (e) => {
    state.sort = ((e.target as HTMLSelectElement).value as SortKey) ?? 'default';
    saveFilter(panel, state);
    rerender();
  });
  root.querySelector<HTMLButtonElement>('[data-if-dir]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.desc = !state.desc;
    saveFilter(panel, state);
    rerender();
  });
}
