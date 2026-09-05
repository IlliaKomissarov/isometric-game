/**
 * @module entities/Player
 * Player entity: class archetype + multi-layer paperdoll rendering.
 *
 * PAPERDOLL CONTRACT: the container holds one child Container per equipment
 * layer, in a fixed draw order (cloak behind body, weapons in front, etc.).
 * Equipping an item means putting a sprite into the matching layer container
 * — nothing else re-renders. A sub-agent implementing item visuals only needs
 * `setEquipmentVisual(slot, displayObject)`.
 */

import { Container, Sprite, type ContainerChild } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { eventBus } from '@/core/EventBus';
import { overlayTextureFor, WEAPON_FAMILY, WEAPON_TIMING, type UniqueEffect, type WeaponKind } from '@/items/catalog';
import { itemDef, itemLevers, powerScale } from '@/items/instance';
import type { Effect, TraitKey } from '@/items/effects';
import type { ClassArchetype, EntitySnapshot, EquipmentSlot } from '@/network/Serialization';
import { PASSIVE_BY_ID } from '@/systems/SkillTree';
import { spriteLib, stableDir, type AnimName } from '@/render/SpriteLibrary';
import { multiplyColors } from '@/utils/color';
import { idleFrame, type LightDir } from '@/render/animUtil';
import { COMBAT_SPEED } from '@/core/config';
import { Entity } from './Entity';

/** Ticks the knight's death animation plays before respawn (main drives it). */
export const PLAYER_DEATH_TICKS = 80;

/**
 * HERO HEIGHT STANDARD (it.36): every archetype's painted body lands at
 * this many screen pixels at zoom 1 (measured from the atlas manifest's
 * painted bounds) — identical ground height across all four heroes.
 * Standard mobs share the same standard (Enemy.MOB_HEIGHT); bosses alone
 * are enlarged.
 */
export const HERO_HEIGHT = 56;
/** Walk/run cycle: fraction of a full cycle advanced per tile of travel. */
const HERO_CYCLES_PER_TILE = 0.36;

/** Everything combat + animation need to know about the wielded weapon. */
export interface WeaponProfile {
  kind: WeaponKind;
  ranged: boolean;
  /** Attack range in tiles (melee reach or firing range). */
  range: number;
  windupTicks: number;
  recoverTicks: number;
  minDamage: number;
  maxDamage: number;
  critChance: number;
  /** Maces: every landed hit staggers regardless of damage threshold. */
  stuns: boolean;
  color: number;
}

/** Archetype base stats — tuning surface for the balance sub-task (it.32). */
export interface ArchetypeDef {
  hpMax: number;
  /** Movement speed multiplier applied on top of PLAYER_SPEED. */
  speedMult: number;
  markerTexture: string;
  /** Flat armor the class body brings before equipment. */
  armorBase: number;
  /** Added to the weapon family's crit chance. */
  critBonus: number;
  /** <1 = faster swings (rogue); applied to weapon windup/recover. */
  attackSpeedMult: number;
  /** Base chance to fully evade an enemy strike. */
  dodgeChance: number;
  /** Skill resource pool (mana for the mage, stamina otherwise). */
  resourceName: 'MANA' | 'STAMINA';
  resourceMax: number;
  /** Resource points regenerated per simulation tick. */
  resourceRegen: number;
  /** Unarmed class weapon: what the hero fights with before any drop. */
  defaultWeapon: WeaponKind;
  baseDamage: { min: number; max: number };
}

export const ARCHETYPES: Record<ClassArchetype, ArchetypeDef> = {
  warrior: {
    hpMax: 150, speedMult: 0.95, markerTexture: 'marker_warrior',
    armorBase: 3, critBonus: 0, attackSpeedMult: 1, dodgeChance: 0,
    resourceName: 'STAMINA', resourceMax: 100, resourceRegen: 0.05,
    defaultWeapon: 'blade', baseDamage: { min: 3, max: 6 },
  },
  mage: {
    hpMax: 90, speedMult: 1.0, markerTexture: 'marker_mage',
    armorBase: 0, critBonus: 0.04, attackSpeedMult: 1, dodgeChance: 0,
    resourceName: 'MANA', resourceMax: 120, resourceRegen: 0.09,
    defaultWeapon: 'wand', baseDamage: { min: 4, max: 8 },
  },
  ranger: {
    hpMax: 110, speedMult: 1.12, markerTexture: 'marker_ranger',
    armorBase: 1, critBonus: 0.12, attackSpeedMult: 1, dodgeChance: 0.05,
    resourceName: 'STAMINA', resourceMax: 100, resourceRegen: 0.06,
    defaultWeapon: 'bow', baseDamage: { min: 3, max: 6 },
  },
  rogue: {
    hpMax: 100, speedMult: 1.15, markerTexture: 'marker_rogue',
    armorBase: 1, critBonus: 0.1, attackSpeedMult: 0.75, dodgeChance: 0.12,
    resourceName: 'STAMINA', resourceMax: 110, resourceRegen: 0.07,
    defaultWeapon: 'katana', baseDamage: { min: 2, max: 5 },
  },
};

/** Per-class body: which loaded animation set renders the hero (it.32). */
interface HeroRig {
  idle: AnimName;
  run: AnimName;
  /** Melee swing variants, cycled per swing. */
  attacks: AnimName[];
  /** Anim for ranged/spell attacks (falls back to attacks[0]). */
  rangedAttack?: AnimName;
  hit?: AnimName;
  death: AnimName;
  scale: number;
  anchorY: number;
  /** Rebaked packs carry no baked shadow — show the procedural one. */
  ownShadow: boolean;
  /** Equipment armor tints the body (the knight's HD sheets only). */
  equipmentTint: boolean;
  /** Direction index offset (it.33): packs whose stored rows run opposite
   *  the canonical order get a half-turn (+4 mod 8) correction. */
  dirOffset?: number;
}

