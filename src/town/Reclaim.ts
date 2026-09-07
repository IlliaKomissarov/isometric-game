/**
 * @module town/Reclaim
 * THE EASTERN QUARTER'S GATE (it.91): render-only theatre around the
 * barricade on the east road.
 *
 *   - `pullAside`: the errand is taken - the militia drags one cart out of
 *     the line (it slides, rocks, and settles on the verge in a puff of
 *     dust) and the gap is a road.
 *   - `ReclaimScene`: the last looter falls - a letterboxed cutscene. The
 *     camera leaves the hero for the gate; the carts shake, then topple one
 *     by one in dust; the title rises; the refugees walk home through the
 *     gap in a loose procession while gold light drifts over the road; the
 *     bars lift and the camera comes back. `onDone` fires once, at the end.
 *
 * Nothing here touches the simulation: the grid opens through the `open`
 * hook main hands in (a plain tile write, done the same tick on every peer
 * by the QUEST command), and every sprite is the dresser's or this file's.
 */

import { Container, Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import type { Ambience } from '@/engine/Ambience';
import { spriteLib, stableDir } from '@/render/SpriteLibrary';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';

const WALK = 'folk_walk';
const FOLK_HEIGHT = 56;

interface Tween {
  sprite: Sprite;
  t: number;
  dur: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  rot: number;
  fade: boolean;
  dust: { x: number; y: number };
}

/** A cart dragged aside, or toppled: a small tween list main ticks each frame. */
export class GateFx {
  private readonly tweens: Tween[] = [];
  private dustClock = 0;

  /** The world's ambience is rebuilt with every floor: asked for, never kept. */
  constructor(private readonly ambienceOf: () => Ambience) {}

  /** The errand is taken: the gap's cart slides a tile and a half north, rocking, and settles on the verge. */
  pullAside(spr: Sprite, wx: number, wy: number): void {
    const s = worldToScreen(wx + 0.5, wy - 1.4, vec2());
    this.tweens.push({ sprite: spr, t: 0, dur: 1.4, fromX: spr.position.x, fromY: spr.position.y, toX: s.x, toY: s.y + 4, rot: -0.08, fade: false, dust: { x: wx + 0.5, y: wy + 0.5 } });
  }

  /** The reclaiming: every cart falls forward into the road and is gone. */
  topple(spr: Sprite, wx: number, wy: number, delay: number): void {
    this.tweens.push({ sprite: spr, t: -delay, dur: 0.9, fromX: spr.position.x, fromY: spr.position.y, toX: spr.position.x + 14, toY: spr.position.y + 26, rot: 0.55, fade: true, dust: { x: wx + 0.5, y: wy + 0.5 } });
  }

  get busy(): boolean {
    return this.tweens.length > 0;
  }

  update(dt: number): void {
    this.dustClock += dt;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      if (tw.t < 0) {
        // Waiting its turn: a tremble.
        tw.sprite.position.x = tw.fromX + Math.sin(this.dustClock * 40 + i) * 1.5;
        continue;
      }
      const k = Math.min(1, tw.t / tw.dur);
      const e = tw.fade ? k * k : 1 - (1 - k) * (1 - k);
      tw.sprite.position.set(tw.fromX + (tw.toX - tw.fromX) * e, tw.fromY + (tw.toY - tw.fromY) * e);
      tw.sprite.rotation = tw.rot * (tw.fade ? e : Math.sin(k * Math.PI));
      if (tw.fade) tw.sprite.alpha = 1 - e;
      if (Math.floor(tw.t * 10) !== Math.floor((tw.t - dt) * 10)) this.ambienceOf().burst(tw.dust.x, tw.dust.y, 0x9a8a70, 4, { lowEnergy: true });
      if (k >= 1) {
        if (tw.fade) {
          this.ambienceOf().burst(tw.dust.x, tw.dust.y, 0xb0a088, 18);
          tw.sprite.destroy();
        }
        this.tweens.splice(i, 1);
      }
    }
  }
}

export interface ReclaimHooks {
  layer: Container;
  ambience: Ambience;
  fx: GateFx;
  /** The barricade's sprites by tile, and the tiles themselves. */
  carts: Array<{ sprite: Sprite; x: number; y: number }>;
  /** The grid opens (every gate tile becomes floor): called once, when the carts fall. */
  open: () => void;
  /** Where the refugees stand, and the road they walk: the gap, then the quarter's first bend, then the square. */
  from: { x: number; y: number };
  route: Array<{ x: number; y: number }>;
  isWalkable: (gx: number, gy: number) => boolean;
  /** The camera's cinematic focus (null gives it back to the hero). */
  focus: (x: number, y: number) => void;
  release: () => void;
  sfx: (name: 'barrelBreak' | 'questDone' | 'gateOpen' | 'crowd') => void;
  onDone: () => void;
}

interface Walker {
  root: Container;
  body: Sprite;
  x: number;
  y: number;
  leg: number;
  delay: number;
  dir: number;
  clock: number;
  speed: number;
  done: boolean;
}

/** The letterboxed reclaiming. */
export class ReclaimScene {
  private t = 0;
  private readonly walkers: Walker[] = [];
  private opened = false;
  private toppled = false;
  private cheered = false;
  private finished = false;
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly scratch = vec2();
  private glintClock = 0;

