/**
 * @module items/curios
 * THE CURIOS (it.115): everything else the item drop holds, made items.
 *
 * The bake (`scripts/bake-items.py --only curios`) turned every polyy drink,
 * potion, scroll and tome and every painted ore into a 64 px icon and a
 * turntable, and wrote their rows to `curios.gen.ts`, each bottle's and
 * scroll's BREW read from the colour of its art. This module is the design
 * that sits on those rows:
 *
 *   DRINKS (95 more than the ten ALES)   a swig: small, cheap, common
 *   POTIONS (156)  "<Name> Tonic/Philter/..."  a lesser draught, uncommon
 *   SCROLLS (the rolled ones)                  a RITE (it.117)
 *   TOMES                                      a greater rite (it.117)
 *   ORES (54)      smelted from the pack into the crafting pouch
 *
 *   brew     drink            potion
 *   heal     12% life         30% life
 *   mana     20% resource     40% resource
 *   elixir   8% + 12%         20% + 25%
 *   haste    HASTE 6 s        HASTE 6 s
 *   might    MIGHT 6 s        MIGHT 6 s
 *   stone    STONE 6 s        STONE 6 s
 *
 * They run on the draughts' cooldowns (a heal-bearing curio shares the
 * five-second healing one), ride the belt, and turn in every cell. Where
 * they come from: `items/instance` rolls them into foe drops, chests and
 * the town chests; the alchemist, the scribe and the tavern stock a few.
 *
 * THE RITES (it.117). Until this iteration the hundred and nine scrolls and
 * tomes were potions in paper: the same brew a bottle poured, weaker, for
 * twice the gold. Nobody read one, and the owner was right to call them
 * inert. Every scroll and every tome is now a RITE - one reading, one real
 * skill out of the tree, cast by `systems/Skills` itself (the same code,
 * the same strips, the same sound), for ANY class, with no resource spent
 * and no cooldown to wait out but the paper in your hand:
 *
 *   a skill that LASTS     scroll 2.2x the numbers · 4x the length
 *                          tome   3.0x             · 6x
 *   a skill that BURSTS    scroll 3.5x the numbers (there is no length)
 *                          tome   5.0x
 *
 * A scroll of War Cry is therefore forty seconds of +35% damage where the
 * warrior's own cast gives ten; a tome of Firewall burns for thirty-six
 * seconds at triple damage. That is what a hundred and forty gold buys.
 *
 * THE ART PICKS THE RITE. The bake read a BREW from the colour of every
 * seal, and the colour is the promise on the paper: red mends and steadies,
 * blue is arcane, green is swift, orange is wrath, grey wards, violet is
 * the knife in the dark. Inside a family the key's own hash picks which
 * rite, so a given scroll is the same scroll in every run and on every
 * peer. Red and blue seals keep their draught as well as their rite - a
 * mending scroll is still a bandage - so nothing the old table promised is
 * taken away.
 */

import { consumableValue, type ItemDef, type Rarity } from './catalog';
import { SKILL_BY_ID } from '@/systems/SkillTree';
import { GEN_DRINKS, GEN_ORES, GEN_POTIONS, GEN_SCROLLS, type CurioBrew } from './curios.gen';

type Use = NonNullable<ItemDef['use']>;

/** What a brew does, at a strength (1 = a potion). Buff lengths are ticks. */
function brewUse(brew: CurioBrew, heal: number, res: number, secs: number): Use {
  switch (brew) {
    case 'heal':
      return { heal };
    case 'mana':
      return { resource: res };
    case 'elixir':
      return { heal: Math.round(heal * 0.66 * 100) / 100, resource: Math.round(res * 0.62 * 100) / 100 };
    case 'haste':
      return { haste: secs * 60 };
    case 'might':
      return { might: secs * 60 };
    case 'stone':
      return { stone: secs * 60 };
  }
}

/** The words for a brew, for the description. */
function brewWords(use: Use): string {
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const parts: string[] = [];
  if (use.heal) parts.push(`restores ${pct(use.heal)} of your life`);
  if (use.resource) parts.push(`${use.heal ? 'and ' : 'restores '}${pct(use.resource)} of your mana or stamina`);
  // THE NUMBERS ARE THE ITEM'S OWN (it.117): a swig pours half a draught's brew and says so.
  if (use.haste) parts.push(`makes you ${Math.round(((use.hasteMult ?? 1.3) - 1) * 100)} percent faster for ${use.haste / 60} seconds`);
  if (use.might) parts.push(`pours ${Math.round(((use.mightMult ?? 1.25) - 1) * 100)} percent more damage for ${use.might / 60} seconds`);
  if (use.stone) parts.push(`turns ${Math.round((use.stoneFrac ?? 0.4) * 100)} percent of every blow for ${use.stone / 60} seconds`);
  return parts.join(' ');
}

