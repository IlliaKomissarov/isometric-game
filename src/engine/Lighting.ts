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
 * THE LIGHT IS TIED TO THE HERO (it.114). The visible set used to be rebuilt
 * only on the sim's `player:tileChanged`, into a fresh Set, with a full
 * Bresenham walk per tile through the scene's `isOpaque` closure — ~100k
 * closure calls on the town's sight 36. Now:
 *   - the set lives in typed arrays (a generation stamp per tile + a flat
 *     index list), so a recompute allocates nothing and `isVisible` is one
 *     array read;
 *   - the walls are snapshotted into a Uint8Array once per recompute and the
 *     Bresenham walk reads that, not the closure;
 *   - `updateRender` recomputes on its own when the RENDER position crosses
 *     into a tile the last recompute did not start from (the sim event is
 *     ahead of the render position and normally wins; this fills the gaps —
 *     a cutscene camera, a remote hero, a sight radius that changed);
 *   - a RING around the hero's sub-tile position (the bright core of the
 *     torch, ≤ 7.5 tiles) is lit every frame even where the last LOS pass
 *     did not reach it, with a per-tile LOS check from the render tile, so
 *     the lit pool moves continuously instead of by whole tiles;
 *   - DYNAMIC LIGHTS (a carried lantern, a fireball, a spell) are splatted
 *     into per-tile scratch maps every frame and composed like the baked
 *     sources.
 *
 * BUDGET (estimated on the town: sight 36, full 5, ~4000 visible tiles, a
 * 2020-class laptop; not measured on device — no browser in this pass):
 *   per-frame tint pass   ~4000 × (hypot + ramp + 1–3 Pixi tint writes) ≈ 0.6–0.9 ms
 *                          (unchanged from before; the tint setter dominates)
 *   ring pass             ≤ 180 tiles × 2 array reads ≈ 0.01 ms; LOS only for
 *                          explored-but-unlisted ring tiles (typically 0–10 × ≤ 8 steps)
 *   dynamic lights        N × (2r+1)² Float32 writes: 4 lights × r 4 ≈ 320 ≈ 0.01 ms
 *   LOS recompute         ~4000 tiles × ~24 Bresenham steps over a Uint8Array
 *                          ≈ 100k steps ≈ 0.3–0.5 ms + 5.3k `isOpaque` calls for the
 *                          snapshot ≈ 0.05 ms; no allocation. Happens on tile
 *                          crossings only (~4/s at hero speed), never every frame.
 *   Total steady state    ≈ 0.7–1.0 ms; a crossing frame ≈ 1.2–1.5 ms.
 * The crypt (sight 9, ~250 tiles) is an order of magnitude under all of this.
 */

import type { Sprite } from 'pixi.js';
import {
  FOG_RADIUS,
  LIGHT_FULL_RADIUS,
  LIGHT_RING_MAX_RADIUS,
  LIGHT_SHADOW_RGB,
  LIGHT_WARM_RGB,
  TILE_H,
  WALL_FADE_ALPHA,
  WALL_Z,
} from '@/core/config';
import { vec2 } from '@/utils/Vec2';
import { depthKey, worldToScreen } from '@/utils/iso';

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
  // CLAMPED, because a shade may be > 1 (the merchant is lifted OUT of the room
  // rather than pushed into it), and a channel over 255 makes a number Pixi
  // refuses to read as a colour at all - which throws inside the render pass.
  const r = Math.min(255, Math.round(((tint >> 16) & 0xff) * shade[0]));
  const g = Math.min(255, Math.round(((tint >> 8) & 0xff) * shade[1]));
  const b = Math.min(255, Math.round((tint & 0xff) * shade[2]));
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

/** A light that moves (it.114): a lantern in a hand, a fireball in flight. */
interface DynamicLight {
  x: number;
  y: number;
  radius: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
}

/** How far the hero's render position may drift from the last LOS origin before the render side recomputes. */
const LOS_REFRESH_DIST = 0.35;

