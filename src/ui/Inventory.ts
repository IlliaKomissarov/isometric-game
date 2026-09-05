/**
 * @module ui/Inventory
 * DOM inventory panel: paperdoll slots + backpack, gothic-styled, toggled
 * with the I key. Pure presentation — every mutation is enqueued as an
 * EQUIP / UNEQUIP command and applied by systems/Inventory inside the tick
 * (see that module for the determinism rationale).
 *
 * The item card (it.76): hovering a pack item lays its numbers beside the
 * piece worn in that slot (see `ui/itemTip`); hovering a worn piece shows
 * its own. A long press does the same on touch.
 */

import { eventBus } from '@/core/EventBus';
import type { InputQueue } from '@/core/InputQueue';
import { audio } from '@/engine/AudioManager';
import { uiIdleFrame } from '@/render/animUtil';
import type { Player } from '@/entities/Player';
import { itemValue, type ItemDef } from '@/items/catalog';
import { decodeItemId, itemDef } from '@/items/instance';
import { QUAFF_COOLDOWN, quaffCategory } from '@/systems/Inventory';
import { MATERIAL_ORDER } from '@/items/registry';
import type { EquipmentSlot } from '@/network/Serialization';

import { fitItemIcons, itemIconHtml } from './itemIcons';
import { attachItemCard, itemCardHtml, placeCard, wornFor } from './itemTip';
import { uiAssetUrl } from '@/render/SpriteLibrary';
import { keepScroll } from './keepScroll';

/** Paperdoll layout (it.42): a body-shaped cross — head on top, hands beside the torso, ring and cloak below. */
const SLOT_ORDER: ReadonlyArray<{ slot: EquipmentSlot; label: string; area: string }> = [
  { slot: 'head', label: 'HEAD', area: 'head' },
  { slot: 'mainHand', label: 'MAIN HAND', area: 'main' },
  { slot: 'torso', label: 'BODY', area: 'body' },
  { slot: 'offHand', label: 'OFF HAND', area: 'off' },
  { slot: 'ring', label: 'RING', area: 'ring' },
  { slot: 'legs', label: 'LEGS', area: 'legs' },
  { slot: 'cloak', label: 'BACK', area: 'back' },
];

/** Cell content: the real pack icon, or a crisp generated pixel icon. */
const iconHtml = (def: ItemDef): string => itemIconHtml(def, '', 'inv-pxicon');

/** THE LEVEL ON THE CELL (it.80): gear wears its item level in the corner, and its reinforcement. */
const lvlBadge = (def: ItemDef): string => (def.ilvl && def.slot !== 'consumable' && def.slot !== 'material' ? `<span class="inv-lvl">${def.ilvl}${def.upgrade ? `<b>+${def.upgrade}</b>` : ''}</span>` : '');

/** The pack field (it.50): six across, eight down. */
const PACK_COLS = 6;
const PACK_SLOTS = 48;

