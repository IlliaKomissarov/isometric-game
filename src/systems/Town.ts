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
 *
 * WHAT A FLOOR EARNS AGAINST WHAT A COUNTER ASKS (it.117; the full rules are
 * the economy block in `items/catalog`). At depth V (iLvl 9) a floor of ~25
 * foes leaves ~90 coins and ~13 finds, and the gear among them sells for ~40
 * apiece: 350-450 gold. The armorer's rare at that depth is 216, the scribe's
 * rite 155, a healing potion 30. One cleared floor buys one good piece, or a
 * rite and a full belt. Income and prices both scale with the item level, so
 * the ratio holds from depth I to depth XX.
 */

import { eventBus } from '@/core/EventBus';
import type { InputCommand, Vendor } from '@/core/InputQueue';
import type { Player } from '@/entities/Player';
import { ITEMS, itemValue, type ItemDef } from '@/items/catalog';
import { ilvlForDepth, itemDef, rollGear } from '@/items/instance';
import { ENCHANTS } from '@/items/effects';
import type { StashState } from '@/persist/SaveGame';
import { ALES, CURIO_DRINKS, CURIO_ORES, CURIO_POTIONS, CURIO_SCROLLS, foodsOfTier, gearBases } from '@/items/registry';
import { mulberry32 } from '@/utils/rng';

/**
 * THE TAVERN KEEPER'S COUNTER (it.114): a sixth table. `Vendor` (core/InputQueue)
 * does not know 'tavern' yet — the integrator adds it there and in the shop's
 * titles; until then the table exists and `tableFor('tavern')` serves it.
 */
