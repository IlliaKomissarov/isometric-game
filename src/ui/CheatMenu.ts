/**
 * @module ui/CheatMenu
 * Developer/testing cheat menu ("Forbidden Arts"), toggled with F1 or `.
 *
 * Iteration 13 overhaul: an ANIMATED idle-knight portrait heads the panel,
 * the powers sit in a compact grid, and the arsenal is a categorized,
 * scrollable item browser (Weapons / Armor / Relics tabs) — one click gives
 * one item, "TAKE ALL" gives the whole visible category. Nothing clips or
 * overflows: the item list owns its own scroll region.
 *
 * THE REWRITE (it.114). Nothing had been added to the sheet since it.44 while
 * the game grew nine places past the town gate, thirty foes, a quest ledger
 * and a purse. It now has: every PLACE as well as every depth; a FOES tab that
 * spawns any creature at any level beside the hero; a QUESTS tab that sets any
 * ledger key and rebuilds the floor so the plates and gateways follow; a
 * DRAUGHTS tab for consumables; NOCLIP and a purse on the powers row.
 *
 * Pure DOM; every action goes through hooks injected by main, so the menu
 * owns no game logic (God mode is enforced INSIDE CombatSystem, the sole hp
 * mutator — no side-door damage paths exist).
 */

import { audio } from '@/engine/AudioManager';
import { keepScroll } from './keepScroll';

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

export interface CheatHooks {
  /** Toggle invulnerability; returns the new state. */
  toggleGod: () => boolean;
  /** Toggle walking through walls; returns the new state. */
  toggleNoclip: () => boolean;
  healFull: () => void;
  giveItem: (id: string) => void;
  addGold: (n: number) => void;
  killVisibleEnemies: () => void;
  revealFloor: () => void;
  /** Quick teleport (it.33): jump to a floor (or a named place), optionally into its arena. */
  teleport: (dest: number | 'coliseum' | 'menagerie', arena: boolean) => void;
  /** The places past the town gate, in story order (it.114). */
  places: () => CheatPlace[];
  /** Full item catalog for the arsenal browser. */
  items: () => CheatItemInfo[];
  /** Every creature kind that can be spawned (it.114). */
  foes: () => CheatFoeInfo[];
  /** Spawn `count` of a kind beside the hero at `level` (it.114). */
  spawnFoe: (kind: string, count: number, level: number) => void;
  /**
   * Start streaming a kind's sheets before the click (it.115): a creature's
   * first summons waited on five atlases with nothing on screen, which read as
   * "the spawn does nothing". Hovering a foe now fetches them.
   */
  prewarmFoe?: (kind: string) => void;
  /** The quest ledger and the states each key may take (it.114). */
  quests: () => { defs: CheatQuest[]; state: Record<string, string> };
  setQuest: (key: string, value: string | null) => void;
  /** Rebuild the current floor in place so a ledger change shows (it.114). */
  rebuildFloor: () => void;
  /** Pre-rendered idle animation frames for the portrait (may be empty). */
  portraitFrames: () => HTMLCanvasElement[];
  /** LEVEL (it.40): set the hero's level outright (1–30); returns the new sheet. */
  setLevel: (level: number) => void;
  /** Current sheet for the HERO tab readout. */
  heroInfo: () => { level: number; xp: number; xpToNext: number; hpMax: number; dmgMin: number; dmgMax: number; skillPoints: number; gold: number };
  /** SKILL POINTS (it.44): +10, or enough for every rank. */
  addSkillPoints: (n: number) => void;
}

type ArsenalTab = 'weapons' | 'armor' | 'relics' | 'draughts' | 'travel' | 'foes' | 'quests' | 'hero';

const TAB_LABEL: Record<ArsenalTab, string> = {
  weapons: 'WEAPONS',
  armor: 'ARMOR',
  relics: 'RELICS',
  draughts: 'DRAUGHTS',
  travel: 'TRAVEL',
  foes: 'FOES',
  quests: 'QUESTS',
  hero: 'HERO',
};

const ITEM_TABS: ReadonlySet<ArsenalTab> = new Set(['weapons', 'armor', 'relics', 'draughts']);

function tabOf(item: CheatItemInfo): ArsenalTab {
  if (item.slot === 'mainHand') return 'weapons';
  if (item.slot === 'head' || item.slot === 'torso' || item.slot === 'legs' || item.slot === 'offHand')
    return 'armor';
  if (item.slot === 'consumable' || item.slot === 'material' || item.slot === 'food') return 'draughts';
  return 'relics';
}