/**
 * A WALL PIECE THAT SPANS TILES (it.115). The crypt's tileset walls are
 * 128x256 runs over two tiles (and the near-wall stubs sit between a floor and
 * its wall), but Lighting used to know one sprite per WALL TILE: a piece was
 * registered on its first tile only, so it stayed unrendered until that one
 * tile happened to pass a line-of-sight test - and a wall tile is rarely the
 * tile a hero sees. That is the owner's "only the part next to the character
 * shows up, the rest of the wall is as if it does not exist".
 *
 * A piece now names the FLOOR tiles its face looks at. It is revealed the
 * first time any of them is seen, and from then on it is always drawn: lit by
 * the brightest of those tiles while one is in sight, else the floor's
 * remembered (explored) shade. A piece nobody has looked at stays hidden - the
 * shroud still keeps the map's shape a secret.
 */
interface PieceEntry {
  sprite: Sprite;
  /** The floor tiles the face looks at (row-major indices). */
  tiles: Int32Array;
  revealed: boolean;
  /** Tall pieces take part in the cutaway; the near-wall stubs never hide the hero. */
  tall: boolean;
  /** The last tint written, so an unchanged piece costs no Pixi write. */
  tint: number;
}

export class Lighting {
  private width = 0;
  private height = 0;
  private states!: Uint8Array;
  private floorSprites: (Sprite | null)[] = [];
  private wallSprites: (Sprite | null)[] = [];
  /** Decorative props on a tile (braziers, statues) — tinted like walls. */
  private propSprites = new Map<number, Sprite[]>();
  /** The crypt's multi-tile wall pieces (it.115), and tile -> the pieces that look at it. */
  private pieces: PieceEntry[] = [];
  private tilePieces = new Map<number, number[]>();
  /** Pieces whose alpha is animating away from 1 (the tall-piece cutaway). */
  private readonly fadingPieces = new Set<number>();
  /** This frame's tint per tile, valid where `tileTintStamp` equals `frameNo` (it.115). */
  private tileTint!: Uint32Array;
  private tileTintStamp!: Uint32Array;
  private frameNo = 1;

  /**
   * THE VISIBLE SET, without a Set (it.114): `visStamp[idx] === gen` means the
   * tile is in the player's line of sight right now; `visList[0..visCount)`
   * lists those tiles for the frame pass. `prevList` is the previous
   * generation's list, kept so a recompute can settle the tiles that fell out
   * without a second full scan. Both lists are sized for the whole map once.
   */
  private visStamp!: Uint32Array;
  private gen = 1;
  private visList!: Int32Array;
  private visCount = 0;
  /** The two list buffers `visList` alternates between. */
  private bufA!: Int32Array;
  private bufB!: Int32Array;
  /** Walls as the last recompute saw them: a byte per tile, stamped per refresh. */
  private opaque!: Uint8Array;
  private opaqueStamp!: Uint32Array;
  private opaqueGen = 1;
  /** Where (tile) and how wide the last LOS recompute was made from. */
  private losOx = -1;
  private losOy = -1;
  private losSight = -1;
  /** The render tile of the previous frame (the auto-recompute fires on a crossing). */
  private renderOx = -1;
  private renderOy = -1;
  /** Explored tiles the RING lit last frame; reset to the explored tint when they leave it. */
  private ringList!: Int32Array;
  private ringCount = 0;

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
  private isOpaque!: (gx: number, gy: number) => boolean;

  /** Baked point sources (for shadow direction queries, it.36). */
  private readonly sources: Array<{ x: number; y: number; radius: number; intensity: number }> = [];
  /** Static colored light contributions (braziers, runes), premultiplied per tile. */
  private srcR!: Float32Array;
  private srcG!: Float32Array;
  private srcB!: Float32Array;
  private sourceFlicker = 1;

