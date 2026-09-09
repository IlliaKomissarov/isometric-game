/**
 * @module systems/Squad
 * THE CITY'S OWN (it.100, fought properly it.101, cut loose it.102) — the
 * guards who go into the fields with you.
 *
 * A squad member is NOT an `Enemy` with a flag flipped. Hostiles chase one
 * quarry at a time, handed to them by `EnemyAIDeps.getPlayerPos`, so an ally is
 * only ever attacked because main CHOSE to offer it as that quarry (it.101) —
 * there is still no faction field anywhere, and the hero's own target picking
 * only ever sees enemies, so friendly fire remains impossible by construction.
 *
 * WHAT it.102 CHANGED — THEY ARE NOT ON A LEASH ANY MORE. In it.101 the
 * formation was anchored to the HERO: the squad was a ring that marched wherever
 * the player walked and only ever fought what the player walked into. It read as
 * an escort, not as an army. Now:
 *
 *   - THE LINE IS ITS OWN. The company keeps a front of its own (`lx`,`ly`) and
 *     advances it on the OBJECTIVE — the ground the enemy holds — at a march
 *     pace, on its own, whether or not the hero follows. The hero is not
 *     consulted; `step` no longer takes an anchor for the formation at all.
 *   - EVERY MAN PICKS HIS OWN FIGHT. A guard breaks on the nearest hostile
 *     inside HIS OWN sight, not inside a radius of the player, and runs it down.
 *   - EVERY MAN WALKS HIS OWN ROAD. Each has an A* path of his own, repathed on
 *     his own stagger, so a hedge or a barn between him and his quarry is walked
 *     round instead of leaned on.
 *
 * WHAT it.103 CHANGED - THEY FLOCK. it.102 cut the squad loose but still moved
 * every man straight at his goal and only unpicked the overlaps AFTERWARDS, with
 * a positional shoulder pass; the result on screen was a glued mass that squeezed
 * through gaps as one body and stacked four deep on whatever it reached. Now:
 *
 *   - SEPARATION IS STEERING, not a correction. Each man sums a repulsion off
 *     every neighbour inside `PERSONAL` and blends it into his heading BEFORE he
 *     steps - hard when closing on a body, gentle out on the march. The shoulder
 *     pass is left in as a backstop for what steering cannot solve.
 *   - IT IS ORDER-INDEPENDENT. Positions are snapshotted before anyone moves, so
 *     the flock a man feels is the same whether he is first or last in the list.
 *   - THE RING ROUND A BODY IS DEALT BY THE PACK. A man's place is his index
 *     among the men who came for THAT body, spread over a full circle, and the
 *     ring widens with the pack - so six men surround a brigand instead of four
 *     of them arriving on the same shoulder.
 *   - NO TWO OF THEM WALK AT THE SAME PACE. Each carries a multiplier off the
 *     floor seed, so the line arrives ragged, the way a charge does.
 *   - EVERY MAN CARRIES HIS OWN LIFE ON HIS HEAD: a blue bar, the mirror of the
 *     red one every hostile wears, so a squad being ground down is visible.
 *   - THE RANKS ARE DIFFERENT MEN (it.102): guards, knights and rangers dealt
 *     off the atlas from the floor seed, not one repeated silhouette.
 *   - The officer is a head taller in white plate under the colours, and nothing
 *     can kill him; the rest can be put down, and are helped up after a spell.
 *
 * DETERMINISM. Everything that touches hp runs on the fixed sim tick through
 * `step()`, and `CombatSystem.dealDamage` stays the only mutator of ENTITY hp —
 * a guard's blow is credited to the hero, so experience, loot and the difficulty
 * floor all behave exactly as they would if the hero had swung. A guard's own hp
 * is not entity state (a guard is not in `state`), so it lives here, stepped on
 * the same tick on every peer. The kit roll is drawn from the FLOOR SEED through
 * a private `mulberry32`, so every peer deals the same men. `draw()` is
 * render-only and may use the wall clock. Nothing here consumes `Math.random`.
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { spriteLib, stableDir, type AnimName } from '@/render/SpriteLibrary';
import { depthKey, worldToScreen } from '@/utils/iso';
import { mulberry32 } from '@/utils/rng';
import { vec2 } from '@/utils/Vec2';
import { canStandAt, type WalkableFn } from './Collision';
import type { Pathfinder } from './Pathfinding';

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
  /** The walk / run cycle. */
  anim: AnimName;
  /**
   * THE OTHER TWO THINGS A SOLDIER DOES (it.105). Up to it.104 the squad owned
   * ONE sheet and drew frame 0 of it whenever a man was not moving - so a guard
   * in a melee was a still photograph of a man running, which is exactly what
   * "they stand in place without attacking and their animations aren't working"
   * looks like. He idles when he is standing and swings when he swings.
   */
  idle: AnimName;
  attack: AnimName;
  height: number;
  tint: number;
}

