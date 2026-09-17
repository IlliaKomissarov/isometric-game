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
 *
 * THE REWORK (it.114; the hunger gauge it carried is gone, it.115):
 *  - FOOD in the pack and on the belt: a dish cell wears a fork mark, a
 *    click eats it, the belt chooser lists dishes beside draughts.
 *  - INSPECT (`#inspect-panel`): a rune-framed stage that turns the item's
 *    baked turntable (`spin_*`, stepped by background-position at 20 fps,
 *    three times its size) under a slow light sweep, with the full card and
 *    the item's own words beneath, and the cell's action as a button. Opened
 *    by right-click on a cell, by the ✦ INSPECT button on the card (the card
 *    now stays put and takes the pointer, so it can be reached), and by the
 *    long-press card on touch. Falls back to the static icon when the item
 *    has no turntable.
 *  - Every cell lifts on hover and glows in its rarity; equipping and eating
 *    pulse the cell.
 *
 * EVERY CELL TURNS (it.115): the icons come from `itemIconHtml`, which draws
 * the item's turntable strip as a CSS-stepped background (see ui/itemIcons).
 */

import { eventBus } from '@/core/EventBus';
import type { InputQueue } from '@/core/InputQueue';
import { audio } from '@/engine/AudioManager';
import { uiIdleFrame } from '@/render/animUtil';
import type { Player } from '@/entities/Player';
import { RARITY_COLOR, itemValue, kindWord, type ItemDef } from '@/items/catalog';
import { decodeItemId, itemDef } from '@/items/instance';
import { QUAFF_COOLDOWN, beltable, quaffCategory } from '@/systems/Inventory';
import { MATERIAL_ORDER } from '@/items/registry';
import type { EquipmentSlot } from '@/network/Serialization';

import { fitItemIcons, itemIconHtml, itemSpin } from './itemIcons';
import { attachItemCard, itemCardHtml, placeCard, slotLabel, wornFor } from './itemTip';
import { effectClass, filterBarHtml, loadFilter, orderIndexes, wireFilterBar, type FilterState } from './itemFilter';
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

/** THE EFFECT GEM (it.81): a corner diamond in the border's colour on every special piece. */
const fxGem = (def: ItemDef): string => {
  const c = effectClass(def);
  return c ? `<i class="inv-fx ${c}"></i>` : '';
};

/** THE LEVEL ON THE CELL (it.80): gear wears its item level in the corner, and its reinforcement. */
const lvlBadge = (def: ItemDef): string => (def.ilvl && def.slot !== 'consumable' && def.slot !== 'material' && def.slot !== 'food' ? `<span class="inv-lvl">${def.ilvl}${def.upgrade ? `<b>+${def.upgrade}</b>` : ''}</span>` : '');

/** THE FORK MARK (it.114): every dish wears one, so food reads at a glance among the flasks. */
const forkMark = (def: ItemDef): string => (def.slot === 'food' ? '<i class="inv-fork" title="Food: click to eat">&#936;</i>' : '');

/** Eaten or drunk: both go through USE_ITEM. */
const usable = (def: ItemDef): boolean => def.slot === 'consumable' || def.slot === 'food';

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** The pack field (it.50): six across, eight down. */
const PACK_COLS = 6;
const PACK_SLOTS = 48;

/** What the inspect view may do with the item: the cell's own action. */
interface InspectContext {
  use?: number;
  equip?: number;
  unequip?: EquipmentSlot;
}