/** Every atlas a class rig needs resident (lazy loading, it.36). */
export function animsForHero(cls: ClassArchetype): AnimName[] {
  const rig = CLASS_RIGS[cls];
  const out = new Set<AnimName>([rig.idle, rig.run, ...rig.attacks, rig.death]);
  if (rig.rangedAttack) out.add(rig.rangedAttack);
  if (rig.hit) out.add(rig.hit);
  if (rig.attacks[0] === 'knight_melee') out.add('knight_spin'); // Great-weapon flourish.
  return [...out];
}

const CLASS_RIGS: Record<ClassArchetype, HeroRig> = {
  warrior: {
    idle: 'knight_idle', run: 'knight_run',
    attacks: ['knight_melee', 'knight_melee2'], rangedAttack: 'knight_cast',
    hit: 'knight_hit', death: 'knight_die',
    scale: 0.92, anchorY: 0.8, ownShadow: false, equipmentTint: true,
  },
  // SCALE NORMALIZATION (it.34, measured painted heights): knight idle
  // paints 58u × 0.92 ≈ 53u — the accepted hero/mob baseline (big-pack
  // mobs ≈ 55u; bosses hold 128–134u = 2.4–2.5× by design). Every hero
  // scale below lands its painted height on that same ≈53u target:
  // mage 111u×0.48, rogue 112u×0.48, ranger 167u×0.32.
  mage: {
    idle: 'mage_idle', run: 'mage_walk',
    attacks: ['mage_cast'], rangedAttack: 'mage_cast', death: 'mage_death',
    scale: 0.48, anchorY: 0.8, ownShadow: true, equipmentTint: false,
  },
  ranger: {
    idle: 'ranger_idle', run: 'ranger_run',
    attacks: ['ranger_attack'], rangedAttack: 'ranger_attack',
    hit: 'ranger_hit', death: 'ranger_death',
    scale: 0.32, anchorY: 0.72, ownShadow: true, equipmentTint: false,
  },
  rogue: {
    // It.33: the dual-dagger hooded shadow (big-pack paperdoll composite)
    // — a fully distinct silhouette from the plate warrior.
    idle: 'rogue_idle', run: 'rogue_run',
    attacks: ['rogue_attack'], death: 'rogue_death',
    scale: 0.48, anchorY: 0.8, ownShadow: true, equipmentTint: false,
  },
};

/** Paperdoll layer draw order, back to front. */
const PAPERDOLL_ORDER: readonly EquipmentSlot[] = ['cloak', 'legs', 'torso', 'head', 'offHand', 'mainHand', 'ring'];

/** Ticks the damage flash lasts. */
const FLASH_TICKS = 8;
/** Render frames the slash arc stays visible after a strike. */
const SLASH_FRAMES = 11;
// Swing/draw animation timing comes from `weaponProfile` (WEAPON_TIMING in
// the catalog) — the same numbers the CombatSystem simulates with.

export class Player extends Entity {
  readonly archetype: ClassArchetype;
  /** Equipped itemIds by slot (simulation state — serialized). */
  private readonly equipped = new Map<EquipmentSlot, string>();
  /** Unequipped itemIds (simulation state — serialized). */
  readonly backpack: string[] = [];
  private readonly paperdollLayers = new Map<EquipmentSlot, Container>();
  private readonly body: Sprite;
  private readonly slash: Sprite;
  private readonly shadow: Sprite;
  /** All body parts that animate together (body + paperdoll), above the shadow. */
  private readonly rig: Container;

  // Visual-feedback state (render-only; never read by game logic).
  private bobPhase = 0;
  private breathPhase = 0;
  private lastHopIndex = 0;
  private moving = false;
  private flashTicks = 0;
  private slashFrames = 0;
  private lastSwingResult: 'hit' | 'crit' | 'miss' = 'miss';

  /** Step hook (dust puffs) — render-side, wired by main. */
  onStep: ((x: number, y: number) => void) | null = null;

  /** Frost debuff: ticks of slowed movement (Frost Warden's blows). */
  slowTicks = 0;
  /** FROST-TOUCHED aura (it.53): −25 % move and attack speed while inside it. */
  chillTicks = 0;

  applySlow(ticks: number): void {
    this.slowTicks = Math.max(this.slowTicks, ticks);
    this.buffMax.slow = Math.max(this.buffMax.slow, this.slowTicks);
  }

  // Hero sprite mode (external art per class, it.32) — render-only state.
  private useKnight = false;
  private heroRig: HeroRig = CLASS_RIGS.warrior;
  private rigScale = 1;
  /** Render-side wall clock for time-based idle pacing (never sim-read). */
  private idleClock = 0;
  private lastSyncTime = 0;
  /** Light direction at the hero's tile (drives the grounded shadow). */
  private shadowLight: LightDir = { x: 0, y: 0, k: 0 };

  /** Scene light direction for the dynamic floor shadow (wired by main). */
  setShadowLight(dir: LightDir): void {
    this.shadowLight = dir;
  }

  /** The rig's live body scale (paperdoll previews, corpses). */
  get bodyScale(): number {
    return this.rigScale;
  }

  // ---- Skill resource + timed buffs (it.32, simulation state) ----
  resource = 100;
  resourceMax = 100;
  private resourceRegen = 0.05;
  /** War Cry / Arcane Intellect: damage multiplier while ticks remain. */
  dmgBuffTicks = 0;
  dmgBuffMult = 1;
  /** Stone Skin: fraction of incoming damage absorbed while ticks remain. */
  drTicks = 0;
  drFrac = 0;
  /** Shadow Step haste. */
  hasteTicks = 0;
  hasteMult = 1;
  /** Vanish: perfect evasion + enemies cannot see you. */
  stealthTicks = 0;
  /** Poison Blade: melee hits coat targets while ticks remain. */
  poisonBladeTicks = 0;
  /** Buff durations at cast (it.48): the HUD rings count down against these. */
  readonly buffMax = { dmg: 0, dr: 0, haste: 0, stealth: 0, poison: 0, slow: 0, chill: 30 };
  /** Every coin ever scooped this run (it.48 records board). */
  goldCollected = 0;

