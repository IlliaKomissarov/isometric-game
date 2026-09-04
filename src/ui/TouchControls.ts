/**
 * @module ui/TouchControls
 * THE VIRTUAL CONTROLS (it.63): a thumb stick, an attack, four skills, two
 * draughts, interact, the portal rite and fullscreen — every one an
 * independent multi-touch target.
 *
 * ORIENTATION-AWARE: in PORTRAIT the controls sit inside the gothic pad
 * below the crypt (stick left, skill arc right) so no finger is ever over
 * the fight. In LANDSCAPE they float in the lower corners of the full-bleed
 * canvas, the stick following the thumb that presses down.
 *
 * MULTI-TOUCH: each control captures its own pointer id, so steering with
 * the left thumb while the right one hammers skills never drops an input.
 * Held buttons repeat the way a held key does. Nothing here touches the
 * simulation directly: everything becomes an `InputCommand` on the queue,
 * stamped with the local seat, so a co-op party stays in lockstep.
 */

import type { InputCommand, InputQueue } from '@/core/InputQueue';
import { layout } from '@/core/OrientationManager';
import { audio } from '@/engine/AudioManager';
import { VirtualJoystick } from './VirtualJoystick';
import { fit } from './FitScaler';

/** The controls exist only while a run does; main hands the queue over. */
export interface TouchHooks {
  /** True while a modal owns the screen (the pad steps aside). */
  blocked: () => boolean;
}

interface HoldButton {
  el: HTMLButtonElement;
  pointerId: number | null;
}

const HAPTIC_MS = 15;

/**
 * FULLSCREEN (it.63): the only way a phone browser gives the game the whole
 * screen (and locks the address bar out of the layout). Safari on iOS only
 * exposes the webkit spelling, and only on some elements.
 */
export async function toggleFullscreen(): Promise<boolean> {
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try {
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      return false;
    }
    await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
    // A phone that can also lock the orientation keeps the choice the player made.
    try {
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.(
        window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape',
      );
    } catch {
      /* orientation locking is a phone-only courtesy */
    }
    return true;
  } catch (err) {
    console.warn('[fullscreen] refused:', err);
    return false;
  }
}

/**
 * THE FULLSCREEN CONTROL (it.64): a gothic corner button on every screen —
 * the title, the crypt, a phone or a desktop. Small, unobtrusive, and the
 * one place a player looks for it.
 */
export class FullscreenButton {
  private readonly el: HTMLButtonElement;

  constructor() {
    this.el = document.createElement('button');
    this.el.id = 'fullscreen-btn';
    this.el.type = 'button';
    this.el.title = 'Fullscreen';
    this.el.setAttribute('aria-label', 'Toggle fullscreen');
    this.el.innerHTML = '<i></i>';
    document.body.appendChild(this.el);
    this.el.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    this.el.addEventListener('click', () => {
      audio.sfx('uiClick');
      void toggleFullscreen();
    });
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
      document.addEventListener(ev, () => this.sync());
    }
    this.sync();
  }

  private sync(): void {
    const on = !!(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement);
    this.el.classList.toggle('on', on);
    this.el.title = on ? 'Leave fullscreen' : 'Fullscreen';
  }
}

export class TouchControls {
  private readonly root: HTMLElement;
  private readonly padLeft: HTMLElement;
  private readonly padRight: HTMLElement;
  private readonly stick: VirtualJoystick;
  private readonly buttons: HoldButton[] = [];
  private readonly abort = new AbortController();
  private queue: InputQueue | null = null;
  private hooks: TouchHooks | null = null;
  private enabled = false;
  private lastDir = { x: 0, y: 0 };
  private attacking = false;
  private rowUse!: HTMLElement;
  private rowSkills!: HTMLElement;
  private tray!: HTMLElement;
  private trayToggle!: HTMLButtonElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'touch-controls';
    this.padLeft = document.createElement('div');
    this.padLeft.className = 'tc-left';
    this.padRight = document.createElement('div');
    this.padRight.className = 'tc-right';
    this.root.append(this.padLeft, this.padRight);
    document.body.appendChild(this.root);

    this.stick = new VirtualJoystick(this.padLeft, { radius: 60, deadzone: 0.12 });
    this.stick.onChange = (x, y) => this.steer(x, y);

