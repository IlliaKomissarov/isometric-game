/**
 * @module ui/TitleScreen
 * THE TITLE ATMOSPHERE (it.61): a Pixi scene under the main menu.
 *
 *   Layer 1 · depth    — two seamless noise fog sheets drifting sideways at
 *                        different speeds with a slow vertical breath.
 *   Layer 2 · light    — brazier glows in the bottom corners, flickering on
 *                        stacked incommensurate sines, a warm wash over the
 *                        floor, and a vignette whose weight pulses.
 *   Layer 3 · motes    — embers rising (additive, warm, swaying) and dark ash
 *                        falling and turning, every one its own speed and
 *                        opacity.
 *   Sparks             — a gold burst wherever a menu button is struck.
 *
 * The scene renders through the game's own renderer on its own rAF while the
 * menu is up; `hide()` tears it out before a run takes the stage. Every
 * texture is drawn once on a canvas at construction — no assets to load.
 * Sub-menus dim it (`setDim`), which is polled off the DOM so no panel needs
 * a hook.
 */

import { type Application, Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import { visuals } from '@/core/VisualSettings';
import { perf } from '@/core/PerformanceScaler';

/** Hermite ease between two edges (the intro's staged fades). */
function smoothstep(a: number, b: number, x: number): number {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

interface Mote {
  spr: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
  sway: number;
  phase: number;
  spin: number;
  peak: number;
}

interface Spark {
  spr: Sprite;
  vx: number;
  vy: number;
  life: number;
}

const DIM_SELECTOR = '#class-select.show, #settings-panel.open, #leaderboard.open, #credits.show, #coop-panel.show, #save-panel.open, #exit-modal.open';

/** A seamless smoke sheet: soft blobs drawn small with wrap-around, scaled up. */
function fogTexture(): Texture {
  const small = document.createElement('canvas');
  small.width = 128;
  small.height = 128;
  const ctx = small.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 128;
    const y = rnd() * 128;
    const r = 14 + rnd() * 34;
    const a = 0.12 + rnd() * 0.2;
    for (const ox of [-128, 0, 128]) {
      for (const oy of [-128, 0, 128]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  const big = document.createElement('canvas');
  big.width = 512;
  big.height = 512;
  const bctx = big.getContext('2d')!;
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(small, 0, 0, 512, 512);
  return Texture.from(big);
}

function radialTexture(size: number, stops: Array<[number, string]>): Texture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}

function verticalTexture(stops: Array<[number, string]>): Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  return Texture.from(c);
}

export class TitleScreen {
  readonly root = new Container();
  private readonly backdrop: Sprite;
  private readonly fog: TilingSprite[] = [];
  private readonly floorGlow: Sprite;
  private readonly braziers: Array<{ spr: Sprite; core: Sprite; seed: number; side: -1 | 1 }> = [];
  private readonly motes: Mote[] = [];
  private readonly sparks: Spark[] = [];
  private readonly moteLayer = new Container();
  private readonly ashLayer = new Container();
  private readonly sparkLayer = new Container();
  private readonly vignette: Sprite;
  private readonly dimmer: Sprite;
  private readonly emberTex: Texture;
  private readonly ashTex: Texture;
  private running = false;
  private raf = 0;
  private lastT = 0;
  private clock = 0;
  private dim = 0;
  private dimTarget = 0;
  private wasDim = false;
  /**
   * INTRO (it.62): 0 at the black, 1 once the scene stands at rest. Read off
   * the WALL CLOCK, not accumulated frames — a tab hidden mid-sequence must
   * come back to a title that already stands, not to a frozen black screen.
   */
  private introAt = -1;
  private introSpan = 1.5;
  private readonly onResize = (): void => this.layout();
  /** Fires when every sub-menu has closed again (focus goes back to the stack). */
  onUndim: (() => void) | null = null;

  constructor(private readonly app: Application) {
    this.backdrop = new Sprite(verticalTexture([[0, '#14101c'], [0.45, '#0b0910'], [1, '#040306']]));
    this.root.addChild(this.backdrop);

    const fogTex = fogTexture();
    for (const [tint, alpha, scale] of [
      [0x5a5670, 0.2, 2.6],
      [0x3c3a52, 0.26, 1.7],
    ] as Array<[number, number, number]>) {
      const t = new TilingSprite({ texture: fogTex, width: 64, height: 64 });
      t.tint = tint;
      t.alpha = alpha;
      t.blendMode = 'screen';
      t.tileScale.set(scale);
      this.fog.push(t);
      this.root.addChild(t);
    }

    this.floorGlow = new Sprite(verticalTexture([[0, 'rgba(255,120,50,0)'], [1, 'rgba(255,120,50,0.45)']]));
    this.floorGlow.blendMode = 'add';
    this.root.addChild(this.floorGlow);

    const glowTex = radialTexture(256, [
      [0, 'rgba(255,190,110,0.9)'],
      [0.25, 'rgba(255,120,50,0.5)'],
      [0.6, 'rgba(180,50,20,0.12)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    const coreTex = radialTexture(128, [
      [0, 'rgba(255,240,200,1)'],
      [0.3, 'rgba(255,170,80,0.7)'],
      [1, 'rgba(255,100,40,0)'],
    ]);
    for (const side of [-1, 1] as const) {
      const spr = new Sprite(glowTex);
      spr.anchor.set(0.5);
      spr.blendMode = 'add';
      const core = new Sprite(coreTex);
      core.anchor.set(0.5);
      core.blendMode = 'add';
      this.root.addChild(spr, core);
      this.braziers.push({ spr, core, seed: side === -1 ? 0.7 : 2.9, side });
    }

    this.ashTex = radialTexture(16, [
      [0, 'rgba(40,34,44,1)'],
      [0.5, 'rgba(30,26,34,0.9)'],
      [1, 'rgba(20,18,24,0)'],
    ]);
    this.emberTex = radialTexture(16, [
      [0, 'rgba(255,240,200,1)'],
      [0.35, 'rgba(255,170,80,0.9)'],
      [1, 'rgba(255,90,30,0)'],
    ]);
    this.root.addChild(this.ashLayer, this.moteLayer);

    this.vignette = new Sprite(
      radialTexture(512, [
        [0, 'rgba(0,0,0,0)'],
        [0.42, 'rgba(0,0,0,0)'],
        [0.75, 'rgba(0,0,0,0.55)'],
        [1, 'rgba(0,0,0,0.95)'],
      ]),
    );
    this.vignette.anchor.set(0.5);
    this.root.addChild(this.vignette);
    this.dimmer = new Sprite(Texture.WHITE);
    this.dimmer.tint = 0x000000;
    this.dimmer.alpha = 0;
    this.root.addChild(this.dimmer, this.sparkLayer);
  }

  // --- Lifecycle ----------------------------------------------------------------

  show(): void {
    if (this.running) return;
    this.running = true;
    this.app.stage.addChild(this.root);
    this.layout();
    this.seedMotes();
    window.addEventListener('resize', this.onResize);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  hide(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.root.removeFromParent();
    for (const m of this.motes) m.spr.destroy();
    this.motes.length = 0;
    for (const s of this.sparks) s.spr.destroy();
    this.sparks.length = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * THE OPENING (it.62): black, then the fog sweeps across, the braziers
   * catch, the embers rise. Runs on the scene's own clock, so it survives a
   * slow first frame. `seconds` is the whole sweep.
   */
  playIntro(seconds = 1.5): void {
    this.introSpan = seconds;
    this.introAt = performance.now();
  }

  private get intro(): number {
    if (this.introAt < 0) return 1;
    return Math.min(1, (performance.now() - this.introAt) / (this.introSpan * 1000));
  }

  get introDone(): boolean {
    return this.intro >= 1;
  }

  /** Sub-menus lower the scene (also polled from the DOM every frame). */
  setDim(on: boolean): void {
    this.dimTarget = on ? 1 : 0;
  }

  /** A gold spark burst at a screen point (a struck menu button). */
  burst(x: number, y: number, count = 16): void {
    if (!this.running) return;
    for (let i = 0; i < count; i++) {
      const spr = new Sprite(this.emberTex);
      spr.anchor.set(0.5);
      spr.blendMode = 'add';
      spr.tint = i % 3 === 0 ? 0xfff0c0 : 0xffc860;
      spr.scale.set(0.35 + Math.random() * 0.45);
      spr.position.set(x, y);
      this.sparkLayer.addChild(spr);
      const a = Math.random() * Math.PI * 2;
      const v = 90 + Math.random() * 220;
      this.sparks.push({ spr, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.5 + Math.random() * 0.4 });
    }
  }

  /** One update + render outside the rAF (QA in occluded tabs). */
  renderOnce(dt = 1 / 60): void {
    this.update(dt);
    this.app.renderer.render(this.app.stage);
  }

  /** Average milliseconds per update+render over `n` frames. */
  benchmark(n = 120): number {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.renderOnce();
    return (performance.now() - t0) / n;
  }

  // --- Layout ------------------------------------------------------------------

  private layout(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.backdrop.width = w;
    this.backdrop.height = h;
    for (const f of this.fog) {
      f.width = w;
      f.height = h;
    }
    this.floorGlow.width = w;
    this.floorGlow.height = h * 0.55;
    this.floorGlow.position.set(0, h * 0.45);
    for (const b of this.braziers) {
      const x = b.side === -1 ? w * 0.08 : w * 0.92;
      b.spr.position.set(x, h * 0.96);
      b.core.position.set(x, h * 0.96);
      b.spr.scale.set(Math.max(2.4, w / 480));
      b.core.scale.set(Math.max(0.8, w / 1500));
    }
    const vs = Math.max(w, h) * 1.35;
    this.vignette.position.set(w / 2, h / 2);
    this.vignette.width = vs * (w >= h ? 1.25 : 1);
    this.vignette.height = vs * (h > w ? 1.25 : 1);
    this.dimmer.width = w;
    this.dimmer.height = h;
  }

  private seedMotes(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    // The frame budget has the last word (it.63): a weak device gets a calm sky.
    const budget = perf.particleBudget;
    const embers = Math.round((visuals.particles ? 110 : 36) * budget);
    const ash = Math.round((visuals.particles ? 55 : 18) * budget);
    for (let i = 0; i < embers + ash; i++) {
      const isAsh = i >= embers;
      const spr = new Sprite(isAsh ? this.ashTex : this.emberTex);
      spr.anchor.set(0.5);
      if (!isAsh) spr.blendMode = 'add';
      (isAsh ? this.ashLayer : this.moteLayer).addChild(spr);
      const m: Mote = { spr, vx: 0, vy: 0, life: 0, max: 1, sway: 0, phase: 0, spin: 0, peak: 1 };
      this.resetMote(m, isAsh, w, h, true);
      this.motes.push(m);
    }
  }

  private resetMote(m: Mote, isAsh: boolean, w: number, h: number, initial: boolean): void {
    m.max = isAsh ? 9 + Math.random() * 9 : 5 + Math.random() * 7;
    m.life = initial ? Math.random() * m.max : 0;
    m.phase = Math.random() * Math.PI * 2;
    if (isAsh) {
      m.spr.position.set(Math.random() * w, initial ? Math.random() * h : -10);
      m.vx = (Math.random() - 0.5) * 8;
      m.vy = 12 + Math.random() * 22;
      m.sway = 6 + Math.random() * 14;
      m.spin = (Math.random() - 0.5) * 1.6;
      m.peak = 0.35 + Math.random() * 0.4;
      m.spr.scale.set(0.5 + Math.random() * 0.8, 0.3 + Math.random() * 0.5);
      m.spr.tint = 0xffffff;
    } else {
      // Embers rise from the braziers' corners and the floor's glow.
      const fromLeft = Math.random() < 0.5;
      const x = fromLeft ? w * (0.02 + Math.random() * 0.22) : w * (0.76 + Math.random() * 0.22);
      m.spr.position.set(Math.random() < 0.25 ? Math.random() * w : x, initial ? Math.random() * h : h + 8);
      m.vx = (Math.random() - 0.5) * 10;
      m.vy = -(18 + Math.random() * 42);
      m.sway = 4 + Math.random() * 12;
      m.spin = 0;
      m.peak = 0.35 + Math.random() * 0.6;
      m.spr.scale.set(0.18 + Math.random() * 0.4);
      m.spr.tint = Math.random() < 0.3 ? 0xffe0a0 : 0xff9a40;
    }
    m.spr.alpha = 0;
  }

  // --- Frame ---------------------------------------------------------------------

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    this.update(dt);
    this.app.renderer.render(this.app.stage);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private update(dt: number): void {
    this.clock += dt;
    const t = this.clock;
    const io = this.intro;
    // The sweep: fog first, then the light, then the motes.
    const fogIn = smoothstep(0, 0.5, io);
    const lightIn = smoothstep(0.25, 0.85, io);
    const moteIn = smoothstep(0.45, 1, io);
    const w = this.app.screen.width;
    const h = this.app.screen.height;

    // The DOM says whether a sub-menu is up: dim without a single hook.
    const dimNow = !!document.querySelector(DIM_SELECTOR);
    this.dimTarget = dimNow ? 1 : 0;
    document.getElementById('main-menu')?.classList.toggle('dim', dimNow);
    if (this.wasDim && !dimNow) this.onUndim?.();
    this.wasDim = dimNow;
    this.dim += (this.dimTarget - this.dim) * Math.min(1, dt * 9);
    // The intro's blackout rides the same veil the sub-menus dim behind.
    this.dimmer.alpha = Math.max(this.dim * 0.5, 1 - smoothstep(0, 0.55, io));

    // Fog drifts sideways; the two sheets breathe against each other.
    // The opening sweep drives the fog hard across, then it settles.
    const sweep = 1 + (1 - io) * (1 - io) * 40;
    this.fog[0].tilePosition.x += 11 * dt * sweep;
    this.fog[0].tilePosition.y = Math.sin(t * 0.11) * 18;
    this.fog[0].alpha = (0.2 + 0.05 * Math.sin(t * 0.37)) * (1 - this.dim * 0.5) * fogIn;
    this.fog[1].tilePosition.x -= 6.5 * dt * sweep;
    this.fog[1].tilePosition.y = Math.cos(t * 0.083) * 26 + t * 2;
    this.fog[1].alpha = (0.26 + 0.06 * Math.sin(t * 0.29 + 1.7)) * (1 - this.dim * 0.5) * fogIn;

    // Braziers: flame flicker on stacked sines (no two braziers agree).
    for (const b of this.braziers) {
      const s = b.seed;
      const flick = 0.78 + 0.1 * Math.sin(t * 7.3 + s) + 0.06 * Math.sin(t * 13.1 + s * 3) + 0.05 * Math.sin(t * 2.2 + s * 7) + 0.04 * Math.sin(t * 29 + s);
      b.spr.alpha = flick * (1 - this.dim * 0.45) * lightIn;
      b.core.alpha = (0.55 + 0.25 * Math.sin(t * 9.7 + s * 2) + 0.1 * Math.sin(t * 23 + s)) * (1 - this.dim * 0.45) * lightIn;
      const base = Math.max(2.4, w / 480);
      b.spr.scale.set(base * (0.97 + 0.03 * Math.sin(t * 5.1 + s)), base * (1 + 0.05 * Math.sin(t * 6.7 + s * 2)));
    }
    this.floorGlow.alpha = (0.7 + 0.08 * Math.sin(t * 1.9) + 0.04 * Math.sin(t * 6.1)) * (1 - this.dim * 0.4) * lightIn;

    // The vignette's weight pulses with the light.
    this.vignette.alpha = 0.88 + 0.06 * Math.sin(t * 0.8);

    // Motes.
    for (const m of this.motes) {
      const isAsh = m.spr.parent === this.ashLayer;
      m.life += dt;
      if (m.life >= m.max || m.spr.y < -20 || m.spr.y > h + 20) {
        this.resetMote(m, isAsh, w, h, false);
        continue;
      }
      const k = m.life / m.max;
      const envelope = k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1;
      m.spr.alpha = m.peak * envelope * (1 - this.dim * 0.35) * moteIn;
      m.spr.x += (m.vx + Math.sin(t * 0.9 + m.phase) * m.sway) * dt;
      m.spr.y += m.vy * dt;
      if (isAsh) m.spr.rotation += m.spin * dt;
      else m.spr.scale.set(m.spr.scale.x * (1 + 0.6 * Math.sin(t * 11 + m.phase) * dt));
    }

    // Sparks fall and die.
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.spr.destroy();
        this.sparks.splice(i, 1);
        continue;
      }
      s.vy += 420 * dt;
      s.spr.x += s.vx * dt;
      s.spr.y += s.vy * dt;
      s.spr.alpha = Math.min(1, s.life * 2.2);
    }
  }
}