  /** The live timed effects (it.48 HUD): id, label, glyph/icon, ticks left and the cast length. */
  activeBuffs(): Array<{ id: string; name: string; icon: string | null; glyph: string; ticks: number; max: number; debuff: boolean }> {
    const out: Array<{ id: string; name: string; icon: string | null; glyph: string; ticks: number; max: number; debuff: boolean }> = [];
    const push = (id: string, name: string, icon: string | null, glyph: string, ticks: number, max: number, debuff = false): void => {
      if (ticks > 0) out.push({ id, name, icon, glyph, ticks, max: Math.max(max, ticks), debuff });
    };
    push('dmg', this.archetype === 'mage' ? 'Arcane Intellect' : 'War Cry', this.archetype === 'mage' ? 'intellect' : 'warcry', '♜', this.dmgBuffTicks, this.buffMax.dmg);
    push('dr', 'Stone Skin', 'stoneskin', '⛨', this.drTicks, this.buffMax.dr);
    push('haste', 'Haste', 'shadowstep', '➟', this.hasteTicks, this.buffMax.haste);
    push('stealth', 'Vanished', 'vanish', '◍', this.stealthTicks, this.buffMax.stealth);
    push('poison', 'Poison Blade', 'poison', '☠', this.poisonBladeTicks, this.buffMax.poison);
    push('slow', 'Frostbitten', null, '❄', this.slowTicks, this.buffMax.slow, true);
    push('chill', 'Frost-touched', null, '✧', this.chillTicks, this.buffMax.chill, true);
    return out;
  }

  // ---- Progression (it.41): skill points, learned skills, the hotbar ----
  /** Unspent skill points (1 at birth, +1 per level). */
  skillPoints = 1;
  readonly unlockedSkills = new Set<string>();
  /** Hotbar 1–4: learned skill ids (null = empty). */
  readonly loadout: Array<string | null> = [null, null, null, null];
  readonly passives = new Set<string>();

  /**
   * Sum of one bonus across learned passives AND worn gear (it.42; it.78:
   * the affix levers — crit, attack speed, cooldown reduction, resistance,
   * health regrowth, max resource — and a mythic's granted passive).
   */
  passiveBonus(key: 'armor' | 'dmg' | 'regen' | 'speed' | 'dodge' | 'hp' | 'crit' | 'attackSpeed' | 'cdr' | 'resist' | 'hpRegen' | 'resource'): number {
    let total = 0;
    const fromPassive = (id: string): number => (PASSIVE_BY_ID[id]?.effect as Record<string, number | undefined> | undefined)?.[key] ?? 0;
    for (const id of this.passives) total += fromPassive(id);
    for (const id of this.equipped.values()) {
      const def = itemDef(id);
      if (!def) continue;
      const b = def.bonus as Record<string, number | undefined> | undefined;
      if (b && key !== 'speed') total += b[key] ?? 0;
      if (def.passive) total += fromPassive(def.passive);
      if (key === 'crit' || key === 'attackSpeed' || key === 'cdr' || key === 'resist' || key === 'hpRegen' || key === 'resource') total += itemLevers(def)[key];
    }
    return total;
  }

  /** The legendary uniques worn right now (it.78). */
  get uniqueEffects(): Set<UniqueEffect> {
    const out = new Set<UniqueEffect>();
    for (const id of this.equipped.values()) {
      const u = itemDef(id)?.unique;
      if (u) out.add(u);
    }
    return out;
  }

  /** The hero's place on the power curve: the main hand's item level (it.78). */
  get powerTier(): number {
    return powerScale(itemDef(this.equipped.get('mainHand'))?.ilvl ?? 1);
  }

  /** THE WEAPON'S EFFECTS (it.80): innates and the enchantment of the held weapon. */
  get weaponEffects(): readonly Effect[] {
    return itemDef(this.equipped.get('mainHand'))?.effects ?? [];
  }

  /** Total power of a trait across the held weapon (0 = not carried). */
  traitPower(key: TraitKey): number {
    let total = 0;
    for (const fx of this.weaponEffects) if (fx.trait?.key === key) total += fx.trait.power;
    return total;
  }

  // ---- THE BELT (it.80): the draught base on Q (0) and R (1) ----
  belt: Array<string | null> = ['health_potion', 'mana_potion'];
  /** Learned enchantment recipes (it.80). */
  readonly recipes = new Set<string>();
  /** Draught cooldowns by category (it.80): 'heal' | 'resource' | 'buff' → ticks left. */
  readonly quaffCd = new Map<string, number>();

  // ---- The crafting pouch (it.78): materials never take a pack slot ----
  readonly materials = new Map<string, number>();

  addMaterial(id: string, n: number): void {
    const v = Math.max(0, (this.materials.get(id) ?? 0) + n);
    if (v === 0) this.materials.delete(id);
    else this.materials.set(id, v);
    eventBus.emit('materials:changed', {});
  }

  /** Re-derive max HP after a worn bonus changes; gains heal, losses clamp. */
  private syncHpMax(): void {
    const was = this.hpMax;
    this.hpMax = this.baseHpMax();
    if (this.hpMax > was) this.hp = Math.min(this.hpMax, this.hp + (this.hpMax - was));
    else this.hp = Math.min(this.hp, this.hpMax);
    // Intelligence widens the pool (it.78).
    this.resourceMax = Math.round(ARCHETYPES[this.archetype].resourceMax + this.passiveBonus('resource'));
    this.resource = Math.min(this.resource, this.resourceMax);
  }

