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
import { spriteLib, stableDir, type AnimName } from '@/render/SpriteLibrary';
import type { FolkSheet } from '@/town/Villagers';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';

const WALK = 'folk_walk';
const FOLK_HEIGHT = 56;
/** How close two walkers may stand before they shoulder each other apart (it.102). */
const WALKER_SPACING = 0.62;
/** Coats and cloaks: a colour per walker, so a crowd is not one dyed man (it.101). */
const COATS: readonly number[] = [0xffffff, 0xe8d0b0, 0xc8d8e8, 0xd8c8e0, 0xe0d8b0, 0xc0d8c0, 0xf0d0c0, 0xd0d0d8];

/**
 * ONE SPOKEN BEAT (it.102). `t` is seconds from the bars closing; `x`,`y` the
 * tile the word floats over; the rest is who is speaking, for the corner box.
 */
export interface SpeechBeat {
  t: number;
  x: number;
  y: number;
  text: string;
  /** Emphasis: gold embers under the floating word. */
  crit?: boolean;
  /** The name in the corner box; omitted, only the floating word is shown. */
  speaker?: string;
  /** Under the name: who they are. */
  role?: string;
  /** Their face, cropped to the head (main builds these off the atlas). */
  portrait?: HTMLCanvasElement | null;
  /** The company's word, read in red rather than the city's gold. */
  foe?: boolean;
  /** Seconds the corner box holds this line, for a line that is not waited on. */
  hold?: number;
  /**
   * THE SCENE WAITS (it.103). A beat with a name on it holds the scene until the
   * player says go - Space, or a tap. Set false for a line that should drift past
   * on its own. Unattributed beats never wait: there is nobody to wait for.
   */
  wait?: boolean;
}

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
  /**
   * THE CROWD IS NOT ONE MAN (it.101). The sheets the walkers are dealt from,
   * round-robin, each with its own painted height and anchor. Without this every
   * body in a procession was the same `folk_walk` peasant in the same coat.
   */
  sheets?: ReadonlyArray<FolkSheet>;
  /**
   * WALLS (it.101): a walker slides along what it cannot cross instead of
   * clipping through the props on its route. Omitted, the route is walked blind.
   */
  isWalkable?: (gx: number, gy: number) => boolean;
  /** Figures who stand in the scene rather than walk it - the officer, the general (it.101). */
  cast?: ReadonlyArray<{ anim: AnimName; x: number; y: number; height?: number; tint?: number; dir?: number }>;
  /** What is said over the scene, and when: `t` is seconds from the bars closing (it.101). */
  speech?: ReadonlyArray<SpeechBeat>;
  /**
   * How a line is put on screen. Main hands in both halves of it (it.102): the
   * floating word over the body who said it, AND the corner portrait box that
   * says who that body is.
   */
  say?: (beat: SpeechBeat) => void;
  /** THE READER TURNS THE PAGE (it.103): the line just read is taken down. */
  sayDone?: () => void;
  /** THE CELLAR (it.97): a shorter hold, for a scene with nobody walking in it. */
  hold?: number;
  /** The folk stay where they arrived when the scene ends (they die with the floor). */
  keepWalkers?: boolean;
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
  /** This walker's own sheet, so a crowd is a crowd of different people (it.101). */
  anim: AnimName;
  fc: number;
  coat: number;
  /** The place it keeps in the column - fixed at birth, so the goal never jitters (it.101). */
  offX: number;
  offY: number;
  /** Its number in the column: what the per-leg stagger is dealt from (it.103). */
  n: number;
}

