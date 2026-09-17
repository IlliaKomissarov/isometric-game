/**
 * @module render/Puppet
 * A BODY ON A PLINTH (it.115, the menagerie).
 *
 * It.114 put a creature's sheets OVER the hero - the owner: "the mob models
 * attach right onto my hero skin and overlap each other, it's terrible". The
 * hero stays the hero now. A picked body is a DISPLAY MODEL: its own sprite on
 * its own marked spot on the sand, standing still, facing the camera, and
 * playing whichever clip it is told to - idle and walk loop, the attack and
 * the flinch play once and settle, a death plays, lies a breath on the sand
 * and climbs back up. Nothing in the simulation knows about it.
 *
 * Every frame stands on the clip's CALIBRATED feet (`spriteLib.footAnchor`,
 * per frame for a fall), and the rig is normalised the way `Enemy.applyRig`
 * does it (`rigHeight` x the kind's standard), so what the owner judges here
 * is exactly what walks in the crypt.
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { spriteLib, type AnimName } from '@/render/SpriteLibrary';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';
import type { Costume } from './costumes';

/** The hero standard: the same number `Player.ts` and `Enemy.ts` normalise to. */
const HERO_HEIGHT = 56;

/** What a model can be told to do (or the name of one of its extras). */
export type ModelAct = 'idle' | 'walk' | 'attack' | 'hit' | 'death';

/** Seconds a dead model lies on the sand before it climbs back up. */
const LIE_SECONDS = 1.6;
/** Seconds the climb back up takes (the death clip in reverse). */
const RISE_SECONDS = 0.7;

