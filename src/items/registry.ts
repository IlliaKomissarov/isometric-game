/**
 * @module items/registry
 * THE RAVEN REGISTRY (it.78, arsenal rebuilt it.80): every base item
 * populated from the local icon pack (`public/assets/test-models/new items`,
 * 2,192 painted 64 px icons), each base naming the icon it wears
 * (`icon: 'raven<n>'`, served as the atlas single `wicon_raven<n>`).
 *
 * WEAPON IDENTITY (it.80). No two weapons are the same weapon with a
 * different icon any more. Every SHAPE has a role — its damage, swing speed,
 * crit and reach — and every TIER of a shape (steel 1–38, gilded 25–70,
 * crystal 55–100) carries a different INNATE effect: a status proc on hit
 * (bleed, poison, burn, chill, shock, stun) or a granted trait (reaping,
 * siphon, cleave, impact, swiftness, guardian, fortune, seeker, berserk,
 * precision — see `items/effects.ts`). Uniques carry two.
 *
 * A base is a BLUEPRINT: its stats are the iLvl-1 common values; instances
 * (`items/instance.ts`) scale them by level, rarity and reinforcement and
 * add affixes and an enchantment.
 */

import type { ItemDef, WeaponKind } from './catalog';
import { ENCHANTS, type Effect } from './effects';
import type { EquipmentSlot } from '@/network/Serialization';

type Band = [number, number];

const proc = (status: NonNullable<Effect['proc']>['status'], chance: number, power = 1): Effect => ({ proc: { status, chance, power } });
const trait = (key: NonNullable<Effect['trait']>['key'], power = 1): Effect => ({ trait: { key, power } });

interface Shape {
  key: string;
  name: string;
  kind: WeaponKind;
  /** Icon in the steel set; gilded is +80, crystal is +160 (the pack repeats the layout). */
  icon: number;
  dmg: [number, number];
  /** Swing-speed multiplier (1 = the family's timing; higher is faster). */
  speed?: number;
  /** Added crit chance. */
  crit?: number;
  /** Added reach in tiles. */
  reach?: number;
  /** The innate per tier: steel, gilded, crystal. */
  innates: [Effect | null, Effect, Effect];
}

/** The tier names by family: wood-and-string weapons say ashwood, not steel. */
const TIERS: Array<{ key: string; name: string; wood: string; offset: number; band: Band; mult: number; color: number }> = [
  { key: 'steel', name: 'Steel', wood: 'Ashwood', offset: 0, band: [1, 38], mult: 1, color: 0xb8c0cc },
  { key: 'gilded', name: 'Gilded', wood: 'Gilded', offset: 80, band: [25, 70], mult: 1.12, color: 0xe8b84c },
  { key: 'crystal', name: 'Crystal', wood: 'Crystal', offset: 160, band: [55, 100], mult: 1.25, color: 0x7fc8ff },
];

