/**
 * @module ui/Inventory
 * DOM inventory panel: paperdoll slots + backpack, gothic-styled, toggled
 * with the I key. Pure presentation — every mutation is enqueued as an
 * EQUIP / UNEQUIP command and applied by systems/Inventory inside the tick
 * (see that module for the determinism rationale).
 *
 * Includes the item stat tooltip (closes the item-tooltip sub-task): a single
 * reused DOM node shown on row hover with name, slot, and stat lines.
 */

import { eventBus } from '@/core/EventBus';
import type { InputQueue } from '@/core/InputQueue';
import { audio } from '@/engine/AudioManager';
import type { Player } from '@/entities/Player';
import { ITEMS, RARITY_COLOR, statLine, type ItemDef } from '@/items/catalog';
import type { EquipmentSlot } from '@/network/Serialization';
import { weaponIconUrl } from '@/render/SpriteLibrary';
import { itemIconDataUrl } from './itemIcons';

const SLOT_ORDER: ReadonlyArray<{ slot: EquipmentSlot; label: string }> = [
  { slot: 'mainHand', label: 'MAIN' },
  { slot: 'offHand', label: 'OFF' },
  { slot: 'head', label: 'HEAD' },
  { slot: 'torso', label: 'BODY' },
  { slot: 'legs', label: 'LEGS' },
  { slot: 'cloak', label: 'BACK' },
];

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Cell content: the real pack icon, or a crisp generated pixel icon. */
function iconHtml(def: ItemDef): string {
  if (def.icon) {
    return `<img src="${weaponIconUrl(def.icon)}" alt="${def.name}" draggable="false">`;
  }
  return `<img class="inv-pxicon" src="${itemIconDataUrl(def)}" alt="${def.name}" draggable="false">`;
}

export class InventoryUI {
  private readonly panel: HTMLElement;
  private readonly tooltip: HTMLElement;
  /** Always-visible extracted stats readout (lives beside the health orb). */
  private readonly statsBar: HTMLElement;
  private visible = false;
  /** Interval driving the animated paperdoll while the panel is rendered. */
  private previewTimer: number | null = null;
  private readonly abort = new AbortController();
  private readonly offChanged: () => void;