const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export class CheatMenuUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private god = false;
  private noclip = false;
  private tab: ArsenalTab = 'weapons';
  /** FOES tab: how many to spawn and at what level offset from the hero. */
  private spawnCount = 1;
  private spawnLevelDelta = 0;
  private portraitTimer: number | null = null;
  private portraitFrame = 0;
  private readonly abort = new AbortController();

  constructor(private readonly hooks: CheatHooks) {
    this.panel = document.createElement('div');
    this.panel.id = 'cheat-menu';
    document.body.appendChild(this.panel);

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if ((e.code === 'F1' || e.code === 'Backquote') && !e.repeat) {
          e.preventDefault();
          this.toggle();
        } else if (e.code === 'Escape' && this.panel.classList.contains('open')) {
          // ESC (and the bar's Menu) closes the sheet rather than pausing
          // over it: this listener is registered before the pause menu's.
          e.stopImmediatePropagation();
          this.toggle();
        }
      },
      { signal: this.abort.signal },
    );
    this.render();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle('open', this.visible);
    if (this.visible) {
      this.render(); // The ledger and the purse may have moved since the last look.
      this.startPortrait();
    } else this.stopPortrait();
    audio.sfx(this.visible ? 'invOpen' : 'invClose');
  }

  /** Run teardown (it.36). */
  destroy(): void {
    this.abort.abort();
    this.stopPortrait();
    this.panel.remove();
  }

  /** Drive the idle portrait at a slow, breathing cadence while open. */
  private startPortrait(): void {
    this.stopPortrait();
    const frames = this.hooks.portraitFrames();
    if (frames.length === 0) return;
    const canvas = this.panel.querySelector<HTMLCanvasElement>('#cheat-portrait');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const draw = (): void => {
      const frame = frames[this.portraitFrame % frames.length];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // It.34: the frames arrive PRE-CROPPED to the hero's painted body
      // (classPreviewFrames) — a plain contain-fit shows any archetype.
      const scale = Math.min(canvas.width / frame.width, canvas.height / frame.height);
      const w = frame.width * scale;
      const h = frame.height * scale;
      ctx.drawImage(frame, (canvas.width - w) / 2, canvas.height - h, w, h);
      this.portraitFrame++;
    };
    draw();
    this.portraitTimer = window.setInterval(draw, 180);
  }

  private stopPortrait(): void {
    if (this.portraitTimer !== null) {
      clearInterval(this.portraitTimer);
      this.portraitTimer = null;
    }
  }

  /** Repaint without losing where the player had scrolled (it.79). */
  private render(): void {
    keepScroll(this.panel, () => this.paint());
  }

  private travelRows(): string {
    const places = this.hooks.places()
      .map((p) => `<button class="cheat-place" data-place="${p.id}"><b>${esc(p.label)}</b>${p.sub ? `<small>${esc(p.sub)}</small>` : ''}</button>`)
      .join('');
    return (
      `<div class="cheat-section">THE PLACES</div><div class="cheat-place-grid">${places}</div>` +
      `<div class="cheat-section">THE DEPTHS</div><div class="cheat-travel-grid">` +
      Array.from({ length: 20 }, (_, i) => `<button class="cheat-floor" data-floor="${i + 1}">${ROMAN[i]}</button>`).join('') +
      `</div><div class="cheat-travel-arenas">` +
      [5, 10, 15, 20]
        .map((f) => `<button class="cheat-arena" data-floor="${f}" data-arena="1">⚔ ARENA ${ROMAN[f - 1]}</button>`)
        .join('') +
      `</div>`
    );
  }

  private foeRows(): string {
    const foes = this.hooks.foes();
    const info = this.hooks.heroInfo();
    const level = Math.max(1, info.level + this.spawnLevelDelta);
    const btn = (f: CheatFoeInfo): string =>
      `<button class="cheat-foe${f.boss ? ' boss' : ''}" data-spawn="${esc(f.kind)}" title="${esc(f.kind)}"><b>${esc(f.name)}</b><small>${esc(f.kind)}</small></button>`;
    const common = foes.filter((f) => !f.boss).map(btn).join('');
    const bosses = foes.filter((f) => f.boss).map(btn).join('');
    const counts = [1, 3, 5, 10].map((n) => `<button class="cheat-pick${n === this.spawnCount ? ' lit' : ''}" data-count="${n}">×${n}</button>`).join('');
    const levels = [-3, 0, 3, 6, 12].map((d) => `<button class="cheat-pick${d === this.spawnLevelDelta ? ' lit' : ''}" data-ldelta="${d}">${d === 0 ? 'HERO' : d > 0 ? `+${d}` : d}</button>`).join('');
    return (
      `<div class="cheat-spawn-bar"><span>SPAWN</span>${counts}<span>AT LEVEL ${level}</span>${levels}</div>` +
      `<div class="cheat-section">THE HOST</div><div class="cheat-foe-grid">${common}</div>` +
      `<div class="cheat-section">THE WARDENS</div><div class="cheat-foe-grid">${bosses}</div>` +
      `<div class="cheat-hero-note">A foe spawns two tiles from the hero on the nearest open ground; its sheets stream in first, so the first of a kind takes a moment.</div>`
    );
  }

  private questRows(): string {
    const { defs, state } = this.hooks.quests();
    const rows = defs
      .map((q) => {
        const cur = state[q.key];
        const states = q.states
          .map((s) => `<button class="cheat-pick${cur === s ? ' lit' : ''}" data-qkey="${esc(q.key)}" data-qval="${esc(s)}">${esc(s)}</button>`)
          .join('');
        return `<div class="cheat-quest"><b>${esc(q.label)}</b><small>${esc(q.key)} · ${cur === undefined ? 'unset' : esc(cur)}</small><div class="cheat-quest-states"><button class="cheat-pick${cur === undefined ? ' lit' : ''}" data-qkey="${esc(q.key)}" data-qval="">unset</button>${states}</div></div>`;
      })
      .join('');
    return (
      rows +
      `<button class="cheat-takeall" data-act="rebuild">⟳ REBUILD THIS FLOOR</button>` +
      `<div class="cheat-hero-note">Plates, gateways and who stands where are read from the ledger when a floor is BUILT — rebuild (or travel) after a change.</div>`
    );
  }

  private heroRows(): string {
    const info = this.hooks.heroInfo();
    return (
      `<div class="cheat-hero">` +
      `<div class="cheat-hero-sheet"><b>LEVEL ${info.level}</b><span>${info.xp} / ${info.xpToNext} xp · ${info.hpMax} hp · ${info.dmgMin}–${info.dmgMax} base dmg · ${info.gold} gold</span></div>` +
      `<div class="cheat-level-steps cheat-points"><span>${info.skillPoints} SKILL POINTS</span><button data-points="10">+10 POINTS</button><button data-points="max">MAX OUT</button></div>` +
      `<div class="cheat-level-steps cheat-points"><span>THE PURSE</span><button data-gold="100">+100</button><button data-gold="1000">+1 000</button><button data-gold="10000">+10 000</button><button data-gold="-99999999">EMPTY IT</button></div>` +
      `<div class="cheat-level-steps">` +
      [-5, -1, 1, 5].map((d) => `<button class="cheat-level-step" data-level="${info.level + d}">${d > 0 ? '+' : ''}${d}</button>`).join('') +
      `</div><div class="cheat-level-grid">` +
      Array.from({ length: 30 }, (_, i) => `<button class="cheat-level${i + 1 === info.level ? ' lit' : ''}" data-level="${i + 1}">${i + 1}</button>`).join('') +
      `</div><div class="cheat-hero-note">Levels grow max HP and base damage; HP refills on every change.</div></div>`
    );
  }

  private paint(): void {
    const tabs = (Object.keys(TAB_LABEL) as ArsenalTab[])
      .map(
        (t) =>
          `<button class="cheat-tab${t === this.tab ? ' active' : ''}" data-tab="${t}">${TAB_LABEL[t]}</button>`,
      )
      .join('');
    let rows: string;
    if (this.tab === 'travel') rows = this.travelRows();
    else if (this.tab === 'foes') rows = this.foeRows();
    else if (this.tab === 'quests') rows = this.questRows();
    else if (this.tab === 'hero') rows = this.heroRows();
    else {
      rows = this.hooks
        .items()
        .filter((it) => tabOf(it) === this.tab)
        .map(
          (it) => `
        <button class="cheat-item rarity-${it.rarity}" data-give="${esc(it.id)}" title="${esc(it.name)}">
          ${it.iconHtml}
          <span class="cheat-item-text">
            <span class="cheat-item-name">${esc(it.name)}</span>
            <span class="cheat-item-stats">${it.stats}</span>
          </span>
        </button>`,
        )
        .join('');
    }

    this.panel.innerHTML = `
      <div class="cheat-head drag-handle">
        <canvas id="cheat-portrait" width="72" height="88"></canvas>
        <div class="cheat-head-text">
          <h3>FORBIDDEN ARTS</h3>
          <div class="cheat-sub">the dark obeys, for a price</div>
        </div>
        <button class="tp-close" type="button" data-close title="Close (F1 / ESC)" aria-label="Close"><i></i></button>
      </div>
      <div class="cheat-powers">
        <button data-act="god" class="${this.god ? 'lit' : ''}">${this.god ? '✦ GOD ON' : 'God Mode'}</button>
        <button data-act="noclip" class="${this.noclip ? 'lit' : ''}">${this.noclip ? '✦ NOCLIP ON' : 'Noclip'}</button>
        <button data-act="heal">Full Heal</button>
        <button data-act="reveal">Reveal Floor</button>
        <button data-act="kill">Slay Visible</button>
        <button data-act="gold">+1 000 Gold</button>
      </div>
      <div class="cheat-tabs">${tabs}</div>
      <div class="cheat-items">${rows}</div>
      ${ITEM_TABS.has(this.tab) ? `<button class="cheat-takeall" data-act="takeall">⚑ TAKE ALL ${TAB_LABEL[this.tab]}</button>` : ''}
      <div class="cheat-tip">L jumps floors · F1 / \` · ESC or the cross closes</div>
      <button class="cheat-close" type="button" data-close>&#10005;&nbsp; CLOSE</button>
    `;

    this.panel.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
      btn.addEventListener('mouseenter', () => {
        audio.sfx('uiHover');
        if (btn.dataset.spawn) this.hooks.prewarmFoe?.(btn.dataset.spawn);
      });
      btn.addEventListener('click', () => {
        audio.sfx('uiClick');
        if ('close' in btn.dataset) {
          this.toggle(); // The mark (it.69): a phone has no F1.
          return;
        }
        const d = btn.dataset;
        const tab = d.tab as ArsenalTab | undefined;
        if (d.act === 'god') {
          this.god = this.hooks.toggleGod();
          this.render();
          this.startPortrait();
        } else if (d.act === 'noclip') {
          this.noclip = this.hooks.toggleNoclip();
          this.render();
          this.startPortrait();
        } else if (d.act === 'heal') this.hooks.healFull();
        else if (d.act === 'kill') this.hooks.killVisibleEnemies();
        else if (d.act === 'reveal') this.hooks.revealFloor();
        else if (d.act === 'gold') this.hooks.addGold(1000);
        else if (d.act === 'rebuild') {
          this.hooks.rebuildFloor();
          this.toggle();
        } else if (d.act === 'takeall') {
          for (const it of this.hooks.items()) if (tabOf(it) === this.tab) this.hooks.giveItem(it.id);
          btn.textContent = '⚑ TAKEN';
        } else if (d.points) {
          this.hooks.addSkillPoints(d.points === 'max' ? 999 : Number(d.points));
          this.render();
          this.startPortrait();
        } else if (d.gold) {
          this.hooks.addGold(Number(d.gold));
          this.render();
          this.startPortrait();
        } else if (d.level) {
          this.hooks.setLevel(Number(d.level));
          this.render();
          this.startPortrait();
        } else if (d.place !== undefined) {
          this.hooks.teleport(d.place === 'coliseum' || d.place === 'menagerie' ? d.place : Number(d.place), false);
          this.toggle();
        } else if (d.floor) {
          this.hooks.teleport(Number(d.floor), d.arena === '1');
          this.toggle(); // Close over the fade — arrive with a clear screen.
        } else if (d.count) {
          this.spawnCount = Number(d.count);
          this.render();
          this.startPortrait();
        } else if (d.ldelta !== undefined) {
          this.spawnLevelDelta = Number(d.ldelta);
          this.render();
          this.startPortrait();
        } else if (d.spawn) {
          const level = Math.max(1, this.hooks.heroInfo().level + this.spawnLevelDelta);
          this.hooks.spawnFoe(d.spawn, this.spawnCount, level);
          btn.classList.add('given');
        } else if (d.qkey !== undefined) {
          this.hooks.setQuest(d.qkey, d.qval === '' ? null : (d.qval ?? null));
          this.render();
          this.startPortrait();
        } else if (d.give) {
          this.hooks.giveItem(d.give);
          btn.classList.add('given');
        } else if (tab) {
          this.tab = tab;
          this.render();
          this.startPortrait();
        }
      });
    });
  }
}
