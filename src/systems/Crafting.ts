/**
 * @module systems/Crafting
 * THE CAMP FORGE (it.78): salvaging, forging, transmutation, affix
 * refinement and reinforcement. Every operation is an InputCommand drained
 * inside the fixed tick (SALVAGE / FORGE / TRANSMUTE / REROLL / REINFORCE),
 * rolled from the run's own seeded `craft` stream, so four peers at the
 * anvil see the same sparks. The DOM panel only reads; it never mutates.
 *
 * THE NUMBERS (documented for the balance sheet):
 *
 *   Salvage   common 2 scrap · uncommon 3 scrap + 1 dust · rare 4 scrap +
 *             2 dust + 1 essence · epic + 2 essence + 1 shard · legendary
 *             + 2 shards + 1 catalyst · mythic + 3 shards + 2 catalysts;
 *             all × (1 + floor(iLvl / 25)).
 *   Transmute 5 scrap → 1 dust · 5 dust → 1 essence · 4 essence → 1 shard ·
 *             3 shards → 1 catalyst.
 *   Forge     a blueprint (any registry base whose band reaches the deepest
 *             depth): scrap 6 + 4·tier, dust 2·tier from tier 2, essence
 *             tier − 1 from tier 3, gold 12 × iLvl. The piece rolls at the
 *             deepest depth's level: uncommon 55 · rare 32 · epic 10 ·
 *             legendary 2.5 · mythic 0.5.
 *   Refine    reroll one affix on rare+ gear: essence 1 + tier, gold 20% of
 *             the item's value. Key and tier reroll; other lines stay.
 *   Reinforce +1 … +15, each +5% on base damage / armor:
 *             +1–3 100% · +4–7 80/70/60/50% · +8–12 40/35/30/25/20% ·
 *             +13–15 15/10/5% (a catalyst each). Gold 35% of value + 12·n²,
 *             scrap 2 + n, dust n − 2 from +4, essence n − 6 from +8. A
 *             failure at +8 or above costs one level; the item survives.
 */

import { eventBus } from '@/core/EventBus';
import type { InputCommand } from '@/core/InputQueue';
import type { Player } from '@/entities/Player';
import { ITEMS, itemValue, type ItemDef, type Rarity } from '@/items/catalog';
import { decodeItemId, encodeItemId, ilvlForDepth, itemDef, rollGear, UPGRADE_MAX } from '@/items/instance';
import { rollAffixes } from '@/items/affixes';
import { gearBases } from '@/items/registry';
import { mulberry32, type Rng } from '@/utils/rng';

export type MaterialId = 'iron_scrap' | 'arcane_dust' | 'essence' | 'alloy_shard' | 'catalyst';
export type Cost = Partial<Record<MaterialId, number>> & { gold?: number };

export const TRANSMUTE_RECIPES: ReadonlyArray<{ id: string; from: MaterialId; take: number; to: MaterialId; give: number }> = [
  { id: 'scrap_dust', from: 'iron_scrap', take: 5, to: 'arcane_dust', give: 1 },
  { id: 'dust_essence', from: 'arcane_dust', take: 5, to: 'essence', give: 1 },
  { id: 'essence_shard', from: 'essence', take: 4, to: 'alloy_shard', give: 1 },
  { id: 'shard_catalyst', from: 'alloy_shard', take: 3, to: 'catalyst', give: 1 },
];

/** Success chance of the NEXT level (index = target level). */
export const REINFORCE_CHANCE: readonly number[] = [1, 1, 1, 1, 0.8, 0.7, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05];

const FORGE_WEIGHTS: Partial<Record<Rarity, number>> = { uncommon: 55, rare: 32, epic: 10, legendary: 2.5, mythic: 0.5 };

const tierOf = (ilvl: number): number => 1 + Math.floor(Math.max(1, ilvl) / 25);

/** What breaking a piece yields. Null when it cannot be salvaged. */
export function salvageYield(def: ItemDef): Cost | null {
  if (def.slot === 'consumable' || def.slot === 'material') return null;
  const t = tierOf(def.ilvl ?? 1);
  const y: Cost = {};
  const add = (k: MaterialId, n: number): void => {
    y[k] = (y[k] ?? 0) + n * t;
  };
  switch (def.rarity) {
    case 'common':
      add('iron_scrap', 2);
      break;
    case 'uncommon':
      add('iron_scrap', 3);
      add('arcane_dust', 1);
      break;
    case 'rare':
      add('iron_scrap', 4);
      add('arcane_dust', 2);
      add('essence', 1);
      break;
    case 'epic':
      add('iron_scrap', 4);
      add('arcane_dust', 3);
      add('essence', 2);
      add('alloy_shard', 1);
      break;
    case 'legendary':
      add('iron_scrap', 5);
      add('arcane_dust', 3);
      add('essence', 3);
      add('alloy_shard', 2);
      add('catalyst', 1);
      break;
    case 'mythic':
      add('iron_scrap', 6);
      add('arcane_dust', 4);
      add('essence', 4);
      add('alloy_shard', 3);
      add('catalyst', 2);
      break;
  }
  return y;
}

