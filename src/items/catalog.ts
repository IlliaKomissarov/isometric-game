/**
 * @module items/catalog
 * Static item definitions: the classic catalog (the crypt's own relics and
 * draughts) plus the shape of every item the game can hold.
 *
 * Items are pure data — visuals derive from `slot` (paperdoll overlay
 * texture) + `color` (tint), or from a painted icon (`art` / `icon`). Since
 * it.78 an `ItemDef` is either a BASE (a catalog or registry entry, iLvl-1
 * common values) or a DERIVED INSTANCE built by `items/instance.ts` from an
 * encoded id: item level, rarity, reinforcement and affixes scale and
 * decorate the base. Every stat number the game reads comes from the
 * derived def; never from a base by id.
 *
 * The rolling functions moved to `items/instance.ts` (they need the item
 * level); the drop table is the registry filtered by level band.
 */

import type { EquipmentSlot } from '@/network/Serialization';
import type { AffixRoll } from './affixes';
import type { Effect } from './effects';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

/** Stat multiplier per rarity (it.78). */
export const RARITY_MULT: Record<Rarity, number> = { common: 1, uncommon: 1.25, rare: 1.6, epic: 2.1, legendary: 2.8, mythic: 3.8 };
/** Affix count per rarity (legendary adds a unique effect, mythic a passive skill). */
export const RARITY_AFFIX_COUNT: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
/** Drop weights (percent). */
export const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 0.9, mythic: 0.1 };

/** Where an item lives: a paperdoll slot, the consumable pouch, the crafting pouch (it.78), or the larder (FOOD, it.114). */
export type ItemSlot = EquipmentSlot | 'consumable' | 'material' | 'food';

/** FOOD (it.114): a snack is a bite, a meal a plate, a feast a board. */
export type FoodTier = 'snack' | 'meal' | 'feast' | 'banquet';

/**
 * WHAT A DISH DOES (it.115: hunger is gone; food heals and buffs). The
 * healing is served over three seconds (systems/Inventory); the buffs are
 * the same brews the draughts pour, in ticks at 60 Hz:
 *   snack  8% life over 3 s
 *   meal  15% life over 3 s · MIGHT 20 s
 *   feast 30% life over 3 s · STONE SKIN 30 s · HASTE 20 s
 * One table, read by the registry (prices, rarity), the sim (the bite) and
 * the codex (the words).
 */
export interface FoodEffect {
  heal: number;
  might?: number;
  stone?: number;
  haste?: number;
  /** A share of the resource poured back at once (the banquet, it.116). */
  restore?: number;
  /** Stronger brews than a draught's (the banquet): damage, damage turned, speed. */
  mightMult?: number;
  stoneFrac?: number;
  hasteMult?: number;
  value: number;
  rarity: Rarity;
  color: number;
}
/**
 * THE BANQUET (it.116): one dish, CAKEPANCAKES - the whole life back, the
 * whole resource back, and all three brews at once and stronger than any
 * draught pours them (half again the damage, half of every blow turned,
 * forty percent faster) for a minute.
 */
export const FOOD_TIER: Record<FoodTier, FoodEffect> = {
  snack: { heal: 0.08, value: 12, rarity: 'common', color: 0xd8a85c },
  meal: { heal: 0.15, might: 20 * 60, value: 28, rarity: 'uncommon', color: 0xe0803a },
  feast: { heal: 0.3, stone: 30 * 60, haste: 20 * 60, value: 70, rarity: 'rare', color: 0xffb347 },
  banquet: { heal: 1, restore: 1, might: 60 * 60, stone: 60 * 60, haste: 60 * 60, mightMult: 1.5, stoneFrac: 0.5, hasteMult: 1.4, value: 450, rarity: 'legendary', color: 0xffd36a },
};

/**
 * EVERY PIECE OF NEW ART TURNS (it.115). The polyy singles come with their
 * own `spin_*` in the data; the flat art gets a generated turntable from the
 * bake (`scripts/bake-items.py`): `arsenal_<id>` -> `spin_arsenal_<id>`,
 * `item_ore_<key>` -> `spin_ore_<key>`. Run once over the joined tables
 * (items/instance) so every cell, ground glyph and card finds one.
 */
