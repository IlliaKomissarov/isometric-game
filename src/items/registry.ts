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

import { FOOD_TIER, type FoodTier, type ItemDef, type WeaponKind } from './catalog';
import { ENCHANTS, type Effect } from './effects';
import { CURIOS } from './curios';
import type { EquipmentSlot } from '@/network/Serialization';

type Band = [number, number];

const proc = (status: NonNullable<Effect['proc']>['status'], chance: number, power = 1): Effect => ({ proc: { status, chance, power } });
const trait = (key: NonNullable<Effect['trait']>['key'], power = 1): Effect => ({ trait: { key, power } });

export interface Shape {
  key: string;
  name: string;
  kind: WeaponKind;
  /** The shape's own words: its role. */
  desc: string;
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
export const TIERS: Array<{ key: string; name: string; wood: string; offset: number; band: Band; mult: number; color: number }> = [
  { key: 'steel', name: 'Steel', wood: 'Ashwood', offset: 0, band: [1, 38], mult: 1, color: 0xb8c0cc },
  { key: 'gilded', name: 'Gilded', wood: 'Gilded', offset: 80, band: [25, 70], mult: 1.12, color: 0xe8b84c },
  { key: 'crystal', name: 'Crystal', wood: 'Crystal', offset: 160, band: [55, 100], mult: 1.25, color: 0x7fc8ff },
];

export const SHAPES: Shape[] = [
  // ---- Blades: the all-rounders ---------------------------------------------
  { key: 'shortsword', desc: "Quick, light steel for a fresh delver: a touch faster than the family, forgiving in a crowd.", name: 'Shortsword', kind: 'blade', icon: 1443, dmg: [3, 6], speed: 1.06, innates: [null, trait('swift'), proc('shock', 0.2)] },
  { key: 'blade', desc: "The plain sword. Nothing special about it except that it does everything.", name: 'Blade', kind: 'blade', icon: 1447, dmg: [3, 7], innates: [null, trait('fortune'), proc('bleed', 0.25)] },
  { key: 'longsword', desc: "A longer edge with a longer reach on the crit: the duelist’s blade.", name: 'Longsword', kind: 'blade', icon: 1448, dmg: [4, 7], crit: 0.02, innates: [null, trait('precise'), proc('burn', 0.25)] },
  { key: 'saber', desc: "Curved to cut rather than chop; its crit runs high and it opens wounds that keep bleeding.", name: 'Saber', kind: 'blade', icon: 1454, dmg: [3, 7], crit: 0.04, innates: [proc('bleed', 0.15), proc('bleed', 0.25), proc('bleed', 0.35, 1.3)] },
  { key: 'claymore', desc: "Two hands of steel. Slower, heavier, and it throws what it hits.", name: 'Claymore', kind: 'blade', icon: 1449, dmg: [5, 9], speed: 0.9, innates: [trait('knockback', 0.6), trait('knockback'), trait('cleave')] },
  { key: 'greatsword', desc: "The slowest blade and the widest: every swing cuts a second foe.", name: 'Greatsword', kind: 'blade', icon: 1517, dmg: [6, 10], speed: 0.85, innates: [trait('cleave', 0.7), trait('cleave'), trait('cleave', 1.4)] },
  { key: 'rapier', desc: "A needle of a sword: the fastest blade, the highest crit, and it makes those crits count.", name: 'Rapier', kind: 'blade', icon: 1505, dmg: [3, 6], speed: 1.12, crit: 0.06, innates: [trait('precise', 0.6), trait('precise'), trait('precise', 1.5)] },
  { key: 'falchion', desc: "A broad chopping sword that fights better wounded and, in crystal, stuns.", name: 'Falchion', kind: 'blade', icon: 1520, dmg: [4, 8], innates: [null, trait('berserk'), proc('stun', 0.15)] },
  // ---- Fast steel: katanas, dirks, scimitars ---------------------------------
  { key: 'dirk', desc: "A long knife that bleeds and, in crystal, poisons. Fast enough to proc constantly.", name: 'Dirk', kind: 'katana', icon: 1441, dmg: [2, 5], speed: 1.15, innates: [proc('bleed', 0.2), proc('bleed', 0.3), proc('poison', 0.3)] },
  { key: 'kris', desc: "A wavy dagger built for one thing: venom. The fastest weapon in the crypt.", name: 'Kris', kind: 'katana', icon: 1444, dmg: [2, 4], speed: 1.25, innates: [proc('poison', 0.25), proc('poison', 0.35), proc('poison', 0.45, 1.3)] },
  { key: 'katana', desc: "The fast, precise blade; 18% crits by family and a Precision tier to double down.", name: 'Katana', kind: 'katana', icon: 1453, dmg: [3, 6], innates: [null, trait('precise'), proc('bleed', 0.3)] },
  { key: 'scimitar', desc: "A curved slasher that runs quick and, in crystal, burns.", name: 'Scimitar', kind: 'katana', icon: 1509, dmg: [3, 7], innates: [null, trait('swift'), proc('burn', 0.3)] },
  { key: 'twinblade', desc: "Two blades on one hilt: every strike reaches a second foe.", name: 'Twinblade', kind: 'katana', icon: 1519, dmg: [3, 6], speed: 1.05, innates: [trait('cleave', 0.6), trait('cleave'), trait('cleave', 1.3)] },
  // ---- Axes: heavy, bleeding, cleaving ----------------------------------------
  { key: 'hatchet', desc: "A one-handed axe that swings faster than its family: the axe for a light arm.", name: 'Hatchet', kind: 'axe', icon: 1457, dmg: [3, 7], speed: 1.08, innates: [null, trait('swift'), proc('bleed', 0.3)] },
  { key: 'cleaver', desc: "A butcher’s edge: it bleeds, and in every tier it bleeds harder.", name: 'Cleaver', kind: 'axe', icon: 1445, dmg: [4, 8], innates: [proc('bleed', 0.2), proc('bleed', 0.3), proc('bleed', 0.4, 1.3)] },
  { key: 'axe', desc: "The plain axe, angrier when its wielder is wounded.", name: 'Axe', kind: 'axe', icon: 1458, dmg: [4, 9], innates: [null, trait('berserk'), trait('berserk', 1.5)] },
  { key: 'broadaxe', desc: "Wide and heavy; it shoves, and in crystal it stuns.", name: 'Broadaxe', kind: 'axe', icon: 1461, dmg: [5, 10], innates: [null, trait('knockback'), proc('stun', 0.2)] },
  { key: 'battleaxe', desc: "A war axe that cleaves the pack and, in crystal, opens deep wounds.", name: 'Battleaxe', kind: 'axe', icon: 1465, dmg: [6, 11], speed: 0.9, innates: [trait('cleave', 0.6), trait('cleave'), proc('bleed', 0.35, 1.5)] },
  { key: 'greataxe', desc: "The heaviest axe. Slow, devastating, and it cleaves in every tier.", name: 'Greataxe', kind: 'axe', icon: 1466, dmg: [7, 12], speed: 0.8, innates: [trait('cleave', 0.8), trait('cleave', 1.2), trait('cleave', 1.6)] },
  // ---- Maces: the stunners --------------------------------------------------
  { key: 'hammer', desc: "Every mace staggers; the hammer stuns outright, and more with each tier.", name: 'Hammer', kind: 'mace', icon: 1469, dmg: [3, 8], innates: [proc('stun', 0.12), proc('stun', 0.18), proc('stun', 0.25, 1.2)] },
  { key: 'maul', desc: "A sledge that throws foes across the room and, in crystal, leaves them reeling.", name: 'Maul', kind: 'mace', icon: 1471, dmg: [5, 10], speed: 0.85, innates: [trait('knockback', 0.7), trait('knockback', 1.2), proc('stun', 0.3, 1.3)] },
  { key: 'flail', desc: "A chained head that bleeds in gilded and arcs lightning in crystal.", name: 'Flail', kind: 'mace', icon: 1478, dmg: [4, 9], innates: [null, proc('bleed', 0.25), proc('shock', 0.25)] },
  { key: 'morningstar', desc: "Spikes and weight: a stunner that learns to bleed along the way.", name: 'Morningstar', kind: 'mace', icon: 1506, dmg: [4, 10], innates: [proc('stun', 0.1), proc('bleed', 0.25), proc('stun', 0.25)] },
  { key: 'warpick', desc: "A beaked pick with a high crit and a Precision innate at every tier.", name: 'Warpick', kind: 'mace', icon: 1473, dmg: [4, 8], crit: 0.05, innates: [trait('precise', 0.6), trait('precise'), trait('precise', 1.5)] },
  // ---- Polearms: reach -----------------------------------------------------------
  { key: 'spear', desc: "The reach weapon. Fast for a polearm; quick and, in crystal, bleeding.", name: 'Spear', kind: 'polearm', icon: 1452, dmg: [4, 7], innates: [null, trait('swift'), proc('bleed', 0.25)] },
  { key: 'pike', desc: "The longest reach in the crypt: it shoves, and in crystal it stuns, before they close.", name: 'Pike', kind: 'polearm', icon: 1477, dmg: [5, 8], reach: 0.3, innates: [trait('knockback', 0.6), trait('knockback'), proc('stun', 0.2)] },
  { key: 'glaive', desc: "A blade on a pole that sweeps a second foe at every tier.", name: 'Glaive', kind: 'polearm', icon: 1476, dmg: [5, 9], innates: [trait('cleave', 0.6), trait('cleave'), trait('cleave', 1.4)] },
  { key: 'sickle', desc: "Short for a polearm and quick; it bleeds, and in the higher tiers it reaps life from every kill.", name: 'Sickle', kind: 'polearm', icon: 1451, dmg: [3, 7], speed: 1.1, reach: -0.5, innates: [proc('bleed', 0.2), trait('lifeOnKill'), trait('lifeOnKill', 1.5)] },
  // ---- Bows -------------------------------------------------------------------
  { key: 'shortbow', desc: "A quick bow for a running fight; its crystal tier poisons.", name: 'Shortbow', kind: 'bow', icon: 1481, dmg: [3, 6], speed: 1.1, innates: [null, trait('swift'), proc('poison', 0.3)] },
  { key: 'longbow', desc: "Half a tile more reach and a keen eye; its crystal tier burns.", name: 'Longbow', kind: 'bow', icon: 1514, dmg: [4, 7], reach: 0.5, innates: [null, trait('precise'), proc('burn', 0.3)] },
  { key: 'warbow', desc: "A heavy draw that throws foes back and, in crystal, calls lightning.", name: 'Warbow', kind: 'bow', icon: 1515, dmg: [5, 9], speed: 0.9, innates: [trait('knockback', 0.6), trait('knockback'), proc('shock', 0.3)] },
  { key: 'crossbow', desc: "Slow to wind, and the bolt stuns.", name: 'Crossbow', kind: 'bow', icon: 1482, dmg: [5, 8], speed: 0.85, innates: [proc('stun', 0.12), proc('stun', 0.2), proc('stun', 0.28, 1.2)] },
  { key: 'recurve', desc: "The hunter’s bow: high crit and Seeker at every tier — rarer finds.", name: 'Recurve Bow', kind: 'bow', icon: 1516, dmg: [4, 7], crit: 0.04, innates: [trait('seeker', 0.8), trait('seeker'), trait('seeker', 1.5)] },
  // ---- Wands, scepters, rods -------------------------------------------------------
  { key: 'wand', desc: "A quick focus; its gilded tier siphons mana, its crystal tier shocks.", name: 'Wand', kind: 'wand', icon: 1489, dmg: [3, 5], speed: 1.05, innates: [null, trait('manaOnHit'), proc('shock', 0.3)] },
  { key: 'scepter', desc: "The caster’s sustain: every hit returns mana, more with each tier.", name: 'Scepter', kind: 'wand', icon: 1490, dmg: [3, 6], innates: [trait('manaOnHit', 0.6), trait('manaOnHit'), trait('manaOnHit', 1.5)] },
  { key: 'rod', desc: "A fire focus in every tier, hotter as it climbs.", name: 'Rod', kind: 'wand', icon: 1493, dmg: [4, 6], innates: [proc('burn', 0.2), proc('burn', 0.3), proc('burn', 0.4, 1.3)] },
  { key: 'orbrod', desc: "A frost focus: it chills, and in every tier it chills harder.", name: 'Orb Rod', kind: 'wand', icon: 1498, dmg: [4, 7], speed: 0.95, innates: [proc('chill', 0.2), proc('chill', 0.3), proc('chill', 0.4, 1.2)] },
];

/**
 * THE ARSENAL (it.115): every shape wears one of the 80 hand-drawn 64 px
 * Adventurer's Arsenal icons (`arsenal_<id>`, see docs/arsenal-items.csv)
 * per tier - steel, gilded, crystal. The csv suggests no rarity of its own,
 * so the "higher" icon of a family (a ceremonial or rune sword, a double
 * axe, a lance, a heavy crossbow, a crystal wand) goes to the higher tiers
 * where the family has one; a family with one icon keeps it through all
 * three, and the tier colour on the cell frame tells them apart.
 */
const SHAPE_ART: Record<string, [string, string, string]> = {
  shortsword: ['shortsword', 'arming_sword', 'rune_sword'],
  blade: ['arming_sword', 'ceremonial_sword', 'rune_sword'],
  longsword: ['longsword', 'longsword', 'ceremonial_sword'],
  saber: ['saber', 'saber', 'saber'],
  claymore: ['longsword', 'greatsword', 'greatsword'],
  greatsword: ['greatsword', 'greatsword', 'rune_sword'],
  rapier: ['rapier', 'rapier', 'rapier'],
  falchion: ['falchion', 'falchion', 'cleaver_sword'],
  dirk: ['iron_dagger', 'curved_dagger', 'ritual_dagger'],
  kris: ['curved_dagger', 'ritual_dagger', 'ritual_dagger'],
  katana: ['saber', 'saber', 'ceremonial_sword'],
  scimitar: ['scimitar', 'scimitar', 'scimitar'],
  twinblade: ['twinblade', 'twinblade', 'twinblade'],
  hatchet: ['hand_axe', 'hand_axe', 'hand_axe'],
  cleaver: ['cleaver_sword', 'cleaver_sword', 'cleaver_sword'],
  axe: ['hand_axe', 'battleaxe', 'battleaxe'],
  broadaxe: ['battleaxe', 'double_axe', 'double_axe'],
  battleaxe: ['battleaxe', 'battleaxe', 'double_axe'],
  greataxe: ['double_axe', 'double_axe', 'double_axe'],
  hammer: ['warhammer', 'warhammer', 'warhammer'],
  maul: ['maul', 'maul', 'maul'],
  flail: ['morningstar', 'morningstar', 'morningstar'],
  morningstar: ['flanged_mace', 'morningstar', 'morningstar'],
  warpick: ['war_pick', 'war_pick', 'war_pick'],
  spear: ['hunting_spear', 'war_spear', 'war_spear'],
  pike: ['pike', 'pike', 'lance'],
  glaive: ['glaive', 'halberd', 'halberd'],
  sickle: ['scythe', 'scythe', 'scythe'],
  shortbow: ['shortbow', 'shortbow', 'shortbow'],
  longbow: ['longbow', 'longbow', 'longbow'],
  warbow: ['longbow', 'composite_bow', 'composite_bow'],
  crossbow: ['light_crossbow', 'light_crossbow', 'heavy_crossbow'],
  recurve: ['recurved_bow', 'recurved_bow', 'recurved_bow'],
  wand: ['simple_wand', 'crooked_wand', 'crystal_wand'],
  scepter: ['crooked_wand', 'crystal_wand', 'crystal_wand'],
  rod: ['fire_staff', 'fire_staff', 'fire_staff'],
  orbrod: ['frost_staff', 'frost_staff', 'frost_staff'],
};

/**
 * THE TURNTABLES (it.114, re-cast it.115): the 25 baked polyy weapons
 * (`item_weapon_<slug>` single + `spin_weapon_<slug>`, 30 frames) now belong
 * to the NAMED steel - the uniques - by closest shape, so a legendary drop
 * turns in its cell while the common arms hold still. The four unique bows
 * take Arsenal bows (the polyy pack has none).
 */
const UNIQUE_ART: Record<string, string> = {
  sunsplitter: 'knight_s_longsword',
  nightfang: 'rogue_s_dagger',
  emberflail: 'morning_star',
  moonscepter: 'paladin_s_mace',
  tidecutter: 'elven_leaf_blade',
  gravebiter: 'orcish_cleaver',
  hollow_reach: 'halberd',
  kingsedge: 'highland_claymore',
  voidorb_staff: 'wizard_s_staff',
  dawnbreaker: 'dwarven_war_axe',
  whisper: 'katana',
  judgment: 'giant_s_maul',
  serpent_fang: 'jeweled_dagger',
  frost_reaver: 'twin_moon_battle_axe',
  crescent_of_sorrow: 'reaper_s_scythe',
  doomcaller: 'bone_club',
  ironheart_spear: 'tidal_trident',
  cinderbrand: 'falchion',
};
const UNIQUE_ARSENAL: Record<string, string> = {
  stormbow: 'composite_bow',
  ashen_bow: 'longbow',
  duskwind_bow: 'recurved_bow',
  widows_bow: 'heavy_crossbow',
};

/** The art fields for a unique: the polyy turntable, or an Arsenal bow. */
function uniqueArt(id: string): Partial<ItemDef> {
  const polyy = UNIQUE_ART[id];
  if (polyy) return { sprite: `item_weapon_${polyy}`, spin: `spin_weapon_${polyy}` };
  const a = UNIQUE_ARSENAL[id];
  return a ? { sprite: `arsenal_${a}` } : {};
}

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
        sprite: `arsenal_${SHAPE_ART[s.key][t]}`,
        desc: `${s.desc} ${tier.name} tier: iLvl ${tier.band[0]}–${tier.band[1]}.`,
      }),
    );
  }
}
// Staves (1801–1808): the mage's reach in three tiers - the Arsenal staves, and the polyy wizard's staff turning at the top.
WEAPONS.push(
  weapon('ashwood_staff', 'Ashwood Staff', 'wand', 1801, [1, 38], [4, 7], 0xb08a5a, { reachBonus: 0.5, innate: trait('manaOnHit', 0.6), sprite: 'arsenal_quarterstaff' }),
  weapon('gilded_staff', 'Gilded Staff', 'wand', 1802, [25, 70], [5, 8], 0xe8b84c, { reachBonus: 0.5, innate: trait('manaOnHit'), sprite: 'arsenal_battle_staff' }),
  weapon('crystal_staff', 'Crystal Staff', 'wand', 1803, [55, 100], [6, 9], 0x7fc8ff, { reachBonus: 0.5, innate: proc('chill', 0.35, 1.2), sprite: 'item_weapon_wizard_s_staff', spin: 'spin_weapon_wizard_s_staff' }),
);

