/**
 * @module town/Villagers
 * Ambient townsfolk (it.39): render-only wanderers that stroll the square,
 * pause, and turn — never simulation entities (they cannot be hit, they
 * carry no state, and their randomness is render-side by design). The
 * shopkeeper stands behind the stall and breathes.
 *
 * Bodies come from the `villager_walk` / `merchant_walk` atlases (8 walk
 * directions × 8 frames, from the coc_chars sheets); frame 0 doubles as
 * the standing pose.
 */

import { Container, Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { spriteLib, stableDir } from '@/render/SpriteLibrary';
import type { Room } from '@/scenes/DungeonGenerator';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';

/**
 * Target height of the atlas cell's painted union. The peasant sheets paint
 * ~40 px bodies inside a 57 px union (raised tools / north poses), so 62
 * here lands the walking body at ~44–52 px on screen — a touch under the hero.
 */
const VILLAGER_HEIGHT = 62;
const WALK_SPEED = 1.35; // tiles / s
const CYCLES_PER_TILE = 0.45;

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

export class Villagers {
  private readonly folk: Villager[] = [];
  private readonly scratch = vec2();
  private readonly scale: number;
  private merchant: { body: Sprite; clock: number } | null = null;

  constructor(
    layer: Container,
    private readonly isWalkable: (gx: number, gy: number) => boolean,
    private readonly area: Room,
    count: number,
    merchantAt: { x: number; y: number } | null,
  ) {
    const painted = spriteLib.paintedHeight('villager_walk') || 36;
    this.scale = VILLAGER_HEIGHT / painted;
    if (spriteLib.hasAnim('villager_walk')) {
      for (let i = 0; i < count; i++) {
        const p = this.randomTile();
        const root = new Container();
        root.scale.set(0.8);
        const shadow = new Sprite(assets.get('shadow'));
        shadow.anchor.set(0.5, 0.5);
        shadow.alpha = 0.7;
        root.addChild(shadow);
        const body = new Sprite(spriteLib.frame('villager_walk', 6, 0));
        body.anchor.set(0.5, 0.86);
        body.scale.set(this.scale / 0.8); // Undo the shadow root's scale.
        body.position.set(0, -1);
        root.addChild(body);
        layer.addChild(root);
        this.folk.push({ root, body, x: p.x, y: p.y, tx: p.x, ty: p.y, pause: Math.random() * 3, dir: 6, walkClock: 0, idleClock: Math.random() * 10 });
      }
    }
    if (merchantAt && spriteLib.hasAnim('merchant_walk')) {
      const body = new Sprite(spriteLib.frame('merchant_walk', 6, 0));
      body.anchor.set(0.5, 0.86);
      body.scale.set(this.scale);
      const s = worldToScreen(merchantAt.x + 0.5, merchantAt.y + 0.5, this.scratch);
      body.position.set(s.x, s.y + 2);
      body.zIndex = depthKey(merchantAt.x + 0.5, merchantAt.y + 0.5);
      layer.addChild(body);
      this.merchant = { body, clock: 0 };
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
      const fc = spriteLib.anim('villager_walk').frameCount;
      const frame = walking ? Math.floor(v.walkClock * fc) : 0;
      v.body.texture = spriteLib.frame('villager_walk', v.dir, frame);
      v.body.scale.y = (this.scale / 0.8) * (walking ? 1 : 1 + Math.sin(v.idleClock * 1.6) * 0.015);
      const s = worldToScreen(v.x, v.y, this.scratch);
      v.root.position.set(s.x, s.y);
      v.root.zIndex = depthKey(v.x, v.y);
      v.body.tint = tint(v.x, v.y);
    }
    if (this.merchant) {
      this.merchant.clock += dt;
      this.merchant.body.scale.y = this.scale * (1 + Math.sin(this.merchant.clock * 1.4) * 0.02);
    }
  }

  destroy(): void {
    for (const v of this.folk) v.root.destroy({ children: true });
    this.folk.length = 0;
    this.merchant?.body.destroy();
    this.merchant = null;
  }
}
