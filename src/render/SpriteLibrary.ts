/**
 * @module render/SpriteLibrary
 * ATLAS-BASED sprite registry (it.36).
 *
 * Every character animation ships as ONE pre-baked grid PNG under
 * public/assets/atlas/ (columns = frames, rows = the 8 canonical
 * directions) described by `manifest.json`. The atlases were baked
 * pixel-for-pixel from the retired raw packs by an in-browser baker
 * (renderer extract of the exact textures the game rendered before the
 * purge — rebakes, layer composites and canvas tone-baking included):
 *
 *  - cells are ALPHA-CROPPED per animation; Pixi `trim`/`orig` restore the
 *    uncropped frame so every anchor calibrated against the raw packs
 *    stays valid (texture.width/height still report the original cell);
 *  - packs that only ever render at ≤0.42 rig scale are baked at HALF
 *    resolution (`scale: 0.5`) and mounted with source resolution 0.5, so
 *    all frame math stays in original pixels.
 *
 * LAZY LOADING CONTRACT: `load()` fetches the manifest + the tiny
 * always-needed singles + the two ambient loops. Everything else streams in
 * through `ensure()`: the hero rig at run start, each floor's roster under
 * the transition fade, the next floor prefetched in the background.
 * `hasAnim` is true only once an atlas is resident — rigs fall back to
 * procedural art otherwise, never to a blank.
 *
 * Direction convention everywhere in the game: index 0..7 =
 * [E, NE, N, NW, W, SW, S, SE] in SCREEN space (`dirIndexFromFacing`).
 *
 * SUB-AGENT BOUNDARY: to add an animation, bake an atlas (see
 * docs/skills/external-sprite-pipeline.md) and add its manifest entry —
 * never hand-build URLs elsewhere.
 */

import { Assets, Rectangle, Texture } from 'pixi.js';

/** Canonical direction order (math angles 0°,45°,…,315° in screen space). */
export const DIRS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as const;

// Base-aware asset root (it.31): '/' in dev, '/isometric-game/' on Pages.
const ROOT = `${import.meta.env.BASE_URL}assets`;
const ATLAS_BASE = `${ROOT}/atlas`;

/** Weapon icon file URL (28×12 pixel art) — used directly by DOM <img>. */
export function weaponIconUrl(stem: string): string {
  return `${ATLAS_BASE}/single_wicon_${stem}.png`;
}


/** DOM-only art under public/assets/ui (skill glyphs, painted item icons — it.40). */
export function uiAssetUrl(rel: string): string {
  return `${ROOT}/ui/${rel}`;
}