const BREW_COLOR: Record<CurioBrew, number> = { heal: 0xc83030, mana: 0x4a6ad8, elixir: 0x9a5ad8, haste: 0x7fd67f, might: 0xe0803a, stone: 0x9aa0a8 };
const POTION_NOUN: Record<CurioBrew, string> = { heal: 'Tonic', mana: 'Philter', elixir: 'Elixir', haste: 'Quickdraught', might: 'Warbrew', stone: 'Stonewater' };
const DRINK_NOUN: Record<'can' | 'bottle' | 'soda', string> = { can: 'Ale', bottle: 'Brew', soda: 'Cordial' };
const SCROLL_WORD: Record<CurioBrew, string> = { heal: 'mending', mana: 'clarity', elixir: 'renewal', haste: 'swiftness', might: 'fury', stone: 'warding' };

/**
 * WHICH RITE A SEAL CARRIES (it.117): the colour of the art, then the key's
 * hash inside the family. Every id here is a real `systems/SkillTree` skill.
 */
const RITES: Record<CurioBrew, readonly string[]> = {
  heal: ['stoneskin', 'warcry'],
  mana: ['intellect', 'frostnova', 'fireball'],
  elixir: ['poison', 'vanish', 'flurry'],
  haste: ['shadowstep', 'multishot', 'rain'],
  might: ['whirlwind', 'charge', 'fireball', 'firewall'],
  stone: ['stoneskin', 'trap', 'frostnova'],
};

/**
 * A RITE'S TWO KNOBS (it.117), and which one a skill gets. A skill that LASTS
 * - a buff, a burning wall, a rain, a planted trap - is bought for its
 * LENGTH: the scroll doubles its numbers and holds it four times as long (a
 * tome six). A skill that happens at once - a comet, a whirlwind, a charge,
 * a volley - has no length to stretch, so the paper buys RAW FORCE instead:
 * three and a half times the skill's own, or five from a tome. Both are
 * priced by `consumableValue` off power x root(stretch), so the two kinds
 * cost roughly the same for roughly the same worth.
 */
const LASTING = new Set(['warcry', 'stoneskin', 'intellect', 'shadowstep', 'poison', 'vanish', 'firewall', 'trap', 'rain']);
export const RITE_SCROLL = { power: 2.2, stretch: 4 } as const;
export const RITE_TOME = { power: 3, stretch: 6 } as const;
export const RITE_SCROLL_BURST = { power: 3.5, stretch: 1 } as const;
export const RITE_TOME_BURST = { power: 5, stretch: 1 } as const;

/** What a scroll or a tome of this rite carries. */
function riteOf(skill: string, tome: boolean): { skill: string; power: number; stretch: number } {
  const k = LASTING.has(skill) ? (tome ? RITE_TOME : RITE_SCROLL) : tome ? RITE_TOME_BURST : RITE_SCROLL_BURST;
  return { skill, power: k.power, stretch: k.stretch };
}

/**
 * The rite's own words, for the card. The NUMBERS are not repeated here -
 * `statLine` already prints "Casts <skill> at N% power - Mx as long" above
 * this line, and saying it twice reads like a stutter (it.117).
 */
function riteWords(skill: string, stretch: number): string {
  const def = SKILL_BY_ID[skill];
  if (!def) return '';
  return `works ${def.name} — ${def.hint.toLowerCase()} — ${stretch > 1 ? 'far past what a caster holds it' : 'far past what a caster can put behind it'}`;
}

/** A stable pick from a key (so a potion's rarity never moves between loads). */
function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** THE TEN ALES keep their hand-written entries in the registry; the rest of the drinks are these. */
const ALE_KEYS = new Set(['016_griffin', '017_dragon', '019_wolfsun', '021_starforge', '047_ambercrown', '048_knightshield', '050_bloodorange', '055_emeraldforest', '061_bronzerune', '063_druidwoodland']);

/**
 * A SWIG IS HALF A DRAUGHT (it.117). A common tin used to pour the SAME
 * thirty percent of speed a 120-gold Draught of Haste pours, for six seconds
 * against its eight, at sixteen gold - the cheapest power in the game. The
 * brews stay, at half strength, and the price comes off the one curve
 * (`consumableValue`), which is what makes the ladder monotone.
 */
