/**
 * @module town/CampHeroes
 * The resting heroes (it.40): the three playable classes the delver did
 * NOT pick sit out the run around the campfire. They are real `Player`
 * rigs (the same atlases, scale and idle breathing as the hero) but
 * RENDER-ONLY — never registered in the GameState, never ticked, never
 * hit. Each faces the fire and is lit by the scene tint like everyone.
 */

import type { Container } from 'pixi.js';
import { ARCHETYPES, Player } from '@/entities/Player';
import type { ClassArchetype } from '@/network/Serialization';

const ALL: ClassArchetype[] = ['warrior', 'mage', 'ranger', 'rogue'];

export class CampHeroes {
  private readonly heroes: Player[] = [];

  constructor(layer: Container, chosen: ClassArchetype, spots: ReadonlyArray<{ x: number; y: number }>, fire: { x: number; y: number }) {
    const others = ALL.filter((c) => c !== chosen);
    others.forEach((cls, i) => {
      const spot = spots[i % spots.length];
      const hero = new Player(cls);
      hero.warpTo(spot.x, spot.y);
      // Face the flames.
      const dx = fire.x + 0.5 - spot.x;
      const dy = fire.y + 0.5 - spot.y;
      const len = Math.hypot(dx, dy) || 1;
      hero.facing.x = dx / len;
      hero.facing.y = dy / len;
      hero.action = 'idle';
      hero.enableKnightRig();
      layer.addChild(hero.container);
      this.heroes.push(hero);
    });
  }

  /** Names for the camp prompt ("Mage · Ranger · Rogue rest here"). */
  get names(): string[] {
    return this.heroes.map((h) => h.archetype[0].toUpperCase() + h.archetype.slice(1));
  }

  update(tint: (x: number, y: number) => number): void {
    for (const h of this.heroes) {
      h.setSceneTint(tint(h.pos.x, h.pos.y));
      h.syncRender(1);
    }
  }

  destroy(): void {
    for (const h of this.heroes) h.container.destroy({ children: true });
    this.heroes.length = 0;
  }
}

/** Sanity: every archetype the camp may show is a real class. */
export const CAMP_CLASSES: ReadonlyArray<ClassArchetype> = ALL.filter((c) => c in ARCHETYPES);
