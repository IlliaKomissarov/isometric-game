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
import { itemDef } from '@/items/instance';

/** Effects a consumable may trigger — wired by main (heal goes through Combat). */
export interface UseHooks {
  heal: (fraction: number) => void;
  restore: (fraction: number) => void;
  portal: () => boolean;
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
    if (def.use.heal) this.hooks.heal(def.use.heal);
    if (def.use.resource) this.hooks.restore(def.use.resource);
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
          const want = cmd.kind === 'health' ? 'health_potion' : 'mana_potion';
          const i = this.player.backpack.findIndex((id) => id === want || id.startsWith(`${want}#`));
          if (i >= 0) this.useIndex(i);
          break;
        }
        default:
          break;
      }
    }
  }
}
