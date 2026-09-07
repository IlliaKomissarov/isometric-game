/**
 * @module town/Villagers
 * Ambient townsfolk (it.39, re-skinned it.43): render-only wanderers that
 * stroll the square, pause, and turn — never simulation entities (they
 * cannot be hit, they carry no state, and their randomness is render-side
 * by design). The shopkeeper stands behind the stall and breathes; two
 * GATE GUARDS (the poacher pack's idle) keep watch at the dungeon gate.
 *
 * Bodies come from the `folk_walk` atlas (the Villager_01 pack: 8 walk
 * directions × 15 frames, feet-true cells); frame 0 doubles as standing.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { spriteLib, stableDir, type AnimName } from '@/render/SpriteLibrary';
import type { Room } from '@/scenes/DungeonGenerator';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';

/** Painted height on screen — the hero standard. */
const FOLK_HEIGHT = 56;
const WALK_SPEED = 1.25; // tiles / s
const CYCLES_PER_TILE = 0.5;
const WALK = 'folk_walk';
const GUARD_IDLE = 'poacher_idle';
/** The gatekeeper wears the guard's mail (it.87). */
const KEEPER_IDLE = 'guard_idle';

/**
 * AMBIENT CHATTER (it.91): a word or two over a head now and then. Tiny
 * bubbles, render-only, one per speaker, never two at once on the same
 * head; the words come from the district's own bank.
 */
export const TOWN_WORDS = ['Fine day.', 'Bread?', 'Hm.', 'Rain soon.', 'Blessings.', 'Hush.', 'Fresh fish!', 'Ha!', 'Cold wind.', 'The King...', 'Trade?', 'Mind the well.', 'Aye.', 'Wolves, they say.', 'Good steel.', 'Late again.'];
export const VENDOR_WORDS = ['Wares!', 'Fair price.', 'Look here.', 'Best in town.', 'Come, come.'];
export const GUARD_WORDS = ['Move along.', 'All quiet.', 'Halt.', 'Long watch.'];
export const REFUGEE_WORDS = ['Ruin...', 'Burned.', 'Looters!', 'Our homes.', 'Help us.', 'Gone.', 'Twenty of them.', 'The inn...', 'My roof.'];
export const RECLAIMED_WORDS = ['Home!', 'At last.', 'Rebuild.', 'Thank you!', 'Home again.', 'We live.', 'Bless you.', 'Our street.', 'The Stag pours!'];

export interface VillagerOptions {
  /** The bank the folk speak from (none: silent). */
  chatter?: string[];
  vendorWords?: string[];
  guardWords?: string[];
  /** The keeper's colour and body (the innkeeper wears the villager's coat). */
  keeperTint?: number;
  keeperAnim?: string;
}

interface Bubble {
  node: Container;
  bg: Graphics;
  text: Text;
  /** Seconds until the next word. */
  wait: number;
  /** Seconds the current word has left (0: hidden). */
  life: number;
}

const BUBBLE_LIFE = 2.2;

function makeBubble(layer: Container, first: number): Bubble {
  const node = new Container();
  node.visible = false;
  const bg = new Graphics();
  const text = new Text({
    text: '',
    style: { fontFamily: 'Cinzel, Georgia, serif', fontSize: 9, fill: 0xf4e8c8, letterSpacing: 0.5 },
    resolution: 2,
  });
  text.anchor.set(0.5, 1);
  node.addChild(bg);
  node.addChild(text);
  layer.addChild(node);
  return { node, bg, text, wait: first, life: 0 };
}

function speak(b: Bubble, words: string[]): void {
  b.text.text = words[Math.floor(Math.random() * words.length)] ?? '...';
  const w = Math.ceil(b.text.width) + 10;
  const h = Math.ceil(b.text.height) + 6;
  b.bg.clear();
  b.bg.roundRect(-w / 2, -h - 6, w, h, 4).fill({ color: 0x0e0a10, alpha: 0.86 }).stroke({ color: 0x6a5630, width: 1 });
  b.bg.moveTo(-3, -6).lineTo(0, -1).lineTo(3, -6).fill({ color: 0x0e0a10, alpha: 0.86 });
  b.text.position.set(0, -9);
  b.life = BUBBLE_LIFE;
  b.node.visible = true;
  b.node.alpha = 0;
}

