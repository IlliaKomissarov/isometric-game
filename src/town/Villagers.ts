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

import { Container, Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { spriteLib, stableDir } from '@/render/SpriteLibrary';
import type { Room } from '@/scenes/DungeonGenerator';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';

/** Painted height on screen — the hero standard. */
const FOLK_HEIGHT = 56;
const WALK_SPEED = 1.25; // tiles / s
const CYCLES_PER_TILE = 0.5;
const WALK = 'folk_walk';
const GUARD_IDLE = 'poacher_idle';

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
}

interface Guard {
  body: Sprite;
  clock: number;
  x: number;
  y: number;
}

export class Villagers {
  private readonly folk: Villager[] = [];
  private readonly guards: Guard[] = [];
  private readonly scratch = vec2();
  private readonly scale: number;
  private merchant: { body: Sprite; clock: number; scale: number } | null = null;
  /** The ALCHEMIST (it.48): the merchant body in violet robes behind the south stall. */
  private alchemist: { body: Sprite; clock: number; scale: number } | null = null;

  constructor(
    layer: Container,
    private readonly isWalkable: (gx: number, gy: number) => boolean,
    private readonly area: Room,
    count: number,
    merchantAt: { x: number; y: number } | null,
    guardsAt: ReadonlyArray<{ x: number; y: number }> = [],
    alchemistAt: { x: number; y: number } | null = null,
  ) {
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
        this.folk.push({ root, body, x: p.x, y: p.y, tx: p.x, ty: p.y, pause: Math.random() * 3, dir: 6, walkClock: 0, idleClock: Math.random() * 10 });
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
      layer.addChild(body);
      this.merchant = { body, clock: 0, scale: mscale };
    }
    if (alchemistAt && spriteLib.hasAnim('merchant_walk')) {
      const mp = spriteLib.paintedHeight('merchant_walk') || 57;
      const mscale = 62 / mp;
      const body = new Sprite(spriteLib.frame('merchant_walk', 5, 0));
      body.anchor.set(0.5, 0.86);
      body.scale.set(mscale);
      body.tint = 0xb8a0ff; // Violet robes: the alchemist.
      const s = worldToScreen(alchemistAt.x + 0.5, alchemistAt.y + 0.5, this.scratch);
      body.position.set(s.x, s.y + 2);
      body.zIndex = depthKey(alchemistAt.x + 0.5, alchemistAt.y + 0.5);
      layer.addChild(body);
      this.alchemist = { body, clock: 0.9, scale: mscale };
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
        this.guards.push({ body, clock: Math.random() * 3, x: at.x + 0.5, y: at.y + 0.5 });
      }
    }
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
    }
    if (this.merchant) {
      this.merchant.clock += dt;
      this.merchant.body.scale.y = this.merchant.scale * (1 + Math.sin(this.merchant.clock * 1.4) * 0.02);
    }
    if (this.alchemist) {
      this.alchemist.clock += dt;
      this.alchemist.body.scale.y = this.alchemist.scale * (1 + Math.sin(this.alchemist.clock * 1.3) * 0.02);
    }
    if (this.guards.length && spriteLib.hasAnim(GUARD_IDLE)) {
      const gfc = spriteLib.anim(GUARD_IDLE).frameCount;
      for (const g of this.guards) {
        g.clock += dt;
        g.body.texture = spriteLib.frame(GUARD_IDLE, 6, Math.floor(g.clock * 6) % gfc);
        g.body.tint = tint(g.x, g.y);
      }
    }
  }

  destroy(): void {
    for (const v of this.folk) v.root.destroy({ children: true });
    this.folk.length = 0;
    this.merchant?.body.destroy();
    this.merchant = null;
    this.alchemist?.body.destroy();
    this.alchemist = null;
    for (const g of this.guards) g.body.destroy();
    this.guards.length = 0;
  }
}