  // ---- Bestiary (it.42): creatures seen and slain, persisted in the save ----
  readonly bestiary = new Map<string, { seen: number; killed: number }>();
  /** God mode (it.43): every entry reads as known while on (not saved). */
  bestiaryRevealed = false;

  noteSeen(kind: string): void {
    const rec = this.bestiary.get(kind);
    if (rec) rec.seen++;
    else this.bestiary.set(kind, { seen: 1, killed: 0 });
  }

  noteKill(kind: string): void {
    const rec = this.bestiary.get(kind);
    if (rec) rec.killed++;
    else this.bestiary.set(kind, { seen: 1, killed: 1 });
  }

  /** Max HP the sheet should have at this level with these passives. */
  baseHpMax(): number {
    // THE HERO'S CURVE (it.78): +4 a level, then 5% compound a level, so a
    // level-30 body (×4.1) stands against depth-XX blows the way its gear does.
    const cls = ARCHETYPES[this.archetype];
    return Math.round((cls.hpMax + 4 * (this.level - 1)) * Math.pow(1.05, this.level - 1)) + Math.round(this.passiveBonus('hp'));
  }

  get damageMult(): number {
    // BERSERK (it.80): a wrathful weapon bites harder while the hero bleeds.
    const berserk = this.hp < this.hpMax * 0.4 ? 0.18 * this.traitPower('berserk') : 0;
    return (this.dmgBuffTicks > 0 ? this.dmgBuffMult : 1) * (1 + this.passiveBonus('dmg') + berserk);
  }

  get damageReduction(): number {
    // Stone Skin plus every "of Warding" line (it.78), never past three quarters.
    return Math.min(0.75, (this.drTicks > 0 ? this.drFrac : 0) + this.passiveBonus('resist'));
  }

  get dodgeChance(): number {
    if (this.stealthTicks > 0) return 1; // Vanished: untouchable.
    return Math.min(0.75, ARCHETYPES[this.archetype].dodgeChance + this.passiveBonus('dodge'));
  }

  get stealthed(): boolean {
    return this.stealthTicks > 0;
  }

  get resourceName(): 'MANA' | 'STAMINA' {
    return ARCHETYPES[this.archetype].resourceName;
  }

  /** Try to pay a skill cost. Returns false (and no deduction) if short. */
  spendResource(cost: number): boolean {
    if (this.resource < cost) return false;
    this.resource -= cost;
    return true;
  }
  private animClock = 0;
  private runClock = 0;
  private hitClock = 0;
  private swingVariant = 0;
  private prevActionSeen: Entity['action'] = 'idle';
  private lastDir = 6; // Direction hysteresis: no sprite-flip jitter on diagonals.
  /** Scene light at the hero's tile (set by main each frame; keeps the
   *  knight in the SAME lighting language as the rest of the world). */
  private sceneTint = 0xffffff;

  // ---- Progression (it.22): XP levels grow HP and base damage ----
  level = 1;
  xp = 0;
  /** Gold carried (persists across floors with the player). */
  gold = 0;

  /** XP to reach the next level. Near-linear (it.23): tuned so clearing a
   *  full floor yields 2–3 levels — steady growth, no runaway spikes. */
  xpToNext(): number {
    return 140 + this.level * 8;
  }

  /**
   * Grant XP; applies any level-ups (max HP +8 each, heal 30% of max, and
   * +0.5/+0.7 min/max base damage per level via `levelDamageBonus`).
   * Returns the number of levels gained (FX/audio are the caller's job).
   * DETERMINISTIC: called synchronously from the entity:died handler.
   */
  grantXp(amount: number): number {
    this.xp += amount;
    let gained = 0;
    while (this.xp >= this.xpToNext()) {
      this.xp -= this.xpToNext();
      this.level++;
      gained++;
      this.skillPoints += 2; // Two points per level (it.44): 59 by level 30 covers every rank.
      // The hero's curve (it.78): recompute, and heal the gain.
      const grown = this.baseHpMax();
      this.hp += Math.max(0, grown - this.hpMax);
      this.hpMax = grown;
      this.hp = Math.min(this.hpMax, this.hp + Math.round(this.hpMax * 0.25));
    }
    return gained;
  }

  /**
   * CHEAT (it.40): jump straight to a level. Rebuilds the sheet the way
   * `grantXp` would have grown it (max HP +4 per level from the class
   * base), fills HP, zeroes the partial XP. Clamped to 1–30.
   */
  setLevel(target: number): void {
    const level = Math.max(1, Math.min(30, Math.round(target)));
    if (level > this.level) this.skillPoints += 2 * (level - this.level); // Levels bring points.
    this.level = level;
    this.xp = 0;
    this.hpMax = this.baseHpMax();
    this.hp = this.hpMax;
  }

  /** Flat damage grown by levels (it.23: many small levels — gentle slope). */
  get levelDamageMin(): number {
    return Math.floor((this.level - 1) * 0.25);
  }

  get levelDamageMax(): number {
    return Math.floor((this.level - 1) * 0.35);
  }

