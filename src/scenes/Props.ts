/**
 * @module scenes/Props
 * Functional prop placement — the it.16 CLUTTER PURGE (classic ARPG rule).
 *
 * Every standing object here either HAS COLLISION or is flat ground paint:
 *  - Candelabra hearths stand on TILE_BLOCKED tiles (planned by
 *    `planHearths` BEFORE the scene/pathfinder build) — you cannot walk
 *    through them, exactly like classic ARPG's braziers.
 *  - Cracked-tile decals and gold piles are FLAT floor paint (walkable
 *    ground detail, like D1's floor debris).
 * PURGED (walk-through standing clutter): rubble piles, broken columns,
 * grave shards, gore/bone heaps, the stairs altar, the dragon skeleton.
 *
 * SUB-AGENT BOUNDARY: a new standing prop MUST reserve its tile through
 * the TILE_BLOCKED plan; flat decals go straight to groundLayer.
 */

import { Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import type { Ambience } from '@/engine/Ambience';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import { spriteLib } from '@/render/SpriteLibrary';
import { vec2 } from '@/utils/Vec2';
import { depthKey, worldToScreen } from '@/utils/iso';
import { mulberry32 } from '@/utils/rng';
import { TILE_FLOOR, type DungeonMap } from './DungeonGenerator';

/** A collectible gold pile on the floor (proximity pickup, it.22). */
export interface GoldPile {
  x: number;
  y: number;
  amount: number;
  sprite: Sprite;
  /** The additive treasure glow beneath the pile (it.26 visibility). */
  glow: Sprite;
  taken: boolean;
}

export function placeProps(
  map: DungeonMap,
  viewport: Viewport,
  lighting: Lighting,
  ambience: Ambience,
  hearths: ReadonlyArray<{ x: number; y: number }>,
): GoldPile[] {
  const rand = mulberry32(map.seed ^ 0xbeefcafe);
  const scratch = vec2();
  const hotspots: Array<{ x: number; y: number }> = [];
  const goldPiles: GoldPile[] = [];

  // Candelabra hearths: STATIC (single frame — the sheet's cells are
  // rotation poses, not animation; cycling them spun the prop, it.16 fix)
  // and SOLID (their tile is TILE_BLOCKED in the grid).
  for (const h of hearths) {
    const cx = h.x + 0.5;
    const cy = h.y + 0.5;
    if (spriteLib.loaded && spriteLib.hasSingle('candelabra')) {
      const lamp = new Sprite(spriteLib.single('candelabra'));
      lamp.anchor.set(0.4, 0.92);
      lamp.scale.set(0.85);
      const ls = worldToScreen(cx, cy, scratch);
      lamp.position.set(ls.x, ls.y + 4);
      lamp.zIndex = depthKey(cx, cy);
      viewport.objectLayer.addChild(lamp);
      lighting.registerProp(h.x, h.y, lamp);
    }
    lighting.addSource(cx, cy, 3.8, 235, 110, 24, 0.6);
    hotspots.push({ x: cx, y: cy });
  }

  for (let i = 1; i < map.rooms.length; i++) {
    const room = map.rooms[i];
    // NOTE (it.17): the crack-decal overlays were REMOVED — they read as
    // broken tile placement on deep floors. The stone floor variants carry
    // their own baked hairline cracks; that's all the wear the ground needs.

    // Gold piles: COLLECTIBLE treasure on the floor (it.22 — walk over to
    // scoop it up; the returned list drives main's proximity pickup).
    if (spriteLib.loaded && rand() < 0.3 && room.w >= 4 && room.h >= 4) {
      const gx = room.x + 1 + Math.floor(rand() * (room.w - 2));
      const gy = room.y + 1 + Math.floor(rand() * (room.h - 2));
      if (!isFloor(map, gx, gy)) continue;
      const gold = new Sprite(spriteLib.frame('gold_drop', 0, 0));
      gold.anchor.set(0.5, 0.52); // Pack registration: ground at frame center.
      const gs = worldToScreen(gx + 0.5, gy + 0.5, scratch);
      gold.position.set(gs.x, gs.y);
      gold.zIndex = depthKey(gx + 0.5, gy + 0.5);
      gold.scale.set(1.8);
      viewport.objectLayer.addChild(gold);
      ambience.addLoopingAnim(gold, spriteLib.anim('gold_drop').frames[0], 5, gx, gy, true);
      // It.26/37 VISIBILITY: a strong pulsing golden glow beneath the pile
      // (treasure mode above keeps the coins saturated + twinkling).
      const glow = new Sprite(assets.get('glow'));
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      glow.tint = 0xffc850;
      glow.position.set(gs.x, gs.y - 4);
      viewport.ambienceLayer.addChild(glow);
      ambience.addGlow(glow, gx, gy, 1.0, 1.35);
      goldPiles.push({ x: gx + 0.5, y: gy + 0.5, amount: 8 + Math.floor(rand() * 18), sprite: gold, glow, taken: false });
    }
  }

  ambience.setHotspots(hotspots);
  return goldPiles;
}

/** Bounds-safe floor test against the raw dungeon grid. */
function isFloor(map: DungeonMap, gx: number, gy: number): boolean {
  if (gx < 0 || gy < 0 || gx >= map.width || gy >= map.height) return false;
  return map.grid[gy * map.width + gx] === TILE_FLOOR;
}

/**
 * Place the glowing waystone near the dungeon entrance (floor 1 tutorial
 * anchor). Decorative, non-blocking; pulses with arcane light.
 */
export function placeWaystone(
  map: DungeonMap,
  viewport: Viewport,
  lighting: Lighting,
  ambience: Ambience,
): { x: number; y: number } {
  const gx = map.spawn.x + 2;
  const gy = map.spawn.y;
  const cx = gx + 0.5;
  const cy = gy + 0.5;
  const scratch = vec2();

  const stone = new Sprite(assets.get('waystone'));
  stone.anchor.set(0.5, 1.0);
  const s = worldToScreen(cx, cy, scratch);
  stone.position.set(s.x, s.y + 6);
  stone.zIndex = depthKey(cx, cy);
  viewport.objectLayer.addChild(stone);
  lighting.registerProp(gx, gy, stone);

  // Warm gold beacon — the lone arcane accent now sits inside the palette.
  const glow = new Sprite(assets.get('glow'));
  glow.anchor.set(0.5);
  glow.blendMode = 'add';
  glow.tint = 0xd8a85c;
  glow.position.set(s.x, s.y - 22);
  viewport.ambienceLayer.addChild(glow);
  ambience.addGlow(glow, gx, gy, 0.55, 0.9);

  lighting.addSource(cx, cy, 2.6, 200, 150, 70, 0.5);
  return { x: gx, y: gy };
}

/**
 * Place the stairs DOWN in the room farthest from the spawn and return its
 * tile. The tile stays walkable — stepping onto it triggers the descent.
 * It.16: the visual is a DESCENDING stairwell pit (steps sinking into
 * darkness), not an ascending block — this is a dungeon descent.
 */
export function placeStairs(
  map: DungeonMap,
  viewport: Viewport,
  lighting: Lighting,
  // It.28 arena support: pin the stair to a tile, and/or keep it HIDDEN
  // (unrendered + unregistered) until the arena is cleared — the caller
  // reveals it by flipping `renderable` and fog-registering the sprite.
  opts?: { at?: { x: number; y: number }; hidden?: boolean; /** Town gate: keep the flat stairwell under the archway (it.44). */ flat?: boolean },
): { x: number; y: number; sprite: Sprite } {
  let best = map.rooms[map.rooms.length - 1];
  let bestDist = -1;
  for (const room of map.rooms) {
    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2;
    const d = Math.hypot(cx - map.spawn.x, cy - map.spawn.y);
    if (d > bestDist) {
      bestDist = d;
      best = room;
    }
  }
  const gx = opts?.at?.x ?? best.x + Math.floor(best.w / 2);
  const gy = opts?.at?.y ?? best.y + Math.floor(best.h / 2);

  const s = worldToScreen(gx, gy, vec2());
  // The REAL pre-rendered descending stairwell (Infernus Stairs_Inverted,
  // 64×96: diamond opening on top, shaft sides descending below floor
  // level). Procedural pit is the fallback if the pack is absent.
  // STAIR MODEL (it.44): the isometric pack's stone spiral stands on the
  // tile as a real prop (depth-sorted); the old pit/stairwell is the fallback.
  const spiral = !opts?.flat && spriteLib.loaded && spriteLib.hasSingle('stairs_spiral');
  const sprite = spiral
    ? new Sprite(spriteLib.single('stairs_spiral'))
    : spriteLib.loaded && spriteLib.hasSingle('stairs_inverted')
      ? new Sprite(spriteLib.single('stairs_inverted'))
      : new Sprite(assets.get('stairs_down'));
  if (spiral) {
    sprite.anchor.set(0.5, 0.9);
    sprite.position.set(s.x, s.y + 12);
    sprite.zIndex = depthKey(gx + 0.5, gy + 0.5) - 6;
    viewport.objectLayer.addChild(sprite);
  } else {
    sprite.position.set(s.x - 32, s.y); // TILE_W/2 left offset, diamond-aligned.
    viewport.groundLayer.addChild(sprite);
  }
  if (opts?.hidden) {
    // Sealed arena: invisible AND fog-unregistered (fog toggles `visible`,
    // so the hide lives on `renderable` — the two never fight).
    sprite.renderable = false;
  } else {
    lighting.registerProp(gx, gy, sprite);
  }
  return { x: gx, y: gy, sprite };
}
