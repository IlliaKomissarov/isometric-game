/**
 * @module ui/Codex
 * THE CODEX (it.81): the game's own book. One panel, opened from the system
 * bar (the book) or with H, with a chapter for every system the player can
 * touch: items and rarity, item levels and the power curve, affixes, the
 * arsenal (every weapon shape and what each tier does), status effects (the
 * full mechanics and how each shows on a foe), traits, enchantments and
 * their recipes, the forge (every operation with its numbers), the belt and
 * the draughts, the merchants, combat formulas, and a legend of the
 * inventory's borders. Everything is generated from the same tables the
 * engine reads, so the book can never drift from the game.
 */

import { audio } from '@/engine/AudioManager';
import { AFFIXES, AFFIX_KEYS } from '@/items/affixes';
import { RARITY_AFFIX_COUNT, RARITY_COLOR, RARITY_MULT, RARITY_ORDER, RARITY_WEIGHT, WEAPON_FAMILY, WEAPON_TIMING, type ItemDef, type Rarity } from '@/items/catalog';
import { ENCHANTS, STATUS_INFO, TRAIT_INFO, effectLine, type Effect } from '@/items/effects';
import { itemDef } from '@/items/instance';
import { DRAUGHTS, MATERIALS, SHAPES, TIERS } from '@/items/registry';
import { QUAFF_COOLDOWN } from '@/systems/Inventory';
import { REINFORCE_CHANCE, TRANSMUTE_RECIPES, salvageYield } from '@/systems/Crafting';
import { itemIconHtml } from './itemIcons';
import { keepScroll } from './keepScroll';

type Chapter = 'items' | 'arsenal' | 'statuses' | 'traits' | 'enchants' | 'forge' | 'belt' | 'merchants' | 'combat' | 'legend';

const CHAPTERS: Array<[Chapter, string]> = [
  ['items', 'ITEMS'],
  ['arsenal', 'ARSENAL'],
  ['statuses', 'STATUSES'],
  ['traits', 'TRAITS'],
  ['enchants', 'ENCHANTS'],
  ['forge', 'FORGE'],
  ['belt', 'BELT'],
  ['merchants', 'TRADE'],
  ['combat', 'COMBAT'],
  ['legend', 'LEGEND'],
];

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const icon = (id: string): string => {
  const d = itemDef(id);
  return d ? itemIconHtml(d) : '';
};
const fxLine = (e: Effect | null | undefined): string => (e ? effectLine(e) : '—');

