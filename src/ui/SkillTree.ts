/**
 * @module ui/SkillTree
 * The skill tree window (it.41, hotkey K): four class paths side by side —
 * the hero's own path first and flagged — each with its four actives down
 * the tiers and two passives beneath.
 *
 * NODE STATES (it.62) read at a glance:
 *   UNLOCKED  full-colour icon, gold border and glow, a gold rank badge
 *             (`2/4`), and a slow ambient pulse.
 *   READY     a pulsing bronze border and a bright `+` corner.
 *   LOCKED    the icon desaturated to half, weathered iron border, a
 *             padlock watermark and muted text.
 * Every node's tooltip opens with `[UNLOCKED · LEVEL x/y]`,
 * `[READY TO LEARN · n points]` or `[LOCKED · REQUIRES LEVEL n]`.
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
import { keepScroll } from './keepScroll';

const CLASS_TITLE: Record<ClassArchetype, string> = { warrior: 'WARRIOR', mage: 'MAGE', ranger: 'RANGER', rogue: 'ROGUE' };

/** Text bound for a `title=` attribute. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The tooltip's opening line says the state outright (it.62), then the
 * name, what it does, and what it would cost.
 */
function tooltip(state: string, badge: string, name: string, hint: string, cost: number, reason: string | undefined, needLevel: number): string {
  const head =
    state === 'learned'
      ? `[UNLOCKED · LEVEL ${badge}]`
      : state === 'ready'
        ? `[READY TO LEARN · ${cost} SKILL POINT${cost > 1 ? 'S' : ''}]`
        : /level/i.test(reason ?? '')
          ? `[LOCKED · REQUIRES LEVEL ${needLevel}]`
          : `[LOCKED · ${(reason ?? 'unavailable').toUpperCase()}]`;
  const tail = state === 'learned' ? '' : state === 'ready' ? '\nClick to learn it.' : `\n${reason ?? ''}`;
  return `${head}\n${name} — ${hint}${tail}`;
}

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

  /** Repaint without losing where the player had scrolled (it.79). */
  private render(): void {
    keepScroll(this.panel, () => this.paint());
  }

  private paint(): void {
    const p = this.player;
    const own = p.archetype;
    const order = [own, ...CLASS_ORDER.filter((c) => c !== own)];
    const cols = order
      .map((cls) => {
        const mine = cls === own;
        const tierCount = CLASS_SKILLS[cls].length;
        const actives = CLASS_SKILLS[cls]
          .map((def) => {
            const learned = p.unlockedSkills.has(def.id);
            const check = learned ? null : canUnlockSkill(p, def.id);
            const slot = p.loadout.indexOf(def.id);
            const cost = skillCost(p, def);
            const state = learned ? 'learned' : check?.ok ? 'ready' : 'locked';
            const badge = `${def.tier}/${tierCount}`;
            const tip = tooltip(state, badge, def.name, def.hint, cost, check?.reason, tierLevel(def.tier));
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
              <div class="st-node st-${state}${mine ? ' st-own' : ''}${this.picking === def.id ? ' picking' : ''}" data-skill="${def.id}" data-state="${state}" title="${esc(tip)}">
                <div class="st-tier">T${def.tier} · L${tierLevel(def.tier)}</div>
                <span class="st-badge">${badge}</span>
                ${state === 'ready' ? '<span class="st-plus" aria-hidden="true">+</span>' : ''}
                ${icon}${state === 'locked' ? '<span class="st-lock" aria-hidden="true"></span>' : ''}
                <div class="st-text"><b>${def.name}</b><span>${def.hint}</span><em>${meta}</em></div>
                ${picker}
              </div>`;
          })
          .join('');
        const passiveCount = PASSIVES[cls].length;
        const passives = PASSIVES[cls]
          .map((def, i) => {
            const learned = p.passives.has(def.id);
            const check = learned ? null : canUnlockPassive(p, def.id);
            const cost = skillCost(p, def);
            const state = learned ? 'learned' : check?.ok ? 'ready' : 'locked';
            const meta = learned ? 'LEARNED' : check?.ok ? `LEARN · ${cost} pt${cost > 1 ? 's' : ''}` : `LOCKED · ${check?.reason ?? ''}`;
            const badge = `${i + 1}/${passiveCount}`;
            const tip = tooltip(state, badge, def.name, def.hint, cost, check?.reason, PASSIVE_LEVEL);
            return `
              <div class="st-node st-passive st-${state}${mine ? ' st-own' : ''}" data-passive="${def.id}" data-state="${state}" title="${esc(tip)}">
                <div class="st-tier">PASSIVE · L${PASSIVE_LEVEL}</div>
                <span class="st-badge">${badge}</span>
                ${state === 'ready' ? '<span class="st-plus" aria-hidden="true">+</span>' : ''}
                <span class="st-icon st-glyph">${def.glyph}</span>${state === 'locked' ? '<span class="st-lock" aria-hidden="true"></span>' : ''}
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
        <button class="tp-close" data-close title="Close (ESC)"><i></i></button>
      </div>
      <div class="st-synergy">Your class path casts at <b>+${Math.round((SYNERGY.power - 1) * 100)}% power</b>, <b>${Math.round((1 - SYNERGY.cooldown) * 100)}% shorter cooldowns</b>, and every hit inflicts <b>${SYNERGY_STATUS[own]}</b>. Other paths cost two points a rank.</div>
      <div class="st-cols">${cols}</div>
      <div class="st-bar">${bar}<span class="st-bar-note">${this.picking ? 'Choose a hotkey for the selected skill' : 'Learned skills go on the hotbar: pick 1 · 2 · 3 · 4 on the node, or click a learned skill then a slot'}</span></div>`;

    const closeBtn = this.panel.querySelector<HTMLElement>('[data-close]');
    closeBtn?.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    closeBtn?.addEventListener('click', () => {
      audio.sfx('uiClick');
      this.close();
    });
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
