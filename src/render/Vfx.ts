/**
 * @module render/Vfx
 * Animated spell effects (it.41): multi-frame strips baked from the fire /
 * water particle packs (`vfx_*` atlas anims, one direction). Pure render
 * layer — the simulation only ASKS for an effect through `SkillDeps.vfx`
 * and never reads anything back, so determinism is untouched.
 *
 * Effects live in the depth-sorted object layer (they sit among bodies:
 * a firewall burns in front of what stands behind it) unless `overlay`
 * puts them in the ambience layer above everything. `loop` effects run
 * until their handle is stopped (firewall beds, auras).
 *
 * THE `fx_*` STRIPS (it.115): 111 one-direction strips from five packs.
 * `FX_DEFAULTS` carries each strip's native frame rate, blend, ground
 * squash and loop flag so a call site can name the strip and nothing else;
 * every option can still be overridden per call. `playFollowing` re-anchors
 * a strip to a moving body each frame (auras, status loops); `later` queues
 * a delayed play for staggered beats (a boss's ring of explosions). Composed
 * beats live in `render/effects.ts`.
 */

import { Sprite, type Container } from 'pixi.js';
import { spriteLib, type AnimName } from '@/render/SpriteLibrary';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';

/**
 * The baked effect strips (see docs: it.41 asset audit). Everything here
 * is streamed in with every floor's roster, so the list stays EXPLICIT: an
 * `fx_*` name is added when a call site uses it, never in bulk.
 */
export const VFX_ANIMS = [
  'vfx_bloodburst',
  'vfx_fireball',
  'vfx_explosion',
  'vfx_burst',
  'vfx_firewall',
  'vfx_ring',
  'vfx_vortex',
  'vfx_splash',
  'vfx_whirl',
  'vfx_slash',
  'vfx_aura',
  'vfx_orb',
  'vfx_strike',
  'vfx_splat',
  'vfx_bloodhit',
  'vfx_cut1',
  'vfx_cut3',
  'vfx_cut4',
  'vfx_cut5',
  'vfx_pentagram',
  // ---- it.115: the fx_ packs, only what the catalogue / skills / statuses use ----
  // impacts, crits, deaths
  'fx_impact_a',
  'fx_impact_b',
  'fx_impact_c',
  'fx_impact_dir_a',
  'fx_impact_dir_b',
  'fx_impact_dir_c',
  'fx_impact_dir_d',
  'fx_crit_star',
  'fx_splat_a',
  'fx_splat_dir_a',
  'fx_splat_dir_b',
  'fx_skull_smoke',
  'fx_boss_death',
  // explosions, smoke, fire
  'fx_explosion_a',
  'fx_explosion_b',
  'fx_explosion_big',
  'fx_smoke_burst',
  'fx_smoke_dir',
  'fx_fire_cast',
  'fx_fire_burst',
  'fx_fire_pillar',
  'fx_fireball_a',
  'fx_gexplosion_a',
  'fx_spark_burst',
  // ice
  'fx_ice_cast',
  'fx_ice_shatter_a',
  'fx_ice_shatter_b',
  'fx_ice_pick',
  'fx_frost_1',
  // arcane, light, holy
  'fx_magic_barrier',
  'fx_magic_circle',
  'fx_light_cast',
  'fx_paladin_2',
  'fx_paladin_4',
  'fx_heal',
  'fx_sparkle_a',
  'fx_sparkle_b',
  'fx_sparkle_c',
  // shadow, poison, blood, lightning
  'fx_necro_1',
  'fx_necro_2',
  'fx_poison_cast',
  'fx_poison_claw',
  'fx_status_poison',
  'fx_blood_1_loop',
  'fx_lightning_burst_a',
  // movement, wind
  'fx_dash_trail',
  'fx_tornado_loop',
  'fx_wide_arc',
  'fx_charge',
  'fx_warp_a',
  'fx_warp_b',
  'fx_warp_c',
  'fx_vortex',
  // buffs and symbols
  'fx_haste',
  'fx_defense_up',
  'fx_attack_up',
  'fx_alert',
  'fx_star_small',
  'fx_levelup',
  'fx_pillar_back',
  'fx_pillar_front',
  'fx_coin_burst',
  'fx_treasure_burst',
] as const;
export type VfxAnim = (typeof VFX_ANIMS)[number];

