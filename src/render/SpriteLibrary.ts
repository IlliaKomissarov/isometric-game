/**
 * @module render/SpriteLibrary
 * Loader + registry for the external art packs:
 *
 *  - "2D HD Character Knight": 1920×1024 sheets, a 15-frame × 8-direction
 *    grid of 128×128 cells (one DIRECTION per row, 15 columns of frames).
 *    Used as the player character (idle/run/melee×2/spin/cast/hit/die).
 *  - "(DEMO) Lords Of Pain": per-frame 256×256 PNGs named
 *    `<anim>_<DIR>_<angle>_<frame>.png`, 16 directions of which we load the
 *    8 principal ones. Characters register at the FRAME CENTER (128,128 =
 *    ground point) with shadows baked in. Used for the skeleton enemy,
 *    the gold-pile prop, the glint VFX, and UI markers.
 *
 * All frames become Pixi Textures held here as `frames[dir][frame]`.
 * Direction convention everywhere in the game: index 0..7 =
 * [E, NE, N, NW, W, SW, S, SE] in SCREEN space (`dirIndexFromFacing`).
 *
 * SUB-AGENT BOUNDARY: to add an animation, extend the manifest constants —
 * never hand-build URLs elsewhere. If a pack's row order looks wrong on
 * screen, fix KNIGHT_ROW_FOR_DIR only.
 */

import { Assets, Rectangle, Sprite, Texture, type Renderer } from 'pixi.js';

/** Canonical direction order (math angles 0°,45°,…,315° in screen space). */
export const DIRS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] as const;

/** Lords-of-Pain filename angle per direction (matches DIRS order). */
const LOP_ANGLE: Record<string, string> = {
  E: '0.0',
  NE: '45.0',
  N: '90.0',
  NW: '135.0',
  W: '180.0',
  SW: '225.0',
  S: '270.0',
  SE: '315.0',
};

// Base-aware asset root (it.31): '/' in dev, '/isometric-game/' on Pages.
const ROOT = `${import.meta.env.BASE_URL}assets`;
const LOP_BASE = `${ROOT}/(DEMO) Lords Of Pain - Old School Isometric Assets`;
const KNIGHT_BASE = `${ROOT}/2D HD Character Knight/Spritesheets/With shadows`;
const WEAPON_ICON_BASE = `${ROOT}/oubliette_weapons - free`;

/** Weapon icon file URL (28×12 pixel art) — also used directly by DOM <img>. */
export function weaponIconUrl(stem: string): string {
  return encodeURI(`${WEAPON_ICON_BASE}/spr_wep_${stem}.png`);
}

/** Every oubliette icon stem referenced by the item catalog. */
const ICON_STEMS = [
  'bronze_sword_0',
  'iron_sword_0',
  'steel_large_0',
  'stick_0',
  'heal_0',
  'iron_axe_0',
  'iron_baxe_0',
  'mace_0',
  'mace_big_0',
  'steel_ghammer_0',
  'iron_scythe_0',
  'steel_halberd_0',
  'iron_katana_0',
  'steel_falcon_0',
] as const;

/**
 * Knight sheet row for each canonical dir index. Calibrated in-game from a
 * row strip: sheet rows 0..7 face [SE, S, SW, W, NW, N, NE, E], i.e. exactly
 * the reverse of our canonical [E, NE, N, NW, W, SW, S, SE] order.
 */
export const KNIGHT_ROW_FOR_DIR = [7, 6, 5, 4, 3, 2, 1, 0];

const KNIGHT_SHEETS = {
  knight_idle: 'Idle',
  knight_run: 'Run',
  knight_melee: 'Melee',
  knight_melee2: 'Melee2',
  knight_spin: 'MeleeSpin',
  knight_cast: 'CastSpell',
  knight_hit: 'TakeDamage',
  knight_die: 'Die',
} as const;

const KNIGHT_COLS = 15;
const KNIGHT_ROWS = 8;
const KNIGHT_CELL = 128;