  constructor(private readonly h: ReclaimHooks) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'cine-layer';
    this.overlay.innerHTML = '<div class="cine-bar top"></div><div class="cine-bar bottom"></div><div class="cine-title"><b></b><i></i></div>';
    document.body.appendChild(this.overlay);
    this.title = this.overlay.querySelector('.cine-title b')!;
    this.sub = this.overlay.querySelector('.cine-title i')!;
    void this.overlay.offsetWidth; // Commit the closed bars, then open them (no animation frame needed: a hidden tab has none).
    this.overlay.classList.add('show');
    // The procession: eight of the folk, each on the road a beat after the last.
    if (spriteLib.hasAnim(WALK)) {
      const painted = spriteLib.paintedHeight(WALK) || 50;
      const scale = FOLK_HEIGHT / painted;
      for (let i = 0; i < 8; i++) {
        const root = new Container();
        root.scale.set(0.8);
        const shadow = new Sprite(assets.get('shadow'));
        shadow.anchor.set(0.5, 0.5);
        shadow.alpha = 0.6;
        root.addChild(shadow);
        const body = new Sprite(spriteLib.frame(WALK, 2, 0));
        body.anchor.set(0.5, 1);
        body.scale.set(scale / 0.8);
        body.position.set(0, 2);
        root.addChild(body);
        root.visible = false;
        h.layer.addChild(root);
        const ox = (i % 2) * 0.9 - 0.45 + (Math.random() - 0.5) * 0.4;
        const oy = Math.floor(i / 2) * 0.7 - 1 + (Math.random() - 0.5) * 0.4;
        this.walkers.push({ root, body, x: h.from.x + 0.5 + ox, y: h.from.y + 0.5 + oy, leg: 0, delay: 4.2 + i * 0.55, dir: 2, clock: Math.random(), speed: 1.35 + Math.random() * 0.25, done: false });
      }
    }
  }

  get running(): boolean {
    return !this.finished;
  }

  private setTitle(main: string, sub: string): void {
    this.title.textContent = main;
    this.sub.textContent = sub;
    this.overlay.classList.add('titled');
  }

  update(dt: number): void {
    if (this.finished) return;
    const h = this.h;
    const prev = this.t;
    this.t += dt;
    const t = this.t;
    const gate = h.carts[Math.floor(h.carts.length / 2)] ?? { x: h.from.x + 3, y: h.from.y };
    // 0 - 1.3 s: the bars close and the camera crosses to the gate.
    if (t < 6) h.focus(gate.x + 0.5, gate.y + 0.5);
    // 1.3 - 3.4 s: the carts tremble, then fall.
    if (t >= 1.3 && !this.toppled) {
      this.toppled = true;
      h.carts.forEach((c, i) => h.fx.topple(c.sprite, c.x, c.y, 0.9 + i * 0.22));
      h.sfx('barrelBreak');
      this.setTitle('THE EASTERN QUARTER', 'the barricade comes down');
    }
    if (t >= 3.2 && !this.opened) {
      this.opened = true;
      h.open();
      h.sfx('gateOpen');
      h.ambience.burst(gate.x + 0.5, gate.y + 0.5, 0xffd070, 30);
    }
    if (t >= 4.2 && !this.cheered) {
      this.cheered = true;
      h.sfx('questDone');
      h.sfx('crowd');
      this.setTitle('THE PEOPLE RETURN', 'twenty looters fallen · the quarter reclaimed');
    }
    // 4.2 s on: the procession walks the route; the camera drifts with its head.
    let head: Walker | null = null;
    const fc = spriteLib.hasAnim(WALK) ? spriteLib.anim(WALK).frameCount : 1;
    for (const w of this.walkers) {
      if (t < w.delay) continue;
      w.root.visible = true;
      const goal = h.route[Math.min(w.leg, h.route.length - 1)];
      const gx = goal.x + 0.5 + ((w.x * 7) % 1) * 0.8 - 0.4;
      const gy = goal.y + 0.5 + ((w.y * 5) % 1) * 0.8 - 0.4;
      const dx = gx - w.x;
      const dy = gy - w.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.2) {
        if (w.leg < h.route.length - 1) w.leg++;
        else w.done = true;
      } else if (!w.done) {
        const step = Math.min(dist, w.speed * dt);
        w.x += (dx / dist) * step;
        w.y += (dy / dist) * step;
        w.clock += step * 0.5;
        w.dir = stableDir(dx / dist, dy / dist, w.dir);
      }
      w.body.texture = spriteLib.frame(WALK, w.dir, w.done ? 0 : Math.floor(w.clock * fc) % fc);
      const s = worldToScreen(w.x, w.y, this.scratch);
      w.root.position.set(s.x, s.y);
      w.root.zIndex = depthKey(w.x, w.y);
      if (!head || w.x > head.x) head = w;
    }
    if (t >= 6 && head) h.focus(head.x, head.y);
    // Gold light along the road as they pass.
    this.glintClock += dt;
    if (t >= 4.2 && this.glintClock > 0.35) {
      this.glintClock = 0;
      const w = head ?? null;
      if (w) h.ambience.burst(w.x + (Math.random() - 0.5) * 2, w.y + (Math.random() - 0.5) * 2, 0xffd070, 6, { lowEnergy: true });
    }
    if (Math.floor(prev) !== Math.floor(t) && t >= 4 && t < 12) h.ambience.burst(gate.x + 0.5 + (Math.random() - 0.5) * 3, gate.y + 0.5 + (Math.random() - 0.5) * 3, 0xffe8a0, 10);
    // 12.5 s: the title fades; 13.5 s: the bars lift and the hero has the camera again.
    if (t >= 12.2) this.overlay.classList.remove('titled');
    if (t >= 13.2 && !this.finished) {
      this.finished = true;
      this.overlay.classList.remove('show');
      h.release();
      window.setTimeout(() => this.overlay.remove(), 700);
      h.onDone();
    }
  }

  /** Tear the procession down (the world is rebuilt right after). */
  destroy(): void {
    for (const w of this.walkers) w.root.destroy({ children: true });
    this.walkers.length = 0;
    this.overlay.remove();
    this.finished = true;
  }
}
