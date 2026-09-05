/**
 * @module ui/SystemBar
 * THE SYSTEM ACCESS BAR (it.66): the top-right corner, beside the minimap.
 *
 * Six targets — pack, talents, hero, bestiary, menu, fullscreen — that open
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
import { ICON_BESTIARY, ICON_COG, ICON_FULLSCREEN, ICON_HERO, ICON_PACK, ICON_TREE } from '@/ui/icons';
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
      // POINTERDOWN, NOT CLICK. A touch that has to wait for the click event
      // feels broken next to a joystick that answers on contact, and a
      // 300 ms tap delay on an older mobile browser is worse still. The one
      // exception is fullscreen: browsers grant it only from a completed
      // user gesture, and pointerdown is not always one — that entry waits
      // for pointerup.
      b.addEventListener(
        'pointerdown',
        (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (!e.key) return;
          this.feedback();
          window.dispatchEvent(new KeyboardEvent('keydown', { code: e.key, key: e.key, bubbles: true }));
        },
        { signal },
      );
      if (!e.key) {
        b.addEventListener(
          'pointerup',
          (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.feedback();
            void toggleFullscreen();
          },
          { signal },
        );
      }
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
