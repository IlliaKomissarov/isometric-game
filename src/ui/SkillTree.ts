/**
 * @module ui/SkillTree
 * The skill tree window (it.41, hotkey K): four class paths side by side —
 * the hero's own path first and flagged — each with its four actives down
 * the tiers and two passives beneath. Nodes read LEARNED / READY / LOCKED
 * (with the reason), show their point cost (double for another class),
 * and learned actives carry a 1·2·3·4 slot picker that sets the hotbar.
 *
 * Pure DOM. Every change is an InputCommand (UNLOCK_SKILL / UNLOCK_PASSIVE
 * / EQUIP_SKILL) applied by SkillSystem inside the tick; the panel
 * re-renders on `skills:changed` / `inventory:changed`.
 */

import { eventBus } from '@/core/EventBus';
import type { InputQueue } from '@/core/InputQueue';
import { audio } from '@/engine/AudioManager';
import type { Player } from '@/entities/Player';
import { uiAssetUrl } from '@/render/SpriteLibrary';
import {
  CLASS_ORDER,
  CLASS_SKILLS,
  PASSIVES,
  PASSIVE_LEVEL,
  SYNERGY,
  SYNERGY_STATUS,
  canUnlockPassive,
  canUnlockSkill,
  skillCost,
  tierLevel,
} from '@/systems/SkillTree';
import type { ClassArchetype } from '@/network/Serialization';

const CLASS_TITLE: Record<ClassArchetype, string> = { warrior: 'WARRIOR', mage: 'MAGE', ranger: 'RANGER', rogue: 'ROGUE' };