export function turntableFor(sprite: string | undefined): string | undefined {
  if (!sprite) return undefined;
  if (sprite.startsWith('arsenal_')) return `spin_${sprite}`;
  if (sprite.startsWith('item_ore_')) return `spin_ore_${sprite.slice('item_ore_'.length)}`;
  return undefined;
}

/** The pouch's names, for an ore's line (the registry's MATERIALS carry the same). */
const SMELT_NAME: Record<string, string> = { iron_scrap: 'Iron Scraps', arcane_dust: 'Arcane Dust', essence: 'Essence', alloy_shard: 'Alloy Shards', catalyst: 'Catalyst' };

/**
 * WHAT IT IS, IN ONE WORD (it.115): the loot prompt ("E · LOOT Iron Sword
 * (sword)") and the pickup notice name an item's kind from its def - the
 * weapon family refined by the name, the slot, or what using it does.
 */
export function kindWord(def: ItemDef): string {
  const n = def.name.toLowerCase();
  const has = (...w: string[]): boolean => w.some((x) => n.includes(x));
  switch (def.slot) {
    case 'mainHand':
      switch (def.weaponKind ?? 'blade') {
        case 'bow':
          return has('crossbow') ? 'crossbow' : has('sling') ? 'sling' : 'bow';
        case 'wand':
          return has('staff', 'rod') ? 'staff' : has('scepter', 'sceptre') ? 'sceptre' : 'wand';
        case 'axe':
          return 'axe';
        case 'mace':
          return has('hammer', 'maul') ? 'hammer' : has('flail') ? 'flail' : has('club') ? 'club' : 'mace';
        case 'polearm':
          return has('spear', 'pike', 'lance', 'javelin', 'trident') ? 'spear' : has('scythe', 'sickle', 'reaper') ? 'scythe' : has('halberd') ? 'halberd' : 'polearm';
        case 'katana':
          return has('katana') ? 'katana' : 'sword';
        default:
          return has('dagger', 'dirk', 'kris', 'knife', 'fang') ? 'dagger' : has('chakram') ? 'chakram' : 'sword';
      }
    case 'offHand':
      return has('orb') ? 'orb' : has('talisman', 'shard') ? 'talisman' : has('quiver', 'case', 'bandolier') ? 'quiver' : has('tome', 'book') ? 'tome' : has('lantern') ? 'lantern' : has('dagger') ? 'dagger' : 'shield';
    case 'head':
      return has('crown', 'circlet') ? 'crown' : 'helm';
    case 'torso':
      return has('robe') ? 'robe' : 'armour';
    case 'legs':
      return has('greaves') ? 'greaves' : 'boots';
    case 'cloak':
      return 'cloak';
    case 'ring':
      return has('amulet', 'pendant', 'necklace', 'talisman') ? 'amulet' : 'ring';
    case 'food':
      return 'food';
    case 'material':
      return 'material';
    default:
      break;
  }
  const u = def.use;
  if (u?.key) return 'key';
  if (u?.smelt) return 'ore';
  if (u?.recipe) return 'recipe';
  if (def.sprite?.startsWith('item_tome') || has(' tome')) return 'tome';
  if (u?.portal || def.sprite?.startsWith('item_scroll')) return 'scroll';
  if (def.sprite?.startsWith('item_drink')) return 'drink';
  return 'potion';
}

/** Main-hand weapon families — drive attack style, timing, and visuals. */
export type WeaponKind = 'blade' | 'katana' | 'axe' | 'mace' | 'polearm' | 'bow' | 'wand';

/** Legendary unique effects (it.78), chosen per base. */
export type UniqueEffect = 'lifesteal' | 'cull' | 'thorns' | 'echo';