  /** Dynamic (moving) light contributions, rebuilt every frame (it.114). */
  private readonly dynamicLights = new Map<string | number, DynamicLight>();
  private dynR!: Float32Array;
  private dynG!: Float32Array;
  private dynB!: Float32Array;
  /** Tiles the dynamic splat wrote last frame, cleared before the next. */
  private dynTouched!: Int32Array;
  private dynTouchedCount = 0;

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
  /** The ramp top after `setPlayerLight`'s warmBoost (it.114); equals `warm` at boost 0. */
  private warmLit: Rgb = LIGHT_WARM_RGB;

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
    this.warmLit = this.warm;
    this.shadow = opts?.shadowRgb ?? LIGHT_SHADOW_RGB;
    this.exploredTint = tintForLight(Math.max(0, Math.min(1, opts?.exploredLight ?? 0)), this.warm, this.shadow);
    this.baseSight = this.sight;
    this.baseFull = this.full;
    const n = width * height;
    this.states = new Uint8Array(n).fill(FogState.HIDDEN);
    this.floorSprites = new Array<Sprite | null>(n).fill(null);
    this.wallSprites = new Array<Sprite | null>(n).fill(null);
    this.propSprites.clear();
    this.pieces = [];
    this.tilePieces.clear();
    this.fadingPieces.clear();
    this.tileTint = new Uint32Array(n);
    this.tileTintStamp = new Uint32Array(n);
    this.frameNo = 1;
    this.sources.length = 0;
    this.srcR = new Float32Array(n);
    this.srcG = new Float32Array(n);
    this.srcB = new Float32Array(n);
    this.dynamicLights.clear();
    this.dynR = new Float32Array(n);
    this.dynG = new Float32Array(n);
    this.dynB = new Float32Array(n);
    this.dynTouched = new Int32Array(n);
    this.dynTouchedCount = 0;
    this.visStamp = new Uint32Array(n);
    this.gen = 1;
    this.bufA = new Int32Array(n);
    this.bufB = new Int32Array(n);
    this.visList = this.bufA;
    this.visCount = 0;
    this.opaque = new Uint8Array(n);
    this.opaqueStamp = new Uint32Array(n);
    this.opaqueGen = 1;
    this.ringList = new Int32Array(n);
    this.ringCount = 0;
    this.losOx = this.losOy = -1;
    this.losSight = -1;
    this.renderOx = this.renderOy = -1;
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

  // ---- Dynamic lights (it.114) ------------------------------------------------

  /**
   * A light that moves: added once, moved per frame, removed when it dies.
   * Contributes to every visible tile's tint like a baked source (quadratic
   * falloff, summed), but is re-splatted each frame from its current
   * position. `rgb` is 0..255 per channel; `intensity` scales it.
   * Render-side only — the sim never reads it.
   */
  addDynamicLight(id: string | number, x: number, y: number, radius: number, rgb: Rgb, intensity = 1): void {
    const l = this.dynamicLights.get(id);
    if (l) {
      l.x = x;
      l.y = y;
      l.radius = radius;
      l.r = rgb[0];
      l.g = rgb[1];
      l.b = rgb[2];
      l.intensity = intensity;
      return;
    }
    this.dynamicLights.set(id, { x, y, radius, r: rgb[0], g: rgb[1], b: rgb[2], intensity });
  }

  moveDynamicLight(id: string | number, x: number, y: number): void {
    const l = this.dynamicLights.get(id);
    if (!l) return;
    l.x = x;
    l.y = y;
  }

  /** Change a live light's reach or brightness without re-adding it (a fading ember). */
  setDynamicLight(id: string | number, radius: number, intensity: number): void {
    const l = this.dynamicLights.get(id);
    if (!l) return;
    l.radius = radius;
    l.intensity = intensity;
  }

  removeDynamicLight(id: string | number): void {
    this.dynamicLights.delete(id);
  }

  hasDynamicLight(id: string | number): boolean {
    return this.dynamicLights.has(id);
  }

