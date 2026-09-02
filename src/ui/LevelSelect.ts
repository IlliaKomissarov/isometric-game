/**
 * @module ui/LevelSelect
 * Depth selection menu (L key): jump instantly between UNLOCKED floors.
 * A floor unlocks the first time the player reaches it; the best depth
 * persists per-browser via localStorage (guarded — storage can be absent).
 *
 * Pure DOM/render layer: the actual floor change happens through the
 * `onSelect` callback wired in main (destroy world → build world).
 */

import { MAX_DEPTH } from '@/core/config';
import { audio } from '@/engine/AudioManager';

const STORAGE_KEY = 'iso-arpg-max-depth';
const ROMAN = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
];

/** Named keeper per warden's crypt (every 5th depth). */
const BOSS_HINTS: Record<number, string> = {
  5: 'the tomb warden waits',
  10: 'the frost warden waits',
  15: 'the ember warden waits',
  20: 'the hollow king waits',
};

export class LevelSelectUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private maxDepth = 1;
  private readonly abort = new AbortController();

  constructor(private readonly onSelect: (floor: number) => void) {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(stored) && stored >= 1) this.maxDepth = Math.min(stored, MAX_DEPTH);
    } catch {
      /* storage unavailable — session-only unlocks */
    }

    this.panel = document.createElement('div');
    this.panel.id = 'level-select';
    document.body.appendChild(this.panel);

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'KeyL' && !e.repeat) {
          e.preventDefault();
          this.toggle();
        }
      },
      { signal: this.abort.signal },
    );
    this.render();
  }

  /** Run teardown (it.36). */
  destroy(): void {
    this.abort.abort();
    this.panel.remove();
  }

  /** Record reaching a floor (unlocks it in the menu, persists best). */
  unlock(floor: number): void {
    floor = Math.min(floor, MAX_DEPTH); // The crypt ends at Depth XX.
    if (floor <= this.maxDepth) return;
    this.maxDepth = floor;
    try {
      localStorage.setItem(STORAGE_KEY, String(floor));
    } catch {
      /* ignore */
    }
    this.render();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle('open', this.visible);
    audio.sfx(this.visible ? 'mapOpen' : 'mapClose');
  }

  private render(): void {
    const rows = Array.from({ length: this.maxDepth }, (_, i) => {
      const floor = i + 1;
      const hint =
        BOSS_HINTS[floor] ??
        (floor >= 15 ? 'the ember depths' : floor >= 10 ? 'the frozen halls' : floor >= 3 ? 'the buried temple' : 'stone crypts');
      return `<button class="lvl-row" data-floor="${floor}">
                <span class="lvl-name">DEPTH ${ROMAN[i] ?? floor}</span>
                <span class="lvl-hint">${hint}</span>
              </button>`;
    }).join('');
    this.panel.innerHTML = `<h3>DESCEND TO…</h3><div class="lvl-scroll">${rows}</div><div class="lvl-tip">Reach new depths to unlock them</div>`;
    this.panel.querySelectorAll<HTMLButtonElement>('.lvl-row').forEach((btn) => {
      btn.addEventListener('mouseenter', () => audio.sfx('uiHover'));
      btn.addEventListener('click', () => {
        audio.sfx('uiConfirm');
        this.toggle();
        this.onSelect(Number(btn.dataset.floor));
      });
    });
  }
}
