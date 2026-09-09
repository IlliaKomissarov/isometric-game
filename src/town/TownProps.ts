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
import { TILE_H, TILE_W } from '@/core/config';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';
import { TILE_BLOCKED, TILE_FLOOR } from '@/scenes/DungeonGenerator';
import type { TownLayout, TownProp } from './TownMap';

export interface Occluder {
  sprite: Sprite;
  depth: number;
  /** A tree (it.88): fades to a ghost for whatever stands behind it, not a cottage's 0.38. */
  tree?: boolean;
  /** Blocked footprint (tiles) — standing inside it means "indoors". */
  tiles: { x: number; y: number; w: number; h: number };
}

export interface Interactable {
  id: number;
  kind: 'stash' | 'merchant' | 'alchemist' | 'board' | 'arena' | 'forge' | 'jeweler' | 'scribe' | 'bowyer' | 'notice' | 'gateway' | 'quarry' | 'townroad' | 'training' | 'innkeeper' | 'bed' | 'inn' | 'inndoor' | 'cellardoor' | 'cellarup' | 'cellargirl' | 'farmgate';
  /** THE GILDED STAG (it.91): the corner room's bed, chest and bench - the keeper's until the errand is paid. */
  room?: boolean;
  /** A gateway's note (it.84): what the hero is told at a road not yet built. */
  note?: string;
  /** Where an open gateway leads (it.85). */
  dest?: 'forest' | 'farm';
  x: number;
  y: number;
  label: string;
  /** Tiles that count as "close enough" (footprint). */
  tiles: Array<{ x: number; y: number }>;
}

export interface TownDressing {
  occluders: Occluder[];
  interactables: Interactable[];
  /** Label manager (it.50): where the E-prompt shows, so its plate stands down. */
  setPromptAt: (x: number | null, y?: number) => void;
  stashSprite: Sprite | null;
  /** SARAH (it.98): her sprite and the id of her word, so main can hold both back
   *  until the vault is clear and then show her where she has been hiding. */
  cellarGirl: { sprite: Sprite | null; id: number } | null;
  /** THE IRON GATES (it.85): the quarry's gate sprites by tile, swapped open when unlocked. THE BARRICADE (it.91) lives here too. */
  gates: Map<string, Sprite>;
  /** A plate re-titled, or hidden (it.91: the east gate's, once the carts are gone). */
  setPlate: (x: number, y: number, label: string | null) => void;
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
  let cellarGirl: { sprite: Sprite | null; id: number } | null = null;
  const gates = new Map<string, Sprite>();
  const has = (name: string): boolean => spriteLib.loaded && spriteLib.hasSingle(name);

  /**
   * THE LIT TILE (it.97). Fog and light are keyed by tile, and a WALL tile only
   * wins line of sight when the hero stands nearly level with it. So anything
   * mounted on a wall - the wall panel itself, a painting, a torch and its glow
   * - blinked on and off in a three-tile window that slid along with the hero.
   * Snap such a piece to the floor tile it faces (the room in front of it, which
   * is lit whenever the hero can see the wall at all) and the run stays steady.
   */
  const litTile = (x: number, y: number): { x: number; y: number } => {
    const { width, height, grid } = layout.map;
    const floorish = (tx: number, ty: number): boolean => {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false;
      const t = grid[ty * width + tx];
      return t === TILE_FLOOR || t === TILE_BLOCKED;
    };
    if (floorish(x, y)) return { x, y };
    // The faces of these walls look south and east, so try those first.
    for (const [dx, dy] of [[0, 1], [1, 0], [1, 1], [0, -1], [-1, 0], [-1, -1]] as const)
      if (floorish(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    return { x: Math.max(0, Math.min(width - 1, x)), y: Math.max(0, Math.min(height - 1, y)) };
  };

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
    anim: 'campfire' | 'torch' | 'brazier_stand' | 'banner' | 'gateway' | 'inn_fire' | 'inn_torch' | 'cellar_girl',
    fps: number,
    anchorY: number,
    scale = 1,
    lift = 0,
    lit?: { x: number; y: number },
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
    ambience.addLoopingAnim(spr, frames, fps, lit?.x ?? gx, lit?.y ?? gy);
    return spr;
  };

  const glowAt = (gx: number, gy: number, tint: number, alpha: number, scale: number, lift: number, lit?: { x: number; y: number }): Sprite => {
    const g = new Sprite(assets.get('glow'));
    g.anchor.set(0.5);
    g.blendMode = 'add';
    g.tint = tint;
    const s = worldToScreen(gx + 0.5, gy + 0.5, scratch);
    g.position.set(s.x, s.y - lift);
    viewport.ambienceLayer.addChild(g);
    ambience.addGlow(g, lit?.x ?? gx, lit?.y ?? gy, alpha, scale);
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
  const plates: Array<{ node: Container; baseY: number; phase: number; wx: number; wy: number; w: number; h: number; alpha: number }> = [];
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
    plates.push({ node, baseY: s.y - lift, phase: plates.length * 1.7, wx: x + 0.5, wy: y + 0.5, w, h, alpha: 1 });
  };
  const setPlate = (x: number, y: number, label: string | null): void => {
    const pl = plates.find((q) => q.wx === x + 0.5 && q.wy === y + 0.5);
    if (!pl) return;
    if (label === null) {
      pl.node.visible = false;
      return;
    }
    const text = pl.node.children[1] as Text | undefined;
    if (text) text.text = label;
    pl.node.visible = true;
  };
  /**
   * LABEL MANAGER (it.50): no two plates may overlap on screen — sorted by
   * screen Y, any plate whose box meets a lower one is lifted clear — and a
   * plate fades out while the E-prompt for the same landmark is showing, so
   * a title never doubles up with its own prompt.
   */
  const settlePlates = (): void => {
    const sorted = [...plates].sort((a, b) => b.baseY - a.baseY); // Lowest on screen first.
    for (let i = 0; i < sorted.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = sorted[i];
        const b = sorted[j];
        const dx = Math.abs(a.node.position.x - b.node.position.x);
        if (dx >= (a.w + b.w) / 2 + 6) continue;
        const dy = b.baseY - a.baseY; // b is lower (larger y) or equal.
        const need = (a.h + b.h) / 2 + 6;
        if (dy > -need && dy < need) a.baseY = b.baseY - need; // Lift the upper one clear.
      }
    }
    for (const pl of plates) pl.node.position.y = pl.baseY;
  };
  let promptAt: { x: number; y: number } | null = null;
  const setPromptAt = (x: number | null, y = 0): void => {
    promptAt = x === null ? null : { x, y };
  };