export class InventoryUI {
  private readonly panel: HTMLElement;
  private readonly tooltip: HTMLElement;
  /** Always-visible extracted stats readout (lives beside the health orb). */
  private readonly statsBar: HTMLElement;
  /** THE INSPECT VIEW (it.114). */
  private readonly inspect: HTMLElement;
  private inspectTimer: number | null = null;
  private inspectOpen = false;
  private visible = false;
  /** Which half a portrait screen is showing (it.66). */
  private tab: 'gear' | 'pack' = 'gear';
  /** Interval driving the animated paperdoll while the panel is rendered. */
  private previewTimer: number | null = null;
  private readonly abort = new AbortController();
  /** THE BELT CHOOSER (it.80): which key is picking a draught (null = closed). */
  private beltPick: number | null = null;
  /** THE PACK'S FILTER AND ORDER (it.81), remembered between runs. */
  private readonly filter: FilterState = loadFilter('inventory');
  private cdTimer: number | null = null;
  /** The card's delayed fold (it.114): the pointer may cross onto the card to reach INSPECT. */
  private hideTimer: number | null = null;
  /** The item the card is showing, and the cell action it came from. */
  private tipFor: string | null = null;
  private tipCtx: InspectContext = {};
  private readonly offChanged: () => void;
  private readonly offMaterials: () => void;
  private readonly offBelt: () => void;
  private readonly offUsed: () => void;

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
    // The card takes the pointer (it.114): entering it cancels the fold, leaving it folds.
    this.tooltip.addEventListener('mouseenter', () => this.cancelHide());
    this.tooltip.addEventListener('mouseleave', () => this.hideTooltip());

    this.statsBar = document.createElement('div');
    this.statsBar.id = 'char-stats';
    document.body.appendChild(this.statsBar);

