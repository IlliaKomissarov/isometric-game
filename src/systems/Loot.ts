/**
 * @module systems/Loot
 * Ground loot: deterministic drops, world rendering, pickup bookkeeping.
 *
 * Drops roll from a seeded RNG stream (dungeonSeed-derived), so identical
 * kill orders produce identical loot on every co-op peer. Ground items are
 * lightweight records — NOT entities — rendered as a rarity-glow + tinted
 * item glyph that bobs gently and obeys fog visibility/lighting.
 */

import { Container, Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { eventBus } from '@/core/EventBus';
import type { Camera } from '@/engine/Camera';
import type { Lighting } from '@/engine/Lighting';
import type { Viewport } from '@/engine/Viewport';
import { RARITY_COLOR, rollChestItem, rollDrop, rollRareItem, type ItemDef } from '@/items/catalog';
import { spriteLib } from '@/render/SpriteLibrary';
import { itemIconTexture } from '@/ui/itemIcons';
import { vec2 } from '@/utils/Vec2';
import { depthKey, worldToScreen } from '@/utils/iso';
import { mulberry32 } from '@/utils/rng';

export interface GroundItem {
  uid: number;
  itemId: string;
  x: number;
  y: number;
}

interface GroundItemView extends GroundItem {
  root: Container;
  glyph: Sprite;
}

export class LootSystem {
  private readonly items = new Map<number, GroundItemView>();
  private nextUid = 1;
  private readonly rand: () => number;
  private readonly scratch = vec2();

  constructor(
    private readonly viewport: Viewport,
    seed: number,
  ) {
    this.rand = mulberry32(seed ^ 0x517ab1e5);
  }

  /** Roll the drop table at a death location (deterministic stream). */
  tryDropAt(x: number, y: number): void {
    const def = rollDrop(this.rand);
    if (def) this.spawn(def, x, y);
  }

  /** Guaranteed drop (chests): always yields an item, rarity-weighted. */
  dropForced(x: number, y: number): void {
    this.spawn(rollChestItem(this.rand), x, y);
  }

  /** Guaranteed RARE drop (boss trophies). */
  dropRareAt(x: number, y: number): void {
    this.spawn(rollRareItem(this.rand), x, y);
  }

  spawn(def: ItemDef, x: number, y: number): void {
    const uid = this.nextUid++;
    const root = new Container();

    const glow = new Sprite(assets.get('glow'));
    glow.anchor.set(0.5);
    glow.blendMode = 'add';
    glow.tint = RARITY_COLOR[def.rarity];
    glow.scale.set(0.5);
    glow.alpha = 0.7;
    glow.position.y = -6;
    root.addChild(glow);

    // Weapons show their REAL pixel icon on the ground; other gear keeps
    // the item-colored paperdoll glyph.
    let glyph: Sprite;
    if (def.icon && spriteLib.loaded && spriteLib.hasSingle(`wicon_${def.icon}`)) {
      glyph = new Sprite(spriteLib.single(`wicon_${def.icon}`));
      glyph.anchor.set(0.5, 0.5);
      glyph.scale.set(1.8);
      glyph.position.y = -8;
    } else {
      // Non-pack gear drops as its crisp generated pixel icon (no vector shapes).
      glyph = new Sprite(itemIconTexture(def));
      glyph.anchor.set(0.5, 0.5);
      glyph.scale.set(1.1);
      glyph.position.y = -8;
    }
    root.addChild(glyph);

    const s = worldToScreen(x, y, this.scratch);
    root.position.set(s.x, s.y);
    root.zIndex = depthKey(x, y);
    this.viewport.objectLayer.addChild(root);

    this.items.set(uid, { uid, itemId: def.id, x, y, root, glyph });
    eventBus.emit('item:dropped', { uid, itemId: def.id, x, y });
  }

  getItem(uid: number): GroundItem | null {
    return this.items.get(uid) ?? null;
  }

  /** Nearest ground item to a world point within `range` (E-key pickup). */
  findNearest(x: number, y: number, range: number): GroundItem | null {
    let best: GroundItemView | null = null;
    let bestDist = range;
    for (const item of this.items.values()) {
      const d = Math.hypot(item.x - x, item.y - y);
      if (d <= bestDist) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  /** Remove a ground item and return its itemId (null if already gone). */
  pickup(uid: number): string | null {
    const item = this.items.get(uid);
    if (!item) return null;
    this.items.delete(uid);
    item.root.destroy({ children: true });
    eventBus.emit('item:pickedUp', { itemId: item.itemId });
    return item.itemId;
  }

  /** Screen-space pick: the visible ground item whose glyph contains the point. */
  pickAtCanvas(canvasX: number, canvasY: number, camera: Camera, lighting: Lighting): number | null {
    const zoom = camera.currentZoom;
    const halfW = 14 * zoom + 4;
    const height = 34 * zoom + 4;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const item of this.items.values()) {
      if (!lighting.isVisible(Math.floor(item.x), Math.floor(item.y))) continue;
      const p = camera.worldToCanvas(item.x, item.y, this.scratch);
      const dx = canvasX - p.x;
      const dy = canvasY - (p.y - height / 2);
      if (Math.abs(dx) > halfW || Math.abs(dy) > height / 2 + 6) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestDist) {
        bestDist = d;
        best = item.uid;
      }
    }
    return best;
  }

  /** Per-frame: bob, fog gating, scene-light tinting for every ground item. */
  updateRender(time: number, lighting: Lighting): void {
    for (const item of this.items.values()) {
      const visible = lighting.isVisible(Math.floor(item.x), Math.floor(item.y));
      item.root.visible = visible;
      if (!visible) continue;
      item.glyph.position.y = -4 + Math.sin(time * 2.4 + item.uid * 1.7) * 2.5;
      // All ground glyphs are pre-colored art now (pack icons or generated
      // pixel icons) — the scene light is the only tint applied.
      const light = lighting.getTintAt(item.x, item.y, 0.35);
      const base = 0xffffff;
      const r = Math.round((((base >> 16) & 0xff) * ((light >> 16) & 0xff)) / 255);
      const g = Math.round((((base >> 8) & 0xff) * ((light >> 8) & 0xff)) / 255);
      const b = Math.round(((base & 0xff) * (light & 0xff)) / 255);
      item.glyph.tint = (r << 16) | (g << 8) | b;
    }
  }
}