    // The right cluster packs into three wrapping rows — utilities, skills,
    // then the attack at the thumb's rest. Rows (not an absolute arc) are
    // what keep every target its full 44 px and non-overlapping from a
    // 240 px feature phone to an 8K panel.
    const rowUse = this.row('tc-row-use');
    const rowSkills = this.row('tc-row-skills');
    const rowMain = this.row('tc-row-main');
    this.rowUse = rowUse;
    this.rowSkills = rowSkills;
    this.mk(rowUse, 'tc-use tc-portal', 'TOWN PORTAL', '⌂', () => this.tap({ type: 'TOWN_PORTAL', playerId: 0 }));
    this.mk(rowUse, 'tc-use tc-mana', 'MANA DRAUGHT', '✦', () => this.tap({ type: 'USE_QUICK', playerId: 0, kind: 'mana' }));
    this.mk(rowUse, 'tc-use tc-potion', 'HEALING DRAUGHT', '❤', () => this.tap({ type: 'USE_QUICK', playerId: 0, kind: 'health' }));
    for (let i = 0; i < 4; i++) {
      this.mk(rowSkills, `tc-skill tc-skill-${i}`, `SKILL ${i + 1}`, String(i + 1), () => this.tap({ type: 'SKILL', playerId: 0, slot: i }));
    }
    this.mk(rowMain, 'tc-use tc-interact', 'INTERACT', 'E', () => this.tap({ type: 'PICKUP_NEAREST', playerId: 0 }));
    this.mk(rowMain, 'tc-attack', 'ATTACK', '⚔', () => this.press('attack'), () => this.release('attack'));

