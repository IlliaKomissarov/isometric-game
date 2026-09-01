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
import { ITEMS, overlayTextureFor, WEAPON_FAMILY, WEAPON_TIMING, type WeaponKind } from '@/items/catalog';
import type { ClassArchetype, EntitySnapshot, EquipmentSlot } from '@/network/Serialization';
import { spriteLib, stableDir, type AnimName } from '@/render/SpriteLibrary';
import { multiplyColors } from '@/utils/color';
import { Entity } from './Entity';

/** Ticks the knight's death animation plays before respawn (main drives it). */
export const PLAYER_DEATH_TICKS = 80;

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

/** Archetype base stats — tuning surface for the balance sub-task. */
export interface ArchetypeDef {
  hpMax: number;
  /** Movement speed multiplier applied on top of PLAYER_SPEED. */
  speedMult: number;
  markerTexture: string;
}

export const ARCHETYPES: Record<ClassArchetype, ArchetypeDef> = {
  warrior: { hpMax: 140, speedMult: 0.95, markerTexture: 'marker_warrior' },
  mage: { hpMax: 80, speedMult: 1.0, markerTexture: 'marker_mage' },
  ranger: { hpMax: 100, speedMult: 1.1, markerTexture: 'marker_ranger' },
  rogue: { hpMax: 90, speedMult: 1.15, markerTexture: 'marker_rogue' },
};

