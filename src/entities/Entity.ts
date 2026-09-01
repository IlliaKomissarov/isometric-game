/**
 * @module entities/Entity
 * Base class for every simulated world object.
 *
 * Simulation state (position, hp) lives in plain serializable fields and is
 * advanced ONLY inside fixed ticks. Render state (the Pixi container) is
 * updated in `syncRender(alpha)` with interpolation between the previous and
 * current tick positions — never mutate `pos` from render code.
 */

import { Container } from 'pixi.js';
import { copy, vec2, type Vec2 } from '@/utils/Vec2';
import { depthKey, worldToScreen } from '@/utils/iso';
import type { EntitySnapshot } from '@/network/Serialization';

export abstract class Entity {
  /** Assigned by StateManager.register — deterministic across peers. */
  id = 0;

  /** Continuous world position in tile units (simulation-owned). */
  readonly pos: Vec2 = vec2();
  /** Position at the previous fixed tick (for render interpolation). */
  readonly prevPos: Vec2 = vec2();

  hp = 100;
  hpMax = 100;

  /**
   * Combat action state machine (Diablo 1 model):
   *   idle   — free to move/act.
   *   attack — playing a swing: windup → strike frame → recovery. Damage
   *            lands ONLY on the strike frame; interrupting cancels it.
   *   hit    — hit-recovery flinch: cannot move or act until it elapses.
   *   dead   — playing the death animation; no longer targetable.
   *   transition — phased-boss death-and-rebirth: the fallen form's death
   *            anim plays out, the next form rises (reversed death). hp is
   *            0 throughout, so the body is invincible and untargetable.
   */
  action: 'idle' | 'attack' | 'hit' | 'dead' | 'transition' = 'idle';
  /** Ticks remaining/elapsed in the current action (meaning per state owner). */
  actionTicks = 0;

  /** World-space facing direction (unit-ish; last movement/attack direction). */
  readonly facing: Vec2 = vec2(1, 0);

  /** Ticks of flinch when a hard hit interrupts this entity (0 = unstunnable). */
  hitRecoveryTicks = 15;

  /** Flat damage reduction applied in CombatSystem.dealDamage. */
  get armor(): number {
    return 0;
  }

  /** Root display container. Children are the paperdoll/visual layers. */
  readonly container = new Container();

  private readonly renderScratch = vec2();

  abstract get kind(): 'player' | 'enemy';

  /** Fixed-tick simulation step. Override in subclasses; call super first. */
  update(_dt: number): void {
    // Base entity has no behavior; movement systems mutate pos externally.
  }

  /** Snapshot pos → prevPos. Called by the world before systems run each tick. */
  beginTick(): void {
    copy(this.prevPos, this.pos);
  }

  /** Project interpolated world position into screen space and depth-sort. */
  syncRender(alpha: number): void {
    const ix = this.prevPos.x + (this.pos.x - this.prevPos.x) * alpha;
    const iy = this.prevPos.y + (this.pos.y - this.prevPos.y) * alpha;
    const s = worldToScreen(ix, iy, this.renderScratch);
    this.container.position.set(s.x, s.y);
    this.container.zIndex = depthKey(ix, iy);
  }

  /** Place the entity, resetting interpolation (spawn/teleport). */
  warpTo(x: number, y: number): void {
    this.pos.x = x;
    this.pos.y = y;
    copy(this.prevPos, this.pos);
  }

  serialize(): EntitySnapshot {
    return {
      id: this.id,
      kind: this.kind,
      x: this.pos.x,
      y: this.pos.y,
      hp: this.hp,
      hpMax: this.hpMax,
    };
  }

  /** Release display resources (object pools call this on final teardown only). */
  destroy(): void {
    this.container.destroy({ children: true });
  }
}
