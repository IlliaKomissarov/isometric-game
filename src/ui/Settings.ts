/**
 * @module ui/Settings
 * Settings panel (O key): master / music / effects volume sliders + mute.
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
    });
    this.render();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle('open', this.visible);
    audio.sfx('ui');
  }

  private render(): void {
    const s = audio.settings;
    const slider = (id: string, label: string, value: number): string => `
      <label class="set-row">
        <span>${label}</span>
        <input type="range" min="0" max="100" value="${Math.round(value * 100)}" data-set="${id}" />
      </label>`;
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
      <div class="set-tip">O closes · settings persist</div>
    `;
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
