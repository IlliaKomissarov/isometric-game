/**
 * @module town/Reclaim
 * PROCESSIONS (it.91, generalised it.92): render-only theatre for the
 * moment a place is won back.
 *
 *   - `GateFx`: the barricade's carts - one dragged aside when the errand is
 *     taken (it slides, rocks, settles on the verge in dust), all of them
 *     toppling when the quarter is cleared.
 *   - `ProcessionScene`: a letterboxed cutscene. The camera leaves the hero
 *     for a place; carts (if any) tremble and fall; a title rises; the folk
 *     walk a route home in a loose column under drifting gold light; the
 *     bars lift and the camera comes back. `onDone` fires once, at the end.
 *     THE EASTERN QUARTER runs it with carts; THE DARK FOREST runs it bare,
 *     the clearings' folk walking in from the town road.
 *
 * Nothing here touches the simulation: the grid opens through the `open`
 * hook main hands in (a plain tile write, done the same tick on every peer),
 * and every sprite is the dresser's or this file's.
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
      if (tw.sprite.destroyed) {
        this.tweens.splice(i, 1);
        continue;
      }
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

export interface ProcessionHooks {
  layer: Container;
  ambience: Ambience;
  fx: GateFx;
  /** The barricade's sprites by tile (empty for a place with no carts). */
  carts: Array<{ sprite: Sprite; x: number; y: number }>;
  /** The grid opens (every gate tile becomes floor): called once, when the carts fall. */
  open?: () => void;
  /** Where the camera looks first (the gate, the road in). */
  at: { x: number; y: number };
  /** Where the folk start, and the road they walk. */
  from: { x: number; y: number };
  route: Array<{ x: number; y: number }>;
  /** The two titles: the place, then the people. */
  titles: [[string, string], [string, string]];
  /** How many walk (default 8). */
  walkers?: number;
  /** The camera's cinematic focus (null gives it back to the hero). */
  focus: (x: number, y: number) => void;
  release: () => void;
  sfx: (name: 'barrelBreak' | 'questDone' | 'gateOpen' | 'crowd' | 'depart') => void;
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

/** The letterboxed homecoming. */
export class ProcessionScene {
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
  /** With carts the folk wait for them to fall; without, they set out at once. */
  private readonly walkAt: number;
  private readonly endAt: number;

  constructor(private readonly h: ProcessionHooks) {
    this.walkAt = h.carts.length ? 4.2 : 1.6;
    this.endAt = this.walkAt + 9;
    this.overlay = document.createElement('div');
    this.overlay.id = 'cine-layer';
    this.overlay.innerHTML = '<div class="cine-bar top"></div><div class="cine-bar bottom"></div><div class="cine-title"><b></b><i></i></div>';
    document.body.appendChild(this.overlay);
    this.title = this.overlay.querySelector('.cine-title b')!;
    this.sub = this.overlay.querySelector('.cine-title i')!;
    void this.overlay.offsetWidth; // Commit the closed bars, then open them (no animation frame needed: a hidden tab has none).
    this.overlay.classList.add('show');
    // The procession: the folk, each on the road a beat after the last.
    if (spriteLib.hasAnim(WALK)) {
      const painted = spriteLib.paintedHeight(WALK) || 50;
      const scale = FOLK_HEIGHT / painted;
      const n = h.walkers ?? 8;
      for (let i = 0; i < n; i++) {
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
        this.walkers.push({ root, body, x: h.from.x + 0.5 + ox, y: h.from.y + 0.5 + oy, leg: 0, delay: this.walkAt + i * 0.55, dir: 2, clock: Math.random(), speed: 1.35 + Math.random() * 0.25, done: false });
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
    const at = h.at;
    // The bars close and the camera crosses to the place.
    if (t < this.walkAt + 1.8) h.focus(at.x + 0.5, at.y + 0.5);
    if (h.carts.length) {
      // 1.3 - 3.4 s: the carts tremble, then fall.
      if (t >= 1.3 && !this.toppled) {
        this.toppled = true;
        h.carts.forEach((c, i) => h.fx.topple(c.sprite, c.x, c.y, 0.9 + i * 0.22));
        h.sfx('barrelBreak');
        this.setTitle(h.titles[0][0], h.titles[0][1]);
      }
      if (t >= 3.2 && !this.opened) {
        this.opened = true;
        h.open?.();
        h.sfx('gateOpen');
        h.ambience.burst(at.x + 0.5, at.y + 0.5, 0xffd070, 30);
      }
    } else if (t >= 0.6 && !this.toppled) {
      this.toppled = true;
      this.setTitle(h.titles[0][0], h.titles[0][1]);
      h.sfx('depart');
    }
    if (t >= this.walkAt && !this.cheered) {
      this.cheered = true;
      h.sfx('questDone');
      if (h.carts.length) h.sfx('crowd');
      this.setTitle(h.titles[1][0], h.titles[1][1]);
    }
    // The procession walks the route; the camera drifts with its head.
    let head: Walker | null = null;
    const fc = spriteLib.hasAnim(WALK) ? spriteLib.anim(WALK).frameCount : 1;
    for (const w of this.walkers) {
      if (t < w.delay || w.root.destroyed) continue;
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
      if (!head || w.leg > head.leg || (w.leg === head.leg && w.x + w.y > head.x + head.y)) head = w;
    }
    if (t >= this.walkAt + 1.8 && head) h.focus(head.x, head.y);
    // Gold light along the road as they pass.
    this.glintClock += dt;
    if (t >= this.walkAt && this.glintClock > 0.35) {
      this.glintClock = 0;
      if (head) h.ambience.burst(head.x + (Math.random() - 0.5) * 2, head.y + (Math.random() - 0.5) * 2, 0xffd070, 6, { lowEnergy: true });
    }
    if (Math.floor(prev) !== Math.floor(t) && t >= this.walkAt && t < this.endAt - 1) h.ambience.burst(at.x + 0.5 + (Math.random() - 0.5) * 3, at.y + 0.5 + (Math.random() - 0.5) * 3, 0xffe8a0, 10);
    // The title fades; then the bars lift and the hero has the camera again.
    if (t >= this.endAt - 1) this.overlay.classList.remove('titled');
    if (t >= this.endAt && !this.finished) {
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

/** The old name (it.91) stays for the harness and the docs. */
export { ProcessionScene as ReclaimScene };
