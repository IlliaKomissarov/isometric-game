/**
 * @module scenes/SceneManager
 * Builds the renderable scene from dungeon data and answers spatial queries.
 *
 * Responsibilities:
 *  - Instantiate floor/wall sprites into the correct viewport layers and
 *    register each with the Lighting grid (which tints them per frame).
 *  - Expose `isWalkable` / `isOpaque` — the single source of truth used by
 *    pathfinding, collision, and lighting (never duplicate these checks).
 *
 * THE CRYPT IN TILESET STONE (it.115). On the four crypt themes the floors
 * are the baked `dun_<theme>_0..3` diamonds and the walls are 128x256 tileset
 * runs (`dun_<theme>_wall_n/_w`, arches, doors, corners, pillars) planned by
 * `planWallPieces` and seated exactly as the inn's `innwall` props are. The
 * procedural cubes and diamonds (`AssetManager.buildStoneEnvironment`) stay as
 * the fallback for when the singles are not resident, and for the town ring.
 *
 * Optimization (fallback only): only wall tiles adjacent to at least one floor
 * tile get a cube — interior solid rock is invisible by definition.
 */

import { Sprite, type Texture } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { TILE_H, TILE_W } from '@/core/config';
import type { Ambience } from '@/engine/Ambience';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import { spriteLib, type AnimName } from '@/render/SpriteLibrary';
import { mulberry32 } from '@/utils/rng';
import { vec2 } from '@/utils/Vec2';
import { depthKey, worldToScreen } from '@/utils/iso';
import { TILE_BLOCKED, TILE_DOOR, TILE_FLOOR, TILE_WALL, planWallPieces, type DungeonMap, type TorchSpot, type WallPiece } from './DungeonGenerator';

export type FloorTheme = 'stone' | 'temple' | 'frost' | 'ember' | 'town' | 'inn' | 'cellar';

const THEME_SUFFIX: Record<FloorTheme, string> = {
  stone: '',
  temple: '_deep',
  frost: '_frost',
  ember: '_ember',
  town: '',
  inn: '', // THE GILDED STAG (it.96): the inn draws no wall cubes at all - its walls are tileset pieces (`wallsFromProps`).
  cellar: '', // THE CELLAR (it.97): the same - dark stone pieces, no cubes.
};

/** The themes the baked crypt kit covers (it.115). */
const KIT_THEMES: ReadonlySet<FloorTheme> = new Set<FloorTheme>(['stone', 'temple', 'frost', 'ember']);

/** Every wall piece is 128x256 with its painted bottom-left at (0, 256). */
const PIECE_H = 256;
/** Dried-blood tiles per floor tile on the deeper bands (it.115): between the 3% and 6% asked for. */
const BLOOD_RATE = 0.045;
/** Every sixth wall piece on a room wall carries a torch bracket. */
const TORCH_EVERY = 6;
/** How far above the wall's base the flame hangs. */
const TORCH_LIFT = 60;

export class SceneManager {
  private map!: DungeonMap;
  private readonly scratch = vec2();
  private themeSuffix = '';
  /**
   * The torch brackets the last build planned (it.115) - also written onto the
   * map as `torchSpots`. `placeTorches` hangs the flames on them.
   */
  torchSpots: TorchSpot[] = [];

  /**
   * Build sprites into the viewport layers and register them for lighting.
   *
   * `onFloor` (it.106) hands each ground sprite back as it is made, so a floor
   * that animates its own ground - the riverside's water - can keep the sprites
   * it needs without this module knowing anything about rivers. Lighting still
   * owns their tint; the caller owns only their texture.
   */
  build(map: DungeonMap, viewport: Viewport, lighting: Lighting, theme: FloorTheme = 'stone', onFloor?: (gx: number, gy: number, sprite: Sprite) => void): void {
    this.map = map;
    this.theme = theme;
    this.themeSuffix = THEME_SUFFIX[theme];
    this.torchSpots = [];
    const { width, height, grid } = map;

    // THE KIT (it.115): floors and walls are checked separately, so a bake
    // that shipped only one of them still gets used for that one.
    const kit = KIT_THEMES.has(theme) && spriteLib.loaded;
    const kitFloors = kit && spriteLib.hasSingle(`dun_${theme}_0`);
    const kitWalls = kit && spriteLib.hasSingle(`dun_${theme}_wall_n`) && spriteLib.hasSingle(`dun_${theme}_wall_w`);
    const accents = kitFloors ? this.planAccents(map, theme) : null;
    const wallsFromProps = !!(map as { wallsFromProps?: boolean }).wallsFromProps;

    for (let gy = 0; gy < height; gy++) {
      for (let gx = 0; gx < width; gx++) {
        const tile = grid[gy * width + gx];
        if (tile === TILE_FLOOR || tile === TILE_BLOCKED || tile === TILE_DOOR) {
          // Blocked-prop tiles (hearths) render floor UNDER the solid prop.
          const accent = accents?.get(gy * width + gx);
          this.addFloorSprite(gx, gy, viewport, lighting, onFloor, accent ?? (kitFloors ? `dun_${theme}_${(gx * 5 + gy * 11) % 4}` : undefined));
        } else if (!kitWalls && !wallsFromProps && this.bordersFloor(gx, gy)) {
          // THE GILDED STAG (it.96): the inn's walls are tileset pieces the dresser places, not cubes.
          this.addWallSprite(gx, gy, viewport, lighting);
        }
      }
    }
    if (kitWalls && !wallsFromProps) this.buildTilesetWalls(map, viewport, lighting, theme);
    map.torchSpots = this.torchSpots;
  }

