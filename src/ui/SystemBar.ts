/**
 * @module ui/SystemBar
 * THE SYSTEM ACCESS BAR (it.66): the top-right corner, beside the minimap.
 *
 * Seven targets — pack, talents, hero, bestiary, menu, the Forbidden Arts
 * (the cheat menu, it.68) and fullscreen — that open
 * the same windows the keyboard opens, by dispatching the same keys. One
 * code path in, so a thumb and a key can never disagree about what a panel
 * does. Fullscreen is the one entry with no key: it calls the toggle the
 * settings sheet also calls.
 *
 * It replaces the it.65 tray, which was a stopgap: a hidden sheet behind a
 * toggle costs two taps and hides what the game can do. A visible bar costs
 * one tap and doubles as the discoverability the touch build never had. It
 * shows on a desktop too — a pointer has no reason to be worse served, and
 * one bar for every device means one thing to keep correct.
 *
 * ITS SHAPE IS THE LAYOUT'S CALL, not this module's: OrientationManager
 * publishes `bar-row` / `bar-grid3` / `bar-grid2` on the body and `--sb-size`,
 * and the CSS folds the six targets into a row, a 3x2 block or a 2x3
 * column. The bar never hides an entry — every panel is reachable on every
 * screen in the matrix, which is the invariant the it.65 tray was built to
 * restore and the it.66 first cut quietly broke on short screens.
 */

import { audio } from '@/engine/AudioManager';
import { ICON_BESTIARY, ICON_COG, ICON_FULLSCREEN, ICON_HERO, ICON_PACK, ICON_SKULL, ICON_TREE } from '@/ui/icons';
import { toggleFullscreen } from '@/ui/TouchControls';

interface Entry {
  /** The key the entry stands in for, or null for an action of its own. */
  key: string | null;
  label: string;
  icon: string;
  cls: string;
}

const ENTRIES: Entry[] = [
  { key: 'KeyI', label: 'Inventory', icon: ICON_PACK, cls: 'sb-pack' },
  { key: 'KeyK', label: 'Talents', icon: ICON_TREE, cls: 'sb-tree' },
  { key: 'KeyC', label: 'Hero', icon: ICON_HERO, cls: 'sb-hero' },
  { key: 'KeyB', label: 'Bestiary', icon: ICON_BESTIARY, cls: 'sb-bestiary' },
  { key: 'Escape', label: 'Menu', icon: ICON_COG, cls: 'sb-menu' },
  { key: 'F1', label: 'Forbidden Arts', icon: ICON_SKULL, cls: 'sb-cheats' },
  { key: null, label: 'Fullscreen', icon: ICON_FULLSCREEN, cls: 'sb-full' },
];

const isFullscreen = (): boolean =>
  !!(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement);

export class SystemBar {
  private readonly root: HTMLElement;
  private readonly abort = new AbortController();

  /**
   * THE TOP-RIGHT STACK. The map and the bar both want the corner. Stacking
   * them — map above, bar below — is measured rather than guessed, and it
   * collapses on its own when a short screen hides the map.
   */
  private static stack(): HTMLElement {
    let el = document.getElementById('hud-tr');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hud-tr';
      document.body.appendChild(el);
    }
    return el;
  }

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'system-bar';
    this.root.className = 'hud-el';
    const { signal } = this.abort;
    for (const e of ENTRIES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ds-icon-btn ${e.cls}`;
      if (e.key) b.dataset.key = e.key;
      b.title = e.label;
      b.setAttribute('aria-label', e.label);
      b.innerHTML = `${e.icon}<em>${e.label}</em>`;
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'), { signal });
      // ON RELEASE, ONE TASK LATER (it.67). The first cut opened the window
      // on pointerdown. On a phone the same tap then delivered its `click`
      // — which fires after pointerup, at the same spot — to whatever the
      // new window had just put under the finger: the pause sheet's
      // RESTART or MAIN MENU button sat exactly there on a 412 px screen,
      // so "Menu" restarted the run. The press still lights on contact
      // (:active / .held) for feel; the ACTION waits for pointerup and then
      // one macrotask, which is after the browser has dispatched the tap's
      // click to this button and not to the window it opens.
      b.addEventListener(
        'pointerdown',
        (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          b.classList.add('held');
          try {
            b.setPointerCapture(ev.pointerId);
          } catch {
            /* synthetic pointers cannot be captured */
          }
        },
        { signal },
      );
      const release = (ev: PointerEvent, fire: boolean): void => {
        ev.preventDefault();
        ev.stopPropagation();
        b.classList.remove('held');
        if (!fire) return;
        this.feedback();
        // Fullscreen is granted only inside the user gesture: it must run
        // synchronously here, not from the timer.
        if (!e.key) {
          void toggleFullscreen();
          return;
        }
        window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: e.key!, key: e.key!, bubbles: true })), 0);
      };
      b.addEventListener('pointerup', (ev) => release(ev, true), { signal });
      b.addEventListener('pointercancel', (ev) => release(ev, false), { signal });
      b.addEventListener('contextmenu', (ev) => ev.preventDefault(), { signal });
      this.root.appendChild(b);
    }
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => this.sync(), { signal });
    this.sync();
    const stack = SystemBar.stack();
    const map = document.getElementById('minimap');
    if (map) stack.appendChild(map); // The map takes the corner; the bar sits under it.
    stack.appendChild(this.root);
  }

  private feedback(): void {
    audio.sfx('uiClick');
    try {
      navigator.vibrate?.(8);
    } catch {
      /* vibration is a courtesy, never a requirement */
    }
  }

  /** The fullscreen mark reads its own state, like the corner button does. */
  private sync(): void {
    const on = isFullscreen();
    const b = this.root.querySelector<HTMLButtonElement>('.sb-full');
    if (!b) return;
    b.classList.toggle('on', on);
    b.title = on ? 'Leave fullscreen' : 'Fullscreen';
    b.setAttribute('aria-pressed', String(on));
  }

  destroy(): void {
    this.abort.abort();
    this.root.remove();
  }
}
