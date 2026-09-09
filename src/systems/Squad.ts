/**
 * @module systems/Squad
 * THE CITY'S OWN (it.100, fought properly it.101) — the guards who go into the
 * fields with you.
 *
 * A squad member is NOT an `Enemy` with a flag flipped. Hostiles chase one
 * quarry at a time, handed to them by `EnemyAIDeps.getPlayerPos`, so an ally is
 * only ever attacked because main CHOSE to offer it as that quarry (it.101) —
 * there is still no faction field anywhere, and the hero's own target picking
 * only ever sees enemies, so friendly fire remains impossible by construction.
 *
 * WHAT it.101 CHANGED. In it.100 the guards held a line around the spot they
 * were set down and the enemy ignored them, which read as two battles happening
 * beside each other. Now:
 *   - the formation is anchored to the HERO, not to the muster ground, so the
 *     squad advances with the assault instead of being left behind it;
 *   - a guard breaks off at anything inside `leash` OF THE ANCHOR and runs it
 *     down, so the line actually closes;
 *   - a guard can be hurt and can be put down (`hurt`), and gets back up after
 *     a spell — the field stays winnable, but the fight has a cost on screen;
 *   - the officer is a different body in brighter plate under a banner, and
 *     nothing can kill him.
 *
 * DETERMINISM. Everything that touches hp runs on the fixed sim tick through
 * `step()`, and `CombatSystem.dealDamage` stays the only mutator of ENTITY hp —
 * a guard's blow is credited to the hero, so experience, loot and the difficulty
 * floor all behave exactly as they would if the hero had swung. A guard's own hp
 * is not entity state (a guard is not in `state`), so it lives here, stepped on
 * the same tick on every peer. `draw()` is render-only and may use the wall
 * clock. Nothing here consumes `Math.random`.
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

/** A guard offered to the enemy as a quarry (it.101). */
export interface SquadTarget {
  id: number;
  x: number;
  y: number;
}

/** One rank of the city's soldiery: a sheet, how tall it is painted, its plate. */
export interface SquadKit {
  anim: AnimName;
  height: number;
  tint: number;
}

/**
 * THE RANKS (it.101). The watch turns out in what it owns: two files of the
 * city guard in steel and in bronzed plate, and a pair of the militia's own
 * heavier men. Every sheet here is an EIGHT-DIRECTION rig that no hostile on
 * this floor wears - `captain_*` is the company's, `guard_*` is the city's -
 * so friend and foe never share a silhouette.
 */
export const SQUAD_RANKS: ReadonlyArray<SquadKit> = [
  { anim: 'guard_walk', height: 60, tint: 0xdfe6f2 }, // steel
  { anim: 'guard_walk', height: 58, tint: 0xd8c090 }, // bronzed
  { anim: 'guard_walk', height: 62, tint: 0xaebad2 }, // blued
  { anim: 'guard_walk', height: 57, tint: 0xc8d8c0 }, // green-cloaked militia
];
/** The officer: a head taller, in white plate, and he carries the colours. */
export const SQUAD_OFFICER: SquadKit = { anim: 'guard_walk', height: 70, tint: 0xfff2d0 };

export interface SquadOptions {
  /** Blows a second, per guard. */
  rate?: number;
  /** Damage a blow, before the target's armour. */
  damage?: number;
  /** How far a guard will stray from the anchor the assault is moving on. */
  leash?: number;
  /** What a guard can take before he goes down (the officer takes none). */
  toughness?: number;
}

interface Member {
  root: Container;
  body: Sprite;
  mark: Sprite;
  /** The colours over the officer's head, if he is the one carrying them. */
  flag: Sprite | null;
  /** Where he stands in the formation, RELATIVE to the anchor (it.101). */
  ox: number;
  oy: number;
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
  id: number;
  hp: number;
  hpMax: number;
  /** Ticks left on the ground; 0 is on his feet (it.101). */
  down: number;
  /** Ticks left of the white flash a blow leaves. */
  flash: number;
  /** Ticks spent unable to move at all; past a point he tries sideways (it.101). */
  stuck: number;
  /** Which way he is sidestepping while unwedging himself, or 0. */
  slip: number;
  anim: AnimName;
  scale: number;
  tint: number;
  fc: number;
}