/** Multiply two 0xRRGGBB colours. */
function mulColor(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

export class Puppet {
  readonly container = new Container();
  private readonly body = new Sprite(Texture.EMPTY);
  private readonly shadow: Sprite;
  private readonly spot = new Graphics();
  private readonly label: Text;
  /** Facing, 0..7 = [E, NE, N, NW, W, SW, S, SE]; 6 faces the camera. */
  dir = 6;
  private rigScale = 1;
  /** Painted width on screen (px) - the layout spaces models by it. */
  readonly widthPx: number;
  /** Body height on screen (px) - the layout spaces rows by it. */
  readonly heightPx: number;
  private mode: ModelAct | 'extra' = 'idle';
  private anim: string;
  private clock = 0;
  private idleClock = Math.random() * 3;
  private focused = false;
  private readonly scratch = vec2();

  constructor(
    readonly costume: Costume,
    public x: number,
    public y: number,
  ) {
    this.shadow = new Sprite(assets.get('shadow'));
    this.shadow.anchor.set(0.5, 0.5);
    this.shadow.alpha = costume.ownShadow ? 0.25 : 0.55;
    const ref = spriteLib.rigHeight(costume.idle, costume.walk, costume.attack);
    const target = (costume.baseHeight ?? HERO_HEIGHT) * (costume.heightMult ?? 1);
    this.rigScale = ref > 0 ? target / ref : 1;
    this.body.scale.set(this.rigScale);
    const e = spriteLib.entry(costume.idle);
    this.widthPx = e ? (e.painted.right - e.painted.left + 1) * this.rigScale : 48;
    this.heightPx = target;
    this.label = new Text({
      text: costume.label,
      style: { fontFamily: 'Cinzel, Georgia, serif', fontWeight: '700', fontSize: 9, letterSpacing: 1, fill: 0xe8dcc0, stroke: { color: 0x0a0806, width: 3 } },
      resolution: 3,
    });
    this.label.anchor.set(0.5, 0);
    this.label.position.set(0, 13);
    this.label.visible = false; // Only the picked body is named on the sand; the dock names them all.
    this.container.addChild(this.spot, this.shadow, this.body, this.label);
    this.drawSpot();
    this.anim = costume.idle;
    this.place(x, y);
  }

  /** Stand on a new spot (the layout re-deals the rows when a body joins or leaves). */
  place(x: number, y: number): void {
    this.x = x;
    this.y = y;
    const s = worldToScreen(x, y, this.scratch);
    this.container.position.set(s.x, s.y);
    this.container.zIndex = depthKey(x, y);
  }

  /** The named one-shots the costume offers (roar, breath, cast...). */
  get extras(): string[] {
    return Object.keys(this.costume.extras ?? {});
  }

  /** Which of the standard clips this body has. */
  has(act: ModelAct): boolean {
    const c = this.costume;
    const name = act === 'idle' ? c.idle : act === 'walk' ? c.walk : act === 'attack' ? c.attack : act === 'hit' ? c.hit : c.death;
    return !!name && spriteLib.hasAnim(name) && (act !== 'walk' || c.walk !== c.idle || spriteLib.anim(c.walk as AnimName).frameCount > 1);
  }

  /** The marked spot: a tile-shaped plate the width of the body. */
  private drawSpot(): void {
    const hw = Math.max(26, Math.min(96, this.widthPx * 0.55));
    const hh = hw / 2;
    const g = this.spot;
    g.clear();
    g.poly([0, -hh, hw, 0, 0, hh, -hw, 0]).fill({ color: this.focused ? 0x3a2c14 : 0x1a1410, alpha: this.focused ? 0.55 : 0.35 });
    g.poly([0, -hh, hw, 0, 0, hh, -hw, 0]).stroke({ width: this.focused ? 2 : 1, color: this.focused ? 0xffd070 : 0xa08a5a, alpha: this.focused ? 0.95 : 0.55 });
    this.label.position.set(0, hh + 3);
    this.label.visible = this.focused;
  }

  setFocus(on: boolean): void {
    if (this.focused === on) return;
    this.focused = on;
    this.drawSpot();
  }

  /** Turn by `step` eighths (positive = clockwise on screen). */
  rotate(step: number): void {
    this.dir = (((this.dir - step) % 8) + 8) % 8;
  }

  faceCamera(): void {
    this.dir = 6;
  }

  /** Play a standard clip or a named extra. Unknown clips are ignored. */
  play(act: ModelAct | string): void {
    const c = this.costume;
    let name: string | undefined;
    if (act === 'idle') name = c.idle;
    else if (act === 'walk') name = c.walk;
    else if (act === 'attack') name = c.attack;
    else if (act === 'hit') name = c.hit;
    else if (act === 'death') name = c.death;
    else name = c.extras?.[act];
    if (!name || !spriteLib.hasAnim(name)) return;
    this.mode = act === 'idle' || act === 'walk' || act === 'attack' || act === 'hit' || act === 'death' ? act : 'extra';
    this.anim = name;
    this.clock = 0;
  }

  /** Seconds a one-shot takes: 12 fps, never under a readable minimum. */
  private oneShotSeconds(frames: number): number {
    if (this.mode === 'death') return Math.max(1.0, frames / 10);
    if (this.mode === 'hit') return Math.max(0.35, frames / 12);
    return Math.max(0.55, frames / 12);
  }

  /** Once per render frame. */
  update(dt: number, lightTint = 0xffffff, zoom = 1): void {
    // The name holds its screen size whatever the zoom.
    if (this.label.visible) this.label.scale.set(1.15 / Math.max(0.3, zoom));
    const c = this.costume;
    this.clock += dt;
    this.idleClock += dt;
    const a = spriteLib.hasAnim(this.anim) ? spriteLib.anim(this.anim as AnimName) : null;
    if (!a) return;
    const fc = a.frameCount;
    let frame = 0;
    let breathe = false;
    if (this.mode === 'idle') {
      if (c.idle === c.walk) {
        frame = 0; // A walk sheet standing in for an idle holds its first frame and breathes.
        breathe = true;
      } else {
        // A CALM IDLE (it.115): 6 fps for a long loop, a slow ping-pong for a short one.
        if (fc <= 6) {
          const cycle = fc * 2 - 2;
          const i = Math.floor(this.idleClock * 3) % Math.max(1, cycle);
          frame = i < fc ? i : cycle - i;
        } else frame = Math.floor(this.idleClock * 6) % fc;
      }
    } else if (this.mode === 'walk') {
      // A stride in place: one cycle a second, never faster than 14 fps.
      frame = Math.floor(this.clock * Math.min(14, Math.max(8, fc))) % fc;
    } else if (this.mode === 'death') {
      const t = this.oneShotSeconds(fc);
      if (this.clock < t) frame = Math.min(fc - 1, Math.floor((this.clock / t) * fc));
      else if (this.clock < t + LIE_SECONDS) frame = fc - 1;
      else if (this.clock < t + LIE_SECONDS + RISE_SECONDS) frame = Math.max(0, Math.min(fc - 1, Math.floor((1 - (this.clock - t - LIE_SECONDS) / RISE_SECONDS) * fc)));
      else {
        this.play('idle');
        return this.update(0, lightTint, zoom);
      }
    } else {
      const t = this.oneShotSeconds(fc);
      if (this.clock >= t) {
        this.play('idle');
        return this.update(0, lightTint, zoom);
      }
      frame = Math.min(fc - 1, Math.floor((this.clock / t) * fc));
    }
    const d = a.dirCount === 8 ? this.dir : 0;
    const tex = spriteLib.frame(this.anim as AnimName, d, frame);
    if (this.body.texture !== tex) this.body.texture = tex;
    const fa = spriteLib.footAnchor(this.anim, frame);
    this.body.anchor.set(fa.x, fa.y);
    const hover = c.hover ?? 0;
    this.body.position.y = -hover - (hover ? Math.sin(this.idleClock * 3) * 3 : 0);
    this.body.scale.set(this.rigScale, breathe ? this.rigScale * (1 + Math.sin(this.idleClock * 2.4) * 0.014) : this.rigScale);
    this.body.tint = c.tint && c.tint !== 0xffffff ? mulColor(lightTint, c.tint) : lightTint;
    this.shadow.tint = lightTint;
    const k = Math.max(0.6, Math.min(2.4, this.widthPx / 40));
    this.shadow.scale.set(k, k * 0.8);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
