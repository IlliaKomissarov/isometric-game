/**
 * @module core/AssetManager
 * Central asset registry + procedural placeholder generation.
 *
 * Until hand-authored art lands in /public/assets, every texture is generated
 * at boot from vector geometry (Pixi Graphics → GPU texture), tuned for a
 * grim, high-contrast dark-fantasy look: cracked stone floors, extruded
 * gothic wall blocks, and clean geometric class markers.
 *
 * SUB-AGENT BOUNDARY: to swap a placeholder for real art, load the file in
 * `init()` and register it under the SAME key — no render code changes needed.
 * Texture keys are the public contract.
 */

import { Graphics, Matrix, Texture, type Renderer } from 'pixi.js';
import { mulberry32 } from '@/utils/rng';
import { PALETTE, TILE_H, TILE_W, WALL_Z } from './config';

export class AssetManager {
  private readonly textures = new Map<string, Texture>();
  private renderer!: Renderer;

  /** Number of floor tile variants generated (render code cycles through them). */
  readonly floorVariants = 4;

  /** Generate and register all placeholder textures. Call once at boot. */
  init(renderer: Renderer): void {
    this.renderer = renderer;

    for (let v = 0; v < this.floorVariants; v++) {
      this.register(`floor_${v}`, this.buildFloorTile(v));
    }
    this.register('wall', this.buildWallBlock());
    this.register('mote', this.buildMote());
    this.register('pathDot', this.buildPathDot());
    this.register('brazier', this.buildBrazier());
    this.register('glow', this.buildGlow());
    this.register('fogPatch', this.buildFogPatch());
    this.register('rune', this.buildRune());
    // Paperdoll overlays: drawn light-grey on the 36×52 marker canvas so they
    // align with the body when feet-anchored; tinted per item at equip time.
    this.register('pd_mainHand', this.buildOverlayMainHand());
    this.register('pd_bow', this.buildOverlayBow());
    this.register('pd_wand', this.buildOverlayWand());
    this.register('bolt', this.buildBolt());
    this.register('pd_offHand', this.buildOverlayOffHand());
    this.register('pd_head', this.buildOverlayHead());
    this.register('pd_torso', this.buildOverlayTorso());
    this.register('pd_legs', this.buildOverlayLegs());
    this.register('pd_cloak', this.buildOverlayCloak());
    this.register('marker_warrior', this.buildUnitMarker(PALETTE.playerWarrior));
    this.register('marker_mage', this.buildUnitMarker(PALETTE.playerMage));
    this.register('marker_ranger', this.buildUnitMarker(PALETTE.playerRanger));
    this.register('marker_rogue', this.buildUnitMarker(PALETTE.playerRogue));
    // Enemy archetypes: distinct silhouettes (small imp / bulky corpse / thin bones).
    this.register('marker_fallen', this.buildEnemyMarker(0xc23c28, 0.78, 0.72));
    this.register('marker_zombie', this.buildEnemyMarker(0x5a7a4a, 1.35, 0.95));
    this.register('marker_archer', this.buildEnemyMarker(0xcfc8b8, 0.7, 1.12));
    this.register('slash', this.buildSlashArc());
    this.register('arrow', this.buildArrow());
    this.register('stairs_down', this.buildStairsDown());
    this.register('splat', this.buildCorpseSplat());
    this.register('shadow', this.buildShadow());
    this.register('targetRing', this.buildTargetRing());
    this.register('waystone', this.buildWaystone());
    this.register('chest_closed', this.buildChest(false));
    this.register('chest_open', this.buildChest(true));
  }

  /** Register an already-built texture (atlas singles reused as floor tiles, it.39). */
  registerTexture(key: string, tex: Texture): void {
    this.textures.set(key, tex);
  }

  has(key: string): boolean {
    return this.textures.has(key);
  }

  /** Fetch a texture by key. Throws on unknown keys — fail loudly, never render blanks. */
  get(key: string): Texture {
    const tex = this.textures.get(key);
    if (!tex) throw new Error(`[AssetManager] Unknown texture key: "${key}"`);
    return tex;
  }

  /** Destroy all generated textures (scene teardown / memory cleanup). */
  destroy(): void {
    for (const tex of this.textures.values()) tex.destroy(true);
    this.textures.clear();
  }

  private register(key: string, graphics: Graphics): void {
    const tex = this.renderer.generateTexture({ target: graphics, antialias: false });
    graphics.destroy();
    this.textures.get(key)?.destroy(true); // Replacing (e.g. stone floors) frees the old texture.
    this.textures.set(key, tex);
  }