export type AnimName =
  | 'knight_idle'
  | 'knight_run'
  | 'knight_melee'
  | 'knight_melee2'
  | 'knight_spin'
  | 'knight_cast'
  | 'knight_hit'
  | 'knight_die'
  | 'zombie_walk'
  | 'zombie_idle'
  | 'zombie_attack'
  | 'zombie_death'
  | 'ranger_idle'
  | 'ranger_run'
  | 'ranger_attack'
  | 'ranger_hit'
  | 'ranger_death'
  | 'naga_idle'
  | 'naga_walk'
  | 'naga_attack'
  | 'naga_hit'
  | 'naga_death'
  | 'wolf_idle'
  | 'wolf_run'
  | 'wolf_attack'
  | 'wolf_hit'
  | 'wolf_death'
  | 'lizard_idle'
  | 'lizard_run'
  | 'lizard_attack'
  | 'lizard_hit'
  | 'lizard_death'
  | 'skelw_idle'
  | 'skelw_run'
  | 'skelw_attack'
  | 'skelw_death'
  | 'skelm_idle'
  | 'skelm_walk'
  | 'skelm_cast'
  | 'skelm_death'
  | 'hollow2_idle'
  | 'hollow2_walk'
  | 'hollow2_attack'
  | 'hollow2_death'
  | 'mage_idle'
  | 'mage_walk'
  | 'mage_cast'
  | 'mage_death'
  | 'rogue_idle'
  | 'rogue_run'
  | 'rogue_attack'
  | 'rogue_death'
  | 'hydra_idle'
  | 'hydra_walk'
  | 'hydra_attack'
  | 'hydra_hit'
  | 'hydra_death'
  | 'shambler_idle'
  | 'shambler_walk'
  | 'shambler_attack'
  | 'shambler_hit'
  | 'shambler_death'
  | 'shaman_idle'
  | 'shaman_walk'
  | 'shaman_cast'
  | 'shaman_death'
  | 'ahoul_idle'
  | 'ahoul_run'
  | 'ahoul_attack'
  | 'ahoul_death'
  | 'mithras_idle'
  | 'mithras_walk'
  | 'mithras_attack'
  | 'mithras_death'
  | 'frost_idle'
  | 'frost_walk'
  | 'frost_attack'
  | 'frost_death'
  | 'grave_idle'
  | 'grave_run'
  | 'grave_attack'
  | 'grave_death'
  | 'guard_idle'
  | 'guard_walk'
  | 'guard_attack'
  | 'guard_hit'
  | 'guard_death'
  | 'gold_drop'
  | 'glint'
  // Town (it.39)
  | 'vfx_fireball'
  | 'vfx_explosion'
  | 'vfx_burst'
  | 'vfx_firewall'
  | 'vfx_ring'
  | 'vfx_vortex'
  | 'vfx_splash'
  | 'vfx_whirl'
  | 'vfx_slash'
  | 'vfx_aura'
  | 'vfx_orb'
  | 'vfx_strike'
  | 'folk_walk'
  | 'folk_death'
  | 'poacher_walk'
  | 'poacher_run'
  | 'poacher_idle'
  | 'poacher_attack'
  | 'poacher_death'
  | 'orc_walk'
  | 'orc_attack'
  | 'orc_idle'
  | 'orc_death'
  | 'orc_hit'
  | 'vfx_splat'
  | 'vfx_bloodhit'
  | 'vfx_cut1'
  | 'vfx_cut3'
  | 'vfx_cut4'
  | 'vfx_cut5'
  | 'villager_walk'
  | 'merchant_walk'
  | 'campfire'
  | 'torch'
  | 'well';

export interface PaintedBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface AtlasAnimEntry {
  file: string;
  /** Atlas cell size in ATLAS pixels (cropped, possibly downscaled). */
  cellW: number;
  cellH: number;
  frameCount: number;
  dirCount: number;
  nearest: boolean;
  /** Original (uncropped, full-res) frame size — anchors are relative to it. */
  origW: number;
  origH: number;
  /** Crop offset of the cell inside the original frame (full-res px). */
  trimX: number;
  trimY: number;
  /** Atlas pixels per original pixel (0.5 = half-resolution bake). */
  scale: number;
  /** Painted bounds (ORIGINAL px) of the south-facing frames, union over frames. */
  painted: PaintedBounds;
}

export interface AtlasSingleEntry {
  file: string;
  w: number;
  h: number;
  nearest: boolean;
}

export interface AtlasManifest {
  generated: string;
  anims: Record<string, AtlasAnimEntry>;
  singles: Record<string, AtlasSingleEntry>;
}

export interface LoadedAnim {
  /** frames[dirIndex][frameIndex]; single-direction anims use dirIndex 0. */
  frames: Texture[][];
  frameCount: number;
  dirCount: number;
}

