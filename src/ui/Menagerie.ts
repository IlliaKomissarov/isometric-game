/**
 * @module ui/Menagerie
 * THE MENAGERIE'S PICKER (it.114). A panel on the left of the sand: every
 * costume the game can draw, grouped, searchable, with the label and the
 * source folder the owner will quote back ("the treant from mob13 - its
 * attack is too slow"). Picking one puts it on the hero; the extras row fires
 * a costume's named one-shots (roar, breath, awake, cast). The panel is pure
 * DOM and owns no game logic - the hooks do the wearing.
 */

import { audio } from '@/engine/AudioManager';
import type { Costume } from '@/render/costumes';

export interface MenagerieHooks {
  costumes: () => Costume[];
  /** Put a costume on (or `null` for the hero's own body). */
  wear: (id: string | null) => void;
  /** Fire a one-shot from the worn costume's extras. */
  play: (extra: string) => void;
  /** Extras the worn costume offers. */
  extras: () => string[];
  /** Spawn a few of the worn costume's kind as real foes (if it is a kind). */
  summon: () => void;
  leave: () => void;
}

const GROUP_LABEL: Record<Costume['group'], string> = {
  hero: 'HEROES',
  boss: 'WARDENS AND BEASTS',
  foe: 'THE HOST',
  npc: 'THE TOWNSFOLK',
};

const CSS = `
#menagerie {
  position: fixed;
  left: 16px;
  top: 96px;
  bottom: 120px;
  width: 268px;
  display: none;
  flex-direction: column;
  padding: 10px 12px;
  background: linear-gradient(180deg, rgba(24, 19, 30, 0.96), rgba(10, 8, 13, 0.97));
  border: 1px solid #56304a;
  box-shadow: inset 0 0 24px rgba(0, 0, 0, 0.7), 0 0 18px rgba(0, 0, 0, 0.7);
  z-index: 31;
  color: #e8dfcc;
  font-family: 'Crimson Pro', Georgia, serif;
}
#menagerie.open { display: flex; }
body.cine #menagerie { display: none; }
#menagerie h3 { margin: 0; font-family: 'Cinzel', serif; font-size: 14px; letter-spacing: 0.22em; color: #ffd070; }
#menagerie .mg-sub { font-size: 12px; font-style: italic; color: #a89c86; margin: 2px 0 8px; }
#menagerie .mg-search {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  margin-bottom: 8px;
  color: #efe6d2;
  background: #0f0c14;
  border: 1px solid #3c3448;
  font-family: inherit;
  font-size: 13px;
}
#menagerie .mg-list { flex: 1; overflow-y: auto; min-height: 80px; scrollbar-width: thin; scrollbar-color: #56304a transparent; }
#menagerie .mg-group { font-family: 'Cinzel', serif; font-size: 10px; letter-spacing: 0.2em; color: #a89c86; margin: 8px 0 4px; }
#menagerie .mg-row {
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  margin: 2px 0;
  color: #e8dfcc;
  background: #17131e;
  border: 1px solid #3c3448;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
}
#menagerie .mg-row:hover { border-color: #c8a558; }
#menagerie .mg-row.lit { border-color: #ffd070; background: #2a2135; box-shadow: inset 0 0 12px rgba(200, 165, 88, 0.15); }
#menagerie .mg-row b { display: block; font-family: 'Cinzel', serif; font-size: 11px; letter-spacing: 0.1em; color: #ffd070; }
#menagerie .mg-row small { display: block; font-size: 11px; color: #a89c86; }
#menagerie .mg-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
#menagerie .mg-actions button {
  flex: 1 1 auto;
  padding: 6px 8px;
  font-family: 'Cinzel', serif;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: #e8dfcc;
  background: linear-gradient(180deg, #221b2c, #0f0c14);
  border: 1px solid #56304a;
  cursor: pointer;
}
#menagerie .mg-actions button:hover { border-color: #c8a558; color: #ffd070; }
#menagerie .mg-actions button.leave { border-color: #8a3a34; color: #ff8a7a; }
#menagerie .mg-worn { font-size: 12px; color: #d9cfbb; margin-top: 6px; }
#menagerie .mg-worn b { color: #ffd070; }
body.input-touch #menagerie { top: 70px; bottom: 170px; width: 220px; }
`;