const SHAPES: Shape[] = [
  // ---- Blades: the all-rounders ---------------------------------------------
  { key: 'shortsword', name: 'Shortsword', kind: 'blade', icon: 1443, dmg: [3, 6], speed: 1.06, innates: [null, trait('swift'), proc('shock', 0.2)] },
  { key: 'blade', name: 'Blade', kind: 'blade', icon: 1447, dmg: [3, 7], innates: [null, trait('fortune'), proc('bleed', 0.25)] },
  { key: 'longsword', name: 'Longsword', kind: 'blade', icon: 1448, dmg: [4, 7], crit: 0.02, innates: [null, trait('precise'), proc('burn', 0.25)] },
  { key: 'saber', name: 'Saber', kind: 'blade', icon: 1454, dmg: [3, 7], crit: 0.04, innates: [proc('bleed', 0.15), proc('bleed', 0.25), proc('bleed', 0.35, 1.3)] },
  { key: 'claymore', name: 'Claymore', kind: 'blade', icon: 1449, dmg: [5, 9], speed: 0.9, innates: [trait('knockback', 0.6), trait('knockback'), trait('cleave')] },
  { key: 'greatsword', name: 'Greatsword', kind: 'blade', icon: 1517, dmg: [6, 10], speed: 0.85, innates: [trait('cleave', 0.7), trait('cleave'), trait('cleave', 1.4)] },
  { key: 'rapier', name: 'Rapier', kind: 'blade', icon: 1505, dmg: [3, 6], speed: 1.12, crit: 0.06, innates: [trait('precise', 0.6), trait('precise'), trait('precise', 1.5)] },
  { key: 'falchion', name: 'Falchion', kind: 'blade', icon: 1520, dmg: [4, 8], innates: [null, trait('berserk'), proc('stun', 0.15)] },
  // ---- Fast steel: katanas, dirks, scimitars ---------------------------------
  { key: 'dirk', name: 'Dirk', kind: 'katana', icon: 1441, dmg: [2, 5], speed: 1.15, innates: [proc('bleed', 0.2), proc('bleed', 0.3), proc('poison', 0.3)] },
  { key: 'kris', name: 'Kris', kind: 'katana', icon: 1444, dmg: [2, 4], speed: 1.25, innates: [proc('poison', 0.25), proc('poison', 0.35), proc('poison', 0.45, 1.3)] },
  { key: 'katana', name: 'Katana', kind: 'katana', icon: 1453, dmg: [3, 6], innates: [null, trait('precise'), proc('bleed', 0.3)] },
  { key: 'scimitar', name: 'Scimitar', kind: 'katana', icon: 1509, dmg: [3, 7], innates: [null, trait('swift'), proc('burn', 0.3)] },
  { key: 'twinblade', name: 'Twinblade', kind: 'katana', icon: 1519, dmg: [3, 6], speed: 1.05, innates: [trait('cleave', 0.6), trait('cleave'), trait('cleave', 1.3)] },
  // ---- Axes: heavy, bleeding, cleaving ----------------------------------------
  { key: 'hatchet', name: 'Hatchet', kind: 'axe', icon: 1457, dmg: [3, 7], speed: 1.08, innates: [null, trait('swift'), proc('bleed', 0.3)] },
  { key: 'cleaver', name: 'Cleaver', kind: 'axe', icon: 1445, dmg: [4, 8], innates: [proc('bleed', 0.2), proc('bleed', 0.3), proc('bleed', 0.4, 1.3)] },
  { key: 'axe', name: 'Axe', kind: 'axe', icon: 1458, dmg: [4, 9], innates: [null, trait('berserk'), trait('berserk', 1.5)] },
  { key: 'broadaxe', name: 'Broadaxe', kind: 'axe', icon: 1461, dmg: [5, 10], innates: [null, trait('knockback'), proc('stun', 0.2)] },
  { key: 'battleaxe', name: 'Battleaxe', kind: 'axe', icon: 1465, dmg: [6, 11], speed: 0.9, innates: [trait('cleave', 0.6), trait('cleave'), proc('bleed', 0.35, 1.5)] },
  { key: 'greataxe', name: 'Greataxe', kind: 'axe', icon: 1466, dmg: [7, 12], speed: 0.8, innates: [trait('cleave', 0.8), trait('cleave', 1.2), trait('cleave', 1.6)] },
  // ---- Maces: the stunners --------------------------------------------------
  { key: 'hammer', name: 'Hammer', kind: 'mace', icon: 1469, dmg: [3, 8], innates: [proc('stun', 0.12), proc('stun', 0.18), proc('stun', 0.25, 1.2)] },
  { key: 'maul', name: 'Maul', kind: 'mace', icon: 1471, dmg: [5, 10], speed: 0.85, innates: [trait('knockback', 0.7), trait('knockback', 1.2), proc('stun', 0.3, 1.3)] },
  { key: 'flail', name: 'Flail', kind: 'mace', icon: 1478, dmg: [4, 9], innates: [null, proc('bleed', 0.25), proc('shock', 0.25)] },
  { key: 'morningstar', name: 'Morningstar', kind: 'mace', icon: 1506, dmg: [4, 10], innates: [proc('stun', 0.1), proc('bleed', 0.25), proc('stun', 0.25)] },
  { key: 'warpick', name: 'Warpick', kind: 'mace', icon: 1473, dmg: [4, 8], crit: 0.05, innates: [trait('precise', 0.6), trait('precise'), trait('precise', 1.5)] },
  // ---- Polearms: reach -----------------------------------------------------------
  { key: 'spear', name: 'Spear', kind: 'polearm', icon: 1452, dmg: [4, 7], innates: [null, trait('swift'), proc('bleed', 0.25)] },
  { key: 'pike', name: 'Pike', kind: 'polearm', icon: 1477, dmg: [5, 8], reach: 0.3, innates: [trait('knockback', 0.6), trait('knockback'), proc('stun', 0.2)] },
  { key: 'glaive', name: 'Glaive', kind: 'polearm', icon: 1476, dmg: [5, 9], innates: [trait('cleave', 0.6), trait('cleave'), trait('cleave', 1.4)] },
  { key: 'sickle', name: 'Sickle', kind: 'polearm', icon: 1451, dmg: [3, 7], speed: 1.1, reach: -0.5, innates: [proc('bleed', 0.2), trait('lifeOnKill'), trait('lifeOnKill', 1.5)] },
  // ---- Bows -------------------------------------------------------------------
  { key: 'shortbow', name: 'Shortbow', kind: 'bow', icon: 1481, dmg: [3, 6], speed: 1.1, innates: [null, trait('swift'), proc('poison', 0.3)] },
  { key: 'longbow', name: 'Longbow', kind: 'bow', icon: 1514, dmg: [4, 7], reach: 0.5, innates: [null, trait('precise'), proc('burn', 0.3)] },
  { key: 'warbow', name: 'Warbow', kind: 'bow', icon: 1515, dmg: [5, 9], speed: 0.9, innates: [trait('knockback', 0.6), trait('knockback'), proc('shock', 0.3)] },
  { key: 'crossbow', name: 'Crossbow', kind: 'bow', icon: 1482, dmg: [5, 8], speed: 0.85, innates: [proc('stun', 0.12), proc('stun', 0.2), proc('stun', 0.28, 1.2)] },
  { key: 'recurve', name: 'Recurve Bow', kind: 'bow', icon: 1516, dmg: [4, 7], crit: 0.04, innates: [trait('seeker', 0.8), trait('seeker'), trait('seeker', 1.5)] },
  // ---- Wands, scepters, rods -------------------------------------------------------
  { key: 'wand', name: 'Wand', kind: 'wand', icon: 1489, dmg: [3, 5], speed: 1.05, innates: [null, trait('manaOnHit'), proc('shock', 0.3)] },
  { key: 'scepter', name: 'Scepter', kind: 'wand', icon: 1490, dmg: [3, 6], innates: [trait('manaOnHit', 0.6), trait('manaOnHit'), trait('manaOnHit', 1.5)] },
  { key: 'rod', name: 'Rod', kind: 'wand', icon: 1493, dmg: [4, 6], innates: [proc('burn', 0.2), proc('burn', 0.3), proc('burn', 0.4, 1.3)] },
  { key: 'orbrod', name: 'Orb Rod', kind: 'wand', icon: 1498, dmg: [4, 7], speed: 0.95, innates: [proc('chill', 0.2), proc('chill', 0.3), proc('chill', 0.4, 1.2)] },
];

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

