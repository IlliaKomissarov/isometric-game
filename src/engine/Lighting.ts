/**
 * @module engine/Lighting
 * Tile lightmap: torchlight falloff, fog-of-war states, and cutaway walls.
 *
 * REPLACES the old sprite-overlay FogOfWar. The overlay approach darkened
 * tall sprites incorrectly (a lit wall's upper half was covered by the black
 * fog diamond of the hidden tile behind it). Instead, this system TINTS every
 * registered floor/wall sprite by its tile's light value — the classic ARPG
 * model — which lights each object exactly once, no matter its height.
 *
 * Three visibility states per tile (unchanged semantics):
 *   HIDDEN   — never seen: tinted pure black (invisible on the black ground).
 *   EXPLORED — seen before, out of sight: static cool-shadow tint.
 *   VISIBLE  — in LOS: warm torch tint, falling off smoothly with distance
 *              from the player's CONTINUOUS position (so the light glides
 *              with movement instead of stepping tile to tile), plus a
 *              subtle time-based flicker.
 *
 * The render pass also performs CUTAWAY VISION: wall sprites whose screen
 * rect covers the player and whose depth sorts in front of them smoothly
 * fade to WALL_FADE_ALPHA so the player is never hidden by architecture.
 *
 * Visibility set recomputation stays event-driven (player:tileChanged);
 * tinting runs per render frame but touches only visible tiles (~150).
 */

import type { Sprite } from 'pixi.js';
import {
  FOG_RADIUS,
  LIGHT_FULL_RADIUS,
  LIGHT_SHADOW_RGB,
  LIGHT_WARM_RGB,
  TILE_H,
  WALL_FADE_ALPHA,
  WALL_Z,
} from '@/core/config';
import { vec2 } from '@/utils/Vec2';
import { depthKey, worldToScreen } from '@/utils/iso';
import { hasLineOfSight } from '@/utils/los';

const enum FogState {
  HIDDEN = 0,
  EXPLORED = 1,
  VISIBLE = 2,
}

type Rgb = readonly [number, number, number];

/**
 * A PROP MAY BE PERMANENTLY DARKER THAN THE GROUND IT STANDS ON (it.111).
 *
 * Lighting owns `tint` - it rewrites every registered prop's tint from the
 * tile's light every frame - so a dresser that sets a sprite's tint to darken
 * it is writing into a value that is overwritten before the next frame is
 * drawn. That is why the battlefield's dead stayed bright blue no matter what
 * `body.tint` was set to. A prop may now carry a shade factor instead, which is
 * multiplied INTO the tile's tint at the moment it is written.
 *
 * It is PER CHANNEL, because a flat factor keeps the hue: the city's death sheet
 * is a blue tabard over a red-and-white shield, and darkening it evenly leaves a
 * hundred small navy lozenges scattered over a grey field. Pulling the blue down
 * harder than the red takes the colour out as well as the light, which is what a
 * body face-down in the mud actually looks like.
 */
type ShadedSprite = Sprite & { shade?: Rgb };

/**
 * Base torch ramp channels for a light level [0,1] (shadow -> warm torch).
 *
 * THE TOP OF THE RAMP IS A FLOOR PROPERTY (it.111). Every floor used to end at
 * the same warm candle white, so a battlefield a week old was lit exactly like a
 * tavern - which is why the field read as a warm brown lawn no matter how far
 * `exploredLight` was pulled down. A floor may now hand in its own top colour,
 * and the whole scene changes character with one number per channel: the field's
 * is a cold, drained moonlight.
 */
function rampChannels(light: number, warm: Rgb = LIGHT_WARM_RGB, shadow: Rgb = LIGHT_SHADOW_RGB): [number, number, number] {
  const l = light <= 0 ? 0 : light >= 1 ? 1 : light;
  const g = l * l * (3 - 2 * l); // smoothstep for a soft, filmic ramp
  return [
    shadow[0] + (warm[0] - shadow[0]) * g,
    shadow[1] + (warm[1] - shadow[1]) * g,
    shadow[2] + (warm[2] - shadow[2]) * g,
  ];
}

