/**
 * @module ui/panelShell
 * THE PANEL SHELL (it.117): one contract every expandable window keeps.
 *
 * Until now each window carried its own copy of four behaviours and got a
 * different subset right. The pack had no ESCAPE. The hero sheet scrolled its
 * own header — title and cross together — off the top of the box, which is
 * the "close X flying off into the stratosphere" the owner kept hitting. The
 * shop's two columns overflowed sideways on a phone and hung a horizontal
 * scrollbar under the goods. And the depth list could only be dismissed with
 * the key that opened it.
 *
 * Four things, then, in one place:
 *
 *   1. ESCAPE CLOSES THE TOP WINDOW. A single capture-phase listener on
 *      `window`, installed when this module is first imported — that is,
 *      before any panel builds its own listener, so it is the first one the
 *      event reaches. It closes exactly ONE window (the one opened last) and
 *      stops the event dead, so the same press can never also pause the run
 *      or fold a second panel behind the first.
 *   2. THE HEADER IS LOCKED. `position: sticky` on every known header class,
 *      with an opaque backing that spans the panel's own padding, so the
 *      title and the cross ride at the top of the box however far the body is
 *      scrolled. No DOM surgery: the panels keep repainting themselves with
 *      `innerHTML` and this keeps working, which is exactly why it is CSS.
 *   3. NO HORIZONTAL SCROLLBAR, EVER. `overflow-x: hidden` on the windows,
 *      `min-width: 0` on the grid and flex children that were causing the
 *      spill, and the column grids fold to one column on a narrow screen so
 *      nothing is clipped instead of scrolled.
 *   4. IT FITS THE PHONE. A narrow screen re-widths the windows to a share of
 *      the viewport before `ui/FitScaler` ever has to shrink them, so the
 *      text stays at its designed size instead of being scaled into mist.
 *
 * WHY A REGISTRY AND NOT A BASE CLASS: three of the windows (the pack, the
 * forbidden arts, the shop family) belong to other hands this iteration. A
 * registration call is a thing they can adopt in one line without a rewrite,
 * and the CSS above reaches them whether they adopt it or not.
 */

import { fit, type FitOptions } from './FitScaler';

export interface PanelSpec {
  /** A stable key; also what `markPanelOpen` is called with. */
  id: string;
  /** The window, or the element id when the window is built later in the run. */
  el: HTMLElement | string;
  /** Is it on screen right now? */
  isOpen: () => boolean;
  /** Put it away. Called by ESCAPE; must be safe to call when already closed. */
  close: () => void;
  /** Register with the contain-fitter too (default: yes). */
  fit?: FitOptions | false;
}

interface Entry extends PanelSpec {
  /** `performance.now()` of the last open, so ESCAPE can pick the top window. */
  openedAt: number;
  wasOpen: boolean;
}

const entries = new Map<string, Entry>();

function elementOf(e: Entry): HTMLElement | null {
  return typeof e.el === 'string' ? document.getElementById(e.el) : e.el;
}

/** Open windows, newest first. */
function openPanels(): Entry[] {
  const out: Entry[] = [];
  for (const e of entries.values()) {
    if (!elementOf(e)) continue;
    let open = false;
    try {
      open = e.isOpen();
    } catch {
      open = false; // A window torn down mid-run must never break the key.
    }
    if (open) out.push(e);
  }
  return out.sort((a, b) => b.openedAt - a.openedAt);
}

/**
 * THE STAMP. ESCAPE has to close the window the player opened LAST, not a
 * random one, and the only signal every panel shares is its own `isOpen`.
 * A cheap poll watches for the false→true edge; `markPanelOpen` lets a panel
 * that knows the moment exactly say so, for the case where a second window
 * opens inside the same poll window as the first.
 */
export function markPanelOpen(id: string): void {
  const e = entries.get(id);
  if (!e) return;
  e.openedAt = performance.now();
  e.wasOpen = true;
}

