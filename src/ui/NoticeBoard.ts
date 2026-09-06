/**
 * @module ui/NoticeBoard
 * THE BOUNTY BOARD (it.84): the guild's notice board in the Market Ward.
 * A functional placeholder for the quest system — it opens, it reads, it
 * closes on its cross, on E and on Escape, and it says plainly that the
 * ledger is not open yet. When bounties arrive they will be posted here.
 */

import { audio } from '@/engine/AudioManager';
import { keepScroll } from './keepScroll';

interface Posting {
  title: string;
  body: string;
  reward: string;
  when: string;
}

const POSTINGS: Posting[] = [
  { title: 'WANTED: THE TOMB WARDEN', body: 'The thing that keeps the fifth depth. Bring proof of its fall and the guild pays in gold and a rolled piece from the armorer’s back room.', reward: 'gold · gear', when: 'when the ledger opens' },
  { title: 'ESCORT: THE EASTERN CARAVAN', body: 'A merchant train waits at the east gate for the road beyond to be laid. Walk it through and the jeweler remembers your name.', reward: 'jewels · standing', when: 'when the eastern road is built' },
  { title: 'LOST: THE ALCHEMIST’S SATCHEL', body: 'Dropped somewhere on the marsh path south of the ward. Recipes inside. Finder keeps one.', reward: 'a recipe scroll', when: 'when the marsh path opens' },
  { title: 'CULL: THE HOLLOW PACK', body: 'Twenty of the crypt’s hollow dead, any depth. The bestiary keeps the count; the board will pay it out.', reward: 'gold', when: 'when the ledger opens' },
];

export class NoticeBoardUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private readonly abort = new AbortController();

  constructor() {
    this.panel = document.createElement('div');
    this.panel.id = 'notice-board';
    this.panel.className = 'town-panel';
    document.body.appendChild(this.panel);
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'Escape' && this.visible) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.close();
        }
      },
      { signal: this.abort.signal, capture: true },
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  open(): void {
    if (this.visible) return;
    this.visible = true;
    this.panel.classList.add('open');
    audio.sfx('invOpen');
    keepScroll(this.panel, () => this.paint());
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove('open');
    audio.sfx('invClose');
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  destroy(): void {
    this.abort.abort();
    this.panel.remove();
  }

  private paint(): void {
    const cards = POSTINGS.map(
      (p) => `<div class="nb-card"><b>${p.title}</b><p>${p.body}</p><div class="nb-meta"><span>REWARD · ${p.reward}</span><em>${p.when}</em></div><i class="nb-pin"></i></div>`,
    ).join('');
    this.panel.innerHTML = `
      <div class="tp-head drag-handle"><h3>THE BOUNTY BOARD</h3><span class="tp-vendor">the guild’s postings · nothing to claim yet</span><button class="tp-close" data-close title="Close (E or ESC)"><i></i></button></div>
      <p class="nb-lead">The Market Ward’s guild pins its work here. The ledger is not open yet — the postings below are the shape of what is coming: hunts, escorts, and things lost on roads that are still being built. Nothing can be taken up today.</p>
      <div class="nb-cards">${cards}</div>
      <p class="nb-foot">The roads east and south of the ward are the next to open. Their gateways stand ready.</p>`;
    const closeBtn = this.panel.querySelector<HTMLElement>('[data-close]');
    closeBtn?.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.sfx('uiClick');
      this.close();
    });
  }
}