export type FoodVendor = Vendor | 'tavern';

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
  /** THE MARKET WARD (it.84): the jeweler's rings and amulets, the scribe's scrolls, the bowyer's bows and staves. */
  stockJewel: string[] = [];
  stockScribe: string[] = [];
  stockBowyer: string[] = [];
  /** THE TAVERN KEEPER (it.114): the larder - bread to a roast, priced by tier. */
  stockTavern: string[] = [];

  /** The table a counter sells from. */
  tableFor(vendor: FoodVendor | undefined): string[] {
    switch (vendor) {
      case 'alchemist':
        return this.stockAlch;
      case 'jeweler':
        return this.stockJewel;
      case 'scribe':
        return this.stockScribe;
      case 'bowyer':
        return this.stockBowyer;
      case 'tavern':
        return this.stockTavern;
      default:
        return this.stock;
    }
  }
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
    // A BITE AT THE ALCHEMIST'S (it.114): three snacks and a meal beside the flasks.
    const pick = (tier: 'snack' | 'meal' | 'feast'): string => {
      const pool = foodsOfTier(tier);
      return pool[Math.floor(rand() * pool.length)].id;
    };
    alch.push(pick('snack'), pick('snack'), pick('snack'), pick('meal'));
    // THE CURIO SHELF (it.115): three of the bake's other flasks, and an ore or two for the forge.
    const any = (family: ItemDef[]): string => family[Math.floor(rand() * family.length)].id;
    alch.push(any(CURIO_POTIONS), any(CURIO_POTIONS), any(CURIO_POTIONS), any(CURIO_ORES));
    // A RITE ON THE ALCHEMIST'S SHELF TOO (it.117), once the delver is past the first depths.
    if (deepestFloor >= 4) alch.push(any(CURIO_SCROLLS));
    if (deepestFloor >= 3) alch.push('hunters_antidote', 'potion_focus', any(CURIO_ORES));
    if (deepestFloor >= 6) alch.push('potion_frostward', 'potion_void');
    this.stockAlch = alch.filter((id) => id in ITEMS);
    // THE TAVERN KEEPER'S LARDER (it.114): bread and pretzels always, six snacks,
    // five meals, and a feast or two once the crypt has been walked a way.
    const tavern: string[] = ['food_crusty_bread_loaf', 'food_crusty_bread_loaf', 'food_salted_pretzel', 'food_hearty_stew_bowl', 'food_roast_turkey_leg'];
    for (let i = 0; i < 4; i++) tavern.push(pick('snack'));
    for (let i = 0; i < 3; i++) tavern.push(pick('meal'));
    tavern.push(pick('feast'));
    if (deepestFloor >= 3) tavern.push(pick('feast'));
    if (deepestFloor >= 6) tavern.push('food_whole_roast_chicken', pick('meal'));
    // THE TAPS (it.116): the city's only drink. Every one of the ten ales is on,
    // and eight of the bake's other bottles and tins; the banquet once the crypt
    // has been walked to its first warden.
    for (const ale of ALES) tavern.push(ale.id);
    const bottles = [...CURIO_DRINKS];
    for (let i = 0; i < 8 && bottles.length; i++) tavern.push(bottles.splice(Math.floor(rand() * bottles.length), 1)[0].id);
    if (deepestFloor >= 5) tavern.push('food_cakepancakes');
    this.stockTavern = tavern.filter((id) => id in ITEMS);
    // THE MARKET WARD (it.84). The JEWELER: five rolled rings and amulets, a
    // silver band for the fresh delver. The SCRIBE: recipe scrolls the depth
    // allows (three, distinct) and the brews a scholar keeps. The BOWYER:
    // rolled bows, wands, staves and polearms whose band the depth has
    // entered, and a plain short bow.
    const jewel: string[] = ['silver_band'];
    for (let i = 0; i < 5; i++) jewel.push(rollGear(rand, ilvl, { slot: 'ring', floor: 'uncommon', weights: { uncommon: 45, rare: 40, epic: 13, legendary: 2 } }));
    this.stockJewel = [...new Set(jewel.filter((id) => !!itemDef(id)))];
    const scribe: string[] = ['potion_might', 'greater_mana', 'rejuvenation'];
    // THE SCRIBE'S SHELF (it.115; SIX RITES it.117). A scroll is a real skill
    // any class may read, at twice its force and four times its length, so the
    // scribe is now a counter worth walking to: six of them, and the shelf
    // deepens as the crypt does.
    for (let i = 0; i < 4; i++) scribe.push(CURIO_SCROLLS[Math.floor(rand() * CURIO_SCROLLS.length)].id);
    if (deepestFloor >= 4) scribe.push(CURIO_SCROLLS[Math.floor(rand() * CURIO_SCROLLS.length)].id);
    if (deepestFloor >= 8) scribe.push(CURIO_SCROLLS[Math.floor(rand() * CURIO_SCROLLS.length)].id);
    const allowed = Object.values(ENCHANTS).filter((r) => r.depth <= Math.max(2, deepestFloor)).map((r) => r.key);
    for (let i = 0; i < 3 && allowed.length; i++) scribe.push(`recipe_${allowed.splice(Math.floor(rand() * allowed.length), 1)[0]}`);
    this.stockScribe = scribe.filter((id) => !!itemDef(id));
    const ranged = gearBases().filter((d) => !d.uniqueOnly && (d.weaponKind === 'bow' || d.weaponKind === 'wand' || d.weaponKind === 'polearm') && (!d.band || d.band[0] <= ilvl + 2));
    const bowyer: string[] = ['short_bow'];
    for (let i = 0; i < 6 && ranged.length; i++) {
      const base = ranged[Math.floor(rand() * ranged.length)];
      bowyer.push(rollGear(rand, ilvl, { base: base.id, floor: 'uncommon', weights: { uncommon: 50, rare: 38, epic: 10, legendary: 2 } }));
    }
    this.stockBowyer = [...new Set(bowyer.filter((id) => !!itemDef(id)))];
    this.restockSerial = serial;
    this.lastRestockTick = tick;
    this.bossCleared = false;
    eventBus.emit('town:changed', {});
  }

  /**
   * COLESLAW'S DISCOUNT (it.116): a share off everything at the Gilded Stag
   * once the eastern quarter is his again (main sets it from the ledger, on
   * every peer alike).
   */
  tavernDiscount = 0;

  buyPrice(def: ItemDef, vendor?: string): number {
    const full = itemValue(def);
    return vendor === 'tavern' && this.tavernDiscount > 0 ? Math.max(1, Math.round(full * (1 - this.tavernDiscount))) : full;
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
          const table = this.tableFor(cmd.vendor as FoodVendor | undefined);
          const id = table[cmd.index];
          const def = itemDef(id);
          if (!def) break;
          const price = this.buyPrice(def, cmd.vendor);
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
