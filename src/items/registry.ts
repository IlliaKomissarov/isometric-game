/**
 * @module items/registry
 * THE RAVEN REGISTRY (it.78): every base item populated from the local icon
 * pack (`public/assets/test-models/new items/Free - Raven Fantasy Icons`,
 * 2,192 painted 64 px icons). The pack is unnamed — the icons were sorted by
 * eye into weapon sets (steel 1441–1520, gilded 1521–1600, crystal
 * 1601–1680, unique 1681–1800, staves 1801–1808), armor (1809–2192),
 * materials, gems and scrolls — and each base below names the icon it wears
 * (`icon: 'raven<n>'`, served as the atlas single `wicon_raven<n>`).
 *
 * A base is a BLUEPRINT: its stats are the iLvl-1 common values. Everything
 * the player ever holds is an INSTANCE (`items/instance.ts`) that scales the
 * base by item level, rarity and reinforcement and adds affixes. `band` is
 * the item-level range the base drops in; `uniqueOnly` bases only appear on
 * legendary and mythic rolls.
 */

import type { ItemDef, WeaponKind } from './catalog';
import type { EquipmentSlot } from '@/network/Serialization';

type Band = [number, number];

const weapon = (id: string, name: string, kind: WeaponKind, icon: number, band: Band, dmg: [number, number], color: number, extra: Partial<ItemDef> = {}): ItemDef => ({
  id,
  name,
  slot: 'mainHand',
  rarity: 'common',
  weaponKind: kind,
  minDamage: dmg[0],
  maxDamage: dmg[1],
  range: kind === 'bow' ? 6 : kind === 'wand' ? 5.5 : undefined,
  icon: `raven${icon}`,
  band,
  color,
  ...extra,
});

const armor = (id: string, name: string, slot: EquipmentSlot, icon: number, band: Band, arm: number, color: number, extra: Partial<ItemDef> = {}): ItemDef => ({
  id,
  name,
  slot,
  rarity: 'common',
  armor: arm,
  icon: `raven${icon}`,
  band,
  color,
  ...extra,
});

const jewel = (id: string, name: string, icon: number, band: Band, bonus: ItemDef['bonus'], color: number): ItemDef => ({
  id,
  name,
  slot: 'ring',
  rarity: 'common',
  icon: `raven${icon}`,
  band,
  bonus,
  color,
});

/** The three tiers of every ordinary weapon shape: steel, gilded, crystal. */
interface Shape {
  key: string;
  name: string;
  kind: WeaponKind;
  /** Icon in the steel set; gilded is +80, crystal is +160. */
  icon: number;
  dmg: [number, number];
}

