/**
 * @module ui/Settings
 * Settings & Controls panel (O key, or the menus' SETTINGS buttons):
 * master / music / effects / ambience sliders + mute, and the full
 * control reference. Persistent across runs (created once at boot).
 * Values live in AudioManager and persist via localStorage. Pure DOM.
 */

import { audio } from '@/engine/AudioManager';

export class SettingsUI {
  private readonly panel: HTMLElement;
  private visible = false;

  constructor() {
    this.panel = document.createElement('div');
    this.panel.id = 'settings-panel';
    document.body.appendChild(this.panel);

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'KeyO' && !e.repeat) {
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

  open(): void {
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

  private render(): void {
    const s = audio.settings;
    const slider = (id: string, label: string, value: number): string => `
      <label class="set-row">
        <span>${label}</span>
        <input type="range" min="0" max="100" value="${Math.round(value * 100)}" data-set="${id}" />
      </label>`;
    const controls: Array<[string, string]> = [
      ['Move · Target', 'LMB'],
      ['Direct control', 'W A S D / Arrows'],
      ['Strike', 'SPACE / F'],
      ['Skills', '1 · 2 · 3 · 4'],
      ['Take loot · Open', 'E'],
      ['Inventory', 'I'],
      ['Map', 'M'],
      ['Depths', 'L'],
      ['Zoom', 'Wheel'],
      ['Pause', 'ESC'],
      ['Settings', 'O'],
      ['Forbidden Arts', 'F1 / `'],
    ];
    this.panel.innerHTML = `
      <h3>SETTINGS</h3>
      ${slider('master', 'Master', s.master)}
      ${slider('bgm', 'Music', s.bgm)}
      ${slider('sfx', 'Effects', s.sfx)}
      ${slider('amb', 'Ambience', s.amb)}
      <label class="set-row set-mute">
        <span>Mute all</span>
        <input type="checkbox" data-set="muted" ${s.muted ? 'checked' : ''} />
      </label>
      <h4>CONTROLS</h4>
      <div class="set-controls">${controls
        .map(([what, key]) => `<div class="set-ctl"><span>${what}</span><kbd>${key}</kbd></div>`)
        .join('')}</div>
      <button class="set-close" data-close>CLOSE</button>
      <div class="set-tip">O or ESC closes · settings persist</div>
    `;
    this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.panel.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
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
  }
}
