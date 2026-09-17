/**
 * @module systems/Inventory
 * Consumes EQUIP / UNEQUIP commands from the deterministic input queue and
 * applies them to the player. The DOM inventory panel never mutates the
 * player directly — it enqueues commands, keeping equipment changes inside
 * the tick pipeline (and therefore co-op-replicable).
 *
 * FOOD AND HUNGER (it.114). Food is eaten through the same path as a
 * draught (`useIndex`), on its own short cooldown, and unlike a draught its
 * healing is SERVED OVER THREE SECONDS: `tickHunger` (once per sim tick,
 * from main) doles the bite out in six slices through the `feed` hook (or
 * the `heal` hook when nobody wired `feed`). Every bite raises HUNGER, a
 * 0..100 gauge kept HERE (the system already holds the belt and the
 * cooldowns; the player entity is not this module's to change):
 *
 *   100 = well fed · decays one point every 40 s ON DUNGEON FLOORS only
 *   < 50  HUNGRY   · a warning, nothing else
 *   < 25  STARVING · regeneration stops (`regenMult` = 0) and every blow the
 *                    hero lands loses a tenth (`hungerMalus` = 0.1)
 *   ≥ 95  FULL     · a feast eaten here heals to FULL ("if you have a lot,
 *                    you can fully heal")
 *
 * The number is simulation state (it rides the save and a co-op snapshot);
 * the HUD reads it through `InventorySystem.of(player)`.
 */

import { eventBus } from '@/core/EventBus';
import type { InputCommand } from '@/core/InputQueue';
import type { Player } from '@/entities/Player';
import { decodeItemId, itemDef } from '@/items/instance';
import type { FoodTier, ItemDef } from '@/items/catalog';

/** Effects a consumable may trigger — wired by main (heal goes through Combat). */
export interface UseHooks {
  heal: (fraction: number) => void;
  restore: (fraction: number) => void;
  portal: () => boolean;
  /** A timed brew took hold (it.80): the HUD's cue. */
  buff?: (kind: 'haste' | 'stone' | 'might', ticks: number) => void;
  /** A recipe scroll was read (it.80). */
  learned?: (key: string) => void;
  /** A draught refused (it.80): cooldown, or nothing on the belt. */
  refuse?: (reason: string) => void;
  /**
   * FOOD (it.114): one slice of a bite's healing (a fraction of max life),
   * six times over three seconds. QUIET — no flask sound, no red burst; the
   * bite itself announced it. Falls back to `heal` when absent.
   */
  feed?: (fraction: number) => void;
  /** A bite was taken (it.114): the label and the crumbs over the hero. The UI plays the sound. */
  eat?: (def: ItemDef, hunger: number, full: boolean) => void;
}

/** Draught cooldowns by category (ticks): healing 5 s, resource 2 s, brews 1 s, food 1.5 s. */
export const QUAFF_COOLDOWN: Record<'heal' | 'resource' | 'buff' | 'food', number> = { heal: 300, resource: 120, buff: 60, food: 90 };

export type QuaffCategory = keyof typeof QUAFF_COOLDOWN;

/** Which cooldown a draught (or a dish) runs on. */
export function quaffCategory(use: NonNullable<ItemDef['use']>): QuaffCategory | null {
  if (use.portal || use.recipe) return null;
  if (use.food) return 'food';
  if (use.heal) return 'heal';
  if (use.resource) return 'resource';
  return 'buff';
}

// ---- HUNGER (it.114) ---------------------------------------------------------------

export const HUNGER_MAX = 100;
/** One point lost every 40 s on a dungeon floor (2,400 ticks at 60 Hz). */
export const HUNGER_DECAY_TICKS = 40 * 60;
/** Under this the hero is HUNGRY: a warning on the gauge. */
export const HUNGER_HUNGRY = 50;
/** Under this the hero is STARVING: no regeneration, a tenth off every blow. */
export const HUNGER_STARVING = 25;
/** At or over this the hero is FULL: a feast heals to full. */
export const HUNGER_FULL = 95;
/** The damage lost while starving. */
export const STARVING_MALUS = 0.1;
/** A bite's healing is served in this many slices over this many ticks. */
export const FEED_TICKS = 180;
export const FEED_SLICES = 6;

export type HungerState = 'fed' | 'hungry' | 'starving';

export function hungerStateOf(hunger: number): HungerState {
  return hunger < HUNGER_STARVING ? 'starving' : hunger < HUNGER_HUNGRY ? 'hungry' : 'fed';
}

export const HUNGER_WORD: Record<HungerState, string> = { fed: 'WELL FED', hungry: 'HUNGRY', starving: 'STARVING' };

/** What each tier does when eaten (mirrors the registry's FOOD_TIER; here so the UI needs no registry import). */
export const FOOD_EFFECT: Record<FoodTier, { heal: number; hunger: number }> = { snack: { heal: 0.08, hunger: 15 }, meal: { heal: 0.15, hunger: 35 }, feast: { heal: 0.3, hunger: 70 } };

