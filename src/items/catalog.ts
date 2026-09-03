/**
 * @module items/catalog
 * Static item definitions and the seeded drop table.
 *
 * Items are pure data — visuals derive from `slot` (paperdoll overlay
 * texture) + `color` (tint), so adding an item is one catalog entry, no art
 * code. Stats are deliberately minimal for M3: weapons add damage, armor
 * pieces add damage reduction. Tuning surface for the balance sub-task.
 */

import type { EquipmentSlot } from '@/network/Serialization';

export type Rarity = 'common' | 'magic' | 'rare' | 'legendary';

/** Where an item lives: a paperdoll slot, or the consumable pouch (it.39). */
export type ItemSlot = EquipmentSlot | 'consumable';

/** Main-hand weapon families — drive attack style, timing, and visuals. */
export type WeaponKind = 'blade' | 'katana' | 'axe' | 'mace' | 'polearm' | 'bow' | 'wand';

export interface ItemDef {
  id: string;
  name: string;
  slot: ItemSlot;
  rarity: Rarity;
  /** Merchant price in gold (derived from rarity/stats when omitted). */
  value?: number;
  /** Consumables (it.39): what using it does. Fractions of max. */
  use?: { heal?: number; resource?: number; portal?: boolean };
  /** Weapon damage roll range (Diablo-style min–max, replaces bare fists). */
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
  /** Weapon-icon stem from the oubliette pack (drives grid + ground icons). */
  icon?: string;
  /** Painted 64 px icon under assets/ui/items (it.40) — wins over `icon` in panels. */
  art?: string;
  /** Worn bonuses (rings, relics — it.42): fractions for dmg/dodge/regen, flat hp/armor. */
  bonus?: { hp?: number; dmg?: number; armor?: number; dodge?: number; regen?: number };
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

/** Gold worth of an item (it.39): explicit value, else rarity tier + stat weight. */
export function itemValue(def: ItemDef): number {
  if (def.value !== undefined) return def.value;
  const tier = def.rarity === 'legendary' ? 1400 : def.rarity === 'rare' ? 420 : def.rarity === 'magic' ? 140 : 35;
  const dmg = def.maxDamage !== undefined && def.minDamage !== undefined ? (def.minDamage + def.maxDamage) * 4 : 0;
  const arm = (def.armor ?? 0) * 18;
  return tier + dmg + arm;
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
  magic: 0x5f7fdf,
  rare: 0xf0d24a,
  legendary: 0xffb347,
};

export const ITEMS: Record<string, ItemDef> = {
  rusty_sword: { id: 'rusty_sword', name: 'Rusty Sword', slot: 'mainHand', rarity: 'common', art: 'rusty_sword', minDamage: 3, maxDamage: 7, color: 0x9a8f80, icon: 'bronze_sword_0' },
  soldier_blade: { id: 'soldier_blade', name: 'Soldier Blade', slot: 'mainHand', rarity: 'magic', art: 'soldier_blade', minDamage: 6, maxDamage: 12, color: 0x8fa8d8, icon: 'iron_sword_0' },
  doombringer: { id: 'doombringer', name: 'Doombringer', slot: 'mainHand', rarity: 'rare', art: 'doombringer', minDamage: 11, maxDamage: 20, color: 0xd8763c, icon: 'steel_large_0' },
  short_bow: { id: 'short_bow', name: 'Short Bow', slot: 'mainHand', rarity: 'common', art: 'short_bow', weaponKind: 'bow', range: 6, minDamage: 4, maxDamage: 8, color: 0x8a6f4d },
  hunters_bow: { id: 'hunters_bow', name: "Hunter's Bow", slot: 'mainHand', rarity: 'magic', art: 'hunters_bow', weaponKind: 'bow', range: 6.5, minDamage: 6, maxDamage: 11, color: 0x6f9a5a },
  emberwand: { id: 'emberwand', name: 'Emberwand', slot: 'mainHand', rarity: 'rare', art: 'emberwand', weaponKind: 'wand', range: 5.5, minDamage: 9, maxDamage: 15, color: 0xe0803a, icon: 'stick_0' },
  plank_shield: { id: 'plank_shield', name: 'Plank Shield', slot: 'offHand', rarity: 'common', art: 'plank_shield', armor: 2, color: 0x8a6f4d },
  tower_aegis: { id: 'tower_aegis', name: 'Tower Aegis', slot: 'offHand', rarity: 'magic', art: 'tower_aegis', armor: 4, color: 0x6f8fd0 },
  iron_cap: { id: 'iron_cap', name: 'Iron Cap', slot: 'head', rarity: 'common', art: 'iron_cap', armor: 1, color: 0x9aa0a8 },
  crown_of_embers: { id: 'crown_of_embers', name: 'Crown of Embers', slot: 'head', rarity: 'rare', art: 'crown_of_embers', armor: 3, color: 0xe09040 },
  leather_jerkin: { id: 'leather_jerkin', name: 'Leather Jerkin', slot: 'torso', rarity: 'common', art: 'leather_jerkin', armor: 2, color: 0x8a6a48 },
  dark_mail: { id: 'dark_mail', name: 'Dark Mail', slot: 'torso', rarity: 'magic', art: 'dark_mail', armor: 4, color: 0x5a6a9a },
  worn_boots: { id: 'worn_boots', name: 'Worn Boots', slot: 'legs', rarity: 'common', armor: 1, color: 0x7a6650 },
  shadow_cloak: { id: 'shadow_cloak', name: 'Shadow Cloak', slot: 'cloak', rarity: 'magic', armor: 1, color: 0x6a5a9a },
  // --- The expanded arsenal (oubliette icon pack) ---------------------------
  war_axe: { id: 'war_axe', name: 'War Axe', slot: 'mainHand', rarity: 'common', art: 'war_axe', weaponKind: 'axe', minDamage: 5, maxDamage: 11, color: 0x9a8874, icon: 'iron_axe_0' },
  gravecleaver: { id: 'gravecleaver', name: 'Gravecleaver', slot: 'mainHand', rarity: 'rare', art: 'gravecleaver', weaponKind: 'axe', minDamage: 13, maxDamage: 24, color: 0xc06a48, icon: 'iron_baxe_0' },
  flanged_mace: { id: 'flanged_mace', name: 'Flanged Mace', slot: 'mainHand', rarity: 'common', weaponKind: 'mace', minDamage: 4, maxDamage: 9, color: 0x8a8a94, icon: 'mace_0' },
  skullcrusher: { id: 'skullcrusher', name: 'Skullcrusher', slot: 'mainHand', rarity: 'magic', weaponKind: 'mace', minDamage: 7, maxDamage: 13, color: 0x7a86a8, icon: 'mace_big_0' },
  dawnhammer: { id: 'dawnhammer', name: 'Dawnhammer', slot: 'mainHand', rarity: 'rare', weaponKind: 'mace', minDamage: 10, maxDamage: 18, color: 0xd8b45c, icon: 'steel_ghammer_0' },
  reaper_scythe: { id: 'reaper_scythe', name: "Reaper's Scythe", slot: 'mainHand', rarity: 'magic', weaponKind: 'polearm', minDamage: 8, maxDamage: 14, color: 0x86a08a, icon: 'iron_scythe_0' },
  warden_halberd: { id: 'warden_halberd', name: 'Warden Halberd', slot: 'mainHand', rarity: 'rare', weaponKind: 'polearm', range: 2.0, minDamage: 11, maxDamage: 19, color: 0xa8b0c0, icon: 'steel_halberd_0' },
  iron_katana: { id: 'iron_katana', name: 'Iron Katana', slot: 'mainHand', rarity: 'magic', weaponKind: 'katana', minDamage: 5, maxDamage: 9, color: 0xb0b8c8, icon: 'iron_katana_0' },
  falcon_edge: { id: 'falcon_edge', name: 'Falcon Edge', slot: 'mainHand', rarity: 'rare', weaponKind: 'katana', minDamage: 7, maxDamage: 12, color: 0xd8cfa0, icon: 'steel_falcon_0' },
  // --- Consumables (it.39): the belt-less Diablo essentials ------------------
  health_potion: { id: 'health_potion', name: 'Healing Potion', slot: 'consumable', rarity: 'common', art: 'health_potion', value: 30, use: { heal: 0.5 }, color: 0xc83030 },
  mana_potion: { id: 'mana_potion', name: 'Mana Potion', slot: 'consumable', rarity: 'common', art: 'mana_potion', value: 30, use: { resource: 0.6 }, color: 0x4a6ad8 },
  scroll_town_portal: { id: 'scroll_town_portal', name: 'Scroll of Town Portal', slot: 'consumable', rarity: 'magic', art: 'scroll_town_portal', value: 80, use: { portal: true }, color: 0xd8c890 },
  elixir: { id: 'elixir', name: 'Violet Elixir', slot: 'consumable', rarity: 'magic', art: 'elixir', value: 65, use: { heal: 0.35, resource: 0.5 }, color: 0x9a5ad8 },
  // ---- Starter kit (it.42): every class leaves town armed and clothed ----
  apprentice_wand: { id: 'apprentice_wand', name: 'Apprentice Wand', slot: 'mainHand', rarity: 'common', weaponKind: 'wand', range: 5, minDamage: 3, maxDamage: 6, color: 0xb08a5a, icon: 'stick_0' },
  worn_katana: { id: 'worn_katana', name: 'Worn Katana', slot: 'mainHand', rarity: 'common', weaponKind: 'katana', minDamage: 3, maxDamage: 6, color: 0x9aa0a8, icon: 'iron_katana_0' },
  cloth_robe: { id: 'cloth_robe', name: 'Cloth Robe', slot: 'torso', rarity: 'common', art: 'cloth_robe', armor: 1, color: 0x6a5a9a },
  // ---- Rings (it.42): worn bonuses in the new ring slot ----
  copper_ring: { id: 'copper_ring', name: 'Copper Ring', slot: 'ring', rarity: 'common', bonus: { hp: 8 }, color: 0xb87a48 },
  ring_of_embers: { id: 'ring_of_embers', name: 'Ring of Embers', slot: 'ring', rarity: 'magic', bonus: { dmg: 0.08 }, color: 0xe0803a },
  wardens_signet: { id: 'wardens_signet', name: "Warden's Signet", slot: 'ring', rarity: 'rare', bonus: { armor: 2, dodge: 0.05 }, color: 0x9fb4e8 },
  hollow_seal: { id: 'hollow_seal', name: 'Seal of the Hollow King', slot: 'ring', rarity: 'legendary', bonus: { dmg: 0.15, hp: 20, regen: 0.2 }, color: 0xffb347 },
  // ---- Legendary trophies (it.42): boss-only rolls ----
  kingsbane: { id: 'kingsbane', name: 'Kingsbane', slot: 'mainHand', rarity: 'legendary', minDamage: 16, maxDamage: 28, color: 0xffb347, icon: 'steel_large_0', bonus: { dmg: 0.1 } },
  crown_of_the_hollow: { id: 'crown_of_the_hollow', name: 'Crown of the Hollow', slot: 'head', rarity: 'legendary', art: 'crown_of_the_hollow', armor: 5, bonus: { hp: 15, dodge: 0.04 }, color: 0xffb347 },
};

const BY_RARITY: Record<Rarity, ItemDef[]> = { common: [], magic: [], rare: [], legendary: [] };
// The town portal is a HUD rite now (it.49): its scroll never drops or rolls from a chest.
for (const def of Object.values(ITEMS)) if (!def.use?.portal) BY_RARITY[def.rarity].push(def);
// Potions drop from the dead too (it.39): a healing potion joins the common pool twice.
BY_RARITY.common.push(ITEMS.health_potion, ITEMS.health_potion, ITEMS.mana_potion);

/** Chance an enemy drops anything at all. */
export const DROP_CHANCE = 0.6;

/**
 * Roll a drop from a deterministic RNG stream ([0,1) sampler).
 * Returns null on a miss. Rarity weights: 60/30/10.
 */
export function rollDrop(rand: () => number): ItemDef | null {
  if (rand() >= DROP_CHANCE) return null;
  return rollChestItem(rand);
}

/** Guaranteed item roll (chests): rarity 55/32/13 — slightly juicier. */
export function rollChestItem(rand: () => number): ItemDef {
  const roll = rand();
  const rarity: Rarity = roll < 0.55 ? 'common' : roll < 0.87 ? 'magic' : 'rare';
  const pool = BY_RARITY[rarity];
  return pool[Math.floor(rand() * pool.length)];
}

/** Guaranteed RARE roll (boss trophies) — one in six comes up LEGENDARY (it.42). */
export function rollRareItem(rand: () => number): ItemDef {
  const pool = rand() < 1 / 6 && BY_RARITY.legendary.length > 0 ? BY_RARITY.legendary : BY_RARITY.rare;
  return pool[Math.floor(rand() * pool.length)];
}

/** One-line stat summary for tooltips and inventory rows. */
export function statLine(def: ItemDef): string {
  // ARPG phrasing (it.43): every line is a standardized "+N to Stat" / "N–M Damage" statement.
  const parts: string[] = [];
  if (def.minDamage !== undefined && def.maxDamage !== undefined) {
    parts.push(`${def.minDamage}–${def.maxDamage} Damage`);
  }
  if (def.range) parts.push(`Range ${def.range}`);
  if (def.armor) parts.push(`+${def.armor} Armor`);
  if (def.use?.heal) parts.push(`Restores ${Math.round(def.use.heal * 100)}% Life`);
  if (def.use?.resource) parts.push(`Restores ${Math.round(def.use.resource * 100)}% Mana / Stamina`);
  if (def.use?.portal) parts.push('Opens a Town Portal');
  if (def.bonus) {
    if (def.bonus.hp) parts.push(`+${def.bonus.hp} to Max HP`);
    if (def.bonus.dmg) parts.push(`+${Math.round(def.bonus.dmg * 100)}% Damage`);
    if (def.bonus.armor) parts.push(`+${def.bonus.armor} Armor`);
    if (def.bonus.dodge) parts.push(`+${Math.round(def.bonus.dodge * 100)}% Dodge`);
    if (def.bonus.regen) parts.push(`+${Math.round(def.bonus.regen * 100)}% Regeneration`);
  }
  return parts.join(' · ') || 'No Bonuses';
}
