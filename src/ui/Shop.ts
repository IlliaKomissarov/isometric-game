/**
 * @module ui/Shop
 * THE MERCHANTS (it.39, it.48, overhauled it.78): the armorer's and the
 * alchemist's counters. Left column: FOR SALE and the BUYBACK tab (the last
 * fifteen pieces sold, bought back for what was paid); right column: the
 * hero's pack to sell. The header counts down to the next restock (thirty
 * in-game minutes, or a warden's fall). Every row carries the item card;
 * a click enqueues BUY / SELL / BUYBACK — the town system does the rest.
 */

import { eventBus } from '@/core/EventBus';
import type { InputQueue } from '@/core/InputQueue';
import { audio } from '@/engine/AudioManager';
import type { Player } from '@/entities/Player';
import type { ItemDef } from '@/items/catalog';
import { itemDef } from '@/items/instance';
import type { TownSystem } from '@/systems/Town';
import { itemIconHtml } from './itemIcons';
import { hideItemTip, wireItemTips, wornFor } from './itemTip';
import { keepScroll } from './keepScroll';

const iconHtml = (def: ItemDef): string => itemIconHtml(def);

/** "iLvl 12 · +3" for rolled gear, nothing for a plain draught. */
function meta(def: ItemDef): string {
  const bits: string[] = [];
  if (def.ilvl) bits.push(`iLvl ${def.ilvl}`);
  if (def.affixes?.length) bits.push(`${def.affixes.length} affix${def.affixes.length > 1 ? 'es' : ''}`);
  return bits.length ? `<span class="tp-meta">${bits.join(' · ')}</span>` : '';
}