/**
 * THE RANKS (it.101, widened it.102, re-cast it.104). Household knights in
 * plate, rangers of the eastern road, and scouts of the ward.
 *
 * `guard_walk` IS GONE FROM THIS LIST, for two reasons that are both fatal:
 *
 *   1. IT IS THE LOWEST-RESOLUTION HUMAN SHEET IN THE PACK. It is baked at half
 *      resolution and its painted body is 48 atlas pixels tall - drawn at 60
 *      units it is upscaled and soft, next to `ranger_run` at 168 and
 *      `rogue_run` at 88, which are baked at full resolution.
 *   2. THE BRIGAND WEARS IT. `FARM_POOL` contains `brigand`, whose sprite is
 *      `guard_walk` - so on the one floor the squad exists, friend and foe were
 *      the same silhouette in two tints. The it.101 comment here claimed the
 *      opposite and was simply wrong.
 *
 * Every sheet below is an EIGHT-DIRECTION rig baked at full resolution that NO
 * hostile on this floor wears (the company is `captain_*`, the bandits are
 * `poacher_*`, the brigands are `guard_*`), so friend and foe never share a
 * silhouette again.
 */
const KNIGHT = { anim: 'knight_run', idle: 'knight_idle', attack: 'knight_melee' } as const;
const RANGER = { anim: 'ranger_run', idle: 'ranger_idle', attack: 'ranger_attack' } as const;
const SCOUT = { anim: 'rogue_run', idle: 'rogue_idle', attack: 'rogue_attack' } as const;
export const SQUAD_RANKS: ReadonlyArray<SquadKit> = [
  { ...KNIGHT, height: 63, tint: 0xdfe6f2 }, // a household knight, in steel
  { ...RANGER, height: 60, tint: 0xbcd8b4 }, // a ranger of the eastern road
  { ...KNIGHT, height: 61, tint: 0xe2d2a8 }, // a knight in gilt
  { ...SCOUT, height: 57, tint: 0xb4c0d4 }, // a scout of the ward
  { ...RANGER, height: 59, tint: 0xd0c8a0 }, // a bowman of the militia
  { ...KNIGHT, height: 62, tint: 0xaebad2 }, // a knight in blued plate
  { ...SCOUT, height: 56, tint: 0xc8d8e0 }, // a second of the ward's scouts
  { ...RANGER, height: 58, tint: 0xc0c8b0 }, // a second bowman
];
/** The officer: a head taller, in white plate, and he carries the colours. */
export const SQUAD_OFFICER: SquadKit = { ...KNIGHT, height: 72, tint: 0xfff2d0 };
/** Every sheet the squad can ever draw, for the floor's preload (it.105). */
export const SQUAD_ANIMS: ReadonlyArray<AnimName> = [
  ...new Set([...SQUAD_RANKS, SQUAD_OFFICER].flatMap((k) => [k.anim, k.idle, k.attack])),
];

export interface SquadOptions {
  /** Blows a second, per guard. */
  rate?: number;
  /** Damage a blow, before the target's armour. */
  damage?: number;
  /** How far a guard sees, and will break formation to run something down. */
  leash?: number;
  /** What a guard can take before he goes down (the officer takes none). */
  toughness?: number;
  /**
   * THE OBJECTIVE (it.102): the ground the company is taking. The line walks at
   * it on its own. Omitted, the squad holds where it mustered.
   */
  objective?: { x: number; y: number };
  /** The floor's seed: what the ranks are dealt from, identically on every peer. */
  seed?: number;
  /** A* over the floor's grid, so a guard walks round a barn instead of into it. */
  pathfinder?: Pathfinder;
  /**
   * THEATRE (it.103). A man is put down, and a man is helped back up. Both are
   * called from the sim tick and are expected to do render-side work only - the
   * squad's own hp is not entity state, so nothing here can desync a party.
   */
  onFell?: (x: number, y: number) => void;
  onRose?: (x: number, y: number) => void;
}

interface Member {
  root: Container;
  body: Sprite;
  mark: Sprite;
  /** THE BLUE BAR (it.102): this man's own life, over his own head. */
  bar: Graphics;
  /** The colours over the officer's head, if he is the one carrying them. */
  flag: Sprite | null;
  /**
   * HIS LANE (it.104). Where he stands relative to the company's front, but
   * expressed in the frame the ADVANCE is in: `lane` is his place across the
   * front (negative left, positive right of the march) and `depth` how far
   * ahead of or behind it he walks. The front is rebuilt from these every tick
   * against the current heading, so the company keeps a broad skirmish line
   * that turns with the march instead of carrying the muster's shape - which
   * was pointing north-east - around the map for the whole battle.
   */
  lane: number;
  depth: number;
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
  /** How many sidesteps in a row have failed him (it.104): three and he is lifted clear. */
  wedges: number;
  /** HIS OWN ROAD (it.102): the A* waypoints left, and the tick he repaths on. */
  road: Array<{ x: number; y: number }>;
  repath: number;
  /** What he is walking at, so a road is only recut when the goal really moved. */
  goalX: number;
  goalY: number;
  /** THE FLOCK (it.103): who he is fighting, his index in the pack on that body, and how many came. */
  foe: SquadFoe | null;
  slot: number;
  pack: number;
  /** His own pace - no two of them walk at quite the same speed (it.103). */
  paceMul: number;
  /** His three sheets, and which one is on the sprite right now (it.105). */
  anim: AnimName;
  idle: AnimName;
  attack: AnimName;
  shown: AnimName | null;
  /** Ticks left of the swing being played; 0 is not swinging. */
  swing: number;
  height: number;
  scale: number;
  tint: number;
  fc: number;
  /** The last bar fraction drawn, so the Graphics is only rebuilt on change. */
  drawnHp: number;
}