  constructor(archetype: ClassArchetype) {
    super();
    this.archetype = archetype;
    const def = ARCHETYPES[archetype];
    this.hpMax = def.hpMax;
    this.hp = def.hpMax;
    this.resourceMax = def.resourceMax;
    this.resource = def.resourceMax;
    this.resourceRegen = def.resourceRegen;
    this.heroRig = CLASS_RIGS[archetype];

    // Grounded shadow: NEVER animated with the body — it stays planted on
    // the floor while the body hops, which is what sells physical weight.
    this.shadow = new Sprite(assets.get('shadow'));
    this.shadow.anchor.set(0.5, 0.5);
    this.shadow.position.set(0, 1);
    this.container.addChild(this.shadow);

    // The rig holds every animated part; the whole rig hops/leans as one.
    this.rig = new Container();
    this.container.addChild(this.rig);

    // Base body marker, feet-anchored at the rig origin.
    const body = new Sprite(assets.get(def.markerTexture));
    body.anchor.set(0.5, 1.0);
    body.position.y = 6; // Texture canvas has a small skirt below the feet line.
    this.rig.addChild(body);
    this.body = body;

    // Pre-create empty paperdoll layers in canonical order (above the body).
    for (const slot of PAPERDOLL_ORDER) {
      const layer = new Container();
      layer.label = `paperdoll:${slot}`;
      this.rig.addChild(layer);
      this.paperdollLayers.set(slot, layer);
    }

    // The main-hand layer rotates around the weapon grip during swings.
    // Grip point (28,38) on the 36×52 overlay canvas → (10,-8) in layer space
    // (sprite is feet-anchored at (0,6)).
    const mainHand = this.paperdollLayers.get('mainHand')!;
    mainHand.pivot.set(10, -8);
    mainHand.position.set(10, -8);

    // Slash arc VFX flashed at the strike frame; tinted by the outcome.
    this.slash = new Sprite(assets.get('slash'));
    this.slash.anchor.set(0.1, 0.5);
    this.slash.visible = false;
    this.rig.addChild(this.slash);
  }

  get kind(): 'player' {
    return 'player';
  }

  /**
   * Switch the world rig to the class's external animation set (call once
   * after the SpriteLibrary loads — it.32: knight/mage/ranger/rogue). The
   * schematic paperdoll overlays hide; the warrior's HD knight also hides
   * our shadow (his sheets bake one) and tints by worn armor.
   */
  enableKnightRig(): void {
    if (!spriteLib.loaded) return;
    const rig = CLASS_RIGS[this.archetype];
    // Body fallback: a class pack that failed to load falls back to the
    // knight (never an invisible hero).
    this.heroRig = spriteLib.hasAnim(rig.idle) ? rig : CLASS_RIGS.warrior;
    this.useKnight = true;
    this.shadow.visible = this.heroRig.ownShadow;
    this.body.anchor.set(0.5, this.heroRig.anchorY);
    this.body.position.set(0, 2);
    // DATA-DRIVEN SCALE (it.36): the atlas manifest knows each idle's painted
    // height — every hero lands on HERO_HEIGHT exactly (legacy scale = fallback).
    const painted = spriteLib.paintedHeight(this.heroRig.idle);
    this.rigScale = painted > 0 ? HERO_HEIGHT / painted : this.heroRig.scale;
    this.body.scale.set(this.rigScale);
    for (const layer of this.paperdollLayers.values()) layer.visible = false;
    this.body.texture = spriteLib.frame(this.heroRig.idle, 6, 0);
  }

  /** Scene-light tint for the hero (wired from Lighting in main's render loop). */
  setSceneTint(tint: number): void {
    this.sceneTint = tint;
  }

  /** Subtle multiply tint from worn armor (equipment variety on the sprite). */
  getEquipmentTint(): number {
    let r = 255;
    let g = 255;
    let b = 255;
    for (const slot of ['head', 'torso', 'legs', 'offHand', 'cloak'] as const) {
      const id = this.equipped.get(slot);
      const def = id ? itemDef(id) : undefined;
      if (!def) continue;
      // Pull 10% toward each worn item's color — stacks into a visible cast.
      r = r * 0.9 + ((def.color >> 16) & 0xff) * 0.1;
      g = g * 0.9 + ((def.color >> 8) & 0xff) * 0.1;
      b = b * 0.9 + (def.color & 0xff) * 0.1;
    }
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  }

  /** Attack animation: the class rig's set (warrior keeps weapon flavor). */
  private attackAnim(): AnimName {
    const rig = this.heroRig;
    const profile = this.weaponProfile;
    if (profile.ranged) return rig.rangedAttack ?? rig.attacks[0];
    if (rig.attacks[0] === 'knight_melee') {
      // The knight's weapon-flavored swings (great weapons spin!).
      const id = this.getEquipped('mainHand');
      if (id === 'doombringer' || id === 'gravecleaver' || profile.kind === 'polearm') {
        return 'knight_spin';
      }
    }
    return rig.attacks[this.swingVariant % rig.attacks.length];
  }

  /** Damage feedback hook (wired to `entity:damaged` in main). */
  onDamaged(): void {
    this.flashTicks = FLASH_TICKS;
    this.body.tint = 0xff6a55;
  }

  /**
   * Flash the slash arc at the strike frame. Outcome drives the color;
   * the WEAPON drives the arc's size and heft — a katana whispers, a
   * halberd sweeps wide, a crit flares regardless.
   */
  showSlash(result: 'hit' | 'crit' | 'miss'): void {
    this.lastSwingResult = result;
    this.slashFrames = SLASH_FRAMES;
    const kind = this.weaponProfile.kind;
    const sizeByKind: Record<string, number> = { katana: 0.8, blade: 1, axe: 1.2, mace: 1.15, polearm: 1.45 };
    const base = sizeByKind[kind] ?? 1;
    if (result === 'crit') {
      this.slash.tint = 0xff6a3a;
      this.slash.scale.set(base * 1.35);
    } else if (result === 'hit') {
      // Blend the weapon's identity color into the hit arc.
      this.slash.tint = multiplyColors(0xffd9a0, this.weaponProfile.color | 0x808080);
      this.slash.scale.set(base);
    } else {
      this.slash.tint = 0x9a9aa8;
      this.slash.scale.set(base * 0.9);
    }
  }

