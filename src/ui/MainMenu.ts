/**
 * @module ui/MainMenu
 * The title screen (it.36): DESCEND · CHOOSE YOUR DELVER · SETTINGS &
 * CONTROLS · CREDITS, over a slow ember drift. Pure DOM/canvas — every
 * action goes through hooks wired by main (which owns the run lifecycle).
 *
 * The menu never touches the simulation. It also owns the small ember
 * canvas behind the title (2D, render-only, stops when hidden).
 */

import { audio } from '@/engine/AudioManager';
import type { ClassArchetype } from '@/network/Serialization';

export interface MainMenuHooks {
  /** START GAME → the character selection screen (it.38: the only way in). */
  play: () => void;
  /** CONTINUE → resume the most recent save in town (it.39). */
  continueGame: () => void;
  /** LOAD GAME → the slot panel. */
  loadGame: () => void;
  /** Open the settings + controls panel. */
  settings: () => void;
}

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

export class MainMenuUI {
  private readonly root: HTMLElement;
  private readonly credits: HTMLElement;
  private readonly emberCanvas: HTMLCanvasElement;
  private readonly embers: Ember[] = [];
  private raf = 0;
  private lastTime = 0;
  private visible = false;

  constructor(private readonly hooks: MainMenuHooks) {
    this.root = document.getElementById('main-menu')!;
    this.credits = document.getElementById('credits')!;
    this.emberCanvas = this.root.querySelector<HTMLCanvasElement>('#mm-embers')!;

    this.root.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach((btn) => {
      btn.addEventListener('mouseenter', () => audio.sfx('uiHover'));
      btn.addEventListener('click', () => {
        const act = btn.dataset.menu;
        if (act === 'play') {
          audio.sfx('uiConfirm');
          this.hooks.play();
        } else if (act === 'continue') {
          audio.sfx('uiConfirm');
          this.hooks.continueGame();
        } else if (act === 'load') {
          audio.sfx('uiClick');
          this.hooks.loadGame();
        } else if (act === 'settings') {
          audio.sfx('uiClick');
          this.hooks.settings();
        } else if (act === 'credits') {
          audio.sfx('uiClick');
          this.credits.classList.add('show');
        }
      });
    });
    this.credits.querySelector('[data-credits-close]')?.addEventListener('click', () => {
      audio.sfx('uiBack');
      this.credits.classList.remove('show');
    });
    this.credits.addEventListener('click', (e) => {
      if (e.target === this.credits) {
        audio.sfx('uiBack');
        this.credits.classList.remove('show');
      }
    });
  }

  /** The remembered hero is pre-selected on the class screen; the menu stays clean. */
  setLastHero(_cls: ClassArchetype | null): void {
    /* no menu label — see the class select's CONFIRM button */
  }

  /** CONTINUE only shows when a save exists (it.39). */
  setHasSave(has: boolean): void {
    const btn = this.root.querySelector<HTMLElement>('[data-menu="continue"]');
    if (btn) btn.hidden = !has;
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.root.classList.add('show');
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('show');
    this.credits.classList.remove('show');
    cancelAnimationFrame(this.raf);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  private tick(now: number): void {
    if (!this.visible) return;
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const c = this.emberCanvas;
    if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
      c.width = c.clientWidth;
      c.height = c.clientHeight;
    }
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, c.width, c.height);
      while (this.embers.length < 70) {
        this.embers.push({
          x: Math.random() * c.width,
          y: c.height + Math.random() * 40,
          vx: (Math.random() - 0.5) * 12,
          vy: -14 - Math.random() * 30,
          life: 0,
          maxLife: 6 + Math.random() * 8,
          size: 0.8 + Math.random() * 1.8,
        });
      }
      for (const e of this.embers) {
        e.life += dt;
        e.x += (e.vx + Math.sin(now * 0.0007 + e.y * 0.01) * 6) * dt;
        e.y += e.vy * dt;
        const t = e.life / e.maxLife;
        const a = Math.sin(Math.PI * Math.min(1, t)) * 0.75;
        ctx.fillStyle = `rgba(255, ${170 + Math.floor(t * 40)}, 90, ${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx.fill();
        if (t >= 1 || e.y < -10) {
          e.x = Math.random() * c.width;
          e.y = c.height + Math.random() * 40;
          e.life = 0;
          e.maxLife = 6 + Math.random() * 8;
        }
      }
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }
}