export type AnimName =
  | keyof typeof KNIGHT_SHEETS
  | 'skeleton_walk'
  | 'skeleton_death'
  | 'warrior_idle'
  | 'warrior_walk'
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
  | 'glint';

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

export class SpriteLibrary {
  private readonly anims = new Map<string, LoadedAnim>();
  private readonly singles = new Map<string, Texture>();
  loaded = false;
  private renderer!: Renderer;

  /** Evenly-spaced 1-based frame indexes: pick `count` out of `total`. */
  private static picks(total: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) => 1 + Math.round((i * (total - 1)) / (count - 1)));
  }

  /**
   * Load a list of frame URLs and RE-BAKE each at `scale` into fresh small
   * GPU textures, unloading the large originals. This is what makes the
   * 512²-per-frame packs (zombie, bonfire) affordable: fetched once,
   * downsampled once, originals freed.
   */
  private async rebakeUrls(urls: string[], scale: number): Promise<Texture[]> {
    const loaded = (await Assets.load(urls)) as Record<string, Texture>;
    const out: Texture[] = [];
    for (const url of urls) {
      const spr = new Sprite(loaded[url]);
      spr.scale.set(scale);
      out.push(this.renderer.generateTexture({ target: spr, antialias: true }));
      spr.destroy();
    }
    await Assets.unload(urls);
    return out;
  }

  /** Load one grid sheet, slice `cellW`² cells, rebake chosen frame indexes. */
  private async rebakeSheet(url: string, cell: number, frameIndexes: number[], scale: number): Promise<Texture[]> {
    const base = (await Assets.load(url)) as Texture;
    const cols = Math.floor(base.width / cell);
    const out: Texture[] = [];
    for (const idx of frameIndexes) {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const sub = new Texture({ source: base.source, frame: new Rectangle(col * cell, row * cell, cell, cell) });
      const spr = new Sprite(sub);
      spr.scale.set(scale);
      out.push(this.renderer.generateTexture({ target: spr, antialias: true }));
      spr.destroy();
      sub.destroy();
    }
    await Assets.unload(url);
    return out;
  }

  hasAnim(name: string): boolean {
    return this.anims.has(name);
  }

  /** Fetch every pack asset. Call once at boot (before buildWorld). */
  async load(renderer: Renderer): Promise<void> {
    this.renderer = renderer;
    const urls: Record<string, string> = {};

    for (const sheet of Object.values(KNIGHT_SHEETS)) {
      urls[`sheet_${sheet}`] = encodeURI(`${KNIGHT_BASE}/${sheet}.png`);
    }
    const lopFrame = (anim: string, group: string, dir: string, frame: number) =>
      encodeURI(`${LOP_BASE}/${group}/${anim}/${dir}/${anim}_${dir}_${LOP_ANGLE[dir]}_${frame}.png`);
    for (const dir of DIRS) {
      for (let f = 0; f < 8; f++) {
        urls[`skw_${dir}_${f}`] = lopFrame('skeleton_default_walk', 'enemy/skeleton', dir, f);
        urls[`skd_${dir}_${f}`] = lopFrame('skeleton_special_death', 'enemy/skeleton', dir, f);
        urls[`waw_${dir}_${f}`] = lopFrame('warrior_armed_walk', 'playable character/warrior', dir, f);
      }
      urls[`wai_${dir}_0`] = lopFrame('warrior_armed_idle', 'playable character/warrior', dir, 0);
    }
    for (let f = 0; f < 8; f++) {
      urls[`gold_${f}`] = encodeURI(`${LOP_BASE}/prop/gold_drop/S/gold_drop_S_270.0_${f}.png`);
      urls[`glint_${f}`] = encodeURI(`${LOP_BASE}/vfx/glint/glint_${f}.png`);
    }
    urls['tile_highlight'] = encodeURI(`${LOP_BASE}/user interface/highlight/highlight_yellow.png`);
    urls['loot_indicator'] = encodeURI(`${LOP_BASE}/user interface/loot-indicator/loot_indicator_yellow.png`);
    urls['ground_stone'] = encodeURI(`${LOP_BASE}/environment/ground_stone1.png`);
    for (const stem of ICON_STEMS) {
      urls[`wicon_${stem}`] = weaponIconUrl(stem);
    }

    const loadedAssets = (await Assets.load(Object.values(urls))) as Record<string, Texture>;
    const tex = (key: string): Texture => loadedAssets[urls[key]];

    // --- Knight sheets → [dir][frame] slices --------------------------------
    for (const [animName, sheet] of Object.entries(KNIGHT_SHEETS)) {
      const base = tex(`sheet_${sheet}`);
      const frames: Texture[][] = [];
      for (let dir = 0; dir < KNIGHT_ROWS; dir++) {
        const row = KNIGHT_ROW_FOR_DIR[dir];
        const rowFrames: Texture[] = [];
        for (let col = 0; col < KNIGHT_COLS; col++) {
          rowFrames.push(
            new Texture({
              source: base.source,
              frame: new Rectangle(col * KNIGHT_CELL, row * KNIGHT_CELL, KNIGHT_CELL, KNIGHT_CELL),
            }),
          );
        }
        frames.push(rowFrames);
      }
      this.anims.set(animName, { frames, frameCount: KNIGHT_COLS, dirCount: KNIGHT_ROWS });
    }

    // --- Lords-of-Pain per-frame anims --------------------------------------
    // Pixel-art characters upscale in-game: nearest-neighbor keeps them
    // CRISP (old-school chunky pixels) instead of blurry linear smears.
    const crisp = (t: Texture): Texture => {
      t.source.scaleMode = 'nearest';
      return t;
    };
    const buildLop = (prefix: string, frameCount: number): LoadedAnim => {
      const frames: Texture[][] = DIRS.map((dir) => {
        const row: Texture[] = [];
        for (let f = 0; f < frameCount; f++) row.push(crisp(tex(`${prefix}_${dir}_${f}`)));
        return row;
      });
      return { frames, frameCount, dirCount: 8 };
    };
    this.anims.set('skeleton_walk', buildLop('skw', 8));
    this.anims.set('skeleton_death', buildLop('skd', 8));
    this.anims.set('warrior_walk', buildLop('waw', 8));
    this.anims.set('warrior_idle', buildLop('wai', 1));

    // --- Single-direction anims + singles -----------------------------------
    this.anims.set('gold_drop', {
      frames: [Array.from({ length: 8 }, (_, f) => crisp(tex(`gold_${f}`)))],
      frameCount: 8,
      dirCount: 1,
    });
    this.anims.set('glint', {
      frames: [Array.from({ length: 8 }, (_, f) => crisp(tex(`glint_${f}`)))],
      frameCount: 8,
      dirCount: 1,
    });
    this.singles.set('tile_highlight', crisp(tex('tile_highlight')));
    this.singles.set('loot_indicator', crisp(tex('loot_indicator')));
    this.singles.set('ground_stone', tex('ground_stone')); // Linear: it downsamples into floors.

    // Weapon inventory/ground icons (28×12 pixel art).
    for (const stem of ICON_STEMS) {
      this.singles.set(`wicon_${stem}`, crisp(tex(`wicon_${stem}`)));
    }

    // NOTE (it.17): the Temple Kit material path was retired — every depth
    // renders through the proven stone pipeline with band tints only.

    // ------ FULLY-ANIMATED MOB PACKS (rebaked from huge frames) -----------
    // Each pack loads inside its own guard: a failure skips that species
    // (its enemy def falls back to the knight variant), never the whole game.

    // The zombie: 512² per-frame PNGs, 8 dirs named exactly like DIRS.
    try {
      const zBase = `${ROOT}/zombie`;
      const zAnim = async (folder: string, total: number, count: number): Promise<Texture[][]> => {
        const framesPerDir: Texture[][] = [];
        for (const dir of DIRS) {
          const urls = SpriteLibrary.picks(total, count).map(
            (n) => `${zBase}/${folder}/${dir}/${String(n).padStart(4, '0')}.png`,
          );
          framesPerDir.push(await this.rebakeUrls(urls, 0.28));
        }
        return framesPerDir;
      };
      this.anims.set('zombie_walk', { frames: await zAnim('WALK', 25, 8), frameCount: 8, dirCount: 8 });
      this.anims.set('zombie_attack', { frames: await zAnim('ATTACK', 70, 12), frameCount: 12, dirCount: 8 });
      this.anims.set('zombie_death', { frames: await zAnim('DYING', 69, 12), frameCount: 12, dirCount: 8 });
      this.anims.set('zombie_idle', { frames: await zAnim('IDLE', 170, 8), frameCount: 8, dirCount: 8 });
    } catch (err) {
      console.warn('[SpriteLibrary] zombie pack unavailable:', err);
    }

    // The ranger (x320p bow set): one 320px-cell grid sheet per 22.5° dir.
    // It.23 FIX: this pack's angles run 180° OPPOSITE the other sheets —
    // the archer walked and shot backwards. Angle list is rotated half a
    // turn so sprite facing matches movement and shot trajectory.
    try {
      const rBase = `${ROOT}/x320p_Spritesheets`;
      const R_ANGLES = ['180', '225', '270', '315', '000', '045', '090', '135'];
      const rAnim = async (name: string, total: number, count: number): Promise<Texture[][]> => {
        const framesPerDir: Texture[][] = [];
        for (const angle of R_ANGLES) {
          const url = encodeURI(`${rBase}/${name}/${name}_Body_${angle}.png`);
          framesPerDir.push(
            await this.rebakeSheet(url, 320, SpriteLibrary.picks(total, count).map((n) => n - 1), 0.36),
          );
        }
        return framesPerDir;
      };
      this.anims.set('ranger_idle', { frames: await rAnim('Idle_Bow', 16, 8), frameCount: 8, dirCount: 8 });
      this.anims.set('ranger_run', { frames: await rAnim('Run_Bow', 20, 10), frameCount: 10, dirCount: 8 });
      this.anims.set('ranger_attack', { frames: await rAnim('Attack_Bow', 24, 12), frameCount: 12, dirCount: 8 });
      this.anims.set('ranger_hit', { frames: await rAnim('Hit_Bow', 20, 8), frameCount: 8, dirCount: 8 });
      this.anims.set('ranger_death', { frames: await rAnim('Death_Bow', 30, 12), frameCount: 12, dirCount: 8 });
    } catch (err) {
      console.warn('[SpriteLibrary] ranger pack unavailable:', err);
    }

    // NOTE (it.13): the vfx Bonfire animation was PURGED per user direction
    // ("ugly fire") — brazier light sources are now invisible hearths; the
    // atmosphere layer is Ambience's crypt mist + hotspot ember motes.

    // Generic per-frame angle-folder loader shared by the audit packs
    // (`<Anim>/<bodyDir>/<angle>/<Anim>_Body_<angle>_<frame%04d>.png`).
    // Angle order matches the ranger convention verified on screen:
    // [0°,45°,…,315°] maps to canonical dirs [E,NE,N,NW,W,SW,S,SE].
    const rebakeAnglePack = async (
      urlFor: (angle: string, frame: number) => string,
      angles: string[],
      frameIndexes: number[],
      scale: number,
    ): Promise<Texture[][]> => {
      const framesPerDir: Texture[][] = [];
      for (const angle of angles) {
        framesPerDir.push(
          await this.rebakeUrls(
            frameIndexes.map((f) => urlFor(angle, f)),
            scale,
          ),
        );
      }
      return framesPerDir;
    };
    const pad4 = (n: number): string => String(n).padStart(4, '0');

    // The NAGA (256×256 audit pack): serpent spear-maiden — the unique
    // Depth XV boss. Frames are 0-based. MORPH-GLITCH PURGE (it.14): the
    // pack's FireBreath folder contains a DIFFERENT creature (a dragon!) —
    // it is banned; her spear Attack1 set is the attack animation instead.
    try {
      // It.24 DIRECTION AUDIT: this vendor's angle-0 faces WEST (verified
      // frame-by-frame) — all four angle packs get the half-turn rotation.
      const ANGLES = ['180', '225', '270', '315', '0', '45', '90', '135'];
      const nagaAnim = async (folder: string, total: number, count: number): Promise<Texture[][]> =>
        rebakeAnglePack(
          (angle, f) => `${ROOT}/256x256/${folder}/Body_Only/${angle}/${folder}_Body_${angle}_${pad4(f)}.png`,
          ANGLES,
          SpriteLibrary.picks(total, count).map((n) => n - 1),
          0.5,
        );
      this.anims.set('naga_idle', { frames: await nagaAnim('Idle1', 20, 6), frameCount: 6, dirCount: 8 });
      this.anims.set('naga_walk', { frames: await nagaAnim('Walk', 20, 8), frameCount: 8, dirCount: 8 });
      this.anims.set('naga_attack', { frames: await nagaAnim('Attack1', 16, 8), frameCount: 8, dirCount: 8 });
      this.anims.set('naga_hit', { frames: await nagaAnim('Hit', 12, 6), frameCount: 6, dirCount: 8 });
      this.anims.set('naga_death', { frames: await nagaAnim('Death', 24, 10), frameCount: 10, dirCount: 8 });
    } catch (err) {
      console.warn('[SpriteLibrary] naga pack unavailable:', err);
    }

    // The WEREWOLF BERSERKER (x320p_Spritesheets1234 audit pack): armored
    // axe-beast — the "Moon-Cursed Ravager" elite. Grid sheets per 22.5°
    // angle, 320px cells, same convention as the ranger.
    try {
      const wBase = `${ROOT}/x320p_Spritesheets1234`;
      const W_ANGLES = ['180', '225', '270', '315', '000', '045', '090', '135']; // It.24: half-turn fix.
      const wolfAnim = async (name: string, total: number, count: number): Promise<Texture[][]> => {
        const framesPerDir: Texture[][] = [];
        for (const angle of W_ANGLES) {
          const url = encodeURI(`${wBase}/${name}/${name}_Body_${angle}.png`);
          framesPerDir.push(
            await this.rebakeSheet(url, 320, SpriteLibrary.picks(total, count).map((n) => n - 1), 0.36),
          );
        }
        return framesPerDir;
      };
      this.anims.set('wolf_idle', { frames: await wolfAnim('Idle_Simple', 12, 6), frameCount: 6, dirCount: 8 });
      this.anims.set('wolf_run', { frames: await wolfAnim('Run', 8, 8), frameCount: 8, dirCount: 8 });
      this.anims.set('wolf_attack', { frames: await wolfAnim('Attack_01', 12, 8), frameCount: 8, dirCount: 8 });
      this.anims.set('wolf_hit', { frames: await wolfAnim('Hit', 6, 6), frameCount: 6, dirCount: 8 });
      this.anims.set('wolf_death', { frames: await wolfAnim('Death_from_Idle', 16, 10), frameCount: 10, dirCount: 8 });
    } catch (err) {
      console.warn('[SpriteLibrary] werewolf pack unavailable:', err);
    }

    // The LIZARDMAN DUELIST (Frames_320x320 audit pack): crested scimitar
    // raider — the "Ashscale Duelist". Per-frame angle folders, 1-based.
    // (Also in the pack, unloaded: a full AERIAL moveset — future flier.)
    try {
      const L_ANGLES = ['180', '225', '270', '315', '000', '045', '090', '135']; // It.24: half-turn fix.
      const lizAnim = async (folder: string, total: number, count: number): Promise<Texture[][]> =>
        rebakeAnglePack(
          (angle, f) => `${ROOT}/Frames_320x320/${folder}/Body/${angle}/${folder}_Body_${angle}_${pad4(f)}.png`,
          L_ANGLES,
          SpriteLibrary.picks(total, count),
          0.4,
        );
      this.anims.set('lizard_idle', { frames: await lizAnim('Idle_BattlePose', 10, 6), frameCount: 6, dirCount: 8 });
      this.anims.set('lizard_run', { frames: await lizAnim('Run_Forward', 10, 8), frameCount: 8, dirCount: 8 });
      this.anims.set('lizard_attack', { frames: await lizAnim('Ground_Attack_01', 16, 10), frameCount: 10, dirCount: 8 });
      this.anims.set('lizard_hit', { frames: await lizAnim('Hit_Stomach', 12, 6), frameCount: 6, dirCount: 8 });
      this.anims.set('lizard_death', { frames: await lizAnim('Death_FallBack', 20, 10), frameCount: 10, dirCount: 8 });
    } catch (err) {
      console.warn('[SpriteLibrary] lizardman pack unavailable:', err);
    }

    // NOTE (it.16): the orc-brute loads were benched (the final boss is now
    // the zombie colossus per user direction — no knights, and no need to
    // pay ~250 rebakes for an unused body). The 320x320p_Frames pack itself
    // is intact and working if a future elite wants it.

    // The HALBERDIER (320x320 audit pack): armored polearm soldier — the new
    // "Crypt Sentinel" regular mob for the deep floors. Frames are 1-based.
    try {
      const ANGLES = ['180', '225', '270', '315', '000', '045', '090', '135']; // It.24: half-turn fix.
      const guardAnim = async (folder: string, total: number, count: number): Promise<Texture[][]> =>
        rebakeAnglePack(
          (angle, f) => `${ROOT}/320x320/${folder}/Body/${angle}/${folder}_Body_${angle}_${pad4(f)}.png`,
          ANGLES,
          SpriteLibrary.picks(total, count),
          0.4,
        );
      this.anims.set('guard_idle', { frames: await guardAnim('Idle', 24, 6), frameCount: 6, dirCount: 8 });
      this.anims.set('guard_walk', { frames: await guardAnim('Walk', 16, 8), frameCount: 8, dirCount: 8 });
      this.anims.set('guard_attack', { frames: await guardAnim('Attack1', 24, 10), frameCount: 10, dirCount: 8 });
      this.anims.set('guard_hit', { frames: await guardAnim('Hit', 16, 6), frameCount: 6, dirCount: 8 });
      this.anims.set('guard_death', { frames: await guardAnim('Death', 24, 10), frameCount: 10, dirCount: 8 });
    } catch (err) {
      console.warn('[SpriteLibrary] halberdier pack unavailable:', err);
    }

    // THE BIG PACK (it.25, exact path /assets/big pack 8 moves): per-frame
    // 148×130 PNGs named {seq}_{Anim}_CAM{0-7}_{frame}. Frame-audit: CAM0
    // faces WEST, cameras rotate 45°/step → CAM_FOR_DIR maps our canonical
    // [E,NE,N,NW,W,SW,S,SE]. Frames load directly (small — no rebake).
    // Integrated models: SkeletonWarrior1 (the Risen Blade's REAL bones),
    // SkeletonMage1 + Shaman7 (new casters), BaseAhoul (new ghast), and
    // MITHRAS the minotaur — the Tomb/Frost wardens' non-knight body.
    try {
      const BP = `${ROOT}/big pack 8 moves`;
      const CAM_FOR_DIR = [4, 3, 2, 1, 0, 7, 6, 5];
      const F = {
        idle: [20, 25, 35, 40],
        attack: [60, 62, 63, 65, 67, 70, 72, 74, 76, 78],
        cast: [140, 143, 146, 148, 151, 153, 155, 157, 158],
        walk: [180, 182, 184, 186, 188, 190, 192, 194, 196, 198, 200],
        run: [220, 222, 224, 226, 228, 230, 232, 234, 236, 238],
        death: [261, 262, 264, 265, 270, 273, 276, 280],
      };
      const camAnim = async (model: string, seqAnim: string, frameNums: number[]): Promise<Texture[][]> => {
        const urlOf = (cam: number, f: number) => encodeURI(`${BP}/${model}/${seqAnim}_CAM${cam}_${f}.png`);
        const urls: string[] = [];
        for (let cam = 0; cam < 8; cam++) for (const f of frameNums) urls.push(urlOf(cam, f));
        const loadedFrames = (await Assets.load(urls)) as Record<string, Texture>;
        return CAM_FOR_DIR.map((cam) => frameNums.map((f) => crisp(loadedFrames[urlOf(cam, f)])));
      };
      const reg = (name: AnimName, frames: Texture[][], fc: number): void => {
        this.anims.set(name, { frames, frameCount: fc, dirCount: 8 });
      };
      reg('skelw_idle', await camAnim('SkeletonWarrior1', '1_Idle', F.idle), F.idle.length);
      reg('skelw_run', await camAnim('SkeletonWarrior1', '6_Run', F.run), F.run.length);
      reg('skelw_attack', await camAnim('SkeletonWarrior1', '2_Attack', F.attack), F.attack.length);
      reg('skelw_death', await camAnim('SkeletonWarrior1', '7_Death', F.death), F.death.length);
      reg('skelm_idle', await camAnim('SkeletonMage1', '1_Idle', F.idle), F.idle.length);
      reg('skelm_walk', await camAnim('SkeletonMage1', '5_Walk', F.walk), F.walk.length);
      reg('skelm_cast', await camAnim('SkeletonMage1', '4_Cast', F.cast), F.cast.length);
      reg('skelm_death', await camAnim('SkeletonMage1', '7_Death', F.death), F.death.length);
      reg('shaman_idle', await camAnim('Shaman7', '1_Idle', F.idle), F.idle.length);
      reg('shaman_walk', await camAnim('Shaman7', '5_Walk', F.walk), F.walk.length);
      reg('shaman_cast', await camAnim('Shaman7', '4_Cast', F.cast), F.cast.length);
      reg('shaman_death', await camAnim('Shaman7', '7_Death', F.death), F.death.length);
      reg('ahoul_idle', await camAnim('BaseAhoul', '1_Idle', F.idle), F.idle.length);
      reg('ahoul_run', await camAnim('BaseAhoul', '6_Run', F.run), F.run.length);
      reg('ahoul_attack', await camAnim('BaseAhoul', '2_Attack', F.attack), F.attack.length);
      reg('ahoul_death', await camAnim('BaseAhoul', '7_Death', F.death), F.death.length);
      reg('mithras_idle', await camAnim('Mithras', '1_Idle', F.idle), F.idle.length);
      reg('mithras_walk', await camAnim('Mithras', '5_Walk', F.walk), F.walk.length);
      // It.27 INVISIBILITY FIX: Mithras's 2_Attack (and 3_Bow) PNGs are
      // BLANK 0.7 KB exports (all 8 cams) — the boss vanished for the whole
      // windup. His 4_Cast set is intact and reads as a poleaxe lunge, so
      // the Tomb Warden strikes with it instead.
      reg('mithras_attack', await camAnim('Mithras', '4_Cast', F.cast), F.cast.length);
      reg('mithras_death', await camAnim('Mithras', '7_Death', F.death), F.death.length);
      // It.26: the FROST WARDEN's own body — the robed wight (SkeletonWarrior4).
      reg('frost_idle', await camAnim('SkeletonWarrior4', '1_Idle', F.idle), F.idle.length);
      reg('frost_walk', await camAnim('SkeletonWarrior4', '5_Walk', F.walk), F.walk.length);
      reg('frost_attack', await camAnim('SkeletonWarrior4', '2_Attack', F.attack), F.attack.length);
      reg('frost_death', await camAnim('SkeletonWarrior4', '7_Death', F.death), F.death.length);
      // It.26: the Grave Guard mob — the shield-bearing SkeletonWarrior7.
      reg('grave_idle', await camAnim('SkeletonWarrior7', '1_Idle', F.idle), F.idle.length);
      reg('grave_run', await camAnim('SkeletonWarrior7', '6_Run', F.run), F.run.length);
      reg('grave_attack', await camAnim('SkeletonWarrior7', '2_Attack', F.attack), F.attack.length);
      reg('grave_death', await camAnim('SkeletonWarrior7', '7_Death', F.death), F.death.length);
      // It.30: the Hollow King's PHASE 2 war-form — SkeletonWarrior10, the
      // horned-helm armored knight (heaviest, most ornate skeleton in the
      // pack; size-audited: every anim healthy, 2_Attack included).
      reg('hollow2_idle', await camAnim('SkeletonWarrior10', '1_Idle', F.idle), F.idle.length);
      reg('hollow2_walk', await camAnim('SkeletonWarrior10', '5_Walk', F.walk), F.walk.length);
      reg('hollow2_attack', await camAnim('SkeletonWarrior10', '2_Attack', F.attack), F.attack.length);
      reg('hollow2_death', await camAnim('SkeletonWarrior10', '7_Death', F.death), F.death.length);
    } catch (err) {
      console.warn('[SpriteLibrary] big pack 8 moves unavailable:', err);
    }

    // NOTE (it.16): the Stairs pack was DELETED — every variant ASCENDS,
    // which contradicts a dungeon descent. The stairwell-down visual is the
    // procedural 'stairs_down' pit in AssetManager.

    // THE REAL STAIRCASE (it.18/19): the Infernus "Stairs_Inverted" — a
    // pre-rendered DESCENDING stairwell carved into a tile diamond, 64px =
    // exactly TILE_W. It.19: its cool grey stone is TONE-BAKED into the
    // warm floor palette on a canvas (per-pixel multiply), so it sits in
    // the floor grid seamlessly instead of popping bright.
    try {
      const stairsTex = (await Assets.load(`${ROOT}/Infernus_Tiles/Building_Infernus_1/Stairs_Inverted_1.png`)) as Texture;
      const cnv = document.createElement('canvas');
      cnv.width = stairsTex.width;
      cnv.height = stairsTex.height;
      const c2d = cnv.getContext('2d')!;
      c2d.drawImage(stairsTex.source.resource as CanvasImageSource, 0, 0);
      const px = c2d.getImageData(0, 0, cnv.width, cnv.height);
      for (let i = 0; i < px.data.length; i += 4) {
        px.data[i] = Math.round(px.data[i] * 0.62); // Warm-dark multiply:
        px.data[i + 1] = Math.round(px.data[i + 1] * 0.53); // matches the
        px.data[i + 2] = Math.round(px.data[i + 2] * 0.4); // stone floors.
      }
      c2d.putImageData(px, 0, 0);
      this.singles.set('stairs_inverted', Texture.from(cnv));
    } catch (err) {
      console.warn('[SpriteLibrary] inverted stairs unavailable:', err);
    }

    // Infernus candelabra (it.16 corrections): the sheet's 3×4 cells are
    // ROTATION POSES, not flame frames — cycling them spun the prop on its
    // axis. ONE cell is loaded as a STATIC texture; the prop's tile is
    // TILE_BLOCKED (real collision, Diablo brazier rule). The walk-through
    // clutter loads (altar/graves/bones/gore/dragon) are PURGED.
    try {
      const candleSheet = (await Assets.load(`${ROOT}/Infernus_Tiles/Anim_Infernus_Lightsources_1.png`)) as Texture;
      const cw = Math.floor(candleSheet.width / 3);
      const ch = Math.floor(candleSheet.height / 4);
      this.singles.set(
        'candelabra',
        new Texture({ source: candleSheet.source, frame: new Rectangle(0, 0, cw, ch) }),
      );
    } catch (err) {
      console.warn('[SpriteLibrary] candelabra unavailable:', err);
    }

    this.loaded = true;
  }

  anim(name: AnimName): LoadedAnim {
    const a = this.anims.get(name);
    if (!a) throw new Error(`[SpriteLibrary] Unknown animation: ${name}`);
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
}

/** Shared instance, loaded in main before world construction. */
export const spriteLib = new SpriteLibrary();
