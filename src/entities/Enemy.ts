/**
 * @module entities/Enemy
 * Enemy entities: three archetypes with Diablo-style animated combat.
 *
 *   fallen — small, quick pack demon; cowardly: flees when badly hurt.
 *   zombie — slow, brutal, barely staggerable (short hit recovery).
 *   archer — skeletal bowman: keeps distance, kites, looses real arrows.
 *
 * Combat model (matches systems/Combat): attacks are WINDUP → strike frame
 * → RECOVER actions. The windup is a visible telegraph (body rears back);
 * the strike frame calls into CombatSystem/Projectiles where range is
 * re-checked — step away during the windup and the blow whiffs.
 * Hit recovery ('hit' action) interrupts everything, including windups.
 * Death plays a topple-and-fade animation before the pool reclaims the
 * body and leaves a corpse stain.
 *
 * Simulation gates on the sim-owned `spawned` flag — NEVER on
 * `container.visible` (render-owned; see development_log 2026-08-31).
 */

import { Graphics, Sprite, Text } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { PLAYER_SPEED } from '@/core/config';
import { eventBus } from '@/core/EventBus';
import { spriteLib, stableDir, type AnimName } from '@/render/SpriteLibrary';
import { multiplyColors } from '@/utils/color';
import type { EntitySnapshot } from '@/network/Serialization';
import { hasLineOfSight } from '@/utils/los';
import { tileCenter, worldToTile } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';
import { canStandAt, moveWithCollision, type WalkableFn } from '@/systems/Collision';
import type { Pathfinder } from '@/systems/Pathfinding';
import { Entity } from './Entity';

export type EnemyKind =
  | 'fallen'
  | 'zombie'
  | 'archer'
  | 'skeleton'
  | 'guard'
  | 'wolf'
  | 'lizard'
  | 'ahoul'
  | 'shaman'
  | 'skelMage'
  | 'graveGuard'
  | 'boss'
  | 'bossFrost'
  | 'bossEmber'
  | 'bossHollow'
  | 'bossHollowKnight'
  | 'bossHollowLich';

export interface EnemyTypeDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  minDamage: number;
  maxDamage: number;
  toHit: number;
  /** Multiplier on PLAYER_SPEED while chasing/fleeing. */
  speedMult: number;
  windupTicks: number;
  recoverTicks: number;
  /** Melee reach at the strike frame (0 = ranged only). */
  reach: number;
  hitRecoveryTicks: number;
  markerTexture: string;
  /** Flee when hp falls below this fraction (melee cowards). */
  fleeBelowFrac?: number;
  /** Ranged behavior (archers). */
  ranged?: { range: number; kiteMin: number };
  /**
   * External sprite animations — overrides the marker. `tint` is the
   * PERMANENT identity color multiplied under the scene light (palette-
   * disciplined variants). `stride` = animation frames advanced per tile of
   * movement (couples the walk cycle to ground speed — no foot-sliding).
   * `attack`/`hitAnim` are optional FULL animation sheets (knight-based
   * enemies); mobs without them play the animated walk-lunge telegraph.
   */
  sprite?: {
    walk: AnimName;
    idle?: AnimName;
    death: AnimName;
    attack?: AnimName;
    hitAnim?: AnimName;
    anchorY: number;
    scale: number;
    tint: number;
    stride: number;
    /** The pack has no baked shadow — show our procedural one. */
    ownShadow?: boolean;
  };
  /** Boss/elite mechanics. */
  hitEffect?: 'slow';
  projectile?: 'arrow' | 'bolt';
  summons?: boolean;
  /**
   * Multi-phase final boss chain (it.30): when THIS form's hp pool empties,
   * the boss does not die — it plays this form's full death animation, then
   * the named next form rises (reversed death anim) with its OWN fresh
   * 100% hp pool. The chain ends at a form with no nextPhase.
   */
  nextPhase?: EnemyKind;
}

