/**
 * @module ui/StatsBoard
 * THE DUNGEON RECORDS (it.48): the board by the south street tallies the
 * run — kills, wardens slain, gold scooped, the deepest depth and the time
 * spent in the dark. Pure DOM, read-only: it asks the run for its numbers
 * when it opens and once a second while it stays open.
 */

import { audio } from '@/engine/AudioManager';

export interface RunStats {
  kills: number;
  bosses: number;
  gold: number;
  deepest: number;
  playtimeTicks: number;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

function clock(ticks: number): string {
  const s = Math.floor(ticks / 60);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m ${sec.toString().padStart(2, '0')}s`;
}

export class StatsBoardUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private timer = 0;
  private readonly abort = new AbortController();

  constructor(private readonly stats: () => RunStats) {
    this.panel = document.createElement('div');
    this.panel.id = 'stats-board';
    this.panel.className = 'town-panel';
    document.body.appendChild(this.panel);
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
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove('open');
    window.clearInterval(this.timer);
    audio.sfx('invClose');
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  private render(): void {
    const s = this.stats();
    const rows: Array<[string, string, string]> = [
      ['⚔', 'TOTAL KILLS', `${s.kills}`],
      ['♛', 'WARDENS SLAIN', `${s.bosses}`],
      ['◆', 'GOLD COLLECTED', `${s.gold}`],
      ['▼', 'DEEPEST DEPTH', s.deepest > 0 ? `DEPTH ${ROMAN[s.deepest - 1] ?? s.deepest}` : 'THE TOWN'],
      ['⌛', 'TIME IN THE DARK', clock(s.playtimeTicks)],
    ];
    this.panel.innerHTML = `
      <div class="tp-head drag-handle"><h3>DUNGEON RECORDS</h3><span class="tp-vendor">this delver's tally</span><button class="tp-close" data-close>✕</button></div>
      <div class="sb-rows">${rows.map(([g, k, v]) => `<div class="sb-row"><span class="sb-glyph">${g}</span><span class="sb-key">${k}</span><b class="sb-val">${v}</b></div>`).join('')}</div>
      <div class="tp-note">The board remembers every run of this slot · ESC closes</div>`;
    this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  destroy(): void {
    this.abort.abort();
    window.clearInterval(this.timer);
    this.panel.remove();
  }
}