/** Tick a bubble: fade in, hold, fade out; seat it over the head at (sx, sy). */
function tickBubble(b: Bubble, dt: number, words: string[] | undefined, sx: number, sy: number, depth: number): void {
  if (!words || !words.length) return;
  if (b.life > 0) {
    b.life -= dt;
    const t = BUBBLE_LIFE - b.life;
    b.node.alpha = Math.min(1, t / 0.25, Math.max(0, b.life) / 0.35);
    b.node.position.set(sx, sy - 2 * Math.sin(t * 2));
    b.node.zIndex = depth + 2;
    if (b.life <= 0) {
      b.node.visible = false;
      b.wait = 6 + Math.random() * 12;
    }
    return;
  }
  b.wait -= dt;
  if (b.wait <= 0) speak(b, words);
}

interface Villager {
  root: Container;
  body: Sprite;
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** Seconds left standing before the next stroll. */
  pause: number;
  dir: number;
  walkClock: number;
  idleClock: number;
  bubble: Bubble;
}

interface Guard {
  body: Sprite;
  clock: number;
  x: number;
  y: number;
  bubble: Bubble;
}

export class Villagers {
  private readonly folk: Villager[] = [];
  private readonly guards: Guard[] = [];
  private keeper: Guard | null = null;
  private readonly scratch = vec2();
  private readonly scale: number;
  private merchant: { body: Sprite; clock: number; scale: number; bubble: Bubble; x: number; y: number } | null = null;
  /** The ALCHEMIST (it.48): the merchant body in violet robes behind the south stall. */
  private alchemist: { body: Sprite; clock: number; scale: number; bubble: Bubble; x: number; y: number } | null = null;
  private readonly opts: VillagerOptions;
  private readonly keeperAnim: AnimName;