const SWIG: Pick<Use, 'hasteMult' | 'mightMult' | 'stoneFrac'> = { hasteMult: 1.15, mightMult: 1.12, stoneFrac: 0.2 };

export const CURIO_DRINKS: ItemDef[] = GEN_DRINKS.filter(([key]) => !ALE_KEYS.has(key)).map(([key, title, vessel, brew]) => {
  const use: Use = { ...brewUse(brew, 0.12, 0.2, 6), ...SWIG };
  return {
    id: `drink_${key}`,
    name: `${title} ${DRINK_NOUN[vessel]}`,
    slot: 'consumable',
    rarity: 'common',
    sprite: `item_drink_${key}`,
    spin: `spin_drink_${key}`,
    value: consumableValue(use, 'common', { brewWeight: 0.5 }),
    use,
    color: BREW_COLOR[brew],
    desc: `A ${vessel === 'can' ? 'tin of tavern ale' : vessel === 'soda' ? 'stoppered cordial' : 'bottle of house brew'} with the ${title} mark. A swig ${brewWords(use)}.`,
  };
});

export const CURIO_POTIONS: ItemDef[] = GEN_POTIONS.map(([key, title, brew]) => {
  const rare = hash(key) % 5 === 0;
  const k = rare ? 1.25 : 1;
  const use = brewUse(brew, 0.3 * k, 0.4 * k, rare ? 8 : 6);
  const rarity: Rarity = rare ? 'rare' : 'uncommon';
  return {
    id: `curio_${key}`,
    name: `${title} ${POTION_NOUN[brew]}`,
    slot: 'consumable',
    rarity,
    sprite: `item_potion_${key}`,
    spin: `spin_potion_${key}`,
    // PRICED ON THE CURVE (it.117): a flask that heals three tenths no longer
    // costs half again what the Healing Potion asks for half a life.
    value: consumableValue(use, rarity),
    use,
    color: BREW_COLOR[brew],
    desc: `An alchemist's curio in a ${title.toLowerCase()} flask. It ${brewWords(use)}.`,
  };
});

export const CURIO_SCROLLS: ItemDef[] = GEN_SCROLLS.map(([key, title, form, brew]) => {
  const tome = form === 'tome';
  const family = RITES[brew];
  const { skill, power, stretch } = riteOf(family[hash(`rite_${key}`) % family.length], tome);
  // A RED OR A BLUE SEAL IS STILL A BANDAGE (it.117): the rite, and the draught it always poured.
  const restore: Use = brew === 'heal' ? { heal: tome ? 0.38 : 0.25 } : brew === 'mana' ? { resource: tome ? 0.5 : 0.35 } : brew === 'elixir' ? { heal: tome ? 0.22 : 0.15, resource: tome ? 0.3 : 0.2 } : {};
  const use: Use = { ...restore, cast: { skill, power, stretch } };
  const restored = brewWords(restore);
  return {
    id: `scroll_${key}`,
    name: `${title} ${tome ? 'Tome' : 'Scroll'}`,
    slot: 'consumable',
    rarity: tome ? 'rare' : 'uncommon',
    sprite: `item_scroll_${key}`,
    spin: `spin_scroll_${key}`,
    // THE PRICE OF PAPER (it.117): a rite is a class skill any class may read,
    // at twice or thrice its force and four or six times its length, once.
    value: consumableValue(use, tome ? 'rare' : 'uncommon'),
    use,
    color: BREW_COLOR[brew],
    desc: `${tome ? 'A tome' : 'A scroll'} of ${SCROLL_WORD[brew]}, sealed with the ${title.toLowerCase()} device. Read it once: it ${riteWords(skill, stretch)}${restored ? `, and ${restored}` : ''}. Any hand may read it; it costs no mana.`,
  };
});

/**
 * THE ORES (it.115), named by eye from the painted rocks (`ores/Style1`):
 * number -> [name, what it smelts into, how many].
 */
