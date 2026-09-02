/**
 * @module engine/Ambience
 * Atmospheric particle layer: warm ember/dust motes drifting through the
 * torchlight. Pure render-side decoration — it reads the light field but
 * never touches simulation state, so `Math.random()` is fine here.
 *
 * Each mote lives in world space near the player, rises slowly with a lazy
 * horizontal sway, and its brightness is the product of its life envelope and
 * the local light level — so particles fade out naturally at the edge of the
 * torch radius and never appear in unexplored darkness.
 */

import { Sprite, type Texture } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import type { Viewport } from '@/engine/Viewport';
import { vec2 } from '@/utils/Vec2';
import { worldToScreen } from '@/utils/iso';

/** One-shot frame animation (treasure glint). */
interface GlintPlay {
  active: boolean;
  sprite: Sprite;
  clock: number;
}

/** Looping fog-gated frame animation pinned to a tile (gold piles). */
interface LoopingAnim {
  sprite: Sprite;
  frames: Texture[];
  fps: number;
  clock: number;
  gx: number;
  gy: number;
}

interface Mote {
  sprite: Sprite;
  wx: number;
  wy: number;
  /** Height above the floor in screen pixels (rises over life). */
  z: number;
  riseSpeed: number;
  swayPhase: number;
  life: number;
  maxLife: number;
}

/** A pulsing additive glow (brazier flame halo, rune shimmer). */
interface Glow {
  sprite: Sprite;
  gx: number;
  gy: number;
  phase: number;
  baseAlpha: number;
  baseScale: number;
}

/** Short-lived physics particle (blood spray, impact sparks). */
interface BurstParticle {
  active: boolean;
  sprite: Sprite;
  wx: number;
  wy: number;
  /** Height above the floor (screen px) with simple gravity. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  baseAlpha: number;
}

/** One drifting patch of low crypt mist (world-space, ground-hugging). */
interface FogPatch {
  sprite: Sprite;
  wx: number;
  wy: number;
  vx: number;
  vy: number;
  phase: number;
  life: number;
  maxLife: number;
}

const MOTE_COUNT = 64;
const SPAWN_RADIUS = 6.5;
/** Fraction of motes that respawn clustered on a hotspot (brazier embers). */
const HOTSPOT_BIAS = 0.35;
const FOG_PATCH_COUNT = 12;

export class Ambience {
  private readonly motes: Mote[] = [];
  private readonly fogPatches: FogPatch[] = [];
  private readonly glows: Glow[] = [];
  private readonly bursts: BurstParticle[] = [];
  private readonly glints: GlintPlay[] = [];
  private readonly loops: LoopingAnim[] = [];
  private glintFrames: Texture[] | null = null;
  private hotspots: ReadonlyArray<{ x: number; y: number }> = [];
  private readonly scratch = vec2();
  private readonly viewport: Viewport;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    const tex = assets.get('mote');
    for (let i = 0; i < MOTE_COUNT; i++) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      sprite.alpha = 0;
      viewport.ambienceLayer.addChild(sprite);
      const mote: Mote = {
        sprite,
        wx: 0,
        wy: 0,
        z: 0,
        riseSpeed: 0,
        swayPhase: 0,
        life: 0,
        maxLife: 0,
      };
      this.respawn(mote, 0, 0);
      // Stagger initial lifetimes so the field doesn't pulse in unison.
      mote.life = Math.random() * mote.maxLife;
      this.motes.push(mote);
    }

