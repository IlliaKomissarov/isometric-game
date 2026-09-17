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
import type { VfxAnim, VfxHandle, VfxOpts } from '@/render/Vfx';
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
  /** THE VISUALS (it.81): a floating name and an effect strip on the foe. */
  text?: (x: number, y: number, msg: string, style: 'crit' | 'miss') => void;
  vfx?: (anim: VfxAnim, x: number, y: number, opts?: VfxOpts) => VfxHandle | void;
  /**
   * A LOOPING STRIP THAT FOLLOWS THE FOE (it.115): the status's own aura,
   * kept by this system for the mark's whole life and stopped when the
   * mark ends or the foe dies. Optional — without it the loop is
   * re-anchored once per tick through `moveTo`.
   */
  vfxFollow?: (anim: VfxAnim, getPos: () => { x: number; y: number }, opts?: VfxOpts) => VfxHandle;
}

/** The looping aura per status (it.115): strip, size, blend, height. */
const LOOP_FX: Record<StatusKind, { anim: VfxAnim; opts: VfxOpts }> = {
  bleed: { anim: 'fx_blood_1_loop', opts: { scale: 0.45, lift: 16, fps: 10, alpha: 0.85, additive: false, loop: true } },
  poison: { anim: 'fx_status_poison', opts: { scale: 0.55, lift: 18, fps: 15, alpha: 0.75, loop: true } },
  burn: { anim: 'fx_fire_burst', opts: { scale: 0.7, lift: 20, fps: 24, alpha: 0.8, tint: 0xffa040, loop: true } },
  chill: { anim: 'fx_ice_pick', opts: { scale: 0.8, lift: 18, fps: 10, alpha: 0.8, tint: 0x9fd4ff, loop: true } },
  shock: { anim: 'fx_lightning_burst_a', opts: { scale: 0.8, lift: 20, fps: 15, alpha: 0.9, loop: true } },
  stun: { anim: 'fx_star_small', opts: { scale: 0.9, lift: 46, fps: 24, alpha: 0.95, loop: true } },
};

const LABEL: Record<StatusKind, string> = { bleed: 'BLEEDING', poison: 'POISONED', burn: 'BURNING', chill: 'CHILLED', shock: 'SHOCKED', stun: 'STUNNED' };
/** How long each mark stays above the head (DoTs follow their own clock). */
export const MARK_TICKS: Record<StatusKind, number> = { bleed: 240, poison: 360, burn: 180, chill: 180, shock: 30, stun: 48 };

export const DOT_TABLE: Record<'bleed' | 'poison' | 'burn', { share: number; ticks: number; period: number }> = {
  bleed: { share: 0.6, ticks: 240, period: 30 },
  poison: { share: 0.8, ticks: 360, period: 30 },
  burn: { share: 0.5, ticks: 180, period: 20 },
};

export class StatusSystem {
  private readonly dots = new Map<number, Map<StatusKind, Dot>>();
  /** foe id → status → ticks the mark stays (it.81). */
  private readonly marks = new Map<number, Map<StatusKind, number>>();
  /** foe id → status → the looping aura riding the foe (it.115), keyed like `marks`. */
  private readonly loops = new Map<number, Map<StatusKind, { h: VfxHandle; follow: boolean }>>();

  /** Start (or keep) the status's looping aura on the foe. */
  private startLoop(foe: Enemy, kind: StatusKind): void {
    let l = this.loops.get(foe.id);
    if (!l) {
      l = new Map();
      this.loops.set(foe.id, l);
    }
    if (l.has(kind)) return; // A refreshed mark keeps the running aura.
    const fx = LOOP_FX[kind];
    let h: VfxHandle | void;
    let follow = false;
    if (this.deps.vfxFollow) h = this.deps.vfxFollow(fx.anim, () => foe.pos, fx.opts);
    else {
      h = this.deps.vfx?.(fx.anim, foe.pos.x, foe.pos.y, fx.opts);
      follow = true;
    }
    if (h) l.set(kind, { h, follow });
  }

  /** Stop one status's aura, or all of a foe's when `kind` is omitted. */
  private stopLoop(id: number, kind?: StatusKind): void {
    const l = this.loops.get(id);
    if (!l) return;
    if (kind === undefined) {
      for (const e of l.values()) e.h.stop();
      this.loops.delete(id);
      return;
    }
    l.get(kind)?.h.stop();
    l.delete(kind);
    if (l.size === 0) this.loops.delete(id);
  }