  /**
   * Rebuild floors AND walls from the REAL stone texture (Lords of Pain
   * `ground_stone1`, a seamless 256² square). Floors sample per-variant
   * offsets through the tile diamond; the wall block texture-fills each of
   * its three faces with directional shading so architecture and ground
   * share one material language. Call once after the pack loads.
   */
  buildStoneEnvironment(stone: Texture): void {
    // The proven floors-1-2 look, built FOUR times: the base set plus three
    // depth bands that differ ONLY by a subtle multiply tint (it.17 revert:
    // identical rendering/layout everywhere, palette is the only variable).
    this.buildStoneWall(stone, '', 0xffffff);
    this.buildStoneFloors(stone, '', 0xffffff);
    this.buildStoneWall(stone, '_deep', 0xb2acc0);
    this.buildStoneFloors(stone, '_deep', 0xb2acc0);
    this.buildStoneWall(stone, '_frost', 0x9cb2dc);
    this.buildStoneFloors(stone, '_frost', 0x9cb2dc);
    this.buildStoneWall(stone, '_ember', 0xd2a488);
    this.buildStoneFloors(stone, '_ember', 0xd2a488);
  }


  /** Stone-textured wall block replacing the flat procedural faces. */
  private buildStoneWall(stone: Texture, suffix = '', mul = 0xffffff): void {
    const g = new Graphics();
    const w = TILE_W;
    const h = TILE_H;
    const z = WALL_Z;

    const leftFace = [0, h / 2, w / 2, h, w / 2, h + z, 0, h / 2 + z];
    const rightFace = [w / 2, h, w, h / 2, w, h / 2 + z, w / 2, h + z];
    const topFace = [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2];

    // Faces share the stone material at slightly different samples; `mul`
    // is the band's subtle palette shift (identical geometry & shading).
    g.poly(leftFace).fill({ texture: stone, matrix: new Matrix().scale(0.42, 0.42).translate(-30, -10), color: mul });
    g.poly(leftFace).fill({ color: 0x08070c, alpha: 0.62 }); // Deep shade (away from light).
    g.poly(rightFace).fill({ texture: stone, matrix: new Matrix().scale(0.42, 0.42).translate(-95, -40), color: mul });
    g.poly(rightFace).fill({ color: 0x0c0a12, alpha: 0.45 });
    g.poly(topFace).fill({ texture: stone, matrix: new Matrix().scale(0.5, 0.25).translate(0, 0), color: mul });
    g.poly(topFace).fill({ color: 0x2c2836, alpha: 0.28 }); // Cool cap sheen.

    // Mortar seams on the faces.
    for (let i = 1; i < 3; i++) {
      const yOff = (z / 3) * i;
      g.moveTo(0, h / 2 + yOff)
        .lineTo(w / 2, h + yOff)
        .stroke({ width: 1, color: PALETTE.wallEdge, alpha: 0.55 });
      g.moveTo(w / 2, h + yOff)
        .lineTo(w, h / 2 + yOff)
        .stroke({ width: 1, color: PALETTE.wallEdge, alpha: 0.55 });
    }
    // Silhouette edges keep the block crisp against floors.
    g.poly(topFace).stroke({ width: 1, color: PALETTE.wallEdge });
    g.moveTo(0, h / 2)
      .lineTo(0, h / 2 + z)
      .lineTo(w / 2, h + z)
      .lineTo(w, h / 2 + z)
      .lineTo(w, h / 2)
      .stroke({ width: 1, color: PALETTE.wallEdge });
    this.register(`wall${suffix}`, g);
  }

