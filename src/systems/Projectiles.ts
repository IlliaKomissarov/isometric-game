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

export class ProjectileSystem {
  private readonly pool: Projectile[] = [];
  private readonly scratch = vec2();

  constructor(
    private readonly viewport: Viewport,
    private readonly isWalkable: WalkableFn,
    private readonly player: Player,
    /** Nearest living enemy within radius of a point (player-faction hits). */
    private readonly findEnemyAt: (x: number, y: number, radius: number) => Entity | null,
  ) {}

  /** Wired after construction (combat needs movement; projectiles need combat). */
  combat!: CombatSystem;

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

  /** Fixed-tick flight + collision. */
  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      const step = SPEED[p.kind] * dt;
      p.x += p.dirX * step;
      p.y += p.dirY * step;
      p.traveled += step;

      if (p.traveled >= (p.maxTravel ?? MAX_TRAVEL) || !this.isWalkable(Math.floor(p.x), Math.floor(p.y))) {
        this.impact(p, false);
        continue;
      }

      if (p.onImpact) {
        // Area spell: the first foe it meets detonates it (the callback rolls the damage).
        if (this.findEnemyAt(p.x, p.y, HIT_RADIUS + 0.1)) this.impact(p, true);
        continue;
      }

      if (p.faction === 'enemy') {
        const pdx = this.player.pos.x - p.x;
        const pdy = this.player.pos.y - p.y;
        if (Math.hypot(pdx, pdy) <= HIT_RADIUS && this.player.action !== 'dead') {
          this.combat.projectileHit(p.sourceId, p.minDamage, p.maxDamage, p.toHit, p.dirX, p.dirY);
          this.impact(p, true);
        }
      } else {
        const enemy = this.findEnemyAt(p.x, p.y, HIT_RADIUS);
        if (enemy) {
          this.combat.projectileHitEnemy(p.sourceId, enemy, p.minDamage, p.maxDamage, p.toHit, p.dirX, p.dirY);
          this.impact(p, true);
        }
      }
    }
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
