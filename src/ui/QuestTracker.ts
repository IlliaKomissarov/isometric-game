/**
 * @module ui/QuestTracker
 * THE TRACKER (it.117): what you are doing, on the left, under the health.
 *
 * The run has always KEPT a quest ledger (`quests` in main) and always
 * ANNOUNCED its changes (a notice when one turns over), but between those two
 * moments it said nothing at all: a player who stepped away for a minute had
 * no way back to "what was I doing?" short of walking the town until someone
 * spoke to them. Every ARPG worth the name carries a standing objective in
 * the corner of the screen. This is that corner.
 *
 * WHERE THE KNOWLEDGE LIVES. `trackedFrom` turns a ledger snapshot into the
 * lines to show, so the whole quest chain is described HERE, in one table,
 * rather than smeared through the eight thousand lines that set the flags.
 * main hands over the ledger, the floor and the live counts; nothing else.
 *
 * IT SITS IN THE TOP-LEFT COLUMN (`#hud-tl`), the flex stack the status plate
 * already owns, so it can never overlap the plate at any HUD scale — the
 * column measures instead of guessing. Empty means gone: no quests, no box.
 * A tap on the header folds it to its title bar and the choice is remembered.
 */

export interface TrackedQuest {
  /** The ledger key. */
  id: string;
  /** THE FOREST ERRAND, THE EASTERN QUARTER … */
  title: string;
  /** What to do next, in one line. */
  objective: string;
  /** A count, when the objective is a count. */
  progress?: { have: number; need: number };
  /** Freshly completed: shown struck through for a beat before it leaves. */
  done?: boolean;
}

/** What main knows and the table needs. */
export interface QuestLedgerView {
  quests: Record<string, string>;
  floor: number;
  /** Live tallies for the counted objectives, when the hero stands on that floor. */
  counts?: { alive?: number; total?: number };
}

const FOREST_FLOOR = 101;
const INN_FLOOR = 103;
const CELLAR_FLOOR = 104;
const FARM_FLOOR = 105;
const RIVER_FLOOR = 106;
const FIELD_FLOOR = 107;
const MANOR_FLOOR = 108;

/** The looters the eastern quarter asks for (main's `tickEastQuest` counts to this). */
const LOOTERS_NEEDED = 6;

/**
 * THE CHAIN, ONE TABLE. Each entry answers: given this ledger state, what is
 * the hero's next move? A state with no answer (a quest not yet taken, or one
 * paid out and closed) returns null and the line simply is not there.
 */
export function trackedFrom(view: QuestLedgerView): TrackedQuest[] {
  const q = view.quests;
  const out: TrackedQuest[] = [];
  const here = view.floor;
  const counted = (): { have: number; need: number } | undefined => {
    const total = view.counts?.total ?? 0;
    if (!total) return undefined;
    const alive = view.counts?.alive ?? 0;
    return { have: Math.max(0, total - alive), need: total };
  };

  // THE FOREST ERRAND (it.87).
  if (q.forest === 'active') {
    out.push({
      id: 'forest',
      title: 'THE FOREST ERRAND',
      objective: here === FOREST_FLOOR ? 'Clear the woods of what walks them' : 'Take the east road to the woods',
      progress: here === FOREST_FLOOR ? counted() : undefined,
    });
  }

  // THE EASTERN QUARTER (it.91): the looters, then the tavern for the purse.
  if (q.east === 'open') {
    const killed = Math.max(0, Number(q.looters ?? 0) | 0);
    out.push({
      id: 'east',
      title: 'THE EASTERN QUARTER',
      objective: here === 0 ? 'Put the looters out of the quarter' : 'Return to town, through the east gate',
      progress: { have: Math.min(killed, LOOTERS_NEEDED), need: LOOTERS_NEEDED },
    });
  } else if (q.east === 'cleared') {
    out.push({
      id: 'east',
      title: 'THE EASTERN QUARTER',
      objective: here === INN_FLOOR ? 'Speak to Coleslaw — your purse is waiting' : 'Claim the purse at the Gilded Stag',
    });
  }

  // THE CELLAR (it.97).
  if (q.cellar === 'active') {
    out.push({
      id: 'cellar',
      title: 'THE CELLAR',
      objective: here === CELLAR_FLOOR ? 'Find the girl in the dark and bring her up' : 'The back door of the Gilded Stag is unbolted',
    });
  }

  // THE FARMLANDS (it.100): the muster, then the field.
  if (q.farm === 'active') {
    out.push({
      id: 'farm',
      title: 'THE FARMLANDS',
      objective: here === FARM_FLOOR ? 'Break the company holding the field' : 'March south, past the old quarter, to the muster',
      progress: here === FARM_FLOOR ? counted() : undefined,
    });
  }

  // THE RIVERSIDE (it.106).
  if (q.river === 'active') {
    out.push({
      id: 'river',
      title: 'THE RIVERSIDE',
      objective: here === RIVER_FLOOR ? 'Clear the riverside farm' : 'Through the river gate, west of the ward',
    });
  }

  // THE MANOR (it.110): heard from the field, then held, then the merchant out.
  if (q.manor === 'heard' || q.manor === 'held') {
    out.push({
      id: 'manor',
      title: 'THE MANOR',
      objective:
        here === MANOR_FLOOR
          ? q.manor === 'held'
            ? 'Find what is shut in the hall'
            : 'Search the hall'
          : here === FIELD_FLOOR
            ? 'The hall stands in the middle of the field'
            : 'Cross the battlefield to the hall',
    });
  }

  // OSCAR'S SEAL (it.110): a held token, not a quest — but it is the thing
  // standing between the hero and the bridge, so it earns a line.
  if (q.riverPass === 'held' && q.manor !== 'done') {
    out.push({ id: 'riverPass', title: "OSCAR'S SEAL", objective: 'The bridge will let you through' });
  }

  return out;
}