  private buildStoneFloors(stone: Texture, suffix = '', mul = 0xffffff): void {
    for (let v = 0; v < this.floorVariants; v++) {
      const g = new Graphics();
      const rand = mulberry32(4242 + v * 77);
      const w = TILE_W;
      const h = TILE_H;
      // Sample a different patch of stone per variant (texture-space matrix).
      const m = new Matrix()
        .scale(0.38 + rand() * 0.1, 0.38 + rand() * 0.1)
        .translate(-rand() * 120, -rand() * 120);
      g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]).fill({ texture: stone, matrix: m, color: mul });
      // Slight per-variant tone shift so the floor doesn't tile visibly.
      g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]).fill({
        color: v % 2 === 0 ? 0x2a251f : 0x000000,
        alpha: 0.1 + rand() * 0.1,
      });
      // Cracks + edge line (same grime pass as the procedural tiles).
      const cracks = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < cracks; i++) {
        let cx = w * (0.3 + rand() * 0.4);
        let cy = h * (0.3 + rand() * 0.4);
        g.moveTo(cx, cy);
        for (let s = 0; s < 2 + Math.floor(rand() * 3); s++) {
          cx += (rand() - 0.5) * 14;
          cy += (rand() - 0.5) * 7;
          g.lineTo(cx, cy);
        }
        g.stroke({ width: 1, color: PALETTE.floorLine, alpha: 0.5 });
      }
      g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]).stroke({
        width: 1,
        color: PALETTE.floorLine,
        alpha: 0.85,
      });
      this.register(`floor_${v}${suffix}`, g);
    }
  }

  /** Diamond floor tile: layered stone tones + hairline cracks. */
  private buildFloorTile(variant: number): Graphics {
    const g = new Graphics();
    const rand = mulberry32(1337 + variant * 101);
    const w = TILE_W;
    const h = TILE_H;

    // Base diamond.
    const base = variant % 2 === 0 ? PALETTE.floorBase : PALETTE.floorLight;
    g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]).fill(base);

    // Inner shading diamond for depth.
    const inset = 3 + rand() * 2;
    g.poly([w / 2, inset, w - inset * 2, h / 2, w / 2, h - inset, inset * 2, h / 2]).fill({
      color: PALETTE.floorDark,
      alpha: 0.25 + rand() * 0.2,
    });

    // Cracks: short jagged polylines clipped near the center.
    const cracks = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < cracks; i++) {
      let cx = w * (0.3 + rand() * 0.4);
      let cy = h * (0.3 + rand() * 0.4);
      g.moveTo(cx, cy);
      const segments = 2 + Math.floor(rand() * 3);
      for (let s = 0; s < segments; s++) {
        cx += (rand() - 0.5) * 14;
        cy += (rand() - 0.5) * 7;
        g.lineTo(cx, cy);
      }
      g.stroke({ width: 1, color: PALETTE.floorLine, alpha: 0.7 });
    }

    // Crisp edge outline to sell the tiled-flagstone look.
    g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]).stroke({
      width: 1,
      color: PALETTE.floorLine,
      alpha: 0.9,
    });
    return g;
  }

  /** Extruded wall block: raised top diamond + shaded left/right faces + brick seams. */
  private buildWallBlock(): Graphics {
    const g = new Graphics();
    const w = TILE_W;
    const h = TILE_H;
    const z = WALL_Z;

    // Left face (darkest — light source implied top-right).
    g.poly([0, h / 2, w / 2, h, w / 2, h + z, 0, h / 2 + z]).fill(PALETTE.wallLeft);
    // Right face.
    g.poly([w / 2, h, w, h / 2, w, h / 2 + z, w / 2, h + z]).fill(PALETTE.wallRight);
    // Top face.
    g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]).fill(PALETTE.wallTop);

    // Brick seams on faces.
    for (let i = 1; i < 3; i++) {
      const yOff = (z / 3) * i;
      g.moveTo(0, h / 2 + yOff)
        .lineTo(w / 2, h + yOff)
        .stroke({ width: 1, color: PALETTE.wallEdge, alpha: 0.6 });
      g.moveTo(w / 2, h + yOff)
        .lineTo(w, h / 2 + yOff)
        .stroke({ width: 1, color: PALETTE.wallEdge, alpha: 0.6 });
    }

    // Silhouette edges.
    g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]).stroke({ width: 1, color: PALETTE.wallEdge });
    g.moveTo(0, h / 2)
      .lineTo(0, h / 2 + z)
      .lineTo(w / 2, h + z)
      .lineTo(w, h / 2 + z)
      .lineTo(w, h / 2)
      .stroke({ width: 1, color: PALETTE.wallEdge });
    return g;
  }

  /** Soft warm speck for ember/dust ambience particles (additive blending). */
  private buildMote(): Graphics {
    const g = new Graphics();
    g.circle(4, 4, 4).fill({ color: 0xffb060, alpha: 0.22 });
    g.circle(4, 4, 2).fill({ color: 0xffd9a0, alpha: 0.55 });
    g.circle(4, 4, 0.9).fill({ color: 0xfff3dc, alpha: 0.95 });
    return g;
  }

  /** Small glowing diamond marking the current click-to-move destination. */
  private buildPathDot(): Graphics {
    const g = new Graphics();
    g.poly([8, 0, 16, 4, 8, 8, 0, 4]).stroke({ width: 2, color: PALETTE.pathMarker, alpha: 0.9 });
    g.poly([8, 2, 12, 4, 8, 6, 4, 4]).fill({ color: PALETTE.pathMarker, alpha: 0.5 });
    return g;
  }

  /** Iron brazier: squat pedestal + coal bowl. Feet-anchored like a unit. */
  private buildBrazier(): Graphics {
    const g = new Graphics();
    const cx = 14;
    const feetY = 34;
    g.ellipse(cx, feetY, 11, 4.5).fill({ color: 0x000000, alpha: 0.45 });
    // Column.
    g.poly([cx - 3, feetY, cx - 2, 16, cx + 2, 16, cx + 3, feetY]).fill(0x2c2830);
    // Bowl.
    g.ellipse(cx, 14, 10, 4).fill(0x38323e);
    g.ellipse(cx, 12, 8, 3).fill(0x1c1820);
    // Coals (self-lit — bright even before tinting).
    g.ellipse(cx, 11.5, 6, 2.2).fill(0xff8c3a);
    g.ellipse(cx, 11, 3.5, 1.4).fill(0xffd9a0);
    // Rim + legs.
    g.ellipse(cx, 14, 10, 4).stroke({ width: 1, color: 0x121016 });
    g.moveTo(cx - 8, feetY - 1).lineTo(cx - 6, 17).stroke({ width: 1.5, color: 0x242028 });
    g.moveTo(cx + 8, feetY - 1).lineTo(cx + 6, 17).stroke({ width: 1.5, color: 0x242028 });
    return g;
  }

  /** Soft radial glow disc (additive blending; tinted per source). */
  private buildGlow(): Graphics {
    const g = new Graphics();
    g.circle(32, 32, 32).fill({ color: 0xffffff, alpha: 0.05 });
    g.circle(32, 32, 22).fill({ color: 0xffffff, alpha: 0.09 });
    g.circle(32, 32, 13).fill({ color: 0xffffff, alpha: 0.16 });
    g.circle(32, 32, 6).fill({ color: 0xffffff, alpha: 0.28 });
    return g;
  }

  /**
   * Low crypt mist: a wide, very soft ellipse (isometric ground-hugging).
   * White at build; Ambience tints it cool and keeps alpha extremely low —
   * atmosphere, never clutter.
   */
  private buildFogPatch(): Graphics {
    const g = new Graphics();
    g.ellipse(70, 26, 70, 26).fill({ color: 0xffffff, alpha: 0.045 });
    g.ellipse(70, 26, 52, 19).fill({ color: 0xffffff, alpha: 0.06 });
    g.ellipse(70, 26, 34, 12).fill({ color: 0xffffff, alpha: 0.07 });
    return g;
  }

  /** Arcane floor rune: glyph strokes in a tile-aligned diamond. White; tinted at use. */
  private buildRune(): Graphics {
    const g = new Graphics();
    const w = 44;
    const h = 22;
    g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]).stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
    g.poly([w / 2, 4, w - 8, h / 2, w / 2, h - 4, 8, h / 2]).stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
    g.circle(w / 2, h / 2, 3).stroke({ width: 1.2, color: 0xffffff, alpha: 0.9 });
    g.moveTo(w / 2, 2).lineTo(w / 2, h - 2).stroke({ width: 1, color: 0xffffff, alpha: 0.55 });
    g.moveTo(6, h / 2).lineTo(w - 6, h / 2).stroke({ width: 1, color: 0xffffff, alpha: 0.55 });
    return g;
  }

  // ---- Paperdoll overlays (36×52 canvas, cx=18, feet at y=46) ----

  /**
   * Pin the graphics bounds to the full 36×52 marker canvas with two
   * near-invisible corner dots, so `generateTexture` (which trims to drawn
   * bounds) yields textures that align 1:1 with the body sprite when
   * feet-anchored. Every overlay builder MUST call this first.
   */
  private pinOverlayCanvas(g: Graphics): Graphics {
    g.rect(0, 0, 1, 1).fill({ color: 0x000000, alpha: 0.01 });
    g.rect(35, 51, 1, 1).fill({ color: 0x000000, alpha: 0.01 });
    return g;
  }

  private buildOverlayMainHand(): Graphics {
    const g = this.pinOverlayCanvas(new Graphics());
    // Blade held at the right flank, tip up.
    g.poly([29, 8, 32, 12, 30, 34, 27, 34]).fill(0xe8e8e8);
    g.rect(26.5, 33, 5, 2.5).fill(0xcccccc); // crossguard
    g.rect(28, 35.5, 2, 5).fill(0x999999); // grip
    g.poly([29, 8, 32, 12, 30, 34, 27, 34]).stroke({ width: 1, color: 0x101014 });
    return g;
  }

  private buildOverlayBow(): Graphics {
    const g = this.pinOverlayCanvas(new Graphics());
    // Recurve bow held at the right flank, string toward the body.
    g.arc(26, 24, 13, -1.35, 1.35).stroke({ width: 2.5, color: 0xe0e0e0 });
    g.moveTo(29, 11.5).lineTo(29, 36.5).stroke({ width: 1, color: 0xbbbbbb, alpha: 0.9 });
    g.circle(38.5, 24, 1.6).fill(0xcccccc); // Grip nub at the belly.
    return g;
  }

  private buildOverlayWand(): Graphics {
    const g = this.pinOverlayCanvas(new Graphics());
    // Slender rod with a glowing focus orb.
    g.moveTo(27, 36).lineTo(31, 12).stroke({ width: 2.5, color: 0xd8d8d8 });
    g.circle(31.5, 9.5, 3.5).fill(0xffffff);
    g.circle(31.5, 9.5, 3.5).stroke({ width: 1, color: 0x101014 });
    g.circle(31.5, 9.5, 1.4).fill({ color: 0xfff2dc, alpha: 0.95 });
    return g;
  }

  /** Glowing magic bolt projectile (additive; tinted per weapon). */
  private buildBolt(): Graphics {
    const g = new Graphics();
    g.circle(7, 7, 7).fill({ color: 0xffffff, alpha: 0.14 });
    g.circle(7, 7, 4.2).fill({ color: 0xffffff, alpha: 0.4 });
    g.circle(7, 7, 2.2).fill({ color: 0xffffff, alpha: 0.95 });
    g.ellipse(2.5, 7, 4, 1.6).fill({ color: 0xffffff, alpha: 0.3 }); // Trailing tail (-x).
    return g;
  }

  private buildOverlayOffHand(): Graphics {
    const g = this.pinOverlayCanvas(new Graphics());
    // Round shield on the left flank.
    g.ellipse(7, 26, 6.5, 8.5).fill(0xd8d8d8);
    g.ellipse(7, 26, 6.5, 8.5).stroke({ width: 1.2, color: 0x101014 });
    g.ellipse(7, 26, 3, 4).stroke({ width: 1, color: 0x8a8a8a });
    g.circle(7, 26, 1.4).fill(0x707070);
    return g;
  }

  private buildOverlayHead(): Graphics {
    const g = this.pinOverlayCanvas(new Graphics());
    // Helm cap crowning the crystal.
    g.poly([18, 1, 26, 9, 24, 13, 12, 13, 10, 9]).fill(0xe0e0e0);
    g.poly([18, 1, 26, 9, 24, 13, 12, 13, 10, 9]).stroke({ width: 1, color: 0x101014 });
    g.moveTo(18, 1).lineTo(18, 13).stroke({ width: 1, color: 0x9a9a9a });
    return g;
  }

  private buildOverlayTorso(): Graphics {
    const g = this.pinOverlayCanvas(new Graphics());
    // Chest band across the body.
    g.poly([9, 18, 27, 18, 26, 28, 10, 28]).fill({ color: 0xdddddd, alpha: 0.95 });
    g.poly([9, 18, 27, 18, 26, 28, 10, 28]).stroke({ width: 1, color: 0x101014 });
    g.moveTo(18, 18).lineTo(18, 28).stroke({ width: 1, color: 0x9a9a9a });
    return g;
  }

  private buildOverlayLegs(): Graphics {
    const g = this.pinOverlayCanvas(new Graphics());
    // Greaves at the base.
    g.poly([11, 36, 25, 36, 24, 44, 12, 44]).fill({ color: 0xd0d0d0, alpha: 0.95 });
    g.poly([11, 36, 25, 36, 24, 44, 12, 44]).stroke({ width: 1, color: 0x101014 });
    return g;
  }

  private buildOverlayCloak(): Graphics {
    const g = this.pinOverlayCanvas(new Graphics());
    // Shoulder mantle draping the flanks.
    g.poly([8, 14, 12, 12, 12, 38, 8, 34]).fill({ color: 0xcccccc, alpha: 0.9 });
    g.poly([28, 14, 24, 12, 24, 38, 28, 34]).fill({ color: 0xcccccc, alpha: 0.9 });
    g.poly([8, 14, 12, 12, 12, 38, 8, 34]).stroke({ width: 1, color: 0x101014 });
    g.poly([28, 14, 24, 12, 24, 38, 28, 34]).stroke({ width: 1, color: 0x101014 });
    return g;
  }

  /**
   * Soft grounded shadow — a SEPARATE sprite so bodies can hop/bob while the
   * shadow stays planted on the floor (baked-in shadows made units "float").
   */
  private buildShadow(): Graphics {
    // SOFT SHADOW (it.48): twelve feathered rings — a dense core, no hard rim.
    const g = new Graphics();
    for (let i = 12; i >= 1; i--) {
      const t = i / 12;
      g.ellipse(16, 7, 16 * t, 7 * t).fill({ color: 0x000000, alpha: 0.032 + (1 - t) * 0.03 });
    }
    return g;
  }

  /** Pulsing target bracket: a red diamond ring shown under the current foe. */
  private buildTargetRing(): Graphics {
    const g = new Graphics();
    const w = 46;
    const h = 23;
    g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]).stroke({ width: 2.5, color: 0xd83c28, alpha: 0.95 });
    g.poly([w / 2, 3.5, w - 7, h / 2, w / 2, h - 3.5, 7, h / 2]).stroke({
      width: 1,
      color: 0xff8a6a,
      alpha: 0.6,
    });
    return g;
  }

  /** Iron-banded wooden chest (closed or open with a treasure glow). */
  private buildChest(open: boolean): Graphics {
    const g = new Graphics();
    const cx = 20;
    const feetY = 34;
    g.ellipse(cx, feetY, 16, 6).fill({ color: 0x000000, alpha: 0.4 });
    // Body box (isometric-ish faces).
    g.poly([cx - 14, feetY - 4, cx, feetY + 2, cx + 14, feetY - 4, cx + 14, feetY - 14, cx, feetY - 8, cx - 14, feetY - 14]).fill(0x6a4a2c);
    g.poly([cx - 14, feetY - 4, cx, feetY + 2, cx, feetY - 8, cx - 14, feetY - 14]).fill({ color: 0x000000, alpha: 0.25 });
    if (open) {
      // Lid thrown back + inner glow.
      g.poly([cx - 14, feetY - 14, cx, feetY - 8, cx + 14, feetY - 14, cx + 10, feetY - 26, cx - 10, feetY - 26]).fill({ color: 0xffd977, alpha: 0.35 });
      g.ellipse(cx, feetY - 11, 10, 4).fill({ color: 0xffcf60, alpha: 0.85 });
      g.poly([cx - 15, feetY - 15, cx - 4, feetY - 30, cx + 12, feetY - 30, cx + 15, feetY - 15, cx, feetY - 21]).fill(0x59401f);
      g.poly([cx - 15, feetY - 15, cx - 4, feetY - 30, cx + 12, feetY - 30, cx + 15, feetY - 15, cx, feetY - 21]).stroke({ width: 1, color: 0x1c130a });
    } else {
      // Domed lid.
      g.poly([cx - 14, feetY - 14, cx, feetY - 8, cx + 14, feetY - 14, cx + 12, feetY - 22, cx, feetY - 17, cx - 12, feetY - 22]).fill(0x7a5836);
      g.poly([cx - 14, feetY - 14, cx, feetY - 8, cx, feetY - 17, cx - 12, feetY - 22]).fill({ color: 0x000000, alpha: 0.22 });
    }
    // Iron bands + lock.
    g.moveTo(cx, feetY + 2).lineTo(cx, feetY - (open ? 8 : 17)).stroke({ width: 3, color: 0x3a3a42 });
    g.poly([cx - 3, feetY - 6, cx + 3, feetY - 6, cx + 3, feetY - 1, cx - 3, feetY - 1]).fill(0x8a8a94);
    // Outline.
    g.poly([cx - 14, feetY - 4, cx, feetY + 2, cx + 14, feetY - 4, cx + 14, feetY - 14, cx, feetY - 8, cx - 14, feetY - 14]).stroke({ width: 1, color: 0x1c130a });
    return g;
  }

  /** Waystone: a runed standing stone marking the dungeon entrance. */
  private buildWaystone(): Graphics {
    const g = new Graphics();
    const cx = 16;
    const feetY = 50;
    g.ellipse(cx, feetY, 13, 5).fill({ color: 0x000000, alpha: 0.4 });
    // Weathered monolith with a beveled edge.
    g.poly([cx - 9, feetY, cx - 10, 14, cx - 6, 6, cx + 4, 4, cx + 9, 12, cx + 8, feetY]).fill(0x4a4454);
    g.poly([cx - 9, feetY, cx - 10, 14, cx - 6, 6, cx - 2, 5, cx - 3, feetY]).fill({
      color: 0x000000,
      alpha: 0.25,
    });
    g.poly([cx - 9, feetY, cx - 10, 14, cx - 6, 6, cx + 4, 4, cx + 9, 12, cx + 8, feetY]).stroke({
      width: 1.2,
      color: 0x16131c,
    });
    // Glowing sigil.
    g.circle(cx + 1, 22, 4.5).stroke({ width: 1.5, color: 0x9a86ff, alpha: 0.95 });
    g.moveTo(cx + 1, 15).lineTo(cx + 1, 29).stroke({ width: 1.2, color: 0x9a86ff, alpha: 0.8 });
    g.moveTo(cx - 4, 22).lineTo(cx + 6, 22).stroke({ width: 1.2, color: 0x9a86ff, alpha: 0.8 });
    return g;
  }

  /** Hostile crystal marker with an eye glyph, scaled to a distinct silhouette. */
  private buildEnemyMarker(color: number, widthScale: number, heightScale: number): Graphics {
    const g = new Graphics();
    const cx = 18;
    const feetY = 46;
    const w = (dx: number) => cx + dx * widthScale;
    const top = feetY - 42 * heightScale;
    const shoulder = feetY - 32 * heightScale;
    const hip = feetY - 8 * heightScale;

    const poly = [cx, top, w(10), shoulder, w(8), hip, cx, feetY - 2, w(-8), hip, w(-10), shoulder];
    g.poly(poly).fill(color);
    g.poly([cx, top, cx, feetY - 2, w(-8), hip, w(-10), shoulder]).fill({ color: 0x000000, alpha: 0.28 });
    g.moveTo(cx, top)
      .lineTo(w(10), shoulder)
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.3 });
    g.poly(poly).stroke({ width: 1, color: 0x0a0a0c });
    const eyeY = top + (shoulder - top) * 0.9;
    g.ellipse(cx, eyeY, 5 * widthScale, 3).fill(PALETTE.enemyEye);
    g.circle(cx, eyeY, 1.5).fill(0x1a0000);
    return g;
  }

  /** Crescent slash arc flashed at the strike frame (tinted by outcome). */
  private buildSlashArc(): Graphics {
    const g = new Graphics();
    // Crescent: thick arc from -60° to +60°.
    g.arc(4, 20, 22, -1.1, 1.1).stroke({ width: 5, color: 0xffffff, alpha: 0.85 });
    g.arc(4, 20, 15, -0.9, 0.9).stroke({ width: 2.5, color: 0xffffff, alpha: 0.5 });
    return g;
  }

  /** Skeletal arrow: shaft + head + fletching, drawn pointing +x. */
  private buildArrow(): Graphics {
    const g = new Graphics();
    g.moveTo(0, 3).lineTo(16, 3).stroke({ width: 1.5, color: 0xcbb894 });
    g.poly([16, 0.5, 21, 3, 16, 5.5]).fill(0xd8d8e0);
    g.poly([0, 0.5, 4, 3, 0, 5.5]).fill({ color: 0x8a8070, alpha: 0.9 });
    return g;
  }

  /**
   * A PROPER descending staircase (it.17, classic-ARPG style): a sunken
   * stairwell aligned with the tile diamond — alternating lit stone treads
   * and dark risers stepping down toward the far corner, flanked by
   * masonry side walls, ending in a black passage threshold. Reads as
   * stairs leading DOWN into the next floor, not a hole.
   */
  private buildStairsDown(): Graphics {
    const g = new Graphics();
    const w = TILE_W;
    const h = TILE_H;
    const steps = 5;
    // Diamond half-width at a given y (clip guide).
    const halfW = (y: number): number => (y <= h / 2 ? (w / 2) * (y / (h / 2)) : (w / 2) * ((h - y) / (h / 2)));
    // Tread stone tones matched to the floor material (warm greys → dark).
    const TREAD = [0x6b6156, 0x584f46, 0x453d37, 0x322c28, 0x201c1a];
    const startY = 3;
    const endY = h - 3;
    const span = endY - startY;
    for (let k = 0; k < steps; k++) {
      const y0 = startY + (span * k) / steps;
      const y1 = startY + (span * (k + 0.72)) / steps; // Tread top face.
      const y2 = startY + (span * (k + 1)) / steps; // Riser face.
      const narrow = 1 - k * 0.14; // The well converges with depth.
      const hw0 = Math.max(2, halfW(y0) * narrow - 2);
      const hw1 = Math.max(2, halfW(y1) * narrow - 2);
      const hw2 = Math.max(1, halfW(y2) * Math.max(0.2, narrow - 0.14) - 2);
      // Tread (lit top face, dimming with depth).
      g.poly([w / 2 - hw0, y0, w / 2 + hw0, y0, w / 2 + hw1, y1, w / 2 - hw1, y1]).fill(TREAD[k]);
      // Riser (shadowed vertical face).
      g.poly([w / 2 - hw1, y1, w / 2 + hw1, y1, w / 2 + hw2, y2, w / 2 - hw2, y2]).fill(0x0e0c10);
      // Tread front lip catches the torchlight.
      g.moveTo(w / 2 - hw0, y0)
        .lineTo(w / 2 + hw0, y0)
        .stroke({ width: 1, color: 0x8a7f6e, alpha: Math.max(0.15, 0.7 - k * 0.15) });
    }
    // The passage threshold at the flight's bottom: pure dark.
    const hwEnd = Math.max(4, halfW(endY - 2) * 0.36);
    g.poly([w / 2 - hwEnd, endY - 4, w / 2 + hwEnd, endY - 4, w / 2 + 2, endY + 1, w / 2 - 2, endY + 1]).fill(
      0x000000,
    );
    // Masonry side flanks of the sunken well.
    g.poly([2, h / 2, w / 2 - 4, startY + 2, w / 2 - 4, endY - 2, 2, h / 2 + 1]).fill({ color: 0x211e26, alpha: 0.9 });
    g.poly([w - 2, h / 2, w / 2 + 4, startY + 2, w / 2 + 4, endY - 2, w - 2, h / 2 + 1]).fill({
      color: 0x2a2630,
      alpha: 0.9,
    });
    // Stone rim: the opening's edge, aligned with the tile diamond.
    g.poly([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]).stroke({ width: 2, color: 0x5a5348 });
    g.poly([w / 2, 2, w - 4, h / 2, w / 2, h - 2, 4, h / 2]).stroke({ width: 1, color: 0x14110e });
    return g;
  }

  /** Dark corpse stain left where an enemy fell. */
  private buildCorpseSplat(): Graphics {
    const g = new Graphics();
    g.ellipse(16, 8, 15, 7).fill({ color: 0x1a0d0a, alpha: 0.75 });
    g.ellipse(12, 7, 6, 3).fill({ color: 0x2c1210, alpha: 0.8 });
    g.ellipse(22, 10, 5, 2.5).fill({ color: 0x120806, alpha: 0.85 });
    return g;
  }

  /**
   * Geometric unit marker: grounded shadow ellipse + upright crystal shape.
   * Texture anchor is set at the feet by the entity that instantiates it.
   */
  private buildUnitMarker(color: number, hostile = false): Graphics {
    const g = new Graphics();
    const cx = 18;

    // Crystal body: elongated hexagon (shadow is a separate sprite now).
    g.poly([cx, 4, cx + 10, 14, cx + 8, 38, cx, 44, cx - 8, 38, cx - 10, 14]).fill(color);
    // Left-side shade + inner facet lines for pseudo-3D depth.
    g.poly([cx, 4, cx, 44, cx - 8, 38, cx - 10, 14]).fill({ color: 0x000000, alpha: 0.28 });
    g.moveTo(cx, 4).lineTo(cx + 3, 24).lineTo(cx, 44).stroke({ width: 1, color: 0xffffff, alpha: 0.14 });
    g.moveTo(cx + 10, 14)
      .lineTo(cx + 3, 24)
      .stroke({ width: 1, color: 0x000000, alpha: 0.2 });
    // Rim light.
    g.moveTo(cx, 4)
      .lineTo(cx + 10, 14)
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.35 });
    // Outline.
    g.poly([cx, 4, cx + 10, 14, cx + 8, 38, cx, 44, cx - 8, 38, cx - 10, 14]).stroke({
      width: 1,
      color: 0x0a0a0c,
    });

    if (hostile) {
      g.ellipse(cx, 18, 5, 3).fill(PALETTE.enemyEye);
      g.circle(cx, 18, 1.5).fill(0x1a0000);
    }
    return g;
  }
}

/** Shared singleton — initialized once in main.ts. */
export const assets = new AssetManager();
