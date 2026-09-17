/**
 * @module ui/Menagerie
 * THE MENAGERIE'S PICKER AND DOCK (it.115).
 *
 * The owner: "in THE MENAGERIE there needs to be a selection menu like in the
 * bestiary, but with more NPCs". So:
 *
 *   - THE PICKER (left): the bestiary's frame, a grid of cards - each with its
 *     body breathing in the card, facing the camera - a search box, shelf
 *     chips (the host, men under arms, wardens, heroes and the watch,
 *     townsfolk and cast, the drop) and a source filter. It lists every enemy
 *     kind AND every other body in the atlas. A card toggles its body onto the
 *     sand, where it stands on its own marked spot (`render/Puppet`).
 *   - THE DOCK (bottom): the bodies on the sand as chips (pick one, or ALL),
 *     the clips to play on them (idle, walk, attack, hit, death and the
 *     body's own extras), turning, facing the camera, clearing the sand,
 *     summoning a live pack of the picked kind, and leaving.
 *
 * Pure DOM; the hooks own the models.
 */

import { audio } from '@/engine/AudioManager';
import { SHELVES, type Costume, type CostumeShelf } from '@/render/costumes';
import { animatePreviews, previewHtml } from '@/ui/sheetPreview';

export interface MenagerieHooks {
  costumes: () => Costume[];
  /** Ids on the sand, in order. */
  placed: () => string[];
  /** The model the dock acts on (`null` = all of them). */
  focused: () => string | null;
  /** Put a body on the sand, or take it off. */
  toggle: (id: string) => void;
  focus: (id: string | null) => void;
  /** Play a clip (idle, walk, attack, hit, death, or an extra's name). */
  act: (act: string) => void;
  rotate: (step: number) => void;
  faceCamera: () => void;
  clear: () => void;
  /** The extras the focused body offers (none for ALL). */
  extras: () => string[];
  /** Which of the standard clips the focused body has (all for ALL). */
  hasClip: (act: string) => boolean;
  /** Summon a live pack of the focused kind (only for an enemy kind). */
  summon: () => void;
  leave: () => void;
}