  constructor(
    private readonly player: Player,
    private readonly queue: InputQueue,
    private readonly playerId: number,
    /**
     * Renders the character's IDLE ANIMATION frames with current equipment
     * (live animated paperdoll). Wired by main via the Pixi extract API.
     */
    private readonly getPreview: () => HTMLCanvasElement[] | null,
  ) {
    this.panel = document.createElement('div');
    this.panel.id = 'inv-panel';
    document.body.appendChild(this.panel);

    this.tooltip = document.createElement('div');
    this.tooltip.id = 'inv-tooltip';
    document.body.appendChild(this.tooltip);

    this.statsBar = document.createElement('div');
    this.statsBar.id = 'char-stats';
    document.body.appendChild(this.statsBar);

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'KeyI' && !e.repeat) {
          e.preventDefault();
          this.toggle();
        }
      },
      { signal: this.abort.signal },
    );

    this.offChanged = eventBus.on('inventory:changed', () => this.render());
    this.render();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle('open', this.visible);
    if (!this.visible) this.hideTooltip();
    audio.sfx(this.visible ? 'invOpen' : 'invClose');
  }

  /** Run teardown: listeners, timers and DOM (it.36). */
  destroy(): void {
    this.abort.abort();
    this.offChanged();
    if (this.previewTimer !== null) clearInterval(this.previewTimer);
    this.panel.remove();
    this.tooltip.remove();
    this.statsBar.remove();
  }

  private render(): void {
    // Equipment: one labeled cell per slot (grid of 3×2).
    const equipmentCells = SLOT_ORDER.map(({ slot, label }) => {
      const itemId = this.player.getEquipped(slot);
      const def = itemId ? ITEMS[itemId] : undefined;
      const cell = def
        ? `<button class="inv-cell inv-item rarity-${def.rarity}" data-unequip="${slot}" data-item="${def.id}">${iconHtml(def)}</button>`
        : `<div class="inv-cell inv-cell-empty"></div>`;
      return `<div class="inv-slot-wrap"><span class="inv-slot-label">${label}</span>${cell}</div>`;
    }).join('');

    // Backpack: duplicates STACK into one cell with a quantity badge;
    // the grid scrolls in its own compartment, never cutting items off.
    const stacks = new Map<string, { def: ItemDef; count: number; firstIndex: number }>();
    this.player.backpack.forEach((itemId, index) => {
      const def = ITEMS[itemId];
      if (!def) return;
      const existing = stacks.get(itemId);
      if (existing) existing.count++;
      else stacks.set(itemId, { def, count: 1, firstIndex: index });
    });
    const backpackCells =
      stacks.size === 0
        ? `<span class="inv-empty">Nothing carried</span>`
        : [...stacks.values()]
            .map(
              ({ def, count, firstIndex }) =>
                `<button class="inv-cell inv-item rarity-${def.rarity}" data-equip="${firstIndex}" data-item="${def.id}">
                   ${iconHtml(def)}${count > 1 ? `<span class="inv-qty">${count}</span>` : ''}
                 </button>`,
            )
            .join('');

    this.panel.innerHTML = `
      <h3>INVENTORY</h3>
      <div class="inv-preview"></div>
      <div class="inv-equip-grid">${equipmentCells}</div>
      <div class="inv-divider"></div>
      <h4>BACKPACK &nbsp;<span class="inv-count">${this.player.backpack.length}</span>
        <span class="inv-gold">◆ Gold: ${this.player.gold}</span></h4>
      <div class="inv-scroll"><div class="inv-pack-grid">${backpackCells}</div></div>
    `;

    // Stats live OUTSIDE the inventory — always visible beside the orb.
    const dmg = this.player.weaponDamage;
    this.statsBar.innerHTML = `<span>DMG</span> ${dmg.min}–${dmg.max} &nbsp;<span>ARM</span> ${this.player.armor}`;

    // Live ANIMATED paperdoll: idle frames cycled while the panel is up
    // (it.15 — the menu character breathes instead of standing frozen).
    const previewHost = this.panel.querySelector<HTMLElement>('.inv-preview');
    const frames = this.getPreview();
    if (this.previewTimer !== null) {
      clearInterval(this.previewTimer);
      this.previewTimer = null;
    }
    if (previewHost && frames && frames.length > 0) {
      const target = document.createElement('canvas');
      target.width = frames[0].width;
      target.height = frames[0].height;
      const ctx = target.getContext('2d');
      previewHost.appendChild(target);
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        let f = 0;
        const draw = (): void => {
          const frame = frames[f % frames.length];
          ctx.clearRect(0, 0, target.width, target.height);
          ctx.drawImage(frame, (target.width - frame.width) / 2, target.height - frame.height);
          f++;
        };
        draw();
        this.previewTimer = window.setInterval(draw, 170);
      }
    }

    // Wire clicks + tooltips on the freshly rendered cells.
    this.panel.querySelectorAll<HTMLButtonElement>('button.inv-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const equipIndex = btn.dataset.equip;
        const unequipSlot = btn.dataset.unequip as EquipmentSlot | undefined;
        if (equipIndex !== undefined) {
          this.queue.enqueue({ type: 'EQUIP', playerId: this.playerId, backpackIndex: Number(equipIndex) });
          audio.sfx('equip'); // Steel drawn from the sheath (it.26).
        } else if (unequipSlot) {
          this.queue.enqueue({ type: 'UNEQUIP', playerId: this.playerId, slot: unequipSlot });
          audio.sfx('uiClick');
        }
        this.hideTooltip();
      });
      btn.addEventListener('mouseenter', (e) => {
        const def = btn.dataset.item ? ITEMS[btn.dataset.item] : undefined;
        if (def) this.showTooltip(def, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
        audio.sfx('uiHover');
      });
      btn.addEventListener('mouseleave', () => this.hideTooltip());
    });
  }

  private showTooltip(def: ItemDef, x: number, y: number): void {
    this.tooltip.innerHTML = `
      <div class="tip-name" style="color:${hex(RARITY_COLOR[def.rarity])}">${def.name}</div>
      <div class="tip-slot">${def.rarity} · ${def.slot}</div>
      <div class="tip-stats">${statLine(def)}</div>
    `;
    this.tooltip.classList.add('show');
    const pad = 14;
    const rect = this.tooltip.getBoundingClientRect();
    const left = Math.min(x + pad, window.innerWidth - rect.width - 8);
    const top = Math.min(y + pad, window.innerHeight - rect.height - 8);
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private hideTooltip(): void {
    this.tooltip.classList.remove('show');
  }
}
