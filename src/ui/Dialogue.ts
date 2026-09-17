/**
 * @module ui/Dialogue
 * THE SPOKEN WORD (it.87): one panel for every character who has something
 * to say — a name, a few lines, and up to three choices. It answers with a
 * promise so a quest can wait on it. Escape or the cross is the last choice
 * (the one that walks away). Thumb-sized buttons, contain-fit on a phone.
 */

import { audio } from '@/engine/AudioManager';

/**
 * THE WORD HAS THE FLOOR (it.115). While the panel is open the page wears
 * `body.dialogue-open`: the notices, the reward line, the tutorial banner and
 * the level-up flash are hidden by the stylesheet, and `ui/Toast` holds its
 * queue. When it closes this DOM event goes out on `document` (the typed
 * `eventBus` cannot carry a UI-only event without a change to its map), and
 * whatever was held is shown then.
 */
export const DIALOGUE_OPEN_CLASS = 'dialogue-open';
export const DIALOGUE_CLOSED_EVENT = 'dialogue:closed';

/** True while any quest dialogue panel is up (it.115). */
export function isDialogueOpen(): boolean {
  return document.body.classList.contains(DIALOGUE_OPEN_CLASS);
}

export interface DialogueChoice {
  label: string;
  /** A small note under the label. */
  sub?: string;
  /** Returned by `open` when chosen. */
  value: string;
}

export interface DialogueSpec {
  speaker: string;
  /** Under the name: who they are. */
  role?: string;
  lines: string[];
  choices: DialogueChoice[];
  /** THE FACE (it.88): a portrait beside the lines - the speaker's own frame, cropped to the head. */
  portrait?: HTMLCanvasElement | null;
}

export class DialogueUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private resolve: ((v: string) => void) | null = null;
  private readonly abort = new AbortController();

  constructor() {
    this.panel = document.createElement('div');
    this.panel.id = 'dialogue-panel';
    this.panel.className = 'town-panel';
    document.body.appendChild(this.panel);
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (!this.visible) return;
        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.choose(this.lastValue());
        } else if (e.code === 'ArrowDown' || e.code === 'ArrowUp' || e.code === 'KeyS' || e.code === 'KeyW' || e.code === 'Tab') {
          // KEYS ON THE WORD (it.94): the arrows (or W/S, Tab) walk the choices, Enter takes the one lit.
          e.preventDefault();
          e.stopImmediatePropagation();
          const list = [...this.panel.querySelectorAll<HTMLButtonElement>('[data-choice]')];
          if (!list.length) return;
          const down = e.code === 'ArrowDown' || e.code === 'KeyS' || (e.code === 'Tab' && !e.shiftKey);
          this.focusIndex = (this.focusIndex + (down ? 1 : -1) + list.length) % list.length;
          this.lightChoice(list);
          audio.sfx('uiHover');
        } else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
          const list = [...this.panel.querySelectorAll<HTMLButtonElement>('[data-choice]')];
          const b = list[this.focusIndex] ?? list[0];
          if (b) {
            e.preventDefault();
            e.stopImmediatePropagation();
            b.click();
          }
        } else if (/^Digit[1-3]$/.test(e.code)) {
          const i = Number(e.code.slice(5)) - 1;
          const b = this.panel.querySelectorAll<HTMLButtonElement>('[data-choice]')[i];
          if (b) {
            e.preventDefault();
            e.stopImmediatePropagation();
            b.click();
          }
        }
      },
      { signal: this.abort.signal, capture: true },
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /** Show the lines; resolves with the chosen value (the last choice on Escape or the cross). */
  open(spec: DialogueSpec): Promise<string> {
    if (this.resolve) this.resolve(this.lastValue());
    this.visible = true;
    this.panel.classList.add('open');
    document.body.classList.add(DIALOGUE_OPEN_CLASS);
    audio.sfx('dialogueOpen');
    const lines = spec.lines.map((l) => `<p>${l}</p>`).join('');
    const choices = spec.choices.map((c, i) => `<button class="menu-btn dl-choice" type="button" data-choice="${c.value}"><span class="dl-num">${i + 1}</span>${c.label}${c.sub ? `<span class="mm-sub">${c.sub}</span>` : ''}</button>`).join('');
    this.panel.innerHTML = `
      <div class="tp-head drag-handle"><h3>${spec.speaker}</h3><span class="tp-vendor">${spec.role ?? ''}</span><button class="tp-close" data-close title="Walk away (ESC)"><i></i></button></div>
      ${spec.portrait ? `<div class="dl-body"><div class="dl-portrait"></div><div class="dl-lines">${lines}</div></div>` : `<div class="dl-lines">${lines}</div>`}
      <div class="dl-choices">${choices}</div>`;
    if (spec.portrait) this.panel.querySelector('.dl-portrait')?.appendChild(spec.portrait);
    this.focusIndex = 0;
    this.lightChoice([...this.panel.querySelectorAll<HTMLButtonElement>('[data-choice]')]);
    this.panel.dataset.last = spec.choices[spec.choices.length - 1]?.value ?? '';
    this.panel.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.choose(this.lastValue());
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b, i) => {
      b.addEventListener('mouseenter', () => {
        audio.sfx('uiHover');
        this.focusIndex = i;
        this.lightChoice([...this.panel.querySelectorAll<HTMLButtonElement>('[data-choice]')]);
      });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.sfx('uiConfirm');
        this.choose(b.dataset.choice ?? '');
      });
    });
    return new Promise<string>((res) => {
      this.resolve = res;
    });
  }

  close(): void {
    if (this.visible) this.choose(this.lastValue());
  }

  destroy(): void {
    this.abort.abort();
    if (this.resolve) this.resolve(this.lastValue());
    this.panel.remove();
    this.releaseFloor();
  }

  /** The page no longer wears the class; the held notices may come (it.115). */
  private releaseFloor(): void {
    if (!document.body.classList.contains(DIALOGUE_OPEN_CLASS)) return;
    document.body.classList.remove(DIALOGUE_OPEN_CLASS);
    document.dispatchEvent(new CustomEvent(DIALOGUE_CLOSED_EVENT));
  }

  /** Which choice the keys have lit (it.94). */
  private focusIndex = 0;
  private lightChoice(list: HTMLButtonElement[]): void {
    list.forEach((b, i) => b.classList.toggle('lit', i === this.focusIndex));
  }

  private lastValue(): string {
    return this.panel.dataset.last ?? '';
  }

  private choose(value: string): void {
    this.visible = false;
    this.panel.classList.remove('open');
    audio.sfx('dialogueClose');
    const r = this.resolve;
    this.resolve = null;
    // The choice is delivered FIRST: a quest that turns over on it may raise a
    // notice, and that notice must find the floor already free (it.115).
    r?.(value);
    this.releaseFloor();
  }
}