/**
 * THE REST OF THE ARSENAL (it.115): the icons no shape wore - a club, the
 * throwing arms, a bone staff, a trident, the hand crossbow and the sling -
 * as plain bases of their own family, each on its Arsenal turntable.
 */
WEAPONS.push(
  weapon('knotted_club', 'Knotted Club', 'mace', 1470, [1, 30], [4, 8], 0x8a6f4d, { sprite: 'arsenal_club' }),
  weapon('throwing_knife', 'Throwing Knife', 'blade', 1442, [1, 40], [3, 6], 0xb8c0cc, { sprite: 'arsenal_throwing_knife', speedMult: 1.1 }),
  weapon('throwing_axe', 'Throwing Axe', 'axe', 1462, [5, 45], [5, 9], 0x9a8874, { sprite: 'arsenal_throwing_axe' }),
  weapon('war_chakram', 'War Chakram', 'blade', 1450, [20, 70], [5, 9], 0xd8cfa0, { sprite: 'arsenal_chakram', critBonus: 0.04 }),
  weapon('iron_javelin', 'Iron Javelin', 'polearm', 1479, [10, 55], [6, 10], 0xa8b0c0, { sprite: 'arsenal_javelin' }),
  weapon('sea_trident', 'Sea Trident', 'polearm', 1480, [35, 90], [8, 13], 0x5fc8d8, { sprite: 'arsenal_trident', reachBonus: 0.3 }),
  weapon('hand_crossbow', 'Hand Crossbow', 'bow', 1483, [15, 60], [5, 9], 0x6f5a48, { sprite: 'arsenal_hand_crossbow', range: 5.5 }),
  weapon('shepherds_sling', "Shepherd's Sling", 'bow', 1484, [1, 35], [3, 7], 0x8a6a48, { sprite: 'arsenal_sling', range: 5.5 }),
  weapon('bone_staff', 'Bone Staff', 'wand', 1801, [30, 85], [5, 9], 0xe8dcc0, { sprite: 'arsenal_bone_staff', reachBonus: 0.5 }),
  weapon('iron_mace', 'Iron Mace', 'mace', 1472, [5, 50], [5, 10], 0x8a8a94, { sprite: 'arsenal_mace' }),
  // Three more polyy turntables on plain steel of their own.
  weapon('boar_spear', 'Boar Spear', 'polearm', 1479, [15, 70], [7, 12], 0x9a8874, { sprite: 'item_weapon_hunting_spear', spin: 'spin_weapon_hunting_spear' }),
  weapon('miners_pick', "Miner's War Pick", 'axe', 1467, [20, 75], [7, 13], 0x8a8a94, { sprite: 'item_weapon_war_pick', spin: 'spin_weapon_war_pick' }),
);