function pollOpenState(): void {
  for (const e of entries.values()) {
    let open = false;
    try {
      open = !!elementOf(e) && e.isOpen();
    } catch {
      open = false;
    }
    if (open && !e.wasOpen) e.openedAt = performance.now();
    e.wasOpen = open;
  }
}

/** Register a window. Returns a disposer (call it in the panel's `destroy`). */
export function registerPanel(spec: PanelSpec): () => void {
  const entry: Entry = { ...spec, openedAt: 0, wasOpen: false };
  entries.set(spec.id, entry);
  const el = elementOf(entry);
  if (el) {
    el.classList.add('ps-panel');
    if (spec.fit !== false) {
      if (typeof spec.el === 'string') fit.addById(spec.el, spec.fit ?? {});
      else fit.add(el, spec.fit ?? {});
    }
  } else if (typeof spec.el === 'string' && spec.fit !== false) {
    fit.addById(spec.el, spec.fit ?? {});
  }
  return () => {
    if (entries.get(spec.id) === entry) entries.delete(spec.id);
  };
}

/** Is ANY registered window on screen? (main reads this to hold the world still.) */
export function anyPanelOpen(): boolean {
  return openPanels().length > 0;
}

/** Close every registered window (a floor change, a death, the pause sheet). */
export function closeAllPanels(): void {
  for (const e of openPanels()) {
    try {
      e.close();
    } catch {
      /* a window torn down under us */
    }
  }
}

/**
 * A field has the keys: the chat line, the cheat console, the lobby's name
 * box. ESCAPE belongs to whoever is typing, and they blur themselves.
 */
function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

let installed = false;
let poll = 0;

function install(): void {
  if (installed) return;
  installed = true;
  // CAPTURE, ON `window`, AT IMPORT TIME. Capture runs window → document →
  // element, and listeners on the same target fire in registration order, so
  // being the first window-capture listener in the process makes this the
  // first handler ESCAPE reaches — ahead of every panel's own and ahead of
  // the pause sheet's.
  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || e.repeat || typing()) return;
      const [top] = openPanels();
      if (!top) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      top.wasOpen = false;
      try {
        top.close();
      } catch {
        /* torn down mid-press */
      }
    },
    { capture: true },
  );
  poll = window.setInterval(pollOpenState, 120);
  injectCss();
}


/** Test teardown only — the shell lives for the life of the document. */
export function resetPanelShell(): void {
  entries.clear();
  if (poll) window.clearInterval(poll);
  poll = 0;
}

/* ------------------------------------------------------------------ */

/**
 * Every header class in the game, and every window that owns one. Named as
 * literals rather than imported, so this module stays a leaf: a panel does
 * not have to know the shell exists for the shell to keep its header locked.
 */
const HEADS =
  '.tp-head, .cs-head, .st-head, .bs-head, .mg-head, .cheat-head, .insp-head, .set-head, .lvl-head, .cx-head, #inv-panel > h3, .ps-head';
const PANELS =
  '.town-panel, #char-sheet, #skill-tree, #bestiary, #codex, #cheat-menu, #inv-panel, #level-select, #settings-panel, #leaderboard, #menagerie, #notice-board, #shop-panel, #stash-panel, #craft-panel, #inspect-panel, .ps-panel';

