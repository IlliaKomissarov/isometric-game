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
  | 'vfx_pentagram'
  | 'vfx_bloodburst'
  | 'spider_walk'
  | 'spider_idle'
  | 'spider_attack'
  | 'spider_death'
  | 'crowd_m0'
  | 'crowd_m1'
  | 'crowd_m2'
  | 'crowd_m3'
  | 'crowd_m4'
  | 'crowd_m5'
  | 'crowd_m6'
  | 'crowd_m7'
  | 'villager_walk'
  | 'merchant_walk'
  | 'campfire'
  | 'torch'
  | 'brazier_stand'
  | 'banner'
  | 'gateway'
  // THE GILDED STAG (it.96): the hearth's fire and the wall torches.
  | 'inn_fire'
  | 'inn_torch'
  // THE CELLAR (it.97): the keeper's serving woman, idling at the deep end.
  | 'cellar_girl'
  // THE TOWN'S OWN PEOPLE (it.99): five civilians who walk the districts.
  | 'cit_farmer_walk'
  | 'cit_porter_walk'
  | 'cit_monk_walk'
  | 'cit_goodwife_walk'
  | 'cit_maid_walk'
  | 'cit_labourer_walk'
  | 'cit_carter_walk'
  // THE MERCHANT OUT OF THE CLOSET (it.111): the only livery in the game nobody
  // else wears - `scripts/bake-trader.py` re-dyes the monk's sheet, which is the
  // one citizen carrying a bundle, into deep wine and plum. There is no merchant
  // in any pack in the repository, so this is how the game gets one.
  | 'trader_walk'
  // THE FARMLANDS (it.100): the free company's man-at-arms, and its general.
  | 'captain_idle'
  | 'captain_walk'
  | 'captain_attack'
  | 'captain_death'
  // THE SIEGE ENGINES (it.112). `scripts/bake-catapult.py` turns the pack's
  // top-down catapult renders into an isometric body by sprite stacking: eight
  // facings, three frames of recoil, and the same machine collapsed.
  | 'siege_engine'
  | 'siege_wreck'
  // THE REAL SIEGE ENGINES (it.114): `scripts/bake-siege.py`, eight facings each.
  | 'catapult_idle'
  | 'catapult_throw'
  | 'catapult_load'
  | 'catapult_move'
  | 'catapult_break'
  | 'catapult_wreck'
  | 'catapult_stone'
  | 'ballista_idle'
  | 'ballista_shoot'
  | 'well'
  // THE NEW FLESH (it.114): twenty-three more bodies out of the packs. Every
  // sheet here is eight-direction with canonical rows [E, NE, N, NW, W, SW, S,
  // SE], so none of them needs a DIR_ROW_FIX entry.
  | 'widow2_idle' | 'widow2_walk' | 'widow2_attack' | 'widow2_death' | 'widow2_hit'
  | 'widow3_idle' | 'widow3_walk' | 'widow3_attack' | 'widow3_death' | 'widow3_hit'
  | 'widow4_idle' | 'widow4_walk' | 'widow4_attack' | 'widow4_death' | 'widow4_hit'
  | 'brute_idle' | 'brute_walk' | 'brute_attack' | 'brute_death' | 'brute_hit'
  | 'frostwolf_idle' | 'frostwolf_walk' | 'frostwolf_attack' | 'frostwolf_death' | 'frostwolf_hit'
  | 'treant_idle' | 'treant_walk' | 'treant_attack' | 'treant_death' | 'treant_hit' | 'treant_awake'
  | 'drake_idle' | 'drake_walk' | 'drake_attack' | 'drake_death' | 'drake_hit' | 'drake_breath'
  | 'wyrm_idle' | 'wyrm_walk' | 'wyrm_attack' | 'wyrm_fly'
  | 'ghoul2_idle' | 'ghoul2_walk' | 'ghoul2_attack' | 'ghoul2_death' | 'ghoul2_crawl'
  | 'spearman_idle' | 'spearman_walk' | 'spearman_attack' | 'spearman_death' | 'spearman_hit' | 'spearman_shout'
  | 'orcess_idle' | 'orcess_walk' | 'orcess_attack' | 'orcess_death' | 'orcess_hit' | 'orcess_levelup'
  | 'moth_idle' | 'moth_walk' | 'moth_attack' | 'moth_death' | 'moth_hit'
  | 'zomb2_idle' | 'zomb2_walk' | 'zomb2_attack' | 'zomb2_death' | 'zomb2_hit' | 'zomb2_roar'
  | 'halberd_idle' | 'halberd_walk' | 'halberd_attack' | 'halberd_death' | 'halberd_hit'
  | 'reaper_idle' | 'reaper_walk' | 'reaper_attack' | 'reaper_death' | 'reaper_hit' | 'reaper_dash' | 'reaper_talk'
  | 'duelist_idle' | 'duelist_walk' | 'duelist_attack' | 'duelist_death' | 'duelist_hit' | 'duelist_cast' | 'duelist_block'
  | 'apex_idle' | 'apex_walk' | 'apex_attack' | 'apex_attack2' | 'apex_hit' | 'apex_death'
  | 'apex2_idle' | 'apex2_walk' | 'apex2_attack' | 'apex2_attack2' | 'apex2_hit' | 'apex2_death'
  | 'krampus_idle' | 'krampus_walk' | 'krampus_attack' | 'krampus_hit' | 'krampus_death'
  | 'gargoyle_idle' | 'gargoyle_awake' | 'gargoyle_walk'
  | 'spider2_idle' | 'spider2_walk' | 'spider2_attack' | 'spider2_death' | 'spider2_hit'
  | 'flesh_idle' | 'flesh_walk' | 'flesh_attack' | 'flesh_death'
  | 'creeper_idle' | 'creeper_walk' | 'creeper_attack' | 'creeper_death';

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
  /**
   * THE GROUND (it.115, `scripts/calibrate-feet.py`): the row (ORIGINAL px)
   * the feet stand on in this clip - measured on the body's solid pixels, so a
   * club swung below the boots or a baked shadow's rim no longer lifts it.
   */
  feetY?: number;
  /** A fall's anchor row per frame: standing at frame 0, the body centred on its tile once down. */
  feetFrames?: number[];
  /** The pack's render is broken past this many frames: the clip is cut there. */
  useFrames?: number;
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
 * A half turn: row = (d + 4) mod 8. (The it.43 "clockwise" zombie map that
 * stood here swapped north and south - see the it.115 audit below.)
 */