/** UNIQUES (1681–1800): legendary and mythic rolls only. Named steel with two innates, on the polyy turntables (it.115). */
const unique = (id: string, name: string, kind: WeaponKind, icon: number, dmg: [number, number], color: number, innate: Effect, second: Effect, extra: Partial<ItemDef> = {}): ItemDef =>
  weapon(id, name, kind, icon, [1, 100], dmg, color, { uniqueOnly: true, innate, innate2: second, ...uniqueArt(id), ...extra });

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
  // Off hand: the Arsenal's shields and focus orbs (it.115); armour and jewellery keep the Raven icons (no art in the drop).
  armor('round_shield', 'Round Shield', 'offHand', 2113, [1, 35], 2, 0x8a6f4d, { sprite: 'arsenal_wooden_round_shield' }),
  armor('red_buckler', 'Red Buckler', 'offHand', 2117, [5, 40], 2.2, 0xc83030, { sprite: 'arsenal_iron_buckler' }),
  armor('amber_orb', 'Amber Orb', 'offHand', 1809, [1, 45], 1.2, 0xe0803a, { bonus: { dmg: 0.05 }, sprite: 'arsenal_offhand_focus_orb' }),
  armor('sapphire_orb', 'Sapphire Orb', 'offHand', 1810, [20, 70], 1.4, 0x5f7fdf, { bonus: { dmg: 0.06, regen: 0.1 }, sprite: 'arsenal_arcane_focus_orb' }),
  armor('kite_shield', 'Kite Shield', 'offHand', 2121, [15, 55], 2.6, 0x6f8fd0, { sprite: 'arsenal_kite_shield' }),
  armor('steel_targe', 'Steel Targe', 'offHand', 2131, [25, 65], 2.8, 0xb8c0cc, { sprite: 'arsenal_targe' }),
  armor('gilded_shield', 'Gilded Shield', 'offHand', 2137, [40, 80], 3.2, 0xe8b84c, { sprite: 'arsenal_ornate_shield' }),
  armor('crystal_ward', 'Crystal Ward', 'offHand', 2145, [55, 100], 3.6, 0x7fc8ff, { sprite: 'arsenal_ward_shield' }),
  armor('crystal_aegis', 'Crystal Aegis', 'offHand', 2149, [65, 100], 3.8, 0x9fd8ff, { bonus: { hp: 15 }, sprite: 'arsenal_rune_shield' }),
  armor('frost_shard', 'Frost Shard', 'offHand', 2153, [50, 100], 1.8, 0x9fd8ff, { bonus: { dmg: 0.08 }, sprite: 'arsenal_warding_talisman' }),
  // THE REST OF THE ARSENAL'S OFF HANDS (it.115): every shield, the quivers, the books and the lantern.
  armor('cracked_shield', 'Cracked Shield', 'offHand', 2113, [1, 25], 1.6, 0x7a6650, { sprite: 'arsenal_cracked_shield' }),
  armor('reinforced_round_shield', 'Reinforced Round Shield', 'offHand', 2115, [10, 50], 2.4, 0x8a6f4d, { sprite: 'arsenal_reinforced_round_shield' }),
  armor('bronze_shield', 'Bronze Shield', 'offHand', 2117, [15, 55], 2.5, 0xc8783c, { sprite: 'arsenal_bronze_shield' }),
  armor('heater_shield', 'Heater Shield', 'offHand', 2121, [25, 65], 2.8, 0xb8c0cc, { sprite: 'arsenal_heater_shield' }),
  armor('leaf_shield', 'Leafwarden Shield', 'offHand', 2123, [20, 60], 2.4, 0x6f9a5a, { bonus: { regen: 0.05 }, sprite: 'arsenal_leaf_shield' }),
  armor('spiked_shield', 'Spiked Shield', 'offHand', 2131, [35, 80], 2.9, 0x8a8a94, { bonus: { dmg: 0.03 }, sprite: 'arsenal_spiked_shield' }),
  armor('siege_pavise', 'Siege Pavise', 'offHand', 2137, [50, 100], 4, 0x8a6a48, { sprite: 'arsenal_pavise' }),
  armor('arrow_quiver', 'Arrow Quiver', 'offHand', 1809, [1, 60], 0.6, 0x8a6a48, { bonus: { dmg: 0.04 }, sprite: 'arsenal_arrow_quiver' }),
  armor('bolt_case', 'Bolt Case', 'offHand', 1809, [30, 100], 0.8, 0x6f5a48, { bonus: { dmg: 0.06 }, sprite: 'arsenal_bolt_case' }),
  armor('knife_bandolier', 'Knife Bandolier', 'offHand', 1809, [10, 70], 0.8, 0x7a6650, { bonus: { dodge: 0.03 }, sprite: 'arsenal_knife_bandolier' }),
  armor('parrying_dagger', 'Parrying Dagger', 'offHand', 2113, [15, 80], 1.4, 0xb8c0cc, { bonus: { dodge: 0.04 }, sprite: 'arsenal_parrying_dagger' }),
  armor('apprentice_spellbook', 'Apprentice Spellbook', 'offHand', 1810, [1, 50], 0.8, 0x6a5a9a, { bonus: { regen: 0.1 }, sprite: 'arsenal_spellbook' }),
  armor('grand_spell_tome', 'Grand Spell Tome', 'offHand', 1810, [40, 100], 1, 0x9a5ad8, { bonus: { dmg: 0.07, regen: 0.1 }, sprite: 'arsenal_spell_tome' }),
  armor('delvers_lantern', "Delver's Lantern", 'offHand', 1809, [1, 100], 0.6, 0xffcf60, { bonus: { hp: 8, regen: 0.05 }, sprite: 'arsenal_lantern' }),
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
/** THE MATERIALS (it.115): the painted ores from the drop (`item_ore_<id>`, turning like the rest). */
export const MATERIALS: ItemDef[] = [
  { id: 'iron_scrap', desc: "The forge’s bread: from every salvage and every scrap-pack on the armorer’s counter. Five transmute to one Arcane Dust.", name: 'Iron Scraps', slot: 'material', rarity: 'common', icon: 'raven209', sprite: 'item_ore_iron_scrap', value: 6, color: 0x9a9a9a },
  { id: 'arcane_dust', desc: "Ground from uncommon and better gear. Reinforcement from +4 and every enchantment ask for it. Five make an Essence.", name: 'Arcane Dust', slot: 'material', rarity: 'uncommon', icon: 'raven187', sprite: 'item_ore_arcane_dust', value: 25, color: 0x5f7fdf },
  { id: 'essence', desc: "The heart of rare gear. Refining, enchanting and reinforcement past +8 spend it. Four make an Alloy Shard.", name: 'Essence', slot: 'material', rarity: 'rare', icon: 'raven170', sprite: 'item_ore_essence', value: 110, color: 0x5fd8c8 },
  { id: 'alloy_shard', desc: "Epic and better salvage. Three make a Catalyst.", name: 'Alloy Shards', slot: 'material', rarity: 'epic', icon: 'raven213', sprite: 'item_ore_alloy_shard', value: 420, color: 0xc8a0ff },
  { id: 'catalyst', desc: "One per attempt from +13 to +15, and one to forge a unique. The rarest thing in the pouch.", name: 'Catalyst', slot: 'material', rarity: 'legendary', icon: 'raven172', sprite: 'item_ore_catalyst', value: 1500, color: 0xffb347 },
];

