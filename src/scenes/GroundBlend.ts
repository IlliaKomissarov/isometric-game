/**
 * @module scenes/GroundBlend
 * THE GROUND BLEND (it.115) — soft, ragged edges where one ground kind meets
 * another on the outdoor floors.
 *
 * A ground kind is painted a whole 64x32 diamond at a time, so a patch of moss
 * laid into grass is a STAIRCASE of hard diamonds, and a patch of anything read
 * as a chequer the moment it was more than one tile wide (the owner's "just
 * green grass and a road", and the reason it.114's overworld kinds were never
 * switched on). The pack has no transition tiles to fix that with.
 *
 * `scripts/bake-buildings.py` bakes them instead: `ow_blend` is one atlas, a row
 * per (source kind, variant) and a column per neighbour direction, each cell
 * the source's own diamond under a noise-feathered alpha - opaque on the edge
 * (or corner) it shares with that neighbour and gone about half a tile in. This
 * lays those cells: every floor tile wears one for each neighbour of a HIGHER
 * rank, in rank order, so a patch spills a ragged fringe over whatever lies
 * below it and the diamond edge disappears under its own material.
 *
 * WHERE. Only on a map that carries an overworld kind (15 and up): the forest,
 * the farmlands and the riverside. The town and the inn never do, so their
 * ground is untouched (the owner's it.113 rule), and the battlefield keeps its
 * own `field_*` kinds exactly as they are. On those floors the road's dirt and
 * the shore's sand blend too - the same staircase, and the riverside's shore
 * was a chequer of it.
 *
 * LIGHT. Each overlay is registered as a PROP of the tile it lies on, and a prop
 * with no shade takes exactly its tile's floor tint, so the overlay is lit and
 * fogged with the ground under it.
 */

import { Rectangle, Sprite, Texture } from 'pixi.js';
import { TILE_W } from '@/core/config';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import { spriteLib } from '@/render/SpriteLibrary';
import { worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';
import { TILE_BLOCKED, TILE_DOOR, TILE_FLOOR, type DungeonMap } from './DungeonGenerator';

/** The atlas: 66x34 cells (the 64x32 diamond at (1, 1)), 8 columns, 4 rows per source. */
const ATLAS = 'ow_blend';
const CELL_W = 66;
const CELL_H = 34;
const VARIANTS = 4;
/** First kind index that marks a map as an overworld floor (`KIND_OW_FOREST`). */
const FIRST_OW_KIND = 15;

/**
 * Kind -> [rank, atlas source row group]. Rank orders who spills over whom; a
 * kind not listed is rank 0 (grass, cobble, the farm's ash) and is never a
 * source.
 * The source order is the bake's `BLEND_SOURCES`.
 */
const SOURCES: ReadonlyMap<number, readonly [rank: number, source: number]> = new Map([
  [2, [1, 0]], // KIND_DIRT - the road
  [3, [2, 1]], // KIND_SAND - the shore
  [18, [3, 2]], // KIND_OW_MUD
  [17, [4, 3]], // KIND_OW_GRAVEL
  [15, [5, 4]], // KIND_OW_FOREST - leaf litter
  [16, [6, 5]], // KIND_OW_MOSS
  [19, [7, 6]], // KIND_OW_MEADOW
  [20, [8, 7]], // KIND_OW_FLOWERS
  [21, [9, 8]], // KIND_OW_POPPIES
]);
/** THE RIVER (9) is a host for one thing only: the shore's sand, feathered out over the shallows. */
const KIND_WATER = 9;
const KIND_SAND = 3;

/**
 * The neighbour directions, as world offsets, in the atlas's column order: the
 * four edges, then the four corners (the bake's `BLEND_DIRS`).
 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

let sliced: { source: Texture; cells: Texture[] } | null = null;

/** The atlas cut into its cells, once per resident atlas texture. */
function cells(): Texture[] | null {
  if (!spriteLib.loaded || !spriteLib.hasSingle(ATLAS)) return null;
  const source = spriteLib.single(ATLAS);
  if (sliced?.source === source) return sliced.cells;
  const out: Texture[] = [];
  const rows = Math.floor(source.height / CELL_H);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < DIRS.length; c++)
      out.push(new Texture({ source: source.source, frame: new Rectangle(source.frame.x + c * CELL_W + 1, source.frame.y + r * CELL_H + 1, CELL_W - 2, CELL_H - 2) }));
  sliced = { source, cells: out };
  return out;
}

/** True when `map` is an overworld floor this pass applies to. */
function isOverworld(kinds: Uint8Array): boolean {
  for (let i = 0; i < kinds.length; i++) if (kinds[i] >= FIRST_OW_KIND) return true;
  return false;
}

/**
 * Lay the blend overlays for `map` into the ground layer, above every floor
 * sprite already there. Returns how many were laid (0 on a floor it does not
 * apply to, or when the atlas is not resident).
 */
export function layGroundBlend(map: DungeonMap, viewport: Viewport, lighting: Lighting): number {
  const kinds = (map as { tileKind?: Uint8Array }).tileKind;
  if (!kinds || !isOverworld(kinds)) return 0;
  const tex = cells();
  if (!tex) return 0;
  const { width, height, grid } = map;
  const drawn = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const t = grid[y * width + x];
    return t === TILE_FLOOR || t === TILE_BLOCKED || t === TILE_DOOR;
  };
  const scratch = vec2();
  const layers: Array<{ rank: number; cell: number }> = [];
  let laid = 0;
  for (let gy = 0; gy < height; gy++) {
    for (let gx = 0; gx < width; gx++) {
      if (!drawn(gx, gy)) continue;
      const own = kinds[gy * width + gx];
      const ownRank = own === KIND_WATER ? -1 : (SOURCES.get(own)?.[0] ?? 0);
      layers.length = 0;
      for (let d = 0; d < DIRS.length; d++) {
        const nx = gx + DIRS[d][0];
        const ny = gy + DIRS[d][1];
        if (!drawn(nx, ny)) continue;
        const src = SOURCES.get(kinds[ny * width + nx]);
        if (!src || src[0] <= ownRank) continue;
        if (own === KIND_WATER && kinds[ny * width + nx] !== KIND_SAND) continue;
        // The neighbour's own variant, picked as `SceneManager` picks it, so the
        // spill continues the diamond it came from.
        const variant = (nx * 5 + ny * 11) % VARIANTS;
        layers.push({ rank: src[0], cell: (src[1] * VARIANTS + variant) * DIRS.length + d });
      }
      if (!layers.length) continue;
      // Lower ranks first: a moss fringe lies over a mud fringe on the same tile.
      layers.sort((a, b) => a.rank - b.rank);
      const s = worldToScreen(gx, gy, scratch);
      for (const l of layers) {
        const t = tex[l.cell];
        if (!t) continue;
        const sprite = new Sprite(t);
        sprite.position.set(s.x - TILE_W / 2, s.y);
        viewport.groundLayer.addChild(sprite);
        lighting.registerProp(gx, gy, sprite);
        laid++;
      }
    }
  }
  return laid;
}
