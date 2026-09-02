/**
 * @module ui/CharacterSheet
 * The character sheet window (it.41, hotkey C): the hero's derived numbers
 * in one place — level and XP, vitals, damage with every multiplier, armor
 * and dodge, speed, gold, skill points, learned passives and running
 * buffs. Read-only, draggable, refreshed on every progression event.
 */

import { eventBus } from '@/core/EventBus';
import { audio } from '@/engine/AudioManager';
import type { Player } from '@/entities/Player';
import { PASSIVE_BY_ID, SKILL_BY_ID } from '@/systems/SkillTree';

export class CharacterSheetUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private readonly offs: Array<() => void> = [];
  private readonly abort = new AbortController();

  constructor(private readonly player: Player) {
    this.panel = document.createElement('div');
    this.panel.id = 'char-sheet';
    document.body.appendChild(this.panel);
    this.offs.push(eventBus.on('inventory:changed', () => this.visible && this.render()));
    this.offs.push(eventBus.on('skills:changed', () => this.visible && this.render()));
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'KeyC' && !e.repeat) {
          e.preventDefault();
          this.toggle();
        } else if (e.code === 'Escape' && this.visible) {
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

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  open(): void {
    if (this.visible) return;
    this.visible = true;
    this.panel.classList.add('open');
    audio.sfx('invOpen');
    this.render();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove('open');
    audio.sfx('invClose');
  }

  /** Called each second by main while open so buffs and XP stay live. */
  tick(): void {
    if (this.visible) this.render();
  }

  private render(): void {
    const p = this.player;
    const prof = p.weaponProfile;
    const mult = p.damageMult;
    const row = (k: string, v: string, note = ''): string => `<div class="cs-row"><span>${k}</span><b>${v}</b>${note ? `<i>${note}</i>` : ''}</div>`;
    const pct = (f: number): string => `${Math.round(f * 100)}%`;
    const passives = [...p.passives].map((id) => PASSIVE_BY_ID[id]).filter(Boolean);
    const buffs: string[] = [];
    if (p.dmgBuffTicks > 0) buffs.push(`+${Math.round((p.dmgBuffMult - 1) * 100)}% damage · ${Math.ceil(p.dmgBuffTicks / 60)}s`);
    if (p.drTicks > 0) buffs.push(`${Math.round(p.drFrac * 100)}% damage absorbed · ${Math.ceil(p.drTicks / 60)}s`);
    if (p.hasteTicks > 0) buffs.push(`haste · ${Math.ceil(p.hasteTicks / 60)}s`);
    if (p.stealthTicks > 0) buffs.push(`vanished · ${Math.ceil(p.stealthTicks / 60)}s`);
    if (p.poisonBladeTicks > 0) buffs.push(`envenomed blades · ${Math.ceil(p.poisonBladeTicks / 60)}s`);
    const loadout = p.loadout.map((id, i) => `<span class="cs-skill">${i + 1} · ${id ? SKILL_BY_ID[id]?.name ?? id : '—'}</span>`).join('');
    this.panel.innerHTML = `
      <div class="cs-head drag-handle"><h3>CHARACTER</h3><span class="cs-class">${p.archetype.toUpperCase()} · LEVEL ${p.level}</span><button class="tp-close" data-close>✕</button></div>
      <div class="cs-grid">
        <div class="cs-block"><h4>PROGRESS</h4>
          ${row('Experience', `${p.xp} / ${p.xpToNext()}`)}
          ${row('Skill points', `${p.skillPoints}`, 'K opens the tree')}
          ${row('Gold', `${p.gold}`)}
        </div>
        <div class="cs-block"><h4>VITALS</h4>
          ${row('Health', `${Math.round(p.hp)} / ${p.hpMax}`)}
          ${row(p.resourceName === 'MANA' ? 'Mana' : 'Stamina', `${Math.round(p.resource)} / ${p.resourceMax}`)}
          ${row('Speed', pct(p.speedMult))}
        </div>
        <div class="cs-block"><h4>OFFENSE</h4>
          ${row('Damage', `${Math.round(prof.minDamage * mult)}–${Math.round(prof.maxDamage * mult)}`, mult !== 1 ? `×${mult.toFixed(2)}` : '')}
          ${row('Weapon', prof.kind)}
          ${row('Level bonus', `+${p.levelDamageMin}–${p.levelDamageMax}`)}
        </div>
        <div class="cs-block"><h4>DEFENSE</h4>
          ${row('Armor', `${p.armor}`)}
          ${row('Dodge', pct(p.dodgeChance))}
          ${row('Absorb', pct(p.damageReduction))}
        </div>
      </div>
      <div class="cs-block cs-wide"><h4>HOTBAR</h4><div class="cs-skills">${loadout}</div></div>
      <div class="cs-block cs-wide"><h4>PASSIVES</h4>${passives.length ? passives.map((d) => `<div class="cs-row"><span>${d.glyph} ${d.name}</span><b>${d.hint}</b></div>`).join('') : '<div class="cs-empty">None learned yet</div>'}</div>
      <div class="cs-block cs-wide"><h4>ACTIVE EFFECTS</h4>${buffs.length ? buffs.map((b) => `<div class="cs-row"><span>${b}</span></div>`).join('') : '<div class="cs-empty">None</div>'}</div>`;
    this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  destroy(): void {
    this.abort.abort();
    for (const off of this.offs) off();
    this.panel.remove();
  }
}
