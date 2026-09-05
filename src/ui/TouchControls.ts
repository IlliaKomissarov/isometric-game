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
import { ICON_BLADES, ICON_FLASK, ICON_HAND, ICON_PORTAL } from '@/ui/icons';
import { VirtualJoystick } from './VirtualJoystick';

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

    // THE SKILL ARC (it.66). The four skills ride a 118 px arc around the
    // attack, swept from due-left to up-and-right, which is the path the
    // thumb actually travels when the hand rests at the corner. The radius
    // is not a taste: at 118 px every neighbouring pair is at least 56 px
    // apart on one axis, so four round 56 px targets and one 84 px attack
    // never share a pixel at any scale. Anything tighter and the boxes
    // overlap even while the circles look clear.
    const rowUse = this.row('tc-row-use');
    const arc = document.createElement('div');
    arc.className = 'tc-arc';
    this.padRight.appendChild(arc);
    const rowSkills = this.row('tc-row-skills', arc);
    const rowMain = this.row('tc-row-main', arc);
    this.rowUse = rowUse;
    this.mk(rowUse, 'tc-use tc-portal', 'TOWN PORTAL', ICON_PORTAL, () => this.tap({ type: 'TOWN_PORTAL', playerId: 0 }));
    this.mk(rowUse, 'tc-use tc-mana', 'MANA DRAUGHT', ICON_FLASK, () => this.tap({ type: 'USE_QUICK', playerId: 0, kind: 'mana' }));
    this.mk(rowUse, 'tc-use tc-potion', 'HEALING DRAUGHT', ICON_FLASK, () => this.tap({ type: 'USE_QUICK', playerId: 0, kind: 'health' }));
    for (let i = 0; i < 4; i++) {
      this.mk(rowSkills, `tc-skill tc-skill-${i}`, `SKILL ${i + 1}`, String(i + 1), () => this.tap({ type: 'SKILL', playerId: 0, slot: i }));
    }
    this.mk(rowMain, 'tc-use tc-interact', 'INTERACT', ICON_HAND, () => this.tap({ type: 'PICKUP_NEAREST', playerId: 0 }));
    this.mk(rowMain, 'tc-attack', 'ATTACK', ICON_BLADES, () => this.press('attack'), () => this.release('attack'));

    layout.onChange(() => this.applyLayout());
    this.applyLayout();
  }

  private row(cls: string, into: HTMLElement = this.padRight): HTMLElement {
    const el = document.createElement('div');
    el.className = `tc-row ${cls}`;
    into.appendChild(el);
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
  }

  /** Touch controls appear on touch devices, or when forced for testing. */
  private forced: boolean | null = null;
  setForced(on: boolean | null): void {
    this.forced = on;
    this.refresh();
  }

  private get shouldShow(): boolean {
    if (!this.enabled) return false;
    return this.forced ?? layout.state.touch;
  }

  private refresh(): void {
    this.root.classList.toggle('show', this.shouldShow);
    document.body.classList.toggle('touch-controls-on', this.shouldShow);
    if (!this.shouldShow) this.stick.reset();
  }

  private applyLayout(): void {
    const s = layout.state;
    // The base always comes to the thumb now (it.64) — only the travel changes.
    this.stick.setRadius(s.tier === 'micro' ? 40 : s.tier === 'compact' ? 52 : 62);
    // IN THE PAD (it.64) the utilities ride above the stick on the left. Four
    // 56 px skills plus the attack already fill the right half of a phone;
    // splitting the load is what keeps every target its full size and stops
    // the cluster growing up out of the slate into the fight.
    // A micro screen held flat (320x240) moves them left too: the folded
    // system bar takes the upper right, and a draught row under it would
    // sit inside the bar's own box (it.66).
    const wantLeft = s.padH > 0 || s.tier === 'micro';
    // The draughts ride above the arc on the right, or above the stick on the
    // left when there is a pad. The arc is the right pad's other child, so
    // the row always goes in FRONT of it rather than before a skill row that
    // now lives one level down (it.66).
    if (wantLeft && this.rowUse.parentElement !== this.padLeft) this.padLeft.insertBefore(this.rowUse, this.padLeft.firstChild);
    else if (!wantLeft && this.rowUse.parentElement !== this.padRight) this.padRight.insertBefore(this.rowUse, this.padRight.firstChild);
    this.refresh();
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
