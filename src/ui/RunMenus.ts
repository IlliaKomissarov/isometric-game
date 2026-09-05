/**
 * @module ui/RunMenus
 * In-run modal menus (it.36): the PAUSE menu (ESC) and the DEATH overlay.
 * Both freeze the simulation through hooks owned by main (loop stop/start)
 * and offer RESUME / RISE AGAIN, RESTART RUN and RETURN TO MAIN MENU —
 * the browser tab never needs a refresh again.
 *
 * Pure DOM. Listeners live on an AbortController so a run teardown
 * detaches them cleanly (menus are created per run).
 */

import { audio } from '@/engine/AudioManager';

export interface RunMenuHooks {
  pause: () => void;
  resume: () => void;
  restart: () => void;
  mainMenu: () => void;
  /** Tear the run down and reopen the class selection (it.37). */
  changeClass: () => void;
  /** Write the save slot, then return to the title (it.39). */
  saveExit: () => void;
  settings: () => void;
  /** Death overlay only: respawn at the floor entrance. */
  respawn: () => void;
  /** Blocks ESC pausing while another modal (class select, fade) owns the screen. */
  canPause: () => boolean;
  /** THE FORBIDDEN ARTS (it.67): the cheat menu, reachable without an F1 key. */
  cheats: () => void;
}

/**
 * THE GHOST-CLICK SHIELD (it.67). A window opened by a touch receives the
 * same touch's `click` a few milliseconds later; a button that answers it
 * fires on a press the player never made. Clicks inside this window of the
 * sheet appearing are the opening tap's, not a choice.
 */
const SHIELD_MS = 350;

export class RunMenusUI {
  private readonly pauseEl: HTMLElement;
  private readonly deathEl: HTMLElement;
  private readonly abort = new AbortController();
  private paused = false;
  private dead = false;
  private shownAt = 0;

  constructor(private readonly hooks: RunMenuHooks) {
    this.pauseEl = document.getElementById('pause-menu')!;
    this.deathEl = document.getElementById('death-menu')!;
    const { signal } = this.abort;

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code !== 'Escape' || e.repeat) return;
        if (this.dead) return; // Death has its own buttons; ESC does nothing.
        e.preventDefault();
        if (this.paused) this.resume();
        else if (this.hooks.canPause()) this.pause();
      },
      { signal },
    );

    const wire = (root: HTMLElement): void => {
      root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
        btn.addEventListener('mouseenter', () => audio.sfx('uiHover'), { signal });
        btn.addEventListener(
          'click',
          () => {
            if (performance.now() - this.shownAt < SHIELD_MS) return;
            const act = btn.dataset.act;
            if (act === 'resume') this.resume();
            else if (act === 'respawn') {
              audio.sfx('uiConfirm');
              this.hideDeath();
              this.hooks.respawn();
            } else if (act === 'restart') {
              audio.sfx('uiConfirm');
              this.hideAll();
              this.hooks.restart();
            } else if (act === 'menu') {
              audio.sfx('uiBack');
              this.hideAll();
              this.hooks.mainMenu();
            } else if (act === 'class') {
              audio.sfx('uiConfirm');
              this.hideAll();
              this.hooks.changeClass();
            } else if (act === 'saveExit') {
              audio.sfx('save');
              this.hideAll();
              this.hooks.saveExit();
            } else if (act === 'settings') {
              audio.sfx('uiClick');
              this.hooks.settings();
            } else if (act === 'cheats') {
              audio.sfx('uiClick');
              this.resume();
              this.hooks.cheats();
            }
          },
          { signal },
        );
      });
    };
    wire(this.pauseEl);
    wire(this.deathEl);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isDeathShown(): boolean {
    return this.dead;
  }

  pause(): void {
    if (this.paused || this.dead) return;
    this.paused = true;
    this.shownAt = performance.now();
    this.pauseEl.classList.add('show');
    audio.sfx('pause');
    audio.duck(true);
    this.hooks.pause();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.pauseEl.classList.remove('show');
    audio.sfx('unpause');
    audio.duck(false);
    this.hooks.resume();
  }

  /** Death overlay: shown by main once the death animation has played out. */
  showDeath(stats: string): void {
    if (this.dead) return;
    this.dead = true;
    this.shownAt = performance.now();
    const el = this.deathEl.querySelector('.dm-stats');
    if (el) el.textContent = stats;
    this.deathEl.classList.add('show');
    audio.duck(true);
    this.hooks.pause();
  }

  private hideDeath(): void {
    if (!this.dead) return;
    this.dead = false;
    this.deathEl.classList.remove('show');
    audio.duck(false);
    this.hooks.resume();
  }

  private hideAll(): void {
    this.paused = false;
    this.dead = false;
    this.pauseEl.classList.remove('show');
    this.deathEl.classList.remove('show');
    audio.duck(false);
  }

  /** Run teardown: detach listeners, hide overlays. */
  destroy(): void {
    this.abort.abort();
    this.hideAll();
  }
}