const ROTATE_180 = (d: number): number => (d + 4) % 8;
/** The Villager_01 / archer packs (it.43): rows run counter-clockwise from S -> row = (d + 2) mod 8. */
const FROM_SOUTH = (d: number): number => (d + 2) % 8;
/**
 * THE IT.115 FACING AUDIT. Every eight-direction sheet was rendered row by row
 * at a size where a face can be read, and checked on cues that do not lie: the
 * naked ghast's feet in profile, the poacher's quiver (on the back, so the face
 * is the other side), the widow's abdomen (towards the camera = walking away).
 * Where two packs carry the same model, the rows were also matched by
 * silhouette against the twin - the halberdier's and flesh golem's it.114
 * bakes read their facings off NAMED source angles, the hero's knight has
 * walked every build since it.11 - and those matches agree with the eye:
 *   - the 130 px crypt pack (ghast, risen, warden of frost, shaman, warlock,
 *     mage, rogue, Mithras, the Hollow Knight, the grave guard) is ONE ROW
 *     BEHIND canonical: its face is row 5, its right profile row 7. It was
 *     read as identity (it.37) and as a peasant rotation (the grave guard,
 *     it.48), so every one of them walked 45 degrees off, the grave guard with
 *     its back to the camera;
 *   - the zombie and the crypt widow ARE canonical: the it.43/it.55 "clockwise"
 *     maps got east and west right and swapped north and south, so the Hollow
 *     King and every widow walked at the hero backwards (silhouette-matched:
 *     the flesh golem is the zombie's own model, row for row);
 *   - the halberd guard and the lizard duelist are REFLECTED across the NW-SE
 *     diagonal, like the hydra (row for row the reflection of the halberdier
 *     and of the orc warrior, their it.114 twins), not a half turn / a mirror;
 *   - the teal spider's source angle 000 is its BACK (the pack's own
 *     convention), so the it.114 bake put every row a half turn out;
 *   - the HD knight is the hero's knight five rows round; the girl in black's
 *     PixelOver dirs run clockwise from south-east.
 */