export const ENEMY_TYPES: Record<EnemyKind, EnemyTypeDef> = {
  fallen: {
    kind: 'fallen',
    name: 'Ember Wretch',
    hp: 26,
    minDamage: 3,
    maxDamage: 6,
    toHit: 0.65,
    speedMult: 0.8,
    windupTicks: 24,
    recoverTicks: 30,
    reach: 1.3,
    hitRecoveryTicks: 24,
    markerTexture: 'marker_fallen',
    fleeBelowFrac: 0.3,
    // ZERO-TOLERANCE PURGE (it.11): the static-attack LoP skeletons are gone.
    // Every mob is a knight-sheet variant — full attack/hit/death animation.
    sprite: {
      walk: 'knight_run',
      idle: 'knight_idle',
      death: 'knight_die',
      attack: 'knight_melee2',
      hitAnim: 'knight_hit',
      anchorY: 0.8,
      scale: 0.68,
      tint: 0xd08858,
      stride: 4.5,
    },
  },
  zombie: {
    kind: 'zombie',
    name: 'Rotting Ghoul',
    hp: 90,
    minDamage: 9,
    maxDamage: 16,
    toHit: 0.72,
    speedMult: 0.4,
    windupTicks: 44,
    recoverTicks: 38,
    reach: 1.4,
    hitRecoveryTicks: 8,
    markerTexture: 'marker_zombie',
    // The DEDICATED zombie pack: real walk/idle/attack/dying cinematics.
    sprite: {
      walk: 'zombie_walk',
      idle: 'zombie_idle',
      death: 'zombie_death',
      attack: 'zombie_attack',
      anchorY: 0.78,
      scale: 0.26,
      tint: 0xffffff,
      stride: 4,
    },
  },
  skeleton: {
    kind: 'skeleton',
    name: 'Risen Blade',
    hp: 38,
    minDamage: 5,
    maxDamage: 9,
    toHit: 0.68,
    speedMult: 0.62,
    windupTicks: 30,
    recoverTicks: 30,
    reach: 1.3,
    hitRecoveryTicks: 18,
    markerTexture: 'marker_archer', // Fallback if the sprite pack failed to load.
    // It.25: the Risen Blade finally wears REAL BONES — the big-pack
    // SkeletonWarrior1 (8-cam full move set) replaces the knight variant.
    sprite: {
      walk: 'skelw_run',
      idle: 'skelw_idle',
      death: 'skelw_death',
      attack: 'skelw_attack',
      anchorY: 0.8,
      scale: 0.62,
      tint: 0xffffff,
      stride: 4.2,
      ownShadow: true,
    },
  },
  ahoul: {
    kind: 'ahoul',
    name: 'Ahoul Ghast',
    hp: 34,
    minDamage: 5,
    maxDamage: 9,
    toHit: 0.7,
    speedMult: 0.78, // Fast, lean flesh-eater.
    windupTicks: 24,
    recoverTicks: 28,
    reach: 1.3,
    hitRecoveryTicks: 16,
    markerTexture: 'marker_fallen',
    fleeBelowFrac: 0.2,
    sprite: {
      walk: 'ahoul_run',
      idle: 'ahoul_idle',
      death: 'ahoul_death',
      attack: 'ahoul_attack',
      anchorY: 0.8,
      scale: 0.62,
      tint: 0xd8ddc8, // Grave-pale.
      stride: 4.4,
      ownShadow: true,
    },
  },
  shaman: {
    kind: 'shaman',
    name: 'Blood Shaman',
    hp: 40,
    minDamage: 6,
    maxDamage: 11,
    toHit: 0.72,
    speedMult: 0.5,
    windupTicks: 40, // A long, readable ritual cast.
    recoverTicks: 36,
    reach: 0,
    hitRecoveryTicks: 20,
    markerTexture: 'marker_archer',
    ranged: { range: 6, kiteMin: 3 },
    projectile: 'bolt',
    sprite: {
      walk: 'shaman_walk',
      idle: 'shaman_idle',
      death: 'shaman_death',
      attack: 'shaman_cast',
      anchorY: 0.8,
      scale: 0.62,
      tint: 0xffffff,
      stride: 4,
      ownShadow: true,
    },
  },
  graveGuard: {
    kind: 'graveGuard',
    name: 'Grave Guard',
    hp: 58,
    minDamage: 7,
    maxDamage: 12,
    toHit: 0.72,
    speedMult: 0.55,
    windupTicks: 32,
    recoverTicks: 32,
    reach: 1.4,
    hitRecoveryTicks: 12, // Shield-braced: hard to stagger.
    markerTexture: 'marker_archer',
    // It.26: the shield-bearing SkeletonWarrior7 (big pack, 8-cam set).
    sprite: {
      walk: 'grave_run',
      idle: 'grave_idle',
      death: 'grave_death',
      attack: 'grave_attack',
      anchorY: 0.8,
      scale: 0.62,
      tint: 0xffffff,
      stride: 4.2,
      ownShadow: true,
    },
  },
  skelMage: {
    kind: 'skelMage',
    name: 'Marrow Warlock',
    hp: 32,
    minDamage: 7,
    maxDamage: 13,
    toHit: 0.74,
    speedMult: 0.48,
    windupTicks: 42,
    recoverTicks: 38,
    reach: 0,
    hitRecoveryTicks: 20,
    markerTexture: 'marker_archer',
    ranged: { range: 6.5, kiteMin: 3.2 },
    projectile: 'bolt',
    sprite: {
      walk: 'skelm_walk',
      idle: 'skelm_idle',
      death: 'skelm_death',
      attack: 'skelm_cast',
      anchorY: 0.8,
      scale: 0.62,
      tint: 0xffffff,
      stride: 4,
      ownShadow: true,
    },
  },
  boss: {
    kind: 'boss',
    name: 'The Tomb Warden',
    hp: 420,
    minDamage: 16,
    maxDamage: 26,
    toHit: 0.78,
    speedMult: 0.5,
    windupTicks: 54, // Enormous, readable telegraphs — dodge or be broken.
    recoverTicks: 44,
    reach: 1.7,
    hitRecoveryTicks: 0, // Unstaggerable: a wall of dead muscle.
    markerTexture: 'marker_zombie',
    // It.25: MITHRAS — the big-pack minotaur warlord. No more knight boss.
    sprite: {
      walk: 'mithras_walk',
      idle: 'mithras_idle',
      death: 'mithras_death',
      attack: 'mithras_attack',
      anchorY: 0.8,
      scale: 1.35,
      tint: 0xc8a090, // Blood-bronze.
      stride: 3.2,
      ownShadow: true,
    },
  },
  archer: {
    kind: 'archer',
    name: 'Dread Archer',
    hp: 34,
    minDamage: 5,
    maxDamage: 9,
    toHit: 0.72,
    speedMult: 0.55,
    windupTicks: 36,
    recoverTicks: 34,
    reach: 0,
    hitRecoveryTicks: 18,
    markerTexture: 'marker_archer',
    ranged: { range: 6.5, kiteMin: 3.2 },
    // The dedicated ranger pack: real bow idle/run/draw-and-loose/hit/death.
    sprite: {
      walk: 'ranger_run',
      idle: 'ranger_idle',
      death: 'ranger_death',
      attack: 'ranger_attack',
      hitAnim: 'ranger_hit',
      anchorY: 0.72,
      scale: 0.36, // it.14 size normalization.
      tint: 0xffffff,
      stride: 4.2,
      ownShadow: true, // The Body sheets carry no baked shadow.
    },
  },
  guard: {
    kind: 'guard',
    name: 'Crypt Sentinel',
    hp: 55,
    minDamage: 7,
    maxDamage: 12,
    toHit: 0.7,
    speedMult: 0.58,
    windupTicks: 34,
    recoverTicks: 34,
    reach: 1.7, // A halberd outranges a sword — respect the polearm.
    hitRecoveryTicks: 14,
    markerTexture: 'marker_archer',
    // The armored halberdier from the 320x320 audit pack (full anim set).
    sprite: {
      walk: 'guard_walk',
      idle: 'guard_idle',
      death: 'guard_death',
      attack: 'guard_attack',
      hitAnim: 'guard_hit',
      anchorY: 0.72,
      scale: 0.42, // it.14: was a "tiny spearman" at 0.3 — normalized.
      tint: 0xffffff,
      stride: 4.2,
      ownShadow: true,
    },
  },
  wolf: {
    kind: 'wolf',
    name: 'Moon-Cursed Ravager',
    hp: 72,
    minDamage: 9,
    maxDamage: 15,
    toHit: 0.72,
    speedMult: 0.74, // Fast — it lopes you down.
    windupTicks: 26,
    recoverTicks: 30,
    reach: 1.5,
    hitRecoveryTicks: 10,
    markerTexture: 'marker_fallen',
    // The armored werewolf axe-berserker (x320p_Spritesheets1234 audit pack).
    sprite: {
      walk: 'wolf_run',
      idle: 'wolf_idle',
      death: 'wolf_death',
      attack: 'wolf_attack',
      hitAnim: 'wolf_hit',
      anchorY: 0.72,
      scale: 0.42,
      tint: 0xffffff,
      stride: 3.8,
      ownShadow: true,
    },
  },
  lizard: {
    kind: 'lizard',
    name: 'Ashscale Duelist',
    hp: 46,
    minDamage: 6,
    maxDamage: 11,
    toHit: 0.74,
    speedMult: 0.68,
    windupTicks: 24, // Quick, snapping scimitar cuts.
    recoverTicks: 26,
    reach: 1.35,
    hitRecoveryTicks: 14,
    markerTexture: 'marker_fallen',
    // The crested lizardman scimitar-duelist (Frames_320x320 audit pack).
    sprite: {
      walk: 'lizard_run',
      idle: 'lizard_idle',
      death: 'lizard_death',
      attack: 'lizard_attack',
      hitAnim: 'lizard_hit',
      anchorY: 0.72,
      scale: 0.4,
      tint: 0xd8ccc4, // Cooled a step toward the palette.
      stride: 4,
      ownShadow: true,
    },
  },
  bossFrost: {
    kind: 'bossFrost',
    name: 'The Frost Warden',
    hp: 520,
    minDamage: 14,
    maxDamage: 22,
    toHit: 0.78,
    speedMult: 0.58,
    windupTicks: 44,
    recoverTicks: 36,
    reach: 1.6,
    hitRecoveryTicks: 0,
    markerTexture: 'marker_zombie',
    hitEffect: 'slow', // Its blows freeze your legs — kiting gets deadly.
    // It.26: a UNIQUE body — the towering robed WIGHT (SkeletonWarrior4),
    // rimed blue. Mithras now belongs to the Tomb Warden alone.
    sprite: {
      walk: 'frost_walk',
      idle: 'frost_idle',
      death: 'frost_death',
      attack: 'frost_attack',
      anchorY: 0.8,
      scale: 1.35,
      tint: 0x9cc4ee, // Hoarfrost shroud.
      stride: 3.2,
      ownShadow: true,
    },
  },
  bossEmber: {
    kind: 'bossEmber',
    name: 'Vyrissa, the Ember Maw',
    hp: 600,
    minDamage: 13,
    maxDamage: 21,
    toHit: 0.76,
    speedMult: 0.62,
    windupTicks: 40,
    recoverTicks: 34,
    reach: 0,
    hitRecoveryTicks: 0,
    markerTexture: 'marker_zombie',
    ranged: { range: 5.5, kiteMin: 2.6 }, // A slithering fire-lancer.
    projectile: 'bolt',
    // UNIQUE BODY: the serpent spear-maiden (256x256 audit pack). Her spear
    // Attack1 set launches the bolt — the pack's FireBreath folder is a
    // DIFFERENT creature (dragon) and is PURGED (the morph glitch, it.14).
    sprite: {
      walk: 'naga_walk',
      idle: 'naga_idle',
      death: 'naga_death',
      attack: 'naga_attack',
      hitAnim: 'naga_hit',
      anchorY: 0.62,
      scale: 1.0,
      tint: 0xe0c4b4, // Cooled toward the palette — she still reads ember-warm.
      stride: 3.6,
      ownShadow: true,
    },
  },
  // === THE HOLLOW KING (it.30): three forms, three fresh hp pools, ======
  // === death-and-rebirth transitions between them (see nextPhase). ======
  bossHollow: {
    kind: 'bossHollow',
    name: 'The Hollow King',
    hp: 300, // PHASE 1 POOL (of three) — total fight ≈ the old single 650+.
    minDamage: 18,
    maxDamage: 30,
    toHit: 0.8,
    speedMult: 0.5,
    windupTicks: 56,
    recoverTicks: 46,
    reach: 1.8,
    hitRecoveryTicks: 0,
    markerTexture: 'marker_zombie',
    nextPhase: 'bossHollowKnight',
    // PHASE 1 — HEAVY MELEE FORM #1: the MASSIVE rotting colossus (the
    // dedicated zombie cinematic pack, corpse-pale). Towering, wrong.
    sprite: {
      walk: 'zombie_walk',
      idle: 'zombie_idle',
      death: 'zombie_death',
      attack: 'zombie_attack',
      anchorY: 0.78,
      scale: 0.58,
      tint: 0xb8c4a8, // Grave-pale green — reads huge and dead.
      stride: 2.6,
      ownShadow: false,
    },
  },
  bossHollowKnight: {
    kind: 'bossHollowKnight',
    name: 'The Hollow King',
    hp: 260, // PHASE 2 POOL — fresh 100% bar on rebirth.
    minDamage: 20,
    maxDamage: 32,
    toHit: 0.82,
    speedMult: 0.56,
    windupTicks: 46,
    recoverTicks: 36,
    reach: 1.8,
    hitRecoveryTicks: 0,
    markerTexture: 'marker_zombie',
    nextPhase: 'bossHollowLich',
    // PHASE 2 — HEAVY MELEE FORM #2: SkeletonWarrior10, the horned-helm
    // war-knight in full grave-armor (unused anywhere else; every anim
    // size-audited healthy). A COMPLETELY different body from the colossus.
    sprite: {
      walk: 'hollow2_walk',
      idle: 'hollow2_idle',
      death: 'hollow2_death',
      attack: 'hollow2_attack',
      anchorY: 0.8,
      scale: 1.5, // Uniform boss presence (148px pack frames vs 512 zombie).
      tint: 0xd8c8b0, // Tarnished grave-gold armor.
      stride: 3.2,
      ownShadow: true,
    },
  },
  bossHollowLich: {
    kind: 'bossHollowLich',
    name: 'The Hollow King',
    hp: 220, // PHASE 3 POOL — the last fresh bar.
    minDamage: 20,
    maxDamage: 32,
    toHit: 0.85,
    speedMult: 0.66, // Unburdened of flesh: fast, slippery kiting.
    windupTicks: 38,
    recoverTicks: 30,
    reach: 0,
    hitRecoveryTicks: 0,
    markerTexture: 'marker_zombie',
    ranged: { range: 7.0, kiteMin: 3.6 },
    projectile: 'bolt',
    // PHASE 3 — RANGED CASTER FORM #3: the SkeletonMage1 lich, boss-sized,
    // kiting and lobbing fire bolts. Scale keeps the LARGE presence.
    sprite: {
      walk: 'skelm_walk',
      idle: 'skelm_idle',
      death: 'skelm_death',
      attack: 'skelm_cast',
      anchorY: 0.8,
      scale: 1.5, // It.30: uniform LARGE across all three phases.
      tint: 0xe8e2d0, // Ancient bone, near-white against the dark.
      stride: 4,
      ownShadow: true,
    },
  },
};

