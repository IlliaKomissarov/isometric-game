/**
 * @module ui/Dialogue
 * THE SPOKEN WORD (it.87): one panel for every character who has something
 * to say — a name, a few lines, and up to three choices. It answers with a
 * promise so a quest can wait on it. Escape or the cross is the last choice
 * (the one that walks away). Thumb-sized buttons, contain-fit on a phone.
 */

import { audio } from '@/engine/AudioManager';

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
    audio.sfx('dialogueOpen');
    const lines = spec.lines.map((l) => `<p>${l}</p>`).join('');
    const choices = spec.choices.map((c, i) => `<button class="menu-btn dl-choice" type="button" data-choice="${c.value}"><span class="dl-num">${i + 1}</span>${c.label}${c.sub ? `<span class="mm-sub">${c.sub}</span>` : ''}</button>`).join('');
    this.panel.innerHTML = `
      <div class="tp-head drag-handle"><h3>${spec.speaker}</h3><span class="tp-vendor">${spec.role ?? ''}</span><button class="tp-close" data-close title="Walk away (ESC)"><i></i></button></div>
      ${spec.portrait ? `<div class="dl-body"><div class="dl-portrait"></div><div class="dl-lines">${lines}</div></div>` : `<div class="dl-lines">${lines}</div>`}
      <div class="dl-choices">${choices}</div>`;
    if (spec.portrait) this.panel.querySelector('.dl-portrait')?.appendChild(spec.portrait);
    this.panel.dataset.last = spec.choices[spec.choices.length - 1]?.value ?? '';
    this.panel.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.choose(this.lastValue());
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
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
    r?.(value);
  }
}