const SPEED = 3.0; // tiles a second, closing on a body - a shade quicker than the hero
/** THE MARCH (it.102): the pace the line advances at when nothing is in reach. */
const MARCH = 1.75;
const REACH = 1.2;
/** How close two guards may stand before they shoulder each other apart (it.101). */
const SPACING = 0.62;
/**
 * THE FLOCK (it.103). `PERSONAL` is the radius a man steers away from another
 * inside - wider than `SPACING`, because the point is to never REACH the
 * shoulder pass. The two weights say how hard that steering pulls: hard when
 * he is closing on a body (that is where a squad used to stack into one
 * sprite), gentle out on the march (a line that repels itself too hard fans
 * out into a smear instead of a company).
 */
const PERSONAL = 1.15;
const SEPARATION_NEAR = 1.25;
const SEPARATION_FAR = 0.55;
/** Tiles a second a man shuffles sideways when he is on his mark but crowded. */
const SHUFFLE = 1.1;
/**
 * THE SKIRMISH LINE (it.104). `LANE` is the gap between two men ACROSS the
 * march and `DEPTH` the stagger along it: eight men at 2.3 hold a front some
 * sixteen tiles wide, a quarter of the field, which is what "fan out" has to
 * mean on a map this size. Wider than this and the flanks stop supporting each
 * other; narrower and it reads as a column again.
 */
const LANE = 2.3;
const DEPTH = 1.6;
/** The golden angle: consecutive ids land on opposite sides of the same body. */
const GOLDEN = 2.399963;
/** Blocked this many ticks running and a guard picks a side and walks round. */
const WEDGED = 18;
/** How long a guard lies before the others get him up again. */
const DOWN_TICKS = 420;
const FLASH_TICKS = 7;
/** How long a blow is PLAYED for - a quarter second, whatever the cadence is (it.105). */
const SWING_TICKS = 15;
/** How many of them may take the same body before the rest look elsewhere (it.104). */
const MAX_ON_ONE = 2;
/** Ticks between A* recuts, per man (staggered by id so they never all cut at once). */
const REPATH_TICKS = 42;
/** The line stops advancing while anything hostile is this close to any of them. */
const ENGAGED = 7;

export class Squad {
  private readonly members: Member[] = [];
  private readonly scratch = vec2();
  private readonly rate: number;
  private readonly damage: number;
  private readonly leash: number;
  private readonly pathfinder: Pathfinder | null;
  private readonly onFell: ((x: number, y: number) => void) | null;
  private readonly onRose: ((x: number, y: number) => void) | null;
  /** THE FRONT (it.102): where the company's line is. It is the squad's own. */
  private lx = 0;
  private ly = 0;
  /** Where the line is walking, and where it mustered (its fallback). */
  private readonly objX: number;
  private readonly objY: number;
  /** Whose tick it is to recut a road: one man a tick, so A* never spikes. */
  private tick = 0;
  /** Render-side clock for the idle cycle (it.105) - never read by the sim. */
  private idleClock = 0;
  /** Set false once the field is won: the squad stands down and stops swinging. */
  fighting = true;
  /**
   * 1/zoom (clamped), set by main each frame exactly as `Enemy.hudScale` is, so
   * the blue bars hold their screen size at any zoom (it.102).
   */
  static hudScale = 1;