  /** True when the tile can be stood on / pathed through. */
  isWalkable = (gx: number, gy: number): boolean => {
    const { width, height, grid } = this.map;
    if (gx < 0 || gy < 0 || gx >= width || gy >= height) return false;
    return grid[gy * width + gx] === TILE_FLOOR;
  };

  /** True when the tile blocks line of sight. Solid props DON'T block sight
   *  or light — only true architecture (walls) does. */
  isOpaque = (gx: number, gy: number): boolean => {
    const { width, height, grid } = this.map;
    if (gx < 0 || gy < 0 || gx >= width || gy >= height) return true;
    const t = grid[gy * width + gx];
    return t === TILE_WALL || t === TILE_DOOR; // A shut gate blocks sight too (it.85).
  };

  get dungeon(): DungeonMap {
    return this.map;
  }

  private bordersFloor(gx: number, gy: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!this.isOpaque(gx + dx, gy + dy)) return true;
      }
    }
    return false;
  }

  private theme: FloorTheme = 'stone';

  /**
   * THE FLOOR'S ACCENTS (it.115), seeded from the dungeon so peers agree: dried
   * blood on 3-6% of the tiles past the first band, and one pentagram block in
   * a big room on the temple and ember depths. Returns tile index -> single.
   */
  private planAccents(map: DungeonMap, theme: FloorTheme): Map<number, string> | null {
    const rand = mulberry32(map.seed ^ 0x5eed17);
    const { width, height, grid, rooms } = map;
    const out = new Map<number, string>();
    if ((theme === 'temple' || theme === 'ember') && spriteLib.hasSingle('dun_pent_0')) {
      // A big room that is not the spawn room; a 2x2 block of plain floor in it,
      // inset from the walls and off the centre (stairs and waystones sit there).
      const big = rooms.filter((r, i) => i > 0 && r.w >= 6 && r.h >= 6);
      if (big.length) {
        const room = big[Math.floor(rand() * big.length)];
        const cx = room.x + room.w / 2;
        const cy = room.y + room.h / 2;
        for (let attempt = 0; attempt < 12; attempt++) {
          const bx = room.x + 1 + Math.floor(rand() * (room.w - 3));
          const by = room.y + 1 + Math.floor(rand() * (room.h - 3));
          if (Math.abs(bx + 1 - cx) < 2 && Math.abs(by + 1 - cy) < 2) continue;
          let clear = true;
          for (let y = by; y < by + 2 && clear; y++) for (let x = bx; x < bx + 2; x++) if (grid[y * width + x] !== TILE_FLOOR) clear = false;
          if (!clear) continue;
          for (let y = by; y < by + 2; y++) for (let x = bx; x < bx + 2; x++) out.set(y * width + x, `dun_pent_${(x & 1) + 2 * (y & 1)}`);
          break;
        }
      }
    }
    if (theme !== 'stone' && spriteLib.hasSingle('dun_blood_0')) {
      for (let gy = 0; gy < height; gy++) {
        for (let gx = 0; gx < width; gx++) {
          const idx = gy * width + gx;
          if (grid[idx] === TILE_WALL) continue;
          if (rand() < BLOOD_RATE && !out.has(idx)) out.set(idx, `dun_blood_${(gx * 5 + gy * 11) % 4}`);
        }
      }
    }
    return out.size ? out : null;
  }

  private addFloorSprite(gx: number, gy: number, viewport: Viewport, lighting: Lighting, onFloor?: (gx: number, gy: number, sprite: Sprite) => void, single?: string): void {
    // Variant chosen deterministically from tile coords (stable across peers).
    const variant = (gx * 7 + gy * 13) % assets.floorVariants;
    // TOWN (it.39): the map's tileKind layer paints cobble / grass / dirt.
    const kinds = (this.map as { tileKind?: Uint8Array }).tileKind;
    // TERRAIN VARIANTS (it.56): four diamonds per ground kind, picked by tile
    // coords, so no two neighbours repeat and no field reads as a flat block.
    const kind = kinds ? kinds[gy * this.map.width + gx] : 0;
    // THE GILDED STAG (it.96): its boards run over 2x2 blocks, so the quadrant is picked by parity.
    const townVariant = `floor_town_${kind}_${this.theme === 'inn' || this.theme === 'cellar' ? (gx & 1) + 2 * (gy & 1) : (gx * 5 + gy * 11) % 4}`;
    const key =
      (this.theme === 'town' || this.theme === 'inn' || this.theme === 'cellar') && kinds
        ? assets.has(townVariant)
          ? townVariant
          : `floor_town_${kind}`
        : `floor_${variant}${this.themeSuffix}`;
    // THE CRYPT'S BAKED FLOORS (it.115): a tileset single when the kit is in; pre-graded, so no tint.
    const texture: Texture = single ? spriteLib.single(single) : assets.get(key);
    const sprite = new Sprite(texture);
    const s = worldToScreen(gx, gy, this.scratch);
    sprite.position.set(s.x - TILE_W / 2, s.y);
    viewport.groundLayer.addChild(sprite);
    lighting.registerFloor(gx, gy, sprite);
    onFloor?.(gx, gy, sprite);
  }

  private addWallSprite(gx: number, gy: number, viewport: Viewport, lighting: Lighting): void {
    const sprite = new Sprite(assets.get(`wall${this.themeSuffix}`));
    // TOWN (it.40): the ring wall reads as mossy rock cliffs behind the tree line.
    if (this.theme === 'town') sprite.tint = 0x56614f; // Grim (it.57): damp, mossy, deep in shadow.
    if (this.theme === 'inn') sprite.tint = 0xf2e6d2; // THE GILDED STAG (it.95): plaster in lamplight.
    const s = worldToScreen(gx, gy, this.scratch);
    // Wall texture is TILE_H + WALL_Z tall; its base diamond must align with
    // the floor grid, so the sprite is raised by WALL_Z.
    sprite.position.set(s.x - TILE_W / 2, s.y - (sprite.height - TILE_H));
    // Sort by the tile's far corner, nudged back so entities standing on the
    // adjacent southern tile (equal depth) always draw in front of the wall.
    sprite.zIndex = depthKey(gx + 1, gy + 1) - 4;
    viewport.objectLayer.addChild(sprite);
    lighting.registerWall(gx, gy, sprite);
  }

  // ---- THE TILESET WALLS (it.115) --------------------------------------------

  /**
   * Seat every planned piece the way `TownProps` seats an `innwall`: the image's
   * bottom-left on the 2x2 block's bounding-box bottom-left, where the block is
   * (x, y-1) for a north piece and (x-1, y) for a west piece, (x, y) being the
   * piece's first wall tile. Sorted by `depthKey(x, y+1) + 4` for both sides -
   * strictly between the tiles behind the piece and the floor in front of it
   * (it.97), so the hero on the tile in front always draws over it. Registered
   * as WALLS at their first tile, so Lighting lights them from the floor they
   * face (the wall tint path takes the brighter of the south and east floors)
   * and fogs them as it fogged the cubes.
   */
  private buildTilesetWalls(map: DungeonMap, viewport: Viewport, lighting: Lighting, theme: FloorTheme): void {
    const plan = planWallPieces(map);
    const { width, height } = map;
    const taken = new Uint8Array(width * height);
    const rand = mulberry32(map.seed ^ 0x70c4);
    const torchPhase = Math.floor(rand() * TORCH_EVERY);
    let roomPieces = 0;

    const seat = (piece: WallPiece): Sprite | null => {
      const name = `dun_${theme}_${piece.kind === 'corner' ? 'corner' : `${piece.kind}_${piece.side}`}`;
      const single = spriteLib.hasSingle(name) ? name : `dun_${theme}_wall_${piece.side}`;
      if (!spriteLib.hasSingle(single)) return null;
      const sprite = new Sprite(spriteLib.single(single));
      const bx = piece.side === 'n' ? piece.x : piece.x - 1;
      const by = piece.side === 'n' ? piece.y - 1 : piece.y;
      const s0 = worldToScreen(bx, by, this.scratch);
      sprite.position.set(s0.x - TILE_W, s0.y + TILE_H * 2 - PIECE_H);
      sprite.zIndex = depthKey(piece.x, piece.y + 1) + 4;
      viewport.objectLayer.addChild(sprite);
      // One wall sprite per tile in Lighting: the first tile, else the second.
      const second = piece.side === 'n' ? { x: piece.x + 1, y: piece.y } : { x: piece.x, y: piece.y + 1 };
      const slot = !taken[piece.y * width + piece.x] ? piece : !taken[second.y * width + second.x] ? second : null;
      if (slot) {
        taken[slot.y * width + slot.x] = 1;
        lighting.registerWall(slot.x, slot.y, sprite);
      } else {
        // Both tiles spoken for (a lean-over on a busy stub): lit as a prop from the floor it faces.
        const faced = piece.side === 'n' ? { x: piece.x, y: piece.y + 1 } : { x: piece.x + 1, y: piece.y };
        lighting.registerProp(Math.min(width - 1, faced.x), Math.min(height - 1, faced.y), sprite);
      }
      return sprite;
    };

    for (const piece of plan.pieces) {
      const sprite = seat(piece);
      if (!sprite || piece.kind !== 'wall' || !piece.room) continue;
      if (roomPieces++ % TORCH_EVERY !== torchPhase) continue;
      const faced = piece.side === 'n' ? { x: piece.x, y: piece.y + 1 } : { x: piece.x + 1, y: piece.y };
      this.torchSpots.push({ side: piece.side, x: piece.x, y: piece.y, gx: faced.x, gy: faced.y, zIndex: sprite.zIndex });
    }

    // Free-standing pillars: a 1x1 standing piece on its tile centre, sorted
    // like any standing prop, lit and fogged as a wall tile.
    const pillarName = `dun_${theme}_pillar`;
    if (spriteLib.hasSingle(pillarName)) {
      for (const p of plan.pillars) {
        const sprite = new Sprite(spriteLib.single(pillarName));
        sprite.anchor.set(0.5, 1);
        const s = worldToScreen(p.x + 0.5, p.y + 0.5, this.scratch);
        sprite.position.set(s.x, s.y + 4);
        sprite.zIndex = depthKey(p.x + 0.5, p.y + 0.5);
        viewport.objectLayer.addChild(sprite);
        lighting.registerWall(p.x, p.y, sprite);
      }
    }
  }

  /**
   * Hang the flames (it.115): an animated `dun_torch_n/_w` on every planned
   * bracket, lifted `TORCH_LIFT` px up the face, and a warm baked light on the
   * floor it faces. The torch atlases are NOT resident at boot - the caller
   * awaits `spriteLib.ensure(['dun_torch_n', 'dun_torch_w'])` first; without
   * them this is a no-op. Ambience drives the frames and the fog gate.
   */
  placeTorches(viewport: Viewport, lighting: Lighting, ambience: Ambience): number {
    if (!spriteLib.hasAnim('dun_torch_n') || !spriteLib.hasAnim('dun_torch_w')) return 0;
    let placed = 0;
    for (const t of this.torchSpots) {
      const frames = spriteLib.anim(`dun_torch_${t.side}` as AnimName).frames[0];
      const sprite = new Sprite(frames[0]);
      sprite.anchor.set(0.5, 0);
      // The bracket: the midpoint of the face's base on the piece's first tile.
      const s = t.side === 'n' ? worldToScreen(t.x + 0.5, t.y + 1, this.scratch) : worldToScreen(t.x + 1, t.y + 0.5, this.scratch);
      sprite.position.set(s.x, s.y - TORCH_LIFT);
      sprite.zIndex = t.zIndex + 1;
      viewport.objectLayer.addChild(sprite);
      ambience.addLoopingAnim(sprite, frames, 8, t.gx, t.gy);
      // The light sits just inside the floor the flame faces.
      const lx = t.side === 'n' ? t.x + 0.5 : t.x + 1.3;
      const ly = t.side === 'n' ? t.y + 1.3 : t.y + 0.5;
      lighting.addSource(lx, ly, 3.4, 255, 170, 80, 0.55);
      placed++;
    }
    return placed;
  }
}
