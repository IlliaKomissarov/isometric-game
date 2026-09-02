/**
 * @module render/Gore
 * Persistent floor gore (it.43): every death leaves a splat, every heavy
 * hit a drip, and they STAY on the floor for the life of the floor (capped;
 * the oldest fades out first). Decals are baked blood singles (`blood_1..5`)
 * squashed to the 2:1 ground plane, randomly turned and sized, painted in
 * dried-blood tints. Pure render layer — nothing here is simulation state
 * and nothing reads back.
 */

import { Sprite, type Container } from 'pixi.js';
import { spriteLib } from '@/render/SpriteLibrary';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';

const MAX_DECALS = 260;
const TINTS = [0x8e1f14, 0x6a150c, 0x7a1a10, 0x55110a];

export class GoreSystem {
  private readonly decals: Sprite[] = [];
  private readonly scratch = vec2();

  constructor(private readonly ground: Container) {}

  private pick(): string | null {
    if (!spriteLib.loaded) return null;
    for (let tries = 0; tries < 5; tries++) {
      const name = `blood_${1 + Math.floor(Math.random() * 5)}`;
      if (spriteLib.hasSingle(name)) return name;
    }
    return null;
  }

  /** A splat at a world point; `size` 1 = a kill, 0.35 = a drip. */
  splat(x: number, y: number, size = 1): void {
    const name = this.pick();
    if (!name) return;
    const s = new Sprite(spriteLib.single(name));
    s.anchor.set(0.5);
    s.rotation = Math.random() * Math.PI * 2;
    const k = size * (0.7 + Math.random() * 0.6);
    s.scale.set(k, k * 0.55); // Lying on the ground plane.
    s.alpha = 0.78 + Math.random() * 0.17;
    s.tint = TINTS[Math.floor(Math.random() * TINTS.length)];
    const p = worldToScreen(x, y, this.scratch);
    s.position.set(p.x + (Math.random() - 0.5) * 12, p.y + (Math.random() - 0.5) * 6);
    s.zIndex = depthKey(x, y) - 40;
    this.ground.addChild(s);
    this.decals.push(s);
    while (this.decals.length > MAX_DECALS) {
      const old = this.decals.shift();
      old?.destroy();
    }
  }

  /** A few scattered drops around a hit. */
  drip(x: number, y: number, n = 1): void {
    for (let i = 0; i < n; i++) this.splat(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.2);
  }

  /** A kill: one big pool plus scattered spray in the blow's direction. */
  kill(x: number, y: number, dirX = 0, dirY = 0, big = false): void {
    this.splat(x, y, big ? 1.8 : 1.15);
    const n = big ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const d = 0.3 + Math.random() * (big ? 1.4 : 0.9);
      const a = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 1.6;
      this.splat(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.35 + Math.random() * 0.4);
    }
  }

  get count(): number {
    return this.decals.length;
  }

  /** Floor teardown. */
  clear(): void {
    for (const s of this.decals) s.destroy();
    this.decals.length = 0;
  }
}