/** Dependencies injected by the pool; strike resolution lives in CombatSystem. */
export interface EnemyAIDeps {
  pathfinder: Pathfinder;
  isWalkable: WalkableFn;
  isOpaque: (gx: number, gy: number) => boolean;
  getPlayerPos: () => { x: number; y: number };
  /** Resolve a melee strike frame (range re-check + rolls inside). */
  meleeStrike: (
    source: Enemy,
    minDamage: number,
    maxDamage: number,
    toHit: number,
    reach: number,
    effect?: 'slow',
  ) => void;
  /** Loose an arrow toward a world point (archers). */
  shootArrow: (source: Enemy, tx: number, ty: number, minDamage: number, maxDamage: number, toHit: number) => void;
  /** Death animation finished: release to pool, leave a corpse stain. */
  onDeathComplete: (enemy: Enemy) => void;
  /** Boss summoning hook (Hollow King) — spawn reinforcements near a point. */
  summonMinions?: (x: number, y: number) => void;
}

export type EnemyAIState = 'idle' | 'chase' | 'flee';

const AGGRO_RADIUS = 6.5;
const REPATH_TICKS = 30;
/** 4-neighbors first, then diagonals — for the wall-unstick snap. */
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const GIVE_UP_TICKS = 180;
const WAYPOINT_EPSILON = 0.1;
const FLASH_TICKS = 8;
const DEATH_TICKS = 52; // Slow, weighty collapse (8 death frames ≈ 9 fps).
/** Phase transition (it.30): full death animation of the fallen form… */
export const PHASE_DIE_TICKS = 150;
/** …then the next form rises out of it (the death anim played in reverse). */
export const PHASE_RISE_TICKS = 120;

