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
 */

import { Sprite, type Container } from 'pixi.js';
import { spriteLib, type AnimName } from '@/render/SpriteLibrary';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';

/** The baked effect strips (see docs: it.41 asset audit). */
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
] as const;
export type VfxAnim = (typeof VFX_ANIMS)[number];

export interface VfxOpts {
  /** Playback rate (default 18). */
  fps?: number;
  scale?: number;
  tint?: number;
  /** Additive blend (default true — every effect here is light). */
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
}

const NOOP: VfxHandle = { stop: () => {}, moveTo: () => {} };

export class VfxSystem {
  private items: Item[] = [];
  private readonly scratch = vec2();

  constructor(
    private readonly objectLayer: Container,
    private readonly ambienceLayer: Container,
  ) {}

  /** True when the strip is resident (call sites fall back to particles otherwise). */
  has(anim: VfxAnim): boolean {
    return spriteLib.loaded && spriteLib.hasAnim(anim);
  }

  play(anim: VfxAnim, x: number, y: number, opts: VfxOpts = {}): VfxHandle {
    if (!this.has(anim)) return NOOP;
    const frames = spriteLib.anim(anim as AnimName).frames[0];
    const sprite = new Sprite(frames[0]);
    sprite.anchor.set(0.5);
    const scale = opts.scale ?? 1;
    sprite.scale.set(scale, opts.flat ? scale * 0.5 : scale);
    if (opts.tint !== undefined) sprite.tint = opts.tint;
    sprite.blendMode = opts.additive === false ? 'normal' : 'add';
    sprite.alpha = opts.alpha ?? 1;
    sprite.rotation = opts.rotation ?? 0;
    const item: Item = {
      sprite,
      frames,
      fps: opts.fps ?? 18,
      t: 0,
      loop: !!opts.loop,
      x,
      y,
      lift: opts.lift ?? 0,
      overlay: !!opts.overlay,
      depthBias: opts.depthBias ?? 1,
      done: false,
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

  /** Per render frame: advance strips, retire finished one-shots. */
  update(dt: number, tint?: (x: number, y: number) => number): void {
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
        it.sprite.destroy();
        continue;
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
  }
}