/** The letterboxed homecoming. */
export class ProcessionScene {
  private t = 0;
  private readonly walkers: Walker[] = [];
  private readonly cast: Container[] = [];
  /** Which lines have been said already (it.101). */
  private said = 0;
  /**
   * THE PAGE IS NOT TURNED (it.103). True from the moment a spoken beat goes up
   * until the player advances it. While it is true no further beat is shown and
   * the scene will not end - everything else (the walk, the camera, the light)
   * keeps running, because a procession that freezes mid-step reads as a hang.
   */
  private awaiting = false;
  /** Torn down with the scene: the key and the tap that turn the page. */
  private readonly ac = new AbortController();
  private opened = false;
  private toppled = false;
  private cheered = false;
  private finished = false;
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly scratch = vec2();
  private glintClock = 0;
  /**
   * WHERE THE CAMERA IS LOOKING (it.103). Up to it.102 it was pinned to whichever
   * walker happened to be furthest along the route, so it jumped sideways every
   * time two of them swapped places and the whole homecoming juddered. It now
   * eases toward the CENTROID of everyone on the road, which moves smoothly by
   * construction, and the group is what stays in frame instead of one person.
   */
  private camX = 0;
  private camY = 0;
  private camSet = false;
  /**
   * THE SPOTLIGHTS (it.102). `Lighting.addSource` bakes into the tile map at
   * build time, so a homecoming that walks the length of a road was lit only
   * where main happened to lay a lamp before the scene started - the column
   * walked out of its own light halfway along. These are two ADDITIVE halos,
   * render-only: one nailed over the mouth of the road the folk come out of,
   * one that travels with the head of the column the whole way in.
   */
  private readonly leadSpot: Sprite | null;
  private readonly mouthSpot: Sprite | null;
  /** With carts the folk wait for them to fall; without, they set out at once. */
  private readonly walkAt: number;
  private readonly endAt: number;