  constructor(
    layer: Container,
    private readonly isWalkable: WalkableFn,
    spots: ReadonlyArray<{ x: number; y: number; officer?: boolean }>,
    opts: SquadOptions = {},
  ) {
    this.rate = opts.rate ?? 1.1;
    this.damage = opts.damage ?? 9;
    this.leash = opts.leash ?? 16;
    this.pathfinder = opts.pathfinder ?? null;
    this.onFell = opts.onFell ?? null;
    this.onRose = opts.onRose ?? null;
    const tough = opts.toughness ?? 90;
    // The line's shape is read off the spots the floor named, but kept as
    // OFFSETS: the front moves on the objective, so the shape marches with it.
    let cx = 0;
    let cy = 0;
    for (const s of spots) {
      cx += s.x + 0.5;
      cy += s.y + 0.5;
    }
    cx /= Math.max(1, spots.length);
    cy /= Math.max(1, spots.length);
    this.lx = cx;
    this.ly = cy;
    this.objX = opts.objective?.x ?? cx;
    this.objY = opts.objective?.y ?? cy;
    // THE RANKS ARE DEALT, NOT REPEATED (it.102). One private stream off the
    // floor seed, so a co-op party turns out the same men in the same order and
    // nothing here can move the shared combat RNG.
    const rand = mulberry32(((opts.seed ?? 0x5a1d) ^ 0x9e37) >>> 0);
    const ranks = SQUAD_RANKS.filter((k) => spriteLib.hasAnim(k.anim));
    const bag: SquadKit[] = [];
    let nextId = 1;
    for (const s of spots) {
      // A bag shuffled from the seed: every rank comes up before any repeats.
      if (!bag.length) {
        bag.push(...(ranks.length ? ranks : SQUAD_RANKS));
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
      }
      const kit = s.officer ? SQUAD_OFFICER : bag.pop()!;
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
      // HIS FEET ARE ON THE GROUND (it.104). A sliced frame keeps its original
      // size, and the packs leave wildly different amounts of air under a body -
      // `anchor.set(0.5, 1)` hung a guard seventy screen pixels over his own
      // shadow. `footAnchor` is that number computed from the painted bounds.
      const foot = spriteLib.footAnchor(kit.anim);
      body.anchor.set(foot.x, foot.y);
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
      // THE BLUE BAR (it.102), sat where a hostile wears its red one, so the two
      // read as one language: friend above, foe above, same shape, other colour.
      const bar = new Graphics();
      bar.position.set(0, -(kit.height / 0.8) - 10);
      root.addChild(bar);
      layer.addChild(root);
      this.members.push({
        root, body, mark, bar, flag,
        lane: 0, depth: 0,
        x: s.x + 0.5, y: s.y + 0.5, px: s.x + 0.5, py: s.y + 0.5,
        dir: 4, clock: 0, cool: 0, officer: !!s.officer, id: nextId++,
        hp: tough, hpMax: tough, down: 0, flash: 0, stuck: 0, slip: 0, wedges: 0,
        road: [], repath: 0, goalX: NaN, goalY: NaN,
        foe: null, slot: 0, pack: 1, paceMul: 0.86 + rand() * 0.28,
        anim: kit.anim, idle: spriteLib.hasAnim(kit.idle) ? kit.idle : kit.anim,
        attack: spriteLib.hasAnim(kit.attack) ? kit.attack : kit.anim,
        shown: null, swing: 0, height: kit.height,
        scale, tint: kit.tint, fc: spriteLib.anim(kit.anim).frameCount,
        drawnHp: -1,
      });
    }
    // THE LINE IS DEALT ACROSS THE FRONT (it.104). Lanes run symmetrically out
    // from the centre - officer in the middle, everyone else alternating left
    // and right - and each man is given his own depth, so the company advances
    // as a ragged skirmish line a dozen tiles wide instead of a knot.
    const order = [...this.members].sort((p, q) => (p.officer === q.officer ? p.id - q.id : p.officer ? -1 : 1));
    order.forEach((m, i) => {
      m.lane = i === 0 ? 0 : (Math.ceil(i / 2) * (i % 2 === 1 ? -1 : 1));
      m.depth = ((m.id * 7) % 3) - 1;
    });
    for (const m of this.members) this.redrawBar(m);
  }

  /** Every friendly head, for the cutaway occluders and the ally markers. */
  positions(): Array<{ x: number; y: number; officer: boolean; down: boolean }> {
    return this.members.map((m) => ({ x: m.x, y: m.y, officer: m.officer, down: m.down > 0 }));
  }