  // Interactable ids start past any chest's (it.92): both ride the OPEN_CHEST command, and a chest now stands in town.
  let nextId = 10001;
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
        // THE MARKET WARD (it.84): the jeweler's, the scribe's, the bowyer's.
        if (layout.jeweler.tiles.some((t) => t.x === p.x && t.y === p.y)) {
          interactables.push({ id: nextId++, kind: 'jeweler', x: layout.jeweler.x + 0.5, y: layout.jeweler.y + 0.5, label: 'E · JEWELER', tiles: layout.jeweler.tiles });
          plate(p.x + 1, p.y, 'THE JEWELER', 112);
        } else if (layout.scribe.tiles.some((t) => t.x === p.x && t.y === p.y)) {
          interactables.push({ id: nextId++, kind: 'scribe', x: layout.scribe.x + 0.5, y: layout.scribe.y + 0.5, label: 'E · SCRIBE', tiles: layout.scribe.tiles });
          plate(p.x + 1, p.y, 'THE SCRIBE', 112);
        } else if (layout.bowyer.tiles.some((t) => t.x === p.x && t.y === p.y)) {
          interactables.push({ id: nextId++, kind: 'bowyer', x: layout.bowyer.x + 0.5, y: layout.bowyer.y + 0.5, label: 'E · BOWYER', tiles: layout.bowyer.tiles });
          plate(p.x + 1, p.y, 'THE BOWYER', 112);
        } else if (layout.merchant.tiles.some((t) => t.x === p.x && t.y === p.y)) {
          interactables.push({ id: nextId++, kind: 'merchant', x: layout.merchant.x + 0.5, y: layout.merchant.y + 0.5, label: 'E · ARMORER', tiles: layout.merchant.tiles });
          plate(p.x + 1, p.y, 'THE ARMORER', 112);
        } else if (layout.alchemist.tiles.some((t) => t.x === p.x && t.y === p.y)) {
          interactables.push({ id: nextId++, kind: 'alchemist', x: layout.alchemist.x + 0.5, y: layout.alchemist.y + 0.5, label: 'E · ALCHEMIST', tiles: layout.alchemist.tiles });
          plate(p.x + 1, p.y, 'THE ALCHEMIST', 112);
        }
        break;
      }
      case 'stash': {
        // THE ROOM'S CHEST (it.91): the same stash, opened from the inn.
        const room = p.variant === 'room';
        const spr = standing(p, room ? 'inn_chest' : 'stash_closed', room ? 0.9 : 0.82);
        if (!room) stashSprite = spr;
        interactables.push({ id: nextId++, kind: 'stash', x: p.x + 0.5, y: p.y + 0.5, label: room ? 'E · THE WARDED CHEST' : 'E · STASH', tiles: [{ x: p.x, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 }], room });
        glowAt(p.x, p.y, room ? 0.0 || 0x9ad8ff : 0xd8a85c, room ? 0.4 : 0.35, room ? 1.2 : 0.9, room ? 14 : 10);
        plate(p.x, p.y, room ? 'THE WARDED CHEST' : 'TOWN STASH', room ? 70 : 64);
        break;
      }
      case 'forge': {
        // THE CAMP FORGE (it.78, it.80): the weapon rack from the town's own
        // prop set — the camp's arms bench, ember-lit by the fire beside it.
        // THE ROOM'S BENCH (it.91): the same rack in the inn's corner room.
        const room = p.variant === 'room';
        standing(p, 'weapon_rack', 0.9);
        glowAt(p.x, p.y, 0xff9a40, room ? 0.2 : 0.32, 0.9, 8);
        interactables.push({ id: nextId++, kind: 'forge', x: p.x + 0.5, y: p.y + 0.5, label: room ? 'E · YOUR BENCH' : 'E · CAMP FORGE', tiles: [{ x: p.x, y: p.y }], room });
        if (!room) plate(p.x, p.y, 'THE CAMP FORGE', 60);
        break;
      }
      case 'campfire': {
        animated(p.x, p.y, 'campfire', 9, 0.92);
        glowAt(p.x, p.y, 0xff9040, 0.75, 2.6, 18);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 5.5, 255, 150, 60, 0.85);
        hotspots.push({ x: p.x + 0.5, y: p.y + 0.5 });
        if (!p.variant) plate(p.x, p.y, 'THE HEROES\u2019 CAMP', 92); // The looters' fires (it.91) carry no plate.
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
      case 'rock':
        standing(p, p.variant ?? 'rock_a', 0.9);
        break;
      case 'watchtower': {
        const spr = standing(p, 'watchtower', 0.97);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p) });
        break;
      }
      case 'pine':
      case 'deadtree': {
        const spr = standing(p, p.variant ?? 'pine_a', 0.97);
        if (spr && p.variant?.startsWith('tree_')) spr.tint = 0x8e9c86; // The oaks stand in deeper shade (it.57).
        // A tree on a cliff tile (it.50) stands in front of that tile's cube.
        if (spr && layout.map.grid[p.y * layout.map.width + p.x] === 0) spr.zIndex += 40;
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p), tree: true });
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
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p), tree: true });
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
      case 'arenamaster':
      case 'jeweler':
      case 'scribe':
      case 'bowyer':
      case 'gatekeeper':
        break; // The shopkeepers, the Arena Master and the gatekeeper are drawn by Villagers.
      // ---- THE MARKET WARD (it.84): the new part's props ----
      case 'guildhall': {
        // The timber-frame hall: its south corner sits a little inside its
        // box (the eaves overhang), so the anchor is measured, not 0.5/1.
        const spr = standing(p, 'guildhall', 0.985, 'object', 0.47);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p) });
        lighting.addSource(p.x + 1, p.y + 3.5, 3.2, 255, 190, 110, 0.4);
        break;
      }
      case 'statue': {
        standing(p, p.variant ?? 'statue_a', 0.96);
        if ((p.w ?? 1) > 1) {
          glowAt(p.x + 0.5, p.y + 0.5, 0xc8a558, 0.18, 1.4, 20);
          plate(p.x, p.y, 'THE HOLLOW KING', 150);
        }
        break;
      }
      case 'bench':
        standing(p, p.variant ?? 'bench_a', 0.9);
        break;
      case 'cart':
        standing(p, 'cart', 0.92);
        break;
      case 'barricade':
        standing(p, p.variant ?? 'barricade_a', 0.9);
        break;
      // ---- THE EASTERN QUARTER (it.91) ----
      case 'gatebar': {
        // THE BARRICADE: carts and timber across the east road, kept by tile
        // so the errand can pull one aside and the reclaiming topple them all.
        const spr = standing(p, p.variant ?? 'barricade_a', 0.9);
        if (spr) {
          spr.scale.set(1.3);
          gates.set(`${p.x},${p.y}`, spr);
        }
        break;
      }
      case 'ruin': {
        // A burnt shell: an occluder like a cottage, ashen.
        const spr = standing(p, p.variant ?? 'ruin_a', 0.95, 'object', 0.5);
        if (spr) spr.tint = 0xc4b8aa;
        // THE ROTUNDA (it.93): open ground - sorted at its centre so the hero walks behind its far columns and before its near ones; never ghosted.
        if (spr && p.variant === 'ruin_ring') spr.zIndex = depthKey(p.x + 1.5, p.y + 1.5);
        else if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p) });
        break;
      }
      case 'heap': {
        // A HEAP KEEPS TO ITS TILE (it.92): the wide renders shrink to the diamond, so nothing walks through paint.
        const spr = standing(p, p.variant ?? 'heap_a', 0.88);
        if (spr && spr.width > 66) spr.scale.set(66 / spr.width);
        break;
      }
      case 'ruinwall':
        standing(p, p.variant ?? 'ruinwall_a', 0.94);
        break;
      case 'rubble':
      case 'debris':
        standing(p, p.variant ?? 'rubble_a', 0.72, 'ground');
        break;
      case 'slab':
        standing(p, p.variant ?? 'slab_a', 0.8, 'ground');
        break;
      case 'corpse': {
        // THE FALLEN: a looter's or a militiaman's death frame, lying where
        // it fell, dark, over a pool - render-only paint, never a body.
        const v = p.variant ?? 'p3';
        const animName = v[0] === 'g' ? 'guard_death' : 'poacher_death';
        if (!spriteLib.loaded || !spriteLib.hasAnim(animName)) break;
        const a = spriteLib.anim(animName);
        const dir = (Number(v.slice(1)) || 0) % a.dirCount;
        const s = worldToScreen(p.x + 0.5, p.y + 0.5, scratch);
        const pool = new Sprite(assets.get('glow'));
        pool.anchor.set(0.5);
        pool.tint = 0x4a0e12;
        pool.alpha = 0.55;
        pool.scale.set(1.15, 0.5);
        pool.position.set(s.x, s.y + 2);
        lighting.registerProp(p.x, p.y, pool);
        // ON THE GROUND (it.92): the fallen are paint under every foot - the ground layer, never in front of a walker.
        const body = new Sprite(a.frames[dir][a.frameCount - 1]);
        body.anchor.set(0.5, v[0] === 'g' ? 0.72 : 0.9);
        body.scale.set(v[0] === 'g' ? 0.42 : 0.44);
        body.tint = 0x8c8078;
        body.position.set(s.x, s.y + 4);
        viewport.groundLayer.addChild(pool);
        viewport.groundLayer.addChild(body);
        lighting.registerProp(p.x, p.y, body);
        break;
      }
      case 'embers': {
        // A cellar still breathing: a low red glow and a warm, dim light.
        glowAt(p.x, p.y, 0xff6a28, 0.26, 1.3, 6);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 2.8, 255, 110, 40, 0.32);
        hotspots.push({ x: p.x + 0.5, y: p.y + 0.5 });
        break;
      }
      case 'tavern2': {
        // THE GILDED STAG: the inn with its own floor inside (it.92). The door
        // tile is the way in; the building stays solid.
        const spr = standing(p, 'tavern_east', 0.975, 'object', 0.5);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p) });
        const east = layout.east;
        const dx = east ? east.door.x + 0.5 : p.x + 2.5;
        const dy = east ? east.door.y + 1.5 : p.y + 5.5;
        lighting.addSource(dx, dy, 3.6, 255, 190, 110, 0.5);
        glowAt(Math.floor(dx), Math.floor(dy) - 1, 0xffb060, 0.22, 1.2, 40);
        if (east) interactables.push({ id: nextId++, kind: 'inn', x: east.door.x + 0.5, y: east.door.y + 0.5, label: 'E · THE GILDED STAG', tiles: [{ x: east.door.x, y: east.door.y }, { x: east.door.x, y: east.door.y + 1 }, { x: east.door.x - 1, y: east.door.y + 1 }, { x: east.door.x + 1, y: east.door.y + 1 }] });
        plate(p.x + 2, p.y + 2, 'THE GILDED STAG', 250);
        break;
      }
      // ---- THE GILDED STAG (it.96): the inn built of tileset pieces ----
      case 'innwall': {
        // A wall piece stands on the FAR edge of a 2x2 block of tiles, seated by the
        // tileset's own convention: the image's bottom-left meets that block's
        // bounding-box bottom-left. `w === 2` runs along +x, `h === 2` along +y.
        if (!has(p.variant ?? '')) break;
        const spr = new Sprite(spriteLib.single(p.variant!));
        const alongX = (p.w ?? 1) === 2;
        const bx = alongX ? p.x : p.x - 1;
        const by = alongX ? p.y - 1 : p.y;
        const s0 = worldToScreen(bx, by, scratch);
        spr.position.set(s0.x - TILE_W, s0.y + TILE_H * 2 - spr.height);
        // NO FLICKER, NO CLIPPING (it.97). Two rules, both borrowed from the
        // engine's own wall cubes:
        //
        //  - SORT by a key that sits strictly between the tiles behind the
        //    piece and the tiles in front of it. `depthKey(x, y + 1) + 4` does
        //    that for a run along either axis, so a hero walking the wall is
        //    always drawn over it and neighbouring panels never disagree about
        //    which side of the hero they belong on (the old near-corner key
        //    tied with the hero's depth every other tile, and the two panels
        //    beside them sorted opposite ways - the hero clipped through).
        //  - LIGHT the piece from the floor it FACES, not from its own tile.
        //    A wall tile only wins line of sight when the hero is nearly level
        //    with it, so lighting it by itself lit a sliding three-tile window
        //    and left the rest of the run dark - the flicker along the wall.
        spr.zIndex = depthKey(p.x, p.y + 1) + 4;
        const lit = litTile(alongX ? p.x : p.x + 1, alongX ? p.y + 1 : p.y);
        viewport.objectLayer.addChild(spr);
        lighting.registerProp(lit.x, lit.y, spr);
        // A partition the hero can stand behind fades to a ghost, as a cottage roof does.
        occluders.push({ sprite: spr, depth: spr.zIndex, tiles: { x: p.x, y: p.y, w: p.w ?? 1, h: p.h ?? 1 } });
        break;
      }
      case 'innprop':
      case 'inndeco': {
        // Furniture and small dressing: placed on its tile with a fractional nudge.
        if (!has(p.variant ?? '')) break;
        const spr = new Sprite(spriteLib.single(p.variant!));
        spr.anchor.set(0.5, 1);
        const s1 = worldToScreen(p.x + 0.5 + (p.ox ?? 0), p.y + 0.5 + (p.oy ?? 0), scratch);
        spr.position.set(s1.x, s1.y + 5 - (p.lift ?? 0));
        spr.zIndex = depthKey(p.x + 0.5 + (p.ox ?? 0), p.y + 0.5 + (p.oy ?? 0)) + (p.lift ? 6 : 0);
        viewport.objectLayer.addChild(spr);
        const litP = litTile(p.x, p.y);
        lighting.registerProp(litP.x, litP.y, spr);
        break;
      }
      case 'innrug': {
        // A carpet lies on the boards, under every foot.
        if (!has(p.variant ?? '')) break;
        const spr = new Sprite(spriteLib.single(p.variant!));
        spr.anchor.set(0.5, 0.5);
        const s2 = worldToScreen(p.x + 0.5 + (p.ox ?? 0), p.y + 0.5 + (p.oy ?? 0), scratch);
        spr.position.set(s2.x, s2.y);
        viewport.groundLayer.addChild(spr);
        lighting.registerProp(p.x, p.y, spr);
        break;
      }
      case 'sconce': {
        // A torch on the wall: the flame burns and throws its light over the hall.
        const litS = litTile(p.x, p.y);
        const t = animated(p.x, p.y, 'inn_torch', 7, 1, 1, 46, litS);
        if (t) t.position.x += (p.ox ?? 0) * TILE_W;
        glowAt(p.x, p.y, 0xffb060, 0.4, 1.2, 52, litS);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 4.6, 255, 180, 90, 0.62);
        hotspots.push({ x: p.x + 0.5, y: p.y + 0.5 });
        break;
      }
      // ---- THE FARMLANDS (it.100) ----
      case 'farmcrop': {
        // Standing corn, or the stubble the fire left. Paint on the ground layer,
        // sorted where it stands so a hero walks THROUGH the rows, not around them.
        if (!has(p.variant ?? '')) break;
        const spr = new Sprite(spriteLib.single(p.variant!));
        spr.anchor.set(0.5, 0.92);
        const sc = worldToScreen(p.x + 0.5 + (p.ox ?? 0), p.y + 0.5 + (p.oy ?? 0), scratch);
        spr.position.set(sc.x, sc.y + 4);
        spr.zIndex = depthKey(p.x + 0.5 + (p.ox ?? 0), p.y + 0.5 + (p.oy ?? 0)) - 1;
        viewport.objectLayer.addChild(spr);
        lighting.registerProp(p.x, p.y, spr);
        break;
      }
      case 'fieldfire': {
        // A fire in the corn: the flame, its light, and a hotspot so the ambience
        // throws embers up off it without a single new sprite.
        animated(p.x, p.y, 'inn_fire', 10, 0.95, 1.15, 8);
        glowAt(p.x, p.y, 0xff7a28, 0.85, 2.6, 18);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 7, 255, 150, 60, 0.95);
        hotspots.push({ x: p.x + 0.5, y: p.y + 0.5 });
        break;
      }
      case 'farmgate': {
        // A road that is not built yet, and a plate that says which one.
        plate(p.x, p.y, `${p.variant ?? 'THE ROAD'} · NOT YET OPEN`, 74);
        interactables.push({ id: nextId++, kind: 'farmgate', x: p.x + 0.5, y: p.y + 0.5, label: `E · ${p.variant ?? 'THE ROAD'}`, tiles: [{ x: p.x - 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 2 }, { x: p.x + 1, y: p.y }], note: 'The way past the fields is still barricaded.' });
        break;
      }
      // ---- THE CELLAR (it.97) ----
      case 'cellardoor': {
        // The taproom's back door. The leaf itself is part of the wall run the
        // dresser lays; this is the prompt under it and the lamp over the stair.
        const shut = p.variant === 'shut';
        glowAt(p.x, p.y, shut ? 0x6a7a92 : 0xffb060, shut ? 0.16 : 0.38, 1.2, 30, litTile(p.x, p.y));
        if (!shut) lighting.addSource(p.x + 0.5, p.y + 0.5, 3.8, 255, 180, 110, 0.5);
        interactables.push({ id: nextId++, kind: 'cellardoor', x: p.x + 0.5, y: p.y + 0.5, label: shut ? 'E · THE CELLAR DOOR · LOCKED' : 'E · DOWN TO THE CELLAR', tiles: [{ x: p.x, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x + 1, y: p.y + 1 }, { x: p.x + 1, y: p.y - 1 }] });
        plate(p.x, p.y, shut ? 'THE CELLAR · LOCKED' : 'THE CELLAR', 78);
        break;
      }
      case 'cellarup': {
        // The stair back into the taproom: a little daylight falls down it.
        glowAt(p.x, p.y, 0xffc880, 0.34, 1.5, 30);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 5, 255, 205, 140, 0.62);
        interactables.push({ id: nextId++, kind: 'cellarup', x: p.x + 0.5, y: p.y + 0.5, label: 'E · UP TO THE TAPROOM', tiles: [{ x: p.x, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }] });
        plate(p.x, p.y, 'THE STAIR UP', 74);
        break;
      }
      case 'cellargirl': {
        // SARAH: an idle loop on her tile, and a word when the hero stands beside
        // her. In the vault she is held back until the last monster is down (it.98);
        // in the taproom afterwards she is simply there.
        const gspr = animated(p.x, p.y, 'cellar_girl', 5, 1, 1, 2);
        glowAt(p.x, p.y, 0xffd9a0, 0.2, 0.8, 30);
        const gid = nextId++;
        interactables.push({ id: gid, kind: 'cellargirl', x: p.x + 0.5, y: p.y + 0.5, label: 'E · SPEAK', tiles: [{ x: p.x, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 }] });
        cellarGirl = { sprite: gspr, id: gid };
        break;
      }
      case 'inndoor': {
        // The way out: the arch is part of the wall run; this is the prompt beneath it.
        glowAt(p.x, p.y, 0xffc880, 0.34, 1.4, 26);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 4.4, 255, 200, 130, 0.6);
        interactables.push({ id: nextId++, kind: 'inndoor', x: p.x + 0.5, y: p.y + 0.5, label: 'E · OUT TO THE STREET', tiles: [{ x: p.x, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y + 1 }] });
        plate(p.x, p.y, 'THE DOOR', 74);
        break;
      }
      case 'chest':
        break; // A ChestSystem chest stands on the tile (main spawns it); the prop only keeps the tile solid.
      case 'innkeeper': {
        // Drawn by Villagers. At the gate the keeper's tiles are the barricade's
        // too, so E anywhere along it opens the word; in the inn, the counter.
        const east = layout.east;
        const atGate = east && east.state !== 'cleared';
        const tiles = atGate ? [{ x: p.x, y: p.y }, ...east.gateTiles] : [{ x: p.x, y: p.y }, { x: p.x + 1, y: p.y }];
        interactables.push({ id: nextId++, kind: 'innkeeper', x: p.x + 0.5, y: p.y + 0.5, label: atGate ? 'E · THE INNKEEPER · THE EAST GATE' : 'E · THE INNKEEPER', tiles });
        if (atGate && east) {
          const mid = east.gap;
          plate(mid.x, mid.y, east.state === 'sealed' ? 'THE EAST GATE · BARRICADED' : 'THE EAST GATE', 110);
          glowAt(mid.x, mid.y, 0xff9a40, 0.3, 1.6, 30);
          lighting.addSource(mid.x + 0.5, mid.y + 0.5, 3.4, 255, 160, 80, 0.5);
        }
        break;
      }
      case 'barkeep': {
        // Drawn by Villagers; the counter's front tiles are where a word is had.
        interactables.push({ id: nextId++, kind: 'innkeeper', x: p.x + 0.5, y: p.y + 0.5, label: 'E · THE INNKEEPER', tiles: [{ x: p.x, y: p.y }, ...[-2, -1, 0, 1, 2].flatMap((d) => [{ x: p.x + d, y: p.y + 2 }, { x: p.x + d, y: p.y + 3 }])] });
        plate(p.x, p.y, 'THE BAR', 92);
        break;
      }
      case 'hearth': {
        // The fire in the stone arch: embers on the flags, the flame above them.
        const em = standing({ ...p, kind: 'innrug' }, 'inn_embers', 0.5, 'ground');
        if (em) em.alpha = 0.95;
        animated(p.x, p.y, 'inn_fire', 10, 0.95, 1, 10);
        glowAt(p.x, p.y, 0xff8a30, 0.8, 2.4, 20);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 7.5, 255, 160, 70, 0.95);
        hotspots.push({ x: p.x + 0.5, y: p.y + 0.5 });
        break;
      }
      case 'bed': {
        // THE BED (it.96): the rented room's own, a 2x1 footprint; the hero lies at its middle.
        const spr = standing(p, 'inn_bed', 0.92);
        if (spr) spr.zIndex = depthKey(p.x + (p.w ?? 1) - 0.5, p.y + (p.h ?? 1) - 0.5);
        const w = p.w ?? 1;
        const h = p.h ?? 1;
        const tiles: Array<{ x: number; y: number }> = [];
        for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) tiles.push({ x, y });
        for (let y = p.y - 1; y <= p.y + h; y++)
          for (let x = p.x - 1; x <= p.x + w; x++)
            if (x < p.x || x >= p.x + w || y < p.y || y >= p.y + h) tiles.push({ x, y });
        interactables.push({ id: nextId++, kind: 'bed', x: p.x + w / 2, y: p.y + h / 2, label: 'E · REST', tiles, room: true });
        break;
      }
      case 'smithy':
      case 'barracks': {
        const spr = standing(p, p.kind, 0.96);
        if (spr) occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p) });
        break;
      }
      case 'dummy':
        break; // A body now (it.90): main spawns a passive foe on the tile; the prop only keeps it solid.
      case 'trainpost': {
        // THE TRAINING GROUND (it.90): the sign that offers the tutorial.
        standing(p, 'signpost', 0.95);
        interactables.push({ id: nextId++, kind: 'training', x: p.x + 0.5, y: p.y + 0.5, label: 'E · THE TRAINING GROUND', tiles: [{ x: p.x, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }] });
        plate(p.x, p.y, 'THE TRAINING GROUND', 70);
        break;
      }
      case 'jar':
        standing(p, p.variant ?? 'jar_a', 0.85);
        break;
      case 'box':
        standing(p, p.variant ?? 'box_a', 0.85);
        break;
      case 'trashbox':
        standing(p, 'trashbox', 0.88);
        break;
      case 'table':
        standing(p, 'table_a', 0.88);
        break;
      case 'chest_market':
        standing(p, 'chest_market', 0.88);
        break;
      case 'potions':
        standing(p, 'potions_decal', 0.8, 'ground');
        break;
      case 'rack':
        standing(p, 'weapon_rack', 0.9);
        break;
      case 'bigtree': {
        const spr = standing(p, p.variant ?? 'bigtree_a', 0.96);
        if (spr) {
          spr.tint = 0x8a9a8c; // Deep shade, like the oaks.
          occluders.push({ sprite: spr, depth: spr.zIndex, tiles: footprint(p), tree: true });
        }
        break;
      }
      case 'lamp': {
        // A standing brazier from the new pack: the ward's street light.
        animated(p.x, p.y, 'brazier_stand', 10, 0.94, 0.9, 2);
        glowAt(p.x, p.y, 0xffa050, 0.5, 1.5, 44);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 3.6, 255, 160, 70, 0.6);
        hotspots.push({ x: p.x + 0.5, y: p.y + 0.5 });
        break;
      }
      case 'banner': {
        // A column with the guild's banner waving from its top.
        standing(p, 'column', 0.95);
        const b = animated(p.x, p.y, 'banner', 9, 0.92, 0.9, 74);
        if (b) b.anchor.x = 0.12; // The pole is the sprite's left edge: it sits on the column.
        break;
      }
      // ---- THE FOREST AND THE QUARRY (it.85) ----
      case 'gate': {
        // An iron gate across a mine corridor: solid and opaque until its key.
        const spr = standing(p, p.variant ?? 'gate_closed', 0.96);
        if (spr) {
          spr.scale.set(p.flip ? -1.15 : 1.15, 1.15);
          gates.set(`${p.x},${p.y}`, spr);
        }
        break;
      }
      case 'quarry': {
        // The quarry mouth: the archway into the rock, ember-lit.
        const spr = standing(p, 'archway', 0.96);
        if (spr) spr.scale.set(1.5);
        glowAt(p.x, p.y, 0xff9a40, 0.45, 1.8, 30);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 4.2, 255, 150, 70, 0.7);
        interactables.push({ id: nextId++, kind: 'quarry', x: p.x + 0.5, y: p.y + 0.5, label: 'E · DOWN INTO THE QUARRY', tiles: [{ x: p.x, y: p.y }] });
        plate(p.x, p.y, 'THE QUARRY MINES', 132);
        break;
      }
      case 'townroad': {
        // The way back west: a signpost, a warm glow, the town's name.
        standing(p, 'signpost', 0.95);
        glowAt(p.x, p.y, 0xd8a85c, 0.35, 1.2, 10);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 3.2, 255, 190, 110, 0.5);
        interactables.push({ id: nextId++, kind: 'townroad', x: p.x + 0.5, y: p.y + 0.5, label: 'E · BACK TO THE MARKET WARD', tiles: [{ x: p.x, y: p.y }] });
        plate(p.x, p.y, 'THE ROAD TO TOWN', 84);
        break;
      }
      case 'notice': {
        // THE BOUNTY BOARD (it.84): the guild's postings before the hall.
        standing(p, 'signpost', 0.95);
        interactables.push({ id: nextId++, kind: 'notice', x: p.x + 0.5, y: p.y + 0.5, label: 'E · BOUNTY BOARD', tiles: [{ x: p.x, y: p.y }] });
        glowAt(p.x, p.y, 0xd8a85c, 0.22, 0.8, 8);
        plate(p.x, p.y, 'THE BOUNTY BOARD', 78);
        break;
      }
      case 'gateway': {
        // A PASSAGE NOT YET OPEN (it.84): the standing light between two
        // pillars, a cold glow, and a note when the hero asks.
        const g = layout.gateways.find((gw) => gw.x === p.x && gw.y === p.y);
        const spr = animated(p.x, p.y, 'gateway', 12, 0.96, 1, 0);
        if (spr) {
          spr.blendMode = 'add';
          spr.alpha = 0.85;
        }
        glowAt(p.x, p.y, 0x7fa8ff, 0.62, 2.2, 44);
        lighting.addSource(p.x + 0.5, p.y + 0.5, 4.6, 130, 170, 255, 0.95);
        // THE GATEKEEPER (it.87): the forest road's prompt names him, and his
        // own tile counts as the road's, so E beside him is E at the gate.
        const keeper = g?.dest === 'forest' ? layout.gatekeeper : undefined;
        const gateTiles = keeper ? [{ x: p.x, y: p.y }, { x: keeper.x, y: keeper.y }] : [{ x: p.x, y: p.y }];
        interactables.push({ id: nextId++, kind: 'gateway', x: p.x + 0.5, y: p.y + 0.5, label: g?.dest ? (keeper ? `E · SIR HAM · ${g.label}` : `E · ${g.label}`) : `E · ${g?.label ?? 'THE WAY'} (NOT YET OPEN)`, tiles: gateTiles, note: g?.note, dest: g?.dest });
        plate(p.x, p.y, g?.dest ? `${g.label} · THE FOREST` : (g?.label ?? 'THE WAY'), 118);
        break;
      }
      case 'arenagate': {
        // THE TRIAL COLISEUM (it.53): the arch on the east road.
        const spr = standing(p, 'archway', 0.96);
        if (spr) spr.scale.set(1.6);
        interactables.push({ id: nextId++, kind: 'arena', x: p.x + 0.5, y: p.y + 0.5, label: 'E · THE TRIAL COLISEUM', tiles: [{ x: p.x, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x - 1, y: p.y + 2 }] });
        glowAt(p.x, p.y + 1, 0xd0303a, 0.4, 1.6, 12);
        lighting.addSource(p.x + 0.5, p.y + 1.5, 3.4, 220, 90, 70, 0.55);
        plate(p.x, p.y, 'THE COLISEUM', 118);
        break;
      }
      case 'board': {
        // DUNGEON RECORDS (it.48): a signpost board with the run's tallies.
        standing(p, 'signpost', 0.95);
        interactables.push({ id: nextId++, kind: 'board', x: p.x + 0.5, y: p.y + 0.5, label: 'E · HALL OF RECORDS', tiles: [{ x: p.x, y: p.y }] });
        glowAt(p.x, p.y, 0xd8a85c, 0.22, 0.8, 8);
        plate(p.x, p.y, 'HALL OF RECORDS', 78);
        break;
      }
    }
  }
  ambience.setHotspots(hotspots);

  settlePlates();
  let clock = 0;
  const update = (dt: number): void => {
    clock += dt;
    const k = 1 - Math.exp(-10 * dt);
    for (const pl of plates) {
      pl.node.position.y = pl.baseY + Math.sin(clock * 1.3 + pl.phase) * 2.5;
      const hide = !!promptAt && Math.hypot(promptAt.x - pl.wx, promptAt.y - pl.wy) < 2.4;
      pl.alpha += ((hide ? 0 : 1) - pl.alpha) * k;
      pl.node.alpha = pl.alpha;
      pl.node.visible = pl.alpha > 0.02;
    }
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
  return { occluders, interactables, stashSprite, cellarGirl, gates, update, destroy, setPromptAt, setPlate };
}