/** Multiply a composed tint by a prop's own shade factor, if it carries one. */
function shadeTint(tint: number, shade: Rgb | undefined): number {
  if (shade === undefined) return tint;
  const r = Math.round(((tint >> 16) & 0xff) * shade[0]);
  const g = Math.round(((tint >> 8) & 0xff) * shade[1]);
  const b = Math.round((tint & 0xff) * shade[2]);
  return (r << 16) | (g << 8) | b;
}

/** Map a light level [0,1] to a multiply-tint color (shadow → warm torch). */
export function tintForLight(light: number, warm?: Rgb, shadow?: Rgb): number {
  const [r, g, b] = rampChannels(light, warm, shadow);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/**
 * The tint of ground that has been SEEN but is not lit right now. Zero is the
 * crypt's answer - out of the torch, out of the world. Open country is not that
 * dark, and a floor may say so with `exploredLight` (it.105): the farmlands'
 * belt of wood is four rings thick and 700 sprites, and at zero it stacked into
 * a black wall that filled the screen whenever the hero walked near the border.
 */
const HIDDEN_TINT = 0x000000;

export class Lighting {
  private width = 0;
  private height = 0;
  private states!: Uint8Array;
  private floorSprites: (Sprite | null)[] = [];
  private wallSprites: (Sprite | null)[] = [];
  /** Decorative props on a tile (braziers, statues) — tinted like walls. */
  private propSprites = new Map<number, Sprite[]>();
  private visibleSet = new Set<number>();
  /**
   * THE COLISEUM (it.53): no fog at all - every tile stays in sight.
   *
   * IT.107 made this default TRUE for every floor, which took the fog of war out
   * of the whole game. IT.109 PUT IT BACK: the shroud is the crypt's point, and
   * a map that is known before it is walked is a different game. This is the
   * trial's own switch again, and nothing else sets it.
   *
   * (Fog and darkness remain two systems: this is the HIDDEN / EXPLORED shroud,
   * not the torch radius. `revealAll` is still how an open-country floor says
   * "the shape of this land is not a secret" - see the farmlands and the
   * riverside, which use it deliberately and always did.)
   */
  omniscient = false;
  private allTiles: Set<number> | null = null;
  private isOpaque!: (gx: number, gy: number) => boolean;

  /** Baked point sources (for shadow direction queries, it.36). */
  private readonly sources: Array<{ x: number; y: number; radius: number; intensity: number }> = [];
  /** Static colored light contributions (braziers, runes), premultiplied per tile. */
  private srcR!: Float32Array;
  private srcG!: Float32Array;
  private srcB!: Float32Array;
  private sourceFlicker = 1;

  /** Player render position + flicker from the latest frame (for getLightAt). */
  private lastPx = 0;
  private lastPy = 0;
  private lastFlicker = 1;

  /** Wall sprites whose alpha is currently animating away from 1. */
  private readonly fadingWalls = new Set<number>();
  private readonly scratch = vec2();

  /** Sight radius (LOS reveal) and full-brightness radius; the town widens both. */
  private sight = FOG_RADIUS;
  private full = LIGHT_FULL_RADIUS;
  /** The radii the floor was built with, so a scene can borrow them and give them back. */
  private baseSight = FOG_RADIUS;
  private baseFull = LIGHT_FULL_RADIUS;
  /** What SEEN-but-unlit ground is tinted at on this floor (it.105). */
  private exploredTint = tintForLight(0);
  /** The top and bottom of this floor's own light ramp (it.111). */
  private warm: Rgb = LIGHT_WARM_RGB;
  private shadow: Rgb = LIGHT_SHADOW_RGB;

  build(
    width: number,
    height: number,
    isOpaque: (gx: number, gy: number) => boolean,
    opts?: { sightRadius?: number; fullRadius?: number; exploredLight?: number; warmRgb?: Rgb; shadowRgb?: Rgb },
  ): void {
    this.width = width;
    this.height = height;
    this.isOpaque = isOpaque;
    this.sight = opts?.sightRadius ?? FOG_RADIUS;
    this.full = opts?.fullRadius ?? LIGHT_FULL_RADIUS;
    this.warm = opts?.warmRgb ?? LIGHT_WARM_RGB;
    this.shadow = opts?.shadowRgb ?? LIGHT_SHADOW_RGB;
    this.exploredTint = tintForLight(Math.max(0, Math.min(1, opts?.exploredLight ?? 0)), this.warm, this.shadow);
    this.baseSight = this.sight;
    this.baseFull = this.full;
    this.states = new Uint8Array(width * height).fill(FogState.HIDDEN);
    this.floorSprites = new Array<Sprite | null>(width * height).fill(null);
    this.wallSprites = new Array<Sprite | null>(width * height).fill(null);
    this.propSprites.clear();
    this.sources.length = 0;
    this.srcR = new Float32Array(width * height);
    this.srcG = new Float32Array(width * height);
    this.srcB = new Float32Array(width * height);
  }

  /**
   * Bake a static colored light source (brazier, glowing rune) into the
   * per-tile contribution maps. Quadratic falloff; contributions from
   * multiple sources sum. Call during scene build only.
   */
  addSource(x: number, y: number, radius: number, r: number, g: number, b: number, intensity = 1): void {
    this.sources.push({ x, y, radius, intensity });
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(y + radius));
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const d = Math.hypot(gx + 0.5 - x, gy + 0.5 - y);
        if (d > radius) continue;
        const atten = (1 - d / radius) ** 2 * intensity;
        const idx = gy * this.width + gx;
        this.srcR[idx] += r * atten;
        this.srcG[idx] += g * atten;
        this.srcB[idx] += b * atten;
      }
    }
  }

  /**
   * Register a decorative prop sprite for tint/visibility management.
   * Safe to call at RUNTIME (corpse stains): the sprite adopts the tile's
   * current fog state instead of assuming HIDDEN.
   */
  registerProp(gx: number, gy: number, sprite: Sprite, shade?: number | Rgb): void {
    const idx = gy * this.width + gx;
    const st = this.states[idx];
    if (shade !== undefined) (sprite as ShadedSprite).shade = typeof shade === 'number' ? [shade, shade, shade] : shade;
    sprite.visible = st !== FogState.HIDDEN;
    sprite.tint = st === FogState.HIDDEN ? HIDDEN_TINT : shadeTint(this.exploredTint, (sprite as ShadedSprite).shade); // Visible tiles retint next frame.
    const list = this.propSprites.get(idx);
    if (list) list.push(sprite);
    else this.propSprites.set(idx, [sprite]);
  }

  /**
   * SceneManager registers every floor sprite here. Hidden tiles are fully
   * non-rendered (`visible = false`), NOT black-tinted — a black silhouette
   * against the near-black background would leak the dungeon layout.
   */
  registerFloor(gx: number, gy: number, sprite: Sprite): void {
    sprite.tint = HIDDEN_TINT;
    sprite.visible = false;
    this.floorSprites[gy * this.width + gx] = sprite;
  }

  /** SceneManager registers every wall sprite here. Starts non-rendered. */
  registerWall(gx: number, gy: number, sprite: Sprite): void {
    sprite.tint = HIDDEN_TINT;
    sprite.visible = false;
    this.wallSprites[gy * this.width + gx] = sprite;
  }

  /**
   * A CUTSCENE CARRIES ITS OWN LIGHT (it.99). While a scene is playing the camera
   * leaves the hero, and everything it looks at is lit by the hero's torch and
   * fogged by the hero's line of sight - so the people walking in arrived as
   * silhouettes on ground that was never re-tinted. This opens the sight wide and
   * pushes the full-brightness radius out for the length of the scene; the caller
   * drives `updateVisibility` from the camera while it is on, and turns it off after.
   */
  setSceneLight(on: boolean): void {
    this.sight = on ? Math.max(this.baseSight, 22) : this.baseSight;
    this.full = on ? Math.max(this.baseFull, 14) : this.baseFull;
  }

  /** True when the tile is currently in the player's line of sight. */
  isVisible(gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height) return false;
    return this.visibleSet.has(gy * this.width + gx);
  }

  /** Fog state for read-only consumers (minimap). 0 hidden / 1 explored / 2 visible. */
  getState(gx: number, gy: number): number {
    if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height) return FogState.HIDDEN;
    return this.states[gy * this.width + gx];
  }

  /**
   * Continuous light level [0,1] at a world point — used to scale particle
   * brightness. Includes static source luminance. Zero outside sight.
   */
  getLightAt(x: number, y: number): number {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (!this.isVisible(gx, gy)) return 0;
    const idx = gy * this.width + gx;
    const srcLuma = (this.srcR[idx] + this.srcG[idx] + this.srcB[idx]) / (3 * 255);
    const base = this.falloff(Math.hypot(x - this.lastPx, y - this.lastPy)) * this.lastFlicker;
    return Math.min(1, base + srcLuma * this.sourceFlicker);
  }

  /**
   * Full colored tint at a world point (torch ramp + colored sources) for
   * dynamic objects: enemies, ground loot, projectiles. Black outside sight.
   * @param minBase Floor for the torch component (keeps creatures readable).
   */
  getTintAt(x: number, y: number, minBase = 0): number {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (!this.isVisible(gx, gy)) return 0x000000;
    const idx = gy * this.width + gx;
    const base = Math.max(
      minBase,
      this.falloff(Math.hypot(x - this.lastPx, y - this.lastPy)) * this.lastFlicker,
    );
    return this.composeTint(base, idx);
  }

  /**
   * DOMINANT LIGHT DIRECTION at a world point (it.36 dynamic shadows):
   * a SCREEN-space unit vector pointing AWAY from the strongest light
   * (the hero's torch or a nearby baked source) plus a strength 0..1 —
   * the grounded shadow stretches along it. Render-only.
   */
  lightDirAt(x: number, y: number): { x: number; y: number; k: number } {
    // The hero's torch: strength by falloff, direction away from them.
    let bx = x - this.lastPx;
    let by = y - this.lastPy;
    let bd = Math.hypot(bx, by);
    let best = bd < 0.35 ? 0 : this.falloff(bd) * 0.6;
    for (const s of this.sources) {
      const dx = x - s.x;
      const dy = y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > s.radius || d < 0.2) continue;
      const k = (1 - d / s.radius) * s.intensity;
      if (k > best) {
        best = k;
        bx = dx;
        by = dy;
        bd = d;
      }
    }
    if (best <= 0.02 || bd < 1e-4) return { x: 0, y: 0, k: 0 };
    // World → screen axes (2:1 diamond), normalized.
    const sx = bx - by;
    const sy = (bx + by) * 0.5;
    const len = Math.hypot(sx, sy) || 1;
    return { x: sx / len, y: sy / len, k: Math.min(1, best) };
  }

  /** Recompute the LOS visible set. Call on player:tileChanged only. */
  updateVisibility(originX: number, originY: number): void {
    let newVisible = new Set<number>();
    const r = this.sight;
    const r2 = r * r;

    if (this.omniscient) {
      if (!this.allTiles || this.allTiles.size !== this.width * this.height) {
        this.allTiles = new Set<number>();
        for (let i = 0; i < this.width * this.height; i++) this.allTiles.add(i);
      }
      newVisible = this.allTiles;
    } else
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const gx = originX + dx;
        const gy = originY + dy;
        if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height) continue;
        if (hasLineOfSight(originX, originY, gx, gy, this.isOpaque)) {
          newVisible.add(gy * this.width + gx);
        }
      }
    }

    // Tiles that fell out of sight settle into the static explored shadow.
    for (const idx of this.visibleSet) {
      if (!newVisible.has(idx)) {
        this.states[idx] = FogState.EXPLORED;
        const floor = this.floorSprites[idx];
        if (floor) floor.tint = this.exploredTint;
        const wall = this.wallSprites[idx];
        if (wall) wall.tint = this.exploredTint;
        const props = this.propSprites.get(idx);
        if (props) for (const p of props) p.tint = this.exploredTint;
      }
    }
    for (const idx of newVisible) {
      if (this.states[idx] === FogState.HIDDEN) {
        // First reveal: start rendering the tile (tint comes from the frame pass).
        const floor = this.floorSprites[idx];
        if (floor) floor.visible = true;
        const wall = this.wallSprites[idx];
        if (wall) wall.visible = true;
        const props = this.propSprites.get(idx);
        if (props) for (const p of props) p.visible = true;
      }
      this.states[idx] = FogState.VISIBLE;
    }
    this.visibleSet = newVisible;
  }

  /**
   * Per-render-frame pass: torch falloff tint for visible tiles + cutaway
   * fade for player-occluding walls.
   * @param px,py  Interpolated player render position (world units).
   * @param dt     Real frame delta seconds (for fade damping).
   * @param time   Monotonic seconds (drives the flicker).
   */
  updateRender(px: number, py: number, dt: number, time: number): void {
    this.lastPx = px;
    this.lastPy = py;
    // Layered sines ≈ organic torch flicker without RNG (stays deterministic).
    this.lastFlicker = 0.93 + 0.042 * Math.sin(time * 9.3) + 0.03 * Math.sin(time * 23.7 + 1.7);
    // Static sources breathe on their own slower rhythm.
    this.sourceFlicker = 0.88 + 0.07 * Math.sin(time * 6.1) + 0.05 * Math.sin(time * 17.3 + 0.8);

    const w = this.width;
    for (const idx of this.visibleSet) {
      const gx = idx % w;
      const gy = (idx / w) | 0;
      const d = Math.hypot(gx + 0.5 - px, gy + 0.5 - py);
      const base = this.falloff(d) * this.lastFlicker;
      const tint = this.composeTint(base, idx);
      const floor = this.floorSprites[idx];
      if (floor) floor.tint = tint;
      const props = this.propSprites.get(idx);
      if (props) for (const p of props) p.tint = shadeTint(tint, (p as ShadedSprite).shade);

      const wall = this.wallSprites[idx];
      if (wall) {
        // A wall's VISIBLE faces point south (+y) and east (+x) — they are
        // lit by the floor in front of them, not by the wall's own tile
        // center (which sits ~1 tile deeper in the dark). Using only the
        // own-tile light made walls read wrongly dark next to bright floor.
        let bestBase = base;
        let bestIdx = idx;
        const south = idx + w;
        if (gy + 1 < this.height && this.visibleSet.has(south)) {
          const b = this.falloff(Math.hypot(gx + 0.5 - px, gy + 1.5 - py)) * this.lastFlicker;
          if (b > bestBase) {
            bestBase = b;
            bestIdx = south;
          }
        }
        const east = idx + 1;
        if (gx + 1 < w && this.visibleSet.has(east)) {
          const b = this.falloff(Math.hypot(gx + 1.5 - px, gy + 0.5 - py)) * this.lastFlicker;
          if (b > bestBase) {
            bestBase = b;
            bestIdx = east;
          }
        }
        wall.tint = this.composeTint(bestBase, bestIdx);
      }
    }

    this.updateWallCutaway(px, py, dt);
  }

  /** Torch ramp + baked colored sources → final tint for one tile. */
  private composeTint(baseLight: number, idx: number): number {
    const [br, bg, bb] = rampChannels(baseLight, this.warm, this.shadow);
    const f = this.sourceFlicker;
    const r = Math.min(255, Math.round(br + this.srcR[idx] * f));
    const g = Math.min(255, Math.round(bg + this.srcG[idx] * f));
    const b = Math.min(255, Math.round(bb + this.srcB[idx] * f));
    return (r << 16) | (g << 8) | b;
  }

  /** Reveal the whole floor as explored (cheat menu / future map scrolls). */
  revealAll(): void {
    for (let idx = 0; idx < this.states.length; idx++) {
      if (this.states[idx] !== FogState.HIDDEN) continue;
      this.states[idx] = FogState.EXPLORED;
      const floor = this.floorSprites[idx];
      if (floor) {
        floor.visible = true;
        floor.tint = this.exploredTint;
      }
      const wall = this.wallSprites[idx];
      if (wall) {
        wall.visible = true;
        wall.tint = this.exploredTint;
      }
      const props = this.propSprites.get(idx);
      if (props)
        for (const p of props) {
          p.visible = true;
          p.tint = this.exploredTint;
        }
    }
  }

  /** Serialize explored tiles as a bitset (future co-op / save-game sync). */
  packExplored(): Uint8Array {
    const packed = new Uint8Array(Math.ceil(this.states.length / 8));
    for (let i = 0; i < this.states.length; i++) {
      if (this.states[i] !== FogState.HIDDEN) packed[i >> 3] |= 1 << (i & 7);
    }
    return packed;
  }

  private falloff(d: number): number {
    if (d <= this.full) return 1;
    const t = (this.sight - d) / (this.sight - this.full);
    return t <= 0 ? 0 : t >= 1 ? 1 : t;
  }

  /** Restore an explored-fog bitset (FloorMemory) — tiles become EXPLORED and render. */
  unpackExplored(packed: Uint8Array): void {
    for (let i = 0; i < this.states.length; i++) {
      if (!(packed[i >> 3] & (1 << (i & 7)))) continue;
      if (this.states[i] !== FogState.HIDDEN) continue;
      this.states[i] = FogState.EXPLORED;
      const floor = this.floorSprites[i];
      if (floor) {
        floor.visible = true;
        floor.tint = this.exploredTint;
      }
      const wall = this.wallSprites[i];
      if (wall) {
        wall.visible = true;
        wall.tint = this.exploredTint;
      }
      const props = this.propSprites.get(i);
      if (props)
        for (const p of props) {
          p.visible = true;
          p.tint = this.exploredTint;
        }
    }
  }

  /** Smoothly fade walls whose sprite covers the player and sorts in front. */
  private updateWallCutaway(px: number, py: number, dt: number): void {
    const ps = worldToScreen(px, py, this.scratch);
    const psx = ps.x;
    const psy = ps.y;
    const playerDepth = depthKey(px, py);
    const pTx = Math.floor(px);
    const pTy = Math.floor(py);

    // Candidate walls this frame that should fade. HYSTERESIS (it.15): a
    // wall right on the depth/overlap boundary used to enter and leave the
    // set on alternating frames while the player walked toward it — the
    // "wall flicker". A wall already fading stays held by LOOSER thresholds
    // (margin on the depth test + padding on the body rect), so the state
    // only flips when the player has clearly moved past it.
    const targets = new Set<number>();
    for (let gy = pTy - 2; gy <= pTy + 6; gy++) {
      for (let gx = pTx - 2; gx <= pTx + 6; gx++) {
        if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height) continue;
        const idx = gy * this.width + gx;
        const wall = this.wallSprites[idx];
        if (!wall) continue;
        const held = this.fadingWalls.has(idx);
        const depthMargin = held ? 10 : -2; // Enter strictly in front; release well behind.
        if (depthKey(gx + 1, gy + 1) - 4 <= playerDepth - depthMargin) continue;
        const pad = held ? 14 : 0;
        const s = worldToScreen(gx, gy, this.scratch);
        // Wall sprite rect vs player body rect (screen space).
        const overlaps =
          s.x + 32 + pad > psx - 16 &&
          s.x - 32 - pad < psx + 16 &&
          s.y + TILE_H + pad > psy - 50 &&
          s.y - WALL_Z - pad < psy + 4;
        if (overlaps) targets.add(idx);
      }
    }

    // Animate: current targets ease to WALL_FADE_ALPHA, released walls ease back.
    const k = 1 - Math.exp(-14 * dt);
    for (const idx of targets) this.fadingWalls.add(idx);
    for (const idx of this.fadingWalls) {
      const wall = this.wallSprites[idx];
      if (!wall) {
        this.fadingWalls.delete(idx);
        continue;
      }
      const target = targets.has(idx) ? WALL_FADE_ALPHA : 1;
      wall.alpha += (target - wall.alpha) * k;
      if (target === 1 && wall.alpha > 0.995) {
        wall.alpha = 1;
        this.fadingWalls.delete(idx);
      }
    }
  }
}