export class Enemy extends Entity {
  aiState: EnemyAIState = 'idle';
  def: EnemyTypeDef = ENEMY_TYPES.fallen;

  /** Sim-owned lifecycle flag (never gate sim on container.visible). */
  private spawned = false;
  private damageBonus = 0;

  private readonly bobPhase = Math.random() * Math.PI * 2;
  private elapsed = 0;
  private walkPhase = 0;
  private lastDir = 6; // Direction hysteresis (render-side).
  private readonly body: Sprite;
  private readonly shadow: Sprite;
  private readonly healthBar: Graphics;
  private readonly levelText: Text;
  /** Creature level (it.23): floor N mobs are level N (rares N+1); bosses
   *  follow the fixed milestone matrix. Drives hp/damage/XP. */
  level = 1;
  private flashTicks = 0;

  private path: Array<{ x: number; y: number }> = [];
  private pathIndex = 0;
  private repathCooldown = 0;
  private losLostTicks = 0;
  private hasSummoned = false;
  /** Cornered once while fleeing → fights to the death (it.16). */
  private desperation = false;
  /** Multi-phase boss counter (it.30): which form/pool the boss is on. */
  phase = 1;
  private readonly lastGoalTile = vec2(-1, -1);
  private readonly scratchA = vec2();
  private readonly scratchB = vec2();

  constructor(private readonly ai: EnemyAIDeps) {
    super();
    // Grounded shadow — separate from the body so hops read as weight.
    this.shadow = new Sprite(assets.get('shadow'));
    this.shadow.anchor.set(0.5, 0.5);
    this.shadow.position.set(0, 1);
    this.container.addChild(this.shadow);

    this.body = new Sprite(assets.get('marker_fallen'));
    this.body.anchor.set(0.5, 1.0);
    this.body.position.y = 6;
    this.container.addChild(this.body);

    this.healthBar = new Graphics();
    this.healthBar.position.set(0, -52);
    this.healthBar.visible = false;
    this.container.addChild(this.healthBar);

    // "Lv N" plaque beside the bar (visible whenever the bar is).
    this.levelText = new Text({
      text: '',
      style: { fontFamily: 'Georgia, serif', fontSize: 8, fill: 0xcabb8a, stroke: { color: 0x0a0806, width: 2 } },
      resolution: 2,
    });
    this.levelText.anchor.set(0, 0.5);
    this.levelText.position.set(18, -49);
    this.levelText.visible = false;
    this.container.addChild(this.levelText);

    // Constructed straight into the pool: start despawned and hidden.
    this.container.visible = false;
  }

  get kind(): 'enemy' {
    return 'enemy';
  }

  /** Re-initialize a pooled instance for a type at a creature LEVEL.
   *  STRICT SCALING MATRIX (it.23): hp, damage, and XP all derive from
   *  the level — nothing else. */
  spawn(kind: EnemyKind, x: number, y: number, level: number): void {
    this.def = ENEMY_TYPES[kind];
    this.level = Math.max(1, Math.round(level));
    const scale = 1 + 0.12 * (this.level - 1);
    this.warpTo(x, y);
    this.hpMax = Math.round(this.def.hp * scale);
    this.hp = this.hpMax;
    this.damageBonus = Math.round(1.0 * (this.level - 1));
    this.levelText.text = `Lv ${this.level}`;
    this.levelText.visible = false;
    this.hitRecoveryTicks = this.def.hitRecoveryTicks;
    this.action = 'idle';
    this.actionTicks = 0;
    this.aiState = 'idle';
    this.elapsed = 0;
    this.path = [];
    this.pathIndex = 0;
    this.repathCooldown = 0;
    this.losLostTicks = 0;
    this.hasSummoned = false;
    this.desperation = false;
    this.phase = 1;
    this.lastGoalTile.x = -1;
    this.lastGoalTile.y = -1;
    this.flashTicks = 0;
    this.applyRig();
    this.body.tint = 0xffffff;
    this.body.rotation = 0;
    this.body.alpha = 1;
    this.shadow.alpha = 1;
    this.shadow.scale.set(1);
    this.walkPhase = 0;
    this.container.scale.x = 1;
    this.container.alpha = 1;
    this.healthBar.visible = false;
    this.container.visible = true;
    this.spawned = true;
  }

  despawn(): void {
    this.spawned = false;
    this.container.visible = false;
  }