    this.buildTray();
    layout.onChange(() => this.applyLayout());
    // The free band changes with every reflow frame, not only on a flip.
    layout.onReflow(() => this.placeHud());
    this.applyLayout();
  }

  /**
   * THE SYSTEM TRAY (it.65): a phone has no keyboard, so the bag, the tree,
   * the sheet, the map and the pause menu were simply unreachable — the one
   * thing no amount of layout work could fix. A single gothic ☰ opens a
   * column of them beside the fullscreen corner.
   *
   * Each entry dispatches the SAME key the desktop uses, so there is one code
   * path into every panel and no second way for them to disagree.
   */
  private buildTray(): void {
    this.tray = document.createElement('div');
    this.tray.id = 'tc-tray';
    this.trayToggle = document.createElement('button');
    this.trayToggle.type = 'button';
    this.trayToggle.className = 'tc-tray-toggle';
    this.trayToggle.setAttribute('aria-label', 'Menus');
    this.trayToggle.innerHTML = '<span>☰</span>';
    const list = document.createElement('div');
    list.className = 'tc-tray-list';
    const items: Array<[string, string, string]> = [
      ['BAG', 'KeyI', '🎒'],
      ['SKILLS', 'KeyK', '✦'],
      ['HERO', 'KeyC', '👤'],
      ['MAP', 'KeyM', '🗺'],
      ['PAUSE', 'Escape', '⏸'],
    ];
    // Fullscreen lives in the tray on touch: the screen corners belong to the
    // map and the thumb clusters, and a corner button collided with both.
    const fsBtn = document.createElement('button');
    fsBtn.type = 'button';
    fsBtn.className = 'tc-tray-item';
    fsBtn.setAttribute('aria-label', 'FULLSCREEN');
    fsBtn.innerHTML = '<i>⛶</i><em>FULLSCREEN</em>';
    fsBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.haptic();
      audio.sfx('uiClick');
      this.openTray(false);
      void toggleFullscreen();
    });
    for (const [label, code, glyph] of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tc-tray-item';
      b.setAttribute('aria-label', label);
      b.innerHTML = `<i>${glyph}</i><em>${label}</em>`;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.haptic();
        audio.sfx('uiClick');
        this.openTray(false);
        // The panels all listen on window; one path in for keys and thumbs.
        window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
        fit.schedule(); // The panel just gained a box — fit it to the phone.
        window.setTimeout(() => fit.schedule(), 60);
      });
      list.appendChild(b);
    }
    list.appendChild(fsBtn);
    // Tapping the darkened ground closes the sheet.
    const veil = document.createElement('div');
    veil.className = 'tc-tray-veil';
    veil.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.openTray(false);
    });
    this.tray.append(this.trayToggle, veil, list);
    document.body.appendChild(this.tray);
    this.trayToggle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.haptic();
      audio.sfx('uiClick');
      this.openTray(!this.tray.classList.contains('open'));
    });
  }

  private openTray(on: boolean): void {
    this.tray.classList.toggle('open', on);
  }

  private row(cls: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `tc-row ${cls}`;
    this.padRight.appendChild(el);
    return el;
  }

  /** A control: pointer-captured, so a slide off it still counts as held. */
  private mk(into: HTMLElement, cls: string, label: string, glyph: string, down: () => void, up?: () => void): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `tc-btn ${cls}`;
    el.setAttribute('aria-label', label);
    el.innerHTML = `<span>${glyph}</span>`;
    into.appendChild(el);
    const entry: HoldButton = { el, pointerId: null };
    this.buttons.push(entry);
    const { signal } = this.abort;
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (entry.pointerId !== null) return;
        e.preventDefault();
        e.stopPropagation();
        entry.pointerId = e.pointerId;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* a synthetic or already-released pointer cannot be captured */
        }
        el.classList.add('held');
        this.haptic();
        down();
      },
      { signal },
    );
    const end = (e: PointerEvent): void => {
      if (entry.pointerId !== e.pointerId) return;
      entry.pointerId = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* already gone */
      }
      el.classList.remove('held');
      up?.();
    };
    el.addEventListener('pointerup', end, { signal });
    el.addEventListener('pointercancel', end, { signal });
    el.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    return el;
  }

  /** Wire a live run (null tears the controls down between runs). */
  attach(queue: InputQueue | null, hooks: TouchHooks | null): void {
    this.queue = queue;
    this.hooks = hooks;
    this.enabled = !!queue;
    this.refresh();
    this.placeHud();
  }

  /** Touch controls appear on touch devices, or when forced for testing. */
  private forced: boolean | null = null;
  setForced(on: boolean | null): void {
    this.forced = on;
    this.refresh();
    this.placeHud();
  }

  private get shouldShow(): boolean {
    if (!this.enabled) return false;
    return this.forced ?? layout.state.touch;
  }

  private refresh(): void {
    this.root.classList.toggle('show', this.shouldShow);
    document.body.classList.toggle('touch-controls-on', this.shouldShow);
    this.tray?.classList.toggle('show', this.shouldShow);
    if (!this.shouldShow) {
      this.openTray(false);
      this.stick.reset();
      document.body.classList.remove('hud-top');
    }
  }

  private applyLayout(): void {
    const s = layout.state;
    // The base always comes to the thumb now (it.64) — only the travel changes.
    this.stick.setRadius(s.tier === 'micro' ? 40 : s.tier === 'compact' ? 52 : 62);
    // IN THE PAD (it.64) the utilities ride above the stick on the left. Four
    // 56 px skills plus the attack already fill the right half of a phone;
    // splitting the load is what keeps every target its full size and stops
    // the cluster growing up out of the slate into the fight.
    const wantLeft = s.padH > 0;
    if (wantLeft && this.rowUse.parentElement !== this.padLeft) this.padLeft.insertBefore(this.rowUse, this.padLeft.firstChild);
    else if (!wantLeft && this.rowUse.parentElement !== this.padRight) this.padRight.insertBefore(this.rowUse, this.rowSkills);
    this.refresh();
    this.placeHud();
  }

  /**
   * WHERE THE METERS GO (it.63). With the controls floating, the lower band
   * is hands. The globes sit at the lower centre when there is a real gap
   * between the stick and the cluster, and move to the top band when there
   * is not — measured, because the answer depends on the screen's width,
   * the HUD scale and how many controls the tier shows.
   */
  private placeHud(): void {
    if (!this.shouldShow || layout.state.padH > 0) {
      document.body.classList.remove('hud-top');
      return;
    }
    const stick = this.padLeft.getBoundingClientRect();
    const cluster = this.padRight.getBoundingClientRect();
    const free = cluster.left - stick.right;
    document.body.classList.toggle('hud-top', free < 250);
  }

  // --- Input ---------------------------------------------------------------------

  private steer(sx: number, sy: number): void {
    if (!this.queue || this.hooks?.blocked()) return;
    if (sx === 0 && sy === 0) {
      if (this.lastDir.x !== 0 || this.lastDir.y !== 0) {
        this.lastDir = { x: 0, y: 0 };
        this.queue.enqueue({ type: 'STOP', playerId: 0 });
      }
      return;
    }
    this.lastDir = { x: sx, y: sy };
    // Screen intent → world axes, exactly as the keyboard does it.
    this.queue.enqueue({ type: 'DIRECT_MOVE', playerId: 0, dx: sy + sx, dy: sy - sx });
  }

  private press(what: 'attack'): void {
    if (!this.queue || this.hooks?.blocked()) return;
    if (what === 'attack' && !this.attacking) {
      this.attacking = true;
      this.queue.enqueue({ type: 'ATTACK_DOWN', playerId: 0 });
    }
  }

  private release(what: 'attack'): void {
    if (what === 'attack' && this.attacking) {
      this.attacking = false;
      this.queue?.enqueue({ type: 'ATTACK_UP', playerId: 0 });
    }
  }

  private tap(cmd: InputCommand): void {
    if (!this.queue || this.hooks?.blocked()) return;
    this.queue.enqueue(cmd);
    audio.sfx('uiClick');
  }

  private haptic(): void {
    try {
      navigator.vibrate?.(HAPTIC_MS);
    } catch {
      /* vibration is a courtesy, never a requirement */
    }
  }

  /** A rotation or a modal must not leave the hero walking into a wall. */
  releaseAll(): void {
    this.openTray(false);
    this.stick.reset();
    for (const b of this.buttons) {
      b.pointerId = null;
      b.el.classList.remove('held');
    }
    if (this.attacking) {
      this.attacking = false;
      this.queue?.enqueue({ type: 'ATTACK_UP', playerId: 0 });
    }
    if (this.lastDir.x !== 0 || this.lastDir.y !== 0) {
      this.lastDir = { x: 0, y: 0 };
      this.queue?.enqueue({ type: 'STOP', playerId: 0 });
    }
  }

  destroy(): void {
    this.abort.abort();
    this.stick.destroy();
    this.root.remove();
  }
}

export const touchControls = new TouchControls();
export const fullscreenButton = new FullscreenButton();