  constructor(private readonly h: ProcessionHooks) {
    this.walkAt = h.carts.length ? 4.2 : 1.6;
    this.endAt = this.walkAt + (h.hold ?? 9);
    this.overlay = document.createElement('div');
    this.overlay.id = 'cine-layer';
    this.overlay.innerHTML = '<div class="cine-bar top"></div><div class="cine-bar bottom"></div><div class="cine-title"><b></b><i></i></div>';
    document.body.appendChild(this.overlay);
    this.title = this.overlay.querySelector('.cine-title b')!;
    this.sub = this.overlay.querySelector('.cine-title i')!;
    // THE PAGE IS TURNED HERE (it.103). The letterbox already covers the screen
    // and already swallows pointer events, so it is the natural place to listen:
    // a tap anywhere, or Space / Enter / E on a keyboard. Both live and die with
    // the scene, so nothing can outlive the bars.
    this.overlay.addEventListener('pointerdown', () => this.advance(), { signal: this.ac.signal });
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'KeyE') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.advance();
      },
      { signal: this.ac.signal, capture: true },
    );
    void this.overlay.offsetWidth; // Commit the closed bars, then open them (no animation frame needed: a hidden tab has none).
    this.overlay.classList.add('show');
    const spot = (tint: number, scale: number, alpha: number): Sprite | null => {
      const tex = assets.get('glow');
      if (!tex) return null;
      const g = new Sprite(tex);
      g.anchor.set(0.5);
      g.blendMode = 'add';
      g.tint = tint;
      g.alpha = alpha;
      g.scale.set(scale);
      g.zIndex = -1e6; // under every body: a light on the road, not a light in front of it
      h.layer.addChild(g);
      return g;
    };
    this.leadSpot = spot(0xffd9a0, 5.2, 0);
    this.mouthSpot = spot(0xffc888, 6.4, 0.32);
    if (this.mouthSpot) {
      const s = worldToScreen(h.from.x + 0.5, h.from.y + 0.5, vec2());
      this.mouthSpot.position.set(s.x, s.y - 14);
    }
    // THOSE WHO STAND (it.101): the officer at the head of the muster, the
    // general over his line. Placed once; they do not walk anywhere.
    for (const c of h.cast ?? []) {
      if (!spriteLib.hasAnim(c.anim)) continue;
      const painted = spriteLib.paintedHeight(c.anim) || 60;
      const root = new Container();
      root.scale.set(0.8);
      const shadow = new Sprite(assets.get('shadow'));
      shadow.anchor.set(0.5, 0.5);
      shadow.alpha = 0.6;
      root.addChild(shadow);
      const body = new Sprite(spriteLib.frame(c.anim, c.dir ?? 4, 0));
      body.anchor.set(0.5, 1);
      body.scale.set((c.height ?? 66) / painted / 0.8);
      body.position.set(0, 2);
      if (c.tint !== undefined) body.tint = c.tint;
      root.addChild(body);
      const s = worldToScreen(c.x + 0.5, c.y + 0.5, vec2());
      root.position.set(s.x, s.y);
      root.zIndex = depthKey(c.x + 0.5, c.y + 0.5);
      h.layer.addChild(root);
      this.cast.push(root);
    }
    // The procession: the folk, each on the road a beat after the last, and each
    // out of a different sheet - a homecoming of one repeated man is not a crowd.
    {
      const pool = (h.sheets ?? []).filter((sh) => spriteLib.hasAnim(sh.anim));
      const fallback: FolkSheet[] = spriteLib.hasAnim(WALK) ? [{ anim: WALK as AnimName, feet: true, height: FOLK_HEIGHT }] : [];
      const sheets = pool.length ? pool : fallback;
      const n = sheets.length ? (h.walkers ?? 8) : 0;
      for (let i = 0; i < n; i++) {
        const sheet = sheets[i % sheets.length];
        const painted = spriteLib.paintedHeight(sheet.anim) || 50;
        // A shade of height per body, dealt from the INDEX: the shared random
        // stream must not move for a cosmetic (it.98).
        const scale = (sheet.height * (0.95 + ((i * 5) % 7) * 0.017)) / painted;
        const root = new Container();
        root.scale.set(0.8);
        const shadow = new Sprite(assets.get('shadow'));
        shadow.anchor.set(0.5, 0.5);
        shadow.alpha = 0.6;
        root.addChild(shadow);
        const body = new Sprite(spriteLib.frame(sheet.anim, 2, 0));
        body.anchor.set(0.5, sheet.feet ? 1 : 0.94);
        body.scale.set(scale / 0.8);
        body.position.set(0, 2);
        body.tint = COATS[(i * 3 + 1) % COATS.length];
        root.addChild(body);
        root.visible = false;
        h.layer.addChild(root);
        // Two loose files, and a fixed lateral place inside the file: computed
        // ONCE, so the goal a walker steers at never moves under it (it.101).
        const offX = ((i % 2) - 0.5) * 1.1 + (((i * 7) % 5) - 2) * 0.08;
        const offY = ((i % 3) - 1) * 0.55 + (((i * 11) % 5) - 2) * 0.07;
        this.walkers.push({
          root, body, x: h.from.x + 0.5 + offX, y: h.from.y + 0.5 + offY, leg: 0,
          delay: this.walkAt + i * 0.42, dir: 2, clock: (i % 7) / 7, speed: 1.3 + ((i * 3) % 5) * 0.06,
          done: false, anim: sheet.anim, fc: spriteLib.anim(sheet.anim).frameCount,
          coat: COATS[(i * 3 + 1) % COATS.length], offX, offY, n: i,
        });
      }
    }
  }

  get running(): boolean {
    return !this.finished;
  }

  /** True while a spoken line is on screen waiting to be advanced (it.103). */
  get waiting(): boolean {
    return this.awaiting;
  }

  /**
   * The player says go. Takes the line down and lets the next one come when its
   * beat arrives. A no-op when nothing is waiting, so a mashed key is harmless.
   */
  advance(): boolean {
    if (this.finished || !this.awaiting) return false;
    this.awaiting = false;
    this.h.sayDone?.();
    return true;
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
    // WHAT IS SAID OVER IT (it.101): each line once, when its beat arrives.
    const speech = h.speech;
    if (speech && h.say) {
      // ONE LINE AT A TIME (it.103). A beat only goes up when the last one has
      // been read; a named beat then holds the page until the player advances it.
      while (!this.awaiting && this.said < speech.length && t >= speech[this.said].t) {
        const beat = speech[this.said++];
        h.say(beat);
        if (beat.wait ?? !!beat.speaker) this.awaiting = true;
      }
    }
    // The procession walks the route; the camera drifts with its head.
    let head: Walker | null = null;
    for (const w of this.walkers) {
      if (t < w.delay || w.root.destroyed) continue;
      w.root.visible = true;
      const goal = h.route[Math.min(w.leg, h.route.length - 1)];
      // The walker's place in the column is FIXED for a given leg (it.101), and
      // STAGGERED BETWEEN legs (it.103): every walker gets its own small lateral
      // and forward offset per waypoint, dealt from its number and the leg, so a
      // column that funnels through one waypoint comes out of it spread again
      // instead of single file through one tile. Deterministic - no random.
      const gx = goal.x + 0.5 + w.offX + ((((w.n * 7 + w.leg * 13) % 7) - 3) * 0.28);
      const gy = goal.y + 0.5 + w.offY + ((((w.n * 11 + w.leg * 5) % 7) - 3) * 0.24);
      const dx = gx - w.x;
      const dy = gy - w.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.25) {
        if (w.leg < h.route.length - 1) w.leg++;
        else w.done = true;
      } else if (!w.done) {
        const step = Math.min(dist, w.speed * dt);
        const nx = w.x + (dx / dist) * step;
        const ny = w.y + (dy / dist) * step;
        // Slide along a wall rather than walk through it (it.101). Without the
        // test a homecoming crossed hedges, carts and the corner of a house.
        const ok = h.isWalkable;
        if (!ok || ok(Math.floor(nx), Math.floor(ny))) {
          w.x = nx;
          w.y = ny;
        } else if (ok(Math.floor(nx), Math.floor(w.y))) {
          w.x = nx;
        } else if (ok(Math.floor(w.x), Math.floor(ny))) {
          w.y = ny;
        } else {
          w.leg = Math.min(w.leg + 1, h.route.length - 1); // boxed in: take the next mark
        }
        w.clock += step * 0.5;
        w.dir = stableDir(dx / dist, dy / dist, w.dir);
      }
      w.body.texture = spriteLib.frame(w.anim, w.dir, w.done ? 0 : Math.floor(w.clock * w.fc) % w.fc);
      const s = worldToScreen(w.x, w.y, this.scratch);
      w.root.position.set(s.x, s.y);
      // A whole tile of depth bias keeps a walker clear of the ground decal it
      // stands on, which is what the clipping at the tile seams was (it.101).
      w.root.zIndex = depthKey(w.x, w.y) + 2;
      if (!head || w.leg > head.leg || (w.leg === head.leg && w.x + w.y > head.x + head.y)) head = w;
    }
    // NO TWO OF THEM IN THE SAME PLACE (it.102). Every walker steers at its own
    // fixed place in the column, but a column that bends round a cart or takes
    // the next mark can still fold two people onto one tile - and a homecoming
    // where two bodies share a shadow reads as one body with a rendering fault.
    // The same shoulder pass the squad uses, in list order, so it is stable.
    for (let i = 0; i < this.walkers.length; i++) {
      const a = this.walkers[i];
      if (!a.root.visible || a.root.destroyed) continue;
      for (let j = i + 1; j < this.walkers.length; j++) {
        const b = this.walkers[j];
        if (!b.root.visible || b.root.destroyed) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= WALKER_SPACING || d === 0) continue;
        const push = (WALKER_SPACING - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        const ok = h.isWalkable;
        if (!ok || ok(Math.floor(a.x - ux * push), Math.floor(a.y - uy * push))) {
          a.x -= ux * push;
          a.y -= uy * push;
        }
        if (!ok || ok(Math.floor(b.x + ux * push), Math.floor(b.y + uy * push))) {
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
    // WHERE THE GROUP IS (it.103): the centroid of everyone actually on the road.
    // Both the camera and the travelling light hang off this, not off whichever
    // walker is momentarily in front, so neither of them judders.
    let cx = 0;
    let cy = 0;
    let onRoad = 0;
    for (const w of this.walkers) {
      if (!w.root.visible || w.root.destroyed) continue;
      cx += w.x;
      cy += w.y;
      onRoad++;
    }
    if (onRoad) {
      cx /= onRoad;
      cy /= onRoad;
      // Biased a little toward the head, so the camera leads the group rather
      // than trailing the stragglers.
      if (head) {
        cx = cx * 0.65 + head.x * 0.35;
        cy = cy * 0.65 + head.y * 0.35;
      }
      if (!this.camSet) {
        this.camX = cx;
        this.camY = cy;
        this.camSet = true;
      } else {
        const k = Math.min(1, dt * 2.6); // a slow pan, not a snap
        this.camX += (cx - this.camX) * k;
        this.camY += (cy - this.camY) * k;
      }
    }
    // THE TRAVELLING SPOTLIGHT (it.102, anchored to the group it.103): it rides
    // the whole column, so every one of them is lit the length of the road home
    // rather than only the person in front.
    if (this.leadSpot) {
      if (onRoad) {
        const s = worldToScreen(this.camX, this.camY, vec2());
        this.leadSpot.position.set(s.x, s.y - 16);
        // It opens out with the column: a group strung along the road is lit by a
        // wider pool than a group still bunched at the gate.
        let spread = 0;
        for (const w of this.walkers) if (w.root.visible && !w.root.destroyed) spread = Math.max(spread, Math.hypot(w.x - this.camX, w.y - this.camY));
        this.leadSpot.scale.set(4.6 + Math.min(4.5, spread * 0.9));
        this.leadSpot.alpha = Math.min(0.55, this.leadSpot.alpha + dt * 0.8) * (0.9 + Math.sin(this.glintClock * 2.6) * 0.1);
      } else this.leadSpot.alpha = Math.max(0, this.leadSpot.alpha - dt * 0.8);
    }
    if (this.mouthSpot) this.mouthSpot.alpha = 0.3 + Math.sin(this.t * 1.7) * 0.06;
    if (t >= this.walkAt + 1.8 && this.camSet) h.focus(this.camX, this.camY);
    // Gold light along the road as they pass.
    this.glintClock += dt;
    if (t >= this.walkAt && this.glintClock > 0.35) {
      this.glintClock = 0;
      if (head) h.ambience.burst(head.x + (Math.random() - 0.5) * 2, head.y + (Math.random() - 0.5) * 2, 0xffd070, 6, { lowEnergy: true });
    }
    if (Math.floor(prev) !== Math.floor(t) && t >= this.walkAt && t < this.endAt - 1) h.ambience.burst(at.x + 0.5 + (Math.random() - 0.5) * 3, at.y + 0.5 + (Math.random() - 0.5) * 3, 0xffe8a0, 10);
    // THE BARS DO NOT LIFT ON AN UNREAD LINE (it.103). The scene's clock can run
    // out while the player is still reading; it waits for them, and for every
    // beat that has not been reached yet.
    const spoken = !speech || (this.said >= speech.length && !this.awaiting);
    // The title fades; then the bars lift and the hero has the camera again.
    if (t >= this.endAt - 1 && spoken) this.overlay.classList.remove('titled');
    if (t >= this.endAt && spoken && !this.finished) {
      this.finished = true;
      this.overlay.classList.remove('show');
      h.release();
      window.setTimeout(() => this.overlay.remove(), 700);
      h.onDone();
    }
  }

  /** Tear the procession down (the world is rebuilt right after). */
  destroy(): void {
    this.ac.abort();
    this.leadSpot?.destroy();
    this.mouthSpot?.destroy();
    if (!this.h.keepWalkers) for (const w of this.walkers) w.root.destroy({ children: true });
    this.walkers.length = 0;
    for (const c of this.cast) c.destroy({ children: true });
    this.cast.length = 0;
    this.overlay.remove();
    this.finished = true;
  }
}

/** The old name (it.91) stays for the harness and the docs. */
export { ProcessionScene as ReclaimScene };
