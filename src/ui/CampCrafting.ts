/**
 * @module ui/CampCrafting
 * THE CAMP FORGE panel (it.78): five tabs over the hero's pack and pouch —
 * SALVAGE (break gear into materials), FORGE (blueprints at the deepest
 * depth's level), TRANSMUTE (five into one), REFINE (reroll one affix on
 * rare and better) and REINFORCE (+1 … +15 with the odds on the anvil).
 * Pure presentation: every button enqueues a command; the crafting engine
 * answers through `craft:result`, which the log line at the bottom shows.
 * Touch: every control is a wide button; the item card rides a long press.
 */

import { eventBus } from '@/core/EventBus';
import type { InputQueue } from '@/core/InputQueue';
import { audio } from '@/engine/AudioManager';
import type { Player } from '@/entities/Player';
import { ITEMS, itemValue, type ItemDef } from '@/items/catalog';
import { ilvlForDepth, itemDef } from '@/items/instance';
import { MATERIAL_ORDER } from '@/items/registry';
import { canAfford, forgeCost, knownBlueprints, rerollCost, reinforceCost, salvageYield, TRANSMUTE_RECIPES, type Cost } from '@/systems/Crafting';
import { itemIconHtml } from './itemIcons';
import { hideItemTip, wireItemTips, wornFor } from './itemTip';

type Tab = 'salvage' | 'forge' | 'transmute' | 'refine' | 'reinforce';

const TABS: Array<[Tab, string]> = [
  ['salvage', 'SALVAGE'],
  ['forge', 'FORGE'],
  ['transmute', 'TRANSMUTE'],
  ['refine', 'REFINE'],
  ['reinforce', 'REINFORCE'],
];

const iconHtml = (def: ItemDef): string => itemIconHtml(def);

