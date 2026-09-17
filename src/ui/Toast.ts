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

const MAX_STACK = 4;
const MIN_MS = 5000;
const MAX_MS = 14000;

/** How long a line needs on screen: a slow reader at ~180 words a minute, plus a beat to notice it. */
export function readTime(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_MS, Math.min(MAX_MS, 1800 + words * 340));
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
  width: min(520px, calc(100vw - 32px));
}
body.input-touch #toast-stack { bottom: calc(150px + var(--hud-inset, 0px)); }
body.cine #toast-stack, body:not(.in-run) #toast-stack { display: none; }
.toast {
  pointer-events: auto;
  cursor: pointer;
  display: grid;
  grid-template-columns: 34px 1fr;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 16px 9px 12px;
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
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid rgba(200, 165, 88, 0.45);
  background: radial-gradient(circle at 50% 35%, rgba(200, 165, 88, 0.22), rgba(0, 0, 0, 0.2) 70%);
  color: #ffd070;
  font-size: 16px;
  overflow: hidden;
}
.toast-glyph img { width: 26px; height: 26px; object-fit: contain; image-rendering: pixelated; }
.toast-title {
  font-family: 'Cinzel', serif;
  font-size: 12.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #ffd070;
  text-shadow: 0 1px 2px #000, 0 0 10px rgba(200, 165, 88, 0.25);
}
.toast-sub {
  font-family: 'Crimson Pro', Georgia, serif;
  font-size: 14px;
  line-height: 1.25;
  color: #d9cfbb;
  margin-top: 2px;
}
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
body.tier-micro .toast, body.tier-compact .toast { padding: 7px 12px 7px 9px; grid-template-columns: 28px 1fr; }
body.tier-micro .toast-title, body.tier-compact .toast-title { font-size: 11px; }
body.tier-micro .toast-sub, body.tier-compact .toast-sub { font-size: 12.5px; }
`;

export class ToastUI {
  private readonly root: HTMLElement;
  private readonly live = new Map<HTMLElement, number>();

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
  }

  show(spec: ToastSpec): HTMLElement {
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
    for (const el of [...this.live.keys()]) this.dismiss(el, true);
  }

  destroy(): void {
    for (const t of this.live.values()) window.clearTimeout(t);
    this.live.clear();
    this.root.remove();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