const WEAPONS: ItemDef[] = [];
for (let t = 0; t < TIERS.length; t++) {
  const tier = TIERS[t];
  for (const s of SHAPES) {
    const wood = s.kind === 'wand' || s.kind === 'bow';
    const prefix = wood ? tier.wood : tier.name;
    const innate = s.innates[t] ?? undefined;
    WEAPONS.push(
      weapon(`${tier.key}_${s.key}`, `${prefix} ${s.name}`, s.kind, s.icon + tier.offset, tier.band, [Math.round(s.dmg[0] * tier.mult), Math.round(s.dmg[1] * tier.mult)], tier.color, {
        speedMult: s.speed,
        critBonus: s.crit,
        reachBonus: s.reach,
        innate,
      }),
    );
  }
}
// Staves (1801–1808): the mage's reach in three tiers.
WEAPONS.push(
  weapon('ashwood_staff', 'Ashwood Staff', 'wand', 1801, [1, 38], [4, 7], 0xb08a5a, { reachBonus: 0.5, innate: trait('manaOnHit', 0.6) }),
  weapon('gilded_staff', 'Gilded Staff', 'wand', 1802, [25, 70], [5, 8], 0xe8b84c, { reachBonus: 0.5, innate: trait('manaOnHit') }),
  weapon('crystal_staff', 'Crystal Staff', 'wand', 1803, [55, 100], [6, 9], 0x7fc8ff, { reachBonus: 0.5, innate: proc('chill', 0.35, 1.2) }),
);