    this.inspect = document.createElement('div');
    this.inspect.id = 'inspect-panel';
    document.body.appendChild(this.inspect);

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'KeyI' && !e.repeat) {
          e.preventDefault();
          this.toggle();
        } else if (e.code === 'Escape' && this.inspectOpen) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.closeInspect();
        }
      },
      { signal: this.abort.signal, capture: true },
    );

    this.offChanged = eventBus.on('inventory:changed', () => this.render());
    this.offMaterials = eventBus.on('materials:changed', () => this.render());
    this.offBelt = eventBus.on('belt:changed', () => {
      this.beltPick = null;
      this.render();
    });
    // A BITE OR A DRAUGHT WENT DOWN (it.114): the sound and the pulse on the cell.
    // (`audio.sfx('eat')` is the cue this wants; the manager has no such cue yet, so the flask's stands in.)
    this.offUsed = eventBus.on('item:used', ({ itemId }) => {
      const def = itemDef(itemId);
      if (!def) return;
      if (def.slot === 'food') audio.sfx('potion');
      this.pulse(def.id);
    });
    this.render();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle('open', this.visible);
    if (!this.visible) {
      this.hideTooltip(true);
      this.closeInspect();
    }
    audio.sfx(this.visible ? 'invOpen' : 'invClose');
    if (this.cdTimer !== null) {
      clearInterval(this.cdTimer);
      this.cdTimer = null;
    }
    if (this.visible) this.cdTimer = window.setInterval(() => this.tickBelt(), 100);
    else this.beltPick = null;
  }

  /** The cross is rewired on EVERY repaint (it.82): a pickup or a belt change while the window was open used to leave a dead button. */
  private wireClose(): void {
    const closeBtn = this.panel.querySelector<HTMLElement>('[data-close]');
    if (!closeBtn || closeBtn.dataset.wired) return;
    closeBtn.dataset.wired = '1';
    closeBtn.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.sfx('uiClick');
      if (this.visible) this.toggle();
    });
  }

  /** Run teardown: listeners, timers and DOM (it.36). */
  destroy(): void {
    this.abort.abort();
    this.offChanged();
    this.offMaterials();
    this.offBelt();
    this.offUsed();
    if (this.cdTimer !== null) clearInterval(this.cdTimer);
    if (this.previewTimer !== null) clearInterval(this.previewTimer);
    if (this.inspectTimer !== null) clearInterval(this.inspectTimer);
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.panel.remove();
    this.tooltip.remove();
    this.statsBar.remove();
    this.inspect.remove();
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
        ? `<button class="inv-cell inv-item rarity-${def.rarity} ${effectClass(def)}" data-unequip="${slot}" data-item="${def.id}">${iconHtml(def)}${lvlBadge(def)}${fxGem(def)}</button>`
        : `<div class="inv-cell inv-cell-empty inv-cell-framed" data-slot="${slot}" style="background-image:url(${uiAssetUrl(`slots/${slot}.png`)})"></div>`;
      return `<div class="inv-slot-wrap" style="grid-area:${area}"><span class="inv-slot-label">${label}</span>${cell}</div>`;
    }).join('');
    // THE BELT (it.42, assignable it.80): Q and R hold whichever draught - or dish (it.114) - the
    // hero chose; the chooser lists every draught and dish in the pack.
    const packBase = (id: string): string | null => decodeItemId(id)?.base ?? null;
    const belt = [0, 1]
      .map((i) => {
        const base = this.player.belt[i];
        const def = base ? itemDef(base) : undefined;
        const count = base ? this.player.backpack.filter((x) => packBase(x) === base).length : 0;
        const firstIndex = base ? this.player.backpack.findIndex((x) => packBase(x) === base) : -1;
        const cat = def?.use ? quaffCategory(def.use) : null;
        const cell = def
          ? `<button class="inv-cell inv-item rarity-${def.rarity} inv-use${def.slot === 'food' ? ' inv-food' : ''}${count ? '' : ' inv-none'}" ${count ? `data-use="${firstIndex}"` : ''} data-item="${def.id}">${iconHtml(def)}${forkMark(def)}<span class="inv-qty">${count}</span><i class="inv-cd" data-cd="${cat ?? ''}"></i></button>`
          : `<div class="inv-cell inv-cell-empty"><span class="inv-slot-ghost">${i === 0 ? '♥' : '◈'}</span></div>`;
        return `<div class="inv-belt-slot${count ? '' : ' empty'}"><kbd>${i === 0 ? 'Q' : 'R'}</kbd>${cell}<button class="inv-belt-pick${this.beltPick === i ? ' on' : ''}" data-beltpick="${i}" title="Choose the draught or dish for ${i === 0 ? 'Q' : 'R'}">▾</button></div>`;
      })
      .join('');
    let beltMenu = '';
    if (this.beltPick !== null) {
      const seen = new Map<string, ItemDef>();
      for (const id of this.player.backpack) {
        const def = itemDef(id);
        const base = packBase(id);
        if (!def || !base || !beltable(def)) continue;
        if (!seen.has(base)) seen.set(base, def);
      }
      const rows = [...seen.entries()]
        .map(([base, def]) => `<button class="inv-belt-opt rarity-${def.rarity}${def.slot === 'food' ? ' inv-food' : ''}" data-beltset="${base}">${iconHtml(def)}<span>${def.name}${def.slot === 'food' ? ' <small>dish</small>' : ''}</span><b>×${this.player.backpack.filter((x) => packBase(x) === base).length}</b></button>`)
        .join('');
      beltMenu = `<div class="inv-belt-menu"><span class="inv-belt-menu-title">${this.beltPick === 0 ? 'Q' : 'R'} · A DRAUGHT OR A DISH</span>${rows || '<span class="tp-empty">No draughts or dishes in the pack</span>'}<button class="inv-belt-opt inv-belt-clear" data-beltset="">Leave the key empty</button></div>`;
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
    // FILTERED AND ORDERED (it.81): the chips and the sort menu decide what shows and in what order;
    // every cell keeps its backpack index, so the commands still name the right item.
    const stackList = [...stacks.values()];
    const shown = orderIndexes(stackList.map((s) => s.def), this.filter).map((i) => stackList[i]);
    const filled = shown
      .map(
        ({ def, count, firstIndex }) =>
          `<button class="inv-cell inv-item rarity-${def.rarity}${usable(def) ? ' inv-use' : ''}${def.slot === 'food' ? ' inv-food' : ''} ${effectClass(def)}" ${usable(def) ? `data-use="${firstIndex}"` : `data-equip="${firstIndex}"`} data-item="${def.id}">
             ${iconHtml(def)}${forkMark(def)}${count > 1 ? `<span class="inv-qty">${count}</span>` : ''}${lvlBadge(def)}${fxGem(def)}
           </button>`,
      )
      .join('');
    const hidden = stackList.length - shown.length;
    const slotCount = Math.max(PACK_SLOTS, Math.ceil(shown.length / PACK_COLS) * PACK_COLS);
    const empties = Array.from({ length: Math.max(0, slotCount - shown.length) }, () => '<div class="inv-cell inv-cell-empty inv-pack-empty"></div>').join('');
    const backpackCells = filled + empties;

    // THE POUCH (it.78): crafting materials, never a pack slot each.
    const pouch = MATERIAL_ORDER.map((mid) => {
      const def = itemDef(mid);
      const n = this.player.materials.get(mid) ?? 0;
      if (!def) return '';
      return `<span class="inv-mat${n ? '' : ' empty'}" title="${def.name}">${iconHtml(def)}<b>${n}</b></span>`;
    }).join('');
    this.panel.innerHTML = `
      <h3 class="drag-handle">INVENTORY<span class="inv-head-tools"><button class="ds-btn inv-journal" type="button" data-journal title="The Journal: items, effects, recipes (H)">JOURNAL</button><button class="tp-close" data-close title="Close (I or ESC)"><i></i></button></span></h3>
      <div class="inv-tabs" role="tablist">
        <button class="ds-btn" type="button" role="tab" data-tab="gear" aria-selected="${this.tab === 'gear'}">GEAR</button>
        <button class="ds-btn" type="button" role="tab" data-tab="pack" aria-selected="${this.tab === 'pack'}">PACK</button>
      </div>
      <div class="inv-preview"></div>
      <div class="inv-equip-grid">${equipmentCells}</div>
      <div class="inv-belt">${belt}<span class="inv-belt-note">quick draughts &amp; dishes · ▾ to assign</span></div>${beltMenu}
      <div class="inv-pouch">${pouch}</div>
      <div class="inv-divider"></div>
      <div class="inv-pack-col"><h4>BACKPACK &nbsp;<span class="inv-count">${stacks.size} / ${PACK_SLOTS}${hidden ? ` · ${hidden} hidden` : ''}</span>
        <button class="ds-btn inv-tidy" type="button" data-tidy title="Sort the pack itself: type, rarity, level, name">TIDY</button>
        <span class="inv-gold">◆ Gold: ${this.player.gold}</span></h4>
      ${filterBarHtml(this.filter)}
      <div class="inv-scroll"><div class="inv-pack-grid">${backpackCells}</div></div>
      <div class="inv-hint">right-click a cell (long-press on a phone) to <b>inspect</b> it</div></div>
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
      const ctx = this.contextOf(btn);
      btn.addEventListener('click', () => {
        this.act(ctx, btn);
        this.hideTooltip(true);
      });
      const def = btn.dataset.item ? itemDef(btn.dataset.item) : undefined;
      if (!def) return;
      // INSPECT (it.114): the right button opens the turntable view.
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hideTooltip(true);
        this.openInspect(def, ctx);
      });
      const worn = btn.dataset.unequip !== undefined;
      let hovered = false;
      attachItemCard(
        btn,
        (x, y) => {
          if (!hovered) audio.sfx('uiHover');
          hovered = true;
          this.showTooltip(def, x, y, worn, ctx);
        },
        () => {
          hovered = false;
          this.hideTooltip();
        },
      );
    });
    this.wireClose();
    wireFilterBar(this.panel, 'inventory', this.filter, () => this.render());
    this.panel.querySelector<HTMLButtonElement>('[data-journal]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      eventBus.emit('journal:open', { chapter: 'items' });
    });
    this.panel.querySelector<HTMLButtonElement>('[data-tidy]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.sfx('uiConfirm');
      this.queue.enqueue({ type: 'SORT_PACK', playerId: this.playerId });
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
      if (e.pointerType === 'touch' && !(e.target as HTMLElement).closest('button.inv-item')) this.hideTooltip(true);
    }, { passive: true });
  }

  /** What a cell does when clicked, read off its data attributes. */
  private contextOf(btn: HTMLElement): InspectContext {
    const ctx: InspectContext = {};
    if (btn.dataset.use !== undefined) ctx.use = Number(btn.dataset.use);
    else if (btn.dataset.equip !== undefined) ctx.equip = Number(btn.dataset.equip);
    else if (btn.dataset.unequip) ctx.unequip = btn.dataset.unequip as EquipmentSlot;
    return ctx;
  }

  /** Enqueue the cell's action (equip, take off, use); the pulse follows the sim's answer. */
  private act(ctx: InspectContext, cell?: HTMLElement | null): void {
    if (ctx.use !== undefined) {
      this.queue.enqueue({ type: 'USE_ITEM', playerId: this.playerId, backpackIndex: ctx.use });
    } else if (ctx.equip !== undefined) {
      this.queue.enqueue({ type: 'EQUIP', playerId: this.playerId, backpackIndex: ctx.equip });
      audio.sfx('equip'); // Steel drawn from the sheath (it.26).
      if (cell?.dataset.item) this.pulse(cell.dataset.item);
    } else if (ctx.unequip) {
      this.queue.enqueue({ type: 'UNEQUIP', playerId: this.playerId, slot: ctx.unequip });
      audio.sfx('uiClick');
    }
  }

  /** THE PULSE (it.114): every cell showing the item flares once. Survives a repaint because it runs after the sim's own re-render. */
  private pulse(itemId: string): void {
    for (const cell of this.panel.querySelectorAll<HTMLElement>(`.inv-cell[data-item="${CSS.escape(itemId)}"]`)) {
      cell.classList.remove('inv-pulse');
      void cell.offsetWidth; // Restart the animation.
      cell.classList.add('inv-pulse');
      cell.addEventListener('animationend', () => cell.classList.remove('inv-pulse'), { once: true });
    }
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
  private showTooltip(def: ItemDef, x: number, y: number, self: boolean, ctx: InspectContext = {}): void {
    this.cancelHide();
    // The card STAYS PUT once shown for a cell (it.114), so the pointer can cross onto its INSPECT button.
    if (this.tipFor === def.id && this.tooltip.classList.contains('show')) return;
    this.tipFor = def.id;
    this.tipCtx = ctx;
    const verb = document.body.classList.contains('input-touch') ? 'tap' : 'click';
    const action = def.slot === 'food' ? 'eat' : def.slot === 'consumable' ? 'use' : self ? 'take off' : 'equip';
    const gold = `worth ${itemValue(def)} gold · ${verb} to ${action}`;
    this.tooltip.innerHTML = self
      ? itemCardHtml(def, { goldLine: gold, self: true, inspect: true })
      : itemCardHtml(def, { goldLine: gold, worn: usable(def) ? undefined : wornFor(this.player, def), inspect: true });
    this.tooltip.querySelector<HTMLButtonElement>('[data-inspect]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      audio.sfx('uiClick');
      this.hideTooltip(true);
      this.openInspect(def, this.tipCtx);
    });
    this.tooltip.classList.add('show');
    placeCard(this.tooltip, x, y);
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  /** Fold the card - after a beat by default, so a pointer heading for the card keeps it. */
  private hideTooltip(now = false): void {
    this.cancelHide();
    const fold = (): void => {
      this.hideTimer = null;
      this.tooltip.classList.remove('show');
      this.tipFor = null;
    };
    if (now) fold();
    else this.hideTimer = window.setTimeout(fold, 160);
  }

  // ---- THE INSPECT VIEW (it.114) -------------------------------------------------

  /** The layout's viewport (`--app-w/--app-h`, it.66), the document as the fallback. */
  private static appSize(): { w: number; h: number } {
    const css = getComputedStyle(document.documentElement);
    return {
      w: parseFloat(css.getPropertyValue('--app-w')) || document.documentElement.clientWidth,
      h: parseFloat(css.getPropertyValue('--app-h')) || document.documentElement.clientHeight,
    };
  }

  /** Open the stage on an item: the turntable at three times its size (less on a narrow screen), the card, the action. */
  openInspect(def: ItemDef, ctx: InspectContext = {}): void {
    this.stopInspectAnim();
    const spin = itemSpin(def);
    const { w, h } = InventoryUI.appSize();
    const touch = document.body.classList.contains('input-touch');
    // The stage: as wide as the window allows, up to 300 px; the turntable fills it at up to 3×.
    const stageW = Math.max(160, Math.min(300, w - 56));
    const stageH = Math.max(120, Math.min(200, Math.round(h * 0.28)));
    let stage: string;
    if (spin) {
      const scale = Math.min(3, (stageW - 24) / spin.cellW, (stageH - 20) / spin.cellH);
      stage = `<div class="insp-turn${spin.nearest ? ' pixel' : ''}" data-turn style="width:${spin.cellW}px;height:${spin.cellH}px;background-image:url(${spin.url});background-position:0 0;transform:scale(${scale.toFixed(3)})"></div>`;
    } else {
      stage = `<div class="insp-static-wrap">${itemIconHtml(def, 'insp-static')}</div>`;
    }
    const verb = ctx.use !== undefined ? (def.slot === 'food' ? 'EAT IT' : def.use?.smelt ? 'SMELT IT' : def.use?.recipe || /^(scroll|tome)$/.test(kindWord(def)) ? 'READ IT' : 'DRINK IT') : ctx.equip !== undefined ? 'EQUIP IT' : ctx.unequip ? 'TAKE IT OFF' : '';
    const self = ctx.unequip !== undefined;
    const goldLine = `worth ${itemValue(def)} gold`;
    const card = self ? itemCardHtml(def, { goldLine, self: true }) : itemCardHtml(def, { goldLine, worn: usable(def) ? undefined : wornFor(this.player, def) });
    const tier = def.use?.food ? ` · ${cap(def.use.food.tier)}` : '';
    this.inspect.innerHTML = `
      <div class="insp-frame rarity-${def.rarity} ${effectClass(def)}">
        <i class="insp-rune tl">✦</i><i class="insp-rune tr">✦</i><i class="insp-rune bl">✦</i><i class="insp-rune br">✦</i>
        <div class="insp-head drag-handle"><span class="insp-title">INSPECT</span><button class="tp-close" data-close title="Close (ESC)"><i></i></button></div>
        <div class="insp-stage" style="width:${stageW}px;height:${stageH}px;--rar-hex:${hex(RARITY_COLOR[def.rarity])}"><div class="insp-sweep"></div><div class="insp-floor"></div>${stage}<span class="insp-hint">${spin ? `turntable · ${spin.frames} frames` : 'no turntable · the icon'}</span></div>
        <div class="insp-name" style="color:${hex(RARITY_COLOR[def.rarity])}">${def.name}</div>
        <div class="insp-meta">${cap(def.rarity)} · ${slotLabel(def.slot)}${def.ilvl ? ` · iLvl ${def.ilvl}` : ''}${tier}${self ? ' · <b>worn</b>' : ''}</div>
        <div class="insp-card">${card}</div>
        ${def.desc && (def.slot === 'mainHand' || def.ilvl) && !card.includes(def.desc) ? `<div class="insp-flavour">${def.desc}</div>` : ''}
        <div class="insp-actions">${verb ? `<button class="ds-btn insp-act" type="button" data-act>${verb}</button>` : ''}<button class="ds-btn" type="button" data-close>CLOSE</button></div>
        <div class="insp-foot">${touch ? 'tap outside to close' : 'ESC or click outside to close'}</div>
      </div>`;
    this.inspect.classList.add('open');
    this.inspectOpen = true;
    audio.sfx('uiConfirm');
    for (const b of this.inspect.querySelectorAll<HTMLElement>('[data-close]')) {
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeInspect();
      });
    }
    this.inspect.querySelector<HTMLButtonElement>('[data-act]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.act(ctx);
      this.closeInspect();
    });
    // A click on the dark outside the frame closes it.
    this.inspect.onclick = (e) => {
      if (e.target === this.inspect) this.closeInspect();
    };
    // Step the strip at 20 fps by background-position, the way the bestiary walks a creature.
    const turn = this.inspect.querySelector<HTMLElement>('[data-turn]');
    if (turn && spin && spin.frames > 1) {
      let f = 0;
      this.inspectTimer = window.setInterval(() => {
        f = (f + 1) % spin.frames;
        turn.style.backgroundPosition = `${-f * spin.cellW}px 0px`;
      }, 50);
    }
  }

  closeInspect(): void {
    if (!this.inspectOpen) return;
    this.inspectOpen = false;
    this.stopInspectAnim();
    this.inspect.classList.remove('open');
    audio.sfx('uiBack');
  }

  private stopInspectAnim(): void {
    if (this.inspectTimer !== null) {
      clearInterval(this.inspectTimer);
      this.inspectTimer = null;
    }
  }
}
