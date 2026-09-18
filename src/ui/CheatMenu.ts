/**
 * @module ui/CheatMenu
 * THE DEVELOPER CONSOLE (F1 / `).
 *
 * THE REBUILD (it.117). The sheet had grown by accretion since it.13 — an
 * animated knight portrait took a quarter of the width, eight tabs mixed
 * "WEAPONS" with "QUESTS", there was no search across 758 items, no way to
 * see where you were standing, no record of what you had just triggered, and
 * half of it only worked with a mouse. It is now a console:
 *
 *   · a STICKY header — the close mark never scrolls away — with a live strip
 *     (place, floor, seed, tile, hp, gold, level, foes alive, fps);
 *   · seven sections: State, Travel, Spawn, Items, Hero, Quests, Log;
 *   · one search box that filters whichever section is open (758 items by
 *     name, id, slot or rarity; foes by name or kind; places; quest keys);
 *   · full keyboard drive — the search takes focus on open, Tab/Shift-Tab walk
 *     the sections, ↑/↓ walk the rows, Enter fires the lit row, Esc clears the
 *     search and then closes;
 *   · a LOG of everything fired, newest first, so a test run is readable.
 *
 * The body is the only scroll region and every grid is `minmax(0, 1fr)`, so
 * nothing can push a horizontal bar; the section strip wraps instead of
 * scrolling, and at phone width the panel goes edge to edge in one column.
 *
 * Pure DOM, one delegated click listener (758 item rows must not mean 1 516
 * listeners), and every action goes through a hook injected by main — the
 * menu owns no game logic. God mode is enforced INSIDE CombatSystem, the sole
 * hp mutator, so there is no side door.
 *
 * NOTE (it.117): the game has no time-of-day or weather system to drive, so
 * the console offers none. If one ever lands it belongs beside the toggles.
 */

import { audio } from '@/engine/AudioManager';

export interface CheatItemInfo {
  id: string;
  name: string;
  slot: string;
  rarity: string;
  /** Ready-to-embed <img> markup for the item's icon. */
  iconHtml: string;
  /** Human-readable stat line ("4–9 dmg · +2 arm"), shown under the name. */
  stats: string;
}

export interface CheatFoeInfo {
  kind: string;
  name: string;
  boss: boolean;
}

export interface CheatPlace {
  /** What `teleport` receives: a floor number, or a named mode. */
  id: number | 'coliseum' | 'menagerie';
  label: string;
  /** A second line under the label. */
  sub?: string;
}

/** One quest key and the states it can be in, in story order. */
export interface CheatQuest {
  key: string;
  label: string;
  states: string[];
}

/** Everything the live strip and the Hero section read, in one call (it.117). */
export interface CheatSnapshot {
  /** The floor's own name ("The Town", "Depth VII"). */
  place: string;
  floor: number;
  seed: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  level: number;
  xp: number;
  xpToNext: number;
  gold: number;
  skillPoints: number;
  dmgMin: number;
  dmgMax: number;
  /** Bodies still standing on this floor. */
  enemies: number;
}

/** The elite affixes a summon may wear (it.117); 'none' for the common dead. */
export type CheatAffix = 'none' | 'frost' | 'thorns' | 'vampiric';

export interface CheatHooks {
  /** Toggle invulnerability; returns the new state. */
  toggleGod: () => boolean;
  /** Toggle walking through walls; returns the new state. */
  toggleNoclip: () => boolean;
  healFull: () => void;
  giveItem: (id: string) => void;
  addGold: (n: number) => void;
  /** Set the purse outright (it.117). */
  setGold: (n: number) => void;
  killVisibleEnemies: () => void;
  revealFloor: () => void;
  /** Jump to a floor (or a named place), optionally into its arena. */
  teleport: (dest: number | 'coliseum' | 'menagerie', arena: boolean) => void;
  /** The places past the town gate, in story order. */
  places: () => CheatPlace[];
  /** Full item catalog for the item browser. */
  items: () => CheatItemInfo[];
  /** Every creature kind that can be spawned. */
  foes: () => CheatFoeInfo[];
  /** Spawn `count` of a kind beside the hero at `level`, wearing `affix`. */
  spawnFoe: (kind: string, count: number, level: number, affix: CheatAffix) => void;
  /**
   * Start streaming a kind's sheets before the click (it.115): a creature's
   * first summons waited on five atlases with nothing on screen, which read as
   * "the spawn does nothing". Hovering a foe now fetches them.
   */
  prewarmFoe?: (kind: string) => void;
  /** The quest ledger and the states each key may take. */
  quests: () => { defs: CheatQuest[]; state: Record<string, string> };
  setQuest: (key: string, value: string | null) => void;
  /** Wipe every ledger key (it.117). */
  clearQuests: () => void;
  /** Rebuild the current floor in place so a ledger change shows. */
  rebuildFloor: () => void;
  /** LEVEL: set the hero's level outright (1–30). */
  setLevel: (level: number) => void;
  /** SKILL POINTS: add (or, with a negative, take back). */
  addSkillPoints: (n: number) => void;
  /** Set the unspent skill points outright (it.117). */
  setSkillPoints: (n: number) => void;
  /** Everything the live strip reads. */
  snapshot: () => CheatSnapshot;
}

