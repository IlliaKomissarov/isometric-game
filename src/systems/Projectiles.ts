/**
 * @module systems/Projectiles
 * Pooled projectile simulation for BOTH factions: enemy arrows at the
 * player, player arrows/magic bolts at enemies.
 *
 * Projectiles are simulation objects: they fly in fixed ticks toward where
 * the shooter AIMED at loose time (dodgeable in flight), stop at the first
 * wall, and resolve their to-hit + damage rolls in CombatSystem on contact.
 * `projectile:impact` fires at every termination point so the render layer
 * can burst sparks/dust without the sim knowing about particles.
 */

import { Sprite, type Texture } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { spriteLib } from '@/render/SpriteLibrary';
import { eventBus } from '@/core/EventBus';
import type { Ambience } from '@/engine/Ambience';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import type { Entity } from '@/entities/Entity';
import type { Player } from '@/entities/Player';
import { vec2 } from '@/utils/Vec2';
import { depthKey, worldToScreen } from '@/utils/iso';
import type { CombatSystem } from './Combat';
import type { WalkableFn } from './Collision';

export type ProjectileKind = 'arrow' | 'bolt' | 'fireball';
export type ProjectileFaction = 'player' | 'enemy';

export interface ProjectileSpawn {
  faction: ProjectileFaction;
  kind: ProjectileKind;
  sourceId: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  minDamage: number;
  maxDamage: number;
  toHit: number;
  /** Tint for bolt projectiles (weapon color). */
  tint?: number;
  /** Stop and burst here even without a hit (aimed spells, it.41). */
  maxTravel?: number;
  /**
   * AREA IMPACT (it.41): called at the termination point instead of the
   * single-target hit roll (fireball). Runs inside the sim tick.
   */
  onImpact?: (x: number, y: number) => void;
}

interface Projectile extends ProjectileSpawn {
  active: boolean;
  dirX: number;
  dirY: number;
  traveled: number;
  sprite: Sprite;
  /** Animated head (it.41): strip frames + clock. */
  frames: ReadonlyArray<Texture> | null;
  clock: number;
}

const SPEED: Record<ProjectileKind, number> = { arrow: 11.25, bolt: 9.4, fireball: 10 }; // +25 % (it.53).
/** Animated heads per kind (atlas strip, playback fps, on-screen scale). */
const HEAD: Partial<Record<ProjectileKind, { anim: 'vfx_fireball' | 'vfx_orb'; fps: number; scale: number }>> = {
  fireball: { anim: 'vfx_fireball', fps: 24, scale: 0.7 },
  bolt: { anim: 'vfx_orb', fps: 20, scale: 0.75 },
};
const MAX_TRAVEL = 12;
const HIT_RADIUS = 0.45;
/**
 * WHAT AN ARROW MAY STOP ON (it.117).
 *
 * A shot used to die the instant its point crossed into a tile the walker
 * could not stand in — and the wall test ran BEFORE the flesh test. Every
 * training dummy stands on such a tile (the post blocks its own square), so
 * a bow could never touch one: the arrow expired on the tile line half a
 * tile short of the wood. Verified before the fix: five point-blank arrows
 * at 10 damage, dummy 400 hp → 400 hp. The same hole swallowed any shot at
 * a foe backed against a crate, a pillar or a doorframe.
 *
 * The flight resolves in this order now, per sub-step of at most `SUB_STEP`
 * tiles (so nothing tunnels through a body at any tick rate):
 *   1. FLESH — a body inside `HIT_RADIUS` takes the shot;
 *   2. RANGE — the shot's own travel limit;
 *   3. SCENERY — a solid tile stops it, but only after one last look for a
 *      body within `SOLID_REACH` of the stopping point: a foe standing ON
 *      the obstruction is what the shot was aimed at, and is what it hits;
 *   4. otherwise the shot is genuinely BLOCKED and `onBlocked` says where.
 */
const SUB_STEP = 0.25;
/** How far past a solid tile the shot still looks for the body it was meant for. */
const SOLID_REACH = 0.85;

export class ProjectileSystem {
  private readonly pool: Projectile[] = [];
  private readonly scratch = vec2();

  constructor(
    private readonly viewport: Viewport,
    private readonly isWalkable: WalkableFn,
    /** CO-OP (it.59): every seat's hero (null = empty seat); enemy shots may hit any of them. */
    private readonly players: ReadonlyArray<Player | null>,
    /** Nearest living enemy within radius of a point (player-faction hits). */
    private readonly findEnemyAt: (x: number, y: number, radius: number) => Entity | null,
  ) {}

  /** Wired after construction (combat needs movement; projectiles need combat). */
  combat!: CombatSystem;

  /**
   * A SHOT THE SCENERY ATE (it.117): render hook, fired at the obstruction's
   * point when a shot stopped on stone with nothing behind it to hit. Main
   * throttles it into one small "BLOCKED" tag — silence here would leave the
   * player mashing a bow at a crate and wondering why nothing bleeds.
   */
  onBlocked: ((x: number, y: number, faction: ProjectileFaction) => void) | null = null;