  override update(dt: number): void {
    // Walk-bob phase advances only while actually moving this tick.
    const dx = this.pos.x - this.prevPos.x;
    const dy = this.pos.y - this.prevPos.y;
    const moved = Math.hypot(dx, dy);
    this.moving = moved > 1e-5;
    if (this.moving) {
      this.bobPhase += dt * 11;
      // Run cycle advances WITH the ground covered — no foot-sliding.
      // It.36: measured in CYCLES per tile so rigs with different frame
      // counts (knight 15, mage 11, ranger 12) all stride at the same pace.
      this.runClock += moved * HERO_CYCLES_PER_TILE;
      // Face the way we walk (drives the 8-direction sprite + mirroring).
      this.facing.x = dx / moved;
      this.facing.y = dy / moved;
    }
    this.breathPhase += dt * 2.1;
    if (this.slowTicks > 0) this.slowTicks--;
    if (this.chillTicks > 0) this.chillTicks--;
    if (this.flashTicks > 0 && --this.flashTicks === 0) this.body.tint = 0xffffff;

    // Skill economy (it.32): resource trickles back; timed buffs burn down.
    this.resource = Math.min(this.resourceMax, this.resource + this.resourceRegen * (1 + this.passiveBonus('regen')));
    // HEALTH REGROWTH (it.78): "of Regrowth" lines heal a trickle every tick.
    if (this.hp > 0 && this.hp < this.hpMax) {
      const regrow = this.passiveBonus('hpRegen');
      if (regrow > 0) this.hp = Math.min(this.hpMax, this.hp + regrow / 60);
    }
    if (this.dmgBuffTicks > 0) this.dmgBuffTicks--;
    for (const [k, v] of this.quaffCd) {
      if (v <= 1) this.quaffCd.delete(k);
      else this.quaffCd.set(k, v - 1);
    }
    if (this.drTicks > 0) this.drTicks--;
    if (this.hasteTicks > 0) this.hasteTicks--;
    if (this.stealthTicks > 0) this.stealthTicks--;
    if (this.poisonBladeTicks > 0) this.poisonBladeTicks--;
  }

  override syncRender(alpha: number): void {
    super.syncRender(alpha);
    // Render wall-clock (frame-rate independent idle pacing).
    const now = performance.now();
    const rdt = this.lastSyncTime === 0 ? 0 : Math.min(0.1, (now - this.lastSyncTime) / 1000);
    this.lastSyncTime = now;
    this.idleClock += rdt;
    this.syncShadow();

    if (this.useKnight) {
      this.syncKnight();
      this.syncSlash();
      return;
    }

    // Face left/right by mirroring the animated rig (shadow stays unmirrored).
    const screenDx = this.facing.x - this.facing.y;
    if (Math.abs(screenDx) > 0.05) {
      this.rig.scale.x = screenDx < 0 ? -1 : 1;
    }

    const mainHand = this.paperdollLayers.get('mainHand')!;
    const IMPACT_HOLD = 5; // Frozen impact frames after a landed strike.
    const profile = this.weaponProfile;
    const W = profile.windupTicks;
    const R = profile.recoverTicks;

    if (this.action === 'attack' && profile.ranged) {
      // Ranged: slow DRAW (pull back and hold tension) → snap RELEASE.
      const t = this.actionTicks;
      if (t < W) {
        const p = t / W;
        const ease = 1 - (1 - p) * (1 - p); // Fast start, settling into full draw.
        mainHand.rotation = -0.55 * ease;
        this.rig.rotation = -0.05 * ease;
        this.rig.position.set(-3 * ease, 0);
      } else if (t < W + 2) {
        const q = (t - W) / 2; // The loose: 2-tick snap forward.
        mainHand.rotation = -0.55 + 0.85 * q;
        this.rig.rotation = -0.05 + 0.09 * q;
        this.rig.position.set(-3 + 5 * q, 0);
      } else {
        const r = Math.min(1, (t - W - 2) / (R - 2));
        mainHand.rotation = 0.3 * (1 - r);
        this.rig.rotation = 0.04 * (1 - r);
        this.rig.position.set(2 * (1 - r), 0);
      }
      this.body.position.set(0, 6);
      this.body.scale.y = 1;
      this.shadow.scale.set(1);
    } else if (this.action === 'attack') {
      // Melee: anticipation → strike → (impact hold on a hit) → follow-through.
      const t = this.actionTicks;
      const landed = this.lastSwingResult !== 'miss';
      if (t < W) {
        const p = t / W;
        const ease = p * p; // Slow raise, accelerating — anticipation.
        mainHand.rotation = -1.15 * ease;
        this.rig.rotation = -0.07 * ease;
        this.rig.position.set(-2 * ease, 0);
      } else if (t < W + 3) {
        // The whip: 3 ticks of violent forward arc.
        const q = (t - W) / 3;
        mainHand.rotation = -1.15 + 1.8 * q;
        this.rig.rotation = -0.07 + 0.2 * q;
        this.rig.position.set(-2 + 8 * q, 0); // Lunge into the blow.
      } else if (landed && t < W + 3 + IMPACT_HOLD) {
        // IMPACT FRAMES: hold the extended pose dead-still — this is the
        // single biggest contributor to a "weighty" hit.
        mainHand.rotation = 0.65;
        this.rig.rotation = 0.13;
        this.rig.position.set(6, 0);
      } else {
        const start = W + 3 + (landed ? IMPACT_HOLD : 0);
        const span = Math.max(1, W + R - start);
        const r = Math.min(1, (t - start) / span);
        mainHand.rotation = 0.65 * (1 - r);
        this.rig.rotation = 0.13 * (1 - r);
        this.rig.position.set(6 * (1 - r), 0);
      }
      this.body.position.set(0, 6);
      this.body.scale.y = 1;
      this.shadow.scale.set(1);
    } else if (this.action === 'hit') {
      // Flinch recoil: knocked off-axis, weapon drops.
      mainHand.rotation = 0.25;
      this.rig.rotation = Math.sin(this.actionTicks * 1.4) * 0.14;
      this.rig.position.set(-3, 0);
      this.body.position.set(0, 6);
      this.shadow.scale.set(1);
    } else {
      // Idle / walking: a stepping HOP — the body lifts and lands with
      // squash & stretch while the shadow stays planted (and shrinks as
      // the body rises). A lean into the movement direction adds intent.
      mainHand.rotation = 0;
      this.rig.position.set(0, 0);
      const hop = this.moving ? Math.abs(Math.sin(this.bobPhase)) : 0;
      const lift = hop * 3.5;
      // +rotation tips toward local +x, which the mirror maps to the facing side.
      this.rig.rotation = this.moving ? 0.05 : 0;
      this.body.position.set(0, 6 - lift);
      if (this.moving) {
        // Stretch at the apex, squash into the landing; dust on each step.
        this.body.scale.y = 1 + hop * 0.07 - 0.025;
        const hopIndex = Math.floor(this.bobPhase / Math.PI);
        if (hopIndex !== this.lastHopIndex) {
          this.lastHopIndex = hopIndex;
          this.onStep?.(this.pos.x, this.pos.y);
        }
      } else {
        // Idle breathing: alive even while standing still.
        this.body.scale.y = 1 + Math.sin(this.breathPhase) * 0.014;
      }
      this.shadow.scale.set(1 - hop * 0.12);
    }

    this.syncSlash();
  }