/** Every live system by its hero: the HUD reads hunger through this, never through the player. */
const BY_PLAYER = new WeakMap<Player, InventorySystem>();

export class InventorySystem {
  /** HUNGER (it.114): 0..100, 100 = well fed. Saved and restored by main. */
  hunger = HUNGER_MAX;
  /** Ticks toward the next point of decay. */
  private hungerClock = 0;
  /** The bite being served: slices left and the fraction each slice heals. */
  private feedLeft = 0;
  private feedFraction = 0;
  private feedClock = 0;

  constructor(
    private readonly player: Player,
    private readonly hooks: UseHooks,
  ) {
    BY_PLAYER.set(player, this);
  }

  /** The system serving a hero (the HUD's way in), or undefined before a run. */
  static of(player: Player | null | undefined): InventorySystem | undefined {
    return player ? BY_PLAYER.get(player) : undefined;
  }

  get hungerState(): HungerState {
    return hungerStateOf(this.hunger);
  }

  /** The damage lost to an empty belly: 0.1 while starving, else 0 (main applies it). */
  hungerMalus(): number {
    return this.hungerState === 'starving' ? STARVING_MALUS : 0;
  }

  /** Multiplier on health regeneration: 0 while starving, else 1 (main applies it). */
  regenMult(): number {
    return this.hungerState === 'starving' ? 0 : 1;
  }

  /** A bite is still being served (the HUD's little regen mark). */
  get feeding(): boolean {
    return this.feedLeft > 0;
  }

  /**
   * ONCE PER SIM TICK (main): the belly empties on dungeon floors only, and
   * a bite in progress serves its next slice. Never below zero.
   */
  tickHunger(onDungeonFloor: boolean): void {
    if (onDungeonFloor && this.player.hp > 0) {
      if (++this.hungerClock >= HUNGER_DECAY_TICKS) {
        this.hungerClock = 0;
        if (this.hunger > 0) {
          const was = this.hungerState;
          this.hunger--;
          if (this.hungerState !== was) eventBus.emit('inventory:changed', {}); // The panel's word changed.
        }
      }
    }
    if (this.feedLeft > 0 && ++this.feedClock >= FEED_TICKS / FEED_SLICES) {
      this.feedClock = 0;
      this.feedLeft--;
      if (this.player.hp > 0) (this.hooks.feed ?? this.hooks.heal)(this.feedFraction);
    }
  }

  /** Restore the gauge from a save (clamped). */
  setHunger(v: number): void {
    this.hunger = Math.max(0, Math.min(HUNGER_MAX, Math.round(Number.isFinite(v) ? v : HUNGER_MAX)));
  }

  /** Drink/read/eat a backpack consumable (it.39; food it.114). Returns true when consumed. */
  private useIndex(index: number): boolean {
    const id = this.player.backpack[index];
    const def = id ? itemDef(id) : undefined;
    if (!def || (def.slot !== 'consumable' && def.slot !== 'food') || !def.use) return false;
    if (def.use.key) {
      this.hooks.refuse?.('carry it to the iron gate');
      return false;
    }
    if (def.use.portal) {
      if (!this.hooks.portal()) return false; // Not castable here (already in town).
    }
    // COOLDOWNS (it.80): a healing draught every five seconds, not a hundred a second.
    const cat = quaffCategory(def.use);
    if (cat) {
      const left = this.player.quaffCd.get(cat) ?? 0;
      if (left > 0) {
        this.hooks.refuse?.(`${(left / 60).toFixed(1)} s`);
        return false;
      }
      this.player.quaffCd.set(cat, QUAFF_COOLDOWN[cat]);
    }
    if (def.use.recipe) {
      this.player.recipes.add(def.use.recipe);
      this.hooks.learned?.(def.use.recipe);
      eventBus.emit('recipes:changed', {});
    }
    if (def.use.food) this.eat(def, def.use.food);
    if (def.use.heal) this.hooks.heal(def.use.heal);
    if (def.use.resource) this.hooks.restore(def.use.resource);
    const p = this.player;
    if (def.use.haste) {
      p.hasteTicks = Math.max(p.hasteTicks, def.use.haste);
      p.hasteMult = Math.max(p.hasteMult, 1.3);
      p.buffMax.haste = Math.max(p.buffMax.haste, def.use.haste);
      this.hooks.buff?.('haste', def.use.haste);
    }
    if (def.use.stone) {
      p.drTicks = Math.max(p.drTicks, def.use.stone);
      p.drFrac = Math.max(p.drFrac, 0.4);
      p.buffMax.dr = Math.max(p.buffMax.dr, def.use.stone);
      this.hooks.buff?.('stone', def.use.stone);
    }
    if (def.use.might) {
      p.dmgBuffTicks = Math.max(p.dmgBuffTicks, def.use.might);
      p.dmgBuffMult = Math.max(p.dmgBuffMult, 1.25);
      p.buffMax.dmg = Math.max(p.buffMax.dmg, def.use.might);
      this.hooks.buff?.('might', def.use.might);
    }
    this.player.backpack.splice(index, 1);
    eventBus.emit('inventory:changed', {});
    eventBus.emit('item:used', { itemId: def.id });
    return true;
  }

