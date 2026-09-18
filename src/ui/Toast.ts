/**
 * @module ui/Toast
 * THE NOTICES (it.114). One queue for every transient line the game has to
 * say: a reward, a quest turning over, a gate opening, a recipe learned, a
 * warning. Until now those were nine separate DOM elements with nine
 * separate timers (`#reward-note`, `#boss-note`, `#hint-banner`, ...), each
 * with its own idea of how long a person needs to read a sentence; the owner's
 * complaint was that they all vanished before they could be read.
 *
 * A notice STACKS (up to four, newest at the bottom), STAYS for a length that
 * scales with its text (`readTime`), never shorter than 5 s, and can be
 * dismissed by clicking it. Kinds only change the rim colour and the glyph.
 *
 * Render-side only: nothing in the simulation reads it. The stylesheet is
 * injected here so the module is self-contained; `body.cine` hides the stack
 * like every other head-up element.
 */

export type ToastKind = 'info' | 'reward' | 'quest' | 'gate' | 'warn' | 'lore';

export interface ToastSpec {
  title: string;
  /** A second, smaller line. */
  sub?: string;
  kind?: ToastKind;
  /** Milliseconds on screen; defaults to `readTime(title + sub)`. */
  ms?: number;
  /** An icon: ready HTML (an <img>) or a single glyph. */
  icon?: string;
  /** Replace a notice with the same key instead of stacking a second. */
  key?: string;
}

/**
 * COMPACT, AND SKIPPABLE (it.117). The it.114 notice was a 520 px slab that
 * stacked four deep, held for up to fourteen seconds and could only be got
 * rid of by hitting it — which on a 412 px phone meant a quest turning over
 * took most of the lower screen and stayed there through the next fight. It
 * is now a 380 px strip, three deep, five and a half seconds at the outside,
 * with a visible cross; ESCAPE clears the whole stack at once, and a tap
 * anywhere on a notice clears that one.
 */
const MAX_STACK = 3;
const MIN_MS = 2600;
const MAX_MS = 5500;

/** How long a line needs on screen: a quick reader, plus a beat to notice it. */
export function readTime(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_MS, Math.min(MAX_MS, 1400 + words * 190));
}

const GLYPH: Record<ToastKind, string> = {
  info: '✦',
  reward: '◆',
  quest: '❖',
  gate: '⛨',
  warn: '⚠',
  lore: '❧',
};

