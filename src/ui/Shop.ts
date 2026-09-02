/**
 * @module ui/Shop
 * The merchant panel (it.39): FOR SALE on the left, YOUR PACK on the right,
 * the hero's gold across the top. Pure DOM — every trade is a BUY / SELL
 * command on the InputQueue, applied by systems/Town inside the tick; the
 * panel re-renders on `inventory:changed` / `town:changed`.
 */

import { eventBus } from '@/core/EventBus';
import type { InputQueue } from '@/core/InputQueue';
import { audio } from '@/engine/AudioManager';
import type { Player } from '@/entities/Player';
import { ITEMS, type ItemDef } from '@/items/catalog';
import type { TownSystem } from '@/systems/Town';
import { itemIconHtml } from './itemIcons';
import { hideItemTip, wireItemTips } from './itemTip';

const iconHtml = (def: ItemDef): string => itemIconHtml(def);

export class ShopUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private readonly offs: Array<() => void> = [];
  private readonly abort = new AbortController();

  constructor(
    private readonly player: Player,
    private readonly town: TownSystem,
    private readonly queue: InputQueue,
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

  open(): void {
    if (this.visible) return;
    this.visible = true;
    this.panel.classList.add('open');
    audio.sfx('invOpen');
    this.render();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove('open');
    hideItemTip();
    audio.sfx('invClose');
  }

  private render(): void {
    const p = this.player;
    const sale = this.town.stock
      .map((id, i) => {
        const def = ITEMS[id];
        const price = this.town.buyPrice(def);
        const poor = p.gold < price;
        return `<button class="tp-row rarity-${def.rarity}${poor ? ' poor' : ''}" data-buy="${i}" data-tip="${def.id}">${iconHtml(def)}<span class="tp-name">${def.name}</span><span class="tp-gold">${price}◆</span></button>`;
      })
      .join('');
    const pack = p.backpack
      .map((id, i) => {
        const def = ITEMS[id];
        if (!def) return '';
        return `<button class="tp-row rarity-${def.rarity}" data-sell="${i}" data-tip="${def.id}">${iconHtml(def)}<span class="tp-name">${def.name}</span><span class="tp-gold">+${this.town.sellPrice(def)}◆</span></button>`;
      })
      .join('');
    const buyback = this.town.buyback
      .map((id, i) => {
        const def = ITEMS[id];
        if (!def) return '';
        const price = this.town.sellPrice(def);
        const poor = p.gold < price;
        return `<button class="tp-row tp-buyback rarity-${def.rarity}${poor ? ' poor' : ''}" data-buyback="${i}" data-tip="${def.id}">${iconHtml(def)}<span class="tp-name">${def.name}</span><span class="tp-gold">${price}◆</span></button>`;
      })
      .join('');
    this.panel.innerHTML = `
      <div class="tp-head"><h3>THE MERCHANT</h3><span class="tp-purse">◆ ${p.gold} gold</span><button class="tp-close" data-close>✕</button></div>
      <div class="tp-cols">
        <div class="tp-col"><h4>FOR SALE</h4><div class="tp-list">${sale || '<span class="tp-empty">Sold out</span>'}${buyback ? `<h4 class="tp-sub">BUYBACK · what you sold</h4>${buyback}` : ''}</div></div>
        <div class="tp-col"><h4>YOUR PACK · sell</h4><div class="tp-list">${pack || '<span class="tp-empty">Nothing to sell</span>'}</div></div>
      </div>
      <div class="tp-note">Click an item to buy or sell · sold goods wait on the counter until the next visit · ESC closes</div>`;
    this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.panel.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => {
      b.addEventListener('click', () => this.queue.enqueue({ type: 'BUY', playerId: 0, index: Number(b.dataset.buy) }));
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
    wireItemTips(this.panel, ITEMS, (def) => `Buy ${this.town.buyPrice(def)} · buyback ${this.town.sellPrice(def)} · sells for ${this.town.sellPrice(def)} gold`);
  }

  destroy(): void {
    this.abort.abort();
    for (const off of this.offs) off();
    hideItemTip();
    this.panel.remove();
  }
}
