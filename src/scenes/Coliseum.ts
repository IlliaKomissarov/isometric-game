/**
 * @module scenes/Coliseum
 * THE TRIAL COLISEUM (it.53 / it.54): a standalone wave arena reached from
 * the town. One vast elliptical sand floor ringed by a cobbled walk, a stone
 * wall, and stands crowded with a CHEERING crowd; four gate pads (N / E / S /
 * W) where each wave rises out of the sand. No fog: the whole ground and the
 * stands are lit by flickering torchlight, and sand drifts across the floor.
 *
 * The map is a plain DungeonMap (plus the town-style `tileKind` so the town
 * floor textures paint sand and cobble); the dressing is render-only.
 */

import { Graphics, Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import type { Ambience } from '@/engine/Ambience';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import { spriteLib, type AnimName } from '@/render/SpriteLibrary';
import { KIND_COBBLE, KIND_SAND } from '@/town/TownMap';
import { depthKey, worldToScreen } from '@/utils/iso';
import { mulberry32 } from '@/utils/rng';
import { vec2 } from '@/utils/Vec2';
import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type DungeonMap } from './DungeonGenerator';

export const COLISEUM_W = 46;
export const COLISEUM_H = 40;
const RX = 19;
const RY = 15;

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
  const tileKind = new Uint8Array(W * H).fill(KIND_SAND);
  const cx = W / 2;
  const cy = H / 2;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const nx = (x + 0.5 - cx) / RX;
      const ny = (y + 0.5 - cy) / RY;
      const r = Math.hypot(nx, ny);
      if (r <= 1) {
        grid[y * W + x] = TILE_FLOOR;
        tileKind[y * W + x] = r > 0.84 ? KIND_COBBLE : KIND_SAND;
      }
    }
  }
  const pad = (theta: number): { x: number; y: number } => ({
    x: Math.round(cx + Math.cos(theta) * RX * 0.78 - 0.5),
    y: Math.round(cy + Math.sin(theta) * RY * 0.78 - 0.5),
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
 * Torches and candelabra on the walk, pillars, banners and iron cages on the
 * wall, barricades at the gates, blood and broken steel on the sand, and a
 * crowd of townsfolk in the stands that cheers all match long.
 */
export function dressColiseum(map: ColiseumMap, viewport: Viewport, lighting: Lighting, ambience: Ambience): ColiseumDressing {
  const rand = mulberry32((map.seed ^ 0xc0115e) >>> 0);
  const scratch = vec2();
  const made: Array<Sprite | Graphics> = [];
  const torches: Array<{ sprite: Sprite; clock: number }> = [];
  const crowd: Array<{ sprite: Sprite; anim: AnimName; fc: number; baseY: number; phase: number; rate: number; cheer: boolean; timer: number }> = [];
  const W = map.width;
  const cx = W / 2;
  const cy = map.height / 2;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < map.height;
  const isWall = (x: number, y: number): boolean => inside(x, y) && map.grid[y * W + x] === TILE_WALL;
  const isFloor = (x: number, y: number): boolean => inside(x, y) && map.grid[y * W + x] === TILE_FLOOR;
  const onRing = (theta: number, k: number): { x: number; y: number } => ({
    x: Math.round(cx + Math.cos(theta) * RX * k - 0.5),
    y: Math.round(cy + Math.sin(theta) * RY * k - 0.5),
  });

  /** A floor fixture claims its tile (it.56): nothing walks through a torch or a barricade. */
  const claim = (gx: number, gy: number): void => {
    if (isFloor(gx, gy)) map.grid[gy * W + gx] = TILE_BLOCKED;
  };
  const stand = (single: string, gx: number, gy: number, anchorY: number, scale = 1, tint = 0xffffff, lift = 0, layer: 'object' | 'ground' = 'object'): Sprite | null => {
    if (!spriteLib.hasSingle(single)) return null;
    if (layer === 'object') claim(gx, gy);
    const spr = new Sprite(spriteLib.single(single));
    spr.anchor.set(0.5, anchorY);
    spr.scale.set(scale);
    spr.tint = tint;
    const s = worldToScreen(gx + 0.5, gy + 0.5, scratch);
    spr.position.set(s.x, s.y + 4 - lift);
    spr.zIndex = depthKey(gx + 0.5, gy + 0.5) + (isWall(gx, gy) ? 40 : 0);
    (layer === 'ground' ? viewport.groundLayer : viewport.objectLayer).addChild(spr);
    lighting.registerProp(Math.min(W - 1, Math.max(0, gx)), Math.min(map.height - 1, Math.max(0, gy)), spr);
    made.push(spr);
    return spr;
  };

  // ---- Ring fixtures: candelabra + torches on the walk, pillars, banners and cages on the wall ----
  const FIXTURES = 16;
  const hotspots: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < FIXTURES; i++) {
    const theta = (i / FIXTURES) * Math.PI * 2;
    const w = onRing(theta, 0.9);
    if (i % 4 !== 0) {
      if (i % 2 === 0) {
        // Candle stands and candelabra alternate around the walk (it.55).
        stand(i % 4 === 2 && spriteLib.hasSingle('candle_stand') ? 'candle_stand' : 'candelabra', w.x, w.y, 0.95, 0.9);
        lighting.addSource(w.x + 0.5, w.y + 0.5, 4.5, 255, 170, 80, 0.7);
        hotspots.push({ x: w.x + 0.5, y: w.y + 0.5 });
      } else if (spriteLib.hasAnim('torch')) {
        const spr = new Sprite(spriteLib.frame('torch', 0, 0));
        spr.anchor.set(0.5, 0.95);
        claim(w.x, w.y);
        const s = worldToScreen(w.x + 0.5, w.y + 0.5, scratch);
        spr.position.set(s.x, s.y + 4);
        spr.zIndex = depthKey(w.x + 0.5, w.y + 0.5);
        viewport.objectLayer.addChild(spr);
        lighting.registerProp(w.x, w.y, spr);
        lighting.addSource(w.x + 0.5, w.y + 0.5, 4, 255, 150, 60, 0.75);
        made.push(spr);
        torches.push({ sprite: spr, clock: rand() * 3 });
        // FLICKER (it.54): an additive glow that breathes with the flame.
        const glow = new Sprite(assets.get('glow'));
        glow.anchor.set(0.5);
        glow.blendMode = 'add';
        glow.tint = 0xff9a40;
        glow.position.set(s.x, s.y - 30);
        viewport.ambienceLayer.addChild(glow);
        ambience.addGlow(glow, w.x, w.y, 0.55, 1.1);
        made.push(glow);
        hotspots.push({ x: w.x + 0.5, y: w.y + 0.5 });
      }
    }
    // The wall behind: a pillar, and on the odd eighths a war banner or an iron cage.
    const p = onRing(theta, 1.0);
    const px = Math.round(cx + Math.cos(theta) * (RX + 1.4) - 0.5);
    const py = Math.round(cy + Math.sin(theta) * (RY + 1.2) - 0.5);
    if (isWall(px, py)) {
      stand('pillar', px, py, 0.94, 1, 0xc8c0b0);
      if (i % 4 === 2) banner(px, py, i % 8 === 2 ? 0xa0242c : 0x2c3a8a);
      else if (i % 4 === 1 || i % 4 === 3) cage(px, py);
    }
    void p;
  }
  ambience.setHotspots(hotspots);

  /** A war banner: a pole with a cloth of the house colour, gold-trimmed. */
  function banner(gx: number, gy: number, color: number): void {
    const g = new Graphics();
    g.moveTo(0, 0).lineTo(0, -62).stroke({ width: 2, color: 0x4a3a2a });
    g.rect(1, -60, 16, 30).fill({ color, alpha: 0.95 });
    g.moveTo(1, -30).lineTo(9, -22).lineTo(17, -30).fill({ color, alpha: 0.95 });
    g.rect(1, -60, 16, 3).fill({ color: 0xd8b45c });
    g.moveTo(1, -60).lineTo(1, -30).stroke({ width: 1, color: 0x000000, alpha: 0.35 });
    g.circle(0, -63, 2.5).fill({ color: 0xd8b45c });
    const s = worldToScreen(gx + 0.5, gy + 0.5, scratch);
    g.position.set(s.x + 12, s.y - 4);
    g.zIndex = depthKey(gx + 0.5, gy + 0.5) + 42;
    viewport.objectLayer.addChild(g);
    lighting.registerProp(gx, gy, g as unknown as Sprite);
    made.push(g);
  }
  /** An iron cage on the wall (it.55: the barred stone gate from the dungeon pack). */
  function cage(gx: number, gy: number): void {
    const spr = stand(spriteLib.hasSingle('iron_cage') ? 'iron_cage' : 'gate_closed', gx, gy, 0.96, 0.6, 0xc8c8d0, 4);
    if (spr) spr.zIndex += 3;
  }

  // ---- WEAPON RACKS (it.56): the sword cases stand on the WALL beside the cages,
  // never on the sand — nothing tomb-shaped in the walkable ring.
  for (let i = 0; i < 4; i++) {
    const theta = Math.PI / 4 + (i * Math.PI) / 2 + 0.2;
    const gx = Math.round(cx + Math.cos(theta) * (RX + 1.5) - 0.5);
    const gy = Math.round(cy + Math.sin(theta) * (RY + 1.25) - 0.5);
    if (isWall(gx, gy)) stand('weapon_rack', gx, gy, 0.92, 0.7, 0xffffff, 8);
  }
  // ---- ROCKS (it.55): boulders at the foot of the wall ----
  const ROCKS = ['rock_a', 'rock_b', 'rock_c', 'rock_d', 'rock_e', 'rock_f'];
  for (let i = 0; i < 22; i++) {
    const theta = (i / 22) * Math.PI * 2 + 0.11;
    const gx = Math.round(cx + Math.cos(theta) * (RX + 0.9) - 0.5);
    const gy = Math.round(cy + Math.sin(theta) * (RY + 0.8) - 0.5);
    if (isWall(gx, gy)) stand(ROCKS[Math.floor(rand() * ROCKS.length)], gx, gy, 0.92, 0.55 + rand() * 0.35, 0xb8b0a8, 0);
  }

  // ---- The gates: spiked barricades flanking each pad on the walk ----
  for (let i = 0; i < map.pads.length; i++) {
    const theta = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][i];
    for (const side of [-1, 1]) {
      const t = theta + side * 0.16;
      const b = onRing(t, 0.9);
      if (isFloor(b.x, b.y)) stand('fence', b.x, b.y, 0.9, 1, 0xb0a898);
    }
  }

  // ---- The sand: blood-soaked patches and broken steel ----
  const BLOOD = ['blood_1', 'blood_2', 'blood_3', 'blood_4', 'blood_5'];
  for (let i = 0; i < 34; i++) {
    const a = rand() * Math.PI * 2;
    const k = Math.sqrt(rand()) * 0.8;
    const gx = Math.round(cx + Math.cos(a) * RX * k - 0.5);
    const gy = Math.round(cy + Math.sin(a) * RY * k - 0.5);
    if (!isFloor(gx, gy)) continue;
    const spr = stand(BLOOD[Math.floor(rand() * BLOOD.length)], gx, gy, 0.5, 0.7 + rand() * 0.5, 0x8a1a1a, 0, 'ground');
    if (spr) {
      spr.scale.y *= 0.5;
      spr.alpha = 0.55 + rand() * 0.3;
    }
  }
  const STEEL = ['wicon_iron_sword_0', 'wicon_iron_axe_0', 'wicon_steel_halberd_0', 'wicon_mace_0', 'wicon_bronze_sword_0', 'wicon_iron_katana_0'];
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2;
    const k = 0.25 + Math.sqrt(rand()) * 0.6;
    const gx = Math.round(cx + Math.cos(a) * RX * k - 0.5);
    const gy = Math.round(cy + Math.sin(a) * RY * k - 0.5);
    if (!isFloor(gx, gy)) continue;
    const spr = stand(STEEL[Math.floor(rand() * STEEL.length)], gx, gy, 0.5, 0.42, 0x9a8f80, 0, 'ground');
    if (spr) {
      spr.rotation = rand() * Math.PI * 2;
      spr.scale.y *= 0.55;
      spr.alpha = 0.85;
    }
  }

  // ---- THE STANDS (it.55): four rows of townsfolk, eight models, each on its own
  // cheer loop (idle · bend · rise · idle) or standing still — SEATED in place,
  // never walking; the east side mirrored so every face turns to the sand ----
  const CROWD = ([0, 1, 2, 3, 4, 5, 6, 7].map((i) => `crowd_m${i}`) as AnimName[]).filter((a) => spriteLib.hasAnim(a));
  if (CROWD.length) {
    const painted = spriteLib.paintedHeight(CROWD[0]) || 60;
    const base = 44 / painted;
    const TONES = [0xffffff, 0xf0e8e0, 0xe8d8c8, 0xd8e0d8, 0xf4e4d0, 0xe0d0d0];
    for (let ring = 0; ring < 4; ring++) {
      const count = 88 + ring * 6;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2 + ring * 0.045 + (rand() - 0.5) * 0.02;
        const gx = Math.round(cx + Math.cos(theta) * (RX + 1.1 + ring * 0.78) - 0.5);
        const gy = Math.round(cy + Math.sin(theta) * (RY + 0.9 + ring * 0.62) - 0.5);
        if (!isWall(gx, gy)) continue;
        const animName = CROWD[Math.floor(rand() * CROWD.length)];
        const fc = spriteLib.anim(animName).frameCount;
        const spr = new Sprite(spriteLib.frame(animName, 0, 0));
        spr.anchor.set(0.5, 1);
        const sc = base * (0.88 + rand() * 0.24);
        spr.scale.set(gx + 0.5 > cx ? -sc : sc, sc); // Face the arena.
        spr.tint = TONES[Math.floor(rand() * TONES.length)];
        const s = worldToScreen(gx + 0.5 + (rand() - 0.5) * 0.9, gy + 0.5 + (rand() - 0.5) * 0.6, scratch);
        const baseY = s.y + 2 - ring * 9; // Every row a step higher than the one before.
        spr.position.set(s.x, baseY);
        spr.zIndex = depthKey(gx + 0.5, gy + 0.5) + 41 + ring;
        viewport.objectLayer.addChild(spr);
        lighting.registerProp(gx, gy, spr);
        made.push(spr);
        crowd.push({ sprite: spr, anim: animName, fc, baseY, phase: rand() * Math.PI * 2, rate: 6 + rand() * 5, cheer: rand() < 0.6, timer: 1 + rand() * 4 });
      }
    }
  }

  // Gate pads: a warm glow over each.
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

  const fcTorch = spriteLib.hasAnim('torch') ? spriteLib.anim('torch').frameCount : 1;
  let clock = 0;
  let sandTimer = 0;
  const update = (dt: number): void => {
    clock += dt;
    for (const t of torches) {
      t.clock += dt;
      t.sprite.texture = spriteLib.frame('torch', 0, Math.floor(t.clock * 10) % fcTorch);
    }
    // THE CROWD (it.55): a spectator either runs its cheer loop (a seamless
    // idle-bend-rise-idle cycle on its own tempo) or stands and breathes; each
    // flips state every few seconds so the stand ripples instead of marching.
    for (const c of crowd) {
      c.timer -= dt;
      if (c.timer <= 0) {
        c.cheer = rand() < 0.6;
        c.timer = 2 + rand() * 5;
      }
      if (c.cheer) {
        const frame = Math.floor(clock * c.rate + c.phase) % c.fc;
        c.sprite.texture = spriteLib.frame(c.anim, 0, frame);
        c.sprite.position.y = c.baseY - Math.abs(Math.sin(clock * c.rate * 0.45 + c.phase)) * 2.5;
      } else {
        c.sprite.texture = spriteLib.frame(c.anim, 0, 0);
        c.sprite.position.y = c.baseY - (0.5 + 0.5 * Math.sin(clock * 1.6 + c.phase)) * 1.2;
      }
    }
    // SAND (it.54): a dry drift across the floor.
    sandTimer += dt;
    if (sandTimer > 0.3) {
      sandTimer = 0;
      const a = rand() * Math.PI * 2;
      const k = Math.sqrt(rand()) * 0.85;
      ambience.sparks(cx + Math.cos(a) * RX * k, cy + Math.sin(a) * RY * k, 0.6, 0.15, 2, 0xd8c090);
    }
  };
  const destroy = (): void => {
    for (const s of made) if (!s.destroyed) s.destroy();
    made.length = 0;
    torches.length = 0;
    crowd.length = 0;
  };
  return { update, destroy };
}
