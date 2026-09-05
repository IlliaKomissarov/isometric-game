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
import { canAfford, enchantCost, forgeCost, goldOnlyCost, knownBlueprints, REINFORCE_CHANCE, rerollCost, reinforceCost, salvageYield, TRANSMUTE_RECIPES, type Cost } from '@/systems/Crafting';
import { ENCHANTS, effectLine } from '@/items/effects';
import { RARITY_ORDER } from '@/items/catalog';
import { itemIconHtml } from './itemIcons';
import { hideItemTip, wireItemTips, wornFor } from './itemTip';
import { effectClass, filterBarHtml, loadFilter, orderIndexes, wireFilterBar, type FilterState } from './itemFilter';
import { keepScroll } from './keepScroll';

type Tab = 'salvage' | 'forge' | 'transmute' | 'refine' | 'reinforce' | 'enchant' | 'recipes';

const TABS: Array<[Tab, string]> = [
  ['salvage', 'SALVAGE'],
  ['forge', 'FORGE'],
  ['transmute', 'TRANSMUTE'],
  ['refine', 'REFINE'],
  ['reinforce', 'REINFORCE'],
  ['enchant', 'ENCHANT'],
  ['recipes', 'RECIPES'],
];

const iconHtml = (def: ItemDef): string => itemIconHtml(def);