const BEHIND_ONE = (d: number): number => (d + 7) % 8;
const DIR_ROW_FIX: ReadonlyArray<[prefix: string, fix: (d: number) => number]> = [
  ['ranger_', MIRROR_LR],
  ['guard_', REFLECT_NWSE], // IT.115: the halberdier's twin, reflected (it.48's half turn put his profile where his face is).
  ['wolf_', MIRROR_LR],
  ['lizard_', REFLECT_NWSE], // IT.115: the orc warrior's twin, reflected.
  ['hydra_', REFLECT_NWSE],
  ['naga_', REFLECT_NWSE],
  ['shambler_', REFLECT_NWSE],
  ['folk_', FROM_SOUTH],
  ['poacher_', FROM_SOUTH],
  // THE COMPANY (it.100): the same studio's `<dir><frame>` naming as the archer
  // pack, and the same row order - file row 0 is the face.
  ['captain_', FROM_SOUTH],
  ['villager_', ROTATE_SW],
  ['merchant_', ROTATE_SW],
  // THE 130 PX CRYPT PACK (it.115): one row behind.
  ['ahoul_', BEHIND_ONE],
  ['skelw_', BEHIND_ONE],
  ['skelm_', BEHIND_ONE],
  ['frost_', BEHIND_ONE],
  ['shaman_', BEHIND_ONE],
  ['mage_', BEHIND_ONE],
  ['rogue_', BEHIND_ONE],
  ['mithras_', BEHIND_ONE],
  ['hollow2_', BEHIND_ONE],
  ['grave_', BEHIND_ONE],
  // THE IT.114 BAKES the audit caught.
  ['spider2_', ROTATE_180],
  ['hdknight_', (d: number): number => (d + 5) % 8],
  ['pixgirl_', (d: number): number => (5 - d + 8) % 8],
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

    // THE BOOT STAYS SHORT (it.115): the ~500 item paintings the item bake added
    // are not needed to draw the menu or the first floor (a panel's cell reads
    // them by URL; a ground glyph falls back to its icon until they land), so
    // they stream in behind the menu instead of holding it.
    const all = Object.entries(this.manifest.singles);
    const deferred = (name: string): boolean => (name.startsWith('item_') && !name.startsWith('item_coin')) || name.startsWith('arsenal_');
    await this.loadSingles(all.filter(([n]) => !deferred(n)));
    await this.ensure(['gold_drop', 'glint']);
    this.loaded = true;
    void this.loadSingles(all.filter(([n]) => deferred(n))).catch((err) => console.warn('[SpriteLibrary] item singles', err));
  }

  private async loadSingles(entries: Array<[string, AtlasSingleEntry]>): Promise<void> {
    const urls = entries.map(([, e]) => `${ATLAS_BASE}/${e.file}`);
    const loaded = (await Assets.load(urls)) as Record<string, Texture>;
    entries.forEach(([name, e], i) => {
      const t = loaded[urls[i]];
      if (e.nearest) t.source.scaleMode = 'nearest';
      this.singles.set(name, t);
    });
  }

  /**
   * One single on demand (it.116): resident at once when it already is, else
   * fetched now (an item painting that has not streamed in yet). Null when
   * the manifest does not know it or the fetch fails.
   */
  async singleNow(name: string): Promise<Texture | null> {
    const have = this.singles.get(name);
    if (have) return have;
    const e = this.manifest?.singles[name];
    if (!e) return null;
    try {
      await this.loadSingles([[name, e]]);
    } catch {
      return null;
    }
    return this.singles.get(name) ?? null;
  }

  /** True when the manifest lists the single, resident or not (it.115: DOM users read it by URL). */
  knowsSingle(name: string): boolean {
    return !!this.manifest?.singles[name];
  }

  /** True when the atlas exists on disk (whether or not it is resident yet). */
  knows(name: string): boolean {
    return !!this.manifest?.anims[name];
  }

  /** Every animation the manifest knows (the menagerie's discovery, it.115). */
  animNames(): string[] {
    return this.manifest ? Object.keys(this.manifest.anims) : [];
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
   * THE FEET ROW (it.115), ORIGINAL px: the calibrated ground of the clip (per
   * frame for a fall), else the painted bottom - the old rule, which floated
   * every body whose clip paints anything below its boots (the owner's "the
   * orc knight flies up when attacking, and stays floating when dead").
   */
  feetY(name: string, frame = 0): number {
    const e = this.entry(name);
    if (!e) return 0;
    const ff = e.feetFrames;
    if (ff && ff.length) return ff[Math.max(0, Math.min(ff.length - 1, frame))];
    return e.feetY ?? e.painted.bottom + 1;
  }

  /**
   * THE BODY'S HEIGHT (it.115), ORIGINAL px: from the top of the paint to the
   * calibrated feet - what a rig normalises its scale by. The painted height
   * counted a baked shadow and anything swung below the boots as body.
   */
  bodyHeight(name: string): number {
    const e = this.entry(name);
    if (!e) return 0;
    return Math.max(1, (e.feetY ?? e.painted.bottom + 1) - e.painted.top);
  }

  /**
   * THE RIG'S YARDSTICK (it.115): the height a creature is normalised by -
   * the tallest of its idle, its walk and its attack over 1.45. The idle alone
   * lied twice: a crouched idle (the hooded creeper, the rotting ghoul) blew
   * the upright walk up to half again the hero's height, and a blow that
   * raises a club overhead doubled the body mid-swing. `attack` may exceed the
   * yardstick by 45 % (an arm raised) and no more.
   */
  rigHeight(idle: string | undefined, walk: string, attack?: string): number {
    const i = idle ? this.bodyHeight(idle) : 0;
    const w = this.bodyHeight(walk);
    const a = attack ? this.bodyHeight(attack) / 1.45 : 0;
    return Math.max(i, w, a);
  }

  /**
   * WHERE THE FEET ARE (it.104). A sliced frame keeps its ORIGINAL frame size
   * (the trim is restored), and the packs do not agree about how much empty air
   * they leave under a body: `captain_walk` leaves one pixel, `guard_walk` leaves
   * 114 of 320. So `anchor.set(0.5, 1)` - the obvious thing, and what the squad
   * and the cutscene cast both did - hangs a guard SEVENTY SCREEN PIXELS above
   * his own shadow, while a captain stands correctly. Every enemy def works
   * around this with a hand-tuned `anchorY`, one per sheet, found by eye.
   *
   * This is that number, computed: the anchor that puts the PAINTED bottom of
   * the body on the tile and its painted centre over the tile's centre. Returns
   * the naive (0.5, 1) when the sheet is unknown.
   *
   * It.115: the y is the calibrated `feetY` (per `frame` for a fall), so the
   * clip's feet - not its lowest painted pixel - stand on the tile.
   */
  footAnchor(name: string, frame = 0): { x: number; y: number } {
    const e = this.entry(name);
    if (!e || !e.origH || !e.origW) return { x: 0.5, y: 1 };
    return { x: (e.painted.left + e.painted.right + 1) / 2 / e.origW, y: this.feetY(name, frame) / e.origH };
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
    // MIPMAPS (it.74): a filtered atlas drawn at 0.82x on a phone (the
    // stage zoom bias) shimmered — minification without mip levels picks
    // texels at random. Pixel-art atlases stay 'nearest' and mip-less.
    if (!e.nearest) base.source.autoGenerateMipmaps = true;
    // Half-res atlases mount at resolution 0.5: every rectangle below is
    // then expressed in ORIGINAL pixels, exactly like the raw frames were.
    if (e.scale !== 1) base.source.resolution = e.scale;
    const inv = 1 / e.scale;
    const cellW = e.cellW * inv;
    const cellH = e.cellH * inv;
    // A CUT CLIP (it.115): frames past `useFrames` are a broken render in the pack.
    const frameCount = Math.max(1, Math.min(e.frameCount, e.useFrames ?? e.frameCount));
    const rows: Texture[][] = [];
    for (let d = 0; d < e.dirCount; d++) {
      const row: Texture[] = [];
      for (let f = 0; f < frameCount; f++) {
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
    this.anims.set(name, { frames, frameCount, dirCount: e.dirCount });
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