export const MATERIAL_ORDER: readonly string[] = ['iron_scrap', 'arcane_dust', 'essence', 'alloy_shard', 'catalyst'];

/**
 * DRAUGHTS (it.80): more than health and mana. Every draught goes on the
 * belt; healing draughts share a five-second cooldown, the rest a short one.
 */
export const DRAUGHTS: ItemDef[] = [
  { id: 'rejuvenation', desc: "Life and resource together, a third each. Counts as a healing draught for the cooldown.", name: 'Draught of Rejuvenation', slot: 'consumable', rarity: 'uncommon', icon: 'raven122', sprite: 'item_potion_rejuvenation', spin: 'spin_potion_rejuvenation', value: 95, use: { heal: 0.35, resource: 0.35 }, color: 0x9a5ad8 },
  { id: 'potion_haste', desc: "Thirty percent faster on your feet for eight seconds. Kiting, fleeing, and reaching the stairs first.", name: 'Draught of Haste', slot: 'consumable', rarity: 'uncommon', icon: 'raven121', sprite: 'item_potion_haste', spin: 'spin_potion_haste', value: 120, use: { haste: 480 }, color: 0x7fd67f },
  { id: 'potion_stone', desc: "Forty percent of every blow turned for eight seconds; stacks under the 75% cap with Warding lines.", name: 'Draught of Stone', slot: 'consumable', rarity: 'uncommon', icon: 'raven123', sprite: 'item_potion_stone', spin: 'spin_potion_stone', value: 120, use: { stone: 480 }, color: 0x5f7fdf },
  { id: 'potion_might', desc: "A quarter more damage from everything for ten seconds. Drink it before the warden, not after.", name: 'Draught of Might', slot: 'consumable', rarity: 'rare', icon: 'raven269', sprite: 'item_potion_might', spin: 'spin_potion_might', value: 150, use: { might: 600 }, color: 0xe0803a },
  { id: 'greater_health', desc: "Eight tenths of your life back. The same five-second cooldown as any healing draught.", name: 'Greater Healing Draught', slot: 'consumable', rarity: 'uncommon', icon: 'raven270', sprite: 'item_potion_greater_health', spin: 'spin_potion_greater_health', value: 80, use: { heal: 0.8 }, color: 0xc83030 },
  // THE FIVE FLASKS (it.115): the rest of the bake's picked bottles.
  { id: 'hunters_antidote', desc: "A quarter of your life back and four seconds of haste: the hunter's way out of a bad bite. Counts as a healing draught.", name: "Hunter's Antidote", slot: 'consumable', rarity: 'uncommon', sprite: 'item_potion_antidote', spin: 'spin_potion_antidote', value: 70, use: { heal: 0.25, haste: 240 }, color: 0x6fbf5a },
  { id: 'potion_frostward', desc: "Ice under the skin: forty percent of every blow turned for ten seconds.", name: 'Frostward Draught', slot: 'consumable', rarity: 'rare', sprite: 'item_potion_frost', spin: 'spin_potion_frost', value: 140, use: { stone: 600 }, color: 0x9fd8ff },
  { id: 'potion_void', desc: "The dark in a bottle. A quarter more damage for eight seconds and a little of your pool back.", name: 'Void Draught', slot: 'consumable', rarity: 'rare', sprite: 'item_potion_void', spin: 'spin_potion_void', value: 150, use: { might: 480, resource: 0.2 }, color: 0x7a4ab8 },
  { id: 'potion_focus', desc: "Eight tenths of your mana or stamina, on the two-second resource cooldown.", name: 'Draught of Focus', slot: 'consumable', rarity: 'uncommon', sprite: 'item_potion_focus', spin: 'spin_potion_focus', value: 70, use: { resource: 0.8 }, color: 0xd8e0e8 },
  { id: 'acid_flask', desc: "Bitter and green. Might and haste together for six seconds - and a long regret.", name: 'Acid Flask', slot: 'consumable', rarity: 'rare', sprite: 'item_potion_poison', spin: 'spin_potion_poison', value: 160, use: { might: 360, haste: 360 }, color: 0x7fd65a },
  { id: 'greater_mana', desc: "Your whole pool refilled. The same two-second cooldown as any resource draught.", name: 'Greater Mana Draught', slot: 'consumable', rarity: 'uncommon', icon: 'raven68', sprite: 'item_potion_greater_mana', spin: 'spin_potion_greater_mana', value: 80, use: { resource: 1 }, color: 0x4a6ad8 },
];