const CSS = `
/* --- 2. THE HEADER IS LOCKED (it.117) ------------------------------- */
${HEADS.split(', ').map((h) => `${h}`).join(', ')} {
  position: sticky;
  top: 0;
  z-index: 9;
  flex: 0 0 auto;
}
${HEADS.split(', ').map((h) => `${h}::after`).join(', ')} {
  /* The backing: opaque, and wider than the header so the window's own side
     padding cannot show a stripe of scrolling content past its edges. */
  content: '';
  position: absolute;
  inset: -14px -24px 0;
  background: var(--panel-bg, #14101b);
  z-index: -1;
  pointer-events: none;
}
/* A header that is a grid or flex row must not let the backing take a cell. */
.cheat-head::after { inset: -12px -18px 0; }

/* --- 3. NO HORIZONTAL SCROLLBAR, EVER ------------------------------- */
${PANELS} {
  overflow-x: hidden !important;
  overscroll-behavior: contain;
  max-width: 100vw;
}
${PANELS.split(', ').map((p) => `${p} img, ${p} canvas, ${p} p, ${p} pre`).join(', ')} {
  max-width: 100%;
}
/* The spill came from grid and flex children refusing to shrink past their
   content. 'min-width: 0' is the whole fix; the rest is the fold below. */
.tp-cols, .bs-body, .st-cols, .cs-grid, .cx-body, .cheat-body, .mg-body,
.tp-list, .bs-list, .st-col, .cx-col, .inv-pack-grid {
  min-width: 0;
}
.tp-list, .bs-list, .st-cols, .cx-list, .cx-body { overflow-x: hidden; }
/* A long unbroken name (an item, a peer's nickname) is the other spiller. */
.tp-name, .bs-row-name, .cs-row span, .cx-shape b, .toast-sub { overflow-wrap: anywhere; }

/* Vertical bars, where they are needed, look like the frame rather than the OS. */
${PANELS.split(', ').map((p) => `${p} ::-webkit-scrollbar`).join(', ')},
${PANELS.split(', ').map((p) => `${p}::-webkit-scrollbar`).join(', ')} { width: 8px; height: 0; }
${PANELS.split(', ').map((p) => `${p} ::-webkit-scrollbar-thumb`).join(', ')},
${PANELS.split(', ').map((p) => `${p}::-webkit-scrollbar-thumb`).join(', ')} {
  background: linear-gradient(180deg, #5a4a30, #2a2230);
  border: 1px solid #0b0910;
}
${PANELS.split(', ').map((p) => `${p} ::-webkit-scrollbar-track`).join(', ')},
${PANELS.split(', ').map((p) => `${p}::-webkit-scrollbar-track`).join(', ')} { background: rgba(0, 0, 0, 0.35); }

/* --- 4. IT FITS THE PHONE ------------------------------------------- */
body.tier-micro .town-panel,
body.tier-compact .town-panel { width: min(640px, 96vw); max-height: 86vh; }
body.tier-micro #char-sheet,
body.tier-compact #char-sheet { width: min(520px, 96vw); max-height: 86vh; }
body.tier-micro #bestiary,
body.tier-compact #bestiary { width: min(880px, 96vw); max-height: 86vh; }
body.tier-micro #skill-tree,
body.tier-compact #skill-tree { width: min(1180px, 96vw); max-height: 86vh; }
/* Two- and four-column bodies fold to one on a narrow screen; a column that
   has to be scaled to a quarter of its size is not a column, it is a smear. */
body.tier-micro .tp-cols,
body.tier-compact .tp-cols { grid-template-columns: minmax(0, 1fr); }
body.tier-micro .bs-body,
body.tier-compact .bs-body { grid-template-columns: minmax(0, 1fr); }
body.tier-micro .cs-grid,
body.tier-compact .cs-grid { grid-template-columns: minmax(0, 1fr); }
body.tier-micro .bs-list,
body.tier-compact .bs-list { max-height: 30vh; }
/* A short landscape phone: the window is wide and the body is what must give. */
body.tiny-height .bs-list { max-height: 34vh; }
body.tiny-height .tp-list { max-height: 34vh; }

/* A window is never taller than the glass, whatever its own CSS asked for. */
${PANELS.split(', ').map((p) => `body.input-touch ${p}`).join(', ')} { max-height: 88vh; }
`;

function injectCss(): void {
  if (document.getElementById('panel-shell-css')) return;
  const style = document.createElement('style');
  style.id = 'panel-shell-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

/**
 * AT IMPORT, NOT AT FIRST REGISTRATION. The first cut installed lazily from
 * `registerPanel`, which runs deep inside a run build — by then every panel
 * had already added its OWN capture-phase ESCAPE listener, those fired first
 * and stopped the event, and the shell never saw a single press. A module's
 * body runs during the import phase, before any constructor, so this is the
 * first window-capture keydown listener in the process. Order is the feature.
 */
install();