export class InventoryUI {
  private readonly panel: HTMLElement;
  private readonly tooltip: HTMLElement;
  /** Always-visible extracted stats readout (lives beside the health orb). */
  private readonly statsBar: HTMLElement;
  private visible = false;
  /** Which half a portrait screen is showing (it.66). */
  private tab: 'gear' | 'pack' = 'gear';
  /** Interval driving the animated paperdoll while the panel is rendered. */
  private previewTimer: number | null = null;
  private readonly abort = new AbortController();
  /** THE BELT CHOOSER (it.80): which key is picking a draught (null = closed). */
  private beltPick: number | null = null;
  private cdTimer: number | null = null;
  private readonly offChanged: () => void;
  private readonly offMaterials: () => void;
  private readonly offBelt: () => void;

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
    this.offMaterials = eventBus.on('materials:changed', () => this.render());
    this.offBelt = eventBus.on('belt:changed', () => {
      this.beltPick = null;
      this.render();
    });
    this.render();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle('open', this.visible);
    if (!this.visible) this.hideTooltip();
    audio.sfx(this.visible ? 'invOpen' : 'invClose');
    if (this.cdTimer !== null) {
      clearInterval(this.cdTimer);
      this.cdTimer = null;
    }
    if (this.visible) this.cdTimer = window.setInterval(() => this.tickBelt(), 100);
    else this.beltPick = null;
    if (this.visible) {
      const closeBtn = this.panel.querySelector<HTMLElement>('[data-close]');
      closeBtn?.addEventListener('mouseenter', () => audio.sfx('uiHover'));
      closeBtn?.addEventListener('click', () => {
        audio.sfx('uiClick');
        this.toggle();
      });
    }
  }

  /** Run teardown: listeners, timers and DOM (it.36). */
  destroy(): void {
    this.abort.abort();
    this.offChanged();
    this.offMaterials();
    this.offBelt();
    if (this.cdTimer !== null) clearInterval(this.cdTimer);
    if (this.previewTimer !== null) clearInterval(this.previewTimer);
    this.panel.remove();
    this.tooltip.remove();
    this.statsBar.remove();
  }

  /** Repaint without losing where the player had scrolled (it.79). */
  private render(): void {
    keepScroll(this.panel, () => this.paint());
  }

  private paint(): void {
    // Equipment: one labeled cell per slot (grid of 3×2).
    const equipmentCells = SLOT_ORDER.map(({ slot, label, area }) => {
      const itemId = this.player.getEquipped(slot);
      const def = itemId ? itemDef(itemId) : undefined;
      const cell = def
        ? `<button class="inv-cell inv-item rarity-${def.rarity}" data-unequip="${slot}" data-item="${def.id}">${iconHtml(def)}${lvlBadge(def)}</button>`
        : `<div class="inv-cell inv-cell-empty inv-cell-framed" data-slot="${slot}" style="background-image:url(${uiAssetUrl(`slots/${slot}.png`)})"></div>`;
      return `<div class="inv-slot-wrap" style="grid-area:${area}"><span class="inv-slot-label">${label}</span>${cell}</div>`;
    }).join('');
    // THE BELT (it.42, assignable it.80): Q and R hold whichever draught the
    // hero chose; the chooser lists every draught in the pack.
    const packBase = (id: string): string | null => decodeItemId(id)?.base ?? null;
    const belt = [0, 1]
      .map((i) => {
        const base = this.player.belt[i];
        const def = base ? itemDef(base) : undefined;
        const count = base ? this.player.backpack.filter((x) => packBase(x) === base).length : 0;
        const firstIndex = base ? this.player.backpack.findIndex((x) => packBase(x) === base) : -1;
        const cat = def?.use ? quaffCategory(def.use) : null;
        const cell = def
          ? `<button class="inv-cell inv-item rarity-${def.rarity} inv-use${count ? '' : ' inv-none'}" ${count ? `data-use="${firstIndex}"` : ''} data-item="${def.id}">${iconHtml(def)}<span class="inv-qty">${count}</span><i class="inv-cd" data-cd="${cat ?? ''}"></i></button>`
          : `<div class="inv-cell inv-cell-empty"><span class="inv-slot-ghost">${i === 0 ? '♥' : '◈'}</span></div>`;
        return `<div class="inv-belt-slot${count ? '' : ' empty'}"><kbd>${i === 0 ? 'Q' : 'R'}</kbd>${cell}<button class="inv-belt-pick${this.beltPick === i ? ' on' : ''}" data-beltpick="${i}" title="Choose the draught for ${i === 0 ? 'Q' : 'R'}">▾</button></div>`;
      })
      .join('');
    let beltMenu = '';
    if (this.beltPick !== null) {
      const seen = new Map<string, ItemDef>();
      for (const id of this.player.backpack) {
        const def = itemDef(id);
        const base = packBase(id);
        if (!def || !base || def.slot !== 'consumable' || def.use?.portal || def.use?.recipe) continue;
        if (!seen.has(base)) seen.set(base, def);
      }
      const rows = [...seen.entries()]
        .map(([base, def]) => `<button class="inv-belt-opt rarity-${def.rarity}" data-beltset="${base}">${iconHtml(def)}<span>${def.name}</span><b>×${this.player.backpack.filter((x) => packBase(x) === base).length}</b></button>`)
        .join('');
      beltMenu = `<div class="inv-belt-menu"><span class="inv-belt-menu-title">DRAUGHT FOR ${this.beltPick === 0 ? 'Q' : 'R'}</span>${rows || '<span class="tp-empty">No draughts in the pack</span>'}<button class="inv-belt-opt inv-belt-clear" data-beltset="">Leave the key empty</button></div>`;
    }

    // Backpack: duplicates STACK into one cell with a quantity badge;
    // the grid scrolls in its own compartment, never cutting items off.
    const stacks = new Map<string, { def: ItemDef; count: number; firstIndex: number }>();
    this.player.backpack.forEach((itemId, index) => {
      const def = itemDef(itemId);
      if (!def) return;
      const existing = stacks.get(itemId);
      if (existing) existing.count++;
      else stacks.set(itemId, { def, count: 1, firstIndex: index });
    });
    // THE PACK GRID (it.50): a fixed 6×8 field of slots (more rows when the
    // haul outgrows it), every empty slot drawn, the whole field scrolling.
    const filled = [...stacks.values()]
      .map(
        ({ def, count, firstIndex }) =>
          `<button class="inv-cell inv-item rarity-${def.rarity}${def.slot === 'consumable' ? ' inv-use' : ''}" ${def.slot === 'consumable' ? `data-use="${firstIndex}"` : `data-equip="${firstIndex}"`} data-item="${def.id}">
             ${iconHtml(def)}${count > 1 ? `<span class="inv-qty">${count}</span>` : ''}${lvlBadge(def)}
           </button>`,
      )
      .join('');
    const slotCount = Math.max(PACK_SLOTS, Math.ceil(stacks.size / PACK_COLS) * PACK_COLS);
    const empties = Array.from({ length: Math.max(0, slotCount - stacks.size) }, () => '<div class="inv-cell inv-cell-empty inv-pack-empty"></div>').join('');
    const backpackCells = filled + empties;

    // THE POUCH (it.78): crafting materials, never a pack slot each.
    const pouch = MATERIAL_ORDER.map((mid) => {
      const def = itemDef(mid);
      const n = this.player.materials.get(mid) ?? 0;
      if (!def) return '';
      return `<span class="inv-mat${n ? '' : ' empty'}" title="${def.name}">${iconHtml(def)}<b>${n}</b></span>`;
    }).join('');
    this.panel.innerHTML = `
      <h3 class="drag-handle">INVENTORY<button class="tp-close" data-close title="Close (I or ESC)"><i></i></button></h3>
      <div class="inv-tabs" role="tablist">
        <button class="ds-btn" type="button" role="tab" data-tab="gear" aria-selected="${this.tab === 'gear'}">GEAR</button>
        <button class="ds-btn" type="button" role="tab" data-tab="pack" aria-selected="${this.tab === 'pack'}">PACK</button>
      </div>
      <div class="inv-preview"></div>
      <div class="inv-equip-grid">${equipmentCells}</div>
      <div class="inv-belt">${belt}<span class="inv-belt-note">quick draughts · ▾ to assign</span></div>${beltMenu}
      <div class="inv-pouch">${pouch}</div>
      <div class="inv-divider"></div>
      <h4>BACKPACK &nbsp;<span class="inv-count">${stacks.size} / ${PACK_SLOTS}</span>
        <span class="inv-gold">◆ Gold: ${this.player.gold}</span></h4>
      <div class="inv-scroll"><div class="inv-pack-grid">${backpackCells}</div></div>
    `;

    this.panel.dataset.tab = this.tab;
    // PORTRAIT TABS (it.66): a phone stacks the window, so the gear half and
    // the pack half take turns rather than making a thumb scroll past one to
    // reach the other. Landscape shows both columns and hides the tabs.
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('.inv-tabs button')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.tab = b.dataset.tab === 'pack' ? 'pack' : 'gear';
        this.panel.dataset.tab = this.tab;
        for (const other of this.panel.querySelectorAll('.inv-tabs button')) {
          other.setAttribute('aria-selected', String(other === b));
        }
        audio.sfx('uiClick');
      });
    }
    fitItemIcons(this.panel); // Every icon scaled into its slot (it.51).
    // Stats live OUTSIDE the inventory — always visible beside the orb.
    const dmg = this.player.weaponDamage;
    // STAT ICONS (it.50): crossed swords for damage, a shield for armor.
    this.statsBar.innerHTML = `<i class="stat-ico" title="Damage">⚔</i><span>DMG</span> ${dmg.min}–${dmg.max} &nbsp;<i class="stat-ico" title="Armor">⛨</i><span>ARM</span> ${this.player.armor}`;

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
        // Time-based, ping-ponged, slow (it.72): the paperdoll breathes at
        // the UI's idle pace instead of flashing through uneven frames.
        let shown = -1;
        const draw = (): void => {
          const i = uiIdleFrame(frames.length, performance.now() / 1000);
          if (i === shown) return;
          shown = i;
          const frame = frames[i];
          ctx.clearRect(0, 0, target.width, target.height);
          ctx.drawImage(frame, (target.width - frame.width) / 2, target.height - frame.height);
        };
        draw();
        this.previewTimer = window.setInterval(draw, 50);
      }
    }

    // Wire clicks + tooltips on the freshly rendered cells.
    this.panel.querySelectorAll<HTMLButtonElement>('button.inv-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const equipIndex = btn.dataset.equip;
        const useIndex = btn.dataset.use;
        const unequipSlot = btn.dataset.unequip as EquipmentSlot | undefined;
        if (useIndex !== undefined) {
          this.queue.enqueue({ type: 'USE_ITEM', playerId: this.playerId, backpackIndex: Number(useIndex) });
        } else if (equipIndex !== undefined) {
          this.queue.enqueue({ type: 'EQUIP', playerId: this.playerId, backpackIndex: Number(equipIndex) });
          audio.sfx('equip'); // Steel drawn from the sheath (it.26).
        } else if (unequipSlot) {
          this.queue.enqueue({ type: 'UNEQUIP', playerId: this.playerId, slot: unequipSlot });
          audio.sfx('uiClick');
        }
        this.hideTooltip();
      });
      const def = btn.dataset.item ? itemDef(btn.dataset.item) : undefined;
      if (!def) return;
      const worn = btn.dataset.unequip !== undefined;
      let hovered = false;
      attachItemCard(
        btn,
        (x, y) => {
          if (!hovered) audio.sfx('uiHover');
          hovered = true;
          this.showTooltip(def, x, y, worn);
        },
        () => {
          hovered = false;
          this.hideTooltip();
        },
      );
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-beltpick]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = Number(b.dataset.beltpick);
        this.beltPick = this.beltPick === i ? null : i;
        audio.sfx('uiClick');
        this.render();
      });
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-beltset]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.beltPick === null) return;
        this.queue.enqueue({ type: 'SET_BELT', playerId: this.playerId, slot: this.beltPick, item: b.dataset.beltset || null });
        audio.sfx('uiConfirm');
      });
    });
    this.tickBelt();
    // A touch anywhere outside a cell folds a long-pressed card (it.76).
    this.panel.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !(e.target as HTMLElement).closest('button.inv-item')) this.hideTooltip();
    }, { passive: true });
  }

  /** The belt's cooldown veils (it.80): the remaining share of each category's cooldown. */
  private tickBelt(): void {
    for (const veil of this.panel.querySelectorAll<HTMLElement>('.inv-cd[data-cd]')) {
      const cat = veil.dataset.cd as keyof typeof QUAFF_COOLDOWN | '';
      const left = cat ? (this.player.quaffCd.get(cat) ?? 0) : 0;
      const h = cat && left > 0 ? `${Math.round((left / QUAFF_COOLDOWN[cat]) * 100)}%` : '0%';
      if (veil.style.height !== h) veil.style.height = h;
    }
  }

  /** The card: a worn piece on its own, a pack item beside what is worn in its slot. */
  private showTooltip(def: ItemDef, x: number, y: number, self: boolean): void {
    const verb = document.body.classList.contains('input-touch') ? 'tap' : 'click';
    const gold = `worth ${itemValue(def)} gold · ${verb} to ${def.slot === 'consumable' ? 'use' : self ? 'take off' : 'equip'}`;
    this.tooltip.innerHTML = self
      ? itemCardHtml(def, { goldLine: gold, self: true })
      : itemCardHtml(def, { goldLine: gold, worn: def.slot === 'consumable' ? undefined : wornFor(this.player, def) });
    this.tooltip.classList.add('show');
    placeCard(this.tooltip, x, y);
  }

  private hideTooltip(): void {
    this.tooltip.classList.remove('show');
  }
}