const CSS = `
#quest-track {
  width: calc(268px * var(--tl-scale, 1));
  box-sizing: border-box;
  margin-top: calc(6px * var(--tl-scale, 1));
  padding: 0;
  font-family: 'Crimson Pro', Georgia, serif;
  color: #d9cfbb;
  background: linear-gradient(180deg, rgba(22, 18, 28, 0.9), rgba(10, 8, 13, 0.92));
  border: 1px solid #3b3244;
  box-shadow: inset 0 0 0 1px rgba(200, 165, 88, 0.14), 0 4px 18px rgba(0, 0, 0, 0.6);
  pointer-events: auto;
  transition: opacity 0.4s ease;
}
#quest-track.empty { display: none; }
#quest-track .qt-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  padding: calc(4px * var(--tl-scale, 1)) calc(8px * var(--tl-scale, 1));
  background: rgba(0, 0, 0, 0.35);
  border: 0;
  border-bottom: 1px solid #3b3244;
  color: #c8a558;
  font-family: 'Cinzel', serif;
  font-size: calc(9.5px * var(--tl-scale, 1));
  letter-spacing: 0.22em;
  text-align: left;
  cursor: pointer;
}
#quest-track .qt-head b { flex: 1; font-weight: 700; }
#quest-track .qt-head i { font-style: normal; color: #7d7466; font-size: calc(9px * var(--tl-scale, 1)); }
#quest-track.folded .qt-body { display: none; }
#quest-track .qt-body { padding: calc(5px * var(--tl-scale, 1)) calc(8px * var(--tl-scale, 1)) calc(6px * var(--tl-scale, 1)); }
#quest-track .qt-item + .qt-item { margin-top: calc(6px * var(--tl-scale, 1)); padding-top: calc(5px * var(--tl-scale, 1)); border-top: 1px solid rgba(59, 50, 68, 0.7); }
#quest-track .qt-title {
  display: block;
  font-family: 'Cinzel', serif;
  font-size: calc(9.5px * var(--tl-scale, 1));
  letter-spacing: 0.14em;
  color: #ffd070;
  text-shadow: 0 1px 2px #000;
}
#quest-track .qt-obj {
  display: block;
  font-size: calc(12.5px * var(--tl-scale, 1));
  line-height: 1.25;
  color: #cfc5b1;
  text-shadow: 0 1px 2px #000;
}
#quest-track .qt-obj::before { content: '◆ '; color: #6f6450; }
#quest-track .qt-prog {
  display: block;
  margin-top: calc(2px * var(--tl-scale, 1));
  font-family: 'Cinzel', serif;
  font-size: calc(9.5px * var(--tl-scale, 1));
  letter-spacing: 0.12em;
  color: #a9c8ef;
}
#quest-track .qt-bar { display: block; height: 2px; margin-top: 2px; background: rgba(0, 0, 0, 0.6); border: 1px solid #2a2230; }
#quest-track .qt-bar i { display: block; height: 100%; background: linear-gradient(90deg, #8fb8ff, #a9c8ef); }
body.cine #quest-track, body:not(.in-run) #quest-track { display: none; }
/* THE COUNT IS SAID ONCE (it.117): the it.88 tally line and the tracker's own
   bar are the same number, so the older line stands down while the bar is up.
   It stays in the DOM, and keeps its class, because the harness reads it. */
#hud-tl:has(#quest-track.has-prog) #quest-hud { display: none !important; }
/* A short landscape phone has no room for prose: the objective gets one line. */
body.tiny-height #quest-track .qt-obj,
body.tier-micro #quest-track .qt-obj { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
body.tier-micro #quest-track { width: calc(210px * var(--tl-scale, 1)); }
`;

