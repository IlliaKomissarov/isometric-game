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
 *   SCROLLS (the rolled and unrolled ones)     read for a longer brew
 *   TOMES                                      a scroll's brew, half again
 *   ORES (54)      smelted from the pack into the crafting pouch
 *
 *   brew     drink            potion            scroll          tome
 *   heal     12% life         30% life          25% life        38% life
 *   mana     20% resource     40% resource      35%             50%
 *   elixir   8% + 12%         20% + 25%         15% + 20%       22% + 30%
 *   haste    HASTE 6 s        HASTE 6 s         HASTE 8 s       HASTE 12 s
 *   might    MIGHT 6 s        MIGHT 6 s         MIGHT 8 s       MIGHT 12 s
 *   stone    STONE 6 s        STONE 6 s         STONE 8 s       STONE 12 s
 *
 * They run on the draughts' cooldowns (a heal-bearing curio shares the
 * five-second healing one), ride the belt, and turn in every cell. Where
 * they come from: `items/instance` rolls them into foe drops, chests and
 * the town chests; the alchemist, the scribe and the tavern stock a few.
 */

import type { ItemDef, Rarity } from './catalog';
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
  if (use.haste) parts.push(`makes you thirty percent faster for ${use.haste / 60} seconds`);
  if (use.might) parts.push(`pours a quarter more damage for ${use.might / 60} seconds`);
  if (use.stone) parts.push(`turns four tenths of every blow for ${use.stone / 60} seconds`);
  return parts.join(' ');
}

const BREW_COLOR: Record<CurioBrew, number> = { heal: 0xc83030, mana: 0x4a6ad8, elixir: 0x9a5ad8, haste: 0x7fd67f, might: 0xe0803a, stone: 0x9aa0a8 };
const POTION_NOUN: Record<CurioBrew, string> = { heal: 'Tonic', mana: 'Philter', elixir: 'Elixir', haste: 'Quickdraught', might: 'Warbrew', stone: 'Stonewater' };
const DRINK_NOUN: Record<'can' | 'bottle' | 'soda', string> = { can: 'Ale', bottle: 'Brew', soda: 'Cordial' };
const SCROLL_WORD: Record<CurioBrew, string> = { heal: 'mending', mana: 'clarity', elixir: 'renewal', haste: 'swiftness', might: 'fury', stone: 'warding' };

/** A stable pick from a key (so a potion's rarity never moves between loads). */
function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** THE TEN ALES keep their hand-written entries in the registry; the rest of the drinks are these. */
const ALE_KEYS = new Set(['016_griffin', '017_dragon', '019_wolfsun', '021_starforge', '047_ambercrown', '048_knightshield', '050_bloodorange', '055_emeraldforest', '061_bronzerune', '063_druidwoodland']);

export const CURIO_DRINKS: ItemDef[] = GEN_DRINKS.filter(([key]) => !ALE_KEYS.has(key)).map(([key, title, vessel, brew]) => {
  const use = brewUse(brew, 0.12, 0.2, 6);
  return {
    id: `drink_${key}`,
    name: `${title} ${DRINK_NOUN[vessel]}`,
    slot: 'consumable',
    rarity: 'common',
    sprite: `item_drink_${key}`,
    spin: `spin_drink_${key}`,
    value: 16,
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
    value: rare ? 70 : 45,
    use,
    color: BREW_COLOR[brew],
    desc: `An alchemist's curio in a ${title.toLowerCase()} flask. It ${brewWords(use)}.`,
  };
});

export const CURIO_SCROLLS: ItemDef[] = GEN_SCROLLS.map(([key, title, form, brew]) => {
  const tome = form === 'tome';
  const k = tome ? 1.5 : 1;
  const use = brewUse(brew, 0.25 * k, 0.35 * k, tome ? 12 : 8);
  return {
    id: `scroll_${key}`,
    name: `${title} ${tome ? 'Tome' : 'Scroll'}`,
    slot: 'consumable',
    rarity: tome ? 'rare' : 'uncommon',
    sprite: `item_scroll_${key}`,
    spin: `spin_scroll_${key}`,
    value: tome ? 110 : 60,
    use,
    color: BREW_COLOR[brew],
    desc: `${tome ? 'A tome' : 'A scroll'} of ${SCROLL_WORD[brew]}, sealed with the ${title.toLowerCase()} device. Read it: it ${brewWords(use)}.`,
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