    // Low crypt mist: replaces the purged brazier flames as the atmosphere
    // layer. Cool-tinted, ground-hugging, barely-there.
    const fogTex = assets.get('fogPatch');
    for (let i = 0; i < FOG_PATCH_COUNT; i++) {
      const sprite = new Sprite(fogTex);
      sprite.anchor.set(0.5);
      sprite.tint = 0x8f96b4;
      sprite.alpha = 0;
      viewport.ambienceLayer.addChild(sprite);
      const patch: FogPatch = { sprite, wx: 0, wy: 0, vx: 0, vy: 0, phase: 0, life: 0, maxLife: 1 };
      this.respawnFog(patch, 0, 0);
      patch.life = Math.random() * patch.maxLife;
      this.fogPatches.push(patch);
    }
  }

  /**
   * Register an already-parented additive sprite as a pulsing glow. The
   * caller positions it; Ambience animates alpha/scale and gates it by fog.
   */
  addGlow(sprite: Sprite, gx: number, gy: number, baseAlpha: number, baseScale = 1): void {
    this.glows.push({ sprite, gx, gy, phase: Math.random() * Math.PI * 2, baseAlpha, baseScale });
    sprite.alpha = 0;
  }

  /** Ember-emitter positions (brazier coals) that attract mote respawns. */
  setHotspots(points: ReadonlyArray<{ x: number; y: number }>): void {
    this.hotspots = points;
  }

  /** Soft dust kick at a world point (footsteps, projectile wall impacts). */
  puff(x: number, y: number): void {
    this.burst(x, y, 0x5a5248, 2, { lowEnergy: true });
  }

  /**
   * IMPACT SPARKS (it.36): hot additive flecks thrown along the blow's
   * travel axis — fast, tiny, gravity-bound, gone in a quarter second.
   */
  sparks(x: number, y: number, dirX: number, dirY: number, count: number, color = 0xffe2a0): void {
    const hasDir = dirX !== 0 || dirY !== 0;
    const baseAngle = hasDir ? Math.atan2(dirY, dirX) : 0;
    for (let i = 0; i < count; i++) {
      const p = this.acquireBurst();
      const angle = hasDir ? baseAngle + (Math.random() - 0.5) * 2.2 : Math.random() * Math.PI * 2;
      const speed = 2.2 + Math.random() * 3.4;
      p.active = true;
      p.wx = x;
      p.wy = y;
      p.z = 20 + Math.random() * 14;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.vz = 20 + Math.random() * 60;
      p.life = 0;
      p.maxLife = 0.18 + Math.random() * 0.22;
      p.sprite.tint = color;
      p.sprite.blendMode = 'add';
      p.baseAlpha = 1;
      p.sprite.scale.set(0.22 + Math.random() * 0.3);
      p.sprite.visible = true;
    }
  }

  /**
   * PROJECTILE TRAIL (it.36): one soft mote left behind a flying bolt or
   * arrow each frame — additive ember smear for spells, faint dust for
   * arrows. `z` = height above the floor (screen px).
   */
  trail(x: number, y: number, z: number, color: number, additive: boolean): void {
    const p = this.acquireBurst();
    p.active = true;
    p.wx = x + (Math.random() - 0.5) * 0.08;
    p.wy = y + (Math.random() - 0.5) * 0.08;
    p.z = z + (Math.random() - 0.5) * 4;
    p.vx = (Math.random() - 0.5) * 0.3;
    p.vy = (Math.random() - 0.5) * 0.3;
    p.vz = additive ? 6 + Math.random() * 8 : 2;
    p.life = 0;
    p.maxLife = additive ? 0.28 + Math.random() * 0.14 : 0.16 + Math.random() * 0.1;
    p.sprite.tint = color;
    p.sprite.blendMode = additive ? 'add' : 'normal';
    p.baseAlpha = additive ? 0.8 : 0.35;
    p.sprite.scale.set(additive ? 0.5 + Math.random() * 0.5 : 0.3);
    p.sprite.visible = true;
  }

  /** Pooled burst particle (grows the pool on demand). */
  private acquireBurst(): BurstParticle {
    let p = this.bursts.find((b) => !b.active);
    if (!p) {
      const sprite = new Sprite(assets.get('mote'));
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.viewport.ambienceLayer.addChild(sprite);
      p = { active: false, sprite, wx: 0, wy: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0, baseAlpha: 1 };
      this.bursts.push(p);
    }
    return p;
  }

  /** Provide the glint VFX frames (Lords of Pain pack, set after load). */
  setGlintFrames(frames: Texture[]): void {
    this.glintFrames = frames;
  }

  /** Play a one-shot treasure glint at a world point (chest open, rare drop). */
  playGlint(x: number, y: number): void {
    if (!this.glintFrames) return;
    let g = this.glints.find((it) => !it.active);
    if (!g) {
      const sprite = new Sprite(this.glintFrames[0]);
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      sprite.visible = false;
      this.viewport.ambienceLayer.addChild(sprite);
      g = { active: false, sprite, clock: 0 };
      this.glints.push(g);
    }
    const s = worldToScreen(x, y, this.scratch);
    g.sprite.position.set(s.x, s.y - 14);
    g.sprite.scale.set(0.5);
    g.sprite.visible = true;
    g.active = true;
    g.clock = 0;
  }

  /**
   * Register a looping tile-pinned frame animation (e.g. gold piles).
   * The sprite must already be parented; Ambience drives frames + fog gating.
   */
  addLoopingAnim(sprite: Sprite, frames: Texture[], fps: number, gx: number, gy: number): void {
    this.loops.push({ sprite, frames, fps, clock: Math.random() * frames.length, gx, gy });
  }

  /**
   * VISCERAL directional blood spray (it.14): dark arterial droplets flung
   * along the blow's travel axis with spread, mixed weights and gravity —
   * reads as a wound, not confetti. Falls back to radial when no direction.
   */
  bloodSpray(x: number, y: number, dirX: number | undefined, dirY: number | undefined, count: number): void {
    const hasDir = dirX !== undefined && dirY !== undefined && (dirX !== 0 || dirY !== 0);
    const baseAngle = hasDir ? Math.atan2(dirY!, dirX!) : 0;
    const REDS = [0x8e1f14, 0x6a150c, 0xa8281a, 0x4d0e08];
    for (let i = 0; i < count; i++) {
      let p = this.bursts.find((b) => !b.active);
      if (!p) {
        const sprite = new Sprite(assets.get('mote'));
        sprite.anchor.set(0.5);
        sprite.visible = false;
        this.viewport.ambienceLayer.addChild(sprite);
        p = { active: false, sprite, wx: 0, wy: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0, baseAlpha: 1 };
        this.bursts.push(p);
      }
      // 70% of droplets follow the blow through, the rest splash back.
      const along = Math.random() < 0.7 ? 1 : -0.5;
      const angle = hasDir ? baseAngle + (Math.random() - 0.5) * 1.5 : Math.random() * Math.PI * 2;
      const speed = (0.8 + Math.random() * 2.6) * along;
      p.active = true;
      p.wx = x;
      p.wy = y;
      p.z = 18 + Math.random() * 16;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.vz = 15 + Math.random() * 45;
      p.life = 0;
      p.maxLife = 0.4 + Math.random() * 0.35;
      p.sprite.tint = REDS[Math.floor(Math.random() * REDS.length)];
      p.sprite.blendMode = 'normal';
      p.baseAlpha = 0.95;
      p.sprite.scale.set(0.35 + Math.random() * 0.75);
      p.sprite.visible = true;
    }
  }

  /**
   * Fire a radial particle burst at a world point (blood on hits, sparks).
   * Pure render feedback — call from event handlers, never from sim logic.
   */
  burst(x: number, y: number, color: number, count: number, opts?: { lowEnergy?: boolean }): void {
    const low = opts?.lowEnergy === true;
    for (let i = 0; i < count; i++) {
      let p = this.bursts.find((b) => !b.active);
      if (!p) {
        const sprite = new Sprite(assets.get('mote'));
        sprite.anchor.set(0.5);
        sprite.visible = false;
        this.viewport.ambienceLayer.addChild(sprite);
        p = { active: false, sprite, wx: 0, wy: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0, baseAlpha: 1 };
        this.bursts.push(p);
      }
      const angle = Math.random() * Math.PI * 2;
      const speed = low ? 0.3 + Math.random() * 0.5 : 1.2 + Math.random() * 2.2;
      p.active = true;
      p.wx = x;
      p.wy = y;
      p.z = low ? 2 : 22 + Math.random() * 10;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.vz = low ? 10 + Math.random() * 12 : 30 + Math.random() * 50;
      p.life = 0;
      p.maxLife = low ? 0.3 + Math.random() * 0.15 : 0.45 + Math.random() * 0.3;
      p.sprite.tint = color;
      p.sprite.blendMode = 'normal';
      p.baseAlpha = low ? 0.5 : 1;
      p.sprite.scale.set(low ? 0.35 : 0.4 + Math.random() * 0.5);
      p.sprite.visible = true;
    }
  }

  /**
   * @param px,py      Player render position (world units).
   * @param dt         Real frame delta seconds.
   * @param time       Monotonic seconds (sway animation).
   * @param getLight   Light field sampler (Lighting.getLightAt).
   * @param isVisible  Fog gate for glows (Lighting.isVisible).
   * @param getTint    Scene tint sampler for looping props (Lighting.getTintAt).
   */
  update(
    px: number,
    py: number,
    dt: number,
    time: number,
    getLight: (x: number, y: number) => number,
    isVisible: (gx: number, gy: number) => boolean,
    getTint?: (x: number, y: number) => number,
  ): void {
    // One-shot glints.
    for (const g of this.glints) {
      if (!g.active) continue;
      g.clock += dt * 10;
      const frame = Math.floor(g.clock);
      if (frame >= (this.glintFrames?.length ?? 8)) {
        g.active = false;
        g.sprite.visible = false;
        continue;
      }
      g.sprite.texture = this.glintFrames![frame];
    }

    // Looping tile-pinned animations (gold piles), fog-gated + scene-lit.
    for (const loop of this.loops) {
      // It.26 FIX: a COLLECTED pile's sprite is destroyed — the fog gate
      // must never resurrect it (the gold-reappearing bug).
      if (loop.sprite.destroyed) continue;
      const visible = isVisible(loop.gx, loop.gy);
      loop.sprite.visible = visible;
      if (!visible) continue;
      loop.clock += dt * loop.fps;
      loop.sprite.texture = loop.frames[Math.floor(loop.clock) % loop.frames.length];
      if (getTint) loop.sprite.tint = getTint(loop.gx + 0.5, loop.gy + 0.5);
    }

    for (const glow of this.glows) {
      if (glow.sprite.destroyed) continue;
      if (!isVisible(glow.gx, glow.gy)) {
        glow.sprite.alpha = 0;
        continue;
      }
      const pulse = 0.75 + 0.18 * Math.sin(time * 3.1 + glow.phase) + 0.07 * Math.sin(time * 8.7 + glow.phase * 2);
      glow.sprite.alpha = glow.baseAlpha * pulse;
      glow.sprite.scale.set(glow.baseScale * (0.94 + 0.08 * pulse));
    }

    // Burst particles: radial fling with gravity, dying on floor contact.
    for (const p of this.bursts) {
      if (!p.active) continue;
      p.life += dt;
      p.z += p.vz * dt;
      p.vz -= 220 * dt;
      p.wx += p.vx * dt;
      p.wy += p.vy * dt;
      if (p.life >= p.maxLife || (p.z <= 0 && p.vz < 0)) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const s = worldToScreen(p.wx, p.wy, this.scratch);
      p.sprite.position.set(s.x, s.y - Math.max(0, p.z));
      p.sprite.alpha = p.baseAlpha * (1 - p.life / p.maxLife);
    }

    // Crypt mist: slow drift, soft breathe, lit by the scene like the floor.
    for (const patch of this.fogPatches) {
      patch.life += dt;
      const far = Math.hypot(patch.wx - px, patch.wy - py) > SPAWN_RADIUS + 4;
      if (patch.life >= patch.maxLife || far) this.respawnFog(patch, px, py);
      patch.wx += patch.vx * dt;
      patch.wy += patch.vy * dt;
      const t = patch.life / patch.maxLife;
      const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
      const breathe = 0.85 + 0.15 * Math.sin(time * 0.4 + patch.phase);
      const light = getLight(patch.wx, patch.wy);
      patch.sprite.alpha = envelope * breathe * (0.16 + light * 0.22);
      const s = worldToScreen(patch.wx, patch.wy, this.scratch);
      patch.sprite.position.set(s.x, s.y - 4);
    }

    for (const mote of this.motes) {
      mote.life += dt;
      const far = Math.hypot(mote.wx - px, mote.wy - py) > SPAWN_RADIUS + 2;
      if (mote.life >= mote.maxLife || far) {
        this.respawn(mote, px, py);
      }

      mote.z += mote.riseSpeed * dt;
      mote.wx += Math.sin(time * 0.6 + mote.swayPhase) * 0.06 * dt;
      mote.wy += Math.cos(time * 0.5 + mote.swayPhase * 1.3) * 0.06 * dt;

      // Sine life envelope: fade in, hold, fade out.
      const t = mote.life / mote.maxLife;
      const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
      const light = getLight(mote.wx, mote.wy);
      mote.sprite.alpha = envelope * light * 0.55;

      const s = worldToScreen(mote.wx, mote.wy, this.scratch);
      mote.sprite.position.set(s.x, s.y - mote.z);
    }
  }

  private respawnFog(patch: FogPatch, px: number, py: number): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.5 + Math.sqrt(Math.random()) * (SPAWN_RADIUS + 1.5);
    patch.wx = px + Math.cos(angle) * radius;
    patch.wy = py + Math.sin(angle) * radius;
    const drift = Math.random() * Math.PI * 2;
    const speed = 0.05 + Math.random() * 0.1;
    patch.vx = Math.cos(drift) * speed;
    patch.vy = Math.sin(drift) * speed;
    patch.phase = Math.random() * Math.PI * 2;
    patch.life = 0;
    patch.maxLife = 9 + Math.random() * 8;
    patch.sprite.scale.set(1.1 + Math.random() * 1.6, 0.9 + Math.random() * 0.9);
  }

  private respawn(mote: Mote, px: number, py: number): void {
    // Bias a share of motes toward nearby braziers — embers rise off coals.
    const nearHotspots = this.hotspots.filter((h) => Math.hypot(h.x - px, h.y - py) < SPAWN_RADIUS + 2);
    if (nearHotspots.length > 0 && Math.random() < HOTSPOT_BIAS) {
      const h = nearHotspots[Math.floor(Math.random() * nearHotspots.length)];
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.9;
      mote.wx = h.x + Math.cos(a) * r;
      mote.wy = h.y + Math.sin(a) * r;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * SPAWN_RADIUS;
      mote.wx = px + Math.cos(angle) * radius;
      mote.wy = py + Math.sin(angle) * radius;
    }
    mote.z = Math.random() * 10;
    mote.riseSpeed = 3 + Math.random() * 6;
    mote.swayPhase = Math.random() * Math.PI * 2;
    mote.life = 0;
    mote.maxLife = 3.5 + Math.random() * 5;
    const scale = 0.5 + Math.random() * 0.9;
    mote.sprite.scale.set(scale);
  }
}