const ORE_TABLE: Record<number, [string, string, number]> = {
  1: ['Frost Coral', 'arcane_dust', 1], 2: ['Smoky Quartz', 'iron_scrap', 3], 3: ['Teal Spinel', 'essence', 1],
  4: ['Grey Ironstone', 'iron_scrap', 3], 5: ['Copper Cube', 'iron_scrap', 3], 6: ['Deep Spinel', 'essence', 1],
  7: ['Violet Geode', 'arcane_dust', 2], 8: ['Chalk Stone', 'iron_scrap', 2], 9: ['Jet Stone', 'iron_scrap', 3],
  12: ['Gold Nugget', 'arcane_dust', 2], 13: ['Tiger Ore', 'iron_scrap', 4], 14: ['Twin Amethyst', 'arcane_dust', 2],
  15: ['Speckled Jade', 'arcane_dust', 1], 16: ['Malachite Lump', 'arcane_dust', 1], 17: ['Azurite Bloom', 'arcane_dust', 2],
  18: ['Silver Crystal', 'essence', 1], 19: ['Bronze Ore', 'iron_scrap', 4], 20: ['Brass Ore', 'iron_scrap', 4],
  22: ['Pale Amethyst', 'arcane_dust', 1], 23: ['Aqua Quartz', 'arcane_dust', 1], 24: ['Coal Lump', 'iron_scrap', 2],
  25: ['Blue Hematite', 'iron_scrap', 4], 26: ['Sea Emerald', 'essence', 1], 27: ['Night Sapphire', 'essence', 2],
  29: ['Ruby Crystal', 'essence', 2], 30: ['Moss Agate', 'arcane_dust', 1], 31: ['Pyrite Cube', 'iron_scrap', 3],
  32: ['Plum Garnet', 'arcane_dust', 2], 33: ['Honey Quartz', 'arcane_dust', 1], 34: ['Rusted Ore', 'iron_scrap', 3],
  35: ['Dusk Fluorite', 'arcane_dust', 2], 36: ['Verdant Cluster', 'arcane_dust', 2], 37: ['Red Jasper', 'arcane_dust', 1],
  38: ['Amber Chunk', 'arcane_dust', 1], 39: ['Umber Ore', 'iron_scrap', 3], 40: ['Dark Geode', 'essence', 1],
  41: ['Obsidian Shard', 'iron_scrap', 4], 42: ['Peacock Ore', 'arcane_dust', 2], 43: ['Rose Ore', 'arcane_dust', 1],
  44: ['Storm Ore', 'arcane_dust', 2], 45: ['Pearl Cluster', 'essence', 1], 46: ['Black Diamond', 'alloy_shard', 1],
  47: ['Goldvein Rock', 'iron_scrap', 5], 49: ['Emerald Spray', 'essence', 2], 50: ['Royal Amethyst', 'essence', 2],
  51: ['Onyx Orb', 'essence', 1], 52: ['Fire Opal', 'essence', 2], 53: ['Star Quartz', 'alloy_shard', 1],
  54: ['Void Crystal', 'alloy_shard', 1], 55: ['Sunstone', 'essence', 1], 56: ['Slate Ore', 'iron_scrap', 2],
  57: ['Cobalt Druse', 'arcane_dust', 2], 58: ['Blood Garnet', 'essence', 2], 59: ['Salt Crystal', 'iron_scrap', 2],
};
const ORE_RARITY: Record<string, Rarity> = { iron_scrap: 'common', arcane_dust: 'uncommon', essence: 'rare', alloy_shard: 'epic' };
const ORE_VALUE: Record<string, number> = { iron_scrap: 6, arcane_dust: 25, essence: 110, alloy_shard: 420 };
const ORE_COLOR: Record<string, number> = { iron_scrap: 0x9a9a9a, arcane_dust: 0x5f7fdf, essence: 0x5fd8c8, alloy_shard: 0xc8a0ff };
const MAT_NAME: Record<string, string> = { iron_scrap: 'Iron Scraps', arcane_dust: 'Arcane Dust', essence: 'Essence', alloy_shard: 'Alloy Shards' };

export const CURIO_ORES: ItemDef[] = GEN_ORES.map(([key, n]) => {
  const [name, material, count] = ORE_TABLE[n] ?? [`Ore ${n}`, 'iron_scrap', 2];
  return {
    id: `ore_${key}`,
    name,
    slot: 'consumable',
    rarity: ORE_RARITY[material] ?? 'common',
    sprite: `item_ore_${key}`,
    value: Math.round((ORE_VALUE[material] ?? 6) * count * 0.8),
    use: { smelt: { material, count } },
    color: ORE_COLOR[material] ?? 0x9a9a9a,
    desc: `A raw find from the depths. Use it to smelt it into ${count} ${MAT_NAME[material] ?? material} for the forge, or sell it whole.`,
  };
});

/** Every curio, for the registry's join. */
export const CURIOS: ItemDef[] = [...CURIO_DRINKS, ...CURIO_POTIONS, ...CURIO_SCROLLS, ...CURIO_ORES];

/** A curio id of a family, by the caller's seeded rand (the drop rolls). */
export function pickCurio(rand: () => number, family: ItemDef[]): string {
  return family[Math.floor(rand() * family.length)].id;
}
