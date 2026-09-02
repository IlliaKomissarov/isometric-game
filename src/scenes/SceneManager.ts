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
 * Optimization: only wall tiles adjacent to at least one floor tile get a
 * sprite — interior solid rock is invisible by definition, which cuts wall
 * sprite count by ~60% on typical BSP layouts.
 */

import { Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { TILE_H, TILE_W } from '@/core/config';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import { vec2 } from '@/utils/Vec2';
import { depthKey, worldToScreen } from '@/utils/iso';
import { TILE_BLOCKED, TILE_FLOOR, TILE_WALL, type DungeonMap } from './DungeonGenerator';

export type FloorTheme = 'stone' | 'temple' | 'frost' | 'ember' | 'town';

const THEME_SUFFIX: Record<FloorTheme, string> = {
  stone: '',
  temple: '_deep',
  frost: '_frost',
  ember: '_ember',
  town: '',
};

export class SceneManager {
  private map!: DungeonMap;
  private readonly scratch = vec2();
  private themeSuffix = '';

  /** Build sprites into the viewport layers and register them for lighting. */
  build(map: DungeonMap, viewport: Viewport, lighting: Lighting, theme: FloorTheme = 'stone'): void {
    this.map = map;
    this.theme = theme;
    this.themeSuffix = THEME_SUFFIX[theme];
    const { width, height, grid } = map;

    for (let gy = 0; gy < height; gy++) {
      for (let gx = 0; gx < width; gx++) {
        const tile = grid[gy * width + gx];
        if (tile === TILE_FLOOR || tile === TILE_BLOCKED) {
          // Blocked-prop tiles (hearths) render floor UNDER the solid prop.
          this.addFloorSprite(gx, gy, viewport, lighting);
        } else if (this.bordersFloor(gx, gy)) {
          this.addWallSprite(gx, gy, viewport, lighting);
        }
      }
    }
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
    return grid[gy * width + gx] === TILE_WALL;
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

  private addFloorSprite(gx: number, gy: number, viewport: Viewport, lighting: Lighting): void {
    // Variant chosen deterministically from tile coords (stable across peers).
    const variant = (gx * 7 + gy * 13) % assets.floorVariants;
    // TOWN (it.39): the map's tileKind layer paints cobble / grass / dirt.
    const kinds = (this.map as { tileKind?: Uint8Array }).tileKind;
    const key =
      this.theme === 'town' && kinds
        ? `floor_town_${kinds[gy * this.map.width + gx]}`
        : `floor_${variant}${this.themeSuffix}`;
    const sprite = new Sprite(assets.get(key));
    const s = worldToScreen(gx, gy, this.scratch);
    sprite.position.set(s.x - TILE_W / 2, s.y);
    viewport.groundLayer.addChild(sprite);
    lighting.registerFloor(gx, gy, sprite);
  }

  private addWallSprite(gx: number, gy: number, viewport: Viewport, lighting: Lighting): void {
    const sprite = new Sprite(assets.get(`wall${this.themeSuffix}`));
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
}