export interface VfxOpts {
  /** Playback rate (default: the strip's native rate from `FX_DEFAULTS`, else 18). */
  fps?: number;
  scale?: number;
  tint?: number;
  /** Additive blend (default: per strip — light adds, blood and smoke do not). */
  additive?: boolean;
  loop?: boolean;
  /** Pixels above the ground point (torso height = 18). */
  lift?: number;
  rotation?: number;
  alpha?: number;
  /** Squash to the 2:1 ground plane (rings, sigils). */
  flat?: boolean;
  /** Draw in the ambience layer above everything (bursts, auras on the hero). */
  overlay?: boolean;
  /** Depth nudge in the object layer (negative = behind bodies on the tile). */
  depthBias?: number;
}

export interface VfxHandle {
  stop: () => void;
  /** Re-anchor a running effect (auras follow the hero). */
  moveTo: (x: number, y: number) => void;
}

/** Per-strip native settings; `play` fills whatever the caller left out. */
export interface FxDefault {
  fps: number;
  additive: boolean;
  flat: boolean;
  loop: boolean;
}

const STARTS = (name: string, prefixes: string[]): boolean => prefixes.some((p) => name.startsWith(p));

/** The strip's native rate by source pack (see the it.115 bake notes). */
function nativeFps(name: string): number {
  if (!name.startsWith('fx_')) return 18;
  if (STARTS(name, ['fx_explosion_big', 'fx_explosion_tall', 'fx_xplosion', 'fx_vortex'])) return 20;
  if (STARTS(name, ['fx_fireball_', 'fx_fire_', 'fx_gexplosion_', 'fx_ice_', 'fx_light_cast', 'fx_holy_explosion', 'fx_poison_', 'fx_magic_barrier', 'fx_tornado_', 'fx_star_'])) return 24;
  if (STARTS(name, ['fx_frost_', 'fx_blood_', 'fx_necro_', 'fx_priest_', 'fx_paladin_', 'fx_bolt_', 'fx_pillar_'])) return 18;
  return 15;
}

const NORMAL_BLEND = ['fx_splat_', 'fx_blood_', 'fx_smoke_', 'fx_skull_smoke', 'fx_coin_burst', 'fx_levelup_text', 'fx_alert', 'fx_warning', 'fx_crown'];
const GROUND = ['fx_vortex', 'fx_magic_circle', 'fx_fire_cast', 'fx_ice_cast', 'fx_light_cast', 'fx_poison_cast', 'fx_splat_a', 'fx_splat_b', 'fx_dash_trail'];
const LOOPS = ['fx_campfire', 'fx_magic_circle', 'fx_energy_bolt', 'fx_fireball_', 'fx_ice_pick', 'fx_tornado_loop', 'fx_star_', 'fx_blood_1_loop', 'fx_pillar_'];

/**
 * Native settings per strip name (fps / blend / ground squash / loop),
 * built once from the pack rules so call sites can omit them. `vfx_*`
 * strips keep their old defaults (18 fps, additive, upright, one-shot).
 */
export const FX_DEFAULTS: Readonly<Record<VfxAnim, FxDefault>> = Object.fromEntries(
  VFX_ANIMS.map((name) => [
    name,
    {
      fps: nativeFps(name),
      additive: !STARTS(name, NORMAL_BLEND),
      flat: STARTS(name, GROUND),
      loop: STARTS(name, LOOPS),
    },
  ]),
) as Record<VfxAnim, FxDefault>;

interface Item {
  sprite: Sprite;
  frames: ReadonlyArray<import('pixi.js').Texture>;
  fps: number;
  t: number;
  loop: boolean;
  x: number;
  y: number;
  lift: number;
  overlay: boolean;
  depthBias: number;
  done: boolean;
  /** A body to shadow each frame (auras, status loops). */
  follow: (() => { x: number; y: number }) | null;
}

interface Delayed {
  at: number;
  fn: () => void;
}

const NOOP: VfxHandle = { stop: () => {}, moveTo: () => {} };

export class VfxSystem {
  /** Retired sprites, reused (it.73): a boss fight used to allocate and free hundreds a minute. */
  private readonly free: Sprite[] = [];
  private items: Item[] = [];
  private readonly scratch = vec2();
  /** Delayed plays (`later`), driven by `update`. */
  private queue: Delayed[] = [];
  private clock = 0;

  constructor(
    private readonly objectLayer: Container,
    private readonly ambienceLayer: Container,
  ) {}

  /** True when the strip is resident (call sites fall back to particles otherwise). */
  has(anim: VfxAnim): boolean {
    return spriteLib.loaded && spriteLib.hasAnim(anim);
  }