  constructor(
    layer: Container,
    private readonly isWalkable: (gx: number, gy: number) => boolean,
    private readonly area: Room,
    count: number,
    merchantAt: { x: number; y: number } | null,
    guardsAt: ReadonlyArray<{ x: number; y: number }> = [],
    alchemistAt: { x: number; y: number } | null = null,
    /** THE MARKET WARD (it.84): the ward's vendors wear their own colours. */
    tints: { merchant?: number; alchemist?: number } = {},
    /** THE GATEKEEPER (it.87): a sentry in mail, breathing, at the eastern road. */
    keeperAt: { x: number; y: number } | null = null,
    /** AMBIENT CHATTER and the keeper's coat (it.91). */
    opts: VillagerOptions = {},
  ) {
    this.opts = opts;
    this.keeperAnim = (opts.keeperAnim && spriteLib.hasAnim(opts.keeperAnim) ? opts.keeperAnim : KEEPER_IDLE) as AnimName;
    const painted = spriteLib.paintedHeight(WALK) || 50;
    this.scale = FOLK_HEIGHT / painted;
    if (spriteLib.hasAnim(WALK)) {
      for (let i = 0; i < count; i++) {
        const p = this.randomTile();
        const root = new Container();
        root.scale.set(0.8);
        const shadow = new Sprite(assets.get('shadow'));
        shadow.anchor.set(0.5, 0.5);
        shadow.alpha = 0.6;
        root.addChild(shadow);
        const body = new Sprite(spriteLib.frame(WALK, 6, 0));
        body.anchor.set(0.5, 1);
        body.scale.set(this.scale / 0.8); // Undo the shadow root's scale.
        body.position.set(0, 2);
        root.addChild(body);
        layer.addChild(root);
        this.folk.push({ root, body, x: p.x, y: p.y, tx: p.x, ty: p.y, pause: Math.random() * 3, dir: 6, walkClock: 0, idleClock: Math.random() * 10, bubble: makeBubble(layer, 2 + Math.random() * 10) });
      }
    }
    if (merchantAt && spriteLib.hasAnim('merchant_walk')) {
      const mp = spriteLib.paintedHeight('merchant_walk') || 57;
      const mscale = 62 / mp;
      const body = new Sprite(spriteLib.frame('merchant_walk', 6, 0));
      body.anchor.set(0.5, 0.86);
      body.scale.set(mscale);
      const s = worldToScreen(merchantAt.x + 0.5, merchantAt.y + 0.5, this.scratch);
      body.position.set(s.x, s.y + 2);
      body.zIndex = depthKey(merchantAt.x + 0.5, merchantAt.y + 0.5);
      if (tints.merchant) body.tint = tints.merchant;
      layer.addChild(body);
      this.merchant = { body, clock: 0, scale: mscale, bubble: makeBubble(layer, 4 + Math.random() * 8), x: merchantAt.x + 0.5, y: merchantAt.y + 0.5 };
    }
    // The ALCHEMIST (it.49): the peasant body in violet, not the merchant's twin.
    const ALCH = spriteLib.hasAnim('villager_walk') ? 'villager_walk' : 'merchant_walk';
    if (alchemistAt && spriteLib.hasAnim(ALCH)) {
      const mp = spriteLib.paintedHeight(ALCH) || 57;
      const mscale = 62 / mp;
      const body = new Sprite(spriteLib.frame(ALCH, 6, 0));
      body.anchor.set(0.5, 0.86);
      body.scale.set(mscale);
      body.tint = tints.alchemist ?? 0xb8a0ff; // Violet robes: the alchemist (the scribe's are ice-blue).
      const s = worldToScreen(alchemistAt.x + 0.5, alchemistAt.y + 0.5, this.scratch);
      body.position.set(s.x, s.y + 2);
      body.zIndex = depthKey(alchemistAt.x + 0.5, alchemistAt.y + 0.5);
      layer.addChild(body);
      this.alchemist = { body, clock: 0.9, scale: mscale, bubble: makeBubble(layer, 6 + Math.random() * 8), x: alchemistAt.x + 0.5, y: alchemistAt.y + 0.5 };
    }
    if (spriteLib.hasAnim(GUARD_IDLE)) {
      const gp = spriteLib.paintedHeight(GUARD_IDLE) || 60;
      const gscale = 60 / gp;
      for (const at of guardsAt) {
        const body = new Sprite(spriteLib.frame(GUARD_IDLE, 6, 0));
        body.anchor.set(0.5, 1);
        body.scale.set(gscale);
        const s = worldToScreen(at.x + 0.5, at.y + 0.5, this.scratch);
        body.position.set(s.x, s.y + 2);
        body.zIndex = depthKey(at.x + 0.5, at.y + 0.5);
        layer.addChild(body);
        this.guards.push({ body, clock: Math.random() * 3, x: at.x + 0.5, y: at.y + 0.5, bubble: makeBubble(layer, 8 + Math.random() * 10) });
      }
    }
    if (keeperAt && spriteLib.hasAnim(this.keeperAnim)) {
      const KA = this.keeperAnim;
      const kp = spriteLib.paintedHeight(KA) || 60;
      const kscale = (KA === KEEPER_IDLE ? 64 : 60) / kp;
      const body = new Sprite(spriteLib.frame(KA, KA === KEEPER_IDLE ? 5 : 6, 0));
      body.anchor.set(0.5, KA === KEEPER_IDLE ? 1 : 0.86);
      body.scale.set(kscale);
      body.tint = opts.keeperTint ?? 0xd8c8a8;
      const s = worldToScreen(keeperAt.x + 0.5, keeperAt.y + 0.5, this.scratch);
      body.position.set(s.x, s.y + 2);
      body.zIndex = depthKey(keeperAt.x + 0.5, keeperAt.y + 0.5);
      layer.addChild(body);
      this.keeper = { body, clock: 0.4, x: keeperAt.x + 0.5, y: keeperAt.y + 0.5, bubble: makeBubble(layer, 3 + Math.random() * 6) };
    }
  }

  /** The keeper's tile centre (it.91): where a word bubble or a portrait looks for them. */
  get keeperAt(): { x: number; y: number } | null {
    return this.keeper ? { x: this.keeper.x, y: this.keeper.y } : null;
  }

  private randomTile(): { x: number; y: number } {
    for (let i = 0; i < 40; i++) {
      const gx = this.area.x + Math.floor(Math.random() * this.area.w);
      const gy = this.area.y + Math.floor(Math.random() * this.area.h);
      if (this.isWalkable(gx, gy)) return { x: gx + 0.5, y: gy + 0.5 };
    }
    return { x: this.area.x + this.area.w / 2, y: this.area.y + this.area.h / 2 };
  }

