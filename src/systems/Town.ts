/**
 * @module systems/Town
 * The town economy (it.39, overhauled it.78): the merchants' seeded stock,
 * buying and selling, the buyback counter and the shared stash. Every
 * mutation arrives as an InputCommand drained inside the fixed tick
 * (BUY / SELL / BUYBACK / STASH_*), so the DOM panels never touch the
 * player directly and the flow stays replicable across four peers.
 *
 * THE ECONOMY (it.78):
 *   value      = (iLvl × 15) × rarityMult × (1 + 0.15 × upgrade)   (items/catalog)
 *   buy        = 100% of value            sell = 25% of value
 *   buyback    = the last fifteen sold pieces, bought back for what was paid
 *   restock    every 30 in-game minutes (108,000 ticks) or when a warden's
 *              arena is cleared — the tables roll at the deepest depth's
 *              item level, so the armorer keeps pace with the crypt.
 * Gold stays scarce: piles scale by half the power curve, prices by all of
 * it, and the forge's reinforcement costs grow with the square of the level.
 */

import { eventBus } from '@/core/EventBus';
import type { InputCommand } from '@/core/InputQueue';
import type { Player } from '@/entities/Player';
import { ITEMS, itemValue, type ItemDef } from '@/items/catalog';
import { ilvlForDepth, itemDef, rollGear } from '@/items/instance';
import { ENCHANTS } from '@/items/effects';
import type { StashState } from '@/persist/SaveGame';
import { mulberry32 } from '@/utils/rng';

export const STASH_CAPACITY = 24;
/** Merchants pay a quarter of an item's worth. */
export const SELL_RATIO = 0.25;
/** How many sold items the merchant keeps on the counter for buyback. */
export const BUYBACK_CAPACITY = 15;
/** Thirty in-game minutes at 60 Hz. */
export const RESTOCK_TICKS = 30 * 60 * 60;

export class TownSystem {
  /** Item ids on the ARMORER's table (a purchase removes it; restocks on the timer). */
  stock: string[] = [];
  /** Item ids on the ALCHEMIST's table (it.48): draughts and scrolls. */
  stockAlch: string[] = [];
  /**
   * BUYBACK (it.40, it.78): what the hero sold, newest first. Bought back
   * for exactly what the merchant paid; the last fifteen survive a restock.
   */
  buyback: string[] = [];
  readonly stash: StashState;
  /** The tick the tables last rolled (−∞ before the first). */
  lastRestockTick = -Infinity;
  /** Times the tables have rolled this run (part of the roll's seed). */
  restockSerial = 0;
  /** A warden fell since the last roll: the next check restocks. */
  private bossCleared = false;

  constructor(
    /** CO-OP (it.59): resolve the hero behind a command's seat (null = nobody there). */
    private readonly getPlayer: (slot: number) => Player | null,
    stash: StashState,
  ) {
    this.stash = { items: [...stash.items], gold: stash.gold };
  }

  /** A warden's arena was cleared: the merchants restock on the next check. */
  markBossCleared(): void {
    this.bossCleared = true;
  }

  /** Ticks until the timer restocks (0 when a roll is due). */
  ticksToRestock(tick: number): number {
    if (this.bossCleared || !Number.isFinite(this.lastRestockTick)) return 0;
    return Math.max(0, this.lastRestockTick + RESTOCK_TICKS - tick);
  }

  /** Called every tick in town and on every visit: rolls when the timer or a warden says so. */
  restockIfDue(seed: number, deepestFloor: number, tick: number): boolean {
    if (this.ticksToRestock(tick) > 0) return false;
    this.restock(seed, deepestFloor, this.restockSerial + 1, tick);
    return true;
  }