/**
 * RECIPE SCROLLS (it.80): read one to learn an enchantment for the forge.
 * THE ART BY FAMILY (it.115): the elemental procs on the plain scroll
 * (`scroll_a`), the wounding procs on the violet one (`scroll_c`), the
 * sustain traits in the brown tome (`tome_a`), the martial traits in the
 * blue tome (`tome_b`), the gilded hand in the old grey one (`tome_c`).
 */
const RECIPE_ART: Record<string, string> = {
  flame: 'scroll_a', frost: 'scroll_a', storm: 'scroll_a',
  venom: 'scroll_c', sanguine: 'scroll_c', crushing: 'scroll_c',
  reaping: 'tome_a', siphon: 'tome_a',
  cleaving: 'tome_b', swiftness: 'tome_b', keen: 'tome_b',
  fortune: 'tome_c',
};
export const RECIPES: ItemDef[] = Object.values(ENCHANTS).map((r, i) => {
  const art = RECIPE_ART[r.key] ?? `scroll_${'abc'[i % 3]}`;
  return {
    id: `recipe_${r.key}`,
    name: `Recipe: ${r.name}`,
    slot: 'consumable',
    rarity: 'rare',
    icon: `raven${r.icon}`,
    sprite: `item_${art}`,
    spin: `spin_${art}`,
    value: 220,
    use: { recipe: r.key },
    color: 0xd8c890,
    desc: `${r.desc} Read it to learn the recipe forever; then lay it on a weapon at the camp forge.`,
  };
});