  /** Class-rig sheet animation: pick anim + frame from the action state.
   *  It.32: frame counts come from each loaded animation (rigs differ). */
  private syncKnight(): void {
    // Entry transitions (render-side counters).
    if (this.action !== this.prevActionSeen) {
      if (this.action === 'attack') this.swingVariant++;
      if (this.action === 'hit') this.hitClock = 0;
      this.prevActionSeen = this.action;
    }

    const rig = this.heroRig;
    let dir = stableDir(this.facing.x, this.facing.y, this.lastDir);
    this.lastDir = dir;
    if (rig.dirOffset) dir = (dir + rig.dirOffset) % 8;
    let animName: AnimName;
    let frame: number;
    const fcOf = (name: AnimName): number => spriteLib.anim(name).frameCount;

    if (this.action === 'dead') {
      // The death anim plays out before main respawns us (PLAYER_DEATH_TICKS).
      animName = rig.death;
      const fc = fcOf(animName);
      frame = Math.min(fc - 1, Math.floor((this.actionTicks / PLAYER_DEATH_TICKS) * fc));
    } else if (this.action === 'attack') {
      const profile = this.weaponProfile;
      const total = profile.windupTicks + profile.recoverTicks;
      animName = this.attackAnim();
      const fc = fcOf(animName);
      frame = Math.min(fc - 1, Math.floor((this.actionTicks / total) * fc));
    } else if (this.action === 'hit' && rig.hit) {
      this.hitClock += 0.4;
      animName = rig.hit;
      frame = Math.min(fcOf(animName) - 1, Math.floor(this.hitClock));
    } else if (this.action === 'hit') {
      animName = rig.idle; // Rigless flinch (mage): idle + the recoil below.
      frame = 0;
    } else if (this.moving) {
      animName = rig.run;
      frame = Math.floor(this.runClock * fcOf(animName)); // Distance-coupled (see update()).
    } else {
      // IDLE PACING (it.36): time-based (frame-rate independent); short
      // 4-frame idles PING-PONG so the loop breathes instead of snapping.
      animName = rig.idle;
      frame = idleFrame(fcOf(animName), this.idleClock, 0);
    }
    void this.animClock;

    this.body.texture = spriteLib.frame(animName, dir, frame);
    // Rig transforms belong to the procedural rig; the sheets carry their own weight.
    this.rig.rotation = this.action === 'hit' && !rig.hit ? Math.sin(this.actionTicks * 1.4) * 0.1 : 0;
    this.rig.position.set(0, 0);
    this.rig.scale.x = 1;
    // Armor tint × scene light (damage flash overrides for a few ticks);
    // a frost slow washes the hero ice-blue; Vanish fades him to a shade.
    if (this.flashTicks === 0) {
      let tint = multiplyColors(rig.equipmentTint ? this.getEquipmentTint() : 0xffffff, this.sceneTint);
      if (this.slowTicks > 0) tint = multiplyColors(tint, 0x9fc4e8);
      this.body.tint = tint;
    }
    this.container.alpha = this.stealthTicks > 0 ? 0.35 : 1;
  }

  /**
   * DYNAMIC FLOOR SHADOW (it.36): the grounded ellipse stretches AWAY from
   * the dominant light and thins with distance from it — a cheap, readable
   * cue that the hero stands on lit ground (render-only).
   */
  private syncShadow(): void {
    if (!this.shadow.visible) return;
    const l = this.shadowLight;
    const stretch = 1 + l.k * 0.55;
    this.shadow.scale.set(this.shadow.scale.x < 0 ? -1 : 1, 1); // Reset before re-shaping.
    // DYNAMIC SHADOW (it.48): stretched and thrown away from the nearest torch or flame.
    this.shadow.scale.x = 1 + Math.abs(l.x) * l.k * 0.9;
    this.shadow.scale.y = 1 + Math.abs(l.y) * l.k * 0.5;
    this.shadow.position.set(l.x * 12 * l.k, 1 + l.y * 5 * l.k);
    this.shadow.alpha = 0.6 + 0.4 * Math.min(1, stretch - 0.6);
  }

  /** Slash arc VFX (frame-based decay; positioned ahead of the body). */
  private syncSlash(): void {
    if (this.slashFrames > 0) {
      this.slashFrames--;
      this.slash.visible = true;
      this.slash.alpha = this.slashFrames / SLASH_FRAMES;
      this.slash.position.set(14, -22);
      this.slash.rotation = 0.15;
    } else {
      this.slash.visible = false;
    }
  }