/** The forge's price for a base at a level. */
export function forgeCost(base: ItemDef, ilvl: number): Cost {
  const t = tierOf(ilvl);
  const c: Cost = { iron_scrap: 6 + 4 * t, gold: 12 * ilvl };
  if (t >= 2) c.arcane_dust = 2 * t;
  if (t >= 3) c.essence = t - 1;
  if (base.uniqueOnly) c.catalyst = 1;
  return c;
}

/** Blueprints the forge knows at a depth: every non-unique base whose band starts by then. */
export function knownBlueprints(deepestFloor: number): ItemDef[] {
  const lvl = ilvlForDepth(Math.max(1, deepestFloor));
  return gearBases().filter((d) => !d.uniqueOnly && (!d.band || d.band[0] <= lvl + 2));
}

/** Rerolling one affix. */
export function rerollCost(def: ItemDef, affixIndex: number): Cost | null {
  const a = def.affixes?.[affixIndex];
  if (!a) return null;
  if (def.rarity !== 'rare' && def.rarity !== 'epic' && def.rarity !== 'legendary' && def.rarity !== 'mythic') return null;
  return { essence: 1 + a.tier, gold: Math.round(itemValue(def) * 0.2) };
}

/** Reinforcing to the next level. Null at the cap or for a piece that cannot be reinforced. */
export function reinforceCost(def: ItemDef): { next: number; chance: number; cost: Cost; risk: boolean } | null {
  if (def.slot === 'consumable' || def.slot === 'material') return null;
  const up = def.upgrade ?? 0;
  if (up >= UPGRADE_MAX) return null;
  const next = up + 1;
  const cost: Cost = { gold: Math.round(itemValue(def) * 0.35 + 12 * next * next), iron_scrap: 2 + next };
  if (next >= 4) cost.arcane_dust = next - 2;
  if (next >= 8) cost.essence = next - 6;
  if (next >= 13) cost.catalyst = 1;
  return { next, chance: REINFORCE_CHANCE[next], cost, risk: next >= 8 };
}

export function canAfford(p: Player, cost: Cost): boolean {
  if ((cost.gold ?? 0) > p.gold) return false;
  for (const [k, n] of Object.entries(cost)) {
    if (k === 'gold' || !n) continue;
    if ((p.materials.get(k) ?? 0) < n) return false;
  }
  return true;
}

function pay(p: Player, cost: Cost): void {
  p.gold -= cost.gold ?? 0;
  for (const [k, n] of Object.entries(cost)) if (k !== 'gold' && n) p.addMaterial(k, -n);
}

export interface CraftDeps {
  getPlayer: (slot: number) => Player | null;
  /** The forge only works in town. */
  inTown: () => boolean;
  deepestFloor: () => number;
}

export class CraftingEngine {
  private readonly rand: Rng;

  get rngState(): number {
    return this.rand.state;
  }
  set rngState(v: number) {
    this.rand.state = v;
  }

  constructor(
    private readonly deps: CraftDeps,
    seed: number,
  ) {
    this.rand = mulberry32((seed ^ 0x7a3f9d21) >>> 0);
  }

  private refuse(reason: string): void {
    eventBus.emit('craft:result', { ok: false, text: reason });
  }

  private done(text: string, itemId?: string): void {
    eventBus.emit('craft:result', { ok: true, text, itemId });
    eventBus.emit('inventory:changed', {});
  }

  /** Apply one tick's commands (shares the drained array with the other systems). */
  apply(commands: ReadonlyArray<InputCommand>): void {
    for (const cmd of commands) {
      if (cmd.type !== 'SALVAGE' && cmd.type !== 'FORGE' && cmd.type !== 'TRANSMUTE' && cmd.type !== 'REROLL' && cmd.type !== 'REINFORCE') continue;
      const p = this.deps.getPlayer(cmd.playerId);
      if (!p) continue;
      if (!this.deps.inTown()) {
        this.refuse('The forge is in town.');
        continue;
      }
      switch (cmd.type) {
        case 'SALVAGE':
          this.salvage(p, cmd.backpackIndex);
          break;
        case 'FORGE':
          this.forge(p, cmd.base);
          break;
        case 'TRANSMUTE':
          this.transmute(p, cmd.recipe, cmd.times ?? 1);
          break;
        case 'REROLL':
          this.reroll(p, cmd.backpackIndex, cmd.affixIndex);
          break;
        case 'REINFORCE':
          this.reinforce(p, cmd.backpackIndex);
          break;
      }
    }
  }