export class CampCraftingUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private tab: Tab = 'salvage';
  /** The pack item under the anvil (by id, so a re-render keeps it). */
  private picked: string | null = null;
  private log = 'Bring steel to the anvil.';
  /** FILTERS (it.81): the forge's, remembered. */
  private readonly filter: FilterState = loadFilter('forge');
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
    this.offs.push(eventBus.on('recipes:changed', () => this.visible && this.render()));
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
    const defs = this.player.backpack.map((id) => {
      const d = itemDef(id);
      return d && filter(d) ? d : undefined;
    });
    const rows = orderIndexes(defs, this.filter)
      .map((i) => {
        const def = defs[i]!;
        const id = this.player.backpack[i];
        const on = this.picked === id ? ' on' : '';
        return `<button class="tp-row rarity-${def.rarity}${on} ${effectClass(def)}" ${action}="${i}" data-tip="${def.id}">${iconHtml(def)}<span class="tp-name">${def.name}<span class="tp-meta">${def.ilvl ? `iLvl ${def.ilvl} · ` : ''}${def.rarity}</span></span>${trailing(def, i)}</button>`;
      })
      .join('');
    return `${filterBarHtml(this.filter, { id: 'if-forge' })}${rows || '<span class="tp-empty">Nothing in the pack for this</span>'}`;
  }

  /** Repaint without losing where the player had scrolled (it.79). */
  private render(): void {
    keepScroll(this.panel, () => this.paint());
  }

  private paint(): void {
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
        const bps = knownBlueprints(this.deepestFloor());
        const rows = orderIndexes(bps, { ...this.filter, sort: this.filter.sort === 'default' ? 'type' : this.filter.sort })
          .map((i) => bps[i])
          .map((b) => {
            const cost = forgeCost(b, ilvl);
            const poor = !canAfford(p, cost);
            return `<button class="tp-row rarity-uncommon${poor ? ' poor' : ''}" data-forge="${b.id}" data-tip="${b.id}">${iconHtml(b)}<span class="tp-name">${b.name}<span class="tp-meta">${b.slot === 'mainHand' ? b.weaponKind ?? 'blade' : b.slot} · rolls at iLvl ${ilvl}</span></span><span class="tp-gold">${this.costHtml(cost)}</span></button>`;
          })
          .join('');
        body = `<div class="tp-col"><h4>BLUEPRINTS · ${bps.length} known · uncommon or better</h4><div class="tp-list">${filterBarHtml(this.filter, { id: 'if-forge' })}${rows || '<span class="tp-empty">Delve deeper to learn blueprints</span>'}</div></div>`;
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
              <button class="ds-btn craft-go" data-reinforce ${poor ? 'disabled' : ''}>REINFORCE TO +${plan.next} · MATERIALS</button>
              <button class="ds-btn craft-go craft-go-gold" data-reinforce-gold ${p.gold < goldOnlyCost(plan.cost) ? 'disabled' : ''}>PAY IN GOLD · ${goldOnlyCost(plan.cost)}◆</button>
              <div class="tp-meta">Every level adds 5% to the base. The forge takes gold alone at two and a half times the materials' worth.</div></div>`;
          }
        }
        body = `<div class="tp-col"><h4>REINFORCE · the pack</h4><div class="tp-list">${list}</div></div><div class="tp-col"><h4>THE ANVIL</h4>${detail}</div>`;
        break;
      }
    }
    if (this.tab === 'enchant') body = this.enchantBody();
    if (this.tab === 'recipes') body = this.recipesBody();
    this.panel.innerHTML = `
      <div class="tp-head drag-handle"><h3>THE CAMP FORGE</h3><span class="tp-vendor">campfire · anvil</span><span class="tp-purse">◆ ${p.gold} gold</span><button class="tp-close" data-close title="Close (ESC)"><i></i></button></div>
      <div class="craft-pouch">${this.pouch()}</div>
      <div class="tp-tabs craft-tabs" role="tablist">${tabs}</div>
      <div class="tp-cols craft-cols">${body}</div>
      <div class="tp-note craft-log ${this.logOk ? '' : 'bad'}">${this.log}</div>`;
    this.wire();
  }

  /** ENCHANT (it.80): a learned recipe onto a weapon. */
  private enchantBody(): string {
    const p = this.player;
    const list = this.packRows((d) => d.slot === 'mainHand', 'data-pick', (d) => (d.enchant ? `<span class="tp-gold">${ENCHANTS[d.enchant]?.name ?? d.enchant}</span>` : ''));
    const def = itemDef(this.picked ?? '');
    const idx = this.picked ? p.backpack.indexOf(this.picked) : -1;
    let detail = '<span class="tp-empty">Pick a weapon, then a recipe you have learned</span>';
    if (def && idx >= 0 && def.slot === 'mainHand') {
      const known = [...p.recipes].map((k) => ENCHANTS[k]).filter(Boolean);
      const rows = known
        .map((r) => {
          const cost = enchantCost(def, r.key)!;
          const poor = !canAfford(p, cost);
          const cur = def.enchant === r.key;
          const icon = itemDef(`recipe_${r.key}`);
          return `<div class="tp-row craft-affix rarity-rare">${icon ? iconHtml(icon) : ''}<span class="tp-name">${r.name}<span class="tp-meta">${effectLine(r.effect)}</span></span><span class="craft-actions">${this.costHtml(cost)}<button class="ds-btn" data-enchant="${r.key}" ${poor || cur ? 'disabled' : ''}>${cur ? 'LAID' : 'ENCHANT'}</button></span></div>`;
        })
        .join('');
      detail = `<div class="craft-detail"><div class="craft-pick rarity-${def.rarity}">${iconHtml(def)}<b>${def.name}</b><span class="tp-meta">${def.enchant ? `carries ${ENCHANTS[def.enchant]?.name ?? def.enchant}` : 'no enchantment'} · a new one replaces it</span></div>${rows || '<span class="tp-empty">No recipes learned — read a scroll from the depths or the alchemist</span>'}</div>`;
    }
    return `<div class="tp-col"><h4>ENCHANT · weapons in the pack</h4><div class="tp-list">${list}</div></div><div class="tp-col"><h4>KNOWN RECIPES · ${p.recipes.size}</h4>${detail}</div>`;
  }

  /** RECIPES (it.80): the forge's book — every rule in one place. */
  private recipesBody(): string {
    const p = this.player;
    const odds = REINFORCE_CHANCE.slice(1)
      .map((c, i) => {
        const n = i + 1;
        const cls = c >= 0.8 ? 'safe' : c >= 0.4 ? 'risky' : 'grim';
        return `<span class="rb-odd ${cls}"><b>+${n}</b>${Math.round(c * 100)}%${n >= 13 ? '<i>catalyst</i>' : n >= 8 ? '<i>risk</i>' : ''}</span>`;
      })
      .join('');
    const trans = TRANSMUTE_RECIPES.map((r) => {
      const a = itemDef(r.from);
      const b = itemDef(r.to);
      return `<div class="rb-line">${a ? iconHtml(a) : ''}<span>${r.take} ${a?.name ?? r.from}</span><em>→</em>${b ? iconHtml(b) : ''}<span>${r.give} ${b?.name ?? r.to}</span></div>`;
    }).join('');
    const salvage = RARITY_ORDER.map((r) => {
      const y = salvageYield({ id: 'x', name: 'x', slot: 'mainHand', rarity: r, color: 0, ilvl: 1 } as ItemDef) ?? {};
      return `<div class="rb-line"><span class="rarity-${r} rb-rar">${r}</span><em>→</em><span>${this.costHtml(y)}</span></div>`;
    }).join('');
    const ench = Object.values(ENCHANTS)
      .map((r) => {
        const known = p.recipes.has(r.key);
        const icon = itemDef(`recipe_${r.key}`);
        return `<div class="rb-card${known ? ' known' : ''}">${icon ? iconHtml(icon) : ''}<div><b>${r.name}</b><span>${effectLine(r.effect)}</span><small>${known ? 'LEARNED' : `a scroll from depth ${r.depth} on, or the alchemist`} · ${r.essence} essence · ${r.dust} dust · 30% of the weapon's worth</small></div></div>`;
      })
      .join('');
    return `<div class="tp-col rb-col">
      <h4>REINFORCEMENT · +5% to the base a level</h4><div class="rb-odds">${odds}</div>
      <div class="tp-meta">Materials and 35% of the item's worth + 12·n² gold, or gold alone at 2.5× the materials. From +8 a failure drops one level; the item never breaks.</div>
      <h4>TRANSMUTATION</h4>${trans}
      <h4>SALVAGE · by rarity, × (1 + iLvl ÷ 25)</h4>${salvage}
      <h4>BLUEPRINTS · ${knownBlueprints(this.deepestFloor()).length} known</h4><div class="tp-meta">Every base whose level band the deepest depth has reached. Forged pieces roll uncommon or better at that depth's level.</div>
    </div><div class="tp-col rb-col"><h4>ENCHANTMENTS · ${p.recipes.size} of ${Object.keys(ENCHANTS).length} learned</h4>${ench}</div>`;
  }

  private wire(): void {
    const q = this.queue;
    const closeBtn = this.panel.querySelector<HTMLElement>('[data-close]');
    closeBtn?.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    closeBtn?.addEventListener('click', () => {
      audio.sfx('uiClick');
      this.close();
    });
    const bar = this.panel.querySelector<HTMLElement>('#if-forge');
    if (bar) wireFilterBar(bar, 'forge', this.filter, () => this.render());
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
    this.panel.querySelector<HTMLButtonElement>('[data-reinforce-gold]')?.addEventListener('click', () => {
      const idx = this.picked ? this.player.backpack.indexOf(this.picked) : -1;
      if (idx >= 0) q.enqueue({ type: 'REINFORCE', playerId: 0, backpackIndex: idx, payGold: true });
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-enchant]').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = this.picked ? this.player.backpack.indexOf(this.picked) : -1;
        if (idx >= 0) q.enqueue({ type: 'ENCHANT', playerId: 0, backpackIndex: idx, key: b.dataset.enchant! });
      });
    });
    this.panel.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('mouseenter', () => audio.sfx('uiHover')));
    wireItemTips(this.panel, (id) => itemDef(id) ?? ITEMS[id], (def) => (def.slot === 'material' ? 'a crafting material' : `worth ${itemValue(def)} gold · at the forge`), (def) => wornFor(this.player, def));
  }
}
