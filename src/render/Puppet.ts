/**
 * @module render/Puppet
 * A COSTUME ON THE HERO (it.114, the menagerie).
 *
 * The try-out arena lets the owner walk the sand as any creature. The
 * simulation does not change for that - the hero is still the hero: the same
 * collider, the same movement, the same actions - only the BODY drawn over
 * the hero's position is another creature's sheets. That is what a puppet is:
 * a render-side rig that reads the hero's state every frame (interpolated
 * position, facing, action, action progress, distance walked) and picks a
 * costume's anim and frame from it. Nothing in the sim reads it.
 *
 * Rig scale is normalised the way `Enemy.applyRig` does it: the costume's
 * idle sheet is scaled so its painted height is `HERO_HEIGHT * heightMult`,
 * and the feet anchor comes from the manifest's painted bounds (`footAnchor`),
 * so a body from any pack stands on its tile.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { spriteLib, stableDir, type AnimName } from '@/render/SpriteLibrary';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';
import type { Costume } from './costumes';

/** The hero standard: the same number `Player.ts` and `Enemy.ts` normalise to. */
const PUPPET_HEIGHT = 56;

export interface PuppetSource {
  pos: { x: number; y: number };
  prevPos: { x: number; y: number };
  facing: { x: number; y: number };
  action: 'idle' | 'attack' | 'hit' | 'dead' | 'transition';
  actionTicks: number;
  /** Ticks a full swing takes (windup + recovery); attack frames run over it. */
  attackTicks: number;
}

export class Puppet {
  readonly container = new Container();
  private readonly body = new Sprite(Texture.EMPTY);
  private readonly shadow: Sprite;
  private lastDir = 6;
  private walkPhase = 0;
  private lastX = 0;
  private lastY = 0;
  private rigScale = 1;
  private idleClock = 0;
  private deathClock = 0;
  private hitClock = 0;
  private prevAction: PuppetSource['action'] = 'idle';
  private readonly scratch = vec2();
  /** A one-shot extra (roar, breath, cast): its anim and progress in seconds. */
  private extra: { anim: string; t: number; seconds: number } | null = null;

  constructor(readonly costume: Costume) {
    this.shadow = new Sprite(assets.get('shadow'));
    this.shadow.anchor.set(0.5, 0.5);
    this.shadow.alpha = 0.55;
    this.shadow.visible = costume.ownShadow !== false;
    this.body.anchor.set(0.5, 1);
    this.container.addChild(this.shadow, this.body);
    const painted = spriteLib.paintedHeight(costume.idle);
    const target = PUPPET_HEIGHT * (costume.heightMult ?? 1);
    this.rigScale = painted > 0 ? target / painted : 1;
    this.body.scale.set(this.rigScale);
  }

  /** Fire a named one-shot from the costume's extras (or any anim name). */
  play(name: string, seconds = 1.2): void {
    const anim = this.costume.extras?.[name] ?? name;
    if (!spriteLib.hasAnim(anim)) return;
    this.extra = { anim, t: 0, seconds };
  }

  get extras(): string[] {
    return Object.keys(this.costume.extras ?? {});
  }

  private frameOf(anim: string, k: number): Texture {
    const a = spriteLib.anim(anim as AnimName);
    const fc = a.frameCount;
    const dirs = a.frames.length;
    const f = Math.max(0, Math.min(fc - 1, Math.floor(k * fc)));
    return spriteLib.frame(anim as AnimName, dirs === 8 ? this.lastDir : 0, f);
  }

  private loopFrame(anim: string, phase: number): Texture {
    const a = spriteLib.anim(anim as AnimName);
    const fc = a.frameCount;
    const dirs = a.frames.length;
    const f = ((Math.floor(phase * fc) % fc) + fc) % fc;
    return spriteLib.frame(anim as AnimName, dirs === 8 ? this.lastDir : 0, f);
  }

  /** Once per render frame. `alpha` is the sim interpolation factor. */
  update(src: PuppetSource, alpha: number, dt: number, tint = 0xffffff): void {
    const ix = src.prevPos.x + (src.pos.x - src.prevPos.x) * alpha;
    const iy = src.prevPos.y + (src.pos.y - src.prevPos.y) * alpha;
    const s = worldToScreen(ix, iy, this.scratch);
    this.container.position.set(s.x, s.y);
    this.container.zIndex = depthKey(ix, iy) + 1;

    const moved = Math.hypot(ix - this.lastX, iy - this.lastY);
    const moving = moved > 0.002;
    this.lastX = ix;
    this.lastY = iy;
    this.walkPhase += moved * (this.costume.stride ?? 0.45) * 2;
    this.lastDir = stableDir(src.facing.x, src.facing.y, this.lastDir);

    if (src.action !== this.prevAction) {
      if (src.action === 'hit') this.hitClock = 0;
      if (src.action === 'dead') this.deathClock = 0;
      this.prevAction = src.action;
    }

    const c = this.costume;
    let anim: string;
    let tex: Texture;
    if (this.extra) {
      this.extra.t += dt;
      const k = this.extra.t / this.extra.seconds;
      anim = this.extra.anim;
      tex = this.frameOf(anim, Math.min(0.999, k));
      if (k >= 1) this.extra = null;
    } else if (src.action === 'dead' && c.death) {
      this.deathClock += dt;
      anim = c.death;
      tex = this.frameOf(anim, Math.min(0.999, this.deathClock / 1.1));
    } else if (src.action === 'attack' && c.attack) {
      anim = c.attack;
      tex = this.frameOf(anim, Math.min(0.999, src.actionTicks / Math.max(1, src.attackTicks)));
    } else if (src.action === 'hit' && c.hit) {
      this.hitClock += dt;
      anim = c.hit;
      tex = this.frameOf(anim, Math.min(0.999, this.hitClock / 0.35));
    } else if (moving) {
      anim = c.walk;
      tex = this.loopFrame(anim, this.walkPhase);
    } else {
      this.idleClock += dt;
      anim = c.idle;
      // A walk sheet standing in for an idle holds its first frame and breathes.
      tex = c.idle === c.walk ? this.loopFrame(anim, 0) : this.loopFrame(anim, this.idleClock * 0.9);
    }
    if (this.body.texture !== tex) this.body.texture = tex;
    const fa = spriteLib.footAnchor(anim);
    this.body.anchor.set(fa.x, fa.y);
    this.body.position.y = -(c.hover ?? 0) - (c.hover ? Math.sin(this.idleClock * 3 + this.walkPhase * 4) * 3 : 0);
    if (c.idle === c.walk && !moving) this.body.scale.y = this.rigScale * (1 + Math.sin(this.idleClock * 2.4) * 0.014);
    else if (this.body.scale.y !== this.rigScale) this.body.scale.y = this.rigScale;
    this.body.tint = tint;
    this.shadow.tint = tint;
    this.shadow.scale.set(this.rigScale * 1.4 * (c.heightMult ?? 1), this.rigScale * 1.4 * (c.heightMult ?? 1));
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
