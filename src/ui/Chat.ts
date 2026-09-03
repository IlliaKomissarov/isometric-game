/**
 * @module ui/Chat
 * PARTY CHAT (it.59): a collapsible HUD log in the lower-left. ENTER opens
 * the line, ENTER sends, ESC closes. Lines read `[Nickname]: message` in the
 * member's slot colour, `[System] …` for party events.
 *
 * INPUT SANITISATION: every line is built with `textContent` — no markup
 * ever reaches the DOM, whatever a peer sends. While the line is focused a
 * capture-phase key filter swallows the game hotkeys (WASD, I, K, M …) so
 * typing never moves the hero or opens a panel.
 */

const MAX_LINES = 120;
const SEND_WINDOW_MS = 5000;
const SEND_BURST = 6;

export interface ChatHooks {
  send: (text: string) => void;
}

export class ChatUI {
  private readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly toggle: HTMLButtonElement;
  private readonly abort = new AbortController();
  private readonly sent: number[] = [];
  private unread = 0;

  constructor(private readonly hooks: ChatHooks) {
    this.root = document.createElement('div');
    this.root.id = 'chat';
    this.root.innerHTML = `
      <div class="chat-head"><span>PARTY</span><button type="button" class="chat-toggle" title="Collapse / expand (Enter to chat)">—</button></div>
      <div class="chat-log"></div>
      <div class="chat-line"><input type="text" maxlength="200" placeholder="Enter to chat…" spellcheck="false" autocomplete="off" /></div>`;
    document.body.appendChild(this.root);
    this.log = this.root.querySelector('.chat-log')!;
    this.input = this.root.querySelector('input')!;
    this.toggle = this.root.querySelector('.chat-toggle')!;
    try {
      if (localStorage.getItem('iso-arpg-chat-collapsed') === '1') this.root.classList.add('collapsed');
    } catch {
      /* storage unavailable */
    }
    const { signal } = this.abort;
    this.toggle.addEventListener('click', () => this.setCollapsed(!this.root.classList.contains('collapsed')), { signal });
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
        const ae = document.activeElement;
        const onButton = !!ae && (ae.tagName === 'BUTTON' || ae.tagName === 'A');
        if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && !isTypingElsewhere() && !onButton) {
          // Don't steal ENTER from a modal button or another field.
          e.preventDefault();
          e.stopImmediatePropagation();
          this.open();
        }
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
  }

  get isTyping(): boolean {
    return document.activeElement === this.input;
  }

  open(): void {
    this.setCollapsed(false);
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
    const line = document.createElement('div');
    line.className = 'chat-msg';
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
    const line = document.createElement('div');
    line.className = 'chat-msg chat-sys';
    line.textContent = `[System] ${text}`;
    this.append(line);
  }

  private append(line: HTMLElement): void {
    this.log.appendChild(line);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    if (this.root.classList.contains('collapsed')) {
      this.unread++;
      this.toggle.textContent = `${this.unread}`;
      this.root.classList.add('unread');
    }
  }

  private setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle('collapsed', collapsed);
    if (!collapsed) {
      this.unread = 0;
      this.toggle.textContent = '—';
      this.root.classList.remove('unread');
      this.log.scrollTop = this.log.scrollHeight;
    } else {
      this.toggle.textContent = '+';
      this.close();
    }
    try {
      localStorage.setItem('iso-arpg-chat-collapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  destroy(): void {
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
