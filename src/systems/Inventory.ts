/**
 * @module systems/Inventory
 * Consumes EQUIP / UNEQUIP commands from the deterministic input queue and
 * applies them to the player. The DOM inventory panel never mutates the
 * player directly — it enqueues commands, keeping equipment changes inside
 * the tick pipeline (and therefore co-op-replicable).
 */

import type { InputCommand } from '@/core/InputQueue';
import type { Player } from '@/entities/Player';

export class InventorySystem {
  constructor(private readonly player: Player) {}

  /** Apply one tick's drained commands (shares the array with MovementSystem). */
  apply(commands: ReadonlyArray<InputCommand>): void {
    for (const cmd of commands) {
      switch (cmd.type) {
        case 'EQUIP':
          this.player.equipFromBackpack(cmd.backpackIndex);
          break;
        case 'UNEQUIP':
          this.player.unequip(cmd.slot);
          break;
        default:
          break;
      }
    }
  }
}
