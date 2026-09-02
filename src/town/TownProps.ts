/**
 * @module town/TownProps
 * Dresses the town layout (it.39): cottages, the stall, fences, trees,
 * pillars, barrels, the stash chest, animated campfire / torches / well,
 * flat decals. Everything standing was already planned as TILE_BLOCKED by
 * TownMap; this module only draws, lights and registers.
 *
 * Returns the OCCLUDERS (tall sprites that should cut away when the hero
 * walks behind them) and the INTERACTABLES (stash, merchant stall) with
 * their prompt labels.
 */

import { Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import type { Ambience } from '@/engine/Ambience';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import { spriteLib } from '@/render/SpriteLibrary';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';
import type { TownLayout, TownProp } from './TownMap';

export interface Occluder {
  sprite: Sprite;
  depth: number;
}

export interface Interactable {
  id: number;
  kind: 'stash' | 'merchant';
  x: number;
  y: number;
  label: string;
  /** Tiles that count as "close enough" (footprint). */
  tiles: Array<{ x: number; y: number }>;
}

export interface TownDressing {
  occluders: Occluder[];
  interactables: Interactable[];
  stashSprite: Sprite | null;
}

export function placeTownProps(layout: TownLayout, viewport: Viewport, lighting: Lighting, ambience: Ambience): TownDressing {
  const scratch = vec2();
  const occluders: Occluder[] = [];
  const interactables: Interactable[] = [];
  const hotspots: Array<{ x: number; y: number }> = [];
  let stashSprite: Sprite | null = null;
  const has = (name: string): boolean => spriteLib.loaded && spriteLib.hasSingle(name);

  /** A standing prop anchored at the south corner of its footprint. */
  const standing = (p: TownProp, single: string, anchorY: number, layer: 'object' | 'ground' = 'object'): Sprite | null => {
    if (!has(single)) return null;
    const w = p.w ?? 1;
    const h = p.h ?? 1;
    const spr = new Sprite(spriteLib.single(single));
    spr.anchor.set(0.5, anchorY);
    const cx = p.x + w / 2;
    const cy = p.y + h / 2;
    // Footprint diamond's south corner sits at (x + w, y + h); a 1×1 prop
    // stands on its tile centre.
    const s = w === 1 && h === 1 ? worldToScreen(cx, cy, scratch) : worldToScreen(p.x + w, p.y + h, scratch);
    spr.position.set(s.x, s.y + (w === 1 && h === 1 ? 4 : 0));
    spr.zIndex = depthKey(p.x + w - 0.5, p.y + h - 0.5);
    (layer === 'ground' ? viewport.groundLayer : viewport.objectLayer).addChild(spr);
    lighting.registerProp(Math.min(layout.map.width - 1, Math.floor(cx)), Math.min(layout.map.height - 1, Math.floor(cy)), spr);
    return spr;
  };

  /** A looping animated prop on one tile (campfire, torch, well). */
  const animated = (p: TownProp, anim: 'campfire' | 'torch' | 'well', fps: number, anchorY: number, scale = 1): Sprite | null => {
    if (!spriteLib.loaded || !spriteLib.hasAnim(anim)) return null;
    const frames = spriteLib.anim(anim).frames[0];
    const spr = new Sprite(frames[0]);
    spr.anchor.set(0.5, anchorY);
    spr.scale.set(scale);
    const s = worldToScreen(p.x + 0.5, p.y + 0.5, scratch);
    spr.position.set(s.x, s.y + 4);
    spr.zIndex = depthKey(p.x + 0.5, p.y + 0.5);
    viewport.objectLayer.addChild(spr);
    ambience.addLoopingAnim(spr, frames, fps, p.x, p.y);
    return spr;
  };

  const glowAt = (gx: number, gy: number, tint: number, alpha: number, scale: number, lift: number): void => {
    const g = new Sprite(assets.get('glow'));
    g.anchor.set(0.5);
    g.blendMode = 'add';
    g.tint = tint;
    const s = worldToScreen(gx + 0.5, gy + 0.5, scratch);
    g.position.set(s.x, s.y - lift);
    viewport.ambienceLayer.addChild(g);
    ambience.addGlow(g, gx, gy, alpha, scale);
  };

  let nextId = 1;
  for (const p of layout.props) {
    switch (p.kind) {
      case 'house': {
        const spr = standing(p, p.variant ?? 'house_a', 0.96);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex });
        break;
      }
      case 'stall': {
        const spr = standing(p, p.variant ?? 'stall_a', 0.94);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex });
        interactables.push({ id: nextId++, kind: 'merchant', x: layout.merchant.x + 0.5, y: layout.merchant.y + 0.5, label: 'E · TRADE', tiles: layout.merchant.tiles });
        break;
      }
      case 'stash': {
        stashSprite = standing(p, 'stash_closed', 0.82);
        interactables.push({ id: nextId++, kind: 'stash', x: p.x + 0.5, y: p.y + 0.5, label: 'E · STASH', tiles: [{ x: p.x, y: p.y }] });
        glowAt(p.x, p.y, 0xd8a85c, 0.35, 0.9, 10);
        break;
      }
      case 'campfire': {
        animated(p, 'campfire', 9, 0.92);
        glowAt(p.x, p.y, 0xff9040, 0.75, 2.6, 18);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 5.5, 255, 150, 60, 0.85);
        hotspots.push({ x: p.x + 0.5, y: p.y + 0.5 });
        break;
      }
      case 'torch': {
        animated(p, 'torch', 8, 0.92, 1.1);
        glowAt(p.x, p.y, 0xffb060, 0.5, 1.4, 30);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 3.4, 255, 170, 80, 0.55);
        hotspots.push({ x: p.x + 0.5, y: p.y + 0.5 });
        break;
      }
      case 'well':
        animated(p, 'well', 6, 0.9);
        break;
      case 'pillar':
        standing(p, 'pillar', 0.94);
        break;
      case 'fence':
        standing(p, 'fence', 0.9);
        break;
      case 'tree': {
        const spr = standing(p, p.variant ?? 'tree_a', 0.94);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex });
        break;
      }
      case 'barrel':
        standing(p, p.variant ?? 'barrel_a', 0.9);
        break;
      case 'crates':
        standing(p, 'crates', 0.9);
        break;
      case 'signpost':
        standing(p, 'signpost', 0.95);
        break;
      case 'hanging_sign':
        standing(p, 'hanging_sign', 0.95);
        break;
      case 'grassclump':
        standing(p, 'grassclump', 0.7, 'ground');
        break;
      case 'pots':
        standing(p, 'pots', 0.85);
        break;
      case 'merchant':
        break; // The shopkeeper is drawn by Villagers.
    }
  }
  ambience.setHotspots(hotspots);
  return { occluders, interactables, stashSprite };
}