  spawn(opts: ProjectileSpawn): void {
    const dx = opts.targetX - opts.x;
    const dy = opts.targetY - opts.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;

    let p = this.pool.find((it) => !it.active);
    if (!p) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.viewport.objectLayer.addChild(sprite);
      p = { ...opts, active: false, dirX: 0, dirY: 0, traveled: 0, sprite, frames: null, clock: 0 };
      this.pool.push(p);
    }
    p.maxTravel = undefined;
    p.onImpact = undefined;
    Object.assign(p, opts);
    p.active = true;
    p.dirX = dx / len;
    p.dirY = dy / len;
    p.traveled = 0;
    p.clock = 0;
    const head = HEAD[opts.kind];
    p.frames = head && spriteLib.loaded && spriteLib.hasAnim(head.anim) ? spriteLib.anim(head.anim).frames[0] : null;
    if (p.frames) {
      p.sprite.texture = p.frames[0];
      p.sprite.scale.set(head!.scale);
    } else {
      p.sprite.texture = assets.get(opts.kind === 'arrow' ? 'arrow' : 'bolt');
      p.sprite.scale.set(opts.kind === 'fireball' ? 1.6 : 1);
    }
    p.sprite.blendMode = opts.kind === 'arrow' ? 'normal' : 'add';
    // Screen-space heading (accounts for the 2:1 iso squash).
    p.sprite.rotation = Math.atan2((p.dirX + p.dirY) / 2, p.dirX - p.dirY);
    p.sprite.visible = true;
  }

  /** Fixed-tick flight + collision, sub-stepped so nothing tunnels (it.117). */
  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      const step = SPEED[p.kind] * dt;
      const subs = Math.max(1, Math.ceil(step / SUB_STEP));
      const inc = step / subs;
      for (let s = 0; s < subs && p.active; s++) {
        p.x += p.dirX * inc;
        p.y += p.dirY * inc;
        p.traveled += inc;
        this.resolveStep(p);
      }
    }
  }

  /** One sub-step of flight: flesh, then range, then scenery (it.117). */
  private resolveStep(p: Projectile): void {
    // 1. FLESH. Always looked for first — a body standing on a blocked tile
    //    (every training dummy) used to be unreachable because the wall test
    //    ran ahead of this one.
    if (p.onImpact) {
      // Area spell: the first foe it meets detonates it (the callback rolls the damage).
      if (this.findEnemyAt(p.x, p.y, HIT_RADIUS + 0.1)) {
        this.impact(p, true);
        return;
      }
    } else if (p.faction === 'enemy') {
      for (const hero of this.players) {
        if (!hero || hero.action === 'dead') continue;
        if (Math.hypot(hero.pos.x - p.x, hero.pos.y - p.y) <= HIT_RADIUS) {
          this.combat.projectileHit(p.sourceId, hero.id, p.minDamage, p.maxDamage, p.toHit, p.dirX, p.dirY);
          this.impact(p, true);
          return;
        }
      }
    } else {
      const enemy = this.findEnemyAt(p.x, p.y, HIT_RADIUS);
      if (enemy) {
        this.combat.projectileHitEnemy(p.sourceId, enemy, p.minDamage, p.maxDamage, p.toHit, p.dirX, p.dirY);
        this.impact(p, true);
        return;
      }
    }

    // 2. RANGE: a spell's own travel limit, or the flight's.
    if (p.traveled >= (p.maxTravel ?? MAX_TRAVEL)) {
      this.impact(p, false);
      return;
    }

    // 3. SCENERY. One last look for the body the shot was meant for before
    //    the stone gets it: a foe ON the obstruction takes the hit.
    if (this.isWalkable(Math.floor(p.x), Math.floor(p.y))) return;
    if (p.faction === 'player') {
      const behind = this.findEnemyAt(p.x, p.y, SOLID_REACH);
      if (behind) {
        if (p.onImpact) this.impact(p, true);
        else {
          this.combat.projectileHitEnemy(p.sourceId, behind, p.minDamage, p.maxDamage, p.toHit, p.dirX, p.dirY);
          this.impact(p, true);
        }
        return;
      }
    }
    // 4. BLOCKED: nothing behind the stone. Say so instead of eating it
    //    silently. An area spell is NOT blocked — `impact` detonates it where
    //    it stopped, which is a perfectly good outcome for a fireball.
    if (!p.onImpact) this.onBlocked?.(p.x, p.y, p.faction);
    this.impact(p, false);
  }

  /** Per-frame: position, depth-sort, fog gating, lighting, trails (it.36). */
  updateRender(lighting: Lighting, ambience?: Ambience, dt = 1 / 60): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      if (p.frames) {
        p.clock += dt;
        p.sprite.texture = p.frames[Math.floor(p.clock * (HEAD[p.kind]?.fps ?? 20)) % p.frames.length];
      }
      const visible = lighting.isVisible(Math.floor(p.x), Math.floor(p.y));
      p.sprite.visible = visible;
      if (!visible) continue;
      const s = worldToScreen(p.x, p.y, this.scratch);
      p.sprite.position.set(s.x, s.y - 18); // Flies at torso height.
      p.sprite.zIndex = depthKey(p.x, p.y);
      p.sprite.tint = p.kind === 'arrow' ? lighting.getTintAt(p.x, p.y, 0.35) : p.frames ? 0xffffff : (p.tint ?? 0xffcf90);
      // Spell trails smear ember light behind bolts; arrows shed faint dust.
      if (ambience) {
        if (p.kind !== 'arrow') {
          ambience.trail(p.x, p.y, 18, p.tint ?? 0xffcf90, true);
          if (Math.random() < (p.kind === 'fireball' ? 0.9 : 0.5)) ambience.trail(p.x, p.y, 18, 0xffe8c0, true);
        } else if (Math.random() < 0.6) {
          ambience.trail(p.x, p.y, 18, 0x9a9080, false);
        }
      }
    }
  }

  /** Deactivate every projectile (floor teardown). */
  clear(): void {
    for (const p of this.pool) {
      p.active = false;
      p.sprite.visible = false;
    }
  }

  private impact(p: Projectile, hitFlesh: boolean): void {
    p.active = false;
    p.sprite.visible = false;
    p.onImpact?.(p.x, p.y);
    eventBus.emit('projectile:impact', { x: p.x, y: p.y, kind: p.kind, hitFlesh });
  }
}