  /**
   * HOW SPREAD OUT THEY ARE (it.103), for the harness and for tuning: the
   * closest two standing men, and the mean distance over every pair. A squad
   * that has clumped reads as a `min` near zero; a squad that is flocking keeps
   * `min` at about `PERSONAL` even in the middle of a melee.
   */
  spacing(): { min: number; mean: number; span: number; n: number } {
    const up = this.members.filter((m) => m.down === 0);
    let min = Infinity;
    let span = 0;
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < up.length; i++)
      for (let j = i + 1; j < up.length; j++) {
        const d = Math.hypot(up[j].x - up[i].x, up[j].y - up[i].y);
        if (d < min) min = d;
        if (d > span) span = d;
        sum += d;
        pairs++;
      }
    return { min: pairs ? min : 0, mean: pairs ? sum / pairs : 0, span, n: up.length };
  }

  /** The ranks, for the harness: which sheet each man turned out in (it.102). */
  roster(): Array<{ id: number; anim: AnimName; officer: boolean; hp: number; hpMax: number; anchorY: number; lane: number }> {
    return this.members.map((m) => ({ id: m.id, anim: m.anim, officer: m.officer, hp: m.hp, hpMax: m.hpMax, anchorY: m.body.anchor.y, lane: m.lane }));
  }

  /** Where the company's own front stands (it.102) - not the hero's position. */
  get front(): { x: number; y: number } {
    return { x: this.lx, y: this.ly };
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
      this.onFell?.(m.x, m.y);
    }
    return true;
  }

  /** Where a guard stands, for the blood and the numbers over him. */
  posOf(id: number): { x: number; y: number } | null {
    const m = this.members.find((q) => q.id === id);
    return m ? { x: m.x, y: m.y } : null;
  }

  /**
   * ONE FIXED TICK. The line advances on its objective by itself; each man takes
   * the nearest hostile inside HIS OWN sight and walks his own road to it. Runs
   * in the sim, so a co-op party stays in step.
   *
   * @param foes    every living hostile on the floor.
   * @param hit     deals a blow through `CombatSystem.dealDamage`, credited to the
   *                hero, and is told WHERE THE SWING CAME FROM (it.103) so the arc
   *                can be drawn off the right shoulder.
   * @param rally   where the company falls in ONCE THE FIGHTING IS OVER (the hero).
   *                It has no part in the advance: while `fighting`, the squad is
   *                nobody's escort (it.102).
   */
  step(dt: number, foes: ReadonlyArray<SquadFoe>, hit: (targetId: number, amount: number, from: { x: number; y: number }) => void, rally?: { x: number; y: number }): void {
    this.tick++;
    const cooldown = Math.max(1, Math.round(1 / (this.rate * dt)));
    // EVERY MAN SEES THE SAME TICK (it.103). Positions are snapshotted BEFORE
    // anyone moves, and the flocking below reads only the snapshot - so the
    // separation a man feels does not depend on where he sits in the member
    // list. Without this the first guard steered around nobody and the last
    // steered around seven already-moved bodies, which is exactly the "one
    // glued mass with a tail" the old pass produced.
    for (const m of this.members) {
      m.px = m.x;
      m.py = m.y;
    }
    // ---- THE LINE (it.102): its own advance, on its own objective ----------
    // It holds while any of them is engaged, so the company does not walk out
    // from under the men who are actually fighting.
    let engaged = false;
    if (this.fighting) {
      for (const f of foes) {
        if (f.hp <= 0 || f.action === 'dead') continue;
        for (const m of this.members) {
          if (m.down > 0) continue;
          if (Math.hypot(f.pos.x - m.x, f.pos.y - m.y) < ENGAGED) {
            engaged = true;
            break;
          }
        }
        if (engaged) break;
      }
    }
    {
      // Standing down (the field is won): the line falls in on the hero. Fighting:
      // it walks at the ground the enemy holds and never asks where the hero is.
      const tx = this.fighting ? this.objX : rally?.x ?? this.lx;
      const ty = this.fighting ? this.objY : rally?.y ?? this.ly;
      const dx = tx - this.lx;
      const dy = ty - this.ly;
      const d = Math.hypot(dx, dy);
      // A company under contact does not stop, it presses - at a quarter pace,
      // so the men who are actually swinging are never walked out from under.
      // IT.105: a quarter pace under contact was slow enough to read as a halt on
      // a field sixty tiles across. It still yields to the men who are swinging,
      // but the company is visibly walking the whole time.
      const pace = this.fighting ? (engaged ? MARCH * 0.5 : MARCH) : MARCH;
      const hold = !this.fighting && d < 3;
      if (!hold && d > 0.4) {
        const step = Math.min(d - 0.4, pace * dt);
        const nx = this.lx + (dx / d) * step;
        const ny = this.ly + (dy / d) * step;
        // The front slides along whatever it cannot cross, so a barn in the way
        // bends the advance instead of stalling it.
        if (canStandAt(nx, ny, this.isWalkable)) {
          this.lx = nx;
          this.ly = ny;
        } else if (canStandAt(nx, this.ly, this.isWalkable)) this.lx = nx;
        else if (canStandAt(this.lx, ny, this.isWalkable)) this.ly = ny;
      }
    }
    // WHICH WAY THE COMPANY IS FACING (it.104): from the front to the ground it
    // is taking. The skirmish line is laid out ACROSS this, so it turns with the
    // march. A degenerate heading (the line standing on its objective) falls
    // back to due west, which is the way this floor's battle runs.
    let headX = this.fighting ? this.objX - this.lx : (rally?.x ?? this.lx) - this.lx;
    let headY = this.fighting ? this.objY - this.ly : (rally?.y ?? this.ly) - this.ly;
    const headLen = Math.hypot(headX, headY);
    if (headLen < 0.001) {
      headX = -1;
      headY = 0;
    } else {
      headX /= headLen;
      headY /= headLen;
    }
    const perpX = -headY;
    const perpY = headX;
    // ---- WHO EACH MAN IS FIGHTING (it.103) --------------------------------
    // Chosen for everybody first, because the RING a man takes round a body
    // depends on how many others picked the SAME body. Six men converging on one
    // brigand used to be dealt six angles off the whole squad's id space, which
    // put four of them on the same side of him; now they are dealt the angles of
    // a circle divided by however many actually came, so they surround him.
    // TWO MEN TO A BODY, NO MORE (it.104). Nearest-foe-per-man sent all eight at
    // whichever knot of the company the squad met first, and the "fan out" the
    // lanes had just built collapsed back into one scrum three tiles across.
    // Every hostile takes at most `MAX_ON_ONE` claimants, in member order; a
    // guard who finds nothing unclaimed in his sight takes the next thing along
    // instead - which is what makes the company spread across several fights at
    // once. He only breaks the cap for a body already on top of him.
    const claims = new Map<number, number>();
    for (const m of this.members) {
      m.foe = null;
      if (m.down > 0 || !this.fighting) continue;
      let bd = this.leash;
      let crowded: SquadFoe | null = null;
      let cd = 2.2;
      // NOBODY STANDS ABOUT (it.105). The nearest hostile in his leash, claimed
      // or not - see below.
      let anyone: SquadFoe | null = null;
      let ad = this.leash;
      for (const f of foes) {
        if (f.hp <= 0 || f.action === 'dead') continue;
        const d = Math.hypot(f.pos.x - m.x, f.pos.y - m.y);
        if (d < ad) {
          ad = d;
          anyone = f;
        }
        // HIS OWN SIGHT (it.102): what HE can see, not what the hero walked into.
        if ((claims.get(f.id) ?? 0) >= MAX_ON_ONE) {
          if (d < cd) {
            cd = d;
            crowded = f;
          }
          continue;
        }
        if (d < bd) {
          bd = d;
          m.foe = f;
        }
      }
      if (!m.foe) m.foe = crowded; // in the middle of it already: swing at what is there
      /**
       * A MAN WITH NOTHING TO DO WALKS TOWARD THE FIGHT (it.105). `MAX_ON_ONE`
       * stops eight guards piling onto one body, but it left the overflow with
       * `foe === null`, and a man with no foe holds his mark on the line - which
       * creeps at a quarter pace while anyone is engaged. Late in a battle, with
       * two brigands left and four claims between them, that is half the company
       * standing still in a field: exactly the "they just stand in place" this
       * iteration is about. The cap still decides who SURROUNDS a body; it no
       * longer decides who is allowed to move. The ring widens with the pack, so
       * the extra men close in behind rather than stacking on the same tile.
       */
      if (!m.foe) m.foe = anyone;
      if (m.foe) claims.set(m.foe.id, (claims.get(m.foe.id) ?? 0) + 1);
    }
    for (const m of this.members) {
      if (!m.foe) {
        m.slot = 0;
        m.pack = 1;
        continue;
      }
      let slot = 0;
      let pack = 0;
      for (const o of this.members) {
        if (o.down > 0 || o.foe !== m.foe) continue;
        if (o === m) slot = pack;
        pack++;
      }
      m.slot = slot;
      m.pack = Math.max(1, pack);
    }
    // ---- EVERY MAN HIS OWN FIGHT ------------------------------------------
    for (const m of this.members) {
      if (m.cool > 0) m.cool--;
      if (m.flash > 0) m.flash--;
      if (m.swing > 0) m.swing--;
      if (m.down > 0) {
        // On the ground: he takes no part, and gets up with half his wind back.
        if (--m.down === 0) {
          m.hp = Math.max(1, Math.round(m.hpMax * 0.5));
          this.onRose?.(m.x, m.y);
        }
        continue;
      }
      const homeX = this.lx + perpX * m.lane * LANE + headX * m.depth * DEPTH;
      const homeY = this.ly + perpY * m.lane * LANE + headY * m.depth * DEPTH;
      const best = m.foe;
      // THE RING ROUND A BODY (it.101, dealt properly it.103). His place is his
      // index among the men who came for THIS body, spread over a full circle and
      // nudged by the golden angle so two packs of the same size never line up
      // identically. The ring widens with the pack: two men stand close in, six
      // stand off, and none of them is inside another.
      const ring = REACH * (0.75 + Math.min(4, m.pack - 1) * 0.16);
      const ang = (m.slot / m.pack) * Math.PI * 2 + m.id * GOLDEN * 0.35;
      const goal = best
        ? { x: best.pos.x + Math.cos(ang) * ring, y: best.pos.y + Math.sin(ang) * ring }
        : { x: homeX, y: homeY };
      // HIS OWN ROAD (it.102). Far from the goal, he walks A* waypoints; inside a
      // few tiles he steers straight at it, so the last step of a charge is not
      // quantised to tile centres. One recut a man, staggered on his id.
      const far = Math.hypot(goal.x - m.x, goal.y - m.y);
      if (this.pathfinder && far > 3.5) {
        const moved = Math.hypot(goal.x - m.goalX, goal.y - m.goalY) > 1.5 || Number.isNaN(m.goalX);
        if ((moved || m.road.length === 0) && this.tick >= m.repath) {
          m.repath = this.tick + REPATH_TICKS + (m.id % 7);
          m.goalX = goal.x;
          m.goalY = goal.y;
          m.road = this.pathfinder.findPath(Math.floor(m.x), Math.floor(m.y), Math.floor(goal.x), Math.floor(goal.y)) ?? [];
        }
      } else m.road.length = 0;
      let aim = goal;
      if (m.road.length) {
        const w = m.road[0];
        if (Math.hypot(w.x + 0.5 - m.x, w.y + 0.5 - m.y) < 0.55) m.road.shift();
        const nextWp = m.road[0];
        if (nextWp) aim = { x: nextWp.x + 0.5, y: nextWp.y + 0.5 };
      }
      const dx = aim.x - m.x;
      const dy = aim.y - m.y;
      const dist = Math.hypot(dx, dy);
      const stop = m.road.length ? 0.05 : 0.3;
      // ---- SEPARATION (it.103) --------------------------------------------
      // The flocking half of the movement: a repulsion off every neighbour
      // inside `PERSONAL`, weighted by how far inside it he is, summed and
      // blended into the heading BEFORE the step is taken. The positional
      // shoulder pass at the bottom is now only a backstop for the cases
      // steering cannot solve (a man pinned against a wall by two others);
      // the fanning-out itself happens here, while they are still walking.
      let sx = 0;
      let sy = 0;
      for (const o of this.members) {
        if (o === m || o.down > 0) continue;
        const ox = m.px - o.px;
        const oy = m.py - o.py;
        const od = Math.hypot(ox, oy);
        if (od >= PERSONAL) continue;
        if (od < 1e-4) {
          // Exactly on top of one another: push apart on a fixed axis, so every
          // peer resolves the degenerate case the same way.
          sx += m.id < o.id ? 1 : -1;
          continue;
        }
        const push = (PERSONAL - od) / PERSONAL;
        sx += (ox / od) * push;
        sy += (oy / od) * push;
      }
      const sepLen = Math.hypot(sx, sy);
      if (dist > stop) {
        // Charging is quicker than marching, and no two of them move at quite
        // the same pace (it.103) - a line of identical speeds arrives as a wall.
        const pace = (best ? SPEED : MARCH + 0.8) * m.paceMul;
        const step = Math.min(dist - stop, pace * dt);
        let ux = dx / dist;
        let uy = dy / dist;
        if (sepLen > 1e-4) {
          // Close in on a body, separation is allowed to dominate; out on the
          // march it only bends the line. Either way the man keeps moving.
          const w = (best && dist < 3 ? SEPARATION_NEAR : SEPARATION_FAR) * Math.min(1.6, sepLen);
          ux += (sx / sepLen) * w;
          uy += (sy / sepLen) * w;
          const n = Math.hypot(ux, uy) || 1;
          ux /= n;
          uy /= n;
        }
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
          m.wedges++;
          m.slip = m.slip !== 0 ? -m.slip : (m.id % 2 === 0 ? 1 : -1);
          m.road.length = 0; // the road he was on does not work: cut a new one
          m.repath = 0;
          // PINNED (it.104). Sidestepping solves a hedge; it does not solve a man
          // shouldered into the corner of a barn by two others, and a guard who
          // spends the battle vibrating against a wall is the "pathfinding
          // blockage" the field reads as. After three failed sidesteps he is put
          // on the nearest tile he can actually stand on - searched outward in a
          // fixed order, so every peer moves him to the same one.
          if (m.wedges >= 3) {
            m.wedges = 0;
            for (let r = 1; r <= 3 && m.stuck === 0; r++) {
              let placed = false;
              for (let oy = -r; oy <= r && !placed; oy++)
                for (let ox = -r; ox <= r; ox++) {
                  if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
                  const tx = Math.floor(m.x) + ox + 0.5;
                  const ty = Math.floor(m.y) + oy + 0.5;
                  if (!canStandAt(tx, ty, this.isWalkable)) continue;
                  m.x = tx;
                  m.y = ty;
                  m.px = tx;
                  m.py = ty;
                  m.slip = 0;
                  placed = true;
                  break;
                }
              if (placed) break;
            }
          }
        }
        if (m.slip !== 0 && m.stuck === 0 && dist < 1.2) m.slip = 0; // arrived: walk straight again
        m.clock += step * 0.55;
        m.dir = stableDir(dx / dist, dy / dist, m.dir);
      } else {
        m.slip = 0;
        // ON HIS MARK, BUT NOT ALONE (it.103). Standing still used to switch
        // separation off entirely, so the last half-tile of a converging charge
        // still ended in a stack. He shuffles instead, at a walking pace.
        if (sepLen > 0.15) {
          const step = Math.min(0.35, SHUFFLE * dt);
          const nx = m.x + (sx / sepLen) * step;
          const ny = m.y + (sy / sepLen) * step;
          if (canStandAt(nx, ny, this.isWalkable)) {
            m.x = nx;
            m.y = ny;
          } else if (canStandAt(nx, m.y, this.isWalkable)) m.x = nx;
          else if (canStandAt(m.x, ny, this.isWalkable)) m.y = ny;
          m.clock += step * 0.55; // he is walking sideways, so his legs move (it.105)
        }
      }
      // A body in reach is swung at whether or not he finished walking to his
      // place on the ring, so a guard shouldered off his mark still fights.
      if (best) {
        const fx = best.pos.x - m.x;
        const fy = best.pos.y - m.y;
        const fd = Math.hypot(fx, fy) || 1;
        if (fd <= REACH + 0.35) {
          m.dir = stableDir(fx / fd, fy / fd, m.dir);
          if (m.cool === 0) {
            m.cool = cooldown;
            m.swing = Math.min(cooldown, SWING_TICKS);
            hit(best.id, this.damage, { x: m.x, y: m.y });
          }
        }
      }
    }
    // SHOULDERS (it.101, a backstop since it.103): steering does the spacing
    // now, and this only unpicks the overlaps steering could not - a man pinned
    // between two others and a wall. Resolved in a fixed order over the member
    // list, so every peer resolves it identically.
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
    // The idle cycle runs on the RENDER clock: standing still must still breathe.
    this.idleClock += 1 / 60;
    for (const m of this.members) {
      const x = m.px + (m.x - m.px) * alpha;
      const y = m.py + (m.y - m.py) * alpha;
      const moving = Math.hypot(m.x - m.px, m.y - m.py) > 0.0005;
      // WHICH OF THE THREE HE IS DOING (it.105): swinging beats walking beats
      // standing. The sheets are different rigs with different painted heights,
      // so the scale and the foot anchor are re-derived on every change - which
      // is rare (a man changes sheet a few times a second at most).
      const want = m.swing > 0 ? m.attack : moving ? m.anim : m.idle;
      if (want !== m.shown) {
        m.shown = want;
        const painted = spriteLib.paintedHeight(want) || 90;
        const foot = spriteLib.footAnchor(want);
        m.body.anchor.set(foot.x, foot.y);
        m.body.scale.set(m.height / painted / 0.8);
        m.fc = spriteLib.anim(want).frameCount;
      }
      const frame =
        m.swing > 0
          ? Math.min(m.fc - 1, Math.floor((1 - m.swing / SWING_TICKS) * m.fc)) // one pass through the blow
          : moving
            ? Math.floor(m.clock * m.fc) % m.fc
            : Math.floor(this.idleClock * 6 + m.id) % m.fc; // breathing on the spot
      m.body.texture = spriteLib.frame(want, m.dir, Math.max(0, frame));
      // The scene's light, then the plate's own colour, then the white of a blow.
      const lit = tint(x, y);
      m.body.tint = m.flash > 0 ? 0xffffff : mul(lit, m.tint);
      m.body.alpha = m.down > 0 ? 0.55 : 1;
      m.root.rotation = m.down > 0 ? 0.9 : 0; // felled, until the others get him up
      m.mark.alpha = m.down > 0 ? 0.12 : m.officer ? 0.72 : 0.34;
      if (m.flag) m.flag.tint = lit;
      // THE BLUE BAR (it.102): redrawn only when the number under it moved, and
      // held at screen size the way every other overhead readout is.
      if (m.drawnHp !== m.hp) this.redrawBar(m);
      m.bar.scale.set(Squad.hudScale / 0.8); // the root is at 0.8: undo it, so a blue bar and a red one are one size
      m.bar.rotation = -m.root.rotation;
      const s = worldToScreen(x, y, this.scratch);
      m.root.position.set(s.x, s.y);
      m.root.zIndex = depthKey(x, y);
    }
  }

  destroy(): void {
    for (const m of this.members) m.root.destroy({ children: true });
    this.members.length = 0;
  }

  /**
   * The mirror of `Enemy.redrawHealthBar`: same 26x4 plate, same quarter
   * notches, city blue instead of blood red. The officer's is gold and always
   * full - nothing puts him down, and a bar that never moves would only lie.
   */
  private redrawBar(m: Member): void {
    const w = 26;
    const h = 4;
    m.drawnHp = m.hp;
    m.bar.clear();
    m.bar.rect(-w / 2 - 1, -1, w + 2, h + 2).fill({ color: 0x0a0a0c, alpha: 0.92 });
    const frac = Math.max(0, m.hp / m.hpMax);
    if (frac > 0) {
      m.bar.rect(-w / 2, 0, w * frac, h).fill(m.officer ? 0xd8b45c : 0x2f6fc4);
      m.bar.rect(-w / 2, 0, w * frac, 1.5).fill({ color: m.officer ? 0xffe6a8 : 0x7ab8ff, alpha: 0.75 }); // Top sheen.
    }
    for (let i = 1; i < 4; i++) m.bar.rect(-w / 2 + (w * i) / 4 - 0.5, -1, 1, h + 2).fill({ color: 0x0a0a0c, alpha: 0.95 });
  }
}

/** Two tints multiplied channel by channel - the scene's light through the plate. */
function mul(a: number, b: number): number {
  const r = (((a >> 16) & 0xff) * ((b >> 16) & 0xff)) / 255;
  const g = (((a >> 8) & 0xff) * ((b >> 8) & 0xff)) / 255;
  const bl = ((a & 0xff) * (b & 0xff)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