export interface ItemDef {
  id: string;
  name: string;
  slot: ItemSlot;
  rarity: Rarity;
  /** Merchant price in gold (derived from level/rarity when omitted). */
  value?: number;
  /** Consumables (it.39; draughts it.80): what using it does. Fractions of max; buffs in ticks; a recipe key. */
  use?: {
    heal?: number;
    resource?: number;
    portal?: boolean;
    haste?: number;
    stone?: number;
    might?: number;
    recipe?: string;
    /** THE QUARRY KEYS (it.85): opens the iron gate with this number. */
    key?: number;
    /**
     * FOOD (it.114, hunger dropped it.115): eaten, not quaffed. `heal` is a
     * fraction of max life served over three seconds (see systems/Inventory);
     * the tier's buffs come from `FOOD_TIER`.
     */
    food?: { heal: number; tier: FoodTier };
    /**
     * AN ORE (it.115): smelted from the pack into the crafting pouch -
     * `count` of the `material` (a MATERIAL_ORDER id). No cooldown, no belt.
     */
    smelt?: { material: string; count: number };
  };
  /** Weapon damage roll range (classic-ARPG-style min–max, replaces bare fists). */
  minDamage?: number;
  maxDamage?: number;
  /** Main-hand only: weapon family. Undefined = 'blade'. */
  weaponKind?: WeaponKind;
  /** Ranged weapons: maximum firing range in tiles (requires line of sight). */
  range?: number;
  /** Flat damage reduction when worn (armor pieces). */
  armor?: number;
  /** Visual tint applied to the paperdoll overlay and ground glyph. */
  color: number;
  /** Weapon-icon stem (`wicon_<stem>` single): the oubliette pack or `raven<n>` (it.78). */
  icon?: string;
  /** Painted 64 px icon under assets/ui/items (it.40) — wins over `icon` in panels. */
  art?: string;
  /**
   * THE BAKED ITEM ART (it.114, every item it.115): an atlas SINGLE
   * (`item_food_<slug>`, `item_potion_<key>`, `item_weapon_<slug>`,
   * `item_drink_<key>`, `arsenal_<id>`; 64 px) drawn in every cell, on the
   * ground and on the card. Wins over `icon`; `art` still wins over it.
   */
  sprite?: string;
  /**
   * THE TURNTABLE (it.114): a 30-frame one-direction atlas anim (`spin_*`).
   * Since it.115 a cell with one shows it TURNING (`.inv-spin`, a CSS
   * steps() animation over the strip), the ground glyph steps it when the
   * atlas is resident, and the inspect view turns it large.
   */
  spin?: string;
  /** Worn bonuses (rings, relics — it.42): fractions for dmg/dodge/regen, flat hp/armor. */
  bonus?: { hp?: number; dmg?: number; armor?: number; dodge?: number; regen?: number };

  // ---- Weapon identity (it.80) ----
  /** Swing-speed multiplier on the family's timing (1.1 = faster). */
  speedMult?: number;
  /** Added crit chance. */
  critBonus?: number;
  /** Added reach in tiles. */
  reachBonus?: number;
  /** The shape-and-tier innate effect (a proc or a trait). */
  innate?: Effect;
  /** Uniques carry a second innate. */
  innate2?: Effect;
  /** Derived instances: the enchantment key applied at the forge. */
  enchant?: string;
  /** Derived instances: every effect the weapon carries (innates + enchantment). */
  effects?: Effect[];

  // ---- Registry bases (it.78) ----
  /** Item-level range the base drops in. */
  band?: [number, number];
  /** Only legendary and mythic rolls use this base. */
  uniqueOnly?: boolean;

  // ---- Derived instances (it.78) ----
  /** The base id this instance was built from. */
  base?: string;
  /** Item level 1–100. */
  ilvl?: number;
  /** Reinforcement +0…+15. */
  upgrade?: number;
  affixes?: AffixRoll[];
  /** Printed affix lines (and the unique / passive line). */
  affixLines?: string[];
  /** Legendary unique effect. */
  unique?: UniqueEffect;
  /** Mythic: a passive skill id granted while worn. */
  passive?: string;
  /** Material stacks: how many this id carries. */
  count?: number;
  /** The item's own words (the card, the codex): what it is for. */
  desc?: string;
}