export class CampCraftingUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private tab: Tab = 'salvage';
  /** The pack item under the anvil (by id, so a re-render keeps it). */
  private picked: string | null = null;
  private log = 'Bring steel to the anvil.';
  private logOk = true;
  private readonly offs: Array<() => void> = [];
  private readonly abort = new AbortController();

  constructor(
    private readonly player: Player,
    private readonly queue: InputQueue,
    private readonly deepestFloor: () => number,
  ) {
    this.panel = document.createElement('div');
    this.panel.id = 'craft-panel';
    this.panel.className = 'town-panel';
    document.body.appendChild(this.panel);
    this.offs.push(eventBus.on('inventory:changed', () => this.visible && this.render()));
    this.offs.push(eventBus.on('materials:changed', () => this.visible && this.render()));
    this.offs.push(
      eventBus.on('craft:result', ({ ok, text, itemId }) => {
        this.log = text;
        this.logOk = ok;
        if (itemId) this.picked = itemId;
        if (this.visible) {
          audio.sfx(ok ? 'equip' : 'uiBack');
          this.render();
        }
      }),
    );
    this.offs.push(
      eventBus.on('craft:reinforced', ({ ok }) => {
        if (this.visible) audio.sfx(ok ? 'rarePickup' : 'hit');
      }),
    );
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

  open(tab?: Tab): void {
    if (tab) this.tab = tab;
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
    hideItemTip();
    audio.sfx('invClose');
  }

  destroy(): void {
    this.abort.abort();
    for (const off of this.offs) off();
    hideItemTip();
    this.panel.remove();
  }

  // ---- Rendering -----------------------------------------------------------------

  private pouch(): string {
    return MATERIAL_ORDER.map((mid) => {
      const def = itemDef(mid);
      const n = this.player.materials.get(mid) ?? 0;
      if (!def) return '';
      return `<span class="inv-mat${n ? '' : ' empty'}" title="${def.name}">${iconHtml(def)}<b>${n}</b></span>`;
    }).join('');
  }

  private costHtml(cost: Cost): string {
    const p = this.player;
    const parts: string[] = [];
    for (const [k, n] of Object.entries(cost)) {
      if (!n) continue;
      if (k === 'gold') {
        parts.push(`<i class="${p.gold < n ? 'short' : ''}">${n}◆</i>`);
        continue;
      }
      const def = itemDef(k);
      const have = p.materials.get(k) ?? 0;
      parts.push(`<i class="${have < n ? 'short' : ''}" title="${def?.name ?? k}">${def ? iconHtml(def) : ''}${n}</i>`);
    }
    return `<span class="craft-cost">${parts.join('')}</span>`;
  }

  private packRows(filter: (def: ItemDef) => boolean, action: string, trailing: (def: ItemDef, i: number) => string): string {
    const rows = this.player.backpack
      .map((id, i) => {
        const def = itemDef(id);
        if (!def || !filter(def)) return '';
        const on = this.picked === id ? ' on' : '';
        return `<button class="tp-row rarity-${def.rarity}${on}" ${action}="${i}" data-tip="${def.id}">${iconHtml(def)}<span class="tp-name">${def.name}<span class="tp-meta">${def.ilvl ? `iLvl ${def.ilvl} · ` : ''}${def.rarity}</span></span>${trailing(def, i)}</button>`;
      })
      .join('');
    return rows || '<span class="tp-empty">Nothing in the pack for this</span>';
  }

  private render(): void {
    const p = this.player;
    const tabs = TABS.map(([id, label]) => `<button class="ds-btn" type="button" role="tab" data-crafttab="${id}" aria-selected="${this.tab === id}">${label}</button>`).join('');
    let body = '';
    switch (this.tab) {
      case 'salvage':
        body = `<div class="tp-col"><h4>BREAK DOWN · the pack</h4><div class="tp-list">${this.packRows(
          (d) => !!salvageYield(d),
          'data-salvage',
          (d) => `<span class="tp-gold">${this.costHtml(salvageYield(d) ?? {})}</span>`,
        )}</div></div>`;
        break;
      case 'forge': {
        const ilvl = ilvlForDepth(Math.max(1, this.deepestFloor()));
        const rows = knownBlueprints(this.deepestFloor())
          .map((b) => {
            const cost = forgeCost(b, ilvl);
            const poor = !canAfford(p, cost);
            return `<button class="tp-row rarity-uncommon${poor ? ' poor' : ''}" data-forge="${b.id}" data-tip="${b.id}">${iconHtml(b)}<span class="tp-name">${b.name}<span class="tp-meta">${b.slot === 'mainHand' ? b.weaponKind ?? 'blade' : b.slot} · rolls at iLvl ${ilvl}</span></span><span class="tp-gold">${this.costHtml(cost)}</span></button>`;
          })
          .join('');
        body = `<div class="tp-col"><h4>BLUEPRINTS · ${rows ? knownBlueprints(this.deepestFloor()).length : 0} known · uncommon or better</h4><div class="tp-list">${rows || '<span class="tp-empty">Delve deeper to learn blueprints</span>'}</div></div>`;
        break;
      }
      case 'transmute': {
        const rows = TRANSMUTE_RECIPES.map((r) => {
          const from = itemDef(r.from);
          const to = itemDef(r.to);
          const have = p.materials.get(r.from) ?? 0;
          const can = Math.floor(have / r.take);
          return `<div class="tp-row craft-recipe rarity-${to?.rarity ?? 'common'}">${from ? iconHtml(from) : ''}<span class="tp-name">${r.take} ${from?.name ?? r.from} → ${r.give} ${to?.name ?? r.to}<span class="tp-meta">you hold ${have}</span></span><span class="craft-actions"><button class="ds-btn" data-transmute="${r.id}" data-times="1" ${can < 1 ? 'disabled' : ''}>×1</button><button class="ds-btn" data-transmute="${r.id}" data-times="5" ${can < 5 ? 'disabled' : ''}>×5</button></span></div>`;
        }).join('');
        body = `<div class="tp-col"><h4>TRANSMUTE · lesser into greater</h4><div class="tp-list">${rows}</div></div>`;
        break;
      }
      case 'refine': {
        const list = this.packRows((d) => !!rerollCost(d, 0), 'data-pick', () => '');
        const def = itemDef(this.picked ?? '');
        const idx = this.picked ? p.backpack.indexOf(this.picked) : -1;
        let detail = '<span class="tp-empty">Pick a rare or better piece to reroll one of its lines</span>';
        if (def && idx >= 0 && rerollCost(def, 0)) {
          const lines = (def.affixes ?? [])
            .map((_, i) => {
              const cost = rerollCost(def, i)!;
              const poor = !canAfford(p, cost);
              return `<div class="tp-row craft-affix"><span class="tp-name">${def.affixLines?.[i] ?? ''}</span><span class="craft-actions">${this.costHtml(cost)}<button class="ds-btn" data-reroll="${i}" ${poor ? 'disabled' : ''}>REROLL</button></span></div>`;
            })
            .join('');
          detail = `<div class="craft-detail"><div class="craft-pick rarity-${def.rarity}">${iconHtml(def)}<b>${def.name}</b><span class="tp-meta">iLvl ${def.ilvl ?? 1} · ${def.rarity}</span></div>${lines}</div>`;
        }
        body = `<div class="tp-col"><h4>REFINE · rare and better</h4><div class="tp-list">${list}</div></div><div class="tp-col"><h4>THE LINES</h4>${detail}</div>`;
        break;
      }
      case 'reinforce': {
        const list = this.packRows((d) => !!reinforceCost(d) || (d.upgrade ?? 0) > 0, 'data-pick', (d) => `<span class="tp-gold">+${d.upgrade ?? 0}</span>`);
        const def = itemDef(this.picked ?? '');
        const idx = this.picked ? p.backpack.indexOf(this.picked) : -1;
        let detail = '<span class="tp-empty">Pick a piece to reinforce · each level adds 5% to its base</span>';
        if (def && idx >= 0) {
          const plan = reinforceCost(def);
          if (!plan) detail = `<div class="craft-detail"><div class="craft-pick rarity-${def.rarity}">${iconHtml(def)}<b>${def.name}</b><span class="tp-meta">at the cap · +15</span></div></div>`;
          else {
            const poor = !canAfford(p, plan.cost);
            detail = `<div class="craft-detail"><div class="craft-pick rarity-${def.rarity}">${iconHtml(def)}<b>${def.name}</b><span class="tp-meta">iLvl ${def.ilvl ?? 1} · +${def.upgrade ?? 0} → +${plan.next}</span></div>
              <div class="craft-odds ${plan.chance >= 0.8 ? 'safe' : plan.chance >= 0.4 ? 'risky' : 'grim'}"><b>${Math.round(plan.chance * 100)}%</b> chance${plan.risk ? ' · a failure drops one level' : ' · a failure only spends the materials'}</div>
              <div class="craft-costline">${this.costHtml(plan.cost)}</div>
              <button class="ds-btn craft-go" data-reinforce ${poor ? 'disabled' : ''}>REINFORCE TO +${plan.next}</button></div>`;
          }
        }
        body = `<div class="tp-col"><h4>REINFORCE · the pack</h4><div class="tp-list">${list}</div></div><div class="tp-col"><h4>THE ANVIL</h4>${detail}</div>`;
        break;
      }
    }
    this.panel.innerHTML = `
      <div class="tp-head drag-handle"><h3>THE CAMP FORGE</h3><span class="tp-vendor">campfire · anvil</span><span class="tp-purse">◆ ${p.gold} gold</span><button class="tp-close" data-close title="Close (ESC)"><i></i></button></div>
      <div class="craft-pouch">${this.pouch()}</div>
      <div class="tp-tabs craft-tabs" role="tablist">${tabs}</div>
      <div class="tp-cols craft-cols">${body}</div>
      <div class="tp-note craft-log ${this.logOk ? '' : 'bad'}">${this.log}</div>`;
    this.wire();
  }

  private wire(): void {
    const q = this.queue;
    const closeBtn = this.panel.querySelector<HTMLElement>('[data-close]');
    closeBtn?.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    closeBtn?.addEventListener('click', () => {
      audio.sfx('uiClick');
      this.close();
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-crafttab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = (b.dataset.crafttab as Tab) ?? 'salvage';
        audio.sfx('uiClick');
        this.render();
      });
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-salvage]').forEach((b) => {
      b.addEventListener('click', () => q.enqueue({ type: 'SALVAGE', playerId: 0, backpackIndex: Number(b.dataset.salvage) }));
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-forge]').forEach((b) => {
      b.addEventListener('click', () => q.enqueue({ type: 'FORGE', playerId: 0, base: b.dataset.forge! }));
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-transmute]').forEach((b) => {
      b.addEventListener('click', () => q.enqueue({ type: 'TRANSMUTE', playerId: 0, recipe: b.dataset.transmute!, times: Number(b.dataset.times) || 1 }));
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => {
      b.addEventListener('click', () => {
        this.picked = this.player.backpack[Number(b.dataset.pick)] ?? null;
        audio.sfx('uiClick');
        this.render();
      });
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-reroll]').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = this.picked ? this.player.backpack.indexOf(this.picked) : -1;
        if (idx >= 0) q.enqueue({ type: 'REROLL', playerId: 0, backpackIndex: idx, affixIndex: Number(b.dataset.reroll) });
      });
    });
    this.panel.querySelector<HTMLButtonElement>('[data-reinforce]')?.addEventListener('click', () => {
      const idx = this.picked ? this.player.backpack.indexOf(this.picked) : -1;
      if (idx >= 0) q.enqueue({ type: 'REINFORCE', playerId: 0, backpackIndex: idx });
    });
    this.panel.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('mouseenter', () => audio.sfx('uiHover')));
    wireItemTips(this.panel, (id) => itemDef(id) ?? ITEMS[id], (def) => (def.slot === 'material' ? 'a crafting material' : `worth ${itemValue(def)} gold · at the forge`), (def) => wornFor(this.player, def));
  }
}
