/**
 * @module ui/SavePanel
 * Save slots (it.39): three rows over the title screen. In LOAD mode a
 * filled slot offers LOAD / DELETE; in NEW mode (every slot taken) a row
 * offers OVERWRITE so a fresh descent can still begin. Pure DOM; the
 * actual run start/teardown happens in main through the hooks.
 */

import { audio } from '@/engine/AudioManager';
import { saves, SAVE_SLOTS, type SaveMeta } from '@/persist/SaveGame';

export interface SavePanelHooks {
  load: (slot: number) => void;
  /** NEW mode: start the pending new game in this slot (overwriting it). */
  overwrite: (slot: number) => void;
  /** Panel dismissed without a choice (BACK / ESC). */
  onClose?: () => void;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

function fmtTime(ticks: number): string {
  const s = Math.floor(ticks / 60);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export class SavePanelUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private mode: 'load' | 'new' = 'load';

  constructor(private readonly hooks: SavePanelHooks) {
    this.panel = document.createElement('div');
    this.panel.id = 'save-panel';
    this.panel.className = 'modal';
    document.body.appendChild(this.panel);
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape' && this.visible) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      }
    }, { capture: true });
  }

  get isOpen(): boolean {
    return this.visible;
  }

  open(mode: 'load' | 'new'): void {
    this.mode = mode;
    this.visible = true;
    this.panel.classList.add('show');
    this.render();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove('show');
    audio.sfx('uiBack');
    this.hooks.onClose?.();
  }

  private render(): void {
    const metas = saves.list();
    const rows = Array.from({ length: SAVE_SLOTS }, (_, i) => {
      const slot = i + 1;
      const m: SaveMeta | null = metas[i];
      if (!m) {
        return `<div class="sv-row empty"><div class="sv-slot">SLOT ${slot}</div><div class="sv-desc">Empty</div>
          ${this.mode === 'new' ? `<button class="menu-btn sv-btn" data-new="${slot}">BEGIN HERE</button>` : ''}</div>`;
      }
      const desc = `${m.archetype.toUpperCase()} · LVL ${m.level} · DEPTH ${ROMAN[Math.max(0, m.deepestFloor - 1)] ?? m.deepestFloor} · ◆ ${m.gold} · ${fmtTime(m.playtimeTicks)}`;
      const when = new Date(m.updatedAt).toLocaleString();
      return `<div class="sv-row"><div class="sv-slot">SLOT ${slot}</div><div class="sv-desc">${desc}<span class="sv-when">${when}</span></div>
        ${this.mode === 'load' ? `<button class="menu-btn sv-btn" data-load="${slot}">LOAD</button><button class="menu-btn sv-btn danger" data-delete="${slot}">DELETE</button>` : `<button class="menu-btn sv-btn danger" data-new="${slot}">OVERWRITE</button>`}</div>`;
    }).join('');
    this.panel.innerHTML = `<div class="modal-panel sv-panel">
      <h2>${this.mode === 'load' ? 'LOAD GAME' : 'CHOOSE A SLOT'}</h2>
      <p class="modal-sub">${this.mode === 'load' ? 'the dark remembers three delvers' : 'every slot is taken — overwrite one to begin'}</p>
      <div class="sv-rows">${rows}</div>
      <button class="menu-btn" data-close>BACK</button></div>`;
    this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.panel.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('mouseenter', () => audio.sfx('uiHover')));
    this.panel.querySelectorAll<HTMLButtonElement>('[data-load]').forEach((b) =>
      b.addEventListener('click', () => {
        audio.sfx('uiConfirm');
        this.visible = false;
        this.panel.classList.remove('show');
        this.hooks.load(Number(b.dataset.load));
      }),
    );
    this.panel.querySelectorAll<HTMLButtonElement>('[data-new]').forEach((b) =>
      b.addEventListener('click', () => {
        audio.sfx('uiConfirm');
        this.visible = false;
        this.panel.classList.remove('show');
        this.hooks.overwrite(Number(b.dataset.new));
      }),
    );
    this.panel.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((b) =>
      b.addEventListener('click', () => {
        audio.sfx('uiBack');
        saves.remove(Number(b.dataset.delete));
        this.render();
      }),
    );
  }
}