const CSS = `
#toast-stack {
  position: fixed;
  left: 50%;
  bottom: calc(118px + var(--hud-inset, 0px));
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 58;
  pointer-events: none;
  width: min(380px, calc(100vw - 32px));
}
body.input-touch #toast-stack { bottom: calc(150px + var(--hud-inset, 0px)); }
body.cine #toast-stack, body:not(.in-run) #toast-stack { display: none; }
.toast {
  pointer-events: auto;
  cursor: pointer;
  display: grid;
  grid-template-columns: 26px 1fr 14px;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px 6px 8px;
  color: #efe6d2;
  background: linear-gradient(180deg, rgba(24, 19, 30, 0.96), rgba(10, 8, 13, 0.96));
  border: 1px solid #5a4a30;
  box-shadow: inset 0 0 18px rgba(0, 0, 0, 0.7), 0 6px 22px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.6);
  opacity: 0;
  transform: translateY(12px) scale(0.98);
  transition: opacity 0.28s ease, transform 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  will-change: opacity, transform;
}
.toast.show { opacity: 1; transform: translateY(0) scale(1); }
.toast.hide { opacity: 0; transform: translateY(-8px) scale(0.98); transition-duration: 0.45s; }
.toast::before, .toast::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 7px;
  height: 7px;
  margin-top: -3.5px;
  background: #c8a558;
  transform: rotate(45deg);
  box-shadow: 0 0 8px rgba(200, 165, 88, 0.6);
}
.toast::before { left: -4px; }
.toast::after { right: -4px; }
.toast { position: relative; }
.toast-glyph {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid rgba(200, 165, 88, 0.45);
  background: radial-gradient(circle at 50% 35%, rgba(200, 165, 88, 0.22), rgba(0, 0, 0, 0.2) 70%);
  color: #ffd070;
  font-size: 13px;
  overflow: hidden;
}
.toast-glyph img { width: 20px; height: 20px; object-fit: contain; image-rendering: pixelated; }
.toast-title {
  font-family: 'Cinzel', serif;
  font-size: 10.5px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: #ffd070;
  text-shadow: 0 1px 2px #000, 0 0 10px rgba(200, 165, 88, 0.25);
}
.toast-sub {
  font-family: 'Crimson Pro', Georgia, serif;
  font-size: 12.5px;
  line-height: 1.2;
  color: #d9cfbb;
  margin-top: 1px;
  /* Two lines at the outside: a notice is a headline, not a page (it.117). */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* THE CROSS (it.117): the notice always SHOWS that it can be got rid of. */
.toast-x {
  align-self: start;
  font-family: 'Cinzel', serif;
  font-size: 11px;
  line-height: 1;
  color: #6f6450;
  text-align: right;
}
.toast:hover .toast-x { color: #ffd070; }
.toast-bar {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 2px;
  background: linear-gradient(90deg, rgba(200, 165, 88, 0.85), rgba(200, 165, 88, 0.2));
  transform-origin: left center;
  animation: toast-drain linear forwards;
}
@keyframes toast-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.toast.k-reward { border-color: #8a6a2c; }
.toast.k-reward .toast-glyph { color: #ffe08a; }
.toast.k-quest { border-color: #4f6a8a; }
.toast.k-quest .toast-title { color: #a9c8ef; }
.toast.k-quest .toast-glyph { color: #a9c8ef; border-color: rgba(120, 160, 220, 0.5); }
.toast.k-gate { border-color: #5f7a4a; }
.toast.k-gate .toast-title { color: #cfe6a9; }
.toast.k-gate .toast-glyph { color: #cfe6a9; border-color: rgba(150, 200, 110, 0.5); }
.toast.k-warn { border-color: #8a3a34; }
.toast.k-warn .toast-title { color: #ff8a7a; }
.toast.k-warn .toast-glyph { color: #ff8a7a; border-color: rgba(220, 90, 80, 0.6); }
.toast.k-warn::before, .toast.k-warn::after { background: #c8443a; box-shadow: 0 0 8px rgba(200, 68, 58, 0.6); }
.toast.k-lore { border-color: #5a4a6a; }
.toast.k-lore .toast-title { color: #d8c8f0; }
body.tier-micro .toast, body.tier-compact .toast { padding: 5px 8px 5px 6px; grid-template-columns: 22px 1fr 12px; gap: 6px; }
body.tier-micro .toast-title, body.tier-compact .toast-title { font-size: 9.5px; letter-spacing: 0.1em; }
body.tier-micro .toast-sub, body.tier-compact .toast-sub { font-size: 11.5px; -webkit-line-clamp: 2; }
body.tier-micro .toast-glyph, body.tier-compact .toast-glyph { width: 22px; height: 22px; font-size: 11px; }
body.tier-micro #toast-stack, body.tier-compact #toast-stack { width: min(300px, calc(100vw - 24px)); gap: 5px; }
/* THE WORD AND THE LESSON COME FIRST (it.115/it.117): a notice is held while
   either is up, and hidden outright if one opens while it is on screen. */
body.dialogue-open #toast-stack, body.tutorial-on #toast-stack { opacity: 0; pointer-events: none; }
`;

/**
 * THE WORD HAS THE FLOOR (it.115). `ui/Dialogue` puts this class on the body
 * while its panel is up and fires this event on `document` when it closes.
 * Named here as literals so the notices do not import the dialogue.
 */
const DIALOGUE_OPEN_CLASS = 'dialogue-open';
const DIALOGUE_CLOSED_EVENT = 'dialogue:closed';
const FLUSH_POLL_MS = 300;

/**
 * WHO ELSE HAS THE FLOOR (it.115): a cutscene (`body.cine`, where the stack
 * is hidden and a notice would expire unseen) and the corner speech box
 * (`#cine-speak.show`, which sits where the stack stands on a narrow screen)
 * hold the notices exactly as the dialogue does.
 */
function floorTaken(): boolean {
  const b = document.body.classList;
  // ...and the training ground's cards (it.116), which a notice would land on top of.
  return b.contains(DIALOGUE_OPEN_CLASS) || b.contains('cine') || b.contains('tutorial-on') || !!document.querySelector('#cine-speak.show');
}