  /** Render-frame update: stroll, pause, breathe; scene-lit by the caller's tint. */
  update(dt: number, tint: (x: number, y: number) => number): void {
    const fc = spriteLib.hasAnim(WALK) ? spriteLib.anim(WALK).frameCount : 1;
    for (const v of this.folk) {
      if (v.pause > 0) {
        v.pause -= dt;
        v.idleClock += dt;
        if (v.pause <= 0) {
          const t = this.randomTile();
          v.tx = t.x;
          v.ty = t.y;
        }
      } else {
        const dx = v.tx - v.x;
        const dy = v.ty - v.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.08) {
          v.pause = 1.5 + Math.random() * 4;
        } else {
          const step = Math.min(dist, WALK_SPEED * dt);
          const nx = v.x + (dx / dist) * step;
          const ny = v.y + (dy / dist) * step;
          // Only walk onto walkable tiles; otherwise give up and idle.
          if (this.isWalkable(Math.floor(nx), Math.floor(ny))) {
            v.x = nx;
            v.y = ny;
            v.walkClock += step * CYCLES_PER_TILE;
            v.dir = stableDir(dx / dist, dy / dist, v.dir);
          } else {
            v.pause = 1 + Math.random() * 2;
          }
        }
      }
      const walking = v.pause <= 0;
      const frame = walking ? Math.floor(v.walkClock * fc) : 0;
      v.body.texture = spriteLib.frame(WALK, v.dir, frame);
      v.body.scale.y = (this.scale / 0.8) * (walking ? 1 : 1 + Math.sin(v.idleClock * 1.6) * 0.015);
      const s = worldToScreen(v.x, v.y, this.scratch);
      v.root.position.set(s.x, s.y);
      v.root.zIndex = depthKey(v.x, v.y);
      v.body.tint = tint(v.x, v.y);
      tickBubble(v.bubble, dt, this.opts.chatter, s.x, s.y - FOLK_HEIGHT * 0.8 - 6, v.root.zIndex);
    }
    const vendorWords = this.opts.vendorWords ?? (this.opts.chatter ? VENDOR_WORDS : undefined);
    if (this.merchant) {
      this.merchant.clock += dt;
      this.merchant.body.scale.y = this.merchant.scale * (1 + Math.sin(this.merchant.clock * 1.4) * 0.02);
      tickBubble(this.merchant.bubble, dt, vendorWords, this.merchant.body.position.x, this.merchant.body.position.y - 60, this.merchant.body.zIndex);
    }
    if (this.alchemist) {
      this.alchemist.clock += dt;
      this.alchemist.body.scale.y = this.alchemist.scale * (1 + Math.sin(this.alchemist.clock * 1.3) * 0.02);
      tickBubble(this.alchemist.bubble, dt, vendorWords, this.alchemist.body.position.x, this.alchemist.body.position.y - 60, this.alchemist.body.zIndex);
    }
    const guardWords = this.opts.guardWords ?? (this.opts.chatter ? GUARD_WORDS : undefined);
    if (this.guards.length && spriteLib.hasAnim(GUARD_IDLE)) {
      const gfc = spriteLib.anim(GUARD_IDLE).frameCount;
      for (const g of this.guards) {
        g.clock += dt;
        g.body.texture = spriteLib.frame(GUARD_IDLE, 6, Math.floor(g.clock * 6) % gfc);
        g.body.tint = tint(g.x, g.y);
        tickBubble(g.bubble, dt, guardWords, g.body.position.x, g.body.position.y - 66, g.body.zIndex);
      }
    }
    if (this.keeper && spriteLib.hasAnim(this.keeperAnim)) {
      const k = this.keeper;
      const KA = this.keeperAnim;
      k.clock += dt;
      if (KA === KEEPER_IDLE) k.body.texture = spriteLib.frame(KA, 5, Math.floor(k.clock * 5) % spriteLib.anim(KA).frameCount);
      else k.body.scale.y = k.body.scale.x * (1 + Math.sin(k.clock * 1.5) * 0.02); // The innkeeper breathes (a walk sheet has no idle).
      k.body.tint = tint(k.x, k.y);
      tickBubble(k.bubble, dt, this.opts.chatter, k.body.position.x, k.body.position.y - 68, k.body.zIndex);
    }
  }

  destroy(): void {
    for (const v of this.folk) {
      v.root.destroy({ children: true });
      v.bubble.node.destroy({ children: true });
    }
    this.folk.length = 0;
    this.merchant?.body.destroy();
    this.merchant?.bubble.node.destroy({ children: true });
    this.merchant = null;
    this.alchemist?.body.destroy();
    this.alchemist?.bubble.node.destroy({ children: true });
    this.alchemist = null;
    for (const g of this.guards) {
      g.body.destroy();
      g.bubble.node.destroy({ children: true });
    }
    this.guards.length = 0;
    this.keeper?.body.destroy();
    this.keeper?.bubble.node.destroy({ children: true });
    this.keeper = null;
  }
}
