/**
 * @module scenes/Coliseum
 * THE TRIAL COLISEUM (it.53): a standalone wave arena reached from the town.
 * One vast elliptical sand floor ringed by a cobbled walk, a stone wall, and
 * stands crowded with spectators; four gate pads (N / E / S / W) where each
 * wave pours in. No fog: the whole ground and the stands are lit.
 *
 * The map is a plain DungeonMap (plus the town-style `tileKind` so the town
 * floor textures paint sand and cobble); the dressing is render-only.
 */

import { Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import type { Ambience } from '@/engine/Ambience';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import { spriteLib } from '@/render/SpriteLibrary';
import { KIND_COBBLE, KIND_DIRT } from '@/town/TownMap';
import { depthKey, worldToScreen } from '@/utils/iso';
import { mulberry32 } from '@/utils/rng';
import { vec2 } from '@/utils/Vec2';
import { TILE_FLOOR, TILE_WALL, type DungeonMap } from './DungeonGenerator';

export const COLISEUM_W = 46;
export const COLISEUM_H = 40;

export interface ColiseumMap extends DungeonMap {
  tileKind: Uint8Array;
  /** The four gate pads (tile coords) — N, E, S, W. */
  pads: Array<{ x: number; y: number }>;
  center: { x: number; y: number };
}

/** The sand ellipse, the cobbled walk, the wall, the gate pads. */
export function generateColiseumMap(seed: number): ColiseumMap {
  const W = COLISEUM_W;
  const H = COLISEUM_H;
  const grid = new Uint8Array(W * H).fill(TILE_WALL);
  const tileKind = new Uint8Array(W * H).fill(KIND_DIRT);
  const cx = W / 2;
  const cy = H / 2;
  const rx = 19;
  const ry = 15;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const r = Math.hypot(nx, ny);
      if (r <= 1) {
        grid[y * W + x] = TILE_FLOOR;
        tileKind[y * W + x] = r > 0.84 ? KIND_COBBLE : KIND_DIRT;
      }
    }
  }
  const pad = (theta: number): { x: number; y: number } => ({
    x: Math.round(cx + Math.cos(theta) * rx * 0.78 - 0.5),
    y: Math.round(cy + Math.sin(theta) * ry * 0.78 - 0.5),
  });
  const pads = [pad(-Math.PI / 2), pad(0), pad(Math.PI / 2), pad(Math.PI)];
  const center = { x: Math.floor(cx), y: Math.floor(cy) };
  return {
    width: W,
    height: H,
    grid,
    rooms: [{ x: 4, y: 5, w: W - 8, h: H - 10 }],
    spawn: { x: center.x, y: center.y + 9 },
    seed,
    tileKind,
    pads,
    center,
  };
}

export interface ColiseumDressing {
  update: (dt: number) => void;
  destroy: () => void;
}

/**
 * Torches and candelabra on the walk, pillars on the wall, and a crowd of
 * townsfolk in the stands (wall tiles just past the ring), all facing in.
 */
