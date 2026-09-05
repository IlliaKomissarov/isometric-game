/**
 * @module systems/Status
 * STATUS EFFECTS ON FOES (it.80): bleed, poison, burn, chill, shock, stun.
 * Weapons proc them on landed hits (`CombatSystem` rolls the chance and
 * calls `inflict`); the class synergies and Poison Blade route through the
 * same maps. Damage over time goes through `CombatSystem.dealDamage` as a
 * PURE wound (no armor, no procs, no echo), credited to the hero who struck,
 * so kills, life-on-kill and the bestiary follow the same path as a blow.
 *
 * Strengths (power 1): bleed 60% of the hit over 4 s (8 bites), poison 80%
 * over 6 s (12 bites), burn 50% over 3 s (9 bites), chill 55% speed for
 * 3 s, shock 45% of the hit to the nearest other foe within 3 tiles, stun
 * 0.8 s. Wardens shrug off stuns and chills (the boss rule from Frost Nova).
 */

import type { Enemy } from '@/entities/Enemy';
import type { Proc, StatusKind } from '@/items/effects';
import { STATUS_INFO } from '@/items/effects';
import type { CombatSystem } from './Combat';

interface Dot {
  ticksLeft: number;
  nextBite: number;
  period: number;
  bite: number;
  sourceId: number;
}

export interface StatusDeps {
  enemyById: (id: number) => Enemy | null;
  enemiesNear: (x: number, y: number, r: number) => Enemy[];
  combat: () => CombatSystem;
  burst: (x: number, y: number, color: number, n: number) => void;
}

const DOT_TABLE: Record<'bleed' | 'poison' | 'burn', { share: number; ticks: number; period: number }> = {
  bleed: { share: 0.6, ticks: 240, period: 30 },
  poison: { share: 0.8, ticks: 360, period: 30 },
  burn: { share: 0.5, ticks: 180, period: 20 },
};

export class StatusSystem {
  private readonly dots = new Map<number, Map<StatusKind, Dot>>();

  constructor(private readonly deps: StatusDeps) {}

  /** A new floor: nothing carries over. */
  clear(): void {
    this.dots.clear();
  }

  /** Active statuses on a foe (for the HUD and the bestiary). */
  statusesOf(id: number): StatusKind[] {
    const m = this.dots.get(id);
    return m ? [...m.keys()] : [];
  }

  /** A DoT by explicit ticks and bite (the class synergies, Poison Blade). */
  dot(foeId: number, kind: 'bleed' | 'poison' | 'burn', ticks: number, period: number, bite: number, sourceId: number): void {
    let m = this.dots.get(foeId);
    if (!m) {
      m = new Map();
      this.dots.set(foeId, m);
    }
    const cur = m.get(kind);
    // A stronger or fresher wound replaces a weaker one; never stacks.
    if (cur && cur.bite > bite && cur.ticksLeft > ticks / 2) return;
    m.set(kind, { ticksLeft: ticks, nextBite: period, period, bite: Math.max(1, Math.round(bite)), sourceId });
  }

  /** A weapon proc landed: apply the status scaled by the hit that carried it. */
  inflict(foe: Enemy, proc: Proc, hitAmount: number, sourceId: number): void {
    if (foe.hp <= 0 || foe.action === 'dead') return;
    const boss = foe.def.kind.startsWith('boss');
    const p = proc.power;
    switch (proc.status) {
      case 'bleed':
      case 'poison':
      case 'burn': {
        const t = DOT_TABLE[proc.status];
        const bites = t.ticks / t.period;
        this.dot(foe.id, proc.status, t.ticks, t.period, (hitAmount * t.share * p) / bites, sourceId);
        this.deps.burst(foe.pos.x, foe.pos.y, STATUS_INFO[proc.status].color, 6);
        break;
      }
      case 'chill':
        if (boss) return;
        foe.chillTicks = Math.max(foe.chillTicks, 180);
        foe.chillFactor = Math.min(foe.chillFactor, 0.55 / p);
        this.deps.burst(foe.pos.x, foe.pos.y, STATUS_INFO.chill.color, 8);
        break;
      case 'shock': {
        let best: Enemy | null = null;
        let bd = 3;
        for (const other of this.deps.enemiesNear(foe.pos.x, foe.pos.y, 3)) {
          if (other === foe || other.hp <= 0 || other.action === 'dead') continue;
          const d = Math.hypot(other.pos.x - foe.pos.x, other.pos.y - foe.pos.y);
          if (d < bd) {
            bd = d;
            best = other;
          }
        }
        this.deps.burst(foe.pos.x, foe.pos.y, STATUS_INFO.shock.color, 8);
        if (best) {
          this.deps.combat().dealDamage({ sourceId, targetId: best.id, amount: Math.max(1, Math.round(hitAmount * 0.45 * p)), pure: true });
          this.deps.burst(best.pos.x, best.pos.y, STATUS_INFO.shock.color, 10);
        }
        break;
      }
      case 'stun':
        if (boss && foe.hitRecoveryTicks === 0) return;
        foe.action = 'hit';
        foe.actionTicks = Math.max(foe.actionTicks, Math.round(48 * p * (boss ? 0.5 : 1)));
        this.deps.burst(foe.pos.x, foe.pos.y, STATUS_INFO.stun.color, 6);
        break;
    }
  }

  /** Once per tick, after the systems: every wound bites on its period. */
  update(): void {
    for (const [id, m] of this.dots) {
      const foe = this.deps.enemyById(id);
      if (!foe || foe.hp <= 0 || foe.action === 'dead') {
        this.dots.delete(id);
        continue;
      }
      for (const [kind, dot] of m) {
        dot.ticksLeft--;
        dot.nextBite--;
        if (dot.nextBite <= 0) {
          dot.nextBite = dot.period;
          this.deps.combat().dealDamage({ sourceId: dot.sourceId, targetId: id, amount: dot.bite, pure: true });
          this.deps.burst(foe.pos.x, foe.pos.y, STATUS_INFO[kind].color, 4);
        }
        if (dot.ticksLeft <= 0) m.delete(kind);
      }
      if (m.size === 0) this.dots.delete(id);
    }
  }
}