  /**
   * Roll the tables: the ARMORER's staples and six pieces at the deepest
   * depth's level (uncommon and rare mostly, an epic now and then) plus
   * material packs; the ALCHEMIST's draughts. Seeded from (seed, serial) so
   * every peer, and a reload, sees the same counter.
   */
  restock(seed: number, deepestFloor: number, serial: number, tick = 0): void {
    const rand = mulberry32((seed ^ (serial * 0x9e37)) >>> 0);
    const ilvl = ilvlForDepth(Math.max(1, deepestFloor));
    const stock: string[] = [];
    // Two plain pieces for the fresh delver, then rolled gear.
    const staples = ['rusty_sword', 'short_bow', 'plank_shield', 'iron_cap', 'leather_jerkin', 'worn_boots', 'flanged_mace', 'war_axe'];
    for (let i = 0; i < 2; i++) stock.push(staples[Math.floor(rand() * staples.length)]);
    for (let i = 0; i < 6; i++) {
      stock.push(rollGear(rand, ilvl, { floor: 'uncommon', weights: { uncommon: 55, rare: 35, epic: 9, legendary: 1 } }));
    }
    // Material packs (it.78): the forge's staples are for sale.
    stock.push('iron_scrap#5', 'iron_scrap#5', 'arcane_dust#2');
    if (deepestFloor >= 5) stock.push('essence#1');
    if (deepestFloor >= 10) stock.push('alloy_shard#1');
    this.stock = [...new Set(stock.filter((id) => !!itemDef(id)))];
    // The ALCHEMIST (it.49): every draught the catalog knows, deeper delvers get more elixirs.
    const alch = ['health_potion', 'health_potion', 'health_potion', 'mana_potion', 'mana_potion', 'elixir', 'rejuvenation'];
    if (deepestFloor >= 3) alch.push('potion_haste', 'potion_stone');
    if (deepestFloor >= 5) alch.push('elixir', 'mana_potion', 'greater_health', 'greater_mana', 'potion_might');
    // A RECIPE ON THE COUNTER (it.80): one scroll the depth allows, now and then.
    if (deepestFloor >= 2 && rand() < 0.6) {
      const keys = Object.values(ENCHANTS).filter((r) => r.depth <= deepestFloor).map((r) => r.key);
      if (keys.length) alch.push(`recipe_${keys[Math.floor(rand() * keys.length)]}`);
    }
    this.stockAlch = alch.filter((id) => id in ITEMS);
    this.restockSerial = serial;
    this.lastRestockTick = tick;
    this.bossCleared = false;
    eventBus.emit('town:changed', {});
  }

  buyPrice(def: ItemDef): number {
    return itemValue(def);
  }

  sellPrice(def: ItemDef): number {
    return Math.max(1, Math.round(itemValue(def) * SELL_RATIO));
  }

  /** Apply one tick's commands (shares the drained array with the other systems). */
  apply(commands: ReadonlyArray<InputCommand>): void {
    for (const cmd of commands) {
      const p = this.getPlayer(cmd.playerId);
      if (!p) continue;
      switch (cmd.type) {
        case 'BUY': {
          const table = cmd.vendor === 'alchemist' ? this.stockAlch : this.stock;
          const id = table[cmd.index];
          const def = itemDef(id);
          if (!def) break;
          const price = this.buyPrice(def);
          if (p.gold < price) {
            eventBus.emit('town:refused', { reason: 'gold' });
            break;
          }
          p.gold -= price;
          table.splice(cmd.index, 1);
          p.addItem(def.id);
          eventBus.emit('town:changed', {});
          eventBus.emit('town:traded', { kind: 'buy', itemId: def.id, gold: price });
          break;
        }
        case 'SELL': {
          const id = p.backpack[cmd.backpackIndex];
          const def = itemDef(id);
          if (!def) break;
          const price = this.sellPrice(def);
          p.backpack.splice(cmd.backpackIndex, 1);
          p.gold += price;
          this.buyback.unshift(def.id);
          if (this.buyback.length > BUYBACK_CAPACITY) this.buyback.length = BUYBACK_CAPACITY;
          eventBus.emit('inventory:changed', {});
          eventBus.emit('town:changed', {});
          eventBus.emit('town:traded', { kind: 'sell', itemId: def.id, gold: price });
          break;
        }
        case 'BUYBACK': {
          const id = this.buyback[cmd.index];
          const def = itemDef(id);
          if (!def) break;
          const price = this.sellPrice(def);
          if (p.gold < price) {
            eventBus.emit('town:refused', { reason: 'gold' });
            break;
          }
          p.gold -= price;
          this.buyback.splice(cmd.index, 1);
          p.addItem(def.id);
          eventBus.emit('town:changed', {});
          eventBus.emit('town:traded', { kind: 'buy', itemId: def.id, gold: price });
          break;
        }
        case 'STASH_PUT': {
          const id = p.backpack[cmd.backpackIndex];
          if (!id) break;
          if (this.stash.items.length >= STASH_CAPACITY) {
            eventBus.emit('town:refused', { reason: 'stashFull' });
            break;
          }
          p.backpack.splice(cmd.backpackIndex, 1);
          this.stash.items.push(id);
          eventBus.emit('inventory:changed', {});
          eventBus.emit('town:changed', {});
          break;
        }
        case 'STASH_TAKE': {
          const id = this.stash.items[cmd.index];
          if (!id) break;
          this.stash.items.splice(cmd.index, 1);
          p.addItem(id);
          eventBus.emit('town:changed', {});
          break;
        }
        case 'STASH_GOLD': {
          // Positive = deposit, negative = withdraw; clamped to what exists.
          const amount = cmd.amount > 0 ? Math.min(cmd.amount, p.gold) : -Math.min(-cmd.amount, this.stash.gold);
          if (amount === 0) break;
          p.gold -= amount;
          this.stash.gold += amount;
          eventBus.emit('inventory:changed', {});
          eventBus.emit('town:changed', {});
          break;
        }
        default:
          break;
      }
    }
  }
}