  /**
   * (Re)build the visual rig from the CURRENT def: external sprite (baked
   * shadow, feet at pack registration point) vs procedural marker (feet-
   * anchored, our shadow). Called at spawn AND on a phase model swap.
   */
  private applyRig(): void {
    const sprite = this.usesSprite() ? this.def.sprite! : null;
    if (sprite) {
      this.body.texture = spriteLib.frame(sprite.walk, 6, 0);
      this.body.anchor.set(0.5, sprite.anchorY);
      this.body.position.set(0, 2);
      this.body.scale.set(sprite.scale);
      this.shadow.visible = !!sprite.ownShadow;
    } else {
      this.body.texture = assets.get(this.def.markerTexture);
      this.body.anchor.set(0.5, 1.0);
      this.body.position.set(0, 6);
      this.body.scale.set(1);
      this.shadow.visible = true;
    }
  }

  /** Damage feedback hook — wired to `entity:damaged` in main (render-side). */
  onDamaged(): void {
    this.flashTicks = FLASH_TICKS;
    this.body.tint = 0xff5544;
    this.redrawHealthBar();
  }

  /**
   * HITBOX RECALIBRATION (it.29): the click/targeting box derived from the
   * LIVE rendered body — current texture size × rig scale × anchor — in
   * unzoomed screen pixels relative to the feet point. Clicking anywhere on
   * the visible sprite (torso, head) registers; no more aiming below the
   * model. Pack frames carry transparent side padding, so width narrows to
   * the painted core.
   */
  clickBox(): { halfW: number; top: number; bottom: number } {
    const tex = this.body.texture;
    const sx = Math.abs(this.body.scale.x) || 1;
    const sy = Math.abs(this.body.scale.y) || 1;
    const h = tex.height * sy;
    const ay = this.body.anchor.y;
    const offY = this.body.position.y;
    return {
      halfW: Math.max(16, tex.width * sx * 0.3),
      top: offY - h * ay,
      bottom: Math.max(offY + h * (1 - ay), offY + 4),
    };
  }

  /** XP this creature yields — a strict function of its base hp and level. */
  xpValue(): number {
    return Math.round((this.def.hp / 6 + 3) * (1 + 0.08 * (this.level - 1)));
  }

  /** Called when hp reaches 0 (`entity:died`): start the death animation. */
  beginDeath(): void {
    this.action = 'dead';
    this.actionTicks = 0;
    this.healthBar.visible = false;
    this.levelText.visible = false;
  }

  /**
   * Phased-boss hook (it.30): when a form with a `nextPhase` runs out of
   * hp, its "death" is a TRANSITION, not a kill. Returns true when it
   * consumed the death (caller must then skip xp/loot/beginDeath).
   */
  beginPhaseTransition(): boolean {
    if (!this.def.nextPhase || this.action === 'dead' || this.action === 'transition') return false;
    this.action = 'transition';
    this.actionTicks = 0;
    this.path = [];
    this.healthBar.visible = false;
    this.levelText.visible = false;
    return true;
  }

  /**
   * Apply the composed scene-light tint (render-side, per frame). Sprite
   * variants multiply their permanent identity tint under the scene light,
   * so an Ember Fallen stays warm and a Bone Archer stays frost-pale while
   * both still sink into the torch falloff.
   */
  setLightTint(tint: number): void {
    if (this.flashTicks > 0) return;
    const identity = this.usesSprite() ? this.def.sprite!.tint : 0xffffff;
    this.body.tint = identity === 0xffffff ? tint : multiplyColors(tint, identity);
  }

  /** Effective attack timings (it.30: each phase form brings its own). */
  private get windup(): number {
    return this.def.windupTicks;
  }

  private get recover(): number {
    return this.def.recoverTicks;
  }

  override update(dt: number): void {
    if (!this.spawned) return;

    // TIGHT BOUNDS CLAMP (it.14): no matter what moved this body last tick
    // (separation shove, knockback, kite slide), it must END the tick as a
    // legal collider. A body wedged into a wall corner slips inside the
    // mesh and turns invisible — snap it back to its tile center, or to the
    // nearest walkable neighbor's center if its own tile is solid.
    if (!canStandAt(this.pos.x, this.pos.y, this.ai.isWalkable)) {
      const gx = Math.floor(this.pos.x);
      const gy = Math.floor(this.pos.y);
      if (this.ai.isWalkable(gx, gy)) {
        this.pos.x = gx + 0.5;
        this.pos.y = gy + 0.5;
      } else {
        for (const [ox, oy] of NEIGHBOR_OFFSETS) {
          if (this.ai.isWalkable(gx + ox, gy + oy)) {
            this.pos.x = gx + ox + 0.5;
            this.pos.y = gy + oy + 0.5;
            break;
          }
        }
      }
    }

    // Visual decay runs in all states.
    this.elapsed += dt;
    if (this.flashTicks > 0 && --this.flashTicks === 0) this.body.tint = 0xffffff;

    if (this.action === 'dead') {
      this.actionTicks++;
      if (this.actionTicks >= this.deathTicksTotal()) this.ai.onDeathComplete(this);
      return;
    }

    // PHASE TRANSITION (it.30): the fallen form's death anim plays out in
    // full, then the next form RISES from it (reversed death). hp stays 0
    // the whole time — dealDamage's hp<=0 guard makes the body invincible.
    if (this.action === 'transition') {
      this.actionTicks++;
      if (this.actionTicks === PHASE_DIE_TICKS) {
        // The corpse crumbles — the next form takes the body.
        this.def = ENEMY_TYPES[this.def.nextPhase!];
        this.applyRig();
        this.body.tint = 0xffffff;
      }
      if (this.actionTicks >= PHASE_DIE_TICKS + PHASE_RISE_TICKS) {
        // Reborn: a fresh, full 100% hp pool for the new phase.
        this.phase++;
        this.hpMax = Math.round(this.def.hp * (1 + 0.12 * (this.level - 1)));
        this.hp = this.hpMax;
        this.hitRecoveryTicks = this.def.hitRecoveryTicks;
        this.action = 'idle';
        this.actionTicks = 0;
        this.aiState = 'chase';
        this.path = [];
        this.redrawHealthBar();
        this.ai.summonMinions?.(this.pos.x, this.pos.y);
        eventBus.emit('boss:phase', { entityId: this.id, phase: this.phase });
      }
      return; // No thinking, no moving, no dying while between forms.
    }

    if (this.hp <= 0) return; // Died this tick; beginDeath arrives via event.

    if (this.action === 'hit') {
      if (--this.actionTicks <= 0) this.action = 'idle';
      return; // Flinching: no thinking, no moving.
    }

    const player = this.ai.getPlayerPos();
    const dx = player.x - this.pos.x;
    const dy = player.y - this.pos.y;
    const dist = Math.hypot(dx, dy);

    // Boss mechanic (Hollow King): call reinforcements once at half health.
    if (this.def.summons && !this.hasSummoned && this.hp < this.hpMax / 2 && this.aiState !== 'idle') {
      this.hasSummoned = true;
      this.ai.summonMinions?.(this.pos.x, this.pos.y);
    }

    if (this.action === 'attack') {
      this.advanceAttack(player, dist);
      return; // Rooted while swinging.
    }

    const myTile = worldToTile(this.pos.x, this.pos.y, this.scratchA);
    const playerTile = worldToTile(player.x, player.y, this.scratchB);
    const los = hasLineOfSight(myTile.x, myTile.y, playerTile.x, playerTile.y, this.ai.isOpaque);

    // Cowardice: badly hurt melee types run — unless cornered once already
    // (desperation latch): a beast with nowhere to run stops running.
    if (
      this.def.fleeBelowFrac !== undefined &&
      !this.desperation &&
      this.aiState !== 'idle' &&
      this.hp < this.hpMax * this.def.fleeBelowFrac
    ) {
      this.aiState = 'flee';
    }

    switch (this.aiState) {
      case 'idle':
        if (dist <= AGGRO_RADIUS && los) {
          this.aiState = 'chase';
          this.losLostTicks = 0;
          // Something in the dark has noticed you (growl audio hook).
          eventBus.emit('enemy:aggro', { entityId: this.id });
        }
        break;
      case 'flee':
        // It.16: at a safe distance the coward stops and stands (no more
        // blind marathon into map corners); a CORNERED flee-er (no room to
        // retreat) snaps into desperation and fights to the death instead
        // of grinding into the wall.
        if (dist > AGGRO_RADIUS + 2) {
          this.aiState = 'idle';
        } else if (!this.moveDirect(-dx, -dy, dt)) {
          this.desperation = true; // Latched: never flees again.
          this.aiState = 'chase';
        }
        break;
      case 'chase':
        this.updateChase(player, dist, los, dt, playerTile);
        break;
    }
  }