/**
 * Attack timing per weapon family (ticks at 60 Hz). Imported by BOTH
 * CombatSystem (simulation) and Player (swing/draw animation) — the single
 * source keeps visuals honest about dodge windows. Never fork these numbers.
 */
export const WEAPON_TIMING: Record<WeaponKind, { windup: number; recover: number }> = {
  blade: { windup: 16, recover: 22 }, // 0.63 s/swing — deliberate D1 weight.
  katana: { windup: 12, recover: 14 }, // Fast, precise; pays in raw damage.
  axe: { windup: 22, recover: 26 }, // Heavy chop.
  mace: { windup: 18, recover: 24 }, // Crushing — always staggers.
  polearm: { windup: 20, recover: 26 }, // Sweeping reach.
  bow: { windup: 24, recover: 18 },
  wand: { windup: 26, recover: 20 },
};

/** Family combat character beyond timing (defaults; items may override range). */
export const WEAPON_FAMILY: Record<
  WeaponKind,
  { range: number; critChance: number; stuns: boolean }
> = {
  blade: { range: 1.2, critChance: 0.1, stuns: false },
  katana: { range: 1.15, critChance: 0.18, stuns: false },
  axe: { range: 1.25, critChance: 0.12, stuns: false },
  mace: { range: 1.2, critChance: 0.08, stuns: true }, // Every hit staggers.
  polearm: { range: 1.9, critChance: 0.08, stuns: false }, // Strike before they close.
  bow: { range: 6, critChance: 0.1, stuns: false },
  wand: { range: 5.5, critChance: 0.1, stuns: false },
};

/**
 * Gold worth of an item (it.78): an explicit value, else the economy formula
 *   value = (iLvl × 15) × rarityMult × (1 + 0.15 × upgrade)
 * Legacy catalog gear counts as iLvl 1.
 */
export function itemValue(def: ItemDef): number {
  if (def.value !== undefined) return def.value * (def.count ?? 1);
  const ilvl = Math.max(1, def.ilvl ?? 1);
  return Math.max(1, Math.round(ilvl * 15 * RARITY_MULT[def.rarity] * (1 + 0.15 * (def.upgrade ?? 0))));
}

/** Paperdoll/ground-glyph texture key for an item. */
export function overlayTextureFor(def: ItemDef): string {
  if (def.slot === 'mainHand') {
    const kind = def.weaponKind ?? 'blade';
    if (kind === 'bow') return 'pd_bow';
    if (kind === 'wand') return 'pd_wand';
    return 'pd_mainHand'; // All held melee weapons share the blade overlay.
  }
  return `pd_${def.slot}`;
}

/** Rarity accent colors (names, glows, tooltip titles). */
export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0xb8b0a0,
  uncommon: 0x5f7fdf,
  rare: 0xf0d24a,
  epic: 0xb46cff,
  legendary: 0xffb347,
  mythic: 0xff5f8a,
};