export class QuestTrackerUI {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private folded = false;
  private last = '';
  private readonly abort = new AbortController();

  constructor(private readonly source: () => TrackedQuest[]) {
    if (!document.getElementById('quest-track-css')) {
      const style = document.createElement('style');
      style.id = 'quest-track-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.id = 'quest-track';
    this.root.className = 'hud-el empty';
    this.root.innerHTML =
      '<button type="button" class="qt-head" aria-expanded="true"><b>OBJECTIVES</b><i class="qt-count"></i><span class="qt-fold">▾</span></button>' +
      '<div class="qt-body"></div>';
    this.body = this.root.querySelector('.qt-body') as HTMLElement;
    this.count = this.root.querySelector('.qt-count') as HTMLElement;
    // DIRECTLY UNDER THE PLATE (it.117). The corner is a flex column owned by
    // the status frame, so the tracker is inserted straight after the plate
    // rather than appended — the depth plaque, the run clock and the buff row
    // join the column later and would otherwise sit between the two.
    const stack = document.getElementById('hud-tl');
    const plate = document.getElementById('status-frame');
    if (stack && plate && plate.parentElement === stack) stack.insertBefore(this.root, plate.nextSibling);
    else (stack ?? document.body).appendChild(this.root);
    try {
      this.folded = localStorage.getItem('iso-arpg-quest-folded') === '1';
    } catch {
      /* storage unavailable */
    }
    this.root.classList.toggle('folded', this.folded);
    this.root.querySelector('.qt-head')?.addEventListener(
      'click',
      () => {
        this.folded = !this.folded;
        this.root.classList.toggle('folded', this.folded);
        this.root.querySelector('.qt-head')?.setAttribute('aria-expanded', String(!this.folded));
        const mark = this.root.querySelector('.qt-fold');
        if (mark) mark.textContent = this.folded ? '▸' : '▾';
        try {
          localStorage.setItem('iso-arpg-quest-folded', this.folded ? '1' : '0');
        } catch {
          /* ignore */
        }
      },
      { signal: this.abort.signal },
    );
    const mark = this.root.querySelector('.qt-fold');
    if (mark) mark.textContent = this.folded ? '▸' : '▾';
  }

  /**
   * Called from the frame loop. It costs a string build and one comparison;
   * the DOM is only touched when the text actually changed, which is what
   * lets it run every frame without a repaint storm.
   */
  update(): void {
    const list = this.source();
    const key = list.map((t) => `${t.id}|${t.objective}|${t.progress?.have ?? ''}/${t.progress?.need ?? ''}`).join('~');
    if (key === this.last) return;
    this.last = key;
    this.root.classList.toggle('empty', list.length === 0);
    if (!list.length) {
      this.body.textContent = '';
      this.count.textContent = '';
      return;
    }
    this.count.textContent = list.length > 1 ? `${list.length}` : '';
    this.root.classList.toggle('has-prog', list.some((t) => !!t.progress));
    this.body.innerHTML = list
      .map((t) => {
        const p = t.progress;
        const pct = p && p.need > 0 ? Math.min(100, Math.round((p.have / p.need) * 100)) : 0;
        return (
          `<div class="qt-item">` +
          `<span class="qt-title">${esc(t.title)}</span>` +
          `<span class="qt-obj">${esc(t.objective)}</span>` +
          (p ? `<span class="qt-prog">${p.have} / ${p.need}</span><span class="qt-bar"><i style="width:${pct}%"></i></span>` : '') +
          `</div>`
        );
      })
      .join('');
  }

  destroy(): void {
    this.abort.abort();
    this.root.remove();
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