  private salvage(p: Player, index: number): void {
    const id = p.backpack[index];
    const def = itemDef(id);
    if (!def) return;
    const y = salvageYield(def);
    if (!y) return this.refuse(`${def.name} cannot be salvaged.`);
    p.backpack.splice(index, 1);
    for (const [k, n] of Object.entries(y)) if (k !== 'gold' && n) p.addMaterial(k, n);
    this.done(`${def.name} broken down: ${costText(y)}.`);
  }

  private forge(p: Player, baseId: string): void {
    const base = ITEMS[baseId];
    if (!base || base.slot === 'material' || base.slot === 'consumable') return;
    const ilvl = ilvlForDepth(Math.max(1, this.deps.deepestFloor()));
    if (!knownBlueprints(this.deps.deepestFloor()).some((b) => b.id === baseId)) return this.refuse('The forge does not know that blueprint yet.');
    const cost = forgeCost(base, ilvl);
    if (!canAfford(p, cost)) return this.refuse(`The forge needs ${costText(cost)}.`);
    pay(p, cost);
    const id = rollGear(this.rand, ilvl, { base: baseId, floor: 'uncommon', weights: FORGE_WEIGHTS });
    p.addItem(id);
    const made = itemDef(id);
    this.done(`Forged ${made?.name ?? base.name}.`, id);
  }

  private transmute(p: Player, recipeId: string, times: number): void {
    const r = TRANSMUTE_RECIPES.find((x) => x.id === recipeId);
    if (!r) return;
    const n = Math.max(1, Math.min(50, Math.floor(times)));
    const have = p.materials.get(r.from) ?? 0;
    const batches = Math.min(n, Math.floor(have / r.take));
    if (batches <= 0) return this.refuse(`Transmuting needs ${r.take} ${ITEMS[r.from]?.name ?? r.from}.`);
    p.addMaterial(r.from, -batches * r.take);
    p.addMaterial(r.to, batches * r.give);
    this.done(`${batches * r.take} ${ITEMS[r.from]?.name ?? r.from} became ${batches * r.give} ${ITEMS[r.to]?.name ?? r.to}.`);
  }

  private reroll(p: Player, index: number, affixIndex: number): void {
    const id = p.backpack[index];
    const def = itemDef(id);
    const d = decodeItemId(id ?? '');
    if (!def || !d) return;
    const cost = rerollCost(def, affixIndex);
    if (!cost) return this.refuse('Only rare or better gear can be refined.');
    if (!canAfford(p, cost)) return this.refuse(`Refining needs ${costText(cost)}.`);
    pay(p, cost);
    const keep = d.affixes.filter((_, i) => i !== affixIndex);
    const rolled = rollAffixes(keep.length + 1, d.ilvl, def.slot === 'mainHand', this.rand, keep);
    // The new line takes the old line's place so the card does not shuffle.
    const fresh = rolled[rolled.length - 1];
    const affixes = [...d.affixes];
    affixes[affixIndex] = fresh;
    const next = encodeItemId({ ...d, affixes });
    p.backpack[index] = next;
    const made = itemDef(next);
    this.done(`Refined: ${made?.affixLines?.[affixIndex] ?? 'a new line'}.`, next);
  }

  private reinforce(p: Player, index: number): void {
    const id = p.backpack[index];
    const def = itemDef(id);
    const d = decodeItemId(id ?? '');
    if (!def || !d) return;
    const plan = reinforceCost(def);
    if (!plan) return this.refuse('That cannot be reinforced further.');
    if (!canAfford(p, plan.cost)) return this.refuse(`Reinforcing needs ${costText(plan.cost)}.`);
    pay(p, plan.cost);
    const roll = this.rand();
    if (roll < plan.chance) {
      const next = encodeItemId({ ...d, upgrade: plan.next });
      p.backpack[index] = next;
      this.done(`Reinforced to +${plan.next}.`, next);
      eventBus.emit('craft:reinforced', { ok: true, level: plan.next });
      return;
    }
    if (plan.risk && d.upgrade > 0) {
      const next = encodeItemId({ ...d, upgrade: d.upgrade - 1 });
      p.backpack[index] = next;
      this.done(`The steel cracked: back to +${d.upgrade - 1}.`, next);
    } else {
      this.done(`The steel held at +${d.upgrade}; the materials were spent.`, id);
    }
    eventBus.emit('craft:reinforced', { ok: false, level: d.upgrade });
  }
}

/** "6 Iron Scraps · 2 Arcane Dust · 120 gold" */
export function costText(cost: Cost): string {
  const parts: string[] = [];
  for (const [k, n] of Object.entries(cost)) {
    if (!n) continue;
    if (k === 'gold') parts.push(`${n} gold`);
    else parts.push(`${n} ${ITEMS[k]?.name ?? k}`);
  }
  return parts.join(' · ') || 'nothing';
}