  /** Re-splat every dynamic light into the per-tile scratch maps for this frame. */
  private updateDynamicLights(): void {
    const dR = this.dynR;
    const dG = this.dynG;
    const dB = this.dynB;
    const touched = this.dynTouched;
    for (let i = 0; i < this.dynTouchedCount; i++) {
      const idx = touched[i];
      dR[idx] = 0;
      dG[idx] = 0;
      dB[idx] = 0;
    }
    this.dynTouchedCount = 0;
    if (this.dynamicLights.size === 0) return;
    const w = this.width;
    let count = 0;
    for (const l of this.dynamicLights.values()) {
      if (l.radius <= 0 || l.intensity <= 0) continue;
      const minX = Math.max(0, Math.floor(l.x - l.radius));
      const maxX = Math.min(w - 1, Math.ceil(l.x + l.radius));
      const minY = Math.max(0, Math.floor(l.y - l.radius));
      const maxY = Math.min(this.height - 1, Math.ceil(l.y + l.radius));
      const inv = 1 / l.radius;
      for (let gy = minY; gy <= maxY; gy++) {
        const dy = gy + 0.5 - l.y;
        for (let gx = minX; gx <= maxX; gx++) {
          const dx = gx + 0.5 - l.x;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > l.radius) continue;
          const t = 1 - d * inv;
          const atten = t * t * l.intensity;
          const idx = gy * w + gx;
          if (dR[idx] === 0 && dG[idx] === 0 && dB[idx] === 0) touched[count++] = idx;
          dR[idx] += l.r * atten;
          dG[idx] += l.g * atten;
          dB[idx] += l.b * atten;
        }
      }
    }
    this.dynTouchedCount = count;
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
   * A tileset wall piece that looks at `tiles` (it.115; see `PieceEntry`).
   * Starts hidden unless one of those tiles has already been seen (a piece
   * added after `unpackExplored`, or to a floor rebuilt in place).
   * `tall` pieces fade when they stand between the camera and the hero.
   */
  registerPiece(sprite: Sprite, tiles: ReadonlyArray<{ x: number; y: number }>, tall: boolean): void {
    const idx = new Int32Array(tiles.length);
    let n = 0;
    for (const t of tiles) {
      if (t.x < 0 || t.y < 0 || t.x >= this.width || t.y >= this.height) continue;
      idx[n++] = t.y * this.width + t.x;
    }
    const entry: PieceEntry = { sprite, tiles: idx.subarray(0, n), revealed: false, tall, tint: HIDDEN_TINT };
    const id = this.pieces.length;
    this.pieces.push(entry);
    for (let i = 0; i < n; i++) {
      const list = this.tilePieces.get(entry.tiles[i]);
      if (list) list.push(id);
      else this.tilePieces.set(entry.tiles[i], [id]);
      if (this.states[entry.tiles[i]] !== FogState.HIDDEN) entry.revealed = true;
    }
    sprite.visible = entry.revealed;
    entry.tint = entry.revealed ? this.exploredTint : HIDDEN_TINT;
    sprite.tint = entry.tint;
  }

  /** The pieces looking at a tile come out of the shroud with it (it.115). */
  private revealPiecesAt(idx: number): void {
    const list = this.tilePieces.get(idx);
    if (!list) return;
    for (const id of list) {
      const p = this.pieces[id];
      if (p.revealed) continue;
      p.revealed = true;
      p.sprite.visible = true;
      p.tint = this.exploredTint;
      p.sprite.tint = p.tint;
    }
  }

  /**
   * Tint every revealed piece from this frame's tile tints (it.115): the
   * brightest tile it looks at that is lit this frame, else the explored shade.
   * ~200 pieces a floor, two or three tiles each - a few hundred array reads.
   */
  private updatePieces(): void {
    const frame = this.frameNo;
    const stamp = this.tileTintStamp;
    const tints = this.tileTint;
    for (const p of this.pieces) {
      if (!p.revealed) continue;
      let best = -1;
      let tint = this.exploredTint;
      const tiles = p.tiles;
      for (let i = 0; i < tiles.length; i++) {
        const idx = tiles[i];
        if (stamp[idx] !== frame) continue;
        const t = tints[idx];
        const luma = ((t >> 16) & 0xff) + ((t >> 8) & 0xff) + (t & 0xff);
        if (luma > best) {
          best = luma;
          tint = t;
        }
      }
      if (tint !== p.tint) {
        p.tint = tint;
        p.sprite.tint = tint;
      }
    }
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

  /**
   * THE HERO'S OWN POOL (it.114): a floor (or a lantern in the hand) may widen
   * the sight and the full-bright core, and warm the ramp's top. Each field is
   * optional; what is given becomes the floor's new base, so `setSceneLight`
   * restores to it. `warmBoost` is a fraction: 0.2 lifts the torch's warm
   * channels by 20 % (clamped to white). The sight change takes effect on the
   * next render frame — the visible set is recomputed there.
   */
  setPlayerLight(opts: { full?: number; sight?: number; warmBoost?: number }): void {
    if (opts.sight !== undefined) this.baseSight = this.sight = Math.max(1, opts.sight);
    if (opts.full !== undefined) this.baseFull = this.full = Math.max(0, opts.full);
    if (opts.warmBoost !== undefined) {
      const k = 1 + Math.max(-0.9, opts.warmBoost);
      this.warmLit = [Math.min(255, this.warm[0] * k), Math.min(255, this.warm[1] * k), Math.min(255, this.warm[2] * k)];
    }
  }

  /** True when the tile is currently in the player's line of sight. */
  isVisible(gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height) return false;
    return this.visStamp[gy * this.width + gx] === this.gen;
  }