/** The classic catalog: the crypt's own relics, the draughts, the starter kit. */
export const ITEMS: Record<string, ItemDef> = {
  // THE NEW ART (it.115): every relic carries a `sprite` - an Arsenal icon (`arsenal_<id>`) for the
  // plain arms and shields, a polyy turntable (`item_weapon_*` + `spin_weapon_*`) for the named
  // ones. The Raven `icon` stays as the fallback and for armour and jewellery, which the drop
  // brought no art for.
  rusty_sword: { id: 'rusty_sword', name: 'Rusty Sword', slot: 'mainHand', rarity: 'common', minDamage: 3, maxDamage: 7, color: 0x9a8f80, icon: 'raven1442', sprite: 'arsenal_broken_sword', desc: 'The blade every delver starts with. Rust and a good grip.' },
  soldier_blade: { id: 'soldier_blade', name: 'Soldier Blade', slot: 'mainHand', rarity: 'uncommon', minDamage: 6, maxDamage: 12, color: 0x8fa8d8, icon: 'raven1450', sprite: 'item_weapon_duelist_s_rapier', spin: 'spin_weapon_duelist_s_rapier', desc: 'Issue steel from the old garrison, still true.' },
  doombringer: { id: 'doombringer', name: 'Doombringer', slot: 'mainHand', rarity: 'rare', minDamage: 11, maxDamage: 20, color: 0xd8763c, icon: 'raven1683', sprite: 'arsenal_rune_sword', desc: 'A blade with a name and a history nobody finished telling.' },
  short_bow: { id: 'short_bow', name: 'Short Bow', slot: 'mainHand', rarity: 'common', weaponKind: 'bow', range: 6, minDamage: 4, maxDamage: 8, color: 0x8a6f4d, icon: 'raven1483', sprite: 'arsenal_shortbow', desc: 'A hunting bow: quick to draw, honest at six tiles.' },
  hunters_bow: { id: 'hunters_bow', name: "Hunter's Bow", slot: 'mainHand', rarity: 'uncommon', weaponKind: 'bow', range: 6.5, minDamage: 6, maxDamage: 11, color: 0x6f9a5a, icon: 'raven1484', sprite: 'arsenal_recurved_bow', desc: 'Yew and sinew, half a tile more reach than the short bow.' },
  emberwand: { id: 'emberwand', name: 'Emberwand', slot: 'mainHand', rarity: 'rare', weaponKind: 'wand', range: 5.5, minDamage: 9, maxDamage: 15, color: 0xe0803a, icon: 'raven1491', sprite: 'arsenal_crystal_wand', desc: 'Warm to the touch. A caster’s early treasure.' },
  plank_shield: { id: 'plank_shield', name: 'Plank Shield', slot: 'offHand', rarity: 'common', armor: 2, color: 0x8a6f4d, icon: 'raven2115', sprite: 'arsenal_wooden_buckler', desc: 'Two boards and a strap. It stops a bite.' },
  tower_aegis: { id: 'tower_aegis', name: 'Tower Aegis', slot: 'offHand', rarity: 'uncommon', armor: 4, color: 0x6f8fd0, icon: 'raven2123', sprite: 'arsenal_tower_shield', desc: 'A tall shield from the watch. Twice the plank.' },
  iron_cap: { id: 'iron_cap', name: 'Iron Cap', slot: 'head', rarity: 'common', armor: 1, color: 0x9aa0a8, icon: 'raven1906', desc: 'A plain cap. Better than hair.' },
  crown_of_embers: { id: 'crown_of_embers', name: 'Crown of Embers', slot: 'head', rarity: 'rare', armor: 3, color: 0xe09040, icon: 'raven1917', desc: 'It never cools.' },
  leather_jerkin: { id: 'leather_jerkin', name: 'Leather Jerkin', slot: 'torso', rarity: 'common', armor: 2, color: 0x8a6a48, icon: 'raven1817', desc: 'Boiled leather. The first coat of every delver.' },
  dark_mail: { id: 'dark_mail', name: 'Dark Mail', slot: 'torso', rarity: 'uncommon', armor: 4, color: 0x5a6a9a, icon: 'raven1859', desc: 'Blackened rings that do not catch the torchlight.' },
  worn_boots: { id: 'worn_boots', name: 'Worn Boots', slot: 'legs', rarity: 'common', armor: 1, color: 0x7a6650, icon: 'raven1938', desc: 'They have walked further than you have.' },
  shadow_cloak: { id: 'shadow_cloak', name: 'Shadow Cloak', slot: 'cloak', rarity: 'uncommon', armor: 1, color: 0x6a5a9a, icon: 'raven1977', desc: 'Dyed for the dark.' },
  // --- The expanded arsenal --------------------------------------------------
  war_axe: { id: 'war_axe', name: 'War Axe', slot: 'mainHand', rarity: 'common', weaponKind: 'axe', minDamage: 5, maxDamage: 11, color: 0x9a8874, icon: 'raven1462', sprite: 'arsenal_battleaxe', desc: 'Heavy, slow, and the widest swing of the starter arms.' },
  gravecleaver: { id: 'gravecleaver', name: 'Gravecleaver', slot: 'mainHand', rarity: 'rare', weaponKind: 'axe', minDamage: 13, maxDamage: 24, color: 0xc06a48, icon: 'raven1467', sprite: 'arsenal_double_axe', desc: 'An executioner’s axe that outlived its executioner.' },
  flanged_mace: { id: 'flanged_mace', name: 'Flanged Mace', slot: 'mainHand', rarity: 'common', weaponKind: 'mace', minDamage: 4, maxDamage: 9, color: 0x8a8a94, icon: 'raven1470', sprite: 'arsenal_flanged_mace', desc: 'Every mace staggers what it hits. This one is cheap.' },
  skullcrusher: { id: 'skullcrusher', name: 'Skullcrusher', slot: 'mainHand', rarity: 'uncommon', weaponKind: 'mace', minDamage: 7, maxDamage: 13, color: 0x7a86a8, icon: 'raven1472', sprite: 'item_weapon_spiked_mace', spin: 'spin_weapon_spiked_mace', desc: 'Named by its first owner. Earned by its second.' },
  dawnhammer: { id: 'dawnhammer', name: 'Dawnhammer', slot: 'mainHand', rarity: 'rare', weaponKind: 'mace', minDamage: 10, maxDamage: 18, color: 0xd8b45c, icon: 'raven1474', sprite: 'item_weapon_warhammer', spin: 'spin_weapon_warhammer', desc: 'A temple hammer, gilded, that still staggers like any mace.' },
  reaper_scythe: { id: 'reaper_scythe', name: "Reaper's Scythe", slot: 'mainHand', rarity: 'uncommon', weaponKind: 'polearm', minDamage: 8, maxDamage: 14, color: 0x86a08a, icon: 'raven1479', sprite: 'item_weapon_reaper_s_scythe', spin: 'spin_weapon_reaper_s_scythe', desc: 'A farm tool with a battlefield reach.' },
  warden_halberd: { id: 'warden_halberd', name: 'Warden Halberd', slot: 'mainHand', rarity: 'rare', weaponKind: 'polearm', range: 2.0, minDamage: 11, maxDamage: 19, color: 0xa8b0c0, icon: 'raven1480', sprite: 'item_weapon_halberd', spin: 'spin_weapon_halberd', desc: 'Two full tiles of reach: strike before they close.' },
  iron_katana: { id: 'iron_katana', name: 'Iron Katana', slot: 'mainHand', rarity: 'uncommon', weaponKind: 'katana', minDamage: 5, maxDamage: 9, color: 0xb0b8c8, icon: 'raven1508', sprite: 'arsenal_saber', desc: 'Fast steel with an 18% crit — the katana’s pace.' },
  falcon_edge: { id: 'falcon_edge', name: 'Falcon Edge', slot: 'mainHand', rarity: 'rare', weaponKind: 'katana', minDamage: 7, maxDamage: 12, color: 0xd8cfa0, icon: 'raven1510', sprite: 'item_weapon_pirate_cutlass', spin: 'spin_weapon_pirate_cutlass', desc: 'Light as a wing, and as quick.' },
  // --- Consumables (it.39): the belt's staples ------------------------------------
  // THE QUARRY KEYS (it.85): each opens one iron gate in the mines. Carried, never drunk.
  quarry_key_1: { id: 'quarry_key_1', name: 'Quarry Key I', slot: 'consumable', rarity: 'rare', icon: 'key1', value: 0, use: { key: 1 }, color: 0xc8803a, desc: 'Iron, pitted, warm from a dead miner’s hand. It opens the FIRST gate of the quarry. Walk up to the gate with it.' },
  quarry_key_2: { id: 'quarry_key_2', name: 'Quarry Key II', slot: 'consumable', rarity: 'rare', icon: 'key2', value: 0, use: { key: 2 }, color: 0xc8d0d8, desc: 'Steel, cut for a heavier lock. It opens the SECOND gate of the quarry. Walk up to the gate with it.' },
  quarry_key_3: { id: 'quarry_key_3', name: 'Quarry Key III', slot: 'consumable', rarity: 'rare', icon: 'key3', value: 0, use: { key: 3 }, color: 0xffd070, desc: 'Gilded, the foreman’s. It opens the LAST gate before the deep hall. Walk up to the gate with it.' },
  // THE BAKED FLASKS (it.114): the draughts wear the new 64 px bottles and carry a turntable; every cell turns it (it.115).
  health_potion: { id: 'health_potion', name: 'Healing Potion', slot: 'consumable', rarity: 'common', icon: 'raven266', sprite: 'item_potion_health', spin: 'spin_potion_health', value: 30, use: { heal: 0.5 }, color: 0xc83030, desc: 'Half your life back, on a five-second cooldown shared with every healing draught.' },
  mana_potion: { id: 'mana_potion', name: 'Mana Potion', slot: 'consumable', rarity: 'common', icon: 'raven69', sprite: 'item_potion_mana', spin: 'spin_potion_mana', value: 30, use: { resource: 0.6 }, color: 0x4a6ad8, desc: 'Six tenths of your mana or stamina, on a two-second cooldown.' },
  scroll_town_portal: { id: 'scroll_town_portal', name: 'Scroll of Town Portal', slot: 'consumable', rarity: 'uncommon', icon: 'raven309', sprite: 'item_scroll_b', spin: 'spin_scroll_b', value: 80, use: { portal: true }, color: 0xd8c890, desc: 'A rift home and back. The rite on T is free; the scroll is for collectors.' },
  elixir: { id: 'elixir', name: 'Violet Elixir', slot: 'consumable', rarity: 'uncommon', icon: 'raven61', sprite: 'item_potion_elixir', spin: 'spin_potion_elixir', value: 65, use: { heal: 0.35, resource: 0.5 }, color: 0x9a5ad8, desc: 'A third of your life and half your resource in one swallow. Counts as a healing draught.' },
  // ---- Starter kit (it.42): every class leaves town armed and clothed ----
  apprentice_wand: { id: 'apprentice_wand', name: 'Apprentice Wand', slot: 'mainHand', rarity: 'common', weaponKind: 'wand', range: 5, minDamage: 3, maxDamage: 6, color: 0xb08a5a, icon: 'raven1494', sprite: 'arsenal_simple_wand', desc: 'The first wand. It points; the arcana does the rest.' },
  worn_katana: { id: 'worn_katana', name: 'Worn Katana', slot: 'mainHand', rarity: 'common', weaponKind: 'katana', minDamage: 3, maxDamage: 6, color: 0x9aa0a8, icon: 'raven1511', sprite: 'arsenal_shortsword', desc: 'Nicked, quick, and the rogue’s first friend.' },
  cloth_robe: { id: 'cloth_robe', name: 'Cloth Robe', slot: 'torso', rarity: 'common', armor: 1, color: 0x6a5a9a, icon: 'raven2087', desc: 'Warm, at least.' },
  // ---- Rings (it.42): worn bonuses in the ring slot ----
  copper_ring: { id: 'copper_ring', name: 'Copper Ring', slot: 'ring', rarity: 'common', bonus: { hp: 8 }, color: 0xb87a48, icon: 'raven1845', desc: 'A little life in a cheap band.' },
  ring_of_embers: { id: 'ring_of_embers', name: 'Ring of Embers', slot: 'ring', rarity: 'uncommon', bonus: { dmg: 0.08 }, color: 0xe0803a, icon: 'raven1847', desc: 'Eight percent harder, every blow.' },
  wardens_signet: { id: 'wardens_signet', name: "Warden's Signet", slot: 'ring', rarity: 'rare', bonus: { armor: 2, dodge: 0.05 }, color: 0x9fb4e8, icon: 'raven1848', desc: 'Taken from a keeper of the deep. Armor and a sidestep.' },
  hollow_seal: { id: 'hollow_seal', name: 'Seal of the Hollow King', slot: 'ring', rarity: 'legendary', bonus: { dmg: 0.15, hp: 20, regen: 0.2 }, color: 0xffb347, icon: 'raven1850', desc: 'The king’s own seal. Damage, life and a quicker breath.' },
  // ---- Legendary trophies (it.42): boss-only rolls ----
  kingsbane: { id: 'kingsbane', name: 'Kingsbane', slot: 'mainHand', rarity: 'legendary', minDamage: 16, maxDamage: 28, color: 0xffb347, icon: 'raven1720', sprite: 'item_weapon_crystal_greatsword', spin: 'spin_weapon_crystal_greatsword', bonus: { dmg: 0.1 }, desc: 'Forged for one throat.' },
  crown_of_the_hollow: { id: 'crown_of_the_hollow', name: 'Crown of the Hollow', slot: 'head', rarity: 'legendary', armor: 5, bonus: { hp: 15, dodge: 0.04 }, color: 0xffb347, icon: 'raven2078', desc: 'Heavier than it looks. Lighter than it should be.' },
};

