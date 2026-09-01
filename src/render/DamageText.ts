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

  constructor(private readonly layer: Container) {}

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
          stroke: { color: 0x0a0806, width: 3 },
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
    ft.node.alpha = 1;
    ft.node.visible = true;
    ft.active = true;
    ft.life = 0;
    ft.maxLife = kind === 'crit' ? 1.1 : 0.85;
    ft.vy = kind === 'crit' ? 42 : 34;
  }

  /** Per-render-frame float + fade. */
  update(dt: number): void {
    for (const ft of this.pool) {
      if (!ft.active) continue;
      ft.life += dt;
      ft.node.position.y -= ft.vy * dt;
      ft.vy *= 1 - 1.6 * dt; // Ease off as it rises.
      const t = ft.life / ft.maxLife;
      ft.node.alpha = t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;
      if (t >= 1) {
        ft.active = false;
        ft.node.visible = false;
      }
    }
  }
}