  get speedMult(): number {
    let base = ARCHETYPES[this.archetype].speedMult * (1 + this.passiveBonus('speed') + 0.08 * this.traitPower('swift'));
    if (this.hasteTicks > 0) base *= this.hasteMult;
    if (this.chillTicks > 0) base *= 0.75; // Frost-touched aura (it.53).
    return this.slowTicks > 0 ? base * 0.55 : base;
  }

  // ---- Inventory & equipment (mutate ONLY via InputQueue commands) ----

  /** Swing damage roll range: the equipped weapon's, or bare fists (1–3). */
  get weaponDamage(): { min: number; max: number } {
    const p = this.weaponProfile;
    return { min: p.minDamage, max: p.maxDamage };
  }

  /** Full weapon behavior profile (combat timing + range + character).
   *  It.32: unarmed heroes fight with their CLASS weapon (mage arcane
   *  wand, ranger bow, rogue fast blades); class crit/attack-speed apply. */
  get weaponProfile(): WeaponProfile {
    const cls = ARCHETYPES[this.archetype];
    const id = this.equipped.get('mainHand');
    const def = id ? itemDef(id) : undefined;
    const kind: WeaponKind = def?.weaponKind ?? cls.defaultWeapon;
    const timing = WEAPON_TIMING[kind];
    const family = WEAPON_FAMILY[kind];
    return {
      kind,
      ranged: kind === 'bow' || kind === 'wand',
      range: (def?.range ?? family.range) + (def?.reachBonus ?? 0),
      // COMBAT ACCELERATION (it.53): 25 % faster swings, recovery trimmed a further 15 % for chaining.
      // Agility and "of Haste" lines (it.78) trim both halves of the swing, at most by half.
      // The shape's own pace (it.80) and every haste line, at most half the swing.
      windupTicks: Math.max(5, Math.round((timing.windup * cls.attackSpeedMult * (1 - Math.min(0.5, this.passiveBonus('attackSpeed')))) / (COMBAT_SPEED * (def?.speedMult ?? 1)))),
      recoverTicks: Math.max(4, Math.round((timing.recover * cls.attackSpeedMult * 0.85 * (1 - Math.min(0.5, this.passiveBonus('attackSpeed')))) / (COMBAT_SPEED * (def?.speedMult ?? 1)))),
      // THE HERO'S HAND (it.80): +2% weapon damage a level — a level-30 arm swings 58% harder.
      minDamage: Math.round(((def?.minDamage ?? cls.baseDamage.min) + this.levelDamageMin) * (1 + 0.02 * (this.level - 1))),
      maxDamage: Math.round(((def?.maxDamage ?? cls.baseDamage.max) + this.levelDamageMax) * (1 + 0.02 * (this.level - 1))),
      critChance: Math.min(0.75, family.critChance + cls.critBonus + this.passiveBonus('crit') + (def?.critBonus ?? 0)),
      stuns: family.stuns,
      color: def?.color ?? 0xffcf90,
    };
  }

  /** Total flat damage reduction: class body + all worn armor. */
  override get armor(): number {
    let total = ARCHETYPES[this.archetype].armorBase + this.passiveBonus('armor');
    for (const id of this.equipped.values()) total += itemDef(id)?.armor ?? 0;
    // GUARDIAN (it.80): a warding weapon lifts every plate.
    return total * (1 + 0.12 * this.traitPower('guardian'));
  }

  getEquipped(slot: EquipmentSlot): string | null {
    return this.equipped.get(slot) ?? null;
  }

  /** Add a picked-up item to the backpack. */
  addItem(itemId: string): void {
    // Materials go to the pouch (it.78), never to a pack slot.
    const def = itemDef(itemId);
    if (def?.slot === 'material') {
      this.addMaterial(def.base ?? itemId, def.count ?? 1);
      eventBus.emit('inventory:changed', {});
      return;
    }
    this.backpack.push(itemId);
    eventBus.emit('inventory:changed', {});
  }

  /** Equip a backpack item into its slot; the displaced item returns to the pack. */
  equipFromBackpack(index: number): void {
    const itemId = this.backpack[index];
    const def = itemId ? itemDef(itemId) : undefined;
    if (!def || def.slot === 'consumable' || def.slot === 'material') return; // Potions are used, not worn.
    this.backpack.splice(index, 1);
    const previous = this.equipped.get(def.slot);
    if (previous) this.backpack.push(previous);
    this.equipped.set(def.slot, def.id);

    if (def.slot !== 'ring') {
      // Instant paperdoll update: overlay texture for the slot, item-colored.
      const overlay = new Sprite(assets.get(overlayTextureFor(def)));
      overlay.anchor.set(0.5, 1.0);
      overlay.position.y = 6; // Matches the body sprite's feet offset.
      overlay.tint = def.color;
      this.setEquipmentVisual(def.slot, overlay);
    }
    this.syncHpMax();
    eventBus.emit('inventory:changed', {});
  }

  unequip(slot: EquipmentSlot): void {
    const itemId = this.equipped.get(slot);
    if (!itemId) return;
    this.equipped.delete(slot);
    this.backpack.push(itemId);
    this.syncHpMax();
    this.paperdollLayers.get(slot)?.removeChildren();
    eventBus.emit('inventory:changed', {});
  }

  /** Replace the visual content of one paperdoll layer. */
  setEquipmentVisual(slot: EquipmentSlot, visual: ContainerChild): void {
    const layer = this.paperdollLayers.get(slot);
    if (!layer) throw new Error(`[Player] Unknown paperdoll slot: ${slot}`);
    layer.removeChildren();
    layer.addChild(visual);
  }

  override serialize(): EntitySnapshot {
    return {
      ...super.serialize(),
      archetype: this.archetype,
      equipment: [...this.equipped.entries()].map(([slot, itemId]) => ({ slot, itemId })),
      backpack: [...this.backpack],
    };
  }
}