/** Paperdoll layer draw order, back to front. */
const PAPERDOLL_ORDER: readonly EquipmentSlot[] = ['cloak', 'legs', 'torso', 'head', 'offHand', 'mainHand'];

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

  applySlow(ticks: number): void {
    this.slowTicks = Math.max(this.slowTicks, ticks);
  }

  // Knight sprite mode (external HD art) — render-only state.
  private useKnight = false;
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
      this.hpMax += 4;
      this.hp = Math.min(this.hpMax, this.hp + Math.round(this.hpMax * 0.25));
    }
    return gained;
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
   * Switch the world rig to the HD Knight sheets (call once after the
   * SpriteLibrary loads). The knight has baked shadows and a modeled
   * sword/shield, so our shadow sprite and world paperdoll overlays hide;
   * equipment shows through armor TINTS + weapon-specific attack anims
   * (and the schematic paperdoll stays in the inventory panel).
   */
  enableKnightRig(): void {
    if (!spriteLib.loaded) return;
    this.useKnight = true;
    this.shadow.visible = false;
    this.body.anchor.set(0.5, 0.8);
    this.body.position.set(0, 2);
    this.body.scale.set(0.92);
    for (const layer of this.paperdollLayers.values()) layer.visible = false;
    this.body.texture = spriteLib.frame('knight_idle', 6, 0);
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
      const def = id ? ITEMS[id] : undefined;
      if (!def) continue;
      // Pull 10% toward each worn item's color — stacks into a visible cast.
      r = r * 0.9 + ((def.color >> 16) & 0xff) * 0.1;
      g = g * 0.9 + ((def.color >> 8) & 0xff) * 0.1;
      b = b * 0.9 + (def.color & 0xff) * 0.1;
    }
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  }

  /** Attack animation for the wielded weapon (great weapons spin!). */
  private attackAnim(): AnimName {
    const profile = this.weaponProfile;
    if (profile.ranged) return 'knight_cast';
    const id = this.getEquipped('mainHand');
    if (id === 'doombringer' || id === 'gravecleaver' || profile.kind === 'polearm') {
      return 'knight_spin'; // Sweeping arcs for the big reach/rare cleavers.
    }
    return this.swingVariant % 2 === 0 ? 'knight_melee' : 'knight_melee2';
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
      // 15 frames ≈ 3 tiles of travel: a grounded, deliberate cadence.
      this.runClock += moved * 5;
      // Face the way we walk (drives the 8-direction sprite + mirroring).
      this.facing.x = dx / moved;
      this.facing.y = dy / moved;
    }
    this.breathPhase += dt * 2.1;
    if (this.slowTicks > 0) this.slowTicks--;
    if (this.flashTicks > 0 && --this.flashTicks === 0) this.body.tint = 0xffffff;
  }

  override syncRender(alpha: number): void {
    super.syncRender(alpha);

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

  /** HD knight sheet animation: pick anim + frame from the action state. */
  private syncKnight(): void {
    // Entry transitions (render-side counters).
    if (this.action !== this.prevActionSeen) {
      if (this.action === 'attack') this.swingVariant++;
      if (this.action === 'hit') this.hitClock = 0;
      this.prevActionSeen = this.action;
    }

    const dir = stableDir(this.facing.x, this.facing.y, this.lastDir);
    this.lastDir = dir;
    let animName: AnimName;
    let frame: number;

    if (this.action === 'dead') {
      // The Die sheet plays out before main respawns us (PLAYER_DEATH_TICKS).
      animName = 'knight_die';
      frame = Math.min(14, Math.floor((this.actionTicks / PLAYER_DEATH_TICKS) * 15));
    } else if (this.action === 'attack') {
      const profile = this.weaponProfile;
      const total = profile.windupTicks + profile.recoverTicks;
      animName = this.attackAnim();
      frame = Math.min(14, Math.floor((this.actionTicks / total) * 15));
    } else if (this.action === 'hit') {
      this.hitClock += 0.4;
      animName = 'knight_hit';
      frame = Math.min(14, Math.floor(this.hitClock));
    } else if (this.moving) {
      animName = 'knight_run';
      frame = Math.floor(this.runClock); // Distance-coupled (see update()).
    } else {
      this.animClock += 0.12; // Slow, breathing idle — deliberate weight.
      animName = 'knight_idle';
      frame = Math.floor(this.animClock);
    }

    this.body.texture = spriteLib.frame(animName, dir, frame);
    // Rig transforms belong to the procedural rig; the sheets carry their own weight.
    this.rig.rotation = 0;
    this.rig.position.set(0, 0);
    this.rig.scale.x = 1;
    // Armor tint × scene light (damage flash overrides for a few ticks);
    // a frost slow washes the knight ice-blue.
    if (this.flashTicks === 0) {
      let tint = multiplyColors(this.getEquipmentTint(), this.sceneTint);
      if (this.slowTicks > 0) tint = multiplyColors(tint, 0x9fc4e8);
      this.body.tint = tint;
    }
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
    const base = ARCHETYPES[this.archetype].speedMult;
    return this.slowTicks > 0 ? base * 0.55 : base;
  }

  // ---- Inventory & equipment (mutate ONLY via InputQueue commands) ----

  /** Swing damage roll range: the equipped weapon's, or bare fists (1–3). */
  get weaponDamage(): { min: number; max: number } {
    const p = this.weaponProfile;
    return { min: p.minDamage, max: p.maxDamage };
  }

  /** Full weapon behavior profile (combat timing + range + character). */
  get weaponProfile(): WeaponProfile {
    const id = this.equipped.get('mainHand');
    const def = id ? ITEMS[id] : undefined;
    const kind: WeaponKind = def?.weaponKind ?? 'blade';
    const timing = WEAPON_TIMING[kind];
    const family = WEAPON_FAMILY[kind];
    return {
      kind,
      ranged: kind === 'bow' || kind === 'wand',
      range: def?.range ?? family.range,
      windupTicks: timing.windup,
      recoverTicks: timing.recover,
      minDamage: (def?.minDamage ?? 1) + this.levelDamageMin,
      maxDamage: (def?.maxDamage ?? 3) + this.levelDamageMax,
      critChance: family.critChance,
      stuns: family.stuns,
      color: def?.color ?? 0xffcf90,
    };
  }

  /** Total flat damage reduction from all worn armor. */
  override get armor(): number {
    let total = 0;
    for (const id of this.equipped.values()) total += ITEMS[id]?.armor ?? 0;
    return total;
  }

  getEquipped(slot: EquipmentSlot): string | null {
    return this.equipped.get(slot) ?? null;
  }

  /** Add a picked-up item to the backpack. */
  addItem(itemId: string): void {
    this.backpack.push(itemId);
    eventBus.emit('inventory:changed', {});
  }

  /** Equip a backpack item into its slot; the displaced item returns to the pack. */
  equipFromBackpack(index: number): void {
    const itemId = this.backpack[index];
    const def = itemId ? ITEMS[itemId] : undefined;
    if (!def) return;
    this.backpack.splice(index, 1);
    const previous = this.equipped.get(def.slot);
    if (previous) this.backpack.push(previous);
    this.equipped.set(def.slot, def.id);

    // Instant paperdoll update: overlay texture for the slot, item-colored.
    const overlay = new Sprite(assets.get(overlayTextureFor(def)));
    overlay.anchor.set(0.5, 1.0);
    overlay.position.y = 6; // Matches the body sprite's feet offset.
    overlay.tint = def.color;
    this.setEquipmentVisual(def.slot, overlay);
    eventBus.emit('inventory:changed', {});
  }

  unequip(slot: EquipmentSlot): void {
    const itemId = this.equipped.get(slot);
    if (!itemId) return;
    this.equipped.delete(slot);
    this.backpack.push(itemId);
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