  play(anim: VfxAnim, x: number, y: number, opts: VfxOpts = {}): VfxHandle {
    return this.spawn(anim, x, y, opts, null);
  }

  /**
   * A strip anchored to a moving body: `getPos` is read every render frame
   * until the handle is stopped (or a one-shot ends). Auras on heroes,
   * status loops on foes.
   */
  playFollowing(anim: VfxAnim, getPos: () => { x: number; y: number }, opts: VfxOpts = {}): VfxHandle {
    const p = getPos();
    return this.spawn(anim, p.x, p.y, opts, getPos);
  }

  /** Run `fn` after `seconds` of render time (staggered rings, delayed pops). */
  later(seconds: number, fn: () => void): void {
    this.queue.push({ at: this.clock + Math.max(0, seconds), fn });
  }

  private spawn(anim: VfxAnim, x: number, y: number, opts: VfxOpts, follow: (() => { x: number; y: number }) | null): VfxHandle {
    if (!this.has(anim)) return NOOP;
    const def = FX_DEFAULTS[anim] ?? { fps: 18, additive: true, flat: false, loop: false };
    const frames = spriteLib.anim(anim as AnimName).frames[0];
    const sprite = this.free.pop() ?? new Sprite();
    sprite.texture = frames[0];
    sprite.anchor.set(0.5);
    sprite.tint = 0xffffff;
    sprite.visible = true;
    const scale = opts.scale ?? 1;
    const flat = opts.flat ?? def.flat;
    sprite.scale.set(scale, flat ? scale * 0.5 : scale);
    if (opts.tint !== undefined) sprite.tint = opts.tint;
    sprite.blendMode = (opts.additive ?? def.additive) ? 'add' : 'normal';
    sprite.alpha = opts.alpha ?? 1;
    sprite.rotation = opts.rotation ?? 0;
    const item: Item = {
      sprite,
      frames,
      fps: opts.fps ?? def.fps,
      t: 0,
      loop: opts.loop ?? def.loop,
      x,
      y,
      lift: opts.lift ?? 0,
      overlay: !!opts.overlay,
      depthBias: opts.depthBias ?? 1,
      done: false,
      follow,
    };
    (item.overlay ? this.ambienceLayer : this.objectLayer).addChild(sprite);
    this.place(item);
    this.items.push(item);
    return {
      stop: () => {
        item.done = true;
      },
      moveTo: (nx, ny) => {
        item.x = nx;
        item.y = ny;
        this.place(item);
      },
    };
  }

  private place(item: Item): void {
    const s = worldToScreen(item.x, item.y, this.scratch);
    item.sprite.position.set(s.x, s.y - item.lift);
    if (!item.overlay) item.sprite.zIndex = depthKey(item.x, item.y) + item.depthBias;
  }

  /** Per render frame: advance strips, retire finished one-shots, fire due delays. */
  update(dt: number, tint?: (x: number, y: number) => number): void {
    this.clock += dt;
    if (this.queue.length) {
      const due = this.queue.filter((d) => d.at <= this.clock);
      if (due.length) {
        this.queue = this.queue.filter((d) => d.at > this.clock);
        for (const d of due) d.fn();
      }
    }
    if (this.items.length === 0) return;
    const keep: Item[] = [];
    for (const it of this.items) {
      it.t += dt;
      const n = it.frames.length;
      let frame = Math.floor(it.t * it.fps);
      if (frame >= n) {
        if (it.loop) frame %= n;
        else it.done = true;
      }
      if (it.done) {
        it.sprite.removeFromParent();
        it.sprite.visible = false;
        if (this.free.length < 160) this.free.push(it.sprite);
        else it.sprite.destroy();
        continue;
      }
      if (it.follow) {
        const p = it.follow();
        if (p.x !== it.x || p.y !== it.y) {
          it.x = p.x;
          it.y = p.y;
          this.place(it);
        }
      }
      it.sprite.texture = it.frames[frame];
      // A one-shot fades over its last third; loops breathe.
      if (!it.loop) {
        const p = it.t * it.fps / n;
        if (p > 0.66) it.sprite.alpha = Math.max(0, 1 - (p - 0.66) / 0.34);
      }
      if (tint && !it.overlay && it.sprite.tint === 0xffffff) it.sprite.tint = tint(it.x, it.y);
      keep.push(it);
    }
    this.items = keep;
  }

  /** Floor teardown. */
  clear(): void {
    for (const it of this.items) it.sprite.destroy();
    this.items = [];
    this.queue = [];
    for (const sp of this.free) sp.destroy();
    this.free.length = 0;
  }
}
