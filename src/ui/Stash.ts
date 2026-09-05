/**
 * @module ui/Stash
 * The town stash (it.39): PACK on the left, STASH on the right, gold moved
 * by the buttons between. Every move is a STASH_PUT / STASH_TAKE /
 * STASH_GOLD command applied by systems/Town inside the tick. The stash
 * itself is saved with the slot, so anything placed here survives death,
 * restarts and reloads.
 */

import { eventBus } from '@/core/EventBus';
import type { InputQueue } from '@/core/InputQueue';
import { audio } from '@/engine/AudioManager';
import type { Player } from '@/entities/Player';
import { itemDef } from '@/items/instance';
import { type ItemDef } from '@/items/catalog';
import { STASH_CAPACITY, type TownSystem } from '@/systems/Town';
import { itemIconHtml } from './itemIcons';
import { hideItemTip, wireItemTips, wornFor } from './itemTip';
import { effectClass, filterBarHtml, loadFilter, orderIndexes, wireFilterBar, type FilterState } from './itemFilter';
import { keepScroll } from './keepScroll';

const iconHtml = (def: ItemDef): string => itemIconHtml(def);

export class StashUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private readonly offs: Array<() => void> = [];
  private readonly abort = new AbortController();
  /** FILTERS (it.81): the pack's and the chest's, remembered. */
  private readonly filterPack: FilterState = loadFilter('stash-pack');
  private readonly filterBox: FilterState = loadFilter('stash-box');

  constructor(
    private readonly player: Player,
    private readonly town: TownSystem,
    private readonly queue: InputQueue,
  ) {
    this.panel = document.createElement('div');
    this.panel.id = 'stash-panel';
    this.panel.className = 'town-panel';
    document.body.appendChild(this.panel);
    this.offs.push(eventBus.on('inventory:changed', () => this.visible && this.render()));
    this.offs.push(eventBus.on('town:changed', () => this.visible && this.render()));
    this.offs.push(
      eventBus.on('town:refused', ({ reason }) => {
        if (!this.visible) return;
        audio.sfx('uiBack');
        const note = this.panel.querySelector('.tp-note');
        if (note) note.textContent = reason === 'stashFull' ? `The stash holds ${STASH_CAPACITY} items — it is full.` : 'Not enough gold.';
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
    audio.sfx('stash');
    this.render();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove('open');
    hideItemTip();
    audio.sfx('invClose');
  }

  /** Repaint without losing where the player had scrolled (it.79). */
  private render(): void {
    keepScroll(this.panel, () => this.paint());
  }

  private paint(): void {
    const p = this.player;
    const s = this.town.stash;
    const row = (def: ItemDef, attr: string, i: number): string =>
      `<button class="tp-row rarity-${def.rarity} ${effectClass(def)}" ${attr}="${i}" data-tip="${def.id}">${iconHtml(def)}<span class="tp-name">${def.name}${def.ilvl ? `<span class="tp-meta">iLvl ${def.ilvl}${def.upgrade ? ` · +${def.upgrade}` : ''}</span>` : ''}</span><span class="tp-arrow">${attr === 'data-put' ? '→' : '←'}</span></button>`;
    const packDefs = p.backpack.map((id) => itemDef(id));
    const pack = orderIndexes(packDefs, this.filterPack)
      .map((i) => row(packDefs[i]!, 'data-put', i))
      .join('');
    const boxDefs = s.items.map((id) => itemDef(id));
    const stash = orderIndexes(boxDefs, this.filterBox)
      .map((i) => row(boxDefs[i]!, 'data-take', i))
      .join('');
    this.panel.innerHTML = `
      <div class="tp-head drag-handle"><h3>THE STASH</h3><span class="tp-purse">◆ ${p.gold} carried · ◆ ${s.gold} stashed</span><button class="tp-close" data-close title="Close (ESC)"><i></i></button></div>
      <div class="tp-cols">
        <div class="tp-col"><h4>YOUR PACK · ${p.backpack.length}</h4>${filterBarHtml(this.filterPack, { id: 'if-stash-pack' })}<div class="tp-list">${pack || '<span class="tp-empty">Nothing carried</span>'}</div></div>
        <div class="tp-col"><h4>STASH · ${s.items.length}/${STASH_CAPACITY}</h4>${filterBarHtml(this.filterBox, { id: 'if-stash-box' })}<div class="tp-list">${stash || '<span class="tp-empty">Empty</span>'}</div></div>
      </div>
      <div class="tp-goldrow">
        <button data-gold="100">DEPOSIT 100</button><button data-gold="all">DEPOSIT ALL</button>
        <button data-gold="-100">WITHDRAW 100</button><button data-gold="-all">WITHDRAW ALL</button>
      </div>
      <div class="tp-note">Click an item to move it · gold in the stash never leaves the slot · ESC closes</div>`;
    const closeBtn = this.panel.querySelector<HTMLElement>('[data-close]');
    closeBtn?.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    closeBtn?.addEventListener('click', () => {
      audio.sfx('uiClick');
      this.close();
    });
    wireFilterBar(this.panel.querySelector('#if-stash-pack') as HTMLElement, 'stash-pack', this.filterPack, () => this.render());
    wireFilterBar(this.panel.querySelector('#if-stash-box') as HTMLElement, 'stash-box', this.filterBox, () => this.render());
    this.panel.querySelectorAll<HTMLButtonElement>('[data-put]').forEach((b) => {
      b.addEventListener('click', () => {
        this.queue.enqueue({ type: 'STASH_PUT', playerId: 0, backpackIndex: Number(b.dataset.put) });
        audio.sfx('uiClick');
      });
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-take]').forEach((b) => {
      b.addEventListener('click', () => {
        this.queue.enqueue({ type: 'STASH_TAKE', playerId: 0, index: Number(b.dataset.take) });
        audio.sfx('uiClick');
      });
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-gold]').forEach((b) => {
      b.addEventListener('click', () => {
        const v = b.dataset.gold!;
        const amount = v === 'all' ? p.gold : v === '-all' ? -s.gold : Number(v);
        if (amount !== 0) {
          this.queue.enqueue({ type: 'STASH_GOLD', playerId: 0, amount });
          audio.sfx('gold');
        }
      });
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    });
    wireItemTips(this.panel, (id) => itemDef(id), (def) => `Worth ${this.town.buyPrice(def)} gold`, (def) => wornFor(this.player, def));
  }

  destroy(): void {
    this.abort.abort();
    for (const off of this.offs) off();
    hideItemTip();
    this.panel.remove();
  }
}
