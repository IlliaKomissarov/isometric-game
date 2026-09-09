/**
 * @module systems/Squad
 * THE CITY'S OWN (it.100) — the guards who go into the fields with you.
 *
 * A squad member is NOT an `Enemy` with a flag flipped. Hostiles chase exactly
 * one quarry (the hero, passed into `Enemy.update`), so an ally is invisible to
 * them by construction: no faction check is needed anywhere, and friendly fire
 * is impossible because the hero's target picking only ever sees enemies. That
 * also means a guard cannot be killed, which is deliberate — a wiped squad would
 * make the field unwinnable, and the officer is required to survive it anyway.
 *
 * DETERMINISM. Everything that touches hp runs on the fixed sim tick through
 * `step()`, and `CombatSystem.dealDamage` stays the only hp mutator — a guard's
 * blow is credited to the hero, so experience, loot and the difficulty floor all
 * behave exactly as they would if the hero had swung. `draw()` is render-only
 * and may use the wall clock. Nothing here consumes `Math.random`.
 */

import { Container, Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { spriteLib, stableDir, type AnimName } from '@/render/SpriteLibrary';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';
import { canStandAt, type WalkableFn } from './Collision';

/** A body the squad will walk to and hit. */
export interface SquadFoe {
  id: number;
  hp: number;
  action: string;
  pos: { x: number; y: number };
}

export interface SquadOptions {
  /** The anim the rank and file wear. */
  anim?: AnimName;
  /** The officer's own anim, if he is not dressed like his men. */
  officerAnim?: AnimName;
  /** Blows a second, per guard. */
  rate?: number;
  /** Damage a blow, before the target's armour. */
  damage?: number;
  /** How far a guard will stray from where it was set down. */
  leash?: number;
}

interface Member {
  root: Container;
  body: Sprite;
  mark: Sprite;
  /** Where he was set down, so a guard holds a line instead of chasing the map. */
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  /** The last drawn position, so the render can interpolate between ticks. */
  px: number;
  py: number;
  dir: number;
  clock: number;
  /** Ticks until this one can swing again. */
  cool: number;
  officer: boolean;
  anim: AnimName;
  scale: number;
  fc: number;
}

const GUARD_HEIGHT = 60;
const OFFICER_HEIGHT = 66;
const SPEED = 2.6; // tiles a second - a shade quicker than the hero, so they lead
const REACH = 1.15;

export class Squad {
  private readonly members: Member[] = [];
  private readonly scratch = vec2();
  private readonly rate: number;
  private readonly damage: number;
  private readonly leash: number;
  /** Set false once the field is won: the squad stands down and stops swinging. */
  fighting = true;

  constructor(
    layer: Container,
    private readonly isWalkable: WalkableFn,
    spots: ReadonlyArray<{ x: number; y: number; officer?: boolean }>,
    opts: SquadOptions = {},
  ) {
    this.rate = opts.rate ?? 1.1;
    this.damage = opts.damage ?? 9;
    this.leash = opts.leash ?? 14;
    const anim = (opts.anim ?? 'guard_walk') as AnimName;
    const officerAnim = (opts.officerAnim ?? anim) as AnimName;
    for (const s of spots) {
      const a = s.officer ? officerAnim : anim;
      if (!spriteLib.hasAnim(a)) continue;
      const painted = spriteLib.paintedHeight(a) || 90;
      const scale = (s.officer ? OFFICER_HEIGHT : GUARD_HEIGHT) / painted;
      const root = new Container();
      root.scale.set(0.8);
      const shadow = new Sprite(assets.get('shadow'));
      shadow.anchor.set(0.5, 0.5);
      shadow.alpha = 0.6;
      root.addChild(shadow);
      // THE CITY'S COLOUR (it.100): a cool footing halo under every friendly body,
      // so a glance at the ground already separates them from the company. The
      // OVERHEAD mark is a DOM chevron (`#ally-over`), which stays crisp at every
      // zoom and is readable on a phone in a way a soft additive blob is not.
      const mark = new Sprite(assets.get('glow'));
      mark.anchor.set(0.5, 0.5);
      mark.blendMode = 'add';
      mark.tint = s.officer ? 0x9fd8ff : 0x6aa8ff;
      mark.alpha = s.officer ? 0.5 : 0.34;
      mark.scale.set(s.officer ? 0.5 : 0.4);
      mark.position.set(0, 2);
      root.addChild(mark);
      const body = new Sprite(spriteLib.frame(a, 6, 0));
      body.anchor.set(0.5, 1);
      body.scale.set(scale / 0.8);
      body.position.set(0, 2);
      root.addChild(body);
      layer.addChild(root);
      this.members.push({
        root, body, mark,
        homeX: s.x + 0.5, homeY: s.y + 0.5,
        x: s.x + 0.5, y: s.y + 0.5, px: s.x + 0.5, py: s.y + 0.5,
        dir: 6, clock: 0, cool: 0, officer: !!s.officer,
        anim: a, scale, fc: spriteLib.anim(a).frameCount,
      });
    }
  }

  /** Every friendly head, for the cutaway occluders and the ally markers. */
  positions(): Array<{ x: number; y: number; officer: boolean }> {
    return this.members.map((m) => ({ x: m.x, y: m.y, officer: m.officer }));
  }

  get size(): number {
    return this.members.length;
  }

  /**
   * ONE FIXED TICK. Walks each guard at the nearest hostile inside his leash and
   * swings when he is in reach. Runs in the sim, so a co-op party stays in step.
   * @param foes    every living hostile on the floor.
   * @param hit     deals a blow through `CombatSystem.dealDamage`, credited to the hero.
   */
  step(dt: number, foes: ReadonlyArray<SquadFoe>, hit: (targetId: number, amount: number) => void): void {
    const cooldown = Math.max(1, Math.round(1 / (this.rate * dt)));
    for (const m of this.members) {
      m.px = m.x;
      m.py = m.y;
      if (m.cool > 0) m.cool--;
      // The officer directs; he does not brawl, and he never leaves his ground.
      const hunting = this.fighting && !m.officer;
      let best: SquadFoe | null = null;
      let bd = Infinity;
      if (hunting) {
        for (const f of foes) {
          if (f.hp <= 0 || f.action === 'dead') continue;
          const d = Math.hypot(f.pos.x - m.x, f.pos.y - m.y);
          // Only what he can reasonably reach from where he was set down.
          if (Math.hypot(f.pos.x - m.homeX, f.pos.y - m.homeY) > this.leash) continue;
          if (d < bd) {
            bd = d;
            best = f;
          }
        }
      }
      const goal = best ? best.pos : { x: m.homeX, y: m.homeY };
      const dx = goal.x - m.x;
      const dy = goal.y - m.y;
      const dist = Math.hypot(dx, dy);
      const stop = best ? REACH : 0.35;
      if (dist > stop) {
        const step = Math.min(dist - stop, SPEED * dt);
        const nx = m.x + (dx / dist) * step;
        const ny = m.y + (dy / dist) * step;
        // Slide along whatever he cannot walk through, rather than sticking.
        if (canStandAt(nx, ny, this.isWalkable)) {
          m.x = nx;
          m.y = ny;
        } else if (canStandAt(nx, m.y, this.isWalkable)) {
          m.x = nx;
        } else if (canStandAt(m.x, ny, this.isWalkable)) {
          m.y = ny;
        }
        m.clock += step * 0.55;
        m.dir = stableDir(dx / dist, dy / dist, m.dir);
      } else if (best) {
        m.dir = stableDir(dx / (dist || 1), dy / (dist || 1), m.dir);
        if (m.cool === 0) {
          m.cool = cooldown;
          hit(best.id, this.damage);
        }
      }
    }
  }

  /** Render-only: interpolate between the last two ticks and light the bodies. */
  draw(alpha: number, tint: (x: number, y: number) => number): void {
    for (const m of this.members) {
      const x = m.px + (m.x - m.px) * alpha;
      const y = m.py + (m.y - m.py) * alpha;
      const moving = Math.hypot(m.x - m.px, m.y - m.py) > 0.0005;
      const frame = moving ? Math.floor(m.clock * m.fc) % m.fc : 0;
      m.body.texture = spriteLib.frame(m.anim, m.dir, frame);
      m.body.tint = tint(x, y);
      const s = worldToScreen(x, y, this.scratch);
      m.root.position.set(s.x, s.y);
      m.root.zIndex = depthKey(x, y);
    }
  }

  destroy(): void {
    for (const m of this.members) m.root.destroy({ children: true });
    this.members.length = 0;
  }
}