function clock(ticks: number): string {
  const s = Math.ceil(ticks / 60);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export class ShopUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private readonly offs: Array<() => void> = [];
  private readonly abort = new AbortController();
  /** Which shopkeeper the panel shows (it.48). */
  private vendor: 'armorer' | 'alchemist' = 'armorer';
  /** The left column's tab (it.78). */
  private tab: 'sale' | 'buyback' = 'sale';
  private clockTimer = 0;

  constructor(
    private readonly player: Player,
    private readonly town: TownSystem,
    private readonly queue: InputQueue,
    /** The sim's tick, for the restock clock. */
    private readonly tickNow: () => number = () => 0,
  ) {
    this.panel = document.createElement('div');
    this.panel.id = 'shop-panel';
    this.panel.className = 'town-panel';
    document.body.appendChild(this.panel);
    this.offs.push(eventBus.on('inventory:changed', () => this.visible && this.render()));
    this.offs.push(eventBus.on('town:changed', () => this.visible && this.render()));
    this.offs.push(
      eventBus.on('town:traded', ({ kind }) => {
        audio.sfx(kind === 'buy' ? 'buy' : 'sell');
      }),
    );
    this.offs.push(
      eventBus.on('town:refused', ({ reason }) => {
        if (!this.visible) return;
        audio.sfx('uiBack');
        const note = this.panel.querySelector('.tp-note');
        if (note) note.textContent = reason === 'gold' ? 'Not enough gold.' : 'The stash is full.';
      }),
    );
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'Escape' && this.visible) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.close();
        }
      },
      { signal: this.abort.signal, capture: true },
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  open(vendor: 'armorer' | 'alchemist' = 'armorer'): void {
    if (this.visible && this.vendor === vendor) return;
    this.vendor = vendor;
    this.tab = 'sale';
    if (!this.visible) audio.sfx('invOpen');
    this.visible = true;
    this.panel.classList.add('open');
    this.render();
    if (!this.clockTimer) this.clockTimer = window.setInterval(() => this.tickClock(), 1000);
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove('open');
    hideItemTip();
    audio.sfx('invClose');
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = 0;
    }
  }

  private tickClock(): void {
    const el = this.panel.querySelector('[data-restock]');
    if (!el) return;
    const t = this.town.ticksToRestock(this.tickNow());
    el.textContent = t > 0 ? `restock in ${clock(t)}` : 'restocking…';
  }

  private row(def: ItemDef, attr: string, i: number, gold: string, poor: boolean, extraClass = ''): string {
    return `<button class="tp-row rarity-${def.rarity}${poor ? ' poor' : ''}${extraClass}" ${attr}="${i}" data-tip="${def.id}">${iconHtml(def)}<span class="tp-name">${def.name}${meta(def)}</span><span class="tp-gold">${gold}</span></button>`;
  }

  /** Repaint without losing where the player had scrolled (it.79). */
  private render(): void {
    keepScroll(this.panel, () => this.paint());
  }

  private paint(): void {
    const p = this.player;
    const vendor = this.vendor;
    const table = vendor === 'alchemist' ? this.town.stockAlch : this.town.stock;
    const sale = table
      .map((id, i) => {
        const def = itemDef(id);
        if (!def) return '';
        const price = this.town.buyPrice(def);
        return this.row(def, 'data-buy', i, `${price}◆`, p.gold < price);
      })
      .join('');
    const pack = p.backpack
      .map((id, i) => {
        const def = itemDef(id);
        if (!def) return '';
        return this.row(def, 'data-sell', i, `+${this.town.sellPrice(def)}◆`, false);
      })
      .join('');
    const buyback = this.town.buyback
      .map((id, i) => {
        const def = itemDef(id);
        if (!def) return '';
        const price = this.town.sellPrice(def);
        return this.row(def, 'data-buyback', i, `${price}◆`, p.gold < price, ' tp-buyback');
      })
      .join('');
    const left = this.tab === 'sale' ? sale || '<span class="tp-empty">Sold out — the counter restocks on the clock</span>' : buyback || '<span class="tp-empty">Nothing sold yet</span>';
    const restock = this.town.ticksToRestock(this.tickNow());
    this.panel.innerHTML = `
      <div class="tp-head drag-handle"><h3>${vendor === 'alchemist' ? 'THE ALCHEMIST' : 'THE ARMORER'}</h3><span class="tp-vendor">${vendor === 'alchemist' ? 'draughts · scrolls' : 'arms · armor · materials'} · <i data-restock>${restock > 0 ? `restock in ${clock(restock)}` : 'restocking…'}</i></span><span class="tp-purse">◆ ${p.gold} gold</span><button class="tp-close" data-close title="Close (ESC)"><i></i></button></div>
      <div class="tp-cols">
        <div class="tp-col">
          <div class="tp-tabs" role="tablist">
            <button class="ds-btn" type="button" role="tab" data-shoptab="sale" aria-selected="${this.tab === 'sale'}">FOR SALE</button>
            <button class="ds-btn" type="button" role="tab" data-shoptab="buyback" aria-selected="${this.tab === 'buyback'}">BUYBACK · ${this.town.buyback.length}</button>
          </div>
          <div class="tp-list">${left}</div>
        </div>
        <div class="tp-col"><h4>YOUR PACK · sell for a quarter</h4><div class="tp-list">${pack || '<span class="tp-empty">Nothing to sell</span>'}</div></div>
      </div>
      <div class="tp-note">Click an item to buy or sell · the last fifteen sold wait under BUYBACK · ESC closes</div>`;
    const closeBtn = this.panel.querySelector<HTMLElement>('[data-close]');
    closeBtn?.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    closeBtn?.addEventListener('click', () => {
      audio.sfx('uiClick');
      this.close();
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-shoptab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.shoptab === 'buyback' ? 'buyback' : 'sale';
        audio.sfx('uiClick');
        this.render();
      });
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => {
      b.addEventListener('click', () => this.queue.enqueue({ type: 'BUY', playerId: 0, index: Number(b.dataset.buy), vendor }));
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-buyback]').forEach((b) => {
      b.addEventListener('click', () => this.queue.enqueue({ type: 'BUYBACK', playerId: 0, index: Number(b.dataset.buyback) }));
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((b) => {
      b.addEventListener('click', () => this.queue.enqueue({ type: 'SELL', playerId: 0, backpackIndex: Number(b.dataset.sell) }));
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    });
    wireItemTips(this.panel, (id) => itemDef(id), (def) => `Buy ${this.town.buyPrice(def)} · sells for ${this.town.sellPrice(def)} gold`, (def) => wornFor(this.player, def));
  }

  destroy(): void {
    this.abort.abort();
    for (const off of this.offs) off();
    hideItemTip();
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.panel.remove();
  }
}