const SHAPES: Shape[] = [
  { key: 'dirk', name: 'Dirk', kind: 'katana', icon: 1441, dmg: [2, 5] },
  { key: 'shortsword', name: 'Shortsword', kind: 'blade', icon: 1443, dmg: [3, 6] },
  { key: 'cleaver', name: 'Cleaver', kind: 'axe', icon: 1445, dmg: [4, 8] },
  { key: 'blade', name: 'Blade', kind: 'blade', icon: 1447, dmg: [3, 7] },
  { key: 'longsword', name: 'Longsword', kind: 'blade', icon: 1448, dmg: [4, 7] },
  { key: 'claymore', name: 'Claymore', kind: 'blade', icon: 1449, dmg: [5, 9] },
  { key: 'spear', name: 'Spear', kind: 'polearm', icon: 1452, dmg: [4, 7] },
  { key: 'katana', name: 'Katana', kind: 'katana', icon: 1453, dmg: [3, 6] },
  { key: 'saber', name: 'Saber', kind: 'blade', icon: 1454, dmg: [3, 7] },
  { key: 'axe', name: 'Axe', kind: 'axe', icon: 1458, dmg: [4, 9] },
  { key: 'pike', name: 'Pike', kind: 'polearm', icon: 1460, dmg: [5, 8] },
  { key: 'broadaxe', name: 'Broadaxe', kind: 'axe', icon: 1461, dmg: [5, 10] },
  { key: 'battleaxe', name: 'Battleaxe', kind: 'axe', icon: 1465, dmg: [6, 11] },
  { key: 'hammer', name: 'Hammer', kind: 'mace', icon: 1469, dmg: [3, 8] },
  { key: 'maul', name: 'Maul', kind: 'mace', icon: 1471, dmg: [5, 10] },
  { key: 'flail', name: 'Flail', kind: 'mace', icon: 1478, dmg: [4, 9] },
  { key: 'shortbow', name: 'Shortbow', kind: 'bow', icon: 1481, dmg: [3, 6] },
  { key: 'crossbow', name: 'Crossbow', kind: 'bow', icon: 1482, dmg: [5, 8] },
  { key: 'wand', name: 'Wand', kind: 'wand', icon: 1489, dmg: [3, 5] },
  { key: 'scepter', name: 'Scepter', kind: 'wand', icon: 1490, dmg: [3, 6] },
  { key: 'rod', name: 'Rod', kind: 'wand', icon: 1493, dmg: [4, 6] },
  { key: 'morningstar', name: 'Morningstar', kind: 'mace', icon: 1506, dmg: [4, 10] },
  { key: 'scimitar', name: 'Scimitar', kind: 'katana', icon: 1509, dmg: [3, 7] },
  { key: 'longbow', name: 'Longbow', kind: 'bow', icon: 1514, dmg: [4, 7] },
  { key: 'warbow', name: 'Warbow', kind: 'bow', icon: 1515, dmg: [5, 9] },
];

const SETS: Array<{ key: string; name: string; offset: number; band: Band; mult: number; color: number }> = [
  { key: 'steel', name: 'Steel', offset: 0, band: [1, 38], mult: 1, color: 0xb8c0cc },
  { key: 'gilded', name: 'Gilded', offset: 80, band: [25, 70], mult: 1.12, color: 0xe8b84c },
  { key: 'crystal', name: 'Crystal', offset: 160, band: [55, 100], mult: 1.25, color: 0x7fc8ff },
];

const WEAPONS: ItemDef[] = [];
for (const set of SETS) {
  for (const s of SHAPES) {
    const wood = s.kind === 'wand' || s.kind === 'bow';
    const prefix = wood ? (set.key === 'steel' ? 'Ashwood' : set.key === 'gilded' ? 'Gilded' : 'Crystal') : set.name;
    WEAPONS.push(weapon(`${set.key}_${s.key}`, `${prefix} ${s.name}`, s.kind, s.icon + set.offset, set.band, [Math.round(s.dmg[0] * set.mult), Math.round(s.dmg[1] * set.mult)], set.color));
  }
}
// Staves (1801–1808): the mage's reach in three tiers.
WEAPONS.push(
  weapon('ashwood_staff', 'Ashwood Staff', 'wand', 1801, [1, 38], [4, 7], 0xb08a5a),
  weapon('gilded_staff', 'Gilded Staff', 'wand', 1802, [25, 70], [5, 8], 0xe8b84c),
  weapon('crystal_staff', 'Crystal Staff', 'wand', 1803, [55, 100], [6, 9], 0x7fc8ff),
);