export class CodexUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private chapter: Chapter = 'items';
  private readonly abort = new AbortController();

  constructor(private readonly known: () => ReadonlySet<string>) {
    this.panel = document.createElement('div');
    this.panel.id = 'codex';
    this.panel.className = 'town-panel';
    document.body.appendChild(this.panel);
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'KeyH' && !e.repeat && !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) {
          e.preventDefault();
          this.toggle();
        }
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

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  open(chapter?: Chapter): void {
    if (chapter) this.chapter = chapter;
    if (this.visible) {
      if (chapter) this.render();
      return;
    }
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

  destroy(): void {
    this.abort.abort();
    this.panel.remove();
  }

  private render(): void {
    keepScroll(this.panel, () => this.paint());
  }

  private paint(): void {
    const tabs = CHAPTERS.map(([id, label]) => `<button class="ds-btn" type="button" role="tab" data-chapter="${id}" aria-selected="${this.chapter === id}">${label}</button>`).join('');
    const body = this.body();
    this.panel.innerHTML = `
      <div class="tp-head drag-handle"><h3>THE CODEX</h3><span class="tp-vendor">every rule of the crypt · H</span><button class="tp-close" data-close title="Close (H or ESC)"><i></i></button></div>
      <div class="tp-tabs codex-tabs" role="tablist">${tabs}</div>
      <div class="codex-body">${body}</div>`;
    const closeBtn = this.panel.querySelector<HTMLElement>('[data-close]');
    closeBtn?.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    closeBtn?.addEventListener('click', () => {
      audio.sfx('uiClick');
      this.close();
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach((b) => {
      b.addEventListener('click', () => {
        this.chapter = (b.dataset.chapter as Chapter) ?? 'items';
        audio.sfx('uiClick');
        this.panel.querySelector('.codex-body')?.scrollTo(0, 0);
        this.render();
      });
    });
  }

  private body(): string {
    switch (this.chapter) {
      case 'items':
        return this.items();
      case 'arsenal':
        return this.arsenal();
      case 'statuses':
        return this.statuses();
      case 'traits':
        return this.traits();
      case 'enchants':
        return this.enchants();
      case 'forge':
        return this.forge();
      case 'belt':
        return this.belt();
      case 'merchants':
        return this.merchants();
      case 'combat':
        return this.combat();
      case 'legend':
        return this.legend();
    }
  }

  // ---- Chapters -----------------------------------------------------------------

  private items(): string {
    const rows = RARITY_ORDER.map((r: Rarity) => {
      const extra = r === 'legendary' ? ' + a unique effect' : r === 'mythic' ? ' + a passive skill' : '';
      return `<tr><td><b class="cx-rar" style="color:${hex(RARITY_COLOR[r])}">${r}</b></td><td>×${RARITY_MULT[r]}</td><td>${RARITY_AFFIX_COUNT[r]}${extra}</td><td>${RARITY_WEIGHT[r]}%</td></tr>`;
    }).join('');
    const affixes = AFFIX_KEYS.map((k) => {
      const a = AFFIXES[k];
      return `<tr><td><b>${a.name}</b> <i>(${a.kind})</i></td><td>${a.line.replace('{v}', '<em>v</em>')}</td><td>${a.values.map((v) => (a.fmt === 'pct' ? `${Math.round(v * 100)}%` : v)).join(' · ')}${a.flat ? ' × power' : ''}</td></tr>`;
    }).join('');
    return `
      <section><h4>WHAT AN ITEM IS</h4>
      <p>Every piece of gear is a <b>base</b> (its shape, its icon, its level-1 numbers) rolled into an <b>instance</b> with an <b>item level</b>, a <b>rarity</b>, a <b>reinforcement</b> (+0 to +15), one to five <b>affixes</b>, and, for weapons, its <b>innate effect</b> and one <b>enchantment</b>. The card shows all of it; the cell in your pack shows the level in its corner and the reinforcement beside it.</p>
      <p><b>Item level</b> (iLvl 1–100) is the spine of the game's numbers: every stat on a piece is its base × <b>1.08</b><sup>iLvl − 1</sup>. A depth drops two levels per floor (depth I is level 1, depth X is 19, depth XX is 39), and the foes on that floor climb the same curve, so a floor's drops match its threats. A level-40 blade is not a little better than a level-20 one — it is 4.7 times the blade.</p>
      <p><b>Rarity</b> multiplies the base again and decides how many affixes the piece carries:</p>
      <table class="cx-table"><thead><tr><th>Rarity</th><th>Stat ×</th><th>Affixes</th><th>Drop weight</th></tr></thead><tbody>${rows}</tbody></table>
      <p><b>Reinforcement</b> adds 5% of the base per level: +15 is +75%. See FORGE.</p>
      <p><b>Affixes</b> are the lines under the numbers. Prefixes are the three attributes; suffixes are the offensive and defensive lines. Each has five tiers, one tier per twenty item levels with some spread; flat values grow with the power curve.</p>
      <table class="cx-table"><thead><tr><th>Line</th><th>Reads</th><th>Tiers 1–5</th></tr></thead><tbody>${affixes}</tbody></table>
      <p>Attribute points convert into the engine's levers: <b>1 Strength</b> = +1% damage and +2 max life · <b>1 Agility</b> = +0.6% attack speed and +0.3% dodge · <b>1 Intelligence</b> = +0.8% cooldown reduction and +2 max resource.</p>
      <p><b>Legendary</b> pieces also carry a unique: <i>lifesteal</i> (8% of damage returns as life), <i>cull</i> (strikes slay foes under 15%), <i>thorns</i> (attackers take 20% back), or <i>echo</i> (10% of hits strike twice). <b>Mythic</b> pieces grant a passive skill while worn.</p>
      <p><b>Materials</b> live in your pouch, never in a pack slot: ${MATERIALS.map((m) => `${icon(m.id)} ${m.name}`).join(' · ')}. They come from salvage, from the floor, and from the armorer.</p>
      </section>`;
  }

  private arsenal(): string {
    const fam = (k: keyof typeof WEAPON_TIMING): string => {
      const t = WEAPON_TIMING[k];
      const f = WEAPON_FAMILY[k];
      return `${(60 / (t.windup + t.recover)).toFixed(1)}/s · reach ${f.range} · crit ${Math.round(f.critChance * 100)}%${f.stuns ? ' · every hit staggers' : ''}`;
    };
    const families = (Object.keys(WEAPON_TIMING) as Array<keyof typeof WEAPON_TIMING>).map((k) => `<tr><td><b>${k}</b></td><td>${fam(k)}</td></tr>`).join('');
    const tiers = TIERS.map((t) => `<tr><td><b style="color:${hex(t.color)}">${t.name}</b></td><td>iLvl ${t.band[0]}–${t.band[1]}</td><td>×${t.mult}</td></tr>`).join('');
    const shapes = SHAPES.map((s) => {
      const mods = [s.speed ? `speed ×${s.speed}` : '', s.crit ? `crit +${Math.round(s.crit * 100)}%` : '', s.reach ? `reach ${s.reach > 0 ? '+' : ''}${s.reach}` : ''].filter(Boolean).join(' · ');
      return `<div class="cx-shape"><div class="cx-shape-head">${icon(`steel_${s.key}`)}<b>${s.name}</b><i>${s.kind}</i><span>${s.dmg[0]}–${s.dmg[1]} at level 1${mods ? ' · ' + mods : ''}</span></div><p>${s.desc}</p><ul><li><b style="color:${hex(TIERS[0].color)}">Steel</b> ${fxLine(s.innates[0])}</li><li><b style="color:${hex(TIERS[1].color)}">Gilded</b> ${fxLine(s.innates[1])}</li><li><b style="color:${hex(TIERS[2].color)}">Crystal</b> ${fxLine(s.innates[2])}</li></ul></div>`;
    }).join('');
    return `
      <section><h4>THE ARSENAL</h4>
      <p>Every weapon has a <b>family</b> (its swing timing and reach), a <b>shape</b> (its role: damage, speed, crit, reach) and a <b>tier</b> (its level band and multiplier). No two weapons are the same numbers behind another icon: each shape carries a different <b>innate</b> in each tier — a status proc on hit or a granted trait. Uniques (legendary and mythic only) carry two.</p>
      <p>The hero's own hand adds <b>+2% weapon damage per level</b>; a level-30 arm swings 58% harder than a level-1 one, on top of the item's level.</p>
      <table class="cx-table"><thead><tr><th>Family</th><th>Swings · reach · crit</th></tr></thead><tbody>${families}</tbody></table>
      <table class="cx-table"><thead><tr><th>Tier</th><th>Band</th><th>Base ×</th></tr></thead><tbody>${tiers}</tbody></table>
      <div class="cx-shapes">${shapes}</div>
      </section>`;
  }

  private statuses(): string {
    const cards = (Object.keys(STATUS_INFO) as Array<keyof typeof STATUS_INFO>).map((k) => {
      const s = STATUS_INFO[k];
      return `<div class="cx-card" style="--fx:${hex(s.color)}"><b>${s.name}</b><span class="cx-fx-line">${s.line(1, 1).replace('100% chance to ', 'On proc: ')}</span><p>${s.desc}</p><small>Shows as: ${s.visual}</small></div>`;
    }).join('');
    return `
      <section><h4>STATUS EFFECTS ON FOES</h4>
      <p>A weapon's proc rolls on every landed primary strike (half chance on the sweep arc). Wounds over time are <b>pure</b>: they ignore armor, never crit, never echo, and are credited to you — so kills, reaping and the bestiary follow. A status never stacks with itself; a fresh or stronger one replaces a weaker one. Every affected foe wears a coloured mark above its head and takes the status's tint until it fades.</p>
      <div class="cx-cards">${cards}</div>
      <p>Your class path lays its own status on every skill hit: the mage burns, the rogue poisons, the warrior staggers, the ranger's arrows carry the shape's proc. Poison Blade envenoms every strike for its duration.</p>
      </section>`;
  }

  private traits(): string {
    const cards = (Object.keys(TRAIT_INFO) as Array<keyof typeof TRAIT_INFO>).map((k) => {
      const t = TRAIT_INFO[k];
      return `<div class="cx-card cx-trait"><b>${t.name}</b><span class="cx-fx-line">${t.line(1)}</span><p>${t.desc}</p></div>`;
    }).join('');
    return `
      <section><h4>GRANTED TRAITS</h4>
      <p>A trait is an ability the weapon lends you while it is held. Traits from the shape's innate, a unique's second innate and an enchantment all add up: two sources of Cleave cleave harder. Swap the weapon and the trait is gone.</p>
      <div class="cx-cards">${cards}</div>
      </section>`;
  }

  private enchants(): string {
    const known = this.known();
    const cards = Object.values(ENCHANTS).map((r) => `<div class="cx-card cx-ench${known.has(r.key) ? ' known' : ''}">${icon(`recipe_${r.key}`)}<div><b>${r.name}</b> ${known.has(r.key) ? '<em>LEARNED</em>' : ''}<span class="cx-fx-line">${effectLine(r.effect)}</span><p>${r.desc}</p><small>Recipe scroll from depth ${r.depth} on (one gear drop in twenty-five), or on the alchemist's counter · the forge asks ${r.essence} essence, ${r.dust} arcane dust and 30% of the weapon's worth in gold</small></div></div>`).join('');
    return `
      <section><h4>ENCHANTMENTS</h4>
      <p>An enchantment is a recipe learned once and laid on any weapon at the camp forge (ENCHANT). It adds a proc or a trait on top of the weapon's innates, puts its word in the weapon's name ("Flaming", "Reaping") and a line on its card. A weapon holds one; a new one replaces it. Recipes are <b>scrolls</b>: read one from your pack to learn it forever.</p>
      <div class="cx-cards cx-ench-list">${cards}</div>
      </section>`;
  }

  private forge(): string {
    const odds = REINFORCE_CHANCE.slice(1).map((c, i) => `<tr><td>+${i + 1}</td><td>${Math.round(c * 100)}%</td><td>${i + 1 >= 13 ? 'a catalyst' : i + 1 >= 8 ? 'essence' : i + 1 >= 4 ? 'dust' : 'scraps'}</td><td>${i + 1 >= 8 ? 'drops one level' : 'materials only'}</td></tr>`).join('');
    const trans = TRANSMUTE_RECIPES.map((r) => `<li>${icon(r.from)} ${r.take} ${itemDef(r.from)?.name} → ${icon(r.to)} ${r.give} ${itemDef(r.to)?.name}</li>`).join('');
    const salvage = RARITY_ORDER.map((r) => {
      const y = salvageYield({ id: 'x', name: 'x', slot: 'mainHand', rarity: r, color: 0, ilvl: 1 } as ItemDef) ?? {};
      return `<tr><td><b style="color:${hex(RARITY_COLOR[r])}">${r}</b></td><td>${Object.entries(y).map(([k, n]) => `${n} ${itemDef(k)?.name ?? k}`).join(' · ')}</td></tr>`;
    }).join('');
    return `
      <section><h4>THE CAMP FORGE</h4>
      <p>The weapon rack beside the campfire. Six operations, each a command in the party's stream so every peer sees the same sparks:</p>
      <p><b>SALVAGE</b> breaks a piece into materials by its rarity, times (1 + iLvl ÷ 25):</p>
      <table class="cx-table"><tbody>${salvage}</tbody></table>
      <p><b>TRANSMUTE</b> turns lesser materials into greater, never the other way:</p><ul class="cx-list">${trans}</ul>
      <p><b>FORGE</b> makes a piece from a <b>blueprint</b> — every base whose level band the deepest depth you reached has entered. It rolls at that depth's item level, uncommon or better (uncommon 55 · rare 32 · epic 10 · legendary 2.5 · mythic 0.5), for 6 + 4·tier scraps, dust from tier 2, essence from tier 3 and 12 gold per item level.</p>
      <p><b>REFINE</b> rerolls one affix line on a rare or better piece (key and tier both roll; the other lines stay) for 1 + tier essence and 20% of the piece's worth.</p>
      <p><b>REINFORCE</b> adds 5% of the base per level, +1 to +15. Pay with materials and gold (35% of the worth + 12·n² gold, 2 + n scraps, dust from +4, essence from +8, a catalyst from +13), or in <b>gold alone</b> at two and a half times the materials' worth on top. The odds:</p>
      <table class="cx-table"><thead><tr><th>To</th><th>Odds</th><th>Needs</th><th>On failure</th></tr></thead><tbody>${odds}</tbody></table>
      <p><b>ENCHANT</b> lays a learned recipe on a weapon. See ENCHANTS.</p>
      </section>`;
  }

  private belt(): string {
    const draughts = [...['health_potion', 'mana_potion', 'elixir'].map((id) => itemDef(id)!), ...DRAUGHTS].map((d) => {
      const u = d.use ?? {};
      const what = [u.heal ? `restores ${Math.round(u.heal * 100)}% life` : '', u.resource ? `restores ${Math.round(u.resource * 100)}% resource` : '', u.haste ? `haste (+30% speed) for ${Math.round(u.haste / 60)} s` : '', u.stone ? `stone skin (40% less damage) for ${Math.round(u.stone / 60)} s` : '', u.might ? `might (+25% damage) for ${Math.round(u.might / 60)} s` : ''].filter(Boolean).join(', ');
      const cat = u.heal ? 'heal' : u.resource ? 'resource' : 'buff';
      return `<tr><td>${icon(d.id)} <b>${d.name}</b></td><td>${what}</td><td>${(QUAFF_COOLDOWN[cat] / 60).toFixed(0)} s</td><td>${d.desc ?? ''}</td></tr>`;
    }).join('');
    return `
      <section><h4>THE BELT AND THE DRAUGHTS</h4>
      <p><b>Q</b> and <b>R</b> hold whichever draught you choose: open the inventory and press the ▾ beside the key to pick any draught in your pack. The hotbar and the thumb cluster show the count and the cooldown. A refused quaff says why over your head.</p>
      <p>Draughts share cooldowns by kind: <b>healing ${QUAFF_COOLDOWN.heal / 60} s</b>, <b>resource ${QUAFF_COOLDOWN.resource / 60} s</b>, <b>brews ${QUAFF_COOLDOWN.buff / 60} s</b>. A brew refreshes its own timer; it never stacks with itself.</p>
      <table class="cx-table"><thead><tr><th>Draught</th><th>Does</th><th>Cooldown</th><th></th></tr></thead><tbody>${draughts}</tbody></table>
      </section>`;
  }

  private merchants(): string {
    return `
      <section><h4>THE MERCHANTS AND THE ECONOMY</h4>
      <p>A piece is worth <b>(iLvl × 15) × rarity × (1 + 0.15 × reinforcement)</b> gold. Draughts, materials and scrolls have fixed prices. The <b>armorer</b> sells at 100% of worth and pays 25%; the <b>alchemist</b> keeps every draught and, now and then, a recipe scroll.</p>
      <p><b>BUYBACK</b> keeps the last fifteen pieces you sold, for exactly what was paid, across restocks. The counters <b>restock every thirty in-game minutes</b> or the moment a warden falls, rolled at the deepest depth's level, so the armorer keeps pace with you.</p>
      <p>Gold piles on the floor grow at half the power curve while prices grow at all of it: gold stays scarce. A Gilded weapon (Fortune) lifts every pile by a quarter; the forge past +8 is where the gold goes.</p>
      </section>`;
  }

  private combat(): string {
    return `
      <section><h4>COMBAT</h4>
      <p><b>To hit.</b> A strike lands 85% of the time; the arc behind it sweeps every other foe inside the reach plus 0.4 tiles within a 70° cone, each with its own roll.</p>
      <p><b>Damage.</b> The weapon's range × your damage multiplier (skill buffs, "+% damage", Berserk) × 2 on a critical (2.4 with Precision).</p>
      <p><b>Armor</b> turns a share of every blow: <b>reduction = armor ÷ (armor + 6 × attacker tier)</b>, where the tier is the attacker's own place on the power curve (a foe's level, your main hand's level). A depth-I jerkin turns half a depth-I bite and almost none of a depth-XX one. Resistance lines and Stone Skin subtract a further share, capped at 75%.</p>
      <p><b>Foes</b> climb the same 1.08 curve per item level as your gear: life and damage both. Their armor grows half a point a level. <b>Your</b> max life is (class base + 4 a level) × 1.05 per level.</p>
      <p><b>Statuses</b> are pure: no armor, no crit, no echo. <b>Cleave</b> and the <b>sweep</b> do not roll procs; the arc rolls them at half chance.</p>
      <p><b>Wardens</b> shrug off chill and stun (half a stun, none mid-blow), bleed, burn, poison and shock like anything else, and cannot be culled.</p>
      </section>`;
  }

  private legend(): string {
    return `
      <section><h4>THE INVENTORY'S BORDERS</h4>
      <p>Every cell and row is edged by its rarity colour. A piece with something more wears a second, brighter edge:</p>
      <div class="cx-legend">
        <span class="cx-swatch fx-proc"></span><div><b>Ember edge</b> — the weapon procs a status on hit (bleed, poison, burn, chill, shock, stun).</div>
        <span class="cx-swatch fx-trait"></span><div><b>Sea-green edge</b> — the weapon grants a trait (reaping, siphon, cleave, impact, swiftness, guardian, fortune, seeker, berserk, precision).</div>
        <span class="cx-swatch fx-ench"></span><div><b>Rose edge</b> — an enchantment was laid at the forge.</div>
        <span class="cx-swatch fx-unique"></span><div><b>Gold edge</b> — a legendary or mythic with a unique effect or a granted passive.</div>
      </div>
      <p>The filter chips above every list (ALL · ARMS · ARMOR · JEWELS · DRAUGHTS · SCROLLS · SPECIAL) and the SORT menu (as found, level, rarity, type, name, value) remember their setting per panel.</p>
      </section>`;
  }
}
