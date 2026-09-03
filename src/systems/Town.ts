/**
 * @module systems/Town
 * The town economy (it.39): the merchant's seeded stock, buying/selling,
 * and the shared stash. Every mutation arrives as an InputCommand drained
 * inside the fixed tick (BUY / SELL / STASH_PUT / STASH_TAKE / STASH_GOLD),
 * so the DOM panels never touch the player directly and the flow stays
 * replicable. The stash lives on the SAVE SLOT (it survives restarts of
 * that slot); the run hands it in and reads it back on save.
 */

import { eventBus } from '@/core/EventBus';
import type { InputCommand } from '@/core/InputQueue';
import type { Player } from '@/entities/Player';
import { ITEMS, itemValue, type ItemDef } from '@/items/catalog';
import type { StashState } from '@/persist/SaveGame';
import { mulberry32 } from '@/utils/rng';

export const STASH_CAPACITY = 24;
/** Merchants pay a quarter of an item's worth. */
export const SELL_RATIO = 0.25;
/** How many sold items the merchant keeps on the counter for buyback. */
export const BUYBACK_CAPACITY = 8;

export class TownSystem {
  /** Item ids on the ARMORER's table (a purchase removes it; restocks per visit). */
  stock: string[] = [];
  /** Item ids on the ALCHEMIST's table (it.48): draughts and scrolls. */
  stockAlch: string[] = [];
  /**
   * BUYBACK (it.40): what the hero sold this visit, newest first. Bought
   * back for exactly what the merchant paid; capped, and cleared when the
   * table restocks — nothing lingers on the counter forever.
   */
  buyback: string[] = [];
  readonly stash: StashState;

  constructor(
    /** CO-OP (it.59): resolve the hero behind a command's seat (null = nobody there). */
    private readonly getPlayer: (slot: number) => Player | null,
    stash: StashState,
  ) {
    this.stash = { items: [...stash.items], gold: stash.gold };
  }

  /**
   * Restock for a town visit: staples always, plus a few magic pieces
   * scaled to how deep the hero has been. Seeded from (seed, visit) so a
   * reload shows the same table.
   */
  restock(seed: number, deepestFloor: number, visit: number): void {
    const rand = mulberry32((seed ^ (visit * 0x9e37)) >>> 0);
    const staples = ['health_potion', 'health_potion', 'health_potion', 'mana_potion', 'mana_potion', 'elixir'];
    const gear = ['rusty_sword', 'short_bow', 'plank_shield', 'iron_cap', 'leather_jerkin', 'worn_boots', 'flanged_mace', 'war_axe'];
    const magic = Object.values(ITEMS).filter((d) => d.rarity === 'magic' && d.slot !== 'consumable').map((d) => d.id);
    const rare = Object.values(ITEMS).filter((d) => d.rarity === 'rare' && d.slot !== 'consumable').map((d) => d.id);
    // TWO VENDORS (it.48): the ARMORER sells arms and armor, the ALCHEMIST
    // sells every draught and scroll.
    const stock: string[] = [];
    for (let i = 0; i < 4; i++) stock.push(gear[Math.floor(rand() * gear.length)]);
    const magicCount = deepestFloor >= 3 ? 2 : 1;
    for (let i = 0; i < magicCount; i++) stock.push(magic[Math.floor(rand() * magic.length)]);
    if (deepestFloor >= 8 && rand() < 0.5) stock.push(rare[Math.floor(rand() * rare.length)]);
    this.stock = [...new Set(stock.filter((id) => id in ITEMS))];
    // The ALCHEMIST (it.49): every draught the catalog knows, deeper delvers get more elixirs.
    const alch = [...staples];
    for (const d of Object.values(ITEMS)) if (d.slot === 'consumable' && !d.use?.portal && !alch.includes(d.id)) alch.push(d.id);
    if (deepestFloor >= 5) alch.push('elixir', 'mana_potion');
    this.stockAlch = alch.filter((id) => id in ITEMS);
    this.buyback = [];
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
          const def = id ? ITEMS[id] : undefined;
          if (!def) break;
          const price = this.buyPrice(def);
          if (p.gold < price) {
            eventBus.emit('town:refused', { reason: 'gold' });
            break;
          }
          p.gold -= price;
          table.splice(cmd.index, 1);
          p.addItem(def.id);
          eventBus.emit('town:traded', { kind: 'buy', itemId: def.id, gold: price });
          break;
        }
        case 'SELL': {
          const id = p.backpack[cmd.backpackIndex];
          const def = id ? ITEMS[id] : undefined;
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
          const def = id ? ITEMS[id] : undefined;
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
