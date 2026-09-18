/**
 * @module ui/Chat
 * THE LOG (it.59 as party chat, rebuilt it.117 as the run's own record).
 *
 * It began as a co-op-only chat box and was never built in a single-player
 * run at all, which meant the one place the game could have KEPT what it
 * said — a kill, a find, a floor cleared, a purse spent — was switched off
 * for most players. Everything the game says in passing now goes here as
 * well as into the notices: the notices are for the moment, the log is for
 * "what did that thing kill me with?" ten seconds later.
 *
 * WHAT IT CARRIES. Eight kinds, each its own colour: `say` (a party member),
 * `note` (what the player typed), `combat` (deaths and falls), `loot` (found
 * and picked up), `use` (a draught drunk, a skill cast), `quest` (taken,
 * turned over, a floor cleared), `trade` (bought and sold), `craft` (the
 * forge), and `system` for the run's own voice. A filter row folds the noisy
 * kinds away without losing them — the scrollback holds 300 lines either way.
 *
 * INPUT SANITISATION, UNCHANGED AND NON-NEGOTIABLE: every line is built with
 * `textContent`, so no markup ever reaches the DOM whatever a peer sends.
 * While the line is focused a capture-phase key filter swallows the game
 * hotkeys so typing never moves the hero or opens a panel; while it is NOT
 * focused this module takes NO key at all (it.117b) and leaves every
 * other one to the game.
 */

import { layout } from '@/core/OrientationManager';

const MAX_LINES = 300;
const SEND_WINDOW_MS = 5000;
const SEND_BURST = 6;

/** The kinds a line can be. `say` is a person; everything else is the run. */
export type LogKind = 'say' | 'note' | 'combat' | 'loot' | 'use' | 'quest' | 'trade' | 'craft' | 'system';

/** The kinds a player can silence. `say`, `note` and `system` are never hidden. */
const FILTERABLE: LogKind[] = ['combat', 'loot', 'use', 'quest', 'trade', 'craft'];
const FILTER_LABEL: Record<string, string> = {
  combat: 'FIGHT',
  loot: 'LOOT',
  use: 'USE',
  quest: 'QUEST',
  trade: 'TRADE',
  craft: 'FORGE',
};
const GLYPH: Record<LogKind, string> = {
  say: '',
  note: '✎',
  combat: '⚔',
  loot: '◆',
  use: '❉',
  quest: '❖',
  trade: '⚖',
  craft: '⚒',
  system: '·',
};

export interface ChatHooks {
  /** Send to the party. In a single-player run this is a local note. */
  send: (text: string) => void;
  /** True when a party is listening; the header says PARTY instead of LOG. */
  isParty?: () => boolean;
}

const CSS = `
/* THE LOG (it.117): the it.59 box, widened into a readable record. The rules
   below deliberately restate the id selectors from the page stylesheet — this
   sheet is appended after it, so equal specificity lands on this one. */
#chat { width: min(340px, 42vw); max-height: calc(var(--app-h, 100vh) - 380px); z-index: 30; }
#chat .chat-head { gap: 8px; }
#chat .chat-head > b {
  flex: 0 0 auto;
  font-family: 'Cinzel', serif;
  font-size: 9.5px;
  letter-spacing: 0.2em;
  color: #c8a558;
}
#chat .chat-filters { display: flex; flex: 1 1 auto; gap: 3px; overflow: hidden; }
#chat .chat-filters button {
  padding: 0 4px;
  font-family: 'Cinzel', serif;
  font-size: 8px;
  letter-spacing: 0.1em;
  color: #6f6450;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid #2a2230;
  cursor: pointer;
}
#chat .chat-filters button.on { color: #d9cfbb; border-color: #5a4a30; }
#chat .chat-log { height: 158px; max-height: 34vh; }
#chat .chat-msg { display: block; padding: 1px 0; }
#chat .chat-msg > i.chat-glyph { font-style: normal; opacity: 0.8; margin-right: 4px; }
#chat .chat-k-note { color: #cfe6a9; font-style: italic; }
#chat .chat-k-combat { color: #ff8a7a; }
#chat .chat-k-loot { color: #ffd070; }
#chat .chat-k-use { color: #a9c8ef; }
#chat .chat-k-quest { color: #d8c8f0; }
#chat .chat-k-trade { color: #e8cf8a; }
#chat .chat-k-craft { color: #c8a558; }
#chat .chat-k-system { color: #a89c80; font-style: italic; }
#chat .chat-time { color: #5f5748; font-size: 11px; margin-right: 4px; }
#chat .chat-x { min-width: 18px; padding: 0 4px; font-family: 'Cinzel', serif; font-size: 10px; color: #7d7466; background: none; border: 1px solid #2a2230; cursor: pointer; }
#chat .chat-x:hover { color: #ffd070; border-color: #5a4a30; }
/* CLOSED IS CLOSED (it.117): the bar's button and G bring it back. */
#chat.shut { display: none !important; }
/* A PHONE IN PORTRAIT used to lose the log entirely. It keeps a short one —
   ABOVE the pad, because a fixed 226px bottom put it straight over the thumb
   stick, and a log you have to move your hand off the controls to read is
   worse than no log. --pad-h is the layout's own number for the slate. */
body.orient-portrait.has-pad #chat {
  display: flex;
  left: 8px;
  width: min(300px, 74vw);
  bottom: calc(var(--pad-h, 0px) + 10px);
  max-height: 180px;
}
body.orient-portrait.has-pad #chat .chat-log { height: 96px; }
body.tier-micro #chat { width: min(250px, 66vw); }
body.tier-micro #chat .chat-log { height: 84px; font-size: 12px; }
body.tiny-height #chat .chat-log { height: 74px; }
/* A filtered kind is hidden, not lost: unfolding the chip brings it back. */
#chat.f-combat .chat-k-combat,
#chat.f-loot .chat-k-loot,
#chat.f-use .chat-k-use,
#chat.f-quest .chat-k-quest,
#chat.f-trade .chat-k-trade,
#chat.f-craft .chat-k-craft { display: none; }
`;