/** UNIQUES (1681–1800): legendary and mythic rolls only. Named steel. */
const UNIQUES: ItemDef[] = [
  weapon('sunsplitter', 'Sunsplitter', 'blade', 1681, [1, 100], [5, 9], 0xffb347, { uniqueOnly: true }),
  weapon('nightfang', 'Nightfang', 'katana', 1684, [1, 100], [4, 7], 0x9a7fdf, { uniqueOnly: true }),
  weapon('emberflail', 'Emberflail', 'mace', 1688, [1, 100], [6, 11], 0xe0803a, { uniqueOnly: true }),
  weapon('moonscepter', 'Moonscepter', 'wand', 1690, [1, 100], [5, 8], 0xc8d8ff, { uniqueOnly: true }),
  weapon('tidecutter', 'Tidecutter', 'blade', 1694, [1, 100], [5, 9], 0x5fc8d8, { uniqueOnly: true }),
  weapon('gravebiter', 'Gravebiter', 'axe', 1697, [1, 100], [7, 12], 0x8a9a6a, { uniqueOnly: true }),
  weapon('stormbow', 'Stormbow', 'bow', 1700, [1, 100], [5, 9], 0x7fa8ff, { uniqueOnly: true }),
  weapon('hollow_reach', 'The Hollow Reach', 'polearm', 1705, [1, 100], [6, 10], 0xb0a0c0, { uniqueOnly: true, range: 2.1 }),
  weapon('kingsedge', "King's Edge", 'blade', 1708, [1, 100], [6, 10], 0xffd070, { uniqueOnly: true }),
  weapon('voidorb_staff', 'Voidorb Staff', 'wand', 1710, [1, 100], [6, 9], 0x9a5ad8, { uniqueOnly: true }),
  weapon('dawnbreaker', 'Dawnbreaker', 'axe', 1712, [1, 100], [7, 12], 0xffcf60, { uniqueOnly: true }),
  weapon('whisper', 'Whisper', 'katana', 1716, [1, 100], [4, 8], 0xd8d8e8, { uniqueOnly: true }),
  weapon('ashen_bow', 'Ashen Bow', 'bow', 1719, [1, 100], [5, 8], 0x8a6f4d, { uniqueOnly: true }),
  weapon('judgment', 'Judgment', 'mace', 1722, [1, 100], [6, 12], 0xe8cf8a, { uniqueOnly: true }),
  weapon('serpent_fang', 'Serpent Fang', 'katana', 1727, [1, 100], [4, 8], 0x7fd67f, { uniqueOnly: true }),
  weapon('frost_reaver', 'Frost Reaver', 'axe', 1730, [1, 100], [7, 11], 0x9fd8ff, { uniqueOnly: true }),
  weapon('crescent_of_sorrow', 'Crescent of Sorrow', 'polearm', 1737, [1, 100], [6, 10], 0xc0a0ff, { uniqueOnly: true }),
  weapon('doomcaller', 'Doomcaller', 'wand', 1745, [1, 100], [6, 9], 0xff6f8a, { uniqueOnly: true }),
  weapon('duskwind_bow', 'Duskwind Bow', 'bow', 1750, [1, 100], [5, 9], 0x6a5a9a, { uniqueOnly: true }),
  weapon('ironheart_spear', 'Ironheart Spear', 'polearm', 1762, [1, 100], [6, 10], 0xa8b0c0, { uniqueOnly: true }),
  weapon('widows_bow', "Widow's Bow", 'bow', 1782, [1, 100], [6, 9], 0x3a3a4a, { uniqueOnly: true }),
  weapon('cinderbrand', 'Cinderbrand', 'blade', 1793, [1, 100], [6, 10], 0xff8c3a, { uniqueOnly: true }),
];

