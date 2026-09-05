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

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

/** Stat multiplier per rarity (it.78). */
export const RARITY_MULT: Record<Rarity, number> = { common: 1, uncommon: 1.25, rare: 1.6, epic: 2.1, legendary: 2.8, mythic: 3.8 };
/** Affix count per rarity (legendary adds a unique effect, mythic a passive skill). */
export const RARITY_AFFIX_COUNT: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
/** Drop weights (percent). */
export const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 0.9, mythic: 0.1 };

/** Where an item lives: a paperdoll slot, the consumable pouch, or the crafting pouch (it.78). */
export type ItemSlot = EquipmentSlot | 'consumable' | 'material';

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
  /** Consumables (it.39): what using it does. Fractions of max. */
  use?: { heal?: number; resource?: number; portal?: boolean };
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
  /** Worn bonuses (rings, relics — it.42): fractions for dmg/dodge/regen, flat hp/armor. */
  bonus?: { hp?: number; dmg?: number; armor?: number; dodge?: number; regen?: number };

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
  rusty_sword: { id: 'rusty_sword', name: 'Rusty Sword', slot: 'mainHand', rarity: 'common', art: 'rusty_sword', minDamage: 3, maxDamage: 7, color: 0x9a8f80, icon: 'bronze_sword_0' },
  soldier_blade: { id: 'soldier_blade', name: 'Soldier Blade', slot: 'mainHand', rarity: 'uncommon', art: 'soldier_blade', minDamage: 6, maxDamage: 12, color: 0x8fa8d8, icon: 'iron_sword_0' },
  doombringer: { id: 'doombringer', name: 'Doombringer', slot: 'mainHand', rarity: 'rare', art: 'doombringer', minDamage: 11, maxDamage: 20, color: 0xd8763c, icon: 'steel_large_0' },
  short_bow: { id: 'short_bow', name: 'Short Bow', slot: 'mainHand', rarity: 'common', art: 'short_bow', weaponKind: 'bow', range: 6, minDamage: 4, maxDamage: 8, color: 0x8a6f4d },
  hunters_bow: { id: 'hunters_bow', name: "Hunter's Bow", slot: 'mainHand', rarity: 'uncommon', art: 'hunters_bow', weaponKind: 'bow', range: 6.5, minDamage: 6, maxDamage: 11, color: 0x6f9a5a },
  emberwand: { id: 'emberwand', name: 'Emberwand', slot: 'mainHand', rarity: 'rare', art: 'emberwand', weaponKind: 'wand', range: 5.5, minDamage: 9, maxDamage: 15, color: 0xe0803a, icon: 'stick_0' },
  plank_shield: { id: 'plank_shield', name: 'Plank Shield', slot: 'offHand', rarity: 'common', art: 'plank_shield', armor: 2, color: 0x8a6f4d },
  tower_aegis: { id: 'tower_aegis', name: 'Tower Aegis', slot: 'offHand', rarity: 'uncommon', art: 'tower_aegis', armor: 4, color: 0x6f8fd0 },
  iron_cap: { id: 'iron_cap', name: 'Iron Cap', slot: 'head', rarity: 'common', art: 'iron_cap', armor: 1, color: 0x9aa0a8 },
  crown_of_embers: { id: 'crown_of_embers', name: 'Crown of Embers', slot: 'head', rarity: 'rare', art: 'crown_of_embers', armor: 3, color: 0xe09040 },
  leather_jerkin: { id: 'leather_jerkin', name: 'Leather Jerkin', slot: 'torso', rarity: 'common', art: 'leather_jerkin', armor: 2, color: 0x8a6a48 },
  dark_mail: { id: 'dark_mail', name: 'Dark Mail', slot: 'torso', rarity: 'uncommon', art: 'dark_mail', armor: 4, color: 0x5a6a9a },
  worn_boots: { id: 'worn_boots', name: 'Worn Boots', slot: 'legs', rarity: 'common', armor: 1, color: 0x7a6650 },
  shadow_cloak: { id: 'shadow_cloak', name: 'Shadow Cloak', slot: 'cloak', rarity: 'uncommon', armor: 1, color: 0x6a5a9a },
  // --- The expanded arsenal (oubliette icon pack) ---------------------------
  war_axe: { id: 'war_axe', name: 'War Axe', slot: 'mainHand', rarity: 'common', art: 'war_axe', weaponKind: 'axe', minDamage: 5, maxDamage: 11, color: 0x9a8874, icon: 'iron_axe_0' },
  gravecleaver: { id: 'gravecleaver', name: 'Gravecleaver', slot: 'mainHand', rarity: 'rare', art: 'gravecleaver', weaponKind: 'axe', minDamage: 13, maxDamage: 24, color: 0xc06a48, icon: 'iron_baxe_0' },
  flanged_mace: { id: 'flanged_mace', name: 'Flanged Mace', slot: 'mainHand', rarity: 'common', weaponKind: 'mace', minDamage: 4, maxDamage: 9, color: 0x8a8a94, icon: 'mace_0' },
  skullcrusher: { id: 'skullcrusher', name: 'Skullcrusher', slot: 'mainHand', rarity: 'uncommon', weaponKind: 'mace', minDamage: 7, maxDamage: 13, color: 0x7a86a8, icon: 'mace_big_0' },
  dawnhammer: { id: 'dawnhammer', name: 'Dawnhammer', slot: 'mainHand', rarity: 'rare', weaponKind: 'mace', minDamage: 10, maxDamage: 18, color: 0xd8b45c, icon: 'steel_ghammer_0' },
  reaper_scythe: { id: 'reaper_scythe', name: "Reaper's Scythe", slot: 'mainHand', rarity: 'uncommon', weaponKind: 'polearm', minDamage: 8, maxDamage: 14, color: 0x86a08a, icon: 'iron_scythe_0' },
  warden_halberd: { id: 'warden_halberd', name: 'Warden Halberd', slot: 'mainHand', rarity: 'rare', weaponKind: 'polearm', range: 2.0, minDamage: 11, maxDamage: 19, color: 0xa8b0c0, icon: 'steel_halberd_0' },
  iron_katana: { id: 'iron_katana', name: 'Iron Katana', slot: 'mainHand', rarity: 'uncommon', weaponKind: 'katana', minDamage: 5, maxDamage: 9, color: 0xb0b8c8, icon: 'iron_katana_0' },
  falcon_edge: { id: 'falcon_edge', name: 'Falcon Edge', slot: 'mainHand', rarity: 'rare', weaponKind: 'katana', minDamage: 7, maxDamage: 12, color: 0xd8cfa0, icon: 'steel_falcon_0' },
  // --- Consumables (it.39): the belt-less classic ARPG essentials ------------------
  health_potion: { id: 'health_potion', name: 'Healing Potion', slot: 'consumable', rarity: 'common', art: 'health_potion', value: 30, use: { heal: 0.5 }, color: 0xc83030 },
  mana_potion: { id: 'mana_potion', name: 'Mana Potion', slot: 'consumable', rarity: 'common', art: 'mana_potion', value: 30, use: { resource: 0.6 }, color: 0x4a6ad8 },
  scroll_town_portal: { id: 'scroll_town_portal', name: 'Scroll of Town Portal', slot: 'consumable', rarity: 'uncommon', art: 'scroll_town_portal', value: 80, use: { portal: true }, color: 0xd8c890 },
  elixir: { id: 'elixir', name: 'Violet Elixir', slot: 'consumable', rarity: 'uncommon', art: 'elixir', value: 65, use: { heal: 0.35, resource: 0.5 }, color: 0x9a5ad8 },
  // ---- Starter kit (it.42): every class leaves town armed and clothed ----
  apprentice_wand: { id: 'apprentice_wand', name: 'Apprentice Wand', slot: 'mainHand', rarity: 'common', weaponKind: 'wand', range: 5, minDamage: 3, maxDamage: 6, color: 0xb08a5a, icon: 'stick_0' },
  worn_katana: { id: 'worn_katana', name: 'Worn Katana', slot: 'mainHand', rarity: 'common', weaponKind: 'katana', minDamage: 3, maxDamage: 6, color: 0x9aa0a8, icon: 'iron_katana_0' },
  cloth_robe: { id: 'cloth_robe', name: 'Cloth Robe', slot: 'torso', rarity: 'common', art: 'cloth_robe', armor: 1, color: 0x6a5a9a },
  // ---- Rings (it.42): worn bonuses in the new ring slot ----
  copper_ring: { id: 'copper_ring', name: 'Copper Ring', slot: 'ring', rarity: 'common', bonus: { hp: 8 }, color: 0xb87a48 },
  ring_of_embers: { id: 'ring_of_embers', name: 'Ring of Embers', slot: 'ring', rarity: 'uncommon', bonus: { dmg: 0.08 }, color: 0xe0803a },
  wardens_signet: { id: 'wardens_signet', name: "Warden's Signet", slot: 'ring', rarity: 'rare', bonus: { armor: 2, dodge: 0.05 }, color: 0x9fb4e8 },
  hollow_seal: { id: 'hollow_seal', name: 'Seal of the Hollow King', slot: 'ring', rarity: 'legendary', bonus: { dmg: 0.15, hp: 20, regen: 0.2 }, color: 0xffb347 },
  // ---- Legendary trophies (it.42): boss-only rolls ----
  kingsbane: { id: 'kingsbane', name: 'Kingsbane', slot: 'mainHand', rarity: 'legendary', minDamage: 16, maxDamage: 28, color: 0xffb347, icon: 'steel_large_0', bonus: { dmg: 0.1 } },
  crown_of_the_hollow: { id: 'crown_of_the_hollow', name: 'Crown of the Hollow', slot: 'head', rarity: 'legendary', art: 'crown_of_the_hollow', armor: 5, bonus: { hp: 15, dodge: 0.04 }, color: 0xffb347 },
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
  if (def.use?.heal) parts.push(`Restores ${Math.round(def.use.heal * 100)}% Life`);
  if (def.use?.resource) parts.push(`Restores ${Math.round(def.use.resource * 100)}% Mana / Stamina`);
  if (def.use?.portal) parts.push('Opens a Town Portal');
  if (def.slot === 'material') parts.push(def.count && def.count > 1 ? `A stack of ${def.count}` : 'Crafting material');
  if (def.bonus) {
    if (def.bonus.hp) parts.push(`+${Math.round(def.bonus.hp)} to Max HP`);
    if (def.bonus.dmg) parts.push(`+${Math.round(def.bonus.dmg * 100)}% Damage`);
    if (def.bonus.armor) parts.push(`+${fmt1(def.bonus.armor)} Armor`);
    if (def.bonus.dodge) parts.push(`+${Math.round(def.bonus.dodge * 100)}% Dodge`);
    if (def.bonus.regen) parts.push(`+${Math.round(def.bonus.regen * 100)}% Regeneration`);
  }
  if (def.affixLines?.length) parts.push(...def.affixLines);
  return parts.join(' · ') || 'No Bonuses';
}
