/**
 * @module ui/Codex
 * THE JOURNAL (it.81, rewritten it.83): the game's own book. One panel,
 * opened from the system bar (the book), the pause sheet, a JOURNAL button
 * in every window, or with H, with a chapter for every system the player can
 * touch: items and rarity, item levels and the power curve, affixes, the
 * CATALOGUE (every base the crypt drops or the forge makes — every weapon
 * shape in every tier, the staves, the uniques, every plate and jewel — with
 * its real numbers), status effects (the full mechanics and how each shows on
 * a foe), traits, enchantments and their recipes, the forge (every operation
 * with its numbers and a worked example), the craft log, the belt and the
 * draughts, the merchants and the stash, combat formulas, and a legend of
 * the inventory's borders.
 *
 * EVERYTHING IS GENERATED FROM THE TABLES THE ENGINE READS — the registry,
 * the affix and effect tables, the crafting and town constants, the combat
 * constants — so the book cannot drift from the game. The worked examples
 * call the same cost functions the forge calls. When a number in here is
 * wrong, the game is wrong the same way.
 */

import { COMBAT_SPEED } from '@/core/config';
import { audio } from '@/engine/AudioManager';
import { AFFIXES, AFFIX_KEYS } from '@/items/affixes';
import { RARITY_AFFIX_COUNT, RARITY_COLOR, RARITY_MULT, RARITY_ORDER, RARITY_WEIGHT, WEAPON_FAMILY, WEAPON_TIMING, itemValue, type ItemDef, type Rarity, type WeaponKind } from '@/items/catalog';
import { ENCHANTS, STATUS_INFO, TRAIT_INFO, effectIcon, effectLine, type Effect } from '@/items/effects';
import { weaponIconUrl } from '@/render/SpriteLibrary';
import { ilvlForDepth, itemDef } from '@/items/instance';
import { DRAUGHTS, MATERIALS, SHAPES, TIERS, gearBases } from '@/items/registry';
import { QUAFF_COOLDOWN } from '@/systems/Inventory';
import { REINFORCE_CHANCE, TRANSMUTE_RECIPES, enchantCost, forgeCost, goldOnlyCost, reinforceCost, rerollCost, salvageYield } from '@/systems/Crafting';
import { DOT_TABLE, MARK_TICKS } from '@/systems/Status';
import { BUYBACK_CAPACITY, RESTOCK_TICKS, SELL_RATIO, STASH_CAPACITY } from '@/systems/Town';
import { itemIconHtml } from './itemIcons';
import { keepScroll } from './keepScroll';

export type Chapter = 'items' | 'catalogue' | 'statuses' | 'traits' | 'enchants' | 'forge' | 'log' | 'belt' | 'merchants' | 'combat' | 'legend';

const CHAPTERS: Array<[Chapter, string]> = [
  ['items', 'ITEMS'],
  ['catalogue', 'CATALOGUE'],
  ['statuses', 'STATUSES'],
  ['traits', 'TRAITS'],
  ['enchants', 'RECIPES'],
  ['forge', 'CRAFTING'],
  ['log', 'CRAFT LOG'],
  ['belt', 'BELT'],
  ['merchants', 'TRADE'],
  ['combat', 'COMBAT'],
  ['legend', 'LEGEND'],
];

/** Older callers (and saved chapter names) still say "arsenal". */
const ALIASES: Record<string, Chapter> = { arsenal: 'catalogue' };

const FAMILY_NAME: Record<WeaponKind, string> = { blade: 'Blades', katana: 'Fast steel', axe: 'Axes', mace: 'Maces', polearm: 'Polearms', bow: 'Bows', wand: 'Wands and staves' };
const SLOT_NAME: Record<string, string> = { head: 'Head', torso: 'Body', legs: 'Legs', offHand: 'Off hand', cloak: 'Back', ring: 'Rings and amulets', mainHand: 'Weapons' };