type Section = 'state' | 'travel' | 'spawn' | 'items' | 'hero' | 'quests' | 'log';

const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
  { id: 'state', label: 'State' },
  { id: 'travel', label: 'Travel' },
  { id: 'spawn', label: 'Spawn' },
  { id: 'items', label: 'Items' },
  { id: 'hero', label: 'Hero' },
  { id: 'quests', label: 'Quests' },
  { id: 'log', label: 'Log' },
];

/** Which sections the search box filters, and what it says it is filtering. */
const SEARCHABLE: Partial<Record<Section, string>> = {
  travel: 'Filter places and depths',
  spawn: 'Filter creatures by name or kind',
  items: 'Search items by name, id or slot',
  quests: 'Filter the ledger',
};

type ItemFilter = 'all' | 'weapons' | 'armor' | 'relics' | 'consumables';

const ITEM_FILTERS: ReadonlyArray<{ id: ItemFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'weapons', label: 'Weapons' },
  { id: 'armor', label: 'Armour' },
  { id: 'relics', label: 'Relics' },
  { id: 'consumables', label: 'Consumables' },
];

function groupOf(item: CheatItemInfo): ItemFilter {
  if (item.slot === 'mainHand') return 'weapons';
  if (item.slot === 'head' || item.slot === 'torso' || item.slot === 'legs' || item.slot === 'offHand') return 'armor';
  if (item.slot === 'consumable' || item.slot === 'material' || item.slot === 'food') return 'consumables';
  return 'relics';
}

const AFFIXES: ReadonlyArray<{ id: CheatAffix; label: string }> = [
  { id: 'none', label: 'Plain' },
  { id: 'frost', label: 'Frost' },
  { id: 'thorns', label: 'Thorns' },
  { id: 'vampiric', label: 'Vampiric' },
];

const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];

/** Never paint more than this many rows at once — refine the search instead. */
const ROW_CAP = 160;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface LogLine {
  at: string;
  text: string;
}

export class CheatMenuUI {
  private readonly panel: HTMLElement;
  private readonly live: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly searchRow: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly body: HTMLElement;
  private readonly hint: HTMLElement;

  private visible = false;
  private god = false;
  private noclip = false;
  private section: Section = 'state';
  private query = '';
  private itemFilter: ItemFilter = 'all';
  /** Spawn settings: how many, at what level offset from the hero, wearing what. */
  private spawnCount = 1;
  private spawnLevelDelta = 0;
  private spawnAffix: CheatAffix = 'none';
  /** Keyboard cursor: an index into the body's action rows. */
  private cursor = -1;
  private readonly log: LogLine[] = [];
  private liveTimer: number | null = null;
  private rafId = 0;
  private fps = 0;
  private lastFrame = 0;
  private readonly abort = new AbortController();