  /**
   * A BITE (it.114). The gauge rises by the tier; the healing is queued in
   * slices (a bite already being served is topped up, not lost). A feast on
   * a full belly heals to full at once.
   */
  private eat(def: ItemDef, food: NonNullable<NonNullable<ItemDef['use']>['food']>): void {
    const wasFull = this.hunger >= HUNGER_FULL;
    this.hunger = Math.min(HUNGER_MAX, this.hunger + food.hunger);
    let fraction = food.heal;
    if (wasFull && food.tier === 'feast') {
      fraction = 1;
      this.hooks.heal(1); // Straight to full: the one instant heal food gives.
      this.feedLeft = 0;
    } else {
      // Top up: whatever is still owed joins the new bite, served over a fresh three seconds.
      const owed = this.feedLeft * this.feedFraction;
      this.feedFraction = (owed + fraction) / FEED_SLICES;
      this.feedLeft = FEED_SLICES;
      this.feedClock = 0;
    }
    this.hooks.eat?.(def, food.hunger, wasFull && food.tier === 'feast');
  }

  /** Apply one tick's drained commands (shares the array with MovementSystem). */
  /** CO-OP (it.59): the seat this hero holds — only its own commands apply. */
  slot = 0;

  apply(commands: ReadonlyArray<InputCommand>): void {
    for (const cmd of commands) {
      if (cmd.playerId !== this.slot) continue;
      switch (cmd.type) {
        case 'EQUIP': {
          // A dish is eaten, never worn (it.114): the entity's own guard predates food.
          const def = itemDef(this.player.backpack[cmd.backpackIndex]);
          if (def?.slot === 'food') break;
          this.player.equipFromBackpack(cmd.backpackIndex);
          break;
        }
        case 'UNEQUIP':
          this.player.unequip(cmd.slot);
          break;
        case 'USE_ITEM':
          this.useIndex(cmd.backpackIndex);
          break;
        case 'USE_QUICK': {
          // THE BELT (it.80): Q is slot 0, R is slot 1; whatever base rides there - a draught or a dish (it.114).
          const want = this.player.belt[cmd.kind === 'health' ? 0 : 1];
          if (!want) {
            this.hooks.refuse?.('nothing on the belt');
            break;
          }
          const i = this.player.backpack.findIndex((id) => decodeItemId(id)?.base === want);
          if (i >= 0) this.useIndex(i);
          else this.hooks.refuse?.('none left');
          break;
        }
        case 'SORT_PACK': {
          // Deterministic on every peer: type, then rarity, then level and reinforcement, then name, then the id.
          const rank: Record<string, number> = { mainHand: 0, offHand: 1, head: 2, torso: 3, legs: 4, cloak: 5, ring: 6, consumable: 7, food: 8, material: 9 };
          const rar = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
          this.player.backpack.sort((a, b) => {
            const da = itemDef(a);
            const db = itemDef(b);
            if (!da || !db) return a < b ? -1 : a > b ? 1 : 0;
            return (
              (rank[da.slot] ?? 10) - (rank[db.slot] ?? 10) ||
              rar.indexOf(db.rarity) - rar.indexOf(da.rarity) ||
              (db.ilvl ?? 0) - (da.ilvl ?? 0) ||
              (db.upgrade ?? 0) - (da.upgrade ?? 0) ||
              (da.name < db.name ? -1 : da.name > db.name ? 1 : 0) ||
              (a < b ? -1 : a > b ? 1 : 0)
            );
          });
          eventBus.emit('inventory:changed', {});
          break;
        }
        case 'SET_BELT': {
          const slot = cmd.slot === 1 ? 1 : 0;
          const base = cmd.item ? decodeItemId(cmd.item)?.base ?? null : null;
          const def = base ? itemDef(base) : undefined;
          this.player.belt[slot] = def && beltable(def) ? base : null;
          eventBus.emit('belt:changed', {});
          eventBus.emit('inventory:changed', {});
          break;
        }
        default:
          break;
      }
    }
  }
}

/** What may ride the belt: any draught but a portal or a recipe, and any dish (it.114). */
export function beltable(def: ItemDef): boolean {
  if (def.slot === 'food') return !!def.use?.food;
  return def.slot === 'consumable' && !def.use?.portal && !def.use?.recipe && !def.use?.key;
}