  /** Show the status on the foe: the name floats up, the strip plays, the mark appears. */
  private show(foe: Enemy, kind: StatusKind, power = 1): void {
    let m = this.marks.get(foe.id);
    if (!m) {
      m = new Map();
      this.marks.set(foe.id, m);
    }
    const fresh = !m.has(kind);
    m.set(kind, Math.max(m.get(kind) ?? 0, Math.round(MARK_TICKS[kind] * (kind === 'stun' || kind === 'chill' ? power : 1))));
    const color = STATUS_INFO[kind].color;
    if (fresh) this.deps.text?.(foe.pos.x, foe.pos.y - 1.5, LABEL[kind], 'miss');
    const v = this.deps.vfx;
    if (!v) return;
    // THE ONSET (it.115): a one-shot at the moment the status lands.
    switch (kind) {
      case 'bleed':
        v('fx_splat_dir_a', foe.pos.x, foe.pos.y, { scale: 1.1, lift: 16, rotation: -Math.PI / 2, tint: 0xd02020 });
        break;
      case 'poison':
        v('fx_poison_claw', foe.pos.x, foe.pos.y, { scale: 0.6, lift: 18, overlay: true, alpha: 0.9 });
        break;
      case 'burn':
        v('fx_fire_burst', foe.pos.x, foe.pos.y, { scale: 1.1, lift: 20 });
        break;
      case 'chill':
        v('fx_ice_shatter_b', foe.pos.x, foe.pos.y, { scale: 0.8, lift: 18, tint: color });
        break;
      case 'shock':
        v('fx_lightning_burst_a', foe.pos.x, foe.pos.y, { scale: 1.1, lift: 20, overlay: true });
        break;
      case 'stun':
        v('fx_impact_a', foe.pos.x, foe.pos.y, { scale: 0.5, lift: 30, tint: color, alpha: 0.8 });
        break;
    }
    // THE LOOP: one aura per status per foe for the mark's whole life.
    this.startLoop(foe, kind);
  }

  constructor(private readonly deps: StatusDeps) {}

  /** A new floor: nothing carries over. */
  clear(): void {
    this.dots.clear();
    this.marks.clear();
    for (const id of [...this.loops.keys()]) this.stopLoop(id);
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
    const foe = this.deps.enemyById(foeId);
    if (foe) this.show(foe, kind);
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
        break;
      }
      case 'chill':
        if (boss) return;
        foe.chillTicks = Math.max(foe.chillTicks, 180);
        foe.chillFactor = Math.min(foe.chillFactor, 0.55 / p);
        this.deps.burst(foe.pos.x, foe.pos.y, STATUS_INFO.chill.color, 8);
        this.show(foe, 'chill');
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
        this.show(foe, 'shock');
        if (best) {
          this.deps.combat().dealDamage({ sourceId, targetId: best.id, amount: Math.max(1, Math.round(hitAmount * 0.45 * p)), pure: true });
          this.deps.burst(best.pos.x, best.pos.y, STATUS_INFO.shock.color, 10);
          // THE ARC (it.115): a bolt strikes where the charge jumps to.
          this.deps.vfx?.('fx_lightning_burst_a', best.pos.x, best.pos.y, { scale: 1.2, lift: 22, overlay: true });
          this.show(best, 'shock');
        }
        break;
      }
      case 'stun':
        if (boss && foe.hitRecoveryTicks === 0) return;
        foe.action = 'hit';
        foe.actionTicks = Math.max(foe.actionTicks, Math.round(48 * p * (boss ? 0.5 : 1)));
        this.deps.burst(foe.pos.x, foe.pos.y, STATUS_INFO.stun.color, 6);
        this.show(foe, 'stun', boss ? 0.5 : p);
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
          // THE BITE (it.115): every wound over time reads on the body as it lands.
          if (kind === 'bleed') this.deps.vfx?.('fx_splat_dir_a', foe.pos.x, foe.pos.y, { scale: 0.9, lift: 14, rotation: Math.PI * (0.5 + (dot.ticksLeft % 7) / 7), tint: 0xd02020 });
          else if (kind === 'burn') this.deps.vfx?.('fx_fire_burst', foe.pos.x, foe.pos.y, { scale: 0.8, lift: 18, alpha: 0.7 });
        }
        if (dot.ticksLeft <= 0) m.delete(kind);
      }
      if (m.size === 0) this.dots.delete(id);
    }
    // THE MARKS (it.81): count down, then redraw the gems and the tint.
    // THE AURAS (it.115) live and die with the marks.
    for (const [id, m] of this.marks) {
      const foe = this.deps.enemyById(id);
      if (!foe || foe.hp <= 0 || foe.action === 'dead') {
        foe?.setStatuses([]);
        this.marks.delete(id);
        this.stopLoop(id);
        continue;
      }
      let changed = false;
      for (const [kind, left] of m) {
        if (left <= 1) {
          m.delete(kind);
          this.stopLoop(id, kind);
          changed = true;
        } else m.set(kind, left - 1);
      }
      if (changed || m.size) foe.setStatuses([...m.keys()].map((k) => ({ color: STATUS_INFO[k].color, icon: STATUS_INFO[k].icon })));
      if (m.size === 0) {
        foe.setStatuses([]);
        this.marks.delete(id);
        this.stopLoop(id);
      }
      // Without a render-side follow hook the auras are re-anchored here, once a tick.
      const l = this.loops.get(id);
      if (l) for (const e of l.values()) if (e.follow) e.h.moveTo(foe.pos.x, foe.pos.y);
    }
    // An aura whose foe lost its marks some other way must not outlive them.
    for (const id of [...this.loops.keys()]) if (!this.marks.has(id)) this.stopLoop(id);
  }
}