/**
 * THE ALES (it.115): ten of the 105 baked polyy drinks (`item_drink_<key>`
 * + `spin_drink_<key>`), poured by Coleslaw at the Gilded Stag and nowhere else (it.116). A
 * short brew - MIGHT or HASTE for six seconds - on the brews' one-second
 * cooldown, cheap, and they turn in the cell like every other bottle.
 */
const ale = (key: string, name: string, brew: 'might' | 'haste', desc: string): ItemDef => ({
  id: `ale_${key}`,
  name,
  slot: 'consumable',
  rarity: 'common',
  sprite: `item_drink_${key}`,
  spin: `spin_drink_${key}`,
  value: 18,
  use: brew === 'might' ? { might: 6 * 60 } : { haste: 6 * 60 },
  color: brew === 'might' ? 0xe0803a : 0x7fd67f,
  desc,
});
export const ALES: ItemDef[] = [
  ale('016_griffin', 'Griffin Ale', 'might', 'A brown ale under a griffin seal. A quarter more damage for six seconds, then the taste of it for an hour.'),
  ale('017_dragon', "Dragon's Breath Stout", 'might', 'Black, thick, and it bites back. Might for six seconds.'),
  ale('019_wolfsun', 'Wolfsun Mead', 'haste', 'Honey mead of the hill folk. Thirty percent faster on your feet for six seconds.'),
  ale('021_starforge', 'Starforge Porter', 'might', 'The smiths drink it at the end of the shift. Might for six seconds.'),
  ale('047_ambercrown', 'Ambercrown Cider', 'haste', 'Orchard cider, sharp and cold. Haste for six seconds.'),
  ale('048_knightshield', 'Knightshield Lager', 'might', 'The garrison’s ration ale. Might for six seconds.'),
  ale('050_bloodorange', 'Bloodorange Punch', 'haste', 'A red punch from the market ward. Haste for six seconds.'),
  ale('055_emeraldforest', 'Greenwood Herb Ale', 'haste', 'Bitter herbs in a pale ale, the forester’s brew. Haste for six seconds.'),
  ale('061_bronzerune', 'Bronzerune Dwarven Ale', 'might', 'Stamped with a dwarven rune. Might for six seconds.'),
  ale('063_druidwoodland', 'Druid’s Woodland Brew', 'haste', 'Something green in a stone bottle. Haste for six seconds.'),
];

