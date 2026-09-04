/**
 * @module ui/MainMenu
 * The title screen's button stack (it.36, rebuilt it.61).
 *
 *   CONTINUE · SINGLE PLAYER · CO-OP MULTIPLAYER · HALL OF RECORDS ·
 *   SETTINGS · CREDITS · EXIT GAME
 *
 * Pure DOM over the Pixi title atmosphere (`TitleScreen`). Every action goes
 * through hooks wired by main (which owns the run lifecycle). CONTINUE
 * carries a pill with the last delver's class, level and depth. The stack
 * is keyboard-walkable (↑ ↓ Enter); a struck button sends a spark burst to
 * the scene. Credits scroll on their own inside the modal.
 */

import { audio } from '@/engine/AudioManager';
import type { ClassArchetype } from '@/network/Serialization';

export interface MainMenuHooks {
  /** SINGLE PLAYER → the class selection modal. */
  play: () => void;
  /** CONTINUE → resume the most recent save. */
  continueGame: () => void;
  /** CO-OP MULTIPLAYER → the party lobby. */
  coop: () => void;
  /** HALL OF RECORDS → the dual-tab leaderboard. */
  records: () => void;
  /** SETTINGS → the tabbed settings panel. */
  settings: () => void;
  /** EXIT GAME → the leave prompt. */
  exit: () => void;
  /** A button was struck at this screen point (spark burst). */
  spark: (x: number, y: number) => void;
}

export interface ContinueInfo {
  cls: ClassArchetype;
  level: number;
  /** 0 = the town. */
  floor: number;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

export class MainMenuUI {
  private readonly root: HTMLElement;
  private readonly credits: HTMLElement;
  private readonly abort = new AbortController();
  private visible = false;

  constructor(private readonly hooks: MainMenuHooks) {
    this.root = document.getElementById('main-menu')!;
    this.credits = document.getElementById('credits')!;
    const { signal } = this.abort;

    this.root.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach((btn) => {
      btn.addEventListener('mouseenter', () => audio.sfx('uiHover'), { signal });
      btn.addEventListener(
        'click',
        (e) => {
          if (btn.disabled) return;
          const r = btn.getBoundingClientRect();
          this.hooks.spark(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2);
          btn.classList.remove('struck');
          void btn.offsetWidth;
          btn.classList.add('struck');
          const act = btn.dataset.menu;
          if (act === 'play') {
            audio.sfx('uiConfirm');
            this.hooks.play();
          } else if (act === 'continue') {
            audio.sfx('uiConfirm');
            this.hooks.continueGame();
          } else if (act === 'coop') {
            audio.sfx('uiConfirm');
            this.hooks.coop();
          } else if (act === 'records') {
            audio.sfx('uiClick');
            this.hooks.records();
          } else if (act === 'settings') {
            audio.sfx('uiClick');
            this.hooks.settings();
          } else if (act === 'credits') {
            audio.sfx('uiClick');
            this.openCredits();
          } else if (act === 'exit') {
            audio.sfx('uiClick');
            this.hooks.exit();
          }
        },
        { signal },
      );
    });
    this.credits.querySelector('[data-credits-close]')?.addEventListener(
      'click',
      () => {
        audio.sfx('uiBack');
        this.closeCredits();
      },
      { signal },
    );
    this.credits.addEventListener(
      'click',
      (e) => {
        if (e.target === this.credits) {
          audio.sfx('uiBack');
          this.closeCredits();
        }
      },
      { signal },
    );
    // Keyboard: ↑ ↓ walk the stack, Enter strikes, ESC closes the credits.
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'Escape' && this.credits.classList.contains('show')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          audio.sfx('uiBack');
          this.closeCredits();
          return;
        }
        if (!this.visible || this.root.classList.contains('dim')) return;
        if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
        const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('[data-menu]')].filter((b) => !b.disabled && !b.hidden);
        if (!buttons.length) return;
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.code === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
        buttons[next].focus();
        audio.sfx('uiHover');
      },
      { signal },
    );
  }

  /** CONTINUE shows the last delver, or stands dim when nobody has gone down yet. */
  setContinue(info: ContinueInfo | null): void {
    const btn = this.root.querySelector<HTMLButtonElement>('[data-menu="continue"]');
    const pill = this.root.querySelector<HTMLElement>('[data-continue-pill]');
    if (!btn) return;
    btn.disabled = !info;
    btn.classList.toggle('muted', !info);
    if (pill) pill.textContent = info ? `${info.cls.toUpperCase()} · LVL ${info.level} · ${info.floor <= 0 ? 'THE TOWN' : `DEPTH ${ROMAN[info.floor - 1] ?? info.floor}`}` : 'no delver yet';
  }

  /** Kept for callers from earlier iterations: the class screen remembers the hero itself. */
  setLastHero(_cls: ClassArchetype | null): void {
    /* no menu label */
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.root.classList.add('show');
    this.focusStack();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('show');
    this.closeCredits();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Focus returns to the first live button (after a sub-menu closes). */
  focusStack(): void {
    if (!this.visible) return;
    const first = [...this.root.querySelectorAll<HTMLButtonElement>('[data-menu]')].find((b) => !b.disabled);
    first?.focus({ preventScroll: true });
  }

  private openCredits(): void {
    this.credits.classList.add('show');
    const list = this.credits.querySelector<HTMLElement>('.cr-scroll');
    if (list) {
      list.classList.remove('rolling');
      void list.offsetWidth;
      list.classList.add('rolling');
    }
  }

  private closeCredits(): void {
    this.credits.classList.remove('show');
  }

  destroy(): void {
    this.abort.abort();
  }
}