/** UNIQUES (1681–1800): legendary and mythic rolls only. Named steel with two innates. */
const unique = (id: string, name: string, kind: WeaponKind, icon: number, dmg: [number, number], color: number, innate: Effect, second: Effect, extra: Partial<ItemDef> = {}): ItemDef =>
  weapon(id, name, kind, icon, [1, 100], dmg, color, { uniqueOnly: true, innate, innate2: second, ...extra });

const UNIQUES: ItemDef[] = [
  unique('sunsplitter', 'Sunsplitter', 'blade', 1681, [5, 9], 0xffb347, proc('burn', 0.4, 1.3), trait('precise')),
  unique('nightfang', 'Nightfang', 'katana', 1684, [4, 7], 0x9a7fdf, proc('poison', 0.45, 1.3), trait('swift', 1.5), { speedMult: 1.1 }),
  unique('emberflail', 'Emberflail', 'mace', 1688, [6, 11], 0xe0803a, proc('burn', 0.35), proc('stun', 0.2)),
  unique('moonscepter', 'Moonscepter', 'wand', 1690, [5, 8], 0xc8d8ff, proc('chill', 0.4, 1.2), trait('manaOnHit', 1.5)),
  unique('tidecutter', 'Tidecutter', 'blade', 1694, [5, 9], 0x5fc8d8, proc('chill', 0.3), trait('cleave')),
  unique('gravebiter', 'Gravebiter', 'axe', 1697, [7, 12], 0x8a9a6a, proc('bleed', 0.4, 1.5), trait('lifeOnKill', 1.5)),
  unique('stormbow', 'Stormbow', 'bow', 1700, [5, 9], 0x7fa8ff, proc('shock', 0.4, 1.3), trait('precise')),
  unique('hollow_reach', 'The Hollow Reach', 'polearm', 1705, [6, 10], 0xb0a0c0, trait('cleave', 1.5), proc('bleed', 0.3), { range: 2.1 }),
  unique('kingsedge', "King's Edge", 'blade', 1708, [6, 10], 0xffd070, trait('fortune', 2), trait('berserk')),
  unique('voidorb_staff', 'Voidorb Staff', 'wand', 1710, [6, 9], 0x9a5ad8, proc('shock', 0.35), trait('manaOnHit', 2), { reachBonus: 0.5 }),
  unique('dawnbreaker', 'Dawnbreaker', 'axe', 1712, [7, 12], 0xffcf60, proc('burn', 0.4), proc('stun', 0.2)),
  unique('whisper', 'Whisper', 'katana', 1716, [4, 8], 0xd8d8e8, trait('precise', 2), trait('swift'), { speedMult: 1.15, critBonus: 0.08 }),
  unique('ashen_bow', 'Ashen Bow', 'bow', 1719, [5, 8], 0x8a6f4d, proc('burn', 0.35, 1.2), trait('seeker', 1.5)),
  unique('judgment', 'Judgment', 'mace', 1722, [6, 12], 0xe8cf8a, proc('stun', 0.3, 1.5), trait('knockback', 1.5)),
  unique('serpent_fang', 'Serpent Fang', 'katana', 1727, [4, 8], 0x7fd67f, proc('poison', 0.5, 1.5), proc('bleed', 0.2)),
  unique('frost_reaver', 'Frost Reaver', 'axe', 1730, [7, 11], 0x9fd8ff, proc('chill', 0.45, 1.3), trait('cleave')),
  unique('crescent_of_sorrow', 'Crescent of Sorrow', 'polearm', 1737, [6, 10], 0xc0a0ff, trait('lifeOnKill', 2), proc('bleed', 0.3)),
  unique('doomcaller', 'Doomcaller', 'wand', 1745, [6, 9], 0xff6f8a, proc('burn', 0.3), proc('shock', 0.3)),
  unique('duskwind_bow', 'Duskwind Bow', 'bow', 1750, [5, 9], 0x6a5a9a, proc('poison', 0.35), trait('swift', 1.5)),
  unique('ironheart_spear', 'Ironheart Spear', 'polearm', 1762, [6, 10], 0xa8b0c0, trait('guardian', 2), trait('knockback')),
  unique('widows_bow', "Widow's Bow", 'bow', 1782, [6, 9], 0x3a3a4a, proc('bleed', 0.4, 1.3), trait('precise', 1.5)),
  unique('cinderbrand', 'Cinderbrand', 'blade', 1793, [6, 10], 0xff8c3a, proc('burn', 0.45, 1.5), trait('berserk', 1.5)),
];

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

