/**
 * @module systems/Inventory
 * Consumes EQUIP / UNEQUIP commands from the deterministic input queue and
 * applies them to the player. The DOM inventory panel never mutates the
 * player directly — it enqueues commands, keeping equipment changes inside
 * the tick pipeline (and therefore co-op-replicable).
 */

import { eventBus } from '@/core/EventBus';
import type { InputCommand } from '@/core/InputQueue';
import type { Player } from '@/entities/Player';
import { decodeItemId, itemDef } from '@/items/instance';
import type { ItemDef } from '@/items/catalog';

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
}

/** Draught cooldowns by category (ticks): healing 5 s, resource 2 s, brews 1 s. */
export const QUAFF_COOLDOWN: Record<'heal' | 'resource' | 'buff', number> = { heal: 300, resource: 120, buff: 60 };

/** Which cooldown a draught runs on. */
export function quaffCategory(use: NonNullable<ItemDef['use']>): 'heal' | 'resource' | 'buff' | null {
  if (use.portal || use.recipe) return null;
  if (use.heal) return 'heal';
  if (use.resource) return 'resource';
  return 'buff';
}

export class InventorySystem {
  constructor(
    private readonly player: Player,
    private readonly hooks: UseHooks,
  ) {}

  /** Drink/read a backpack consumable (it.39). Returns true when consumed. */
  private useIndex(index: number): boolean {
    const id = this.player.backpack[index];
    const def = id ? itemDef(id) : undefined;
    if (!def || def.slot !== 'consumable' || !def.use) return false;
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

  /** Apply one tick's drained commands (shares the array with MovementSystem). */
  /** CO-OP (it.59): the seat this hero holds — only its own commands apply. */
  slot = 0;

  apply(commands: ReadonlyArray<InputCommand>): void {
    for (const cmd of commands) {
      if (cmd.playerId !== this.slot) continue;
      switch (cmd.type) {
        case 'EQUIP':
          this.player.equipFromBackpack(cmd.backpackIndex);
          break;
        case 'UNEQUIP':
          this.player.unequip(cmd.slot);
          break;
        case 'USE_ITEM':
          this.useIndex(cmd.backpackIndex);
          break;
        case 'USE_QUICK': {
          // THE BELT (it.80): Q is slot 0, R is slot 1; whatever base rides there.
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
        case 'SET_BELT': {
          const slot = cmd.slot === 1 ? 1 : 0;
          const base = cmd.item ? decodeItemId(cmd.item)?.base ?? null : null;
          const def = base ? itemDef(base) : undefined;
          this.player.belt[slot] = def && def.slot === 'consumable' && !def.use?.portal && !def.use?.recipe ? base : null;
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