const ARMOR: ItemDef[] = [
  // Head.
  armor('leather_hood', 'Leather Hood', 'head', 1953, [1, 35], 1, 0x8a6a48),
  armor('travelers_hat', "Traveler's Hat", 'head', 1958, [1, 35], 1, 0x7a6650),
  armor('wizard_hat', 'Wizard Hat', 'head', 1961, [1, 40], 1, 0x6a5a9a),
  armor('iron_helm', 'Iron Helm', 'head', 1905, [10, 50], 1.3, 0x9aa0a8),
  armor('copper_helm', 'Copper Helm', 'head', 1909, [15, 50], 1.3, 0xc8783c),
  armor('steel_helm', 'Steel Helm', 'head', 1913, [20, 60], 1.4, 0xb8c0cc),
  armor('gilded_helm', 'Gilded Helm', 'head', 1916, [35, 75], 1.5, 0xe8b84c),
  armor('plumed_hat', 'Plumed Hat', 'head', 2001, [20, 60], 1.2, 0xc86040),
  armor('ember_hood', 'Ember Hood', 'head', 2013, [40, 85], 1.4, 0xe0803a),
  armor('knight_helm', 'Knight Helm', 'head', 2077, [50, 100], 1.6, 0xa8b0c0),
  armor('warlord_helm', 'Warlord Helm', 'head', 2079, [60, 100], 1.7, 0x8a8a94),
  // Body.
  armor('padded_tunic', 'Padded Tunic', 'torso', 1815, [1, 30], 2, 0x8a6a48),
  armor('quilted_vest', 'Quilted Vest', 'torso', 1821, [1, 35], 2, 0xa88a58),
  armor('silk_robe', 'Silk Robe', 'torso', 2085, [1, 40], 1.6, 0x6a5a9a),
  armor('iron_cuirass', 'Iron Cuirass', 'torso', 1921, [10, 45], 2.6, 0x9aa0a8),
  armor('blue_mail', 'Blue Mail', 'torso', 1857, [15, 50], 2.6, 0x5a6a9a),
  armor('chain_hauberk', 'Chain Hauberk', 'torso', 1861, [20, 55], 2.8, 0x8a8a94),
  armor('crimson_robe', 'Crimson Robe', 'torso', 2093, [30, 70], 2.2, 0xc83030),
  armor('bone_mail', 'Bone Mail', 'torso', 2049, [30, 70], 2.8, 0xd8d0b8),
  armor('orange_plate', 'Bronze Plate', 'torso', 1881, [35, 75], 3, 0xd8763c),
  armor('warplate', 'Warplate', 'torso', 1885, [40, 80], 3.2, 0xc86040),
  armor('gilded_cuirass', 'Gilded Cuirass', 'torso', 1927, [45, 85], 3.2, 0xe8b84c),
  armor('crystal_plate', 'Crystal Plate', 'torso', 1901, [55, 100], 3.6, 0x7fc8ff),
  // Legs.
  armor('worn_sandals', 'Worn Sandals', 'legs', 1853, [1, 25], 0.8, 0x7a6650),
  armor('cloth_shoes', 'Cloth Shoes', 'legs', 1985, [1, 30], 0.8, 0x6a5a9a),
  armor('leather_boots', 'Leather Boots', 'legs', 1937, [5, 40], 1, 0x8a6a48),
  armor('studded_boots', 'Studded Boots', 'legs', 2033, [20, 60], 1.2, 0x9aa0a8),
  armor('riding_boots', 'Riding Boots', 'legs', 1941, [30, 70], 1.3, 0xe8b84c),
  armor('ember_greaves', 'Ember Greaves', 'legs', 2170, [45, 90], 1.5, 0xe0803a),
  armor('crystal_greaves', 'Crystal Greaves', 'legs', 2161, [55, 100], 1.6, 0x7fc8ff),
  // Off hand.
  armor('round_shield', 'Round Shield', 'offHand', 2113, [1, 35], 2, 0x8a6f4d),
  armor('red_buckler', 'Red Buckler', 'offHand', 2117, [5, 40], 2.2, 0xc83030),
  armor('amber_orb', 'Amber Orb', 'offHand', 1809, [1, 45], 1.2, 0xe0803a, { bonus: { dmg: 0.05 } }),
  armor('sapphire_orb', 'Sapphire Orb', 'offHand', 1810, [20, 70], 1.4, 0x5f7fdf, { bonus: { dmg: 0.06, regen: 0.1 } }),
  armor('kite_shield', 'Kite Shield', 'offHand', 2121, [15, 55], 2.6, 0x6f8fd0),
  armor('steel_targe', 'Steel Targe', 'offHand', 2131, [25, 65], 2.8, 0xb8c0cc),
  armor('gilded_shield', 'Gilded Shield', 'offHand', 2137, [40, 80], 3.2, 0xe8b84c),
  armor('crystal_ward', 'Crystal Ward', 'offHand', 2145, [55, 100], 3.6, 0x7fc8ff),
  armor('crystal_aegis', 'Crystal Aegis', 'offHand', 2149, [65, 100], 3.8, 0x9fd8ff),
  armor('frost_shard', 'Frost Shard', 'offHand', 2153, [50, 100], 1.8, 0x9fd8ff, { bonus: { dmg: 0.08 } }),
  // Back.
  armor('travelers_cloak', "Traveler's Cloak", 'cloak', 1975, [1, 40], 1, 0x8a6a48),
  armor('hunters_cloak', "Hunter's Cloak", 'cloak', 1979, [10, 50], 1.1, 0x6f9a5a),
  armor('velvet_mantle', 'Velvet Mantle', 'cloak', 2025, [25, 65], 1.2, 0x9a5ad8),
  armor('ember_mantle', 'Ember Mantle', 'cloak', 2029, [40, 85], 1.4, 0xe0803a),
  armor('shadow_shroud', 'Shadow Shroud', 'cloak', 2173, [50, 100], 1.5, 0x3a3a4a, { bonus: { dodge: 0.03 } }),
];