export function dressColiseum(map: ColiseumMap, viewport: Viewport, lighting: Lighting, ambience: Ambience): ColiseumDressing {
  const rand = mulberry32((map.seed ^ 0xc0115e) >>> 0);
  const scratch = vec2();
  const made: Sprite[] = [];
  const torches: Array<{ sprite: Sprite; clock: number }> = [];
  const W = map.width;
  const cx = W / 2;
  const cy = map.height / 2;
  const rx = 19;
  const ry = 15;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < map.height;
  const isWall = (x: number, y: number): boolean => inside(x, y) && map.grid[y * W + x] === TILE_WALL;

  const stand = (single: string, gx: number, gy: number, anchorY: number, scale = 1, tint = 0xffffff, lift = 0): Sprite | null => {
    if (!spriteLib.hasSingle(single)) return null;
    const spr = new Sprite(spriteLib.single(single));
    spr.anchor.set(0.5, anchorY);
    spr.scale.set(scale);
    spr.tint = tint;
    const s = worldToScreen(gx + 0.5, gy + 0.5, scratch);
    spr.position.set(s.x, s.y + 4 - lift);
    spr.zIndex = depthKey(gx + 0.5, gy + 0.5) + (isWall(gx, gy) ? 40 : 0);
    viewport.objectLayer.addChild(spr);
    lighting.registerProp(Math.min(W - 1, Math.max(0, gx)), Math.min(map.height - 1, Math.max(0, gy)), spr);
    made.push(spr);
    return spr;
  };

  // Ring fixtures on the cobbled walk: candelabra + torches, pillars on the wall.
  const FIXTURES = 16;
  for (let i = 0; i < FIXTURES; i++) {
    const theta = (i / FIXTURES) * Math.PI * 2;
    const wx = Math.round(cx + Math.cos(theta) * rx * 0.9 - 0.5);
    const wy = Math.round(cy + Math.sin(theta) * ry * 0.9 - 0.5);
    if (i % 4 === 0) continue; // The gate pads keep their approach clear.
    if (i % 2 === 0) {
      stand('candelabra', wx, wy, 0.95, 0.9);
      lighting.addSource(wx + 0.5, wy + 0.5, 4.5, 255, 170, 80, 0.7);
    } else if (spriteLib.hasAnim('torch')) {
      const spr = new Sprite(spriteLib.frame('torch', 0, 0));
      spr.anchor.set(0.5, 0.95);
      const s = worldToScreen(wx + 0.5, wy + 0.5, scratch);
      spr.position.set(s.x, s.y + 4);
      spr.zIndex = depthKey(wx + 0.5, wy + 0.5);
      viewport.objectLayer.addChild(spr);
      lighting.registerProp(wx, wy, spr);
      lighting.addSource(wx + 0.5, wy + 0.5, 4, 255, 150, 60, 0.75);
      made.push(spr);
      torches.push({ sprite: spr, clock: rand() * 3 });
    }
    // A pillar on the wall behind every fixture.
    const px = Math.round(cx + Math.cos(theta) * (rx + 1.4) - 0.5);
    const py = Math.round(cy + Math.sin(theta) * (ry + 1.2) - 0.5);
    if (isWall(px, py)) stand('pillar', px, py, 0.94, 1, 0xc8c0b0);
  }

  // THE STANDS: townsfolk on the wall ring, one to two tiles past the sand,
  // facing the arena — a still frame each, staggered heights and tones.
  const FOLK = 'folk_walk';
  if (spriteLib.hasAnim(FOLK)) {
    const painted = spriteLib.paintedHeight(FOLK) || 50;
    const base = 46 / painted;
    const fc = spriteLib.anim(FOLK).frameCount;
    const TONES = [0xd8cfc0, 0xc8b8a8, 0xb8c0b0, 0xd0c4a8, 0xbfb0a0];
    let placed = 0;
    for (let ring = 0; ring < 2 && placed < 90; ring++) {
      const count = 34 + ring * 8;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2 + ring * 0.09 + (rand() - 0.5) * 0.06;
        const gx = Math.round(cx + Math.cos(theta) * (rx + 1.2 + ring * 1.15) - 0.5);
        const gy = Math.round(cy + Math.sin(theta) * (ry + 1.0 + ring * 1.0) - 0.5);
        if (!isWall(gx, gy)) continue;
        // Face the sand: the row whose direction points back at the centre.
        const dx = cx - gx;
        const dy = cy - gy;
        const screenX = dx - dy;
        const screenY = (dx + dy) / 2;
        let deg = (Math.atan2(-screenY, screenX) * 180) / Math.PI;
        if (deg < 0) deg += 360;
        const dir = Math.round(deg / 45) % 8;
        const spr = new Sprite(spriteLib.frame(FOLK, dir, Math.floor(rand() * fc)));
        spr.anchor.set(0.5, 1);
        spr.scale.set(base * (0.9 + rand() * 0.2));
        spr.tint = TONES[Math.floor(rand() * TONES.length)];
        const s = worldToScreen(gx + 0.5 + (rand() - 0.5) * 0.4, gy + 0.5 + (rand() - 0.5) * 0.4, scratch);
        spr.position.set(s.x, s.y + 2 - ring * 10); // The back row stands a step higher.
        spr.zIndex = depthKey(gx + 0.5, gy + 0.5) + 41 + ring;
        viewport.objectLayer.addChild(spr);
        lighting.registerProp(gx, gy, spr);
        made.push(spr);
        placed++;
      }
    }
  }

  // Banners of the trial: a warm glow over each gate pad.
  for (const p of map.pads) {
    const glow = new Sprite(assets.get('glow'));
    glow.anchor.set(0.5);
    glow.blendMode = 'add';
    glow.tint = 0xd0303a;
    glow.scale.set(1.4, 0.8);
    const s = worldToScreen(p.x + 0.5, p.y + 0.5, scratch);
    glow.position.set(s.x, s.y);
    viewport.ambienceLayer.addChild(glow);
    ambience.addGlow(glow, p.x, p.y, 0.4, 2.2);
    made.push(glow);
  }

  const fc = spriteLib.hasAnim('torch') ? spriteLib.anim('torch').frameCount : 1;
  const update = (dt: number): void => {
    for (const t of torches) {
      t.clock += dt;
      t.sprite.texture = spriteLib.frame('torch', 0, Math.floor(t.clock * 10) % fc);
    }
  };
  const destroy = (): void => {
    for (const s of made) if (!s.destroyed) s.destroy();
    made.length = 0;
    torches.length = 0;
  };
  return { update, destroy };
}