  constructor(private readonly hooks: CheatHooks) {
    this.panel = document.createElement('div');
    this.panel.id = 'cheat-menu';
    this.panel.innerHTML = `
      <div class="cheat-head drag-handle">
        <div class="cheat-title">
          <h3>Developer Console</h3>
          <span class="cheat-sub">F1 or \` · Esc closes</span>
        </div>
        <button class="tp-close" type="button" data-a="close" title="Close (F1 / Esc)" aria-label="Close"><i></i></button>
        <div class="cheat-live" id="cheat-live"></div>
      </div>
      <div class="cheat-tabs" id="cheat-tabs" role="tablist"></div>
      <div class="cheat-search" id="cheat-search">
        <input id="cheat-q" type="search" autocomplete="off" spellcheck="false" placeholder="Search" aria-label="Search">
        <button type="button" data-a="clearq" title="Clear the search">✕</button>
      </div>
      <div class="cheat-body" id="cheat-body" tabindex="-1"></div>
      <div class="cheat-hint" id="cheat-hint"></div>
    `;
    document.body.appendChild(this.panel);

    this.live = this.panel.querySelector('#cheat-live') as HTMLElement;
    this.tabsEl = this.panel.querySelector('#cheat-tabs') as HTMLElement;
    this.searchRow = this.panel.querySelector('#cheat-search') as HTMLElement;
    this.search = this.panel.querySelector('#cheat-q') as HTMLInputElement;
    this.body = this.panel.querySelector('#cheat-body') as HTMLElement;
    this.hint = this.panel.querySelector('#cheat-hint') as HTMLElement;

    const sig = this.abort.signal;
    this.panel.addEventListener('click', (e) => this.onClick(e), { signal: sig });
    this.panel.addEventListener('mouseover', (e) => this.onHover(e), { signal: sig });
    this.panel.addEventListener('change', (e) => this.onChange(e), { signal: sig });
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim();
      this.cursor = -1;
      this.paintBody();
    }, { signal: sig });
    /*
     * THE DRIVE LISTENS ON THE WINDOW, NOT THE PANEL (it.117). It was on the
     * panel, and Tab did nothing: something else on the page takes the focus
     * back the moment the console opens, so `document.activeElement` is the
     * body and a panel listener never sees the key. Reading the keys off the
     * window and gating on `visible` is what actually holds.
     */
    window.addEventListener('keydown', (e) => this.onDriveKey(e), { signal: sig, capture: true });

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if ((e.code === 'F1' || e.code === 'Backquote') && !e.repeat) {
          // A backquote typed INTO the search is a character, not a toggle.
          if (e.code === 'Backquote' && document.activeElement === this.search) return;
          e.preventDefault();
          this.toggle();
        } else if (e.code === 'Escape' && this.visible) {
          // Esc (and the bar's Menu) closes the console rather than pausing
          // over it: this listener is registered before the pause menu's.
          e.stopImmediatePropagation();
          e.preventDefault();
          if (this.query) {
            this.search.value = '';
            this.query = '';
            this.paintBody();
          } else this.toggle();
        }
      },
      { signal: sig, capture: true },
    );

    this.paintTabs();
    this.paintBody();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle('open', this.visible);
    if (this.visible) {
      this.paintBody(); // The ledger and the purse may have moved since the last look.
      this.startLive();
      this.takeFocus();
      // …and again on the next frame: the key that opened the console is still
      // being handled, and a handler after ours can take the focus back (it.117).
      requestAnimationFrame(() => this.takeFocus(true));
    } else this.stopLive();
    audio.sfx(this.visible ? 'invOpen' : 'invClose');
  }

  /**
   * Put the caret where the keys should land: in the search box on a section
   * that filters, and on the body otherwise — State, Hero and Log have nothing
   * to search, and an input that is `display: none` cannot take focus at all,
   * which is what used to leave the console keyless on opening (it.117).
   */
  private takeFocus(select = false): void {
    if (!this.visible) return;
    if (SEARCHABLE[this.section]) {
      this.search.focus();
      if (select) this.search.select();
    } else this.body.focus();
  }

  /** Run teardown (it.36). */
  destroy(): void {
    this.abort.abort();
    this.stopLive();
    this.panel.remove();
  }

  // --- the live strip ------------------------------------------------------

  private startLive(): void {
    this.stopLive();
    this.paintLive();
    this.liveTimer = window.setInterval(() => this.paintLive(), 250);
    // FPS is measured on the page's own frame clock — the game's clock (it.117).
    this.lastFrame = performance.now();
    const tick = (now: number): void => {
      const dt = now - this.lastFrame;
      this.lastFrame = now;
      if (dt > 0) this.fps = this.fps === 0 ? 1000 / dt : this.fps * 0.9 + (1000 / dt) * 0.1;
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLive(): void {
    if (this.liveTimer !== null) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.fps = 0;
  }

  private paintLive(): void {
    const s = this.hooks.snapshot();
    const chip = (k: string, v: string, cls = ''): string =>
      `<span class="cheat-chip ${cls}"><b>${esc(k)}</b>${esc(v)}</span>`;
    const floorId = s.floor === 0 ? '0' : s.floor < 0 ? 'coliseum' : String(s.floor);
    this.live.innerHTML =
      chip('place', s.place || '—') +
      chip('floor', floorId) +
      chip('seed', s.seed.toString(16)) +
      chip('tile', `${s.x.toFixed(1)}, ${s.y.toFixed(1)}`) +
      chip('hp', `${Math.max(0, Math.round(s.hp))}/${s.hpMax}`, s.hp <= s.hpMax * 0.3 ? 'low' : '') +
      chip('lvl', String(s.level)) +
      chip('gold', String(s.gold)) +
      chip('foes', String(s.enemies)) +
      chip('fps', this.fps ? String(Math.round(this.fps)) : '—') +
      (this.god ? chip('', 'GOD', 'on') : '') +
      (this.noclip ? chip('', 'NOCLIP', 'on') : '');
  }

  // --- painting ------------------------------------------------------------

  private paintTabs(): void {
    this.tabsEl.innerHTML = SECTIONS.map(
      (s) =>
        `<button class="cheat-tab${s.id === this.section ? ' active' : ''}" role="tab" aria-selected="${s.id === this.section}" data-a="tab" data-v="${s.id}">${s.label}</button>`,
    ).join('');
  }

  /** Repaint the body only — the header, tabs and search box keep their state. */
  private paintBody(): void {
    const place = SEARCHABLE[this.section];
    this.searchRow.classList.toggle('off', !place);
    if (place) this.search.placeholder = place;

    const scroll = this.body.scrollTop;
    const focusId = (document.activeElement as HTMLElement | null)?.id ?? '';
    this.body.innerHTML = this.render();
    this.body.scrollTop = scroll;
    if (focusId && focusId !== 'cheat-q') {
      const again = this.panel.querySelector<HTMLElement>(`#${CSS.escape(focusId)}`);
      again?.focus();
    }
    this.applyCursor();

    this.hint.textContent = place
      ? 'Tab section · ↑↓ row · Enter fire · Esc clears, then closes'
      : 'Tab section · ↑↓ row · Enter fire · Esc closes';
  }

  private render(): string {
    switch (this.section) {
      case 'state':
        return this.renderState();
      case 'travel':
        return this.renderTravel();
      case 'spawn':
        return this.renderSpawn();
      case 'items':
        return this.renderItems();
      case 'hero':
        return this.renderHero();
      case 'quests':
        return this.renderQuests();
      case 'log':
        return this.renderLog();
    }
  }

  private head(text: string, note = ''): string {
    return `<div class="cheat-h">${esc(text)}${note ? `<i>${esc(note)}</i>` : ''}</div>`;
  }

  private renderState(): string {
    const s = this.hooks.snapshot();
    const { defs, state } = this.hooks.quests();
    const live = defs.filter((q) => state[q.key] !== undefined);
    return (
      this.head('Toggles') +
      `<div class="cheat-grid">` +
      `<button data-a="god" class="cheat-btn toggle${this.god ? ' on' : ''}">God mode<em>${this.god ? 'on' : 'off'}</em></button>` +
      `<button data-a="noclip" class="cheat-btn toggle${this.noclip ? ' on' : ''}">Noclip<em>${this.noclip ? 'on' : 'off'}</em></button>` +
      `</div>` +
      this.head('Actions') +
      `<div class="cheat-grid">` +
      `<button data-a="heal" class="cheat-btn">Full heal<em>hp to ${s.hpMax}</em></button>` +
      `<button data-a="kill" class="cheat-btn">Kill visible<em>${s.enemies} standing</em></button>` +
      `<button data-a="reveal" class="cheat-btn">Reveal map<em>lift the fog</em></button>` +
      `<button data-a="rebuild" class="cheat-btn">Rebuild floor<em>apply the ledger</em></button>` +
      `<button data-a="gold" data-v="1000" class="cheat-btn">+1 000 gold<em>purse ${s.gold}</em></button>` +
      `<button data-a="points" data-v="10" class="cheat-btn">+10 skill points<em>${s.skillPoints} unspent</em></button>` +
      `</div>` +
      this.head('Run', `${s.place} · seed ${s.seed.toString(16)} · tile ${s.x.toFixed(1)}, ${s.y.toFixed(1)}`) +
      `<div class="cheat-read">` +
      `<span>Level <b>${s.level}</b> · ${s.xp}/${s.xpToNext} xp</span>` +
      `<span>${s.dmgMin}–${s.dmgMax} base damage · ${s.hpMax} max hp</span>` +
      `<span>${s.gold} gold · ${s.skillPoints} skill points</span>` +
      `</div>` +
      this.head('Ledger', live.length ? `${live.length} of ${defs.length} set` : 'nothing set') +
      (live.length
        ? `<div class="cheat-read">${live.map((q) => `<span>${esc(q.label)} <b>${esc(state[q.key])}</b></span>`).join('')}</div>`
        : `<div class="cheat-note">A fresh ledger — every quest is at its start.</div>`) +
      this.head('Last fired') +
      (this.log.length
        ? `<div class="cheat-read">${this.log.slice(0, 6).map((l) => `<span><b>${esc(l.at)}</b> ${esc(l.text)}</span>`).join('')}</div>`
        : `<div class="cheat-note">Nothing yet this session.</div>`)
    );
  }

  private renderTravel(): string {
    const q = this.query.toLowerCase();
    const hit = (s: string): boolean => !q || s.toLowerCase().includes(q);
    const places = this.hooks.places().filter((p) => hit(`${p.label} ${p.sub ?? ''} ${p.id}`));
    const depths = Array.from({ length: 20 }, (_, i) => i + 1).filter((f) => hit(`depth ${f} ${ROMAN[f - 1]}`));
    const arenas = [5, 10, 15, 20].filter((f) => hit(`arena ${f} ${ROMAN[f - 1]}`));
    if (!places.length && !depths.length && !arenas.length) return this.empty();
    return (
      (places.length
        ? this.head('Places') +
          `<div class="cheat-grid">` +
          places
            .map(
              (p) =>
                `<button data-a="go" data-v="${esc(String(p.id))}" class="cheat-btn">${esc(p.label)}${p.sub ? `<em>${esc(p.sub)}</em>` : ''}</button>`,
            )
            .join('') +
          `</div>`
        : '') +
      (depths.length
        ? this.head('Depths', 'the crypt, I to XX') +
          `<div class="cheat-depths">` +
          depths.map((f) => `<button data-a="go" data-v="${f}" class="cheat-num">${ROMAN[f - 1]}</button>`).join('') +
          `</div>`
        : '') +
      (arenas.length
        ? this.head('Boss arenas') +
          `<div class="cheat-grid">` +
          arenas
            .map((f) => `<button data-a="go" data-v="${f}" data-arena="1" class="cheat-btn danger">Arena ${ROMAN[f - 1]}<em>depth ${f}</em></button>`)
            .join('') +
          `</div>`
        : '')
    );
  }

  private renderSpawn(): string {
    const q = this.query.toLowerCase();
    const s = this.hooks.snapshot();
    const level = Math.max(1, s.level + this.spawnLevelDelta);
    const foes = this.hooks.foes().filter((f) => !q || `${f.name} ${f.kind}`.toLowerCase().includes(q));
    const btn = (f: CheatFoeInfo): string =>
      `<button data-a="spawn" data-v="${esc(f.kind)}" class="cheat-btn${f.boss ? ' danger' : ''}">${esc(f.name)}<em>${esc(f.kind)}</em></button>`;
    const common = foes.filter((f) => !f.boss);
    const bosses = foes.filter((f) => f.boss);
    const pick = (a: string, v: string | number, label: string, lit: boolean): string =>
      `<button data-a="${a}" data-v="${v}" class="cheat-pick${lit ? ' on' : ''}">${esc(label)}</button>`;
    return (
      this.head('Summon', `${this.spawnCount} × level ${level}${this.spawnAffix === 'none' ? '' : ` · ${this.spawnAffix}`}`) +
      `<div class="cheat-picks"><span>Count</span>${[1, 3, 5, 10].map((n) => pick('count', n, `×${n}`, n === this.spawnCount)).join('')}</div>` +
      `<div class="cheat-picks"><span>Level</span>${[-3, 0, 3, 6, 12].map((d) => pick('lvl', d, d === 0 ? 'hero' : d > 0 ? `+${d}` : String(d), d === this.spawnLevelDelta)).join('')}</div>` +
      `<div class="cheat-picks"><span>Elite</span>${AFFIXES.map((a) => pick('affix', a.id, a.label, a.id === this.spawnAffix)).join('')}</div>` +
      (common.length ? this.head('Creatures', `${common.length}`) + `<div class="cheat-grid">${common.map(btn).join('')}</div>` : '') +
      (bosses.length ? this.head('Wardens', `${bosses.length}`) + `<div class="cheat-grid">${bosses.map(btn).join('')}</div>` : '') +
      (!foes.length ? this.empty() : '') +
      `<div class="cheat-note">Bodies rise three to five tiles out, on the camera's side. A kind's first summon waits on its sheets.</div>`
    );
  }

  private renderItems(): string {
    const q = this.query.toLowerCase();
    const all = this.hooks.items();
    const matches = all.filter(
      (it) =>
        (this.itemFilter === 'all' || groupOf(it) === this.itemFilter) &&
        (!q || `${it.name} ${it.id} ${it.slot} ${it.rarity}`.toLowerCase().includes(q)),
    );
    const shown = matches.slice(0, ROW_CAP);
    const chips = ITEM_FILTERS.map(
      (f) => `<button data-a="filter" data-v="${f.id}" class="cheat-pick${f.id === this.itemFilter ? ' on' : ''}">${f.label}</button>`,
    ).join('');
    return (
      `<div class="cheat-picks">${chips}</div>` +
      this.head('Items', `${matches.length} of ${all.length}`) +
      (matches.length
        ? `<button data-a="giveall" class="cheat-btn wide">Give all ${matches.length} matching</button>` +
          `<div class="cheat-rows">` +
          shown
            .map(
              (it) => `<button data-a="give" data-v="${esc(it.id)}" class="cheat-item rarity-${esc(it.rarity)}" title="${esc(it.id)}">
                ${it.iconHtml}
                <span class="cheat-item-text"><span class="cheat-item-name">${esc(it.name)}</span><span class="cheat-item-stats">${it.stats || esc(it.slot)}</span></span>
              </button>`,
            )
            .join('') +
          `</div>` +
          (matches.length > shown.length ? `<div class="cheat-note">${matches.length - shown.length} more — narrow the search.</div>` : '')
        : this.empty())
    );
  }

  private renderHero(): string {
    const s = this.hooks.snapshot();
    return (
      this.head('Level', `${s.level} · ${s.xp}/${s.xpToNext} xp · ${s.hpMax} hp · ${s.dmgMin}–${s.dmgMax} dmg`) +
      // A step that would clamp onto the level you are already at says so (it.117):
      // a live button that does nothing reads as a broken one.
      `<div class="cheat-picks"><span>Step</span>${[-5, -1, 1, 5]
        .map((d) => {
          const to = Math.max(1, Math.min(30, s.level + d));
          return `<button data-a="level" data-v="${to}" class="cheat-pick${to === s.level ? ' dim' : ''}"${to === s.level ? ' disabled' : ''}>${d > 0 ? `+${d}` : d}</button>`;
        })
        .join('')}</div>` +
      `<div class="cheat-depths">${Array.from({ length: 30 }, (_, i) => i + 1)
        .map((n) => `<button data-a="level" data-v="${n}" class="cheat-num${n === s.level ? ' on' : ''}">${n}</button>`)
        .join('')}</div>` +
      `<div class="cheat-note">A level change refills hp and re-derives base damage.</div>` +
      this.head('Purse', `${s.gold} gold`) +
      `<div class="cheat-picks">${[100, 1000, 10000]
        .map((n) => `<button data-a="gold" data-v="${n}" class="cheat-pick">+${n.toLocaleString('en-GB').replace(/,/g, ' ')}</button>`)
        .join('')}<button data-a="setgold" data-v="0" class="cheat-pick">Empty</button></div>` +
      `<div class="cheat-set"><input id="cheat-gold" type="number" min="0" step="100" value="${s.gold}" aria-label="Gold"><button data-a="setgold" class="cheat-pick" data-from="cheat-gold">Set gold</button></div>` +
      this.head('Skill points', `${s.skillPoints} unspent`) +
      `<div class="cheat-picks">${[1, 5, 10]
        .map((n) => `<button data-a="points" data-v="${n}" class="cheat-pick">+${n}</button>`)
        .join('')}<button data-a="setpoints" data-v="60" class="cheat-pick">Max out</button><button data-a="setpoints" data-v="0" class="cheat-pick">Clear</button></div>` +
      `<div class="cheat-set"><input id="cheat-points" type="number" min="0" step="1" value="${s.skillPoints}" aria-label="Skill points"><button data-a="setpoints" class="cheat-pick" data-from="cheat-points">Set points</button></div>`
    );
  }

  private renderQuests(): string {
    const q = this.query.toLowerCase();
    const { defs, state } = this.hooks.quests();
    const rows = defs.filter((d) => !q || `${d.label} ${d.key}`.toLowerCase().includes(q));
    if (!rows.length) return this.empty();
    return (
      this.head('Ledger', 'a floor reads it when it is BUILT — rebuild after a change') +
      rows
        .map((d) => {
          const cur = state[d.key];
          const pick = (val: string, label: string): string =>
            `<button data-a="quest" data-k="${esc(d.key)}" data-v="${esc(val)}" class="cheat-pick${(val === '' ? cur === undefined : cur === val) ? ' on' : ''}">${esc(label)}</button>`;
          return `<div class="cheat-quest"><b>${esc(d.label)}</b><small>${esc(d.key)}</small><div class="cheat-picks">${pick('', 'unset')}${d.states.map((sv) => pick(sv, sv)).join('')}</div></div>`;
        })
        .join('') +
      `<div class="cheat-grid">` +
      `<button data-a="rebuild" class="cheat-btn">Rebuild floor<em>apply the ledger</em></button>` +
      `<button data-a="clearquests" class="cheat-btn danger">Clear the ledger<em>back to a new run</em></button>` +
      `</div>`
    );
  }

  private renderLog(): string {
    if (!this.log.length) return `<div class="cheat-note">Nothing fired yet. Everything you trigger lands here, newest first.</div>`;
    return (
      this.head('Log', `${this.log.length}`) +
      `<div class="cheat-read">${this.log.map((l) => `<span><b>${esc(l.at)}</b> ${esc(l.text)}</span>`).join('')}</div>` +
      `<button data-a="clearlog" class="cheat-btn wide">Clear the log</button>`
    );
  }

  private empty(): string {
    return `<div class="cheat-note">Nothing matches “${esc(this.query)}”.</div>`;
  }

  // --- the log -------------------------------------------------------------

  private note(text: string): void {
    const d = new Date();
    const at = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    this.log.unshift({ at, text });
    if (this.log.length > 80) this.log.length = 80;
  }

  // --- keyboard ------------------------------------------------------------

  /** Every row the cursor can land on, in paint order. */
  private rows(): HTMLButtonElement[] {
    return Array.from(this.body.querySelectorAll<HTMLButtonElement>('button[data-a]'));
  }

  private applyCursor(): void {
    const rows = this.rows();
    if (this.cursor >= rows.length) this.cursor = rows.length - 1;
    rows.forEach((r, i) => r.classList.toggle('cur', i === this.cursor));
    if (this.cursor >= 0) rows[this.cursor]?.scrollIntoView({ block: 'nearest' });
  }

  private moveCursor(d: number): void {
    const rows = this.rows();
    if (!rows.length) return;
    this.cursor = this.cursor < 0 ? (d > 0 ? 0 : rows.length - 1) : (this.cursor + d + rows.length) % rows.length;
    this.applyCursor();
  }

  private step(d: number): void {
    const i = SECTIONS.findIndex((s) => s.id === this.section);
    this.setSection(SECTIONS[(i + d + SECTIONS.length) % SECTIONS.length].id);
  }

  private setSection(id: Section): void {
    this.section = id;
    this.cursor = -1;
    this.body.scrollTop = 0;
    this.paintTabs();
    this.paintBody();
  }

  /**
   * The four keys that drive the console: Tab (section), ↑ ↓ (row), Enter
   * (fire). They are read off the window while the console is open, and they
   * never reach the game's own bindings. Everything else — every letter, every
   * digit — falls through to whatever has the caret, so the search box and the
   * two number fields type normally.
   */
  private onDriveKey(e: KeyboardEvent): void {
    if (!this.visible || e.repeat) return;
    const target = e.target as HTMLElement | null;
    const inNumber = target?.tagName === 'INPUT' && (target as HTMLInputElement).type === 'number';
    if (e.code === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.step(e.shiftKey ? -1 : 1);
      this.takeFocus();
    } else if ((e.code === 'ArrowDown' || e.code === 'ArrowUp') && !inNumber) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.moveCursor(e.code === 'ArrowDown' ? 1 : -1);
    } else if (e.code === 'Enter') {
      const row = this.cursor >= 0 ? this.rows()[this.cursor] : null;
      if (row) {
        e.preventDefault();
        e.stopImmediatePropagation();
        row.click();
      } else if (inNumber && target) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.body.querySelector<HTMLButtonElement>(`button[data-from="${target.id}"]`)?.click();
      }
    }
  }

  // --- input ---------------------------------------------------------------

  private onHover(e: Event): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]');
    if (!btn) return;
    if (btn.dataset.a === 'spawn' && btn.dataset.v) this.hooks.prewarmFoe?.(btn.dataset.v);
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLElement;
    if (el.id === 'cheat-gold' || el.id === 'cheat-points') e.stopPropagation();
  }

  private numberFrom(id: string, fallback: number): number {
    const el = this.body.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`);
    const n = el ? Number(el.value) : NaN;
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
  }

  private onClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]');
    if (!btn || !this.panel.contains(btn)) return;
    const a = btn.dataset.a as string;
    const v = btn.dataset.v ?? '';
    audio.sfx('uiClick');

    switch (a) {
      case 'close':
        this.toggle(); // The mark (it.69): a phone has no F1.
        return;
      case 'clearq':
        this.search.value = '';
        this.query = '';
        this.search.focus();
        this.paintBody();
        return;
      case 'tab':
        this.setSection(v as Section);
        this.takeFocus();
        return;
      case 'filter':
        this.itemFilter = v as ItemFilter;
        this.cursor = -1;
        this.paintBody();
        return;
      case 'god':
        this.god = this.hooks.toggleGod();
        this.note(`God mode ${this.god ? 'on' : 'off'}`);
        break;
      case 'noclip':
        this.noclip = this.hooks.toggleNoclip();
        this.note(`Noclip ${this.noclip ? 'on' : 'off'}`);
        break;
      case 'heal':
        this.hooks.healFull();
        this.note('Full heal');
        break;
      case 'kill':
        this.hooks.killVisibleEnemies();
        this.note('Killed every visible foe');
        break;
      case 'reveal':
        this.hooks.revealFloor();
        this.note('Revealed the floor');
        break;
      case 'gold':
        this.hooks.addGold(Number(v));
        this.note(`${Number(v) > 0 ? '+' : ''}${v} gold`);
        break;
      case 'setgold': {
        const n = v !== '' ? Number(v) : this.numberFrom('cheat-gold', 0);
        this.hooks.setGold(n);
        this.note(`Purse set to ${n}`);
        break;
      }
      case 'points':
        this.hooks.addSkillPoints(Number(v));
        this.note(`+${v} skill points`);
        break;
      case 'setpoints': {
        const n = v !== '' ? Number(v) : this.numberFrom('cheat-points', 0);
        this.hooks.setSkillPoints(n);
        this.note(`Skill points set to ${n}`);
        break;
      }
      case 'level':
        this.hooks.setLevel(Number(v));
        this.note(`Level ${v}`);
        break;
      case 'go': {
        const arena = btn.dataset.arena === '1';
        const dest = v === 'coliseum' || v === 'menagerie' ? v : Number(v);
        this.note(`Travelled to ${v}${arena ? ' (arena)' : ''}`);
        this.hooks.teleport(dest, arena);
        this.toggle(); // Close over the fade — arrive with a clear screen.
        return;
      }
      case 'spawn': {
        const level = Math.max(1, this.hooks.snapshot().level + this.spawnLevelDelta);
        this.hooks.spawnFoe(v, this.spawnCount, level, this.spawnAffix);
        this.note(`Summoned ${this.spawnCount} × ${v} at level ${level}${this.spawnAffix === 'none' ? '' : ` (${this.spawnAffix})`}`);
        btn.classList.add('done');
        return; // No repaint: the grid keeps its place and its marks.
      }
      case 'count':
        this.spawnCount = Number(v);
        break;
      case 'lvl':
        this.spawnLevelDelta = Number(v);
        break;
      case 'affix':
        this.spawnAffix = v as CheatAffix;
        break;
      case 'give':
        this.hooks.giveItem(v);
        this.note(`Gave ${v}`);
        btn.classList.add('done');
        return; // Keep the list still so a second item is one more click.
      case 'giveall': {
        const q = this.query.toLowerCase();
        let n = 0;
        for (const it of this.hooks.items()) {
          if (this.itemFilter !== 'all' && groupOf(it) !== this.itemFilter) continue;
          if (q && !`${it.name} ${it.id} ${it.slot} ${it.rarity}`.toLowerCase().includes(q)) continue;
          this.hooks.giveItem(it.id);
          n++;
        }
        this.note(`Gave ${n} items`);
        btn.textContent = `Gave ${n} items`;
        return;
      }
      case 'quest':
        this.hooks.setQuest(btn.dataset.k ?? '', v === '' ? null : v);
        this.note(`${btn.dataset.k} → ${v === '' ? 'unset' : v}`);
        break;
      case 'clearquests':
        this.hooks.clearQuests();
        this.note('Cleared the ledger');
        break;
      case 'rebuild':
        this.note('Rebuilt the floor');
        this.hooks.rebuildFloor();
        this.toggle();
        return;
      case 'clearlog':
        this.log.length = 0;
        break;
      default:
        return;
    }
    this.paintBody();
    this.paintLive();
  }
}