const JEWELRY: ItemDef[] = [
  jewel('silver_band', 'Silver Band', 1843, [1, 40], { hp: 6 }, 0xc8d0d8),
  jewel('gold_band', 'Gold Band', 1844, [10, 60], { hp: 8, dmg: 0.03 }, 0xe8b84c),
  jewel('emerald_ring', 'Emerald Ring', 1846, [20, 80], { regen: 0.15 }, 0x7fd67f),
  jewel('ruby_ring', 'Ruby Ring', 1849, [20, 80], { dmg: 0.06 }, 0xe06a5a),
  jewel('iron_signet', 'Iron Signet', 2061, [1, 50], { armor: 1 }, 0x9aa0a8),
  jewel('bone_ring', 'Bone Ring', 2064, [30, 100], { dodge: 0.04 }, 0xd8d0b8),
  jewel('sapphire_amulet', 'Sapphire Amulet', 2177, [25, 90], { regen: 0.2, hp: 6 }, 0x5f7fdf),
  jewel('ruby_amulet', 'Ruby Amulet', 2181, [25, 90], { dmg: 0.07 }, 0xe06a5a),
  jewel('moon_amulet', 'Moon Amulet', 2185, [40, 100], { dodge: 0.05, hp: 10 }, 0xc8d8ff),
  jewel('sun_medallion', 'Sun Medallion', 1835, [40, 100], { dmg: 0.08, armor: 2 }, 0xffcf60),
];

/** Crafting materials live in the hero's pouch, never in the pack. */
export const MATERIALS: ItemDef[] = [
  { id: 'iron_scrap', name: 'Iron Scraps', slot: 'material', rarity: 'common', icon: 'raven209', value: 6, color: 0x9a9a9a },
  { id: 'arcane_dust', name: 'Arcane Dust', slot: 'material', rarity: 'uncommon', icon: 'raven187', value: 25, color: 0x5f7fdf },
  { id: 'essence', name: 'Essence', slot: 'material', rarity: 'rare', icon: 'raven170', value: 110, color: 0x5fd8c8 },
  { id: 'alloy_shard', name: 'Alloy Shards', slot: 'material', rarity: 'epic', icon: 'raven213', value: 420, color: 0xc8a0ff },
  { id: 'catalyst', name: 'Catalyst', slot: 'material', rarity: 'legendary', icon: 'raven172', value: 1500, color: 0xffb347 },
];

export const MATERIAL_ORDER: readonly string[] = ['iron_scrap', 'arcane_dust', 'essence', 'alloy_shard', 'catalyst'];

export const RAVEN_ITEMS: ItemDef[] = [...WEAPONS, ...UNIQUES, ...ARMOR, ...JEWELRY, ...MATERIALS];

/** Every base that can be rolled or forged (no materials, no uniques unless asked). */
export function gearBases(): ItemDef[] {
  return RAVEN_ITEMS.filter((d) => d.slot !== 'material');
}
