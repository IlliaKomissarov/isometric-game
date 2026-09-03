/**
 * @module town/TownProps
 * Dresses the town layout (it.39 / it.40): cottages, stalls, fences,
 * trees, pillars, barrels, the stash chest, animated campfire / torches /
 * braziers, the dungeon-gate ARCHWAY with its drifting fog, flat decals.
 * Everything standing was already planned as TILE_BLOCKED by TownMap;
 * this module only draws, lights and registers.
 *
 * Returns the OCCLUDERS (tall sprites that cut away when the hero walks
 * behind — or inside — them), the INTERACTABLES (stash, merchant stall),
 * and an `update(dt)` for the render-side fog drift at the gate.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
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
  /** Blocked footprint (tiles) — standing inside it means "indoors". */
  tiles: { x: number; y: number; w: number; h: number };
}

export interface Interactable {
  id: number;
  kind: 'stash' | 'merchant' | 'alchemist' | 'board';
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
  /** Render-frame update: gate fog drift, brazier flicker. */
  update: (dt: number) => void;
  destroy: () => void;
}

export function placeTownProps(layout: TownLayout, viewport: Viewport, lighting: Lighting, ambience: Ambience): TownDressing {
  const scratch = vec2();
  const occluders: Occluder[] = [];
  const interactables: Interactable[] = [];
  const hotspots: Array<{ x: number; y: number }> = [];
  const fog: Array<{ sprite: Sprite; x: number; y: number; phase: number; speed: number }> = [];
  let stashSprite: Sprite | null = null;
  const has = (name: string): boolean => spriteLib.loaded && spriteLib.hasSingle(name);

  /** A standing prop anchored at the south corner of its footprint. */
  const standing = (p: TownProp, single: string, anchorY: number, layer: 'object' | 'ground' = 'object', anchorX = 0.5): Sprite | null => {
    if (!has(single)) return null;
    const w = p.w ?? 1;
    const h = p.h ?? 1;
    const spr = new Sprite(spriteLib.single(single));
    spr.anchor.set(anchorX, anchorY);
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

  /** A looping animated prop on one tile (campfire, torch, brazier flame). */
  const animated = (
    gx: number,
    gy: number,
    anim: 'campfire' | 'torch',
    fps: number,
    anchorY: number,
    scale = 1,
    lift = 0,
  ): Sprite | null => {
    if (!spriteLib.loaded || !spriteLib.hasAnim(anim)) return null;
    const frames = spriteLib.anim(anim).frames[0];
    const spr = new Sprite(frames[0]);
    spr.anchor.set(0.5, anchorY);
    spr.scale.set(scale);
    const s = worldToScreen(gx + 0.5, gy + 0.5, scratch);
    spr.position.set(s.x, s.y + 4 - lift);
    spr.zIndex = depthKey(gx + 0.5, gy + 0.5) + 1;
    viewport.objectLayer.addChild(spr);
    ambience.addLoopingAnim(spr, frames, fps, gx, gy);
    return spr;
  };

  const glowAt = (gx: number, gy: number, tint: number, alpha: number, scale: number, lift: number): Sprite => {
    const g = new Sprite(assets.get('glow'));
    g.anchor.set(0.5);
    g.blendMode = 'add';
    g.tint = tint;
    const s = worldToScreen(gx + 0.5, gy + 0.5, scratch);
    g.position.set(s.x, s.y - lift);
    viewport.ambienceLayer.addChild(g);
    ambience.addGlow(g, gx, gy, alpha, scale);
    return g;
  };

  const footprint = (p: TownProp): Occluder['tiles'] => ({ x: p.x, y: p.y, w: p.w ?? 1, h: p.h ?? 1 });

  /**
   * THE DUNGEON GATE (it.43): the ruin archway sprite stands on its 3×2
   * footprint; cold light and drifting fog roll out of its throat.
   */
  const gateFog = (p: TownProp): void => {
    // The fog and its cold light hang in the opening, just outside the threshold.
    const ox = layout.gate.x + 1;
    const oy = layout.gate.y + 0.5;
    const base = worldToScreen(ox, oy, vec2());
    for (let i = 0; i < 5; i++) {
      const f = new Sprite(assets.get('glow'));
      f.anchor.set(0.5);
      f.tint = 0x6f7fa8;
      f.alpha = 0.16;
      f.scale.set(1.6 + i * 0.25, 0.8 + i * 0.1);
      f.zIndex = depthKey(p.x + (p.w ?? 1), p.y + 0.5) + 4;
      viewport.objectLayer.addChild(f);
      lighting.registerProp(Math.floor(ox), Math.floor(oy), f);
      fog.push({ sprite: f, x: base.x + (i - 2) * 10, y: base.y - 26 - i * 4, phase: i * 1.3, speed: 0.35 + i * 0.07 });
    }
    lighting.addSource(ox, oy, 3.6, 110, 130, 200, 0.55);
    glowAt(ox, oy, 0x5060a0, 0.35, 1.6, 30);
  };

  /**
   * TEXT PLATES (it.49): a dark, gold-rimmed nameplate hovering over every
   * landmark — stash, stalls, the records board, the camp, the gate — so
   * the town reads at a glance. Drawn last in the object layer, bobbing.
   */
  const plates: Array<{ node: Container; baseY: number; phase: number }> = [];
  const plate = (x: number, y: number, label: string, lift: number): void => {
    const node = new Container();
    const text = new Text({
      text: label,
      style: {
        fontFamily: 'Darinia, Cinzel, Georgia, serif',
        fontSize: 11,
        letterSpacing: 2,
        fill: 0xf0d48a,
        stroke: { color: 0x0a0806, width: 3 },
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 2, distance: 2, angle: Math.PI / 2 },
      },
      resolution: 2,
    });
    text.anchor.set(0.5);
    const w = text.width + 22;
    const h = text.height + 10;
    const bg = new Graphics();
    bg.roundRect(-w / 2, -h / 2, w, h, 3).fill({ color: 0x0b0910, alpha: 0.82 }).stroke({ width: 1, color: 0xc8a558, alpha: 0.75 });
    bg.moveTo(-w / 2 - 6, 0).lineTo(-w / 2, 0).stroke({ width: 1, color: 0xc8a558, alpha: 0.6 });
    bg.moveTo(w / 2, 0).lineTo(w / 2 + 6, 0).stroke({ width: 1, color: 0xc8a558, alpha: 0.6 });
    node.addChild(bg, text);
    const s = worldToScreen(x + 0.5, y + 0.5, scratch);
    node.position.set(s.x, s.y - lift);
    node.zIndex = 1e6 + plates.length; // Above every roof and body.
    viewport.objectLayer.addChild(node);
    plates.push({ node, baseY: s.y - lift, phase: plates.length * 1.7 });
  };

  let nextId = 1;
  for (const p of layout.props) {
    switch (p.kind) {
      case 'house': {
        const spr = standing(p, p.variant ?? 'house_a', 0.96);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p) });
        break;
      }
      case 'stall': {
        const spr = standing(p, p.variant ?? 'stall_a', 0.94);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p) });
        // Vendors by POSITION (it.48): the armorer's and the alchemist's stalls.
        if (layout.merchant.tiles.some((t) => t.x === p.x && t.y === p.y)) {
          interactables.push({ id: nextId++, kind: 'merchant', x: layout.merchant.x + 0.5, y: layout.merchant.y + 0.5, label: 'E · ARMORER', tiles: layout.merchant.tiles });
          plate(p.x + 1, p.y, 'THE ARMORER', 112);
        } else if (layout.alchemist.tiles.some((t) => t.x === p.x && t.y === p.y)) {
          interactables.push({ id: nextId++, kind: 'alchemist', x: layout.alchemist.x + 0.5, y: layout.alchemist.y + 0.5, label: 'E · ALCHEMIST', tiles: layout.alchemist.tiles });
          plate(p.x + 1, p.y, 'THE ALCHEMIST', 112);
        }
        break;
      }
      case 'stash': {
        stashSprite = standing(p, 'stash_closed', 0.82);
        interactables.push({ id: nextId++, kind: 'stash', x: p.x + 0.5, y: p.y + 0.5, label: 'E · STASH', tiles: [{ x: p.x, y: p.y }] });
        glowAt(p.x, p.y, 0xd8a85c, 0.35, 0.9, 10);
        plate(p.x, p.y, 'TOWN STASH', 64);
        break;
      }
      case 'campfire': {
        animated(p.x, p.y, 'campfire', 9, 0.92);
        glowAt(p.x, p.y, 0xff9040, 0.75, 2.6, 18);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 5.5, 255, 150, 60, 0.85);
        hotspots.push({ x: p.x + 0.5, y: p.y + 0.5 });
        plate(p.x, p.y, 'THE HEROES\u2019 CAMP', 92);
        break;
      }
      case 'torch': {
        animated(p.x, p.y, 'torch', 8, 0.92, 1.1);
        glowAt(p.x, p.y, 0xffb060, 0.5, 1.4, 30);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 3.4, 255, 170, 80, 0.55);
        hotspots.push({ x: p.x + 0.5, y: p.y + 0.5 });
        break;
      }
      case 'brazier': {
        // A pillar crowned with a burning bowl.
        standing(p, 'pillar', 0.94);
        animated(p.x, p.y, 'campfire', 10, 0.98, 0.62, 58);
        glowAt(p.x, p.y, 0xff8a30, 0.7, 1.9, 66);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 4.4, 255, 140, 50, 0.8);
        hotspots.push({ x: p.x + 0.5, y: p.y + 0.5 });
        break;
      }
      case 'ruingate': {
        // The gate sprite's south corner is at (0.3, 0.995) of its box (measured
        // from the bake): anchoring there seats the segment exactly on the
        // footprint's south corner — flush in the wall column (it.47).
        const spr = standing(p, 'ruin_gate', 0.995, 'object', 0.3);
        // A thin wall along y at x = p.x + w: everything east of that line draws in front.
        if (spr) spr.zIndex = depthKey(p.x + (p.w ?? 1), p.y + 0.5) + 2;
        gateFog(p);
        plate(layout.gate.x, layout.gate.y, 'THE DUNGEON GATE', 150);
        break;
      }
      case 'tavern': {
        const spr = standing(p, p.variant ?? 'tavern_a', 0.95);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p) });
        break;
      }
      case 'well':
        standing(p, p.variant ?? 'well_b', 0.9);
        break;
      case 'pine':
      case 'deadtree': {
        const spr = standing(p, p.variant ?? 'pine_a', 0.97);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p) });
        break;
      }
      case 'column':
        standing(p, 'column', 0.95);
        break;
      case 'barrels_stacked':
        standing(p, 'barrels_stacked', 0.9);
        break;
      case 'crates_wood':
        standing(p, 'crates_wood', 0.9);
        break;
      case 'wood_pile':
        standing(p, 'wood_pile', 0.9);
        break;
      case 'table_chairs':
        standing(p, 'table_chairs', 0.9);
        break;
      case 'supports':
        standing(p, 'supports', 0.95);
        break;
      case 'pentagram': {
        // RITUAL CIRCLE (it.44): the glowing sigil strip loops on the ground.
        if (spriteLib.loaded && spriteLib.hasAnim('vfx_pentagram')) {
          const frames = spriteLib.anim('vfx_pentagram').frames[0];
          const spr = new Sprite(frames[0]);
          spr.anchor.set(0.5, 0.5);
          spr.blendMode = 'add';
          spr.alpha = 0.9;
          const s = worldToScreen(p.x + 0.5, p.y + 0.5, scratch);
          spr.position.set(s.x, s.y);
          spr.zIndex = depthKey(p.x + 0.5, p.y + 0.5) - 60;
          viewport.objectLayer.addChild(spr);
          ambience.addLoopingAnim(spr, frames, 8, p.x, p.y);
          lighting.addSource(p.x + 0.5, p.y + 0.5, 2.6, 255, 90, 30, 0.6);
        }
        break;
      }
      case 'stairs_stone':
        standing(p, 'stairs_stone', 0.85, 'ground');
        break;
      case 'guard':
        break; // Drawn by Villagers.
      case 'pillar':
        standing(p, 'pillar', 0.94);
        break;
      case 'fence':
        standing(p, 'fence', 0.9);
        break;
      case 'tree': {
        const spr = standing(p, p.variant ?? 'tree_a', 0.94);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p) });
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
      case 'alchemist':
        break; // The shopkeepers are drawn by Villagers.
      case 'board': {
        // DUNGEON RECORDS (it.48): a signpost board with the run's tallies.
        standing(p, 'signpost', 0.95);
        interactables.push({ id: nextId++, kind: 'board', x: p.x + 0.5, y: p.y + 0.5, label: 'E · DUNGEON RECORDS', tiles: [{ x: p.x, y: p.y }] });
        glowAt(p.x, p.y, 0xd8a85c, 0.22, 0.8, 8);
        plate(p.x, p.y, 'DUNGEON RECORDS', 78);
        break;
      }
    }
  }
  ambience.setHotspots(hotspots);

  let clock = 0;
  const update = (dt: number): void => {
    clock += dt;
    for (const pl of plates) pl.node.position.y = pl.baseY + Math.sin(clock * 1.3 + pl.phase) * 2.5;
    for (const f of fog) {
      const t = clock * f.speed + f.phase;
      f.sprite.position.set(f.x + Math.sin(t) * 14, f.y + Math.cos(t * 0.7) * 5 - (t % 3) * 4);
      f.sprite.alpha = 0.1 + 0.08 * (0.5 + 0.5 * Math.sin(t * 1.9));
    }
  };
  const destroy = (): void => {
    for (const f of fog) f.sprite.destroy();
    fog.length = 0;
    for (const pl of plates) pl.node.destroy({ children: true });
    plates.length = 0;
  };
  return { occluders, interactables, stashSprite, update, destroy };
}
