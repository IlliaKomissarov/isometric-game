/**
 * @module ui/Settings
 * Settings panel (O key, or the menus' SETTINGS buttons), tabbed since it.61:
 *
 *   AUDIO    — master / music / effects / ambience sliders + mute.
 *   VISUALS  — screen shake, blood & gore, the hurt flash, ambient particles.
 *   CONTROLS — the full key reference.
 *
 * Persistent across runs (created once at boot). Audio values live in
 * AudioManager, visual toggles in VisualSettings; both persist via
 * localStorage. Pure DOM.
 */

import { audio } from '@/engine/AudioManager';
import { setVisual, visuals } from '@/core/VisualSettings';
import { toggleFullscreen } from '@/ui/TouchControls';
import { getControlsMode, layout, type ControlsMode } from '@/core/OrientationManager';

type Tab = 'audio' | 'visuals' | 'controls';

export class SettingsUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private tab: Tab = 'audio';

  constructor() {
    this.panel = document.createElement('div');
    this.panel.id = 'settings-panel';
    document.body.appendChild(this.panel);

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'KeyO' && !e.repeat && !isTyping()) {
        e.preventDefault();
        this.toggle();
      }
      if (e.code === 'Escape' && this.visible) {
        e.preventDefault();
        e.stopImmediatePropagation(); // ESC closes settings before it can pause.
        this.close();
      }
    });
    this.render();
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  open(tab?: Tab): void {
    if (tab) this.showTab(tab);
    if (this.visible) return;
    this.visible = true;
    this.panel.classList.add('open');
    audio.sfx('invOpen');
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove('open');
    audio.sfx('uiBack');
  }

  get isOpen(): boolean {
    return this.visible;
  }

  private showTab(tab: Tab): void {
    this.tab = tab;
    this.panel.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    this.panel.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== tab));
  }

  private render(): void {
    const s = audio.settings;
    const slider = (id: string, label: string, value: number): string => `
      <label class="set-row">
        <span>${label}</span>
        <input type="range" min="0" max="100" value="${Math.round(value * 100)}" data-set="${id}" />
      </label>`;
    const toggle = (id: keyof typeof visuals, label: string, note: string): string => `
      <label class="set-row set-toggle">
        <span>${label}<small>${note}</small></span>
        <input type="checkbox" data-visual="${id}" ${visuals[id] ? 'checked' : ''} />
      </label>`;
    const controls: Array<[string, string]> = [
      ['Move · Target', 'LMB'],
      ['Direct control', 'W A S D / Arrows'],
      ['Strike', 'SPACE / F'],
      ['Skills', '1 · 2 · 3 · 4'],
      ['Take loot · Open', 'E'],
      ['Potion · Mana', 'Q · R'],
      ['Town portal', 'T'],
      ['Inventory', 'I'],
      ['Skill tree', 'K'],
      ['Character', 'C'],
      ['Bestiary', 'B'],
      ['Map', 'M'],
      ['Depths', 'L'],
      ['Party chat', 'Enter'],
      ['Zoom', 'Wheel'],
      ['Pause', 'ESC'],
      ['Settings', 'O'],
      ['Forbidden Arts', 'F1 / `'],
    ];
    this.panel.innerHTML = `
      <div class="set-corner tl"></div><div class="set-corner tr"></div><div class="set-corner bl"></div><div class="set-corner br"></div>
      <h3>SETTINGS</h3>
      <div class="set-tabs">
        <button type="button" data-tab="audio" class="on">AUDIO</button>
        <button type="button" data-tab="visuals">VISUALS</button>
        <button type="button" data-tab="controls">CONTROLS</button>
      </div>
      <div data-pane="audio">
        ${slider('master', 'Master', s.master)}
        ${slider('bgm', 'Music', s.bgm)}
        ${slider('sfx', 'Effects', s.sfx)}
        ${slider('amb', 'Ambience', s.amb)}
        <label class="set-row set-mute">
          <span>Mute all</span>
          <input type="checkbox" data-set="muted" ${s.muted ? 'checked' : ''} />
        </label>
      </div>
      <div data-pane="visuals" hidden>
        <div class="set-row set-action">
          <span>Fullscreen<small>the whole screen, no browser chrome</small></span>
          <button type="button" class="set-btn" data-fullscreen>TOGGLE</button>
        </div>
        ${toggle('shake', 'Screen shake', 'kicks and tremors on heavy blows')}
        ${toggle('gore', 'Blood & gore', 'sprays, stains and corpses')}
        ${toggle('flash', 'Hurt flash', 'the red edge when you bleed')}
        ${toggle('particles', 'Ambient particles', 'embers, ash and fog on the title')}
      </div>
      <div data-pane="controls" hidden>
        <div class="set-row set-action set-seg">
          <span>Virtual controls<small>the thumb stick and buttons — AUTO shows them on a touch screen</small></span>
          <div class="set-segs" role="group" aria-label="Virtual controls">
            ${(['auto', 'on', 'off'] as ControlsMode[]).map((m) => `<button type="button" class="set-btn${getControlsMode() === m ? ' on' : ''}" data-controls="${m}">${m === 'auto' ? 'AUTO' : m === 'on' ? 'ALWAYS' : 'NEVER'}</button>`).join('')}
          </div>
        </div>
        <div class="set-controls">${controls
          .map(([what, key]) => `<div class="set-ctl"><span>${what}</span><kbd>${key}</kbd></div>`)
          .join('')}</div>
      </div>
      <button class="set-close" data-close>CLOSE</button>
      <div class="set-tip">O or ESC closes · settings persist</div>
    `;
    this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.panel.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
      b.addEventListener('click', () => {
        audio.sfx('uiClick');
        this.showTab(b.dataset.tab as Tab);
      });
    });
    this.panel.querySelectorAll<HTMLInputElement>('input[data-set]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.set;
        if (key === 'muted') audio.setMuted(input.checked);
        else if (key === 'master') audio.setMaster(Number(input.value) / 100);
        else if (key === 'bgm') audio.setBgm(Number(input.value) / 100);
        else if (key === 'sfx') audio.setSfx(Number(input.value) / 100);
        else if (key === 'amb') audio.setAmb(Number(input.value) / 100);
        if (key !== 'muted') audio.sfx('ui'); // Audible feedback while sliding.
      });
    });
    this.panel.querySelector('[data-fullscreen]')?.addEventListener('click', () => {
      audio.sfx('uiClick');
      void toggleFullscreen();
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-controls]').forEach((b) => {
      b.addEventListener('click', () => {
        audio.sfx('uiClick');
        layout.setControlsMode(b.dataset.controls as ControlsMode);
        this.panel.querySelectorAll<HTMLElement>('[data-controls]').forEach((o) => o.classList.toggle('on', o === b));
      });
    });
    this.panel.querySelectorAll<HTMLInputElement>('input[data-visual]').forEach((input) => {
      input.addEventListener('change', () => {
        setVisual(input.dataset.visual as keyof typeof visuals, input.checked);
        audio.sfx('uiClick');
      });
    });
    this.showTab(this.tab);
  }
}

function isTyping(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}
