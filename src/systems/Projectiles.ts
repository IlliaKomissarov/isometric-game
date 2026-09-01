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

import { Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { eventBus } from '@/core/EventBus';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import type { Entity } from '@/entities/Entity';
import type { Player } from '@/entities/Player';
import { vec2 } from '@/utils/Vec2';
import { depthKey, worldToScreen } from '@/utils/iso';
import type { CombatSystem } from './Combat';
import type { WalkableFn } from './Collision';

export type ProjectileKind = 'arrow' | 'bolt';
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
}

interface Projectile extends ProjectileSpawn {
  active: boolean;
  dirX: number;
  dirY: number;
  traveled: number;
  sprite: Sprite;
}

const SPEED: Record<ProjectileKind, number> = { arrow: 9, bolt: 7.5 };
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
      p = { ...opts, active: false, dirX: 0, dirY: 0, traveled: 0, sprite };
      this.pool.push(p);
    }
    Object.assign(p, opts);
    p.active = true;
    p.dirX = dx / len;
    p.dirY = dy / len;
    p.traveled = 0;
    p.sprite.texture = assets.get(opts.kind);
    p.sprite.blendMode = opts.kind === 'bolt' ? 'add' : 'normal';
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

      if (p.traveled >= MAX_TRAVEL || !this.isWalkable(Math.floor(p.x), Math.floor(p.y))) {
        this.impact(p, false);
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

  /** Per-frame: position, depth-sort, fog gating, lighting. */
  updateRender(lighting: Lighting): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      const visible = lighting.isVisible(Math.floor(p.x), Math.floor(p.y));
      p.sprite.visible = visible;
      if (!visible) continue;
      const s = worldToScreen(p.x, p.y, this.scratch);
      p.sprite.position.set(s.x, s.y - 18); // Flies at torso height.
      p.sprite.zIndex = depthKey(p.x, p.y);
      p.sprite.tint = p.kind === 'bolt' ? (p.tint ?? 0xffcf90) : lighting.getTintAt(p.x, p.y, 0.35);
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
    eventBus.emit('projectile:impact', { x: p.x, y: p.y, kind: p.kind, hitFlesh });
  }
}