const SPEED = 3.0; // tiles a second - a shade quicker than the hero, so they lead
const REACH = 1.2;
/** How close two guards may stand before they shoulder each other apart (it.101). */
const SPACING = 0.62;
/** The muster's shape, opened out so the line stands round the hero, not on him. */
const FORMATION = 1.7;
/** The golden angle: consecutive ids land on opposite sides of the same body. */
const GOLDEN = 2.399963;
/** Blocked this many ticks running and a guard picks a side and walks round. */
const WEDGED = 18;
/** How long a guard lies before the others get him up again. */
const DOWN_TICKS = 420;
const FLASH_TICKS = 7;

export class Squad {
  private readonly members: Member[] = [];
  private readonly scratch = vec2();
  private readonly rate: number;
  private readonly damage: number;
  private readonly leash: number;
  /** Where the assault is: the hero, refreshed every tick by `step` (it.101). */
  private ax = 0;
  private ay = 0;
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
    this.leash = opts.leash ?? 16;
    const tough = opts.toughness ?? 90;
    // The formation is read off the spots the floor named, but kept as OFFSETS:
    // the anchor moves with the hero, so the shape marches instead of standing.
    let cx = 0;
    let cy = 0;
    for (const s of spots) {
      cx += s.x + 0.5;
      cy += s.y + 0.5;
    }
    cx /= Math.max(1, spots.length);
    cy /= Math.max(1, spots.length);
    this.ax = cx;
    this.ay = cy;
    let nextId = 1;
    let rank = 0;
    for (const s of spots) {
      const kit = s.officer ? SQUAD_OFFICER : SQUAD_RANKS[rank++ % SQUAD_RANKS.length];
      if (!spriteLib.hasAnim(kit.anim)) continue;
      const painted = spriteLib.paintedHeight(kit.anim) || 90;
      const scale = kit.height / painted;
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
      mark.tint = s.officer ? 0xffe6a8 : 0x6aa8ff;
      mark.alpha = s.officer ? 0.72 : 0.34;
      mark.scale.set(s.officer ? 0.72 : 0.4);
      mark.position.set(0, 2);
      root.addChild(mark);
      const body = new Sprite(spriteLib.frame(kit.anim, 4, 0));
      body.anchor.set(0.5, 1);
      body.scale.set(scale / 0.8);
      body.position.set(0, 2);
      root.addChild(body);
      // THE COLOURS (it.101): the officer alone stands under the city's banner,
      // so the leader is picked out of a melee at a glance, from any distance.
      let flag: Sprite | null = null;
      if (s.officer && spriteLib.hasAnim('banner')) {
        flag = new Sprite(spriteLib.frame('banner', 0, 0));
        flag.anchor.set(0.5, 1);
        flag.scale.set(0.34 / 0.8);
        flag.position.set(9, -kit.height / 0.8 - 2);
        root.addChild(flag);
      }
      layer.addChild(root);
      this.members.push({
        root, body, mark, flag,
        ox: (s.x + 0.5 - cx) * FORMATION, oy: (s.y + 0.5 - cy) * FORMATION,
        x: s.x + 0.5, y: s.y + 0.5, px: s.x + 0.5, py: s.y + 0.5,
        dir: 4, clock: 0, cool: 0, officer: !!s.officer, id: nextId++,
        hp: tough, hpMax: tough, down: 0, flash: 0, stuck: 0, slip: 0,
        anim: kit.anim, scale, tint: kit.tint, fc: spriteLib.anim(kit.anim).frameCount,
      });
    }
  }

  /** Every friendly head, for the cutaway occluders and the ally markers. */
  positions(): Array<{ x: number; y: number; officer: boolean; down: boolean }> {
    return this.members.map((m) => ({ x: m.x, y: m.y, officer: m.officer, down: m.down > 0 }));
  }

  get size(): number {
    return this.members.length;
  }

  /** How many are on their feet - the officer included. */
  get standing(): number {
    return this.members.reduce((n, m) => n + (m.down > 0 ? 0 : 1), 0);
  }

  /**
   * THE NEAREST GUARD (it.101): what main offers a hostile as its quarry when a
   * guard is closer to it than the hero is. A man on the ground is not offered.
   */
  nearest(x: number, y: number, max: number): SquadTarget | null {
    let best: Member | null = null;
    let bd = max * max;
    for (const m of this.members) {
      if (m.down > 0) continue;
      const d = (m.x - x) * (m.x - x) + (m.y - y) * (m.y - y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best ? { id: best.id, x: best.x, y: best.y } : null;
  }

  /**
   * A blow lands on a guard (it.101). The officer takes none - a field with no
   * officer left on it would have nobody to end the scene. Returns true if the
   * blow was taken, so main can play the hit where it actually happened.
   */
  hurt(id: number, amount: number): boolean {
    const m = this.members.find((q) => q.id === id);
    if (!m || m.down > 0) return false;
    m.flash = FLASH_TICKS;
    if (m.officer) return true; // the colours do not fall
    m.hp -= amount;
    if (m.hp <= 0) {
      m.hp = 0;
      m.down = DOWN_TICKS;
    }
    return true;
  }

  /** Where a guard stands, for the blood and the numbers over him. */
  posOf(id: number): { x: number; y: number } | null {
    const m = this.members.find((q) => q.id === id);
    return m ? { x: m.x, y: m.y } : null;
  }

  /**
   * ONE FIXED TICK. Walks each guard at the nearest hostile inside the leash of
   * the assault's anchor and swings when he is in reach. Runs in the sim, so a
   * co-op party stays in step.
   * @param foes    every living hostile on the floor.
   * @param hit     deals a blow through `CombatSystem.dealDamage`, credited to the hero.
   * @param anchor  where the assault is - the hero. The formation marches on it.
   */
  step(dt: number, foes: ReadonlyArray<SquadFoe>, hit: (targetId: number, amount: number) => void, anchor?: { x: number; y: number }): void {
    if (anchor) {
      this.ax = anchor.x;
      this.ay = anchor.y;
    }
    const cooldown = Math.max(1, Math.round(1 / (this.rate * dt)));
    for (const m of this.members) {
      m.px = m.x;
      m.py = m.y;
      if (m.cool > 0) m.cool--;
      if (m.flash > 0) m.flash--;
      if (m.down > 0) {
        // On the ground: he takes no part, and gets up with half his wind back.
        if (--m.down === 0) m.hp = Math.max(1, Math.round(m.hpMax * 0.5));
        continue;
      }
      const homeX = this.ax + m.ox;
      const homeY = this.ay + m.oy;
      let best: SquadFoe | null = null;
      let bd = Infinity;
      if (this.fighting) {
        for (const f of foes) {
          if (f.hp <= 0 || f.action === 'dead') continue;
          // Anything inside the assault's reach is fair game - the line CLOSES
          // on the enemy instead of holding a spot behind it (it.101).
          if (Math.hypot(f.pos.x - this.ax, f.pos.y - this.ay) > this.leash) continue;
          const d = Math.hypot(f.pos.x - m.x, f.pos.y - m.y);
          if (d < bd) {
            bd = d;
            best = f;
          }
        }
      }
      // EACH MAN HIS OWN SIDE OF THE BODY (it.101). Every guard used to steer at
      // the foe's exact centre, so a squad arrived as one sprite on one tile. Each
      // now takes a place on a ring round it, dealt by id on the golden angle, so
      // they close from different quarters and the melee reads as a melee.
      const ang = m.id * GOLDEN;
      const goal = best
        ? { x: best.pos.x + Math.cos(ang) * REACH * 0.8, y: best.pos.y + Math.sin(ang) * REACH * 0.8 }
        : { x: homeX, y: homeY };
      const dx = goal.x - m.x;
      const dy = goal.y - m.y;
      const dist = Math.hypot(dx, dy);
      const stop = 0.3;
      if (dist > stop) {
        const step = Math.min(dist - stop, SPEED * dt);
        let ux = dx / dist;
        let uy = dy / dist;
        // WEDGED (it.101): blocked on every axis for a while means the direct line
        // is through a hedge or a barn. Pick a side and walk round it for a spell.
        if (m.slip !== 0) {
          const px = -uy * m.slip;
          const py = ux * m.slip;
          ux = (ux + px * 1.6) / 2;
          uy = (uy + py * 1.6) / 2;
          const n = Math.hypot(ux, uy) || 1;
          ux /= n;
          uy /= n;
        }
        const nx = m.x + ux * step;
        const ny = m.y + uy * step;
        // Slide along whatever he cannot walk through, rather than sticking.
        if (canStandAt(nx, ny, this.isWalkable)) {
          m.x = nx;
          m.y = ny;
          m.stuck = 0;
        } else if (canStandAt(nx, m.y, this.isWalkable)) {
          m.x = nx;
          m.stuck = 0;
        } else if (canStandAt(m.x, ny, this.isWalkable)) {
          m.y = ny;
          m.stuck = 0;
        } else if (++m.stuck > WEDGED) {
          m.stuck = 0;
          m.slip = m.slip !== 0 ? -m.slip : (m.id % 2 === 0 ? 1 : -1);
        }
        if (m.slip !== 0 && m.stuck === 0 && dist < 1.2) m.slip = 0; // arrived: walk straight again
        m.clock += step * 0.55;
        m.dir = stableDir(dx / dist, dy / dist, m.dir);
      } else {
        m.slip = 0;
        if (best) {
          const fx = best.pos.x - m.x;
          const fy = best.pos.y - m.y;
          const fd = Math.hypot(fx, fy) || 1;
          m.dir = stableDir(fx / fd, fy / fd, m.dir);
          if (fd <= REACH + 0.35 && m.cool === 0) {
            m.cool = cooldown;
            hit(best.id, this.damage);
          }
        }
      }
    }
    // SHOULDERS (it.101): no two of them may stand in the same place. Resolved in
    // a fixed order over the member list, so every peer resolves it identically.
    for (let i = 0; i < this.members.length; i++) {
      const a = this.members[i];
      if (a.down > 0) continue;
      for (let j = i + 1; j < this.members.length; j++) {
        const b = this.members[j];
        if (b.down > 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= SPACING || d === 0) continue;
        const push = (SPACING - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        if (canStandAt(a.x - ux * push, a.y - uy * push, this.isWalkable)) {
          a.x -= ux * push;
          a.y -= uy * push;
        }
        if (canStandAt(b.x + ux * push, b.y + uy * push, this.isWalkable)) {
          b.x += ux * push;
          b.y += uy * push;
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
      // The scene's light, then the plate's own colour, then the white of a blow.
      const lit = tint(x, y);
      m.body.tint = m.flash > 0 ? 0xffffff : mul(lit, m.tint);
      m.body.alpha = m.down > 0 ? 0.55 : 1;
      m.root.rotation = m.down > 0 ? 0.9 : 0; // felled, until the others get him up
      m.mark.alpha = m.down > 0 ? 0.12 : m.officer ? 0.72 : 0.34;
      if (m.flag) m.flag.tint = lit;
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

/** Two tints multiplied channel by channel - the scene's light through the plate. */
function mul(a: number, b: number): number {
  const r = (((a >> 16) & 0xff) * ((b >> 16) & 0xff)) / 255;
  const g = (((a >> 8) & 0xff) * ((b >> 8) & 0xff)) / 255;
  const bl = ((a & 0xff) * (b & 0xff)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