/** Map a world-space facing vector to a canonical 8-direction index. */
export function dirIndexFromFacing(fx: number, fy: number): number {
  const screenX = fx - fy;
  const screenY = (fx + fy) / 2; // Screen-down positive.
  let deg = (Math.atan2(-screenY, screenX) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return Math.round(deg / 45) % 8;
}

/**
 * Direction pick WITH HYSTERESIS: keeps the previous direction unless the
 * facing has clearly entered a new sector (>32° from the old center).
 * Kills the sprite-flip jitter when running along diagonal sector edges.
 */
export function stableDir(fx: number, fy: number, lastDir: number): number {
  const screenX = fx - fy;
  const screenY = (fx + fy) / 2;
  let deg = (Math.atan2(-screenY, screenX) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const lastCenter = lastDir * 45;
  let diff = Math.abs(deg - lastCenter);
  if (diff > 180) diff = 360 - diff;
  if (diff <= 32) return lastDir;
  return Math.round(deg / 45) % 8;
}

/**
 * DIRECTION ROW FIXES (it.37 ground-truth audit). Every atlas row was
 * rendered to a labeled grid and read against the knight reference
 * (E = right profile, N = back, W = left profile, S = face). Three pack
 * families store their rows in a different order than our canonical
 * [E, NE, N, NW, W, SW, S, SE]:
 *   - MIRRORED (left/right swapped, N/S right): ranger sheets, zombie
 *     folders, halberdier, werewolf, lizardman  -> row = (4 - d) mod 8
 *   - REFLECTED across the NW-SE diagonal (E showed the face, W the back,
 *     S the right profile): hydra, naga, villager -> row = (6 - d) mod 8
 * Everything else (knight, big pack, LoP props) is identity.
 * `rowForDir(anim, d)` = which atlas row FACES canonical direction d.
 */
const MIRROR_LR = (d: number): number => (4 - d + 8) % 8;
const REFLECT_NWSE = (d: number): number => (6 - d + 8) % 8;
/**
 * ROTATED (it.39 audit): the coc_chars peasant sheets store their rows
 * counter-clockwise from SW — [SW, S, SE, E, NE, N, NW, W] — so canonical
 * direction d lives on row (d + 3) mod 8.
 */
const ROTATE_SW = (d: number): number => (d + 3) % 8;
/**
 * IT.43 GROUND-TRUTH RE-AUDIT (every mob sheet rendered per row against the
 * knight reference): the zombie pack stores its rows CLOCKWISE on screen
 * [E, SE, S, SW, W, NW, N, NE] -> row = (8 - d) mod 8, and the grave-guard
 * pack is a half turn out -> row = (d + 4) mod 8. Both were mis-mapped
 * before (the Hollow King's first form ran left while facing right).
 */
const CLOCKWISE = (d: number): number => (8 - d) % 8;
const ROTATE_180 = (d: number): number => (d + 4) % 8;
/** The Villager_01 / archer packs (it.43): rows run counter-clockwise from S -> row = (d + 2) mod 8. */
const FROM_SOUTH = (d: number): number => (d + 2) % 8;
const DIR_ROW_FIX: ReadonlyArray<[prefix: string, fix: (d: number) => number]> = [
  ['ranger_', MIRROR_LR],
  ['zombie_', CLOCKWISE],
  ['guard_', MIRROR_LR],
  ['wolf_', MIRROR_LR],
  ['lizard_', MIRROR_LR],
  ['hydra_', REFLECT_NWSE],
  ['naga_', REFLECT_NWSE],
  ['shambler_', REFLECT_NWSE],
  ['grave_', ROTATE_180],
  ['folk_', FROM_SOUTH],
  ['poacher_', FROM_SOUTH],
  ['villager_', ROTATE_SW],
  ['merchant_', ROTATE_SW],
];
/** Public URL of an atlas file (bestiary CSS sprites, it.42). */
export function atlasUrl(file: string): string {
  return `${ATLAS_BASE}/${file}`;
}

export function rowForDir(anim: string, d: number): number {
  for (const [prefix, fix] of DIR_ROW_FIX) if (anim.startsWith(prefix)) return fix(d);
  return d;
}

export class SpriteLibrary {
  private manifest: AtlasManifest | null = null;
  private readonly anims = new Map<string, LoadedAnim>();
  private readonly singles = new Map<string, Texture>();
  /** Atlas fetches in flight, keyed by anim name (dedupes concurrent ensures). */
  private readonly inflight = new Map<string, Promise<void>>();
  /** Manifest + singles resident; `ensure()` may be called. */
  loaded = false;

  /**
   * Boot load: manifest, singles (icons, tiles, stairs, candelabra) and the
   * two ambient loops. Under 1 MB — the menu appears immediately after.
   */
  async load(): Promise<void> {
    const res = await fetch(`${ATLAS_BASE}/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`[SpriteLibrary] manifest.json missing (${res.status})`);
    this.manifest = (await res.json()) as AtlasManifest;

    const entries = Object.entries(this.manifest.singles);
    const urls = entries.map(([, e]) => `${ATLAS_BASE}/${e.file}`);
    const loaded = (await Assets.load(urls)) as Record<string, Texture>;
    entries.forEach(([name, e], i) => {
      const t = loaded[urls[i]];
      if (e.nearest) t.source.scaleMode = 'nearest';
      this.singles.set(name, t);
    });
    await this.ensure(['gold_drop', 'glint']);
    this.loaded = true;
  }

  /** True when the atlas exists on disk (whether or not it is resident yet). */
  knows(name: string): boolean {
    return !!this.manifest?.anims[name];
  }

  /** True once the animation's atlas is resident and sliced. */
  hasAnim(name: string): boolean {
    return this.anims.has(name);
  }

  /** The manifest entry for an animation (cell geometry, file, painted bounds). */
  entry(name: string): AtlasAnimEntry | null {
    return this.manifest?.anims[name] ?? null;
  }

  /** Painted bounds (original px, south-facing union) from the manifest. */
  painted(name: string): PaintedBounds | null {
    return this.manifest?.anims[name]?.painted ?? null;
  }

  /** Painted height in original px (0 when unknown) — rig scale normalization. */
  paintedHeight(name: string): number {
    const p = this.painted(name);
    return p ? p.bottom - p.top + 1 : 0;
  }

  /**
   * Make the named animations resident (fetch + slice their atlases).
   * Unknown names are ignored; already-resident names are free; concurrent
   * calls for the same atlas share one fetch. Resolves when ALL are ready.
   */
  async ensure(names: ReadonlyArray<string>): Promise<void> {
    const manifest = this.manifest;
    if (!manifest) return;
    const wanted = [...new Set(names)].filter((n) => !this.anims.has(n) && !!manifest.anims[n]);
    const fresh = wanted.filter((n) => !this.inflight.has(n));
    if (fresh.length > 0) {
      const urls = fresh.map((n) => `${ATLAS_BASE}/${manifest.anims[n].file}`);
      const job = (async () => {
        try {
          const loaded = (await Assets.load(urls)) as Record<string, Texture>;
          fresh.forEach((n, i) => this.slice(n, manifest.anims[n], loaded[urls[i]]));
        } finally {
          for (const n of fresh) this.inflight.delete(n);
        }
      })();
      for (const n of fresh) this.inflight.set(n, job);
    }
    await Promise.all(wanted.map((n) => this.inflight.get(n)).filter((p): p is Promise<void> => !!p));
  }

  /** Slice a loaded atlas into [dir][frame] textures (trim/orig restore the raw cell). */
  private slice(name: string, e: AtlasAnimEntry, base: Texture): void {
    if (this.anims.has(name)) return;
    base.source.scaleMode = e.nearest ? 'nearest' : 'linear';
    // Half-res atlases mount at resolution 0.5: every rectangle below is
    // then expressed in ORIGINAL pixels, exactly like the raw frames were.
    if (e.scale !== 1) base.source.resolution = e.scale;
    const inv = 1 / e.scale;
    const cellW = e.cellW * inv;
    const cellH = e.cellH * inv;
    const rows: Texture[][] = [];
    for (let d = 0; d < e.dirCount; d++) {
      const row: Texture[] = [];
      for (let f = 0; f < e.frameCount; f++) {
        row.push(
          new Texture({
            source: base.source,
            frame: new Rectangle(f * cellW, d * cellH, cellW, cellH),
            orig: new Rectangle(0, 0, e.origW, e.origH),
            trim: new Rectangle(e.trimX, e.trimY, cellW, cellH),
          }),
        );
      }
      rows.push(row);
    }
    // Canonical order out: frames[d] is the row that FACES direction d.
    const frames: Texture[][] =
      e.dirCount === 8 ? Array.from({ length: 8 }, (_, d) => rows[rowForDir(name, d)]) : rows;
    this.anims.set(name, { frames, frameCount: e.frameCount, dirCount: e.dirCount });
  }

  anim(name: AnimName): LoadedAnim {
    const a = this.anims.get(name);
    if (!a) throw new Error(`[SpriteLibrary] Animation not resident: ${name} (call ensure() first)`);
    return a;
  }

  /** Texture for an animation at a direction + frame (frame wraps). */
  frame(name: AnimName, dir: number, frame: number): Texture {
    const a = this.anim(name);
    const d = a.dirCount === 1 ? 0 : dir % a.dirCount;
    return a.frames[d][((frame % a.frameCount) + a.frameCount) % a.frameCount];
  }

  single(name: string): Texture {
    const t = this.singles.get(name);
    if (!t) throw new Error(`[SpriteLibrary] Unknown texture: ${name}`);
    return t;
  }

  hasSingle(name: string): boolean {
    return this.singles.has(name);
  }

  /** Resident animation names (debug/QA). */
  residentAnims(): string[] {
    return [...this.anims.keys()];
  }
}

/** Shared instance, loaded in main before the menu appears. */
export const spriteLib = new SpriteLibrary();