export class ChatUI {
  private readonly root: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly tab: HTMLButtonElement;
  private readonly input: HTMLInputElement;
  private readonly title: HTMLElement;
  private readonly abort = new AbortController();
  private readonly sent: number[] = [];
  private unread = 0;
  /** The panel fades back after eight quiet seconds (a new line or a hover wakes it). */
  private idleTimer = 0;
  private readonly hidden = new Set<string>();
  /** The run's clock, in whole seconds, for the timestamp on each line. */
  private t0 = performance.now();

  constructor(private readonly hooks: ChatHooks) {
    if (!document.getElementById('chat-css')) {
      const style = document.createElement('style');
      style.id = 'chat-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.id = 'chat';
    const chips = FILTERABLE.map((k) => `<button type="button" data-filter="${k}" class="on" title="Show or hide ${FILTER_LABEL[k]} lines">${FILTER_LABEL[k]}</button>`).join('');
    this.root.innerHTML = `
      <div class="chat-head"><b class="chat-title">LOG</b><div class="chat-filters">${chips}</div><button type="button" class="chat-x" title="Hide the log">✕</button></div>
      <div class="chat-log" role="log" aria-label="Game log"></div>
      <div class="chat-line"><input type="text" maxlength="200" placeholder="Write a note…" spellcheck="false" autocomplete="off" /></div>`;
    document.body.appendChild(this.root);
    // THE TAB (it.117): a small mark on the left edge, shown only while the log
    // is hidden. It is how the log comes back - there is no key and no bar button.
    this.tab = document.createElement('button');
    this.tab.type = 'button';
    this.tab.id = 'chat-tab';
    this.tab.className = 'hud-el';
    this.tab.title = 'Show the log';
    this.tab.innerHTML = '<span>LOG</span><em></em>';
    document.body.appendChild(this.tab);
    this.logEl = this.root.querySelector('.chat-log')!;
    this.input = this.root.querySelector('input')!;
    this.title = this.root.querySelector('.chat-title')!;
    // A PHONE STARTS QUIET (it.117): the glass is small and the log is the one
    // panel that is useful AFTER the fact, so it waits behind its button until
    // the player asks for it. A pointer screen has the room and starts open.
    // Either way the choice is remembered from then on.
    if (layout.state.touch && layout.state.orientation === 'portrait') this.root.classList.add('shut');
    try {
      const stored = localStorage.getItem('iso-arpg-chat-shut');
      if (stored === '1') this.root.classList.add('shut');
      else if (stored === '0') this.root.classList.remove('shut');
      for (const k of JSON.parse(localStorage.getItem('iso-arpg-chat-hidden') ?? '[]') as string[]) {
        if (FILTERABLE.includes(k as LogKind)) {
          this.hidden.add(k);
          this.root.classList.add(`f-${k}`);
        }
      }
    } catch {
      /* storage unavailable */
    }
    this.syncFilters();
    const { signal } = this.abort;
    this.root.querySelector('.chat-x')?.addEventListener('click', () => this.setShut(true), { signal });
    this.tab.addEventListener('click', () => this.setShut(false), { signal });
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
      b.addEventListener(
        'click',
        () => {
          const k = b.dataset.filter!;
          if (this.hidden.has(k)) this.hidden.delete(k);
          else this.hidden.add(k);
          this.root.classList.toggle(`f-${k}`, this.hidden.has(k));
          this.syncFilters();
          try {
            localStorage.setItem('iso-arpg-chat-hidden', JSON.stringify([...this.hidden]));
          } catch {
            /* ignore */
          }
        },
        { signal },
      );
    }
    // The capture filter: with the line focused, nothing leaks to the game.
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        const typing = document.activeElement === this.input;
        if (typing) {
          if (e.code === 'Escape') {
            e.preventDefault();
            this.close();
          } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            this.submit();
          }
          e.stopImmediatePropagation();
          return;
        }
        if (isTypingElsewhere()) return; // Another field owns the keys entirely.
        // IT.117b: ENTER IS THE GAME'S, NOT THE LOG'S. It turns a page of
        // dialogue; the log used to grab it and open its line instead. The log
        // is opened by CLICKING it - its own line, its own tab - and claims no
        // key at all while the caret is elsewhere.
      },
      { signal, capture: true },
    );
    window.addEventListener(
      'keyup',
      (e: KeyboardEvent) => {
        if (document.activeElement === this.input) e.stopImmediatePropagation();
      },
      { signal, capture: true },
    );
    this.input.addEventListener('blur', () => this.root.classList.remove('typing'), { signal });
    this.wake();
  }

  private syncFilters(): void {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
      b.classList.toggle('on', !this.hidden.has(b.dataset.filter!));
    }
  }

  private wake(): void {
    this.root.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.root.classList.add('idle'), 8000);
  }

  get isTyping(): boolean {
    return document.activeElement === this.input;
  }

  /** Is the panel on screen at all? (The bar's button reads this.) */
  get isShown(): boolean {
    return !this.root.classList.contains('shut');
  }

  /** Show or hide the whole panel. Hidden is remembered across runs. */
  setShut(shut: boolean): void {
    this.root.classList.toggle('shut', shut);
    this.tab.classList.toggle('show', shut);
    if (shut) this.close();
    else {
      this.unread = 0;
      this.tab.classList.remove('unread');
      (this.tab.querySelector('em') as HTMLElement).textContent = '';
      this.logEl.scrollTop = this.logEl.scrollHeight;
      this.wake();
    }
    try {
      localStorage.setItem('iso-arpg-chat-shut', shut ? '1' : '0');
    } catch {
      /* ignore */
    }
    document.dispatchEvent(new CustomEvent('chat:shown', { detail: { shown: !shut } }));
  }

  /** Open and take the line (a click on the log, or its tab). */
  open(): void {
    this.wake();
    if (this.root.classList.contains('shut')) this.setShut(false);
    this.root.classList.add('typing');
    this.input.focus();
  }

  close(): void {
    this.input.blur();
    this.root.classList.remove('typing');
  }

  private submit(): void {
    const text = this.input.value.trim();
    this.input.value = '';
    if (!text) {
      this.close();
      return;
    }
    const now = performance.now();
    while (this.sent.length && now - this.sent[0] > SEND_WINDOW_MS) this.sent.shift();
    if (this.sent.length >= SEND_BURST) {
      this.system('Slow down — the party can only read so fast.');
      return;
    }
    this.sent.push(now);
    this.hooks.send(text.slice(0, 200));
    this.input.focus();
  }

  /** A member line: `[Name]: text` in the slot colour. Text is DATA, never markup. */
  push(name: string, color: string, text: string): void {
    const line = this.line('say');
    const who = document.createElement('b');
    who.style.color = color;
    who.textContent = `[${name}]:`;
    const body = document.createElement('span');
    body.textContent = ` ${text}`;
    line.append(who, body);
    this.append(line);
  }

  /** `[System] …` event line. */
  system(text: string): void {
    const line = this.line('system');
    line.append(document.createTextNode(text));
    this.append(line);
  }

  /**
   * THE RUN'S OWN VOICE (it.117): one call for every kind of line the game
   * records. `text` is data — it is written with `textContent` and can carry
   * any item or creature name without escaping.
   */
  log(kind: LogKind, text: string): void {
    const line = this.line(kind);
    line.append(document.createTextNode(text));
    this.append(line);
  }

  /** What the player typed, when nobody is listening but the log. */
  note(text: string): void {
    this.log('note', text);
  }

  private line(kind: LogKind): HTMLElement {
    const line = document.createElement('div');
    line.className = `chat-msg chat-k-${kind}`;
    const secs = Math.floor((performance.now() - this.t0) / 1000);
    const stamp = document.createElement('i');
    stamp.className = 'chat-time';
    stamp.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    line.appendChild(stamp);
    if (GLYPH[kind]) {
      const g = document.createElement('i');
      g.className = 'chat-glyph';
      g.textContent = GLYPH[kind];
      line.appendChild(g);
    }
    return line;
  }

  private append(line: HTMLElement): void {
    this.wake();
    // STICK TO THE FOOT ONLY IF THE PLAYER IS AT THE FOOT: someone reading
    // back through the scrollback must not be yanked down by a new kill.
    const atFoot = this.logEl.scrollHeight - this.logEl.scrollTop - this.logEl.clientHeight < 24;
    this.logEl.appendChild(line);
    while (this.logEl.childElementCount > MAX_LINES) this.logEl.firstElementChild?.remove();
    if (atFoot) this.logEl.scrollTop = this.logEl.scrollHeight;
    if (!this.isShown) {
      this.unread++;
      this.tab.classList.add('unread');
      (this.tab.querySelector('em') as HTMLElement).textContent = this.unread > 99 ? '99+' : String(this.unread);
    }
  }

  /** The header reads PARTY when one is listening, LOG when it is your own. */
  setParty(on: boolean): void {
    this.title.textContent = on ? 'PARTY' : 'LOG';
  }

  destroy(): void {
    this.tab.remove();
    clearTimeout(this.idleTimer);
    this.abort.abort();
    this.root.remove();
  }
}

/** Another text field (the lobby's name box, the cheat console) owns the keys. */
function isTypingElsewhere(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}