const CSS = `
#menagerie {
  position: fixed; left: 14px; top: 64px; bottom: 150px; width: min(560px, calc(100vw - 28px));
  display: none; flex-direction: column; padding: 12px 14px 10px; z-index: 31;
  color: var(--ink, #e8dfcc); font-family: 'Crimson Pro', Georgia, serif;
  background: linear-gradient(180deg, rgba(24, 19, 30, 0.97), rgba(10, 8, 13, 0.97));
  border: 1px solid var(--frame-iron, #3b3244);
  box-shadow: inset 0 0 0 1px rgba(200, 165, 88, 0.12), inset 0 0 26px rgba(0, 0, 0, 0.7), 0 10px 30px rgba(0, 0, 0, 0.7);
}
#menagerie.open { display: flex; }
#menagerie.folded { bottom: auto; }
#menagerie.folded .mg-body { display: none; }
body.cine #menagerie, body.cine #menagerie-dock { display: none !important; }
#menagerie .mg-head { display: flex; align-items: baseline; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--frame-iron, #3b3244); }
#menagerie .mg-head h3 { margin: 0; font-family: 'Cinzel', serif; font-size: 15px; letter-spacing: 0.28em; color: var(--frame-gold-hi, #ffd070); }
#menagerie .mg-count { margin-left: auto; font-family: 'Cinzel', serif; font-size: 11px; letter-spacing: 0.12em; color: var(--ink-dim, #a89c86); }
#menagerie .mg-fold { font-family: 'Cinzel', serif; font-size: 10px; letter-spacing: 0.12em; padding: 3px 8px; color: var(--ink, #e8dfcc); background: #17131e; border: 1px solid var(--frame-iron, #3b3244); cursor: pointer; }
#menagerie .mg-fold:hover { border-color: var(--frame-gold, #c8a558); }
#menagerie .mg-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
#menagerie .mg-tools { display: flex; gap: 8px; margin: 8px 0 6px; }
#menagerie .mg-search, #menagerie .mg-source {
  padding: 6px 8px; color: #efe6d2; background: #0f0c14; border: 1px solid #3c3448; font-family: inherit; font-size: 13px; min-width: 0;
}
#menagerie .mg-search { flex: 1; }
#menagerie .mg-source { max-width: 44%; }
#menagerie .mg-shelves { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
#menagerie .mg-shelf {
  font-family: 'Cinzel', serif; font-size: 9.5px; letter-spacing: 0.12em; padding: 4px 8px; cursor: pointer;
  color: var(--ink-dim, #a89c86); background: #120f18; border: 1px solid var(--frame-iron, #3b3244);
}
#menagerie .mg-shelf:hover { color: var(--ink, #e8dfcc); border-color: var(--frame-gold, #c8a558); }
#menagerie .mg-shelf.lit { color: var(--frame-gold-hi, #ffd070); border-color: var(--frame-gold-hi, #ffd070); background: #2a2135; }
#menagerie .mg-shelf i { font-style: normal; opacity: 0.6; margin-left: 4px; }
#menagerie .mg-grid {
  flex: 1; min-height: 0; overflow-y: auto; padding-right: 4px;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px; align-content: start;
}
#menagerie .mg-group { grid-column: 1 / -1; font-family: 'Cinzel', serif; font-size: 10px; letter-spacing: 0.22em; color: var(--ink-dim, #a89c86); margin: 6px 0 0; padding-bottom: 3px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
#menagerie .mg-card {
  position: relative; display: flex; flex-direction: column; align-items: stretch; padding: 0 0 6px; cursor: pointer; text-align: left;
  color: var(--ink, #e8dfcc); border: 1px solid var(--frame-iron, #3b3244);
  background: linear-gradient(180deg, rgba(38, 30, 46, 0.9), rgba(14, 11, 18, 0.95));
}
#menagerie .mg-card:hover { border-color: var(--frame-gold, #c8a558); }
#menagerie .mg-card.lit { border-color: var(--frame-gold-hi, #ffd070); box-shadow: 0 0 10px rgba(200, 165, 88, 0.35), inset 0 0 14px rgba(200, 165, 88, 0.12); }
#menagerie .mg-card.lit::after {
  content: 'ON THE SAND'; position: absolute; top: 4px; right: 4px; font-family: 'Cinzel', serif; font-size: 8px; letter-spacing: 0.1em;
  padding: 1px 4px; color: #1a1208; background: var(--frame-gold-hi, #ffd070);
}
#menagerie .mg-stage {
  position: relative; height: 104px; overflow: hidden; pointer-events: none;
  background: radial-gradient(ellipse at 50% 88%, rgba(200, 165, 88, 0.16), transparent 62%);
  border-bottom: 1px solid var(--frame-iron, #3b3244);
}
#menagerie .mg-card b { display: block; margin: 5px 7px 0; font-family: 'Cinzel', serif; font-size: 10.5px; letter-spacing: 0.06em; color: var(--frame-gold-hi, #ffd070); line-height: 1.2; }
#menagerie .mg-card small { display: block; margin: 1px 7px 0; font-size: 10.5px; font-style: italic; color: var(--ink-dim, #a89c86); line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#menagerie .mg-empty { grid-column: 1 / -1; padding: 30px 10px; text-align: center; font-style: italic; color: var(--ink-dim, #a89c86); }

#menagerie-dock {
  position: fixed; left: calc(14px + min(560px, calc(100vw - 28px)) + 12px); right: 96px; bottom: 112px; z-index: 31;
  display: none; flex-direction: column; gap: 6px;
  padding: 8px 12px; color: var(--ink, #e8dfcc); font-family: 'Crimson Pro', Georgia, serif;
  background: linear-gradient(180deg, rgba(24, 19, 30, 0.95), rgba(10, 8, 13, 0.96));
  border: 1px solid var(--frame-iron, #3b3244); box-shadow: inset 0 0 18px rgba(0, 0, 0, 0.7), 0 6px 18px rgba(0, 0, 0, 0.6);
}
#menagerie-dock.open { display: flex; }
#menagerie-dock .md-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
#menagerie-dock .md-tag { font-family: 'Cinzel', serif; font-size: 9.5px; letter-spacing: 0.18em; color: var(--ink-dim, #a89c86); margin-right: 4px; }
#menagerie-dock .md-chips { max-height: 54px; overflow-y: auto; }
#menagerie-dock button {
  font-family: 'Cinzel', serif; font-size: 10px; letter-spacing: 0.1em; padding: 5px 9px; cursor: pointer;
  color: var(--ink, #e8dfcc); background: linear-gradient(180deg, #221b2c, #0f0c14); border: 1px solid #56304a;
}
#menagerie-dock button:hover:not(:disabled) { border-color: var(--frame-gold, #c8a558); color: var(--frame-gold-hi, #ffd070); }
#menagerie-dock button:disabled { opacity: 0.35; cursor: default; }
#menagerie-dock button.lit { border-color: var(--frame-gold-hi, #ffd070); color: var(--frame-gold-hi, #ffd070); background: #2a2135; }
#menagerie-dock button.chip { padding: 3px 7px; font-size: 9.5px; border-color: var(--frame-iron, #3b3244); }
#menagerie-dock button.chip i { font-style: normal; margin-left: 6px; color: #ff8a7a; }
#menagerie-dock button.leave { border-color: #8a3a34; color: #ff8a7a; margin-left: auto; }
#menagerie-dock .md-hint { font-size: 12px; font-style: italic; color: var(--ink-dim, #a89c86); }
body.input-touch #menagerie { width: min(420px, calc(100vw - 28px)); bottom: 190px; }
body.input-touch #menagerie-dock { bottom: 150px; left: 12px; right: 12px; }
@media (max-width: 1100px) { #menagerie-dock { left: 12px; right: 12px; bottom: 104px; } #menagerie { bottom: 250px; } }
`;

