/**
 * @module render/DamageText
 * Floating combat numbers: post-armor damage floats up off the victim and
 * fades; crits flare big and gold; misses whiff grey. Pure render layer —
 * driven by `entity:damaged` / `combat:swing` handlers in main.
 *
 * Uses a pooled set of Pixi Text nodes (resolution 2 for crispness) in the
 * ambience layer so numbers ride above the world but under DOM UI.
 */

import { Text, type Container } from 'pixi.js';
import { vec2 } from '@/utils/Vec2';
import { worldToScreen } from '@/utils/iso';

interface FloatingText {
  active: boolean;
  node: Text;
  life: number;
  maxLife: number;
  vy: number;
}

export class DamageTextSystem {
  private readonly pool: FloatingText[] = [];
  private readonly scratch = vec2();
  /** 1/zoom (clamped): numbers keep a readable on-screen size at any zoom (it.41). */
  private zoomScale = 1;

  constructor(private readonly layer: Container) {}

  setZoom(zoom: number): void {
    this.zoomScale = Math.max(0.5, Math.min(1, 1 / Math.max(0.01, zoom)));
  }

  /**
   * @param kind  Styles the number: enemy damage (bone-white), player damage
   *              (blood-red), crit (large gold), miss (small grey).
   */
  show(x: number, y: number, text: string, kind: 'enemy' | 'player' | 'crit' | 'miss'): void {
    let ft = this.pool.find((t) => !t.active);
    if (!ft) {
      const node = new Text({
        text: '',
        style: {
          fontFamily: 'Georgia, serif',
          fontWeight: 'bold',
          fontSize: 15,
          fill: 0xffffff,
          stroke: { color: 0x0a0806, width: 4 },
          dropShadow: { color: 0x000000, alpha: 0.85, blur: 2, distance: 2, angle: Math.PI / 2 },
        },
        resolution: 2,
      });
      node.anchor.set(0.5, 1);
      node.visible = false;
      this.layer.addChild(node);
      ft = { active: false, node, life: 0, maxLife: 1, vy: 0 };
      this.pool.push(ft);
    }

    ft.node.text = text;
    const style = ft.node.style;
    if (kind === 'crit') {
      style.fill = 0xffc84a;
      style.fontSize = 21;
    } else if (kind === 'player') {
      style.fill = 0xe04a3a;
      style.fontSize = 16;
    } else if (kind === 'miss') {
      style.fill = 0x9a9aa8;
      style.fontSize = 12;
    } else {
      style.fill = 0xf0e8d8;
      style.fontSize = 15;
    }

    const s = worldToScreen(x, y, this.scratch);
    ft.node.position.set(s.x + (Math.random() - 0.5) * 14, s.y - 46);
    ft.node.scale.set(this.zoomScale);
    ft.node.alpha = 0.75; // Subtle (it.48): the numbers sit over the fight, not on top of it.
    ft.node.visible = true;
    ft.active = true;
    ft.life = 0;
    ft.maxLife = kind === 'crit' ? 1.25 : 1.0;
    ft.vy = kind === 'crit' ? 40 : 32;
  }

  /** Per-render-frame float + fade. */
  update(dt: number): void {
    for (const ft of this.pool) {
      if (!ft.active) continue;
      ft.life += dt;
      ft.node.position.y -= ft.vy * dt;
      ft.vy *= 1 - 2.0 * dt; // Smooth ease-out as it rises (it.48).
      const t = ft.life / ft.maxLife;
      ft.node.alpha = 0.75 * (t > 0.5 ? 1 - (t - 0.5) / 0.5 : 1);
      if (t >= 1) {
        ft.active = false;
        ft.node.visible = false;
      }
    }
  }
}