/** Chance an enemy drops anything at all. */
export const DROP_CHANCE = 0.6;

const fmt1 = (n: number): string => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1));

/** One-line stat summary for tooltips and inventory rows. */
export function statLine(def: ItemDef): string {
  // ARPG phrasing (it.43): every line is a standardized "+N to Stat" / "N–M Damage" statement.
  const parts: string[] = [];
  if (def.minDamage !== undefined && def.maxDamage !== undefined) {
    parts.push(`${def.minDamage}–${def.maxDamage} Damage`);
  }
  if (def.range) parts.push(`Range ${def.range}`);
  if (def.armor) parts.push(`+${fmt1(def.armor)} Armor`);
  if (def.use?.food) {
    // A DISH (it.115): the slow heal, then the tier's brews - no hunger any more.
    const t = FOOD_TIER[def.use.food.tier];
    parts.push(`Restores ${Math.round(def.use.food.heal * 100)}% Life over 3 s`);
    if (t.might) parts.push(`Might for ${Math.round(t.might / 60)} s`);
    if (t.stone) parts.push(`Stone skin for ${Math.round(t.stone / 60)} s`);
    if (t.haste) parts.push(`Haste for ${Math.round(t.haste / 60)} s`);
    if (t.restore) parts.push(`Restores ${Math.round(t.restore * 100)}% resource`);
    parts.push(`A ${def.use.food.tier}`);
  } else if (def.use?.heal) parts.push(`Restores ${Math.round(def.use.heal * 100)}% Life`);
  if (def.use?.resource) parts.push(`Restores ${Math.round(def.use.resource * 100)}% Mana / Stamina`);
  if (def.use?.portal) parts.push('Opens a Town Portal');
  if (def.slot === 'material') parts.push(def.count && def.count > 1 ? `A stack of ${def.count}` : 'Crafting material');
  if (def.slot === 'food' && def.count && def.count > 1) parts.push(`A stack of ${def.count}`);
  if (def.bonus) {
    if (def.bonus.hp) parts.push(`+${Math.round(def.bonus.hp)} to Max HP`);
    if (def.bonus.dmg) parts.push(`+${Math.round(def.bonus.dmg * 100)}% Damage`);
    if (def.bonus.armor) parts.push(`+${fmt1(def.bonus.armor)} Armor`);
    if (def.bonus.dodge) parts.push(`+${Math.round(def.bonus.dodge * 100)}% Dodge`);
    if (def.bonus.regen) parts.push(`+${Math.round(def.bonus.regen * 100)}% Regeneration`);
  }
  if (def.use?.haste) parts.push(`Haste for ${Math.round(def.use.haste / 60)} s`);
  if (def.use?.stone) parts.push(`Stone skin for ${Math.round(def.use.stone / 60)} s`);
  if (def.use?.might) parts.push(`Might for ${Math.round(def.use.might / 60)} s`);
  if (def.use?.recipe) parts.push('Read to learn the enchantment');
  if (def.use?.smelt) parts.push(`Smelts into ${def.use.smelt.count} ${SMELT_NAME[def.use.smelt.material] ?? def.use.smelt.material}`);
  if (def.desc && def.slot !== 'mainHand' && !def.ilvl) parts.push(def.desc);
  if (def.affixLines?.length) parts.push(...def.affixLines);
  return parts.join(' · ') || 'No Bonuses';
}