const ACTS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'idle', label: 'IDLE' },
  { id: 'walk', label: 'WALK' },
  { id: 'attack', label: 'ATTACK' },
  { id: 'hit', label: 'HIT' },
  { id: 'death', label: 'DEATH' },
];

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export class MenagerieUI {
  private readonly panel: HTMLElement;
  private readonly dock: HTMLElement;
  private query = '';
  private shelf: CostumeShelf | 'all' = 'all';
  private source = '';
  private folded = false;

  constructor(private readonly hooks: MenagerieHooks) {
    if (!document.getElementById('menagerie-css')) {
      const style = document.createElement('style');
      style.id = 'menagerie-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.panel = document.createElement('div');
    this.panel.id = 'menagerie';
    this.dock = document.createElement('div');
    this.dock.id = 'menagerie-dock';
    document.body.append(this.panel, this.dock);
    // Painted on `open()`, not here: the hooks read tables main declares after
    // this panel is built.
  }

  open(): void {
    this.panel.classList.add('open');
    this.dock.classList.add('open');
    this.paint();
  }

  close(): void {
    this.panel.classList.remove('open');
    this.dock.classList.remove('open');
  }

  get isOpen(): boolean {
    return this.panel.classList.contains('open');
  }

  /** Something changed on the sand (a body added from elsewhere, the bestiary's TRY). */
  refresh(): void {
    if (!this.isOpen) return;
    this.paint();
  }

  destroy(): void {
    this.panel.remove();
    this.dock.remove();
  }

  private paint(): void {
    this.paintPanel();
    this.paintDock();
  }

  private paintPanel(): void {
    const all = this.hooks.costumes();
    const placed = new Set(this.hooks.placed());
    const q = this.query.trim().toLowerCase();
    const keepScroll = this.panel.querySelector<HTMLElement>('.mg-grid')?.scrollTop ?? 0;
    const focusSearch = document.activeElement === this.panel.querySelector('.mg-search');
    const shelfOf = (c: Costume): CostumeShelf => c.shelf ?? 'drop';
    const matches = (c: Costume): boolean =>
      (!q || `${c.label} ${c.id} ${c.source} ${c.kind ?? ''}`.toLowerCase().includes(q)) && (!this.source || c.source.split(' · ')[0] === this.source || c.source === this.source);
    const inShelf = all.filter(matches);
    const counts = new Map<string, number>();
    for (const c of inShelf) counts.set(shelfOf(c), (counts.get(shelfOf(c)) ?? 0) + 1);
    const shown = inShelf.filter((c) => this.shelf === 'all' || shelfOf(c) === this.shelf);
    const sources = [...new Set(all.map((c) => c.source.split(' · ')[0]))].sort((a, b) => a.localeCompare(b));
    const card = (c: Costume): string => {
      const pv = previewHtml({ anim: c.idle, idle: c.idle === c.walk ? undefined : c.idle, walk: c.walk, attack: c.attack, height: Math.min(150, (c.baseHeight ?? 56) * (c.heightMult ?? 1)) * 1.45 }, 118, 104, 8);
      return `<button class="mg-card${placed.has(c.id) ? ' lit' : ''}" data-toggle="${esc(c.id)}" title="${esc(c.label)} · ${esc(c.id)} · ${esc(c.source)}"><div class="mg-stage">${pv}</div><b>${esc(c.label)}</b><small>${esc(c.kind ? `kind ${c.kind}` : c.id)} · ${esc(c.source)}</small></button>`;
    };
    const grid = shown.length
      ? SHELVES.filter((sh) => this.shelf === 'all' || sh.id === this.shelf)
          .map((sh) => {
            const rows = shown.filter((c) => shelfOf(c) === sh.id);
            return rows.length ? `<div class="mg-group">${sh.label} · ${rows.length}</div>${rows.map(card).join('')}` : '';
          })
          .join('')
      : '<div class="mg-empty">Nothing by that name walks here.</div>';
    const chips = [`<button class="mg-shelf${this.shelf === 'all' ? ' lit' : ''}" data-shelf="all">ALL<i>${inShelf.length}</i></button>`]
      .concat(SHELVES.filter((sh) => (counts.get(sh.id) ?? 0) > 0 || this.shelf === sh.id).map((sh) => `<button class="mg-shelf${this.shelf === sh.id ? ' lit' : ''}" data-shelf="${sh.id}">${sh.label}<i>${counts.get(sh.id) ?? 0}</i></button>`))
      .join('');
    this.panel.classList.toggle('folded', this.folded);
    this.panel.innerHTML = `
      <div class="mg-head drag-handle"><h3>THE MENAGERIE</h3><span class="mg-count">${placed.size} ON THE SAND · ${all.length} BODIES</span><button class="mg-fold" data-fold>${this.folded ? 'SHOW ▾' : 'HIDE ▴'}</button></div>
      <div class="mg-body">
        <div class="mg-tools">
          <input class="mg-search" type="search" placeholder="find a body… (name, kind, sheet, pack)" value="${esc(this.query)}">
          <select class="mg-source"><option value="">every source</option>${sources.map((s) => `<option value="${esc(s)}"${s === this.source ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        </div>
        <div class="mg-shelves">${chips}</div>
        <div class="mg-grid">${grid}</div>
      </div>`;
    const gridEl = this.panel.querySelector<HTMLElement>('.mg-grid');
    if (gridEl) gridEl.scrollTop = keepScroll;
    animatePreviews(this.panel);
    const search = this.panel.querySelector<HTMLInputElement>('.mg-search');
    search?.addEventListener('input', () => {
      this.query = search.value;
      const at = search.selectionStart ?? search.value.length;
      this.paintPanel();
      const again = this.panel.querySelector<HTMLInputElement>('.mg-search');
      again?.focus();
      again?.setSelectionRange(at, at);
    });
    // The search box must not steal the game's keys while typing, and vice versa.
    search?.addEventListener('keydown', (e) => e.stopPropagation());
    if (focusSearch) search?.focus();
    const src = this.panel.querySelector<HTMLSelectElement>('.mg-source');
    src?.addEventListener('change', () => {
      this.source = src.value;
      this.paintPanel();
    });
    src?.addEventListener('keydown', (e) => e.stopPropagation());
    this.panel.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
      b.addEventListener('click', () => {
        audio.sfx('uiClick');
        if (b.dataset.toggle !== undefined) {
          this.hooks.toggle(b.dataset.toggle);
          this.paint();
        } else if (b.dataset.shelf !== undefined) {
          this.shelf = b.dataset.shelf as CostumeShelf | 'all';
          this.paintPanel();
          const g = this.panel.querySelector<HTMLElement>('.mg-grid');
          if (g) g.scrollTop = 0;
        } else if ('fold' in b.dataset) {
          this.folded = !this.folded;
          this.paintPanel();
        }
      });
    });
  }

  private paintDock(): void {
    const all = this.hooks.costumes();
    const placed = this.hooks.placed();
    const focused = this.hooks.focused();
    const label = (id: string): string => all.find((c) => c.id === id)?.label ?? id;
    const chips = placed.length
      ? [`<button class="chip${focused === null ? ' lit' : ''}" data-focus="">ALL ${placed.length}</button>`]
          .concat(placed.map((id) => `<button class="chip${focused === id ? ' lit' : ''}" data-focus="${esc(id)}" title="pick ${esc(label(id))}">${esc(label(id))}<i data-remove="${esc(id)}" title="take it off the sand">✕</i></button>`))
          .join('')
      : '<span class="md-hint">Pick a body in the menagerie on the left - it takes its own spot on the sand, facing you.</span>';
    const none = placed.length === 0;
    const acts = ACTS.map((a) => `<button data-act="${a.id}"${none || !this.hooks.hasClip(a.id) ? ' disabled' : ''}>▶ ${a.label}</button>`).join('');
    const extras = this.hooks.extras().map((x) => `<button data-act="${esc(x)}">▶ ${esc(x.toUpperCase())}</button>`).join('');
    const target = focused ? label(focused).toUpperCase() : 'ALL';
    const isKind = !!focused && !!all.find((c) => c.id === focused)?.kind;
    this.dock.innerHTML = `
      <div class="md-row md-chips"><span class="md-tag">ON THE SAND</span>${chips}</div>
      <div class="md-row"><span class="md-tag">${esc(target)}</span>${acts}${extras}
        <button data-rot="1"${none ? ' disabled' : ''} title="turn left">⟲</button><button data-rot="-1"${none ? ' disabled' : ''} title="turn right">⟳</button>
        <button data-face${none ? ' disabled' : ''}>FACE ME</button></div>
      <div class="md-row"><button data-summon${isKind ? '' : ' disabled'} title="three live ones of the picked kind">SUMMON THREE ALIVE</button>
        <button data-clear${none ? ' disabled' : ''}>CLEAR THE SAND</button>
        <button class="leave" data-leave>LEAVE THE SAND</button></div>`;
    this.dock.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
      b.addEventListener('click', (ev) => {
        audio.sfx('uiClick');
        const rm = (ev.target as HTMLElement).closest<HTMLElement>('[data-remove]');
        if (rm?.dataset.remove) {
          this.hooks.toggle(rm.dataset.remove);
          this.paint();
          return;
        }
        if (b.dataset.focus !== undefined) {
          this.hooks.focus(b.dataset.focus === '' ? null : b.dataset.focus);
          this.paintDock();
        } else if (b.dataset.act) this.hooks.act(b.dataset.act);
        else if (b.dataset.rot) this.hooks.rotate(Number(b.dataset.rot));
        else if ('face' in b.dataset) this.hooks.faceCamera();
        else if ('summon' in b.dataset) this.hooks.summon();
        else if ('clear' in b.dataset) {
          this.hooks.clear();
          this.paint();
        } else if ('leave' in b.dataset) this.hooks.leave();
      });
    });
  }
}