function clock(tick: number): string {
  const sec = Math.floor(tick / 60);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const icon = (id: string): string => {
  const d = itemDef(id);
  return d ? itemIconHtml(d) : '';
};
const fxIcon = (e: Effect): string => {
  const n = effectIcon(e);
  return n ? `<img class="cx-fx-icon" src="${weaponIconUrl(`raven${n}`)}" alt="">` : '';
};
const fxLine = (e: Effect | null | undefined): string => (e ? `${fxIcon(e)}${effectLine(e)}` : '<i>no innate</i>');
/** The family's base pace: what a swing takes before your class and your haste lines. */
const pace = (kind: WeaponKind, speedMult = 1): string => {
  const t = WEAPON_TIMING[kind];
  const ticks = (t.windup + t.recover * 0.85) / (COMBAT_SPEED * speedMult);
  return `${(60 / ticks).toFixed(1)}/s`;
};
const bonusText = (b: ItemDef['bonus']): string => {
  if (!b) return '';
  const out: string[] = [];
  if (b.dmg) out.push(`+${pct(b.dmg)} damage`);
  if (b.armor) out.push(`+${b.armor} armor`);
  if (b.hp) out.push(`+${b.hp} life`);
  if (b.dodge) out.push(`+${pct(b.dodge)} dodge`);
  if (b.regen) out.push(`+${pct(b.regen)} resource regen`);
  return out.join(' · ');
};
const costText = (c: Record<string, number | undefined>): string =>
  Object.entries(c)
    .filter(([, n]) => n)
    .map(([k, n]) => (k === 'gold' ? `${n} gold` : `${n} ${itemDef(k)?.name ?? k}`))
    .join(' · ');
/** A base for a worked example: a rare level-12 blade, exactly as the forge would price it. */
const SAMPLE: ItemDef = { id: 'sample', name: 'a rare level-12 blade', slot: 'mainHand', rarity: 'rare', color: 0, ilvl: 12, upgrade: 0, affixes: [{ key: 'str', tier: 1 }] } as unknown as ItemDef;

export class CodexUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private chapter: Chapter = 'items';
  /** The catalogue's search text (kept across repaints). */
  private query = '';
  private readonly abort = new AbortController();

  constructor(
    private readonly known: () => ReadonlySet<string>,
    /** THE CRAFT LOG (it.82): what the forge did this run, newest first. */
    private readonly craftLog: () => ReadonlyArray<{ tick: number; text: string; ok: boolean }> = () => [],
    /** The deepest depth reached: the catalogue marks what is in reach and what the forge knows. */
    private readonly deepest: () => number = () => 0,
  ) {
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

  open(chapter?: Chapter | string): void {
    if (chapter) this.chapter = (ALIASES[chapter] ?? chapter) as Chapter;
    if (!CHAPTERS.some(([id]) => id === this.chapter)) this.chapter = 'items';
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
      <div class="tp-head drag-handle"><h3>THE JOURNAL</h3><span class="tp-vendor">items · effects · recipes · crafting · H</span><button class="tp-close" data-close title="Close (H or ESC)"><i></i></button></div>
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
    // A chapter can point at another ("see CRAFTING").
    this.panel.querySelectorAll<HTMLElement>('[data-goto]').forEach((b) => {
      b.addEventListener('click', () => {
        this.chapter = (b.dataset.goto as Chapter) ?? 'items';
        audio.sfx('uiClick');
        this.panel.querySelector('.codex-body')?.scrollTo(0, 0);
        this.render();
      });
    });
    // The catalogue's search: filters the cards in place, no repaint.
    const find = this.panel.querySelector<HTMLInputElement>('.cx-find');
    if (find) {
      find.value = this.query;
      const apply = (): void => {
        const q = find.value.trim().toLowerCase();
        this.query = q;
        this.panel.querySelectorAll<HTMLElement>('[data-find]').forEach((el) => {
          el.hidden = !!q && !(el.dataset.find ?? '').includes(q);
        });
        this.panel.querySelectorAll<HTMLElement>('.cx-group').forEach((grp) => {
          grp.hidden = !!q && !grp.querySelector('[data-find]:not([hidden])');
        });
      };
      find.addEventListener('input', apply);
      find.addEventListener('keydown', (e) => e.stopPropagation());
      apply();
    }
  }

  private body(): string {
    switch (this.chapter) {
      case 'items':
        return this.items();
      case 'catalogue':
        return this.catalogue();
      case 'statuses':
        return this.statuses();
      case 'traits':
        return this.traits();
      case 'enchants':
        return this.enchants();
      case 'forge':
        return this.forge();
      case 'log':
        return this.log();
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

  private goto(ch: Chapter, label: string): string {
    return `<button class="cx-goto" type="button" data-goto="${ch}">${label}</button>`;
  }

  // ---- Chapters -----------------------------------------------------------------

  private items(): string {
    const rows = RARITY_ORDER.map((r: Rarity) => {
      const extra = r === 'legendary' ? ' + a unique effect' : r === 'mythic' ? ' + a passive skill' : '';
      return `<tr><td><b class="cx-rar" style="color:${hex(RARITY_COLOR[r])}">${r}</b></td><td>×${RARITY_MULT[r]}</td><td>${RARITY_AFFIX_COUNT[r]}${extra}</td><td>${RARITY_WEIGHT[r]}%</td></tr>`;
    }).join('');
    const affixes = AFFIX_KEYS.map((k) => {
      const a = AFFIXES[k];
      const vals = a.values.map((v) => (a.fmt === 'pct' ? pct(v) : a.fmt === 'pctps' ? `${(v * 100).toFixed(1)}%/s` : String(v))).join(' · ');
      return `<tr><td><b>${a.name}</b> <i>(${a.kind})</i></td><td>${a.line.replace('{v}', '<em>v</em>')}</td><td>${vals}${a.flat ? ' <i>× the level’s power</i>' : ''}</td></tr>`;
    }).join('');
    const l40 = Math.pow(1.08, 39).toFixed(1);
    return `
      <section><h4>WHAT AN ITEM IS</h4>
      <p>Every piece of gear is a <b>base</b> (its shape, its icon, its level-1 numbers — see the ${this.goto('catalogue', 'CATALOGUE')}) rolled into an <b>instance</b> with an <b>item level</b>, a <b>rarity</b>, a <b>reinforcement</b> (+0 to +15), one to five <b>affixes</b>, and, for weapons, its <b>innate effect</b> and one <b>enchantment</b>. The card shows all of it; the cell in your pack shows the level in its corner, the reinforcement beside it, and a gem for an effect.</p>
      <h5>Reading the card</h5>
      <p>Hover a piece (long-press on a phone) and the card opens: the name in its rarity's colour, the slot and item level, then <b>THIS · YOURS</b> — the piece's numbers beside the piece you wear in that slot, with the difference in green (better) or red (worse). Under the numbers come the affix lines, then every effect with its icon and a plain sentence, then the base's own description, and last its worth and what a click does (equip, use, read).</p>
      <h5>The level curve</h5>
      <p><b>Item level</b> (iLvl 1–100) is the spine of the game's numbers: every stat on a piece is its base × <b>1.08</b><sup>iLvl − 1</sup>. A depth drops two levels per floor (depth I is level 1, depth X is 19, depth XX is 39), and the foes on that floor climb the same curve, so a floor's drops match its threats. A level-40 blade is not a little better than a level-20 one — it is ${l40} times the level-1 blade and 4.7 times the level-20 one.</p>
      <h5>Rarity</h5>
      <p>Rarity multiplies the base again and decides how many affixes the piece carries:</p>
      <table class="cx-table"><thead><tr><th>Rarity</th><th>Stat ×</th><th>Affixes</th><th>Drop weight</th></tr></thead><tbody>${rows}</tbody></table>
      <p><b>Legendary</b> pieces also carry a unique: <i>lifesteal</i> (8% of damage dealt returns as life), <i>cull</i> (a strike slays a foe under 15% of its life), <i>thorns</i> (a fifth of every blow taken goes back to the attacker), or <i>echo</i> (one hit in ten strikes twice). <b>Mythic</b> pieces grant a passive skill while worn.</p>
      <h5>Reinforcement</h5>
      <p>Each level adds 5% of the base: +15 is +75%. It costs materials and gold, and past +7 a failure costs a level. See ${this.goto('forge', 'CRAFTING')}.</p>
      <h5>Affixes</h5>
      <p>The lines under the numbers. Prefixes are the three attributes; suffixes are the offensive and defensive lines. Each has five tiers, one tier per twenty item levels with some spread (a fifth roll a tier up, a seventh a tier down). Armor lines grow with the level's power; regrowth is a share of your max life, so it grows with you.</p>
      <table class="cx-table"><thead><tr><th>Line</th><th>Reads</th><th>Tiers 1–5</th></tr></thead><tbody>${affixes}</tbody></table>
      <p>Attribute points convert into the engine's levers: <b>1 Strength</b> = +1% damage and +3 max life · <b>1 Agility</b> = +0.6% attack speed and +0.3% dodge · <b>1 Intelligence</b> = +0.8% cooldown reduction and +2 max resource.</p>
      <h5>Where items come from</h5>
      <p>Six foes in ten drop something: of those drops three in ten are draughts, three in twenty are materials, one in twenty-five (from depth II on) a recipe scroll, and the rest gear rolled at the floor's level (a level under to two over). Chests never give less than uncommon. Rarity luck grows with the level (× 1 + iLvl ÷ 40) and with a Seeker weapon. The armorer sells rolled gear at the deepest depth's level and restocks on a clock (${this.goto('merchants', 'TRADE')}); the forge makes any base whose band you have reached (${this.goto('forge', 'CRAFTING')}).</p>
      <p><b>Materials</b> live in your pouch, never in a pack slot: ${MATERIALS.map((m) => `${icon(m.id)} ${m.name}`).join(' · ')}. They come from salvage, from the floor, and from the armorer.</p>
      </section>`;
  }

  /** THE CATALOGUE (it.83): every base, every tier, with its real numbers. */
  private catalogue(): string {
    const reach = ilvlForDepth(Math.max(1, this.deepest())) + 2;
    const bases = gearBases();
    const inReach = (d: ItemDef): boolean => !d.band || d.band[0] <= reach;
    const badge = (d: ItemDef): string => (d.uniqueOnly ? '<em class="cx-badge cx-badge-unique">DROPS ONLY</em>' : inReach(d) ? '<em class="cx-badge cx-badge-reach">FORGE KNOWS IT</em>' : `<em class="cx-badge">FROM iLvl ${d.band?.[0]}</em>`);
    const mods = (d: { speedMult?: number; speed?: number; critBonus?: number; crit?: number; reachBonus?: number; reach?: number }): string => {
      const sp = d.speedMult ?? d.speed;
      const cr = d.critBonus ?? d.crit;
      const re = d.reachBonus ?? d.reach;
      return [sp && sp !== 1 ? `pace ×${sp}` : '', cr ? `crit +${pct(cr)}` : '', re ? `reach ${re > 0 ? '+' : ''}${re}` : ''].filter(Boolean).join(' · ');
    };

    // Weapons by family: the shape cards, each with its three tiers.
    const families = (Object.keys(WEAPON_TIMING) as WeaponKind[])
      .map((kind) => {
        const f = WEAPON_FAMILY[kind];
        const shapes = SHAPES.filter((s) => s.kind === kind);
        const staves = kind === 'wand' ? bases.filter((d) => d.id.endsWith('_staff') && !d.uniqueOnly) : [];
        if (!shapes.length && !staves.length) return '';
        const cards = shapes
          .map((s) => {
            const tiers = TIERS.map((t, i) => {
              const def = itemDef(`${t.key}_${s.key}`);
              const known = def ? inReach(def) : false;
              return `<li class="${known ? 'cx-known' : ''}"><b style="color:${hex(t.color)}">${def?.name ?? t.name}</b> <span>iLvl ${t.band[0]}–${t.band[1]} · ${Math.round(s.dmg[0] * t.mult)}–${Math.round(s.dmg[1] * t.mult)}</span> ${fxLine(s.innates[i])}</li>`;
            }).join('');
            const findKey = `${s.name} ${s.kind} ${s.innates.map((e) => (e ? effectLine(e) : '')).join(' ')} ${TIERS.map((t) => t.name).join(' ')}`.toLowerCase();
            return `<div class="cx-shape" data-find="${esc(findKey)}"><div class="cx-shape-head">${icon(`steel_${s.key}`)}<b>${s.name}</b><i>${kind}</i><span>${s.dmg[0]}–${s.dmg[1]} at level 1${mods(s) ? ' · ' + mods(s) : ''} · ${pace(kind, s.speed ?? 1)}</span></div><p>${s.desc}</p><ul class="cx-tiers">${tiers}</ul></div>`;
          })
          .join('');
        const staffCards = staves
          .map(
            (d) =>
              `<div class="cx-shape" data-find="${esc(`${d.name} staff wand ${d.innate ? effectLine(d.innate) : ''}`.toLowerCase())}"><div class="cx-shape-head">${itemIconHtml(d)}<b>${d.name}</b><i>staff</i><span>${d.minDamage}–${d.maxDamage} at level 1${mods(d) ? ' · ' + mods(d) : ''} · ${pace(kind, d.speedMult ?? 1)}</span>${badge(d)}</div><p>${d.desc ?? ''}</p><ul class="cx-tiers"><li class="${inReach(d) ? 'cx-known' : ''}"><b style="color:${hex(d.color)}">${d.name}</b> <span>iLvl ${d.band?.[0]}–${d.band?.[1]}</span> ${fxLine(d.innate)}</li></ul></div>`,
          )
          .join('');
        return `<div class="cx-group"><h5 class="cx-fam">${FAMILY_NAME[kind]} <small>${pace(kind)} base pace · reach ${f.range} · crit ${pct(f.critChance)}${f.stuns ? ' · every hit staggers' : ''}</small></h5><div class="cx-shapes">${cards}${staffCards}</div></div>`;
      })
      .join('');

    // Uniques: named steel, two innates, legendary and mythic rolls only.
    const uniques = bases
      .filter((d) => d.uniqueOnly)
      .map(
        (d) =>
          `<div class="cx-shape cx-unique" data-find="${esc(`${d.name} unique ${d.weaponKind} ${[d.innate, d.innate2].map((e) => (e ? effectLine(e) : '')).join(' ')}`.toLowerCase())}"><div class="cx-shape-head">${itemIconHtml(d)}<b style="color:${hex(d.color)}">${d.name}</b><i>${d.weaponKind}</i><span>${d.minDamage}–${d.maxDamage} at level 1${mods(d) ? ' · ' + mods(d) : ''} · ${pace(d.weaponKind ?? 'blade', d.speedMult ?? 1)}</span>${badge(d)}</div><p>${d.desc ?? ''}</p><ul class="cx-tiers"><li>${fxLine(d.innate)}</li><li>${fxLine(d.innate2)}</li></ul></div>`,
      )
      .join('');

    // Armor and jewels by slot.
    const slots = ['head', 'torso', 'legs', 'offHand', 'cloak', 'ring'];
    const wear = slots
      .map((slot) => {
        const list = bases.filter((d) => (d.slot as string) === slot && !d.weaponKind);
        if (!list.length) return '';
        const rows = list
          .map(
            (d) =>
              `<tr data-find="${esc(`${d.name} ${SLOT_NAME[slot] ?? slot} ${bonusText(d.bonus)}`.toLowerCase())}"><td>${itemIconHtml(d)} <b>${d.name}</b></td><td>${d.band ? `${d.band[0]}–${d.band[1]}` : '1–100'}</td><td>${d.armor ? `${d.armor} armor` : '—'}</td><td>${bonusText(d.bonus) || '—'}</td><td>${badge(d)}</td></tr>`,
          )
          .join('');
        return `<div class="cx-group"><h5 class="cx-fam">${SLOT_NAME[slot] ?? slot}</h5><table class="cx-table cx-wear"><thead><tr><th>Base</th><th>Band</th><th>At level 1</th><th>Built in</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
      })
      .join('');

    const counts = `${SHAPES.length} shapes × ${TIERS.length} tiers, ${bases.filter((d) => d.id.endsWith('_staff') && !d.uniqueOnly).length} staves, ${bases.filter((d) => d.uniqueOnly).length} uniques, ${bases.filter((d) => !d.weaponKind && (d.slot as string) !== 'ring').length} pieces of armor, ${bases.filter((d) => (d.slot as string) === 'ring').length} jewels`;
    return `
      <section><h4>THE CATALOGUE</h4>
      <p><b>Why it is here.</b> Every base the crypt can drop or the forge can make — ${counts} — with the numbers it really has, so you know what to hunt for and what a blueprint will be before you spend the scraps. The forge's FORGE tab lists exactly the bases marked <em class="cx-badge cx-badge-reach">FORGE KNOWS IT</em> (their level band starts by the deepest depth you have reached, iLvl ${reach - 2}); a unique only ever drops, legendary or mythic. Every number here is at <b>level 1</b>: multiply by 1.08 per item level and by the rarity (${this.goto('items', 'ITEMS')}).</p>
      <p><b>Weapons.</b> A weapon has a <b>family</b> (its swing timing, reach and crit — the table under each heading), a <b>shape</b> (its role: damage, pace, crit, reach) and a <b>tier</b> (Steel iLvl 1–38 ×1 · Gilded 25–70 ×1.12 · Crystal 55–100 ×1.25; bows and wands say Ashwood for steel). Each shape carries a different <b>innate</b> in each tier — a status proc on hit or a granted trait — so no two are the same numbers behind another icon. The pace shown is the family's before your class, Agility and Haste lines; the hero's own hand adds <b>+2% weapon damage per level</b>.</p>
      <p><b>Armor and jewels</b> carry armor and a built-in bonus that the affixes stack on. A plate's armor turns a share of every blow: armor ÷ (armor + 6 × the attacker's tier) (${this.goto('combat', 'COMBAT')}).</p>
      <label class="cx-findbox"><input class="cx-find" type="search" placeholder="Find a base — a name, a family, an effect (“poison”, “cleave”, “helm”)" autocomplete="off" spellcheck="false"></label>
      ${families}
      <div class="cx-group"><h5 class="cx-fam">Uniques <small>legendary and mythic rolls only · named steel with two innates</small></h5><div class="cx-shapes">${uniques}</div></div>
      ${wear}
      </section>`;
  }

  private statuses(): string {
    const cards = (Object.keys(STATUS_INFO) as Array<keyof typeof STATUS_INFO>).map((k) => {
      const s = STATUS_INFO[k];
      return `<div class="cx-card" style="--fx:${hex(s.color)}"><b><img class="cx-fx-icon" src="${weaponIconUrl(`raven${s.icon}`)}" alt="">${s.name}</b><span class="cx-fx-line">${s.line(1, 1).replace('100% chance to ', 'On proc: ')}</span><p>${s.desc}</p><small>Shows as: this icon above the foe's head for ${(MARK_TICKS[k] / 60).toFixed(1)} s (a wound over time keeps it while it runs), the name floating up when it lands, and the strip — ${s.visual}</small></div>`;
    }).join('');
    const dots = (Object.keys(DOT_TABLE) as Array<keyof typeof DOT_TABLE>).map((k) => {
      const d = DOT_TABLE[k];
      return `<tr><td><b style="color:${hex(STATUS_INFO[k].color)}">${STATUS_INFO[k].name}</b></td><td>${pct(d.share)} of the hit</td><td>${(d.ticks / 60).toFixed(0)} s</td><td>${d.ticks / d.period} bites, one every ${(d.period / 60).toFixed(2)} s</td></tr>`;
    }).join('');
    return `
      <section><h4>STATUS EFFECTS ON FOES</h4>
      <p>A weapon's proc rolls on every landed primary strike at the chance on its card; the sweep arc behind the strike rolls at <b>half</b> that chance. <b>Power</b> (a crystal tier, a unique, a stronger enchantment) scales the wound's share, the chill's depth, the stun's length.</p>
      <p>Wounds over time are <b>pure</b>: they ignore armor, never crit, never echo, and are credited to you — so kills, Reaping and the bestiary follow them. A status never stacks with itself; a fresh or stronger one <b>replaces</b> a weaker one and restarts the clock. Every affected foe wears the status's icon above its head and takes its tint until it fades.</p>
      <table class="cx-table"><thead><tr><th>Wound</th><th>Total</th><th>Over</th><th>Bites</th></tr></thead><tbody>${dots}</tbody></table>
      <div class="cx-cards">${cards}</div>
      <p><b>Wardens</b> (every fifth depth) shrug off chill entirely and take half a stun, none mid-blow; bleed, burn, poison and shock bite them like anything else.</p>
      <p>Your class path lays its own status on every skill hit: the mage burns, the rogue poisons, the warrior staggers, the ranger's arrows carry the shape's proc. Poison Blade envenoms every strike for its duration. Traits (${this.goto('traits', 'TRAITS')}) are the other half of what a weapon can lend you.</p>
      </section>`;
  }

  private traits(): string {
    const cards = (Object.keys(TRAIT_INFO) as Array<keyof typeof TRAIT_INFO>).map((k) => {
      const t = TRAIT_INFO[k];
      return `<div class="cx-card cx-trait"><b><img class="cx-fx-icon" src="${weaponIconUrl(`raven${t.icon}`)}" alt="">${t.name}</b><span class="cx-fx-line">${t.line(1)}</span><p>${t.desc}</p><small>At power 2: ${t.line(2)}</small></div>`;
    }).join('');
    return `
      <section><h4>GRANTED TRAITS</h4>
      <p>A trait is an ability the weapon lends you while it is held. Every source has a <b>power</b> (a steel innate is often 0.6, a gilded one 1, a crystal one 1.3–1.5) and powers <b>add</b>: the shape's innate, a unique's second innate and an enchantment all stack, so two sources of Cleave cleave harder. Swap the weapon and the trait is gone. The card names the trait with its icon and says what it does at that power.</p>
      <div class="cx-cards">${cards}</div>
      </section>`;
  }

  private enchants(): string {
    const known = this.known();
    const cards = Object.values(ENCHANTS)
      .map(
        (r) =>
          `<div class="cx-card cx-ench${known.has(r.key) ? ' known' : ''}">${icon(`recipe_${r.key}`)}<div><b>${r.name}</b> ${known.has(r.key) ? '<em>LEARNED</em>' : '<em class="cx-dim">not yet learned</em>'}<span class="cx-fx-line">${fxIcon(r.effect)}${effectLine(r.effect)}</span><p>${r.desc}</p><small>The scroll drops from depth ${r.depth} on (one gear drop in twenty-five), or sits on the alchemist's counter now and then · laying it costs ${r.essence} essence, ${r.dust} arcane dust and 30% of the weapon's worth in gold</small></div></div>`,
      )
      .join('');
    const learned = [...known].length;
    return `
      <section><h4>ENCHANTMENTS — THE RECIPES</h4>
      <p>An enchantment is a recipe learned once and laid on any weapon at the camp forge. It adds a proc or a trait on top of the weapon's innates, puts its word in the weapon's name ("Flaming Steel Saber", "Reaping Crystal Kris") and a line on its card marked <i>Enchant</i>. A weapon holds <b>one</b>; a new one replaces the old. You know <b>${learned} of ${Object.keys(ENCHANTS).length}</b>.</p>
      <ol class="cx-steps">
        <li><b>Find the scroll.</b> Recipe scrolls drop on the floor from the depth on the card, and the alchemist stocks one now and then. They filter under SCROLLS in every list.</li>
        <li><b>Read it.</b> Click the scroll in your pack (tap it on a phone). The recipe is yours forever — it survives death, saves and new runs — and the scroll is spent.</li>
        <li><b>Lay it.</b> At the forge (the weapon rack by the campfire) open ENCHANT, pick a weapon, pick the recipe, pay the essence, dust and gold. The weapon's name, card and border change at once.</li>
      </ol>
      <div class="cx-cards cx-ench-list">${cards}</div>
      </section>`;
  }

  private forge(): string {
    const odds = REINFORCE_CHANCE.slice(1)
      .map((c, i) => {
        const n = i + 1;
        const cost = reinforceCost({ ...SAMPLE, upgrade: n - 1 } as ItemDef);
        return `<tr><td>+${n}</td><td>${Math.round(c * 100)}%</td><td>${cost ? costText(cost.cost) : ''}</td><td>${n >= 8 ? 'drops one level' : 'materials only'}</td></tr>`;
      })
      .join('');
    const trans = TRANSMUTE_RECIPES.map((r) => `<li>${icon(r.from)} ${r.take} ${itemDef(r.from)?.name} → ${icon(r.to)} ${r.give} ${itemDef(r.to)?.name}</li>`).join('');
    const salvage = RARITY_ORDER.map((r) => {
      const y = salvageYield({ id: 'x', name: 'x', slot: 'mainHand', rarity: r, color: 0, ilvl: 1 } as ItemDef) ?? {};
      return `<tr><td><b style="color:${hex(RARITY_COLOR[r])}">${r}</b></td><td>${Object.entries(y)
        .map(([k, n]) => `${n} ${itemDef(k)?.name ?? k}`)
        .join(' · ')}</td></tr>`;
    }).join('');
    const sampleValue = itemValue(SAMPLE);
    const sampleSalvage = salvageYield(SAMPLE) ?? {};
    const sampleReroll = rerollCost(SAMPLE, 0);
    const sampleReinforce = reinforceCost(SAMPLE);
    const sampleEnchant = enchantCost(SAMPLE, 'flame');
    const forgeBase = itemDef('steel_blade');
    const sampleForge = forgeBase ? forgeCost(forgeBase, 12) : null;
    return `
      <section><h4>THE CAMP FORGE</h4>
      <p>The weapon rack beside the campfire. Walk to it and press E (tap it on a phone). Six operations, each a command in the party's stream so every peer sees the same sparks, and every result written to the ${this.goto('log', 'CRAFT LOG')}. Materials come from salvage, the floor and the armorer; gold from the floor and the merchants.</p>
      <ol class="cx-steps">
        <li><b>SALVAGE</b> breaks a piece into materials by its rarity, times (1 + ⌊iLvl ÷ 25⌋). A piece is gone once salvaged.</li>
        <li><b>TRANSMUTE</b> turns lesser materials into greater, never the other way.</li>
        <li><b>FORGE</b> makes a piece from a <b>blueprint</b>: every base whose level band the deepest depth you reached has entered (the ${this.goto('catalogue', 'CATALOGUE')} marks them). It rolls at that depth's item level (a level under to two over, like a drop), uncommon or better (uncommon 55 · rare 32 · epic 10 · legendary 2.5 · mythic 0.5 in a hundred).</li>
        <li><b>REFINE</b> rerolls one affix line on a rare or better piece — key and tier both roll again; the other lines stay.</li>
        <li><b>REINFORCE</b> adds 5% of the base per level, +1 to +15. Pay in materials and gold, or in <b>gold alone</b> (the materials' worth two and a half times, on top). From +8 a failure drops the piece a level.</li>
        <li><b>ENCHANT</b> lays a learned recipe on a weapon (${this.goto('enchants', 'RECIPES')}).</li>
      </ol>
      <h5>Salvage, per rarity (× the level tier)</h5>
      <table class="cx-table"><tbody>${salvage}</tbody></table>
      <h5>Transmutation</h5><ul class="cx-list">${trans}</ul>
      <h5>Forge</h5>
      <p>6 + 4 × tier scraps, 2 × tier dust from tier 2, tier − 1 essence from tier 3, and 12 gold per item level, where the tier is 1 + ⌊iLvl ÷ 25⌋.</p>
      <h5>Refine</h5>
      <p>1 + the line's tier in essence and 20% of the piece's worth in gold.</p>
      <h5>Reinforce — the odds and the price, for ${SAMPLE.name}</h5>
      <p>Gold is 35% of the piece's worth + 12 × n²; scraps 2 + n; dust from +4 (n − 2), essence from +8 (n − 6), a catalyst from +13.</p>
      <table class="cx-table"><thead><tr><th>To</th><th>Odds</th><th>Costs</th><th>On failure</th></tr></thead><tbody>${odds}</tbody></table>
      <h5>A worked example: ${SAMPLE.name}</h5>
      <p>Worth <b>${sampleValue} gold</b> (12 × 15 × 1.6). Salvaged: ${costText(sampleSalvage)}. Refining its first line: ${sampleReroll ? costText(sampleReroll) : '—'}. Reinforcing it to +1: ${sampleReinforce ? costText(sampleReinforce.cost) : '—'}, or <b>${sampleReinforce ? goldOnlyCost(sampleReinforce.cost) : 0} gold</b> with no materials. Enchanting it with Flame: ${sampleEnchant ? costText(sampleEnchant) : '—'}. Forging a Steel Blade at level 12: ${sampleForge ? costText(sampleForge) : '—'}. These are the forge's own functions, not a copy.</p>
      </section>`;
  }

  /** CRAFT LOG (it.82): every forge result this run. */
  private log(): string {
    const rows = this.craftLog();
    const items = rows.length ? rows.map((r) => `<li class="${r.ok ? '' : 'bad'}"><span>${clock(r.tick)}</span>${r.text}</li>`).join('') : '<li class="cx-empty">Nothing forged yet this run. Bring steel to the weapon rack beside the campfire.</li>';
    return `<section><h4>THE CRAFT LOG</h4><p>Every salvage, forge, transmutation, refinement, reinforcement and enchantment this run, newest first, with the run clock. A red line is a refusal (short of materials, a failed reinforcement) and says why.</p><ul class="cx-log">${items}</ul></section>`;
  }

  private belt(): string {
    const draughts = [...['health_potion', 'mana_potion', 'elixir'].map((id) => itemDef(id)!), ...DRAUGHTS]
      .map((d) => {
        const u = d.use ?? {};
        const what = [u.heal ? `restores ${pct(u.heal)} life` : '', u.resource ? `restores ${pct(u.resource)} resource` : '', u.haste ? `haste (+30% speed) for ${Math.round(u.haste / 60)} s` : '', u.stone ? `stone skin (40% of every blow turned) for ${Math.round(u.stone / 60)} s` : '', u.might ? `might (+25% damage) for ${Math.round(u.might / 60)} s` : ''].filter(Boolean).join(', ');
        const cat = u.heal ? 'heal' : u.resource ? 'resource' : 'buff';
        return `<tr><td>${icon(d.id)} <b>${d.name}</b></td><td>${what}</td><td>${(QUAFF_COOLDOWN[cat] / 60).toFixed(0)} s</td><td>${d.value} gold</td></tr>`;
      })
      .join('');
    return `
      <section><h4>THE BELT AND THE DRAUGHTS</h4>
      <p><b>Q</b> and <b>R</b> (the two flasks in the thumb cluster on a phone) hold whichever draught you choose. The belt shows the count and the cooldown; a refused quaff says why over your head.</p>
      <ol class="cx-steps">
        <li>Open the inventory (I, or the pack on the bar).</li>
        <li>Press the ▾ beside Q or R and pick any draught in your pack. Leave it empty to clear the key.</li>
        <li>Quaff with the key, the hotbar, or the flask. The belt refills itself from the pack as long as you carry that draught.</li>
      </ol>
      <p>Draughts share cooldowns by kind: <b>healing ${QUAFF_COOLDOWN.heal / 60} s</b>, <b>resource ${QUAFF_COOLDOWN.resource / 60} s</b>, <b>brews ${QUAFF_COOLDOWN.buff / 60} s</b>. A brew refreshes its own timer; it never stacks with itself. Stone skin stacks under the 75% cap with Warding lines.</p>
      <table class="cx-table"><thead><tr><th>Draught</th><th>Does</th><th>Cooldown</th><th>Worth</th></tr></thead><tbody>${draughts}</tbody></table>
      </section>`;
  }

  private merchants(): string {
    return `
      <section><h4>THE MERCHANTS, THE STASH AND THE ECONOMY</h4>
      <p>A piece is worth <b>(iLvl × 15) × rarity × (1 + 0.15 × reinforcement)</b> gold. Draughts, materials and scrolls have fixed prices (the ${this.goto('belt', 'BELT')} lists the draughts). The <b>armorer</b> sells at 100% of worth and pays <b>${pct(SELL_RATIO)}</b>; the <b>alchemist</b> keeps every draught and, now and then, a recipe scroll. Walk up and press E, or tap the merchant.</p>
      <ol class="cx-steps">
        <li><b>BUY</b>: the counter lists the stock with its price; a piece you cannot afford is dimmed. Hover (long-press) for the card and the comparison to what you wear.</li>
        <li><b>SELL</b>: your pack, filtered and sorted like the inventory; the price shown is what you get.</li>
        <li><b>BUYBACK</b> keeps the last ${BUYBACK_CAPACITY} pieces you sold, for exactly what was paid, across restocks — a mis-click costs nothing.</li>
      </ol>
      <p>The counters <b>restock every ${RESTOCK_TICKS / 3600} in-game minutes</b> (the clock is on the shop's heading) or the moment a warden falls, rolled at the deepest depth's level, so the armorer keeps pace with you.</p>
      <h5>The stash</h5>
      <p>The chest in town holds <b>${STASH_CAPACITY}</b> pieces and any amount of gold, shared by every hero on the account: put a piece in with one class, take it out with another. Gold in the stash is safe from a fall.</p>
      <h5>Gold</h5>
      <p>Piles on the floor grow at <b>half</b> the power curve while prices grow at all of it: gold stays scarce and the forge past +8 is where it goes. A Fortune weapon lifts every pile by a quarter per point of power.</p>
      </section>`;
  }

  private combat(): string {
    return `
      <section><h4>COMBAT</h4>
      <p><b>To hit.</b> A primary strike lands <b>80%</b> of the time; the arc behind it sweeps every other foe inside the reach plus 0.4 tiles within a 70° cone, each with its own 80% roll. A miss reads as a grey whiff.</p>
      <p><b>Damage.</b> The weapon's range (× 1 + 2% per hero level) × your damage multiplier (skill buffs, Might, "+% damage" lines, Strength, Berserk) × <b>2</b> on a critical (+0.4 per point of Precision). Crit chance is the family's + the class's + the shape's + your lines, capped at 75%.</p>
      <p><b>Armor</b> turns a share of every blow: <b>reduction = armor ÷ (armor + 6 × attacker tier)</b>, where the tier is the attacker's own place on the power curve (a foe's level, your main hand's level). A depth-I jerkin turns half a depth-I bite and almost none of a depth-XX one. Resistance lines and Stone Skin subtract a further share, capped at 75%. <b>Dodge</b> (the class's + Agility + lines, capped at 75%) avoids a blow outright.</p>
      <p><b>Stagger.</b> A blow of 4 or more after armor interrupts a foe's action; you have poise, and only a blow of 8 or more interrupts yours. A hit knocks a foe back 0.16 tiles, a crit 0.38 (× 1 + 0.8 per point of Impact).</p>
      <p><b>Foes</b> climb the same 1.08 curve per item level as your gear: life and damage both, two item levels a depth. Their armor grows half a point a level. A champion (an affix) is worth half again the XP. <b>Your</b> max life is (class base + 4 a level) × 1.05 per level, plus every "+life" line.</p>
      <p><b>Statuses</b> are pure: no armor, no crit, no echo (${this.goto('statuses', 'STATUSES')}). <b>Cleave</b> and the sweep do not roll procs at full chance; the arc rolls them at half.</p>
      <p><b>Wardens</b> shrug off chill and take half a stun (none mid-blow); bleed, burn, poison and shock bite them like anything else, and they cannot be culled.</p>
      </section>`;
  }

  private legend(): string {
    return `
      <section><h4>THE INVENTORY'S MARKS</h4>
      <p>Every cell and row is edged by its rarity colour. A piece with something more wears a second, brighter edge:</p>
      <div class="cx-legend">
        <span class="cx-swatch fx-proc"></span><div><b>Ember edge</b> — the weapon procs a status on hit (bleed, poison, burn, chill, shock, stun).</div>
        <span class="cx-swatch fx-trait"></span><div><b>Sea-green edge</b> — the weapon grants a trait (reaping, siphon, cleave, impact, swiftness, guardian, fortune, seeker, berserk, precision).</div>
        <span class="cx-swatch fx-ench"></span><div><b>Rose edge</b> — an enchantment was laid at the forge.</div>
        <span class="cx-swatch fx-unique"></span><div><b>Gold edge</b> — a legendary or mythic with a unique effect or a granted passive.</div>
      </div>
      <p>In a cell's corner: the <b>item level</b> top-left, <b>+n</b> beside it for a reinforcement, a <b>gem</b> top-right in the effect's colour. A stack shows its count bottom-right.</p>
      <p>The filter chips above every list (ALL · ARMS · ARMOR · JEWELS · DRAUGHTS · SCROLLS · SPECIAL) and the SORT menu (as found, level, rarity, type, name, value) remember their setting per panel. TIDY sorts the pack itself: type, rarity, level, name.</p>
      <p>Above a foe's head: the icons of the statuses on it (${this.goto('statuses', 'STATUSES')}). Over yours: a refused quaff, a learned recipe, a full pack.</p>
      </section>`;
  }
}
