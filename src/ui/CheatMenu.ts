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
 * Pure DOM; every action goes through hooks injected by main, so the menu
 * owns no game logic (God mode is enforced INSIDE CombatSystem, the sole hp
 * mutator — no side-door damage paths exist).
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

export interface CheatHooks {
  /** Toggle invulnerability; returns the new state. */
  toggleGod: () => boolean;
  healFull: () => void;
  giveItem: (id: string) => void;
  killVisibleEnemies: () => void;
  revealFloor: () => void;
  /** Quick teleport (it.33): jump to a floor, optionally into its arena. */
  teleport: (floor: number, arena: boolean) => void;
  /** Full item catalog for the arsenal browser. */
  items: () => CheatItemInfo[];
  /** Pre-rendered idle animation frames for the portrait (may be empty). */
  portraitFrames: () => HTMLCanvasElement[];
}

type ArsenalTab = 'weapons' | 'armor' | 'relics' | 'travel';

const TAB_LABEL: Record<ArsenalTab, string> = {
  weapons: 'WEAPONS',
  armor: 'ARMOR',
  relics: 'RELICS',
  travel: 'TRAVEL',
};

function tabOf(item: CheatItemInfo): ArsenalTab {
  if (item.slot === 'mainHand') return 'weapons';
  if (item.slot === 'head' || item.slot === 'torso' || item.slot === 'legs' || item.slot === 'offHand')
    return 'armor';
  return 'relics';
}

export class CheatMenuUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private god = false;
  private tab: ArsenalTab = 'weapons';
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
        }
      },
      { signal: this.abort.signal },
    );
    this.render();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle('open', this.visible);
    if (this.visible) this.startPortrait();
    else this.stopPortrait();
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

  private render(): void {
    const items = this.hooks.items().filter((it) => tabOf(it) === this.tab);
    const tabs = (Object.keys(TAB_LABEL) as ArsenalTab[])
      .map(
        (t) =>
          `<button class="cheat-tab${t === this.tab ? ' active' : ''}" data-tab="${t}">${TAB_LABEL[t]}</button>`,
      )
      .join('');
    // TRAVEL tab (it.33): every depth 1–20 plus the four sealed arenas.
    const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];
    const travelRows =
      `<div class="cheat-travel-grid">` +
      Array.from({ length: 20 }, (_, i) => `<button class="cheat-floor" data-floor="${i + 1}">${ROMAN[i]}</button>`).join('') +
      `</div><div class="cheat-travel-arenas">` +
      [5, 10, 15, 20]
        .map((f) => `<button class="cheat-arena" data-floor="${f}" data-arena="1">⚔ ARENA ${ROMAN[f - 1]}</button>`)
        .join('') +
      `</div>`;
    const rows =
      this.tab === 'travel'
        ? travelRows
        : items
            .map(
              (it) => `
        <button class="cheat-item rarity-${it.rarity}" data-give="${it.id}" title="${it.name}">
          ${it.iconHtml}
          <span class="cheat-item-text">
            <span class="cheat-item-name">${it.name}</span>
            <span class="cheat-item-stats">${it.stats}</span>
          </span>
        </button>`,
            )
            .join('');

    this.panel.innerHTML = `
      <div class="cheat-head">
        <canvas id="cheat-portrait" width="72" height="88"></canvas>
        <div class="cheat-head-text">
          <h3>FORBIDDEN ARTS</h3>
          <div class="cheat-sub">the dark obeys, for a price</div>
        </div>
      </div>
      <div class="cheat-powers">
        <button data-act="god" class="${this.god ? 'lit' : ''}">${this.god ? '✦ GOD ON' : 'God Mode'}</button>
        <button data-act="heal">Full Heal</button>
        <button data-act="reveal">Reveal Floor</button>
        <button data-act="kill">Slay Visible</button>
      </div>
      <div class="cheat-tabs">${tabs}</div>
      <div class="cheat-items">${rows}</div>
      ${this.tab === 'travel' ? '' : `<button class="cheat-takeall" data-act="takeall">⚑ TAKE ALL ${TAB_LABEL[this.tab]}</button>`}
      <div class="cheat-tip">L jumps floors · F1 / \` closes</div>
    `;

    this.panel.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
      btn.addEventListener('mouseenter', () => audio.sfx('uiHover'));
      btn.addEventListener('click', () => {
        audio.sfx('uiClick');
        const act = btn.dataset.act;
        const give = btn.dataset.give;
        const tab = btn.dataset.tab as ArsenalTab | undefined;
        if (act === 'god') {
          this.god = this.hooks.toggleGod();
          this.render();
          this.startPortrait();
        } else if (act === 'heal') this.hooks.healFull();
        else if (act === 'kill') this.hooks.killVisibleEnemies();
        else if (act === 'reveal') this.hooks.revealFloor();
        else if (act === 'takeall') {
          for (const it of this.hooks.items()) if (tabOf(it) === this.tab) this.hooks.giveItem(it.id);
          btn.textContent = '⚑ TAKEN';
        } else if (btn.dataset.floor) {
          this.hooks.teleport(Number(btn.dataset.floor), btn.dataset.arena === '1');
          this.toggle(); // Close over the fade — arrive with a clear screen.
        } else if (give) {
          this.hooks.giveItem(give);
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