export class MenagerieUI {
  private readonly panel: HTMLElement;
  private query = '';
  private worn: string | null = null;

  constructor(private readonly hooks: MenagerieHooks) {
    if (!document.getElementById('menagerie-css')) {
      const style = document.createElement('style');
      style.id = 'menagerie-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.panel = document.createElement('div');
    this.panel.id = 'menagerie';
    document.body.appendChild(this.panel);
    // Painted on `open()`, not here: the hooks read tables main declares after
    // this panel is built.
  }

  open(): void {
    this.panel.classList.add('open');
    this.paint();
  }

  close(): void {
    this.panel.classList.remove('open');
  }

  get isOpen(): boolean {
    return this.panel.classList.contains('open');
  }

  /** Reflect a costume worn by another road (the bestiary's TRY OUT). */
  setWorn(id: string | null): void {
    this.worn = id;
    if (this.isOpen) this.paint();
  }

  destroy(): void {
    this.panel.remove();
  }

  private paint(): void {
    const all = this.hooks.costumes();
    const q = this.query.trim().toLowerCase();
    const shown = q ? all.filter((c) => `${c.label} ${c.id} ${c.source}`.toLowerCase().includes(q)) : all;
    const groups: Costume['group'][] = ['hero', 'boss', 'foe', 'npc'];
    const list = groups
      .map((g) => {
        const rows = shown.filter((c) => c.group === g);
        if (!rows.length) return '';
        return (
          `<div class="mg-group">${GROUP_LABEL[g]}</div>` +
          rows.map((c) => `<button class="mg-row${this.worn === c.id ? ' lit' : ''}" data-wear="${c.id}"><b>${c.label}</b><small>${c.id} · ${c.source}</small></button>`).join('')
        );
      })
      .join('');
    const worn = all.find((c) => c.id === this.worn);
    const extras = worn ? this.hooks.extras() : [];
    const focusSearch = document.activeElement === this.panel.querySelector('.mg-search');
    this.panel.innerHTML = `
      <h3>THE MENAGERIE</h3>
      <div class="mg-sub">walk the sand as anything · WASD moves, Space strikes, T leaves</div>
      <input class="mg-search" type="search" placeholder="find a body…" value="${this.query.replace(/"/g, '&quot;')}">
      <div class="mg-list"><button class="mg-row${this.worn === null ? ' lit' : ''}" data-wear=""><b>YOUR OWN BODY</b><small>the hero's rig</small></button>${list}</div>
      <div class="mg-worn">${worn ? `Wearing <b>${worn.label}</b> · <span>${worn.id}</span> · ${worn.source}` : 'Wearing your own body'}</div>
      <div class="mg-actions">
        ${extras.map((e) => `<button data-play="${e}">▶ ${e.toUpperCase()}</button>`).join('')}
        ${worn ? `<button data-play="__death">▶ DEATH</button><button data-play="__hit">▶ HIT</button>` : ''}
        <button data-summon>SUMMON THREE</button>
        <button class="leave" data-leave>LEAVE THE SAND</button>
      </div>`;
    const search = this.panel.querySelector<HTMLInputElement>('.mg-search');
    search?.addEventListener('input', () => {
      this.query = search.value;
      const at = search.selectionStart ?? search.value.length;
      this.paint();
      const again = this.panel.querySelector<HTMLInputElement>('.mg-search');
      again?.focus();
      again?.setSelectionRange(at, at);
    });
    // The search box must not steal the game's keys while typing, and vice versa.
    search?.addEventListener('keydown', (e) => e.stopPropagation());
    if (focusSearch) search?.focus();
    this.panel.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
      b.addEventListener('click', () => {
        audio.sfx('uiClick');
        if (b.dataset.wear !== undefined) {
          this.worn = b.dataset.wear === '' ? null : b.dataset.wear;
          this.hooks.wear(this.worn);
          this.paint();
        } else if (b.dataset.play) this.hooks.play(b.dataset.play);
        else if ('summon' in b.dataset) this.hooks.summon();
        else if ('leave' in b.dataset) this.hooks.leave();
      });
    });
  }
}