/**
 * FOOD (it.114, hunger dropped it.115). All fifty dishes of the bake
 * (`item_food_<slug>` singles, `spin_food_<slug>` turntables); the tavern's
 * medieval fare first, the market ward's stranger plates after (it.115). Eaten from the pack or the belt; the heal is served over three
 * seconds and the tier pours a brew (the table is `FOOD_TIER` in the
 * catalog, re-exported here for the codex):
 *   snack  8% life                          12 gold
 *   meal  15% life · MIGHT 20 s             28 gold
 *   feast 30% life · STONE 30 s · HASTE 20 s 70 gold
 * Foods stack in the pack like draughts (one entry each, one cell together).
 */
export { FOOD_TIER };

const food = (slug: string, name: string, tier: FoodTier, desc: string): ItemDef => {
  const t = FOOD_TIER[tier];
  return {
    id: `food_${slug}`,
    name,
    slot: 'food',
    rarity: t.rarity,
    sprite: `item_food_${slug}`,
    spin: `spin_food_${slug}`,
    value: t.value,
    use: { food: { heal: t.heal, tier } },
    color: t.color,
    desc,
  };
};

export const FOODS: ItemDef[] = [
  // Snacks: a bite on the stair.
  food('crusty_bread_loaf', 'Crusty Loaf', 'snack', 'Yesterday’s bread, still good. The delver’s staple.'),
  food('salted_pretzel', 'Salted Pretzel', 'snack', 'Twisted dough, coarse salt. Sold by the dozen outside the tavern.'),
  food('grilled_sausage_pair', 'Grilled Sausages', 'snack', 'Two links off the brazier, skins split and hissing.'),
  food('meat_skewer', 'Meat Skewer', 'snack', 'Mutton and onion on a stick, charred at the edges.'),
  food('berry_tart', 'Berry Tart', 'snack', 'Hedge berries in a butter crust. Sweet enough to forget the dark for a bite.'),
  food('blueberry_muffin', 'Bilberry Muffin', 'snack', 'A cake from the goodwife’s oven, studded with bilberries.'),
  food('steamer_dumplings', 'Steamed Dumplings', 'snack', 'Pork and leek in thin dough, from the porter’s stall by the gate.'),
  food('apple_pie_slice', 'Apple Pie Slice', 'snack', 'Orchard apples and cinnamon. The crust holds the warmth an hour.'),
  // Meals: a plate at the table.
  food('hearty_stew_bowl', 'Hearty Stew', 'meal', 'Root vegetables and mutton in a bowl you can stand a spoon in.'),
  food('golden_meat_pie', 'Meat Pie', 'meal', 'A raised pie with a golden lid and a filling that is mostly meat.'),
  food('roast_turkey_leg', 'Roast Turkey Leg', 'meal', 'The bird’s leg, skin crisp, eaten off the bone on the march.'),
  food('grilled_fish_plate', 'Grilled Fish', 'meal', 'A river fish grilled whole, lemon and salt. The riverside’s supper.'),
  food('fried_eggs_and_toast', 'Eggs and Toast', 'meal', 'Two eggs fried in butter on thick toast. Breakfast at any hour.'),
  food('baked_mussels_plate', 'Baked Mussels', 'meal', 'Mussels baked with garlic and crumb. From the drowned levels, they say.'),
  food('clam_chowder_bread_bowl', 'Clam Chowder', 'meal', 'Cream and clams in a hollowed loaf. Eat the bowl.'),
  food('pumpkin_soup_bowl', 'Pumpkin Soup', 'meal', 'Autumn in a bowl, thick and orange, with a curl of cream.'),
  food('stuffed_cabbage_rolls', 'Cabbage Rolls', 'meal', 'Cabbage leaves wrapped round spiced meat and barley, stewed soft.'),
  food('shepherds_pie', 'Shepherd’s Pie', 'meal', 'Minced lamb under a roof of potato, browned at the ridges.'),
  food('loaded_baked_potato', 'Baked Potato', 'meal', 'A potato from the coals split and loaded with butter and cheese.'),
  // Feasts: a board for the table.
  food('whole_roast_chicken', 'Whole Roast Chicken', 'feast', 'A whole bird, roasted golden. Enough to bring a hero back from the edge.'),
  food('glazed_holiday_ham', 'Glazed Ham', 'feast', 'A ham glazed in honey and cloves, carved thick. A feast day’s centrepiece.'),
  food('grilled_steak_board', 'Steak Board', 'feast', 'A slab of beef seared on the iron, rested and sliced on the board.'),
  food('roasted_quail_board', 'Roasted Quail', 'feast', 'A brace of quail roasted with herbs, the lord’s table brought underground.'),
  food('pot_roast_board', 'Pot Roast', 'feast', 'Beef braised all day with carrots and onion, falling apart under the knife.'),
  // THE BANQUET (it.116): the one dish above every other.
  food('cakepancakes', 'Cakepancakes', 'banquet', 'A tower of pancakes baked into a cake, honey and butter through every layer. Everything back at once, and a minute of being more than you are.'),
  // THE REST OF THE LARDER (it.115): every dish of the bake is on the table now - the market ward's
  // stalls, the sweetshop and the harbour cooks' fare beside the tavern's.
  food('caramel_flan', 'Caramel Custard', 'snack', 'A trembling custard under burnt sugar, from the sweetshop by the fountain.'),
  food('chocolate_eclair', 'Cream Eclair', 'snack', 'Choux pastry split and filled with cream, glazed dark on top.'),
  food('chocolate_lava_cake', 'Molten Cocoa Cake', 'snack', 'A small dark cake that pours its heart out when cut.'),
  food('cinnamon_roll_stack', 'Cinnamon Rolls', 'snack', 'Three spiral buns in a sticky stack, still warm.'),
  food('frosted_cupcake', 'Frosted Fairy Cake', 'snack', 'A little cake under a swirl of sugar frosting.'),
  food('layer_cake_slice', 'Layer Cake Slice', 'snack', 'A tall wedge of sponge and cream from a feast-day cake.'),
  food('pepperoni_pizza_slice', 'Sausage Flatbread Slice', 'snack', 'Hot flatbread with cheese and spiced sausage, folded to eat walking.'),
  food('steamed_bao_buns', 'Steamed Buns', 'snack', 'Soft white buns around a spoon of braised pork, from the eastern stall.'),
  food('croissant_sandwich', 'Crescent Roll Sandwich', 'meal', 'A buttered crescent roll split round ham and cheese.'),
  food('falafel_pita_pocket', 'Chickpea Flatbread', 'meal', 'Fried chickpea balls and greens in a pocket of flatbread.'),
  food('fish_taco_board', 'Fish Flatbreads', 'meal', 'Fried river fish on small flatbreads with a sharp slaw.'),
  food('fish_and_chips_plate', 'Fish and Fried Roots', 'meal', 'Battered fish and fat fried roots, salt and vinegar on the side.'),
  food('fried_chicken_plate', 'Fried Fowl', 'meal', 'Crisp-coated fowl fried in lard, a heap of it on the plate.'),
  food('loaded_burrito', 'Wrapped Flatbread', 'meal', 'Beans, rice and spiced meat rolled tight in a flatbread for the road.'),
  food('loaded_nachos', 'Cheese-Laden Crisps', 'meal', 'Fried corn crisps buried in melted cheese and peppers.'),
  food('lobster_roll', 'Lobster Roll', 'meal', 'Harbour lobster in butter, piled into a soft roll.'),
  food('meatball_sub', 'Meatball Loaf', 'meal', 'A long loaf of meatballs in tomato and cheese. Hold it with both hands.'),
  food('noodle_soup_bowl', 'Noodle Broth', 'meal', 'Long noodles in a clear broth with an egg and greens.'),
  food('red_curry_rice_bowl', 'Spiced Rice Bowl', 'meal', 'Rice under a red, fiery stew from the spice merchants.'),
  food('shrimp_po_boy', 'Shrimp Loaf', 'meal', 'Fried shrimp and greens in a crusty loaf, the dockhands’ lunch.'),
  food('stacked_cheeseburger', 'Tavern Burger', 'meal', 'Two patties, cheese and onion on a bun: the cook’s own invention.'),
  food('stuffed_bell_pepper', 'Stuffed Pepper', 'meal', 'A sweet pepper baked round rice and minced meat.'),
  food('sushi_roll_plate', 'Eastern Rice Rolls', 'meal', 'Rolls of rice and raw fish, as the eastern traders eat them.'),
  food('waffle_stack', 'Waffle Stack', 'meal', 'Iron-baked waffles, berries and cream between them.'),
  food('seafood_paella_bowl', 'Seafood Rice Pan', 'feast', 'A wide pan of saffron rice, mussels and prawns for the whole table.'),
];

/** The dishes of one tier (for the drop roll and the merchants). */
export function foodsOfTier(tier: FoodTier): ItemDef[] {
  return FOODS.filter((d) => d.use?.food?.tier === tier);
}

export const RAVEN_ITEMS: ItemDef[] = [...WEAPONS, ...UNIQUES, ...ARMOR, ...JEWELRY, ...MATERIALS, ...DRAUGHTS, ...ALES, ...RECIPES, ...FOODS, ...CURIOS];

export { CURIO_DRINKS, CURIO_ORES, CURIO_POTIONS, CURIO_SCROLLS } from './curios';

/** Every base that can be rolled or forged (no materials, draughts, recipes or food). */
export function gearBases(): ItemDef[] {
  return RAVEN_ITEMS.filter((d) => d.slot !== 'material' && d.slot !== 'consumable' && d.slot !== 'food');
}
