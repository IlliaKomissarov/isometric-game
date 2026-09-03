/**
 * @module ui/LeaderboardPanel
 * THE HALL OF RECORDS (it.54): the town board opens a two-tab leaderboard —
 * DUNGEON SPEEDRUNS (deepest and fastest floor clears) and the GLADIATOR
 * COLISEUM (best times for the 5 / 10 / 15 / 20-wave trials) — each a
 * dark-fantasy table of rank, class, clear time, floor or wave, and date,
 * over a strip of the ledger's tallies. Pure DOM, read-only.
 */

import { audio } from '@/engine/AudioManager';
import { ARENA_LENGTHS, clockFromTicks, type ArenaLength, type StatsManager } from '@/systems/StatsManager';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
const CLASS_NAME: Record<string, string> = { warrior: 'Warrior', mage: 'Mage', ranger: 'Ranger', rogue: 'Rogue' };

function dateOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

export class LeaderboardUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private tab: 'dungeon' | 'arena' = 'dungeon';
  private arenaLen: ArenaLength = 5;
  private readonly abort = new AbortController();

  constructor(
    private readonly stats: StatsManager,
    /** The live run's own tallies (this delver, this slot). */
    private readonly live: () => { cls: string; playtimeTicks: number; gold: number },
  ) {
    this.panel = document.createElement('div');
    this.panel.id = 'leaderboard';
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

  open(tab: 'dungeon' | 'arena' = this.tab): void {
    this.tab = tab;
    if (this.visible) {
      this.render();
      return;
    }
    this.visible = true;
    this.panel.classList.add('open');
    audio.sfx('invOpen');
    this.render();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove('open');
    audio.sfx('invClose');
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  private render(): void {
    const s = this.stats;
    const live = this.live();
    const cell = (v: string, cls = ''): string => `<td class="${cls}">${v}</td>`;
    const empty = (n: number, from: number): string =>
      Array.from({ length: n }, (_, i) => `<tr class="lb-empty"><td>#${from + i + 1}</td><td colspan="4">— the ledger waits —</td></tr>`).join('');

    let table: string;
    let summary: string;
    if (this.tab === 'dungeon') {
      const rows = s.dungeon.records
        .map(
          (r, i) =>
            `<tr class="${i === 0 ? 'lb-first' : ''}">${cell(`#${i + 1}`, 'lb-rank')}${cell(CLASS_NAME[r.cls] ?? r.cls)}${cell(clockFromTicks(r.ticks), 'lb-time')}${cell(`Depth ${ROMAN[r.floor - 1] ?? r.floor}`)}${cell(dateOf(r.date), 'lb-date')}</tr>`,
        )
        .join('');
      table = `<table class="lb-table"><thead><tr><th>RANK</th><th>CLASS</th><th>CLEAR TIME</th><th>FLOOR</th><th>DATE</th></tr></thead><tbody>${rows}${empty(Math.max(0, 10 - s.dungeon.records.length), s.dungeon.records.length)}</tbody></table>`;
      summary = `
        <div class="lb-sum"><span>DEEPEST DEPTH</span><b>${s.dungeon.deepestFloor > 0 ? `DEPTH ${ROMAN[s.dungeon.deepestFloor - 1] ?? s.dungeon.deepestFloor}` : 'THE TOWN'}</b></div>
        <div class="lb-sum"><span>DUNGEON KILLS</span><b>${s.dungeon.kills}</b></div>
        <div class="lb-sum"><span>WARDENS SLAIN</span><b>${s.dungeon.bossKills}</b></div>
        <div class="lb-sum"><span>THIS DELVER</span><b>${CLASS_NAME[live.cls] ?? live.cls} · ${clockFromTicks(live.playtimeTicks)} · ${live.gold} gold</b></div>`;
    } else {
      const list = s.arena.clears[this.arenaLen];
      const rows = list
        .map(
          (r, i) =>
            `<tr class="${i === 0 ? 'lb-first' : ''}">${cell(`#${i + 1}`, 'lb-rank')}${cell(CLASS_NAME[r.cls] ?? r.cls)}${cell(clockFromTicks(r.ticks), 'lb-time')}${cell(`Wave ${r.wave}`)}${cell(dateOf(r.date), 'lb-date')}</tr>`,
        )
        .join('');
      const lens = ARENA_LENGTHS.map((n) => `<button class="lb-len${n === this.arenaLen ? ' active' : ''}" data-len="${n}">${n} WAVES</button>`).join('');
      table = `<div class="lb-lens">${lens}</div><table class="lb-table"><thead><tr><th>RANK</th><th>CLASS</th><th>CLEAR TIME</th><th>WAVES</th><th>DATE</th></tr></thead><tbody>${rows}${empty(Math.max(0, 10 - list.length), list.length)}</tbody></table>`;
      summary = `
        <div class="lb-sum"><span>BEST WAVE</span><b>${s.arena.bestWave || '—'}</b></div>
        <div class="lb-sum"><span>ARENA KILLS</span><b>${s.arena.kills}</b></div>
        <div class="lb-sum"><span>CHAMPIONS FELLED</span><b>${s.arena.bossKills}</b></div>
        <div class="lb-sum"><span>GLADIATOR RANK</span><b class="lb-rankname">${s.rank()}</b></div>`;
    }

    this.panel.innerHTML = `
      <div class="tp-head drag-handle"><h3>HALL OF RECORDS</h3><span class="tp-vendor">the ledger of every delver</span><button class="tp-close" data-close>✕</button></div>
      <div class="lb-tabs">
        <button class="lb-tab${this.tab === 'dungeon' ? ' active' : ''}" data-tab="dungeon">DUNGEON SPEEDRUNS</button>
        <button class="lb-tab${this.tab === 'arena' ? ' active' : ''}" data-tab="arena">GLADIATOR COLISEUM</button>
      </div>
      <div class="lb-body">${table}</div>
      <div class="lb-summary">${summary}</div>
      <div class="tp-note">Times count only active floors and live waves · the town clock stands still · ESC closes</div>`;
    this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.panel.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        audio.sfx('uiClick');
        this.tab = b.dataset.tab as 'dungeon' | 'arena';
        this.render();
      });
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) => {
      b.addEventListener('click', () => {
        audio.sfx('uiClick');
        this.arenaLen = Number(b.dataset.len) as ArenaLength;
        this.render();
      });
    });
  }

  destroy(): void {
    this.abort.abort();
    this.panel.remove();
  }
}