const ARMOR: ItemDef[] = [
  // Head.
  armor('leather_hood', 'Leather Hood', 'head', 1953, [1, 35], 1, 0x8a6a48),
  armor('travelers_hat', "Traveler's Hat", 'head', 1958, [1, 35], 1, 0x7a6650),
  armor('wizard_hat', 'Wizard Hat', 'head', 1961, [1, 40], 1, 0x6a5a9a, { bonus: { regen: 0.1 } }),
  armor('iron_helm', 'Iron Helm', 'head', 1905, [10, 50], 1.3, 0x9aa0a8),
  armor('copper_helm', 'Copper Helm', 'head', 1909, [15, 50], 1.3, 0xc8783c),
  armor('steel_helm', 'Steel Helm', 'head', 1913, [20, 60], 1.4, 0xb8c0cc),
  armor('gilded_helm', 'Gilded Helm', 'head', 1916, [35, 75], 1.5, 0xe8b84c),
  armor('plumed_hat', 'Plumed Hat', 'head', 2001, [20, 60], 1.2, 0xc86040, { bonus: { dodge: 0.02 } }),
  armor('ember_hood', 'Ember Hood', 'head', 2013, [40, 85], 1.4, 0xe0803a, { bonus: { dmg: 0.03 } }),
  armor('knight_helm', 'Knight Helm', 'head', 2077, [50, 100], 1.6, 0xa8b0c0),
  armor('warlord_helm', 'Warlord Helm', 'head', 2079, [60, 100], 1.7, 0x8a8a94, { bonus: { dmg: 0.04 } }),
  // Body.
  armor('padded_tunic', 'Padded Tunic', 'torso', 1815, [1, 30], 2, 0x8a6a48),
  armor('quilted_vest', 'Quilted Vest', 'torso', 1821, [1, 35], 2, 0xa88a58),
  armor('silk_robe', 'Silk Robe', 'torso', 2085, [1, 40], 1.6, 0x6a5a9a, { bonus: { regen: 0.15 } }),
  armor('iron_cuirass', 'Iron Cuirass', 'torso', 1921, [10, 45], 2.6, 0x9aa0a8),
  armor('blue_mail', 'Blue Mail', 'torso', 1857, [15, 50], 2.6, 0x5a6a9a),
  armor('chain_hauberk', 'Chain Hauberk', 'torso', 1861, [20, 55], 2.8, 0x8a8a94),
  armor('crimson_robe', 'Crimson Robe', 'torso', 2093, [30, 70], 2.2, 0xc83030, { bonus: { dmg: 0.05 } }),
  armor('bone_mail', 'Bone Mail', 'torso', 2049, [30, 70], 2.8, 0xd8d0b8, { bonus: { hp: 10 } }),
  armor('orange_plate', 'Bronze Plate', 'torso', 1881, [35, 75], 3, 0xd8763c),
  armor('warplate', 'Warplate', 'torso', 1885, [40, 80], 3.2, 0xc86040),
  armor('gilded_cuirass', 'Gilded Cuirass', 'torso', 1927, [45, 85], 3.2, 0xe8b84c),
  armor('crystal_plate', 'Crystal Plate', 'torso', 1901, [55, 100], 3.6, 0x7fc8ff),
  // Legs.
  armor('worn_sandals', 'Worn Sandals', 'legs', 1853, [1, 25], 0.8, 0x7a6650),
  armor('cloth_shoes', 'Cloth Shoes', 'legs', 1985, [1, 30], 0.8, 0x6a5a9a),
  armor('leather_boots', 'Leather Boots', 'legs', 1937, [5, 40], 1, 0x8a6a48),
  armor('studded_boots', 'Studded Boots', 'legs', 2033, [20, 60], 1.2, 0x9aa0a8),
  armor('riding_boots', 'Riding Boots', 'legs', 1941, [30, 70], 1.3, 0xe8b84c, { bonus: { dodge: 0.02 } }),
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
  armor('crystal_aegis', 'Crystal Aegis', 'offHand', 2149, [65, 100], 3.8, 0x9fd8ff, { bonus: { hp: 15 } }),
  armor('frost_shard', 'Frost Shard', 'offHand', 2153, [50, 100], 1.8, 0x9fd8ff, { bonus: { dmg: 0.08 } }),
  // Back.
  armor('travelers_cloak', "Traveler's Cloak", 'cloak', 1975, [1, 40], 1, 0x8a6a48),
  armor('hunters_cloak', "Hunter's Cloak", 'cloak', 1979, [10, 50], 1.1, 0x6f9a5a, { bonus: { dodge: 0.02 } }),
  armor('velvet_mantle', 'Velvet Mantle', 'cloak', 2025, [25, 65], 1.2, 0x9a5ad8, { bonus: { regen: 0.1 } }),
  armor('ember_mantle', 'Ember Mantle', 'cloak', 2029, [40, 85], 1.4, 0xe0803a, { bonus: { dmg: 0.04 } }),
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

/**
 * DRAUGHTS (it.80): more than health and mana. Every draught goes on the
 * belt; healing draughts share a five-second cooldown, the rest a short one.
 */
export const DRAUGHTS: ItemDef[] = [
  { id: 'rejuvenation', name: 'Draught of Rejuvenation', slot: 'consumable', rarity: 'uncommon', icon: 'raven122', value: 95, use: { heal: 0.35, resource: 0.35 }, color: 0x9a5ad8 },
  { id: 'potion_haste', name: 'Draught of Haste', slot: 'consumable', rarity: 'uncommon', icon: 'raven121', value: 120, use: { haste: 480 }, color: 0x7fd67f },
  { id: 'potion_stone', name: 'Draught of Stone', slot: 'consumable', rarity: 'uncommon', icon: 'raven123', value: 120, use: { stone: 480 }, color: 0x5f7fdf },
  { id: 'potion_might', name: 'Draught of Might', slot: 'consumable', rarity: 'rare', icon: 'raven269', value: 150, use: { might: 600 }, color: 0xe0803a },
  { id: 'greater_health', name: 'Greater Healing Draught', slot: 'consumable', rarity: 'uncommon', icon: 'raven270', value: 80, use: { heal: 0.8 }, color: 0xc83030 },
  { id: 'greater_mana', name: 'Greater Mana Draught', slot: 'consumable', rarity: 'uncommon', icon: 'raven68', value: 80, use: { resource: 1 }, color: 0x4a6ad8 },
];

/** RECIPE SCROLLS (it.80): read one to learn an enchantment for the forge. */
export const RECIPES: ItemDef[] = Object.values(ENCHANTS).map((r) => ({
  id: `recipe_${r.key}`,
  name: `Recipe: ${r.name}`,
  slot: 'consumable',
  rarity: 'rare',
  icon: `raven${r.icon}`,
  value: 220,
  use: { recipe: r.key },
  color: 0xd8c890,
}));

export const RAVEN_ITEMS: ItemDef[] = [...WEAPONS, ...UNIQUES, ...ARMOR, ...JEWELRY, ...MATERIALS, ...DRAUGHTS, ...RECIPES];

/** Every base that can be rolled or forged (no materials, draughts or recipes). */
export function gearBases(): ItemDef[] {
  return RAVEN_ITEMS.filter((d) => d.slot !== 'material' && d.slot !== 'consumable');
}