  private advanceAttack(player: { x: number; y: number }, dist: number): void {
    this.actionTicks++;
    if (this.actionTicks === this.windup) {
      // Strike frame: hand off to combat/projectiles for rolls + range check.
      if (this.def.ranged) {
        this.ai.shootArrow(
          this,
          player.x,
          player.y,
          this.def.minDamage + this.damageBonus,
          this.def.maxDamage + this.damageBonus,
          this.def.toHit,
        );
      } else {
        this.ai.meleeStrike(
          this,
          this.def.minDamage + this.damageBonus,
          this.def.maxDamage + this.damageBonus,
          this.def.toHit,
          this.def.reach + 0.15,
          this.def.hitEffect,
        );
      }
    }
    if (this.actionTicks >= this.windup + this.recover) {
      this.action = 'idle';
    }
    void dist;
  }

  private beginAttack(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy) || 1;
    this.facing.x = dx / len;
    this.facing.y = dy / len;
    this.action = 'attack';
    this.actionTicks = 0;
    this.path = [];
  }

  private updateChase(
    player: { x: number; y: number },
    dist: number,
    los: boolean,
    dt: number,
    playerTile: { x: number; y: number },
  ): void {
    this.losLostTicks = los ? 0 : this.losLostTicks + 1;
    if (this.losLostTicks > GIVE_UP_TICKS) {
      this.aiState = 'idle';
      this.path = [];
      return;
    }

    const dx = player.x - this.pos.x;
    const dy = player.y - this.pos.y;

    if (this.def.ranged) {
      const { range, kiteMin } = this.def.ranged;
      if (dist < kiteMin && los) {
        // Too close: back away — but ONLY while there is somewhere to go.
        // A cornered kiter that keeps pressing into the wall drifts onto
        // unwalkable corner tiles and vanishes from the fog gate (the
        // invisible-archer bug). If retreat produced no movement, stand
        // ground and shoot point-blank instead.
        if (this.moveDirect(-dx, -dy, dt)) return;
        this.beginAttack(dx, dy);
        return;
      }
      if (dist <= range && los) {
        this.beginAttack(dx, dy); // Draw and loose.
        return;
      }
      // Out of range or no line: close in.
    } else if (dist <= this.def.reach) {
      this.beginAttack(dx, dy);
      return;
    } else if (dist <= 2.4 && this.moveDirect(dx, dy, dt)) {
      // Close-range steering: walk straight in (A*'s no-corner-cut rule can
      // refuse the last diagonal step and deadlock just out of reach). If
      // the straight line is fully wall-blocked, fall through to A* below —
      // the doorway route.
      return;
    }

    // Throttled A* pursuit.
    if (this.repathCooldown > 0) this.repathCooldown--;
    const myTile = worldToTile(this.pos.x, this.pos.y, this.scratchA);
    const goalMoved = playerTile.x !== this.lastGoalTile.x || playerTile.y !== this.lastGoalTile.y;
    if ((this.path.length === 0 || goalMoved) && this.repathCooldown === 0) {
      const path = this.ai.pathfinder.findPath(myTile.x, myTile.y, playerTile.x, playerTile.y);
      if (path) {
        this.path = path;
        this.pathIndex = 0;
        this.lastGoalTile.x = playerTile.x;
        this.lastGoalTile.y = playerTile.y;
      }
      this.repathCooldown = REPATH_TICKS;
    }
    this.followPath(dt);
  }

  /** Straight-line locomotion with wall sliding. Returns true if any movement occurred. */
  private moveDirect(dx: number, dy: number, dt: number): boolean {
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return false;
    const step = PLAYER_SPEED * this.def.speedMult * dt;
    this.facing.x = dx / len;
    this.facing.y = dy / len;
    // Walk cycle advances WITH the ground covered — no foot-sliding.
    this.walkPhase += step * (this.def.sprite?.stride ?? 5);
    return moveWithCollision(this.pos, (dx / len) * step, (dy / len) * step, this.ai.isWalkable);
  }

  private followPath(dt: number): void {
    if (this.pathIndex >= this.path.length) return;
    const waypoint = this.path[this.pathIndex];
    const target = tileCenter(waypoint.x, waypoint.y, this.scratchA);
    const dx = target.x - this.pos.x;
    const dy = target.y - this.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= WAYPOINT_EPSILON) {
      this.pathIndex++;
      return;
    }
    const step = Math.min(PLAYER_SPEED * this.def.speedMult * dt, dist);
    this.facing.x = dx / dist;
    this.facing.y = dy / dist;
    this.walkPhase += step * (this.def.sprite?.stride ?? 5);
    moveWithCollision(this.pos, (dx / dist) * step, (dy / dist) * step, this.ai.isWalkable);
  }

  /** Bosses die slower and louder (dramatic death sequence, it.15). */
  private isBoss(): boolean {
    return this.def.kind.startsWith('boss');
  }

  /** Total ticks the death animation runs before pool reclaim. Bosses take
   *  ~4 seconds (it.17): a real victory beat, not a mob despawn. */
  deathTicksTotal(): number {
    return this.isBoss() ? 240 : DEATH_TICKS;
  }

  /** True when this enemy renders from external sprite animations. */
  private usesSprite(): boolean {
    return this.def.sprite !== undefined && spriteLib.loaded && spriteLib.hasAnim(this.def.sprite.walk);
  }

  /** Render direction (for corpse orientation at death completion). */
  get renderDir(): number {
    return this.lastDir;
  }

  override syncRender(alpha: number): void {
    super.syncRender(alpha);

    if (this.usesSprite()) {
      this.syncSpriteAnim();
      return;
    }

    // Face left/right by mirroring (screen-space x of the facing vector).
    const screenDx = this.facing.x - this.facing.y;
    if (Math.abs(screenDx) > 0.05) {
      this.container.scale.x = screenDx < 0 ? -1 : 1;
    }

    if (this.action === 'dead') {
      // Topple and fade; the pool reclaims us at the death-tick total.
      const p = Math.min(1, this.actionTicks / this.deathTicksTotal());
      this.body.rotation = p * 1.35;
      this.body.position.y = 6;
      this.container.alpha = 1 - p * 0.85;
      this.shadow.alpha = 1 - p;
      return;
    }
    this.shadow.alpha = 1;

    if (this.action === 'attack') {
      // Telegraph: rear back through the windup (dodge cue!), whip forward
      // across the strike with a lunge, then settle through recovery.
      const w = this.windup;
      if (this.actionTicks < w) {
        const p = this.actionTicks / w;
        this.body.rotation = -0.32 * p * p;
        this.body.position.set(-2 * p, 6);
      } else if (this.actionTicks < w + 4) {
        const q = (this.actionTicks - w) / 4;
        this.body.rotation = -0.32 + 0.75 * q;
        this.body.position.set(-2 + 8 * q, 6);
      } else {
        const r = (this.actionTicks - w - 4) / Math.max(1, this.recover - 4);
        this.body.rotation = 0.43 * (1 - r);
        this.body.position.set(6 * (1 - r), 6);
      }
      this.body.scale.y = 1;
      this.shadow.scale.set(1);
      return;
    }

    if (this.action === 'hit') {
      // Flinch: jitter recoil.
      this.body.rotation = Math.sin(this.actionTicks * 1.3) * 0.12;
      this.body.position.set(-2, 6);
      return;
    }

    // Free: stepping hop while moving, slow breathing while standing.
    this.body.rotation = 0;
    const moving = Math.hypot(this.pos.x - this.prevPos.x, this.pos.y - this.prevPos.y) > 1e-4;
    if (moving) {
      this.walkPhase += 0.26;
      const hop = Math.abs(Math.sin(this.walkPhase));
      this.body.position.set(0, 6 - hop * 3);
      this.body.scale.y = 1 + hop * 0.06 - 0.02;
      this.shadow.scale.set(1 - hop * 0.1);
    } else {
      this.body.position.set(0, 6);
      this.body.scale.y = 1 + Math.sin(this.elapsed * 2.2 + this.bobPhase) * 0.03;
      this.shadow.scale.set(1);
    }
  }

  /** External sprite path: 8-direction frame animation from the pack. */
  private syncSpriteAnim(): void {
    const sprite = this.def.sprite!;
    const dir = stableDir(this.facing.x, this.facing.y, this.lastDir);
    this.lastDir = dir;
    this.container.scale.x = 1; // Real directions — never mirror.

    const baseScale = sprite.scale;

    if (this.action === 'dead') {
      const fc = spriteLib.anim(sprite.death).frameCount;
      const p = Math.min(1, this.actionTicks / this.deathTicksTotal());
      if (this.isBoss()) {
        // EXTENDED BOSS DEATH — it.26 STABILITY AUDIT: the old hard tint
        // strobe read as "flickering" and the fade-to-zero left an
        // invisible body before the corpse spawned. Now the dying keeper
        // PULSES smoothly between ember tones (continuous sine mix, no
        // frame-flips) and never drops below half opacity — the corpse
        // replaces it seamlessly at reclaim.
        const animP = Math.min(1, p / 0.55);
        const frame = Math.min(fc - 1, Math.floor(animP * fc));
        this.body.texture = spriteLib.frame(sprite.death, dir, frame);
        this.body.rotation = 0;
        this.body.scale.set(baseScale);
        this.flashTicks = 2; // Holds setLightTint off during the sequence.
        if (p < 0.75) {
          const s = 0.5 + 0.5 * Math.sin(this.actionTicks * 0.12);
          const r = Math.round(0xff * (1 - s) + 0xc8 * s);
          const gch = Math.round(0xd9 * (1 - s) + 0x6a * s);
          const bch = Math.round(0xa0 * (1 - s) + 0x50 * s);
          this.body.tint = (r << 16) | (gch << 8) | bch;
        } else {
          this.body.tint = 0xfff1d8; // A last pale glow.
        }
        this.container.alpha = p > 0.9 ? Math.max(0.55, 1 - (p - 0.9) * 4.5) : 1;
        return;
      }
      // Regular mobs: the pack's death animation, then a short fade.
      const frame = Math.min(fc - 1, Math.floor(p * fc));
      this.body.texture = spriteLib.frame(sprite.death, dir, frame);
      this.body.rotation = 0;
      this.body.scale.set(baseScale);
      this.container.alpha = p > 0.8 ? 1 - (p - 0.8) * 4 : 1;
      return;
    }

    if (this.action === 'transition') {
      // DEATH-AND-REBIRTH (it.30): the fallen form's death frames play
      // forward to the last; after the def swap (sim side, at the DIE
      // boundary) the NEW form's death frames run in REVERSE — the next
      // body rises out of the grave. Ember pulse over both halves.
      const fc = spriteLib.anim(sprite.death).frameCount;
      let frame: number;
      let glow: number;
      if (this.actionTicks < PHASE_DIE_TICKS) {
        const p = this.actionTicks / PHASE_DIE_TICKS;
        frame = Math.min(fc - 1, Math.floor(p * fc));
        glow = this.actionTicks;
      } else {
        const p = (this.actionTicks - PHASE_DIE_TICKS) / PHASE_RISE_TICKS;
        frame = Math.max(0, Math.min(fc - 1, Math.floor((1 - p) * fc)));
        glow = this.actionTicks + 40;
      }
      this.body.texture = spriteLib.frame(sprite.death, dir, frame);
      this.body.rotation = 0;
      this.body.position.set(0, 2);
      this.body.scale.set(baseScale);
      this.flashTicks = 2; // Hold setLightTint off — the pulse owns the tint.
      const s = 0.5 + 0.5 * Math.sin(glow * 0.1);
      const r = Math.round(0xff * (1 - s) + 0xc8 * s);
      const gch = Math.round(0xd9 * (1 - s) + 0x6a * s);
      const bch = Math.round(0xa0 * (1 - s) + 0x50 * s);
      this.body.tint = (r << 16) | (gch << 8) | bch;
      this.container.alpha = 1;
      this.shadow.alpha = 1;
      return;
    }

    if (this.action === 'attack') {
      const total = this.windup + this.recover;
      if (sprite.attack) {
        // Full attack sheet (knight-based enemies): play it across the
        // windup+recover window so the visual matches the dodge timing.
        const fc = spriteLib.anim(sprite.attack).frameCount;
        const frame = Math.min(fc - 1, Math.floor((this.actionTicks / total) * fc));
        this.body.texture = spriteLib.frame(sprite.attack, dir, frame);
        this.body.rotation = 0;
        this.body.position.set(0, 2);
        this.body.scale.set(baseScale);
        return;
      }
      // No attack frames (demo skeletons): ANIMATED lunge — slow walk-cycle
      // steps during the rear-back, then a violent forward surge. Reads as a
      // living attack, never a frozen statue.
      const w = this.windup;
      const stepFrame = Math.floor(this.actionTicks * 0.18);
      this.body.texture = spriteLib.frame(sprite.walk, dir, stepFrame);
      this.body.scale.set(baseScale);
      if (this.actionTicks < w) {
        const p = this.actionTicks / w;
        this.body.rotation = -0.22 * p * p;
        this.body.position.set(-3 * p, 2);
      } else if (this.actionTicks < w + 4) {
        const q = (this.actionTicks - w) / 4;
        this.body.rotation = -0.22 + 0.5 * q;
        this.body.position.set(-3 + 9 * q, 2);
      } else {
        const r = (this.actionTicks - w - 4) / Math.max(1, this.recover - 4);
        this.body.rotation = 0.28 * (1 - r);
        this.body.position.set(6 * (1 - r), 2);
      }
      return;
    }

    if (this.action === 'hit') {
      if (sprite.hitAnim) {
        // Real flinch frames, paced across the stun window.
        const fc = spriteLib.anim(sprite.hitAnim).frameCount;
        const total = Math.max(1, this.def.hitRecoveryTicks);
        const progress = 1 - this.actionTicks / total; // actionTicks counts down.
        const frame = Math.min(fc - 1, Math.floor(progress * fc * 0.8));
        this.body.texture = spriteLib.frame(sprite.hitAnim, dir, frame);
        this.body.rotation = 0;
        this.body.position.set(0, 2);
      } else {
        this.body.texture = spriteLib.frame(sprite.idle ?? sprite.walk, dir, 0);
        this.body.rotation = Math.sin(this.actionTicks * 1.3) * 0.1;
        this.body.position.set(-2, 2);
      }
      this.body.scale.set(baseScale);
      return;
    }

    // Free: walk cycle paced by ground covered; idle breathes gently.
    this.body.rotation = 0;
    this.body.position.set(0, 2);
    const moving = Math.hypot(this.pos.x - this.prevPos.x, this.pos.y - this.prevPos.y) > 1e-4;
    if (moving) {
      this.body.texture = spriteLib.frame(sprite.walk, dir, Math.floor(this.walkPhase));
      this.body.scale.set(baseScale);
    } else {
      const idleAnim = sprite.idle ?? sprite.walk;
      // Slow LIVE idle frames (guards breathe/shift) — never a frozen statue.
      const idleFrame = sprite.idle ? Math.floor(this.elapsed * 6 + this.bobPhase * 2) : 0;
      this.body.texture = spriteLib.frame(idleAnim, dir, idleFrame);
      this.body.scale.set(baseScale, baseScale * (1 + Math.sin(this.elapsed * 1.7 + this.bobPhase) * 0.012));
    }
  }

  /** SEGMENTED health bar (it.23): quarter-notches make remaining health
   *  readable at a glance; the "Lv N" plaque shows alongside. */
  private redrawHealthBar(): void {
    const w = 32;
    const h = 5;
    this.healthBar.clear();
    this.healthBar.rect(-w / 2 - 1, -1, w + 2, h + 2).fill({ color: 0x0a0a0c, alpha: 0.92 });
    const frac = Math.max(0, this.hp / this.hpMax);
    if (frac > 0) {
      this.healthBar.rect(-w / 2, 0, w * frac, h).fill(0x9c2b1e);
      this.healthBar.rect(-w / 2, 0, w * frac, 1.5).fill({ color: 0xd8503c, alpha: 0.7 }); // Top sheen.
    }
    // Quarter dividers — the notches.
    for (let i = 1; i < 4; i++) {
      this.healthBar.rect(-w / 2 + (w * i) / 4 - 0.5, -1, 1, h + 2).fill({ color: 0x0a0a0c, alpha: 0.95 });
    }
    const show = this.hp < this.hpMax && this.hp > 0;
    this.healthBar.visible = show;
    this.levelText.visible = show;
  }

  override serialize(): EntitySnapshot & { aiState: EnemyAIState; enemyKind: EnemyKind } {
    return { ...super.serialize(), aiState: this.aiState, enemyKind: this.def.kind };
  }
}