  /** Fog state for read-only consumers (minimap). 0 hidden / 1 explored / 2 visible. */
  getState(gx: number, gy: number): number {
    if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height) return FogState.HIDDEN;
    return this.states[gy * this.width + gx];
  }

  /**
   * Continuous light level [0,1] at a world point — used to scale particle
   * brightness. Includes static and dynamic source luminance. Zero outside sight.
   */
  getLightAt(x: number, y: number): number {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (!this.isVisible(gx, gy)) return 0;
    const idx = gy * this.width + gx;
    const srcLuma = (this.srcR[idx] + this.srcG[idx] + this.srcB[idx]) / (3 * 255);
    const dynLuma = (this.dynR[idx] + this.dynG[idx] + this.dynB[idx]) / (3 * 255);
    const base = this.falloff(Math.hypot(x - this.lastPx, y - this.lastPy)) * this.lastFlicker;
    return Math.min(1, base + srcLuma * this.sourceFlicker + dynLuma);
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
   * (the hero's torch, a nearby baked source, or a dynamic light) plus a
   * strength 0..1 — the grounded shadow stretches along it. Render-only.
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
    for (const s of this.dynamicLights.values()) {
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

  // ---- Line of sight over the wall snapshot ---------------------------------

  /** Snapshot `isOpaque` over a tile box into the byte map (stamped by `opaqueGen`). */
  private snapshotOpaque(minX: number, minY: number, maxX: number, maxY: number): void {
    const w = this.width;
    const op = this.opaque;
    const st = this.opaqueStamp;
    const g = this.opaqueGen;
    for (let gy = minY; gy <= maxY; gy++) {
      let idx = gy * w + minX;
      for (let gx = minX; gx <= maxX; gx++, idx++) {
        op[idx] = this.isOpaque(gx, gy) ? 1 : 0;
        st[idx] = g;
      }
    }
  }

  /** The byte map's answer for one tile, refreshed from the closure if it is stale. */
  private opaqueAt(gx: number, gy: number): number {
    const idx = gy * this.width + gx;
    if (this.opaqueStamp[idx] !== this.opaqueGen) {
      this.opaque[idx] = this.isOpaque(gx, gy) ? 1 : 0;
      this.opaqueStamp[idx] = this.opaqueGen;
    }
    return this.opaque[idx];
  }

  /**
   * Bresenham line of sight, identical in shape to `utils/los.hasLineOfSight`
   * (the origin never blocks; any opaque tile between blocks; the target may
   * be opaque - a wall is seen when it is lit), but reading the wall snapshot.
   * The whole line lies inside the box spanned by its endpoints, so a snapshot
   * over the sight box covers every step; `opaqueAt` refreshes anything the
   * ring asks for outside it.
   */
  private losSnap(x0: number, y0: number, x1: number, y1: number): boolean {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (x === x1 && y === y1) return true;
      if ((x !== x0 || y !== y0) && this.opaqueAt(x, y) === 1) return false;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * Recompute the LOS visible set from a tile. Called on `player:tileChanged`
   * and by every scene event that changes the walls or the sight; the render
   * pass also calls it when the render position crosses into a tile no call
   * started from (it.114). Allocation-free: the set is a generation stamp
   * per tile plus a flat list, and the previous list is kept to settle the
   * tiles that fell out of sight.
   */
  updateVisibility(originX: number, originY: number): void {
    const w = this.width;
    const h = this.height;
    const n = w * h;
    const gen = ++this.gen;
    const stamp = this.visStamp;
    // The two list buffers alternate: the old current becomes the previous.
    const prev = this.visList;
    const cur = prev === this.bufA ? this.bufB : this.bufA;
    const prevCount = this.visCount;
    let count = 0;

    if (this.omniscient) {
      for (let i = 0; i < n; i++) {
        stamp[i] = gen;
        cur[count++] = i;
      }
    } else {
      const ox = Math.max(0, Math.min(w - 1, originX | 0));
      const oy = Math.max(0, Math.min(h - 1, originY | 0));
      const sight = this.sight;
      const r = Math.floor(sight);
      const r2 = sight * sight;
      const minX = Math.max(0, ox - r);
      const maxX = Math.min(w - 1, ox + r);
      const minY = Math.max(0, oy - r);
      const maxY = Math.min(h - 1, oy + r);
      this.opaqueGen++;
      this.snapshotOpaque(minX, minY, maxX, maxY);
      for (let gy = minY; gy <= maxY; gy++) {
        const dy = gy - oy;
        for (let gx = minX; gx <= maxX; gx++) {
          const dx = gx - ox;
          if (dx * dx + dy * dy > r2) continue;
          if (this.losSnap(ox, oy, gx, gy)) {
            const idx = gy * w + gx;
            stamp[idx] = gen;
            cur[count++] = idx;
          }
        }
      }
      this.losOx = ox;
      this.losOy = oy;
    }
    this.losSight = this.sight;
    this.visList = cur;
    this.visCount = count;

    // Tiles that fell out of sight settle into the static explored shadow.
    for (let i = 0; i < prevCount; i++) {
      const idx = prev[i];
      if (stamp[idx] === gen) continue;
      this.states[idx] = FogState.EXPLORED;
      const floor = this.floorSprites[idx];
      if (floor) floor.tint = this.exploredTint;
      const wall = this.wallSprites[idx];
      if (wall) wall.tint = this.exploredTint;
      const props = this.propSprites.get(idx);
      if (props) for (const p of props) p.tint = shadeTint(this.exploredTint, (p as ShadedSprite).shade);
    }
    for (let i = 0; i < count; i++) {
      const idx = cur[i];
      if (this.states[idx] === FogState.HIDDEN) {
        // First reveal: start rendering the tile (tint comes from the frame pass).
        const floor = this.floorSprites[idx];
        if (floor) floor.visible = true;
        const wall = this.wallSprites[idx];
        if (wall) wall.visible = true;
        const props = this.propSprites.get(idx);
        if (props) for (const p of props) p.visible = true;
        this.revealPiecesAt(idx);
      }
      this.states[idx] = FogState.VISIBLE;
    }
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
    const h = this.height;
    const ox = Math.max(0, Math.min(w - 1, Math.floor(px)));
    const oy = Math.max(0, Math.min(h - 1, Math.floor(py)));

    // THE RENDER SIDE KEEPS THE SET CURRENT (it.114). The sim's tileChanged
    // event normally lands first and from the same tile, in which case this
    // is a no-op; it fires only when the render position has crossed into a
    // tile no call started from and has genuinely moved (not a boundary
    // jitter), or when the sight radius changed under the set.
    if (!this.omniscient) {
      const crossed = ox !== this.renderOx || oy !== this.renderOy;
      this.renderOx = ox;
      this.renderOy = oy;
      const stale = (ox !== this.losOx || oy !== this.losOy) && Math.hypot(px - (this.losOx + 0.5), py - (this.losOy + 0.5)) > 0.5 + LOS_REFRESH_DIST;
      if ((crossed && stale) || this.losSight !== this.sight) this.updateVisibility(ox, oy);
    } else if (this.losSight !== this.sight || this.visCount !== w * h) {
      this.updateVisibility(ox, oy);
    }

    this.updateDynamicLights();

    const gen = this.gen;
    const stamp = this.visStamp;
    const list = this.visList;
    const count = this.visCount;
    const flicker = this.lastFlicker;
    const frame = ++this.frameNo;
    for (let i = 0; i < count; i++) {
      const idx = list[i];
      const gx = idx % w;
      const gy = (idx / w) | 0;
      const d = Math.hypot(gx + 0.5 - px, gy + 0.5 - py);
      const base = this.falloff(d) * flicker;
      const tint = this.composeTint(base, idx);
      this.tileTint[idx] = tint;
      this.tileTintStamp[idx] = frame;
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
        if (gy + 1 < h && stamp[south] === gen) {
          const b = this.falloff(Math.hypot(gx + 0.5 - px, gy + 1.5 - py)) * flicker;
          if (b > bestBase) {
            bestBase = b;
            bestIdx = south;
          }
        }
        const east = idx + 1;
        if (gx + 1 < w && stamp[east] === gen) {
          const b = this.falloff(Math.hypot(gx + 1.5 - px, gy + 0.5 - py)) * flicker;
          if (b > bestBase) {
            bestBase = b;
            bestIdx = east;
          }
        }
        wall.tint = this.composeTint(bestBase, bestIdx);
      }
    }

    if (!this.omniscient) this.updateRing(px, py, ox, oy);
    this.updatePieces();
    this.updateWallCutaway(px, py, dt);
    this.updatePieceCutaway(px, py, dt);
  }

  /**
   * THE RING (it.114): the torch's bright core follows the hero's sub-tile
   * position every frame, even across tiles the last LOS pass (made from a
   * tile the hero has since left, or from the sim's tile a frame ahead) did
   * not list. Explored tiles within the core radius get a LOS check from the
   * render tile and, if they pass, this frame's falloff tint; tiles that
   * leave the ring go back to the explored shadow. HIDDEN tiles are never
   * touched here — revealing is the LOS pass's job, and a black tile that
   * lit up for one frame would read as a flash.
   */
  private updateRing(px: number, py: number, ox: number, oy: number): void {
    const w = this.width;
    const h = this.height;
    const gen = this.gen;
    const stamp = this.visStamp;
    const ring = this.ringList;
    // Settle last frame's ring tiles that the LOS pass has not since claimed.
    for (let i = 0; i < this.ringCount; i++) {
      const idx = ring[i];
      if (stamp[idx] === gen) continue;
      const floor = this.floorSprites[idx];
      if (floor) floor.tint = this.exploredTint;
      const wall = this.wallSprites[idx];
      if (wall) wall.tint = this.exploredTint;
      const props = this.propSprites.get(idx);
      if (props) for (const p of props) p.tint = shadeTint(this.exploredTint, (p as ShadedSprite).shade);
    }
    let count = 0;
    const radius = Math.min(this.full, LIGHT_RING_MAX_RADIUS) + 1.5;
    const r = Math.ceil(radius);
    const r2 = radius * radius;
    const minX = Math.max(0, ox - r);
    const maxX = Math.min(w - 1, ox + r);
    const minY = Math.max(0, oy - r);
    const maxY = Math.min(h - 1, oy + r);
    const flicker = this.lastFlicker;
    for (let gy = minY; gy <= maxY; gy++) {
      const dy = gy + 0.5 - py;
      for (let gx = minX; gx <= maxX; gx++) {
        const idx = gy * w + gx;
        if (stamp[idx] === gen || this.states[idx] !== FogState.EXPLORED) continue;
        const dx = gx + 0.5 - px;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        if (!this.losSnap(ox, oy, gx, gy)) continue;
        const tint = this.composeTint(this.falloff(Math.sqrt(d2)) * flicker, idx);
        this.tileTint[idx] = tint;
        this.tileTintStamp[idx] = this.frameNo;
        const floor = this.floorSprites[idx];
        if (floor) floor.tint = tint;
        const wall = this.wallSprites[idx];
        if (wall) wall.tint = tint;
        const props = this.propSprites.get(idx);
        if (props) for (const p of props) p.tint = shadeTint(tint, (p as ShadedSprite).shade);
        ring[count++] = idx;
      }
    }
    this.ringCount = count;
  }

  /** Torch ramp + baked colored sources + dynamic lights → final tint for one tile. */
  private composeTint(baseLight: number, idx: number): number {
    const [br, bg, bb] = rampChannels(baseLight, this.warmLit, this.shadow);
    const f = this.sourceFlicker;
    const r = Math.min(255, Math.round(br + this.srcR[idx] * f + this.dynR[idx]));
    const g = Math.min(255, Math.round(bg + this.srcG[idx] * f + this.dynG[idx]));
    const b = Math.min(255, Math.round(bb + this.srcB[idx] * f + this.dynB[idx]));
    return (r << 16) | (g << 8) | b;
  }

  /** Reveal the whole floor as explored (cheat menu / future map scrolls). */
  revealAll(): void {
    for (let idx = 0; idx < this.states.length; idx++) {
      if (this.states[idx] !== FogState.HIDDEN) continue;
      this.states[idx] = FogState.EXPLORED;
      this.revealPiecesAt(idx);
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
      this.revealPiecesAt(i);
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
        const pad = held ? 14 : 0;
        // THE TILESET PIECES (it.114). A crypt wall is no longer a 32-px cube on
        // its tile but a 128x256 run covering two tiles, seated by its bottom-
        // left and sorted by its own key. Such a piece is tested by ITS rect
        // (its painted face fills the lower half of the canvas) and its own
        // zIndex, not the cube's box and the cube's key.
        const tall = wall.height > TILE_H + WALL_Z + 8;
        if (tall) {
          if (wall.zIndex <= playerDepth - depthMargin) continue;
          const left = wall.x;
          const right = wall.x + wall.width;
          const top = wall.y + wall.height * 0.5;
          const bottom = wall.y + wall.height;
          const overlaps = right + pad > psx - 16 && left - pad < psx + 16 && bottom + pad > psy - 50 && top - pad < psy + 4;
          if (overlaps) targets.add(idx);
          continue;
        }
        if (depthKey(gx + 1, gy + 1) - 4 <= playerDepth - depthMargin) continue;
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

  /**
   * The cutaway for the tileset pieces (it.115): a TALL piece whose face sorts
   * in front of the hero and whose painted face (the lower half of its canvas)
   * covers the hero's body fades, with the same hysteresis as the cubes. The
   * pieces are few (~200 a floor), so all of them are tested; the near-wall
   * stubs are never tested - they are knee-high by design.
   */
  private updatePieceCutaway(px: number, py: number, dt: number): void {
    if (this.pieces.length === 0) return;
    const ps = worldToScreen(px, py, this.scratch);
    const psx = ps.x;
    const psy = ps.y;
    const playerDepth = depthKey(px, py);
    const k = 1 - Math.exp(-14 * dt);
    for (let id = 0; id < this.pieces.length; id++) {
      const p = this.pieces[id];
      if (!p.tall || !p.revealed) continue;
      const wall = p.sprite;
      const held = this.fadingPieces.has(id);
      let target = 1;
      const depthMargin = held ? 10 : -2;
      if (wall.zIndex > playerDepth - depthMargin) {
        const pad = held ? 14 : 0;
        const left = wall.x;
        const right = wall.x + wall.width;
        const top = wall.y + wall.height * 0.5;
        const bottom = wall.y + wall.height;
        if (right + pad > psx - 16 && left - pad < psx + 16 && bottom + pad > psy - 50 && top - pad < psy + 4) target = WALL_FADE_ALPHA;
      }
      if (target !== 1) this.fadingPieces.add(id);
      else if (!held) continue;
      wall.alpha += (target - wall.alpha) * k;
      if (target === 1 && wall.alpha > 0.995) {
        wall.alpha = 1;
        this.fadingPieces.delete(id);
      }
    }
  }
}