export class ToastUI {
  private readonly root: HTMLElement;
  private readonly live = new Map<HTMLElement, number>();
  /**
   * HELD WHILE SOMEBODY IS TALKING (it.115). A quest that completes inside a
   * conversation used to drop "QUEST COMPLETE" straight over the speaker's
   * lines. A notice raised while `floorTaken()` waits here and is shown when
   * the panel closes (or the scene ends) - on the close event, or on the poll.
   */
  private readonly held: ToastSpec[] = [];
  /**
   * A beat after the close, not on it: a conversation of several pages closes
   * one panel and opens the next in a microtask, and a flush on the event
   * itself would slip the notices in under the next page. By the time this
   * runs the class is back on if there is more talking to do.
   */
  private readonly onClosed = (): void => {
    window.setTimeout(() => this.flush(), 80);
  };
  private readonly poll: number;
  /**
   * ESCAPE CLEARS THE STACK (it.117). Capture phase, so it beats the pause
   * sheet's own ESCAPE — but only when there is something to clear, and only
   * after `ui/panelShell` has had its turn (a window on screen owns the key).
   * A notice that cannot be skipped is not a notice, it is an obstacle.
   */
  private readonly onKey = (e: KeyboardEvent): void => {
    // The system bar opens the pause sheet by DISPATCHING an Escape; that one
    // is synthetic and must reach the sheet, not stop here at the notices.
    if (e.code !== 'Escape' || e.repeat || !e.isTrusted) return;
    if (!this.live.size && !this.held.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.clear();
  };

  constructor() {
    if (!document.getElementById('toast-css')) {
      const style = document.createElement('style');
      style.id = 'toast-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.id = 'toast-stack';
    document.body.appendChild(this.root);
    document.addEventListener(DIALOGUE_CLOSED_EVENT, this.onClosed);
    window.addEventListener('keydown', this.onKey, { capture: true });
    this.poll = window.setInterval(() => this.flush(), FLUSH_POLL_MS);
  }

  /** How many notices wait for the dialogue to close (it.115). */
  get pending(): number {
    return this.held.length;
  }

  /** The held notices go up, oldest first, once nobody is talking. */
  private flush(): void {
    if (!this.held.length || floorTaken()) return;
    const batch = this.held.splice(0, this.held.length);
    for (const spec of batch) this.show(spec);
  }

  show(spec: ToastSpec): HTMLElement | null {
    if (floorTaken()) {
      // A keyed notice replaces its held twin, exactly as it would on screen.
      if (spec.key) {
        const i = this.held.findIndex((h) => h.key === spec.key);
        if (i >= 0) this.held.splice(i, 1);
      }
      this.held.push(spec);
      return null;
    }
    const kind = spec.kind ?? 'info';
    const ms = spec.ms ?? readTime(`${spec.title} ${spec.sub ?? ''}`);
    if (spec.key) {
      for (const el of this.live.keys()) if (el.dataset.key === spec.key) this.dismiss(el, true);
    }
    while (this.live.size >= MAX_STACK) {
      const oldest = this.live.keys().next().value;
      if (!oldest) break;
      this.dismiss(oldest, true);
    }
    const el = document.createElement('div');
    el.className = `toast k-${kind}`;
    if (spec.key) el.dataset.key = spec.key;
    const icon = spec.icon ? (spec.icon.startsWith('<') ? spec.icon : `<span>${spec.icon}</span>`) : `<span>${GLYPH[kind]}</span>`;
    el.innerHTML =
      `<div class="toast-glyph">${icon}</div>` +
      `<div><div class="toast-title">${escapeHtml(spec.title)}</div>${spec.sub ? `<div class="toast-sub">${escapeHtml(spec.sub)}</div>` : ''}</div>` +
      `<div class="toast-x" aria-hidden="true">&#10005;</div>` +
      `<i class="toast-bar" style="animation-duration:${ms}ms"></i>`;
    el.addEventListener('click', () => this.dismiss(el));
    this.root.appendChild(el);
    // Two frames so the entrance transition runs from the hidden state.
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    const timer = window.setTimeout(() => this.dismiss(el), ms);
    this.live.set(el, timer);
    return el;
  }

  dismiss(el: HTMLElement, fast = false): void {
    const timer = this.live.get(el);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.live.delete(el);
    el.classList.remove('show');
    el.classList.add('hide');
    window.setTimeout(() => el.remove(), fast ? 120 : 460);
  }

  clear(): void {
    this.held.length = 0;
    for (const el of [...this.live.keys()]) this.dismiss(el, true);
  }

  destroy(): void {
    document.removeEventListener(DIALOGUE_CLOSED_EVENT, this.onClosed);
    window.removeEventListener('keydown', this.onKey, { capture: true } as EventListenerOptions);
    window.clearInterval(this.poll);
    this.held.length = 0;
    for (const t of this.live.values()) window.clearTimeout(t);
    this.live.clear();
    this.root.remove();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