export class SkillTreeUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private readonly offs: Array<() => void> = [];
  private readonly abort = new AbortController();
  /** Learned active awaiting a slot pick. */
  private picking: string | null = null;

  constructor(
    private readonly player: Player,
    private readonly queue: InputQueue,
    /** Respec is a town rite (it.48). */
    private readonly inTown: () => boolean = () => true,
  ) {
    this.panel = document.createElement('div');
    this.panel.id = 'skill-tree';
    document.body.appendChild(this.panel);
    this.offs.push(eventBus.on('skills:changed', () => this.visible && this.render()));
    this.offs.push(eventBus.on('inventory:changed', () => this.visible && this.render()));
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'KeyK' && !e.repeat) {
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
    this.picking = null;
    this.panel.classList.add('open');
    audio.sfx('invOpen');
    this.render();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.picking = null;
    this.panel.classList.remove('open');
    audio.sfx('invClose');
  }

  private render(): void {
    const p = this.player;
    const own = p.archetype;
    const order = [own, ...CLASS_ORDER.filter((c) => c !== own)];
    const cols = order
      .map((cls) => {
        const mine = cls === own;
        const actives = CLASS_SKILLS[cls]
          .map((def) => {
            const learned = p.unlockedSkills.has(def.id);
            const check = learned ? null : canUnlockSkill(p, def.id);
            const slot = p.loadout.indexOf(def.id);
            const cost = skillCost(p, def);
            const state = learned ? 'learned' : check?.ok ? 'ready' : 'locked';
            const picker =
              learned
                ? `<div class="st-slots">${[0, 1, 2, 3]
                    .map((i) => `<button class="st-slot${slot === i ? ' lit' : ''}" data-equip="${def.id}" data-slot="${i}" title="Set hotkey ${i + 1}">${i + 1}</button>`)
                    .join('')}</div>`
                : '';
            const icon = def.icon
              ? `<img class="st-icon" src="${uiAssetUrl(`skills/${def.icon}.png`)}" alt="">`
              : `<span class="st-icon st-glyph">${def.glyph}</span>`;
            const meta = learned
              ? slot >= 0
                ? `HOTKEY ${slot + 1}`
                : 'LEARNED · pick a hotkey'
              : check?.ok
                ? `LEARN · ${cost} pt${cost > 1 ? 's' : ''}`
                : `LOCKED · ${check?.reason ?? ''}`;
            return `
              <div class="st-node st-${state}${mine ? ' st-own' : ''}${this.picking === def.id ? ' picking' : ''}" data-skill="${def.id}" data-state="${state}">
                <div class="st-tier">T${def.tier} · L${tierLevel(def.tier)}</div>
                ${icon}${state === 'locked' ? '<span class="st-lock" aria-hidden="true">🔒</span>' : ''}
                <div class="st-text"><b>${def.name}</b><span>${def.hint}</span><em>${meta}</em></div>
                ${picker}
              </div>`;
          })
          .join('');
        const passives = PASSIVES[cls]
          .map((def) => {
            const learned = p.passives.has(def.id);
            const check = learned ? null : canUnlockPassive(p, def.id);
            const cost = skillCost(p, def);
            const state = learned ? 'learned' : check?.ok ? 'ready' : 'locked';
            const meta = learned ? 'LEARNED' : check?.ok ? `LEARN · ${cost} pt${cost > 1 ? 's' : ''}` : `LOCKED · ${check?.reason ?? ''}`;
            return `
              <div class="st-node st-passive st-${state}${mine ? ' st-own' : ''}" data-passive="${def.id}" data-state="${state}">
                <div class="st-tier">PASSIVE · L${PASSIVE_LEVEL}</div>
                <span class="st-icon st-glyph">${def.glyph}</span>${state === 'locked' ? '<span class="st-lock" aria-hidden="true">🔒</span>' : ''}
                <div class="st-text"><b>${def.name}</b><span>${def.hint}</span><em>${meta}</em></div>
              </div>`;
          })
          .join('');
        return `
          <div class="st-col${mine ? ' st-col-own' : ''}">
            <h4>${CLASS_TITLE[cls]}${mine ? '<i>YOUR PATH · SYNERGY</i>' : '<i>cross-class · 2 pts</i>'}</h4>
            ${actives}
            <div class="st-passive-head">PASSIVES</div>
            ${passives}
          </div>`;
      })
      .join('');
    const bar = [0, 1, 2, 3]
      .map((i) => {
        const id = p.loadout[i];
        const def = id ? CLASS_SKILLS[own].concat(...CLASS_ORDER.map((c) => CLASS_SKILLS[c])).find((d) => d.id === id) : null;
        const inner = def
          ? def.icon
            ? `<img src="${uiAssetUrl(`skills/${def.icon}.png`)}" alt="${def.name}">`
            : `<span>${def.glyph}</span>`
          : '<span class="st-empty">—</span>';
        return `<button class="st-bar-slot${this.picking ? ' target' : ''}" data-barslot="${i}" title="${def ? def.name : 'empty'}"><kbd>${i + 1}</kbd>${inner}</button>`;
      })
      .join('');
    this.panel.innerHTML = `
      <div class="st-head drag-handle">
        <h3>SKILL TREE</h3>
        <span class="st-points">${p.skillPoints} SKILL POINT${p.skillPoints === 1 ? '' : 'S'}</span>
        <span class="st-level">LEVEL ${p.level}</span>
        <button class="st-respec" data-respec${this.inTown() ? '' : ' disabled'} title="${this.inTown() ? 'Refund every learned skill and passive' : 'Only in town or at the camp'}">RESET SKILLS${this.inTown() ? '' : ' · TOWN ONLY'}</button>
        <button class="tp-close" data-close>✕</button>
      </div>
      <div class="st-synergy">Your class path casts at <b>+${Math.round((SYNERGY.power - 1) * 100)}% power</b>, <b>${Math.round((1 - SYNERGY.cooldown) * 100)}% shorter cooldowns</b>, and every hit inflicts <b>${SYNERGY_STATUS[own]}</b>. Other paths cost two points a rank.</div>
      <div class="st-cols">${cols}</div>
      <div class="st-bar">${bar}<span class="st-bar-note">${this.picking ? 'Choose a hotkey for the selected skill' : 'Learned skills go on the hotbar: pick 1 · 2 · 3 · 4 on the node, or click a learned skill then a slot'}</span></div>`;

    this.panel.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.panel.querySelector('[data-respec]')?.addEventListener('click', () => {
      if (!this.inTown()) {
        audio.sfx('uiBack');
        return;
      }
      audio.sfx('uiConfirm');
      this.queue.enqueue({ type: 'RESET_SKILLS', playerId: 0 });
    });
    this.panel.querySelectorAll<HTMLElement>('.st-node[data-skill]').forEach((node) => {
      node.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.st-slot')) return;
        const id = node.dataset.skill!;
        const state = node.dataset.state;
        if (state === 'ready') {
          audio.sfx('uiClick');
          this.queue.enqueue({ type: 'UNLOCK_SKILL', playerId: 0, id });
        } else if (state === 'learned') {
          audio.sfx('uiHover');
          this.picking = this.picking === id ? null : id;
          this.render();
        } else {
          audio.sfx('uiBack');
        }
      });
      node.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    });
    this.panel.querySelectorAll<HTMLElement>('.st-node[data-passive]').forEach((node) => {
      node.addEventListener('click', () => {
        if (node.dataset.state === 'ready') {
          audio.sfx('uiClick');
          this.queue.enqueue({ type: 'UNLOCK_PASSIVE', playerId: 0, id: node.dataset.passive! });
        } else audio.sfx('uiBack');
      });
    });
    this.panel.querySelectorAll<HTMLButtonElement>('.st-slot').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.sfx('uiClick');
        this.picking = null;
        this.queue.enqueue({ type: 'EQUIP_SKILL', playerId: 0, slot: Number(b.dataset.slot), id: b.dataset.equip! });
      });
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-barslot]').forEach((b) => {
      b.addEventListener('click', () => {
        const slot = Number(b.dataset.barslot);
        if (this.picking) {
          audio.sfx('uiClick');
          this.queue.enqueue({ type: 'EQUIP_SKILL', playerId: 0, slot, id: this.picking });
          this.picking = null;
        } else if (p.loadout[slot]) {
          audio.sfx('uiBack');
          this.queue.enqueue({ type: 'EQUIP_SKILL', playerId: 0, slot, id: null }); // Clear the slot.
        }
      });
    });
  }

  destroy(): void {
    this.abort.abort();
    for (const off of this.offs) off();
    this.panel.remove();
  }
}
