/**
 * @module systems/Skills
 * Active skills (it.32, progression it.41): the hero's four HOTBAR slots
 * hold any learned skill from any class path; casting pays a resource
 * cost and starts a cooldown. Cooldowns, timed buffs, ground zones
 * (firewall / traps / arrow rain), dashes, DoTs and staged cuts all tick
 * here.
 *
 * PROGRESSION (it.41): skill points, unlocks and the hotbar are hero state
 * mutated ONLY through UNLOCK_SKILL / UNLOCK_PASSIVE / EQUIP_SKILL
 * InputCommands applied inside the tick (the DOM tree never touches the
 * Player). CLASS SYNERGY: a skill of the hero's own class casts at +30%
 * power, 20% shorter cooldown, and lays its class status on every victim
 * (STAGGER / BURN / HOBBLE / POISON).
 *
 * DETERMINISM: casts arrive as 'SKILL' InputCommands and every effect
 * resolves through CombatSystem.dealDamage — the one legal hp mutator.
 * The system is world-agnostic: it reaches the CURRENT floor's systems
 * through the lazy accessors in `SkillDeps`. All VFX go out through
 * `deps.vfx` / `deps.burst` and never come back.
 */

import { eventBus } from '@/core/EventBus';
import type { InputCommand } from '@/core/InputQueue';
import type { Enemy } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import type { VfxAnim, VfxHandle, VfxOpts } from '@/render/Vfx';
import { canStandAt } from '@/systems/Collision';
import type { StatusSystem } from './Status';
import type { CombatSystem } from '@/systems/Combat';
import type { ProjectileSpawn } from '@/systems/Projectiles';
import { randInt } from '@/utils/rng';
import {
  CLASS_SKILLS,
  PASSIVE_BY_ID,
  SKILL_BY_ID,
  SYNERGY,
  canUnlockPassive,
  canUnlockSkill,
  skillCost,
  type SkillDef,
} from './SkillTree';
import type { ClassArchetype } from '@/network/Serialization';

export { CLASS_SKILLS, type SkillDef };

/** Lazy world accessors — always resolve against the CURRENT floor. */
export interface SkillDeps {
  player: Player;
  /** CO-OP (it.59): the seat this hero holds — only its own commands apply. */
  slot?: number;
  combat: () => CombatSystem;
  /** THE STATUS ENGINE (it.80): every wound over time lives there. */
  status: () => StatusSystem;
  enemiesNear: (x: number, y: number, r: number) => Enemy[];
  isWalkable: (gx: number, gy: number) => boolean;
  /** FX hooks (render-side; safe to no-op). */
  burst: (x: number, y: number, color: number, n: number) => void;
  glint: (x: number, y: number) => void;
  shake: (amount: number) => void;
  /** Respec is a town rite (it.48). */
  inTown: () => boolean;
  /** A cast interrupts the walk order at once (it.53). */
  interruptMove: () => void;
  text: (x: number, y: number, msg: string, style: 'crit' | 'miss') => void;
  sfx: (name: string) => void;
  /** Animated effect strips (it.41). */
  vfx: (anim: VfxAnim, x: number, y: number, opts?: VfxOpts) => VfxHandle;
  /**
   * A strip that shadows a moving body every render frame (it.115: buff
   * auras). Optional — without it the aura loops and is re-anchored once
   * per tick from `update()`.
   */
  vfxFollow?: (anim: VfxAnim, getPos: () => { x: number; y: number }, opts?: VfxOpts) => VfxHandle;
  /**
   * TARGETED CASTING (it.33): unit vector from the player toward the mouse
   * cursor's world point (falls back to facing) — every directional skill
   * fires where the player is AIMING, never into empty space behind them.
   */
  aim: () => { x: number; y: number };
  /** The cursor's exact world point, or null when the mouse was never seen. */
  aimPoint: () => { x: number; y: number } | null;
  /**
   * Persistent ground visual for a zone (trap rune / flame bed / rain
   * sigil); returns a dispose function. Render-side.
   */
  zoneVisual: (kind: 'trap' | 'fire' | 'rain', x: number, y: number) => () => void;
}

interface FirewallZone { kind: 'firewall'; cells: Array<{ x: number; y: number }>; ticksLeft: number; dispose: () => void; syn: Synergy }
interface TrapZone { kind: 'trap'; x: number; y: number; armTicks: number; ticksLeft: number; dispose: () => void; syn: Synergy }
interface RainZone { kind: 'rain'; x: number; y: number; wavesLeft: number; nextWave: number; dispose: () => void; syn: Synergy }
type Zone = FirewallZone | TrapZone | RainZone;

/** Power scale + class status a cast carries (captured at cast time for delayed effects). */
interface Synergy {
  scale: number;
  status: ClassArchetype | null;
}
const NO_SYNERGY: Synergy = { scale: 1, status: null };

/** A running strip owned by a skill: stopped when `until()` turns true (`h` null = a bare timer). */
interface OwnedFx {
  h: VfxHandle | null;
  until: () => boolean;
  /** Re-anchor to the hero each tick (only when `deps.vfxFollow` is absent). */
  follow: boolean;
  /** Runs once when the strip is stopped (the reappearance after Vanish). */
  onEnd?: () => void;
}

/** The fireball's trail, dead-reckoned along the shot (it.115). */
interface Trail {
  h: VfxHandle;
  x: number;
  y: number;
  dx: number;
  dy: number;
  ticksLeft: number;
}

/** `ProjectileSystem`'s fireball speed in tiles/s (SPEED.fireball) — the trail keeps pace. */
const FIREBALL_SPEED = 10;
const TICK = 1 / 60;
const STEEL = 0xd8e2f0;

export class SkillSystem {
  /** Strips this system started and must stop (auras, pillars, trails). */
  private fx: OwnedFx[] = [];
  private trails: Trail[] = [];
  /** Multishot window: arrow impacts inside it get the directional strip. */
  private volleyTicks = 0;
  private volleyAim = { x: 1, y: 0 };
  /** Buff auras by buff key (a recast replaces the older aura). */
  private readonly keyed = new Map<string, VfxHandle>();
  /** Vanish casts, counted: only the latest cast's reveal fires. */
  private stealthCast = 0;
  private readonly offImpact: () => void;
  /** Remaining cooldown ticks per slot (UI reads this). */
  readonly cooldowns = [0, 0, 0, 0];
  private zones: Zone[] = [];
  /** Blade Flurry: staged follow-up cuts. */
  private flurry: { targetId: number; hitsLeft: number; nextHit: number; syn: Synergy } | null = null;
  /** The synergy of the cast currently executing (damage() reads it). */
  private syn: Synergy = NO_SYNERGY;

  /** Seeded rolls via the current floor's combat RNG (deterministic). */
  private get rand(): () => number {
    return this.deps.combat().rng;
  }

  private readonly offSwing: () => void;

  constructor(private readonly deps: SkillDeps) {
    // Poison Blade: every landed player hit while coated envenoms the victim.
    this.offSwing = eventBus.on('combat:swing', ({ sourceId, targetId, result }) => {
      const p = this.deps.player;
      if (sourceId !== p.id || result === 'miss' || p.poisonBladeTicks <= 0) return;
      this.deps.status().dot(targetId, 'poison', 160, 25, 3, p.id);
      // The envenomed edge reads on the victim (it.115).
      const victim = this.deps.enemiesNear(p.pos.x, p.pos.y, 3).find((e) => e.id === targetId);
      if (victim) this.deps.vfx('fx_poison_claw', victim.pos.x, victim.pos.y, { scale: 0.55, lift: 18, overlay: true, alpha: 0.9 });
    });
    // Multishot (it.115): every arrow of the volley that finds flesh flashes its strip.
    this.offImpact = eventBus.on('projectile:impact', ({ x, y, kind, hitFlesh }) => {
      if (this.volleyTicks <= 0 || kind !== 'arrow' || !hitFlesh) return;
      this.deps.vfx('fx_impact_dir_a', x, y, { scale: 0.8, lift: 18, rotation: SkillSystem.screenAngle(this.volleyAim), overlay: true, tint: 0xe8f0d0 });
    });
  }

  /** Run teardown (it.36): drop the bus subscription and any zones. */
  destroy(): void {
    this.offSwing();
    this.offImpact();
    this.clearZones();
  }

  /**
   * Start a strip the system owns (it.115): a looping aura on the hero that
   * ends with its buff, a pillar that ends with its wall. Uses the render
   * layer's follow hook when present, else re-anchors from `update()`.
   */
  private own(anim: VfxAnim, opts: VfxOpts, until: () => boolean, follow = true, onEnd?: () => void): VfxHandle {
    const p = this.deps.player;
    const d = this.deps;
    const h = follow && d.vfxFollow ? d.vfxFollow(anim, () => p.pos, { loop: true, ...opts }) : d.vfx(anim, p.pos.x, p.pos.y, { loop: true, ...opts });
    this.fx.push({ h, until, follow: follow && !d.vfxFollow, onEnd });
    return h;
  }

  /** A buff aura keyed by the buff's own clock, replacing an older one of the same key. */
  private buffAura(key: string, anim: VfxAnim, opts: VfxOpts, ticks: () => number): void {
    this.endFx(key);
    const h: VfxHandle = this.own(anim, opts, () => ticks() <= 0 || this.keyed.get(key) !== h);
    this.keyed.set(key, h);
  }
  private endFx(key: string): void {
    const h = this.keyed.get(key);
    if (h) {
      h.stop();
      this.keyed.delete(key);
    }
  }

  /** A bare timer on the tick: `onEnd` fires when `until()` turns true (the reappearance after Vanish). */
  private watch(until: () => boolean, onEnd: () => void): void {
    this.fx.push({ h: null, until, follow: false, onEnd });
  }

  /** A strip that lives a fixed number of ticks (a whirlwind's funnel). */
  private timedFx(anim: VfxAnim, opts: VfxOpts, ticks: number, follow = true): void {
    let left = ticks;
    this.own(anim, opts, () => --left <= 0, follow);
  }

  /** The hotbar: a learned skill per slot, or null (HUD + casting). */
  get skills(): Array<SkillDef | null> {
    return this.deps.player.loadout.map((id) => (id ? SKILL_BY_ID[id] ?? null : null));
  }

  /** Is this skill on the hero's own class path (synergy)? */
  isSynergy(def: SkillDef): boolean {
    return def.cls === this.deps.player.archetype;
  }

  /** Floor change: ground zones and pending cuts belong to the old floor. */
  clearZones(): void {
    for (const zone of this.zones) zone.dispose();
    this.zones = [];
    this.flurry = null;
    for (const f of this.fx) f.h?.stop();
    this.fx = [];
    this.keyed.clear();
    for (const t of this.trails) t.h.stop();
    this.trails = [];
    this.volleyTicks = 0;
  }

  /** Aim the player at the cursor and return the unit aim vector (it.33). */
  private takeAim(): { x: number; y: number } {
    const a = this.deps.aim();
    const p = this.deps.player;
    p.facing.x = a.x;
    p.facing.y = a.y;
    return a;
  }

  /**
   * TARGET POINT (it.38): where an aimed ground skill lands — the nearest
   * foe inside the aim cone within `range`, else the cursor's world point
   * (clamped to `range`, at least `minDist` out), else `fallback` tiles
   * along the aim. No more fixed "4 tiles ahead" misses.
   */
  private aimTarget(aim: { x: number; y: number }, range: number, minDist: number, fallback: number): { x: number; y: number } {
    const p = this.deps.player;
    const foe = this.deps.enemiesNear(p.pos.x, p.pos.y, range).find((e) => {
      const dx = e.pos.x - p.pos.x;
      const dy = e.pos.y - p.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      return (dx / len) * aim.x + (dy / len) * aim.y > 0.5;
    });
    if (foe) return { x: foe.pos.x, y: foe.pos.y };
    const cursor = this.deps.aimPoint();
    if (cursor) {
      const dx = cursor.x - p.pos.x;
      const dy = cursor.y - p.pos.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.05) {
        const d = Math.min(range, Math.max(minDist, len));
        return { x: p.pos.x + (dx / len) * d, y: p.pos.y + (dy / len) * d };
      }
    }
    return { x: p.pos.x + aim.x * fallback, y: p.pos.y + aim.y * fallback };
  }

  /**
   * SCREEN-PERPENDICULAR of a world aim vector (it.38): the firewall must
   * read straight across the aim ON SCREEN. A world-space perpendicular is
   * skewed by the 2:1 projection, so rotate in screen space and map back:
   *   screen = (wx - wy, (wx + wy) / 2)   world = (sy + sx / 2, sy - sx / 2)
   */
  private static screenPerp(aim: { x: number; y: number }): { x: number; y: number } {
    const sx = aim.x - aim.y;
    const sy = (aim.x + aim.y) / 2;
    const psx = -sy;
    const psy = sx;
    let wx = psy + psx / 2;
    let wy = psy - psx / 2;
    const len = Math.hypot(wx, wy) || 1;
    wx /= len;
    wy /= len;
    return { x: wx, y: wy };
  }

  /** Screen-space rotation of a world aim (for oriented strips). */
  private static screenAngle(aim: { x: number; y: number }): number {
    return Math.atan2((aim.x + aim.y) / 2, aim.x - aim.y);
  }

  apply(commands: ReadonlyArray<InputCommand>): void {
    for (const cmd of commands) {
      if (cmd.playerId !== (this.deps.slot ?? 0)) continue;
      if (cmd.type === 'SKILL') this.cast(cmd.slot);
      else if (cmd.type === 'UNLOCK_SKILL') this.unlockSkill(cmd.id);
      else if (cmd.type === 'UNLOCK_PASSIVE') this.unlockPassive(cmd.id);
      else if (cmd.type === 'EQUIP_SKILL') this.equip(cmd.slot, cmd.id);
      else if (cmd.type === 'RESET_SKILLS') this.resetSkills();
    }
  }

  /** RESPEC (it.48): town only — every learned rank refunded, the hotbar cleared. */
  private resetSkills(): void {
    const p = this.deps.player;
    if (!this.deps.inTown()) {
      this.deps.text(p.pos.x, p.pos.y - 1.2, 'RESPEC ONLY IN TOWN', 'miss');
      return;
    }
    let refund = 0;
    for (const id of p.unlockedSkills) if (SKILL_BY_ID[id]) refund += skillCost(p, SKILL_BY_ID[id]);
    for (const id of p.passives) if (PASSIVE_BY_ID[id]) refund += skillCost(p, PASSIVE_BY_ID[id]);
    if (refund === 0) return;
    p.unlockedSkills.clear();
    p.passives.clear();
    for (let i = 0; i < p.loadout.length; i++) p.loadout[i] = null;
    for (let i = 0; i < this.cooldowns.length; i++) this.cooldowns[i] = 0;
    p.skillPoints += refund;
    p.hpMax = p.baseHpMax();
    p.hp = Math.min(p.hp, p.hpMax);
    this.deps.sfx('skillBuff');
    this.deps.text(p.pos.x, p.pos.y - 1.2, `SKILLS RESET · ${refund} POINT${refund === 1 ? '' : 'S'} REFUNDED`, 'crit');
    this.deps.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 1.1, flat: true, fps: 20, tint: 0x9fb4e8 });
    eventBus.emit('skills:changed', {});
    eventBus.emit('inventory:changed', {});
  }

  // ---- PROGRESSION (it.41) ----------------------------------------------

  private unlockSkill(id: string): void {
    const p = this.deps.player;
    const check = canUnlockSkill(p, id);
    if (!check.ok) return;
    const def = SKILL_BY_ID[id];
    p.skillPoints -= skillCost(p, def);
    p.unlockedSkills.add(id);
    // First learned skill lands on the first free slot automatically.
    const free = p.loadout.indexOf(null);
    if (free >= 0 && !p.loadout.includes(id)) p.loadout[free] = id;
    this.deps.sfx('levelUp');
    this.deps.text(p.pos.x, p.pos.y - 1.2, `${def.name.toUpperCase()} LEARNED`, 'crit');
    this.deps.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 0.9, flat: true, fps: 20, tint: this.isSynergy(def) ? 0xffd070 : 0x9fb4e8 });
    this.deps.vfx('fx_sparkle_b', p.pos.x, p.pos.y, { scale: 1.2, lift: 24, overlay: true, tint: this.isSynergy(def) ? 0xffe090 : 0xc0d8ff });
    eventBus.emit('skills:changed', {});
  }

  private unlockPassive(id: string): void {
    const p = this.deps.player;
    const check = canUnlockPassive(p, id);
    if (!check.ok) return;
    const def = PASSIVE_BY_ID[id];
    p.skillPoints -= skillCost(p, def);
    p.passives.add(id);
    p.hpMax = p.baseHpMax(); // Passives may raise the pool.
    this.deps.sfx('skillBuff');
    this.deps.text(p.pos.x, p.pos.y - 1.2, def.name.toUpperCase(), 'crit');
    this.deps.vfx('vfx_aura', p.pos.x, p.pos.y, { scale: 0.9, lift: 22, fps: 16, overlay: true });
    this.deps.vfx('fx_sparkle_c', p.pos.x, p.pos.y, { scale: 1.0, lift: 30, overlay: true, tint: 0xd0e8ff });
    eventBus.emit('skills:changed', {});
    eventBus.emit('inventory:changed', {}); // Stat readouts.
  }

  private equip(slot: number, id: string | null): void {
    const p = this.deps.player;
    if (slot < 0 || slot > 3) return;
    if (id !== null && !p.unlockedSkills.has(id)) return;
    // One skill lives in one slot.
    if (id !== null) {
      const prev = p.loadout.indexOf(id);
      if (prev >= 0) p.loadout[prev] = null;
    }
    p.loadout[slot] = id;
    this.cooldowns[slot] = 0;
    this.deps.sfx('uiClick');
    eventBus.emit('skills:changed', {});
  }

  private cast(slot: number): void {
    const p = this.deps.player;
    const def = this.skills[slot];
    if (p.action === 'dead') return;
    if (!def) {
      this.deps.text(p.pos.x, p.pos.y - 1, 'NO SKILL · K', 'miss');
      this.deps.sfx('ui');
      return;
    }
    if (this.cooldowns[slot] > 0) {
      this.deps.sfx('ui');
      return;
    }
    if (!p.spendResource(def.cost)) {
      this.deps.text(p.pos.x, p.pos.y - 1, p.resourceName === 'MANA' ? 'NO MANA' : 'WINDED', 'miss');
      this.deps.sfx('ui');
      return;
    }
    const synergy = this.isSynergy(def);
    this.deps.interruptMove(); // RESPONSIVE (it.53): the cast lands the instant the key does.
    // COOLDOWN REDUCTION (it.78): Intelligence and "of Focus" lines, capped at half.
    this.cooldowns[slot] = Math.round(def.cd * (synergy ? SYNERGY.cooldown : 1) * (1 - Math.min(0.5, p.passiveBonus('cdr'))));
    this.syn = synergy ? { scale: SYNERGY.power, status: def.cls } : NO_SYNERGY;
    this.execute(def);
    this.syn = NO_SYNERGY;
  }

  /** One tick of skill machinery: cooldowns, zones, DoTs, staged hits. */
  update(): void {
    for (let i = 0; i < 4; i++) if (this.cooldowns[i] > 0) this.cooldowns[i]--;

    // OWNED STRIPS (it.115): auras ride the hero; each ends with its clock.
    if (this.fx.length) {
      const p = this.deps.player;
      const live: OwnedFx[] = [];
      for (const f of this.fx) {
        if (f.until() || p.action === 'dead') {
          f.h?.stop();
          f.onEnd?.();
          continue;
        }
        if (f.follow) f.h?.moveTo(p.pos.x, p.pos.y);
        live.push(f);
      }
      this.fx = live;
    }
    // The fireball's trail keeps pace with the shot it shadows.
    if (this.trails.length) {
      const live: Trail[] = [];
      for (const t of this.trails) {
        if (--t.ticksLeft <= 0) {
          t.h.stop();
          continue;
        }
        t.x += t.dx * FIREBALL_SPEED * TICK;
        t.y += t.dy * FIREBALL_SPEED * TICK;
        t.h.moveTo(t.x, t.y);
        live.push(t);
      }
      this.trails = live;
    }
    if (this.volleyTicks > 0) this.volleyTicks--;

    // Ground zones.
    const survivors: Zone[] = [];
    for (const zone of this.zones) {
      this.syn = zone.syn;
      if (zone.kind === 'firewall') {
        zone.ticksLeft--;
        if (zone.ticksLeft % 14 === 0) {
          for (const cell of zone.cells) {
            this.deps.burst(cell.x, cell.y, zone.ticksLeft % 28 === 0 ? 0xffb060 : 0xd85a3a, 2);
            for (const foe of this.deps.enemiesNear(cell.x, cell.y, 0.9)) {
              this.damage(foe, 3, 6, 0, 0);
              // The impact beat (it.115): a lick of flame on the body every pulse.
              this.deps.vfx('fx_fire_burst', foe.pos.x, foe.pos.y, { scale: 0.9, lift: 20, alpha: 0.85 });
            }
          }
        }
        if (zone.ticksLeft > 0) survivors.push(zone);
        else zone.dispose();
      } else if (zone.kind === 'trap') {
        zone.ticksLeft--;
        if (zone.armTicks > 0) {
          zone.armTicks--;
          if (zone.ticksLeft > 0) survivors.push(zone);
          continue;
        }
        if (zone.ticksLeft % 30 === 0) this.deps.burst(zone.x, zone.y, 0xc8b060, 2); // Armed shimmer.
        const prey = this.deps.enemiesNear(zone.x, zone.y, 1.2);
        if (prey.length > 0) {
          // DETONATION: the rune erupts and the object despawns cleanly.
          zone.dispose();
          this.deps.sfx('skillTrap');
          this.deps.shake(0.45);
          // EXPLOSIVE TRAP (it.115): the blast, a ring of sparks, smoke rolling off after.
          this.deps.vfx('fx_explosion_b', zone.x, zone.y, { scale: 1.5, lift: 22, overlay: true });
          this.deps.vfx('fx_spark_burst', zone.x, zone.y, { scale: 1.0, lift: 12, tint: 0xffd070 });
          this.deps.vfx('vfx_ring', zone.x, zone.y, { scale: 1.2, flat: true, fps: 22, tint: 0xffc070 });
          this.deps.vfx('fx_smoke_burst', zone.x, zone.y, { scale: 1.5, lift: 14, alpha: 0.8 });
          this.deps.burst(zone.x, zone.y, 0xffd98a, 16);
          this.deps.glint(zone.x, zone.y);
          for (const foe of this.deps.enemiesNear(zone.x, zone.y, 1.9)) {
            this.damage(foe, 18, 28, foe.pos.x - zone.x, foe.pos.y - zone.y, 0.8);
            this.deps.vfx('fx_impact_dir_b', foe.pos.x, foe.pos.y, { scale: 0.7, lift: 18, rotation: SkillSystem.screenAngle({ x: foe.pos.x - zone.x, y: foe.pos.y - zone.y }), overlay: true, tint: 0xffe0b0 });
          }
        } else if (zone.ticksLeft > 0) {
          survivors.push(zone);
        } else {
          zone.dispose(); // Expired unsprung.
        }
      } else {
        // Rain zones track waves, not a lifetime.
        zone.nextWave--;
        if (zone.nextWave <= 0) {
          zone.wavesLeft--;
          zone.nextWave = 22;
          this.deps.sfx('skillArrows');
          for (let i = 0; i < 6; i++) {
            const a = this.rand() * Math.PI * 2;
            const r = this.rand() * 1.8;
            this.deps.burst(zone.x + Math.cos(a) * r, zone.y + Math.sin(a) * r, 0xd8cfa8, 3);
            if (i < 3) this.deps.vfx('vfx_strike', zone.x + Math.cos(a) * r, zone.y + Math.sin(a) * r, { scale: 0.45, lift: 30, fps: 30, rotation: Math.PI / 2 + 0.6, tint: 0xd8e0f0 });
          }
          for (const foe of this.deps.enemiesNear(zone.x, zone.y, 2.0)) {
            this.damage(foe, 6, 10, 0, 0);
            // Each arrow that finds a body (it.115): a downward shaft-hit on the shoulder.
            this.deps.vfx('fx_impact_dir_c', foe.pos.x, foe.pos.y, { scale: 0.75, lift: 24, rotation: Math.PI / 2, overlay: true, tint: 0xe8e8f0 });
          }
        }
        if (zone.wavesLeft > 0) survivors.push(zone);
        else zone.dispose();
      }
    }
    this.syn = NO_SYNERGY;
    this.zones = survivors;


    // Blade Flurry follow-up cuts.
    if (this.flurry) {
      this.flurry.nextHit--;
      if (this.flurry.nextHit <= 0) {
        const p = this.deps.player;
        const foe = this.deps.enemiesNear(p.pos.x, p.pos.y, 2.0).find((e) => e.id === this.flurry!.targetId);
        if (foe && foe.hp > 0) {
          const prof = p.weaponProfile;
          this.syn = this.flurry.syn;
          this.damage(foe, Math.round(prof.minDamage * 0.8), Math.round(prof.maxDamage * 0.8), foe.pos.x - p.pos.x, foe.pos.y - p.pos.y, 0.15);
          this.syn = NO_SYNERGY;
          this.deps.sfx('swing');
          p.showSlash('hit');
          // BLADE FLURRY (it.115): a steel arc per cut, the last one wider and harder.
          const last = this.flurry.hitsLeft === 1;
          this.deps.vfx('fx_wide_arc', foe.pos.x, foe.pos.y, { scale: last ? 1.3 : 1.0, lift: 22, rotation: this.rand() * Math.PI * 2, tint: STEEL, overlay: true, fps: 24 });
          if (last) this.deps.vfx('fx_impact_dir_d', foe.pos.x, foe.pos.y, { scale: 0.9, lift: 20, rotation: SkillSystem.screenAngle({ x: foe.pos.x - p.pos.x, y: foe.pos.y - p.pos.y }), overlay: true, tint: STEEL });
          else this.deps.vfx('vfx_slash', foe.pos.x, foe.pos.y, { scale: 0.45, lift: 22, fps: 30, rotation: this.rand() * Math.PI * 2, tint: 0xffffff, overlay: true, alpha: 0.7 });
          this.flurry.hitsLeft--;
          this.flurry.nextHit = 11;
          if (this.flurry.hitsLeft <= 0) this.flurry = null;
        } else {
          this.flurry = null;
        }
      }
    }
  }


  /** Roll + deliver skill damage through the one legal channel (synergy-scaled + class status). */
  private damage(foe: Enemy, min: number, max: number, kx: number, ky: number, knock = 0.4): void {
    const len = Math.hypot(kx, ky) || 1;
    const amount = Math.max(1, Math.round(randInt(this.rand, min, max) * this.syn.scale));
    this.deps.combat().dealDamage({
      sourceId: this.deps.player.id,
      targetId: foe.id,
      amount,
      knockX: kx / len,
      knockY: ky / len,
      knockDist: knock,
    });
    if (!this.syn.status || foe.hp <= 0) return;
    const boss = foe.def.kind.startsWith('boss');
    switch (this.syn.status) {
      case 'mage':
        this.deps.status().dot(foe.id, 'burn', 180, 20, 2, this.deps.player.id);
        break;
      case 'rogue':
        this.deps.status().dot(foe.id, 'poison', 160, 25, 3, this.deps.player.id);
        break;
      case 'warrior':
        if (!boss) {
          foe.action = 'hit';
          foe.actionTicks = Math.max(foe.actionTicks, 18);
        }
        break;
      case 'ranger':
        if (!boss) {
          foe.action = 'hit';
          foe.actionTicks = Math.max(foe.actionTicks, 10);
        }
        break;
    }
  }

  /**
   * Step the player along their facing while the ground allows it.
   * WALL-COLLISION LOCK (it.33): each step is validated with the full
   * body-radius `canStandAt` (corner-aware) — the dash STOPS at the last
   * legal position instead of clipping the hero into a wall tile.
   */
  private dash(tiles: number): void {
    const p = this.deps.player;
    const steps = Math.round(tiles / 0.1);
    for (let i = 0; i < steps; i++) {
      const nx = p.pos.x + p.facing.x * 0.1;
      const ny = p.pos.y + p.facing.y * 0.1;
      if (!canStandAt(nx, ny, this.deps.isWalkable)) break;
      p.pos.x = nx;
      p.pos.y = ny;
    }
    // Belt and braces: if anything left us embedded, snap to tile center.
    if (!canStandAt(p.pos.x, p.pos.y, this.deps.isWalkable)) {
      p.pos.x = Math.floor(p.pos.x) + 0.5;
      p.pos.y = Math.floor(p.pos.y) + 0.5;
    }
  }

  private execute(def: SkillDef): void {
    const p = this.deps.player;
    const prof = p.weaponProfile;
    const d = this.deps;
    const syn = this.syn;
    switch (def.id) {
      // ---- WARRIOR ----
      case 'whirlwind': {
        d.sfx('skillWhirl');
        d.shake(0.3);
        p.showSlash('crit');
        // CAST (it.115): the funnel rides the hero for half a second over a ground ring.
        this.timedFx('fx_tornado_loop', { scale: 1.1, lift: 26, tint: syn.status ? 0xffd090 : 0xd8d8e8, alpha: 0.85 }, 32);
        d.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 1.0, flat: true, fps: 24, tint: 0xd8cfc0, alpha: 0.7 });
        d.vfx('fx_wide_arc', p.pos.x, p.pos.y, { scale: 2.2, lift: 18, tint: STEEL, alpha: 0.8, fps: 24 });
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          d.burst(p.pos.x + Math.cos(a + 0.26) * 1.9, p.pos.y + Math.sin(a + 0.26) * 1.9, 0xd8cfc0, 3);
        }
        for (const foe of d.enemiesNear(p.pos.x, p.pos.y, 2.2)) {
          this.damage(foe, Math.round(prof.minDamage * 1.4), Math.round(prof.maxDamage * 1.4), foe.pos.x - p.pos.x, foe.pos.y - p.pos.y, 0.7);
          // IMPACT: a steel arc on every body the blade reaches.
          d.vfx('fx_wide_arc', foe.pos.x, foe.pos.y, { scale: 1.0, lift: 20, rotation: SkillSystem.screenAngle({ x: foe.pos.x - p.pos.x, y: foe.pos.y - p.pos.y }), tint: STEEL, overlay: true, fps: 24 });
        }
        break;
      }
      case 'charge': {
        d.sfx('skillDash');
        const aim = this.takeAim(); // Charge where the cursor points (it.33).
        const sx = p.pos.x;
        const sy = p.pos.y;
        // CAST (it.115): the wind-up flash where the hero stood.
        d.vfx('fx_charge', sx, sy, { scale: 0.9, lift: 18, tint: 0xffd8a0, alpha: 0.9 });
        d.vfx('vfx_ring', sx, sy, { scale: 0.7, flat: true, fps: 26, tint: 0xd8b070, alpha: 0.8 });
        this.dash(4);
        d.shake(0.25);
        const hit = new Set<number>();
        const steps = 8;
        const rot = SkillSystem.screenAngle(aim);
        for (let i = 0; i <= steps; i++) {
          const px = sx + ((p.pos.x - sx) * i) / steps;
          const py = sy + ((p.pos.y - sy) * i) / steps;
          if (i % 2 === 0) d.burst(px, py, 0xc8b090, 3);
          // The dash trail lies flat on the ground behind the hero, along the run.
          if (i % 2 === 1) d.vfx('fx_dash_trail', px, py, { scale: 1.6, rotation: rot, depthBias: -20, tint: 0xe8d0a0, alpha: 0.85 });
          for (const foe of d.enemiesNear(px, py, 1.1)) {
            if (hit.has(foe.id)) continue;
            hit.add(foe.id);
            this.damage(foe, Math.round(prof.minDamage * 1.2), Math.round(prof.maxDamage * 1.2), p.facing.x, p.facing.y, 1.2);
            // IMPACT: the shoulder lands along the run.
            d.vfx('fx_impact_dir_b', foe.pos.x, foe.pos.y, { scale: 0.8, lift: 18, rotation: rot, overlay: true, tint: 0xffe8c0 });
          }
        }
        break;
      }
      case 'warcry': {
        d.sfx('skillShout');
        d.shake(0.2);
        p.dmgBuffTicks = 600;
        p.buffMax.dmg = 600;
        p.dmgBuffMult = syn.status ? 1.45 : 1.35;
        d.text(p.pos.x, p.pos.y - 1.2, 'WAR CRY!', 'crit');
        // CAST (it.115): the paladin shout bursts off the hero over a ground ring.
        d.vfx('fx_paladin_2', p.pos.x, p.pos.y, { scale: 0.9, lift: 24, tint: 0xffc890, overlay: true });
        d.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 1.5, flat: true, fps: 22, tint: 0xffb060 });
        // The buff rides the hero while it lasts.
        this.buffAura('dmg', 'fx_attack_up', { scale: 0.6, lift: 20, alpha: 0.5, overlay: true, fps: 12 }, () => p.dmgBuffTicks);
        // IMPACT: every foe in earshot startles.
        for (const foe of d.enemiesNear(p.pos.x, p.pos.y, 5)) d.vfx('fx_alert', foe.pos.x, foe.pos.y, { scale: 0.65, lift: 52, overlay: true });
        break;
      }
      case 'stoneskin': {
        d.sfx('skillBuff');
        p.drTicks = 420;
        p.buffMax.dr = 420;
        p.drFrac = syn.status ? 0.65 : 0.55;
        d.text(p.pos.x, p.pos.y - 1.2, 'STONE SKIN', 'miss');
        // CAST (it.115): a shield flash, then the guard aura rides the hero while the skin holds.
        d.vfx('fx_paladin_4', p.pos.x, p.pos.y, { scale: 0.8, lift: 22, tint: 0xc8c0b0, overlay: true });
        d.vfx('fx_defense_up', p.pos.x, p.pos.y, { scale: 0.8, lift: 20, overlay: true, tint: 0xd0c8b8 });
        this.buffAura('dr', 'fx_defense_up', { scale: 0.6, lift: 20, alpha: 0.45, overlay: true, fps: 12, tint: 0xd0c8b8 }, () => p.drTicks);
        d.burst(p.pos.x, p.pos.y, 0xb0a898, 10);
        break;
      }
      // ---- MAGE ----
      case 'fireball': {
        // A REAL PROJECTILE (it.41): the comet flies along the aim and
        // bursts on the first foe or at the aim point, dealing area damage.
        const aim = this.takeAim();
        const { x: tx, y: ty } = this.aimTarget(aim, 7, 1.2, 4);
        d.sfx('skillFire');
        // CAST (it.115): the fire sigil under the caster; the comet's trail
        // is dead-reckoned along the shot at the projectile's own speed and
        // stopped on impact (the projectile system exposes no handle).
        d.vfx('fx_fire_cast', p.pos.x, p.pos.y, { scale: 0.8, depthBias: -20, alpha: 0.9 });
        const dist = Math.hypot(tx - p.pos.x, ty - p.pos.y);
        const dmgMin = Math.round(prof.minDamage * 1.8);
        const dmgMax = Math.round(prof.maxDamage * 1.8);
        const trail: Trail = {
          h: d.vfx('fx_fireball_a', p.pos.x, p.pos.y, { loop: true, scale: 1.3, lift: 18, rotation: SkillSystem.screenAngle(aim), alpha: 0.95 }),
          x: p.pos.x,
          y: p.pos.y,
          dx: (tx - p.pos.x) / (dist || 1),
          dy: (ty - p.pos.y) / (dist || 1),
          ticksLeft: Math.ceil(((dist + 0.15) / FIREBALL_SPEED) / TICK) + 2,
        };
        this.trails.push(trail);
        const spawn: ProjectileSpawn = {
          faction: 'player',
          kind: 'fireball',
          sourceId: p.id,
          x: p.pos.x,
          y: p.pos.y,
          targetX: tx,
          targetY: ty,
          minDamage: dmgMin,
          maxDamage: dmgMax,
          toHit: 1,
          tint: 0xffb060,
          maxTravel: dist + 0.15,
          onImpact: (ix, iy) => {
            this.syn = syn;
            d.shake(0.3);
            d.sfx('boltImpact');
            trail.ticksLeft = 0; // The trail dies with the comet.
            trail.h.stop();
            // IMPACT (it.115): the burst, a rising fire column, a ground ring.
            d.vfx('fx_gexplosion_a', ix, iy, { scale: 1.3, lift: 26, overlay: true });
            d.vfx('fx_fire_burst', ix, iy, { scale: 1.4, lift: 22 });
            d.vfx('fx_explosion_b', ix, iy, { scale: 1.0, lift: 18, alpha: 0.9 });
            d.vfx('vfx_ring', ix, iy, { scale: 1.1, flat: true, fps: 24, tint: 0xff9040 });
            d.burst(ix, iy, 0xffb060, 12);
            d.glint(ix, iy);
            for (const victim of d.enemiesNear(ix, iy, 1.8)) {
              this.damage(victim, dmgMin, dmgMax, victim.pos.x - ix, victim.pos.y - iy, 0.6);
              d.vfx('fx_fire_burst', victim.pos.x, victim.pos.y, { scale: 0.9, lift: 20, alpha: 0.85 });
            }
            this.syn = NO_SYNERGY;
          },
        };
        d.combat().fireProjectile?.(spawn);
        break;
      }
      case 'firewall': {
        d.sfx('skillFire');
        // A line straight ACROSS the aim (screen-perpendicular, it.38),
        // centered on the targeted foe or the cursor point (1.5–5 tiles out).
        const aim = this.takeAim();
        const { x: cx, y: cy } = this.aimTarget(aim, 5, 1.5, 2.5);
        const { x: px, y: py } = SkillSystem.screenPerp(aim);
        const cells: Array<{ x: number; y: number }> = [];
        for (let i = -2; i <= 2; i++) cells.push({ x: cx + px * i * 1.15, y: cy + py * i * 1.15 });
        const disposers = cells.map((cell) => d.zoneVisual('fire', cell.x, cell.y));
        // CAST (it.115): the sigil under the caster; a fire pillar loops on
        // every cell of the wall for as long as it burns.
        d.vfx('fx_fire_cast', p.pos.x, p.pos.y, { scale: 0.8, depthBias: -20, alpha: 0.9 });
        const pillars = cells.map((cell, i) => {
          d.vfx('fx_fire_burst', cell.x, cell.y, { scale: 1.2, lift: 18 });
          return d.vfx('fx_fire_pillar', cell.x, cell.y, { loop: true, scale: 1.5, lift: 26, alpha: 0.9, fps: 24 + (i % 3) * 2 });
        });
        this.zones.push({
          kind: 'firewall',
          cells,
          ticksLeft: 360,
          dispose: () => {
            disposers.forEach((fn) => fn());
            pillars.forEach((h) => h.stop());
          },
          syn,
        });
        for (const cell of cells) d.burst(cell.x, cell.y, 0xffb060, 6);
        d.vfx('vfx_ring', cx, cy, { scale: 1.3, flat: true, fps: 24, tint: 0xff9040, alpha: 0.8 });
        break;
      }
      case 'frostnova': {
        d.sfx('freeze');
        d.shake(0.25);
        // CAST (it.115): the ice sigil under the caster, the wide frost burst
        // over it, and a ring of shattering ice at the nova's edge.
        d.vfx('fx_ice_cast', p.pos.x, p.pos.y, { scale: 1.2, depthBias: -20 });
        d.vfx('fx_frost_1', p.pos.x, p.pos.y, { scale: 1.1, lift: 18, overlay: true, alpha: 0.9 });
        d.vfx('vfx_whirl', p.pos.x, p.pos.y, { scale: 1.9, flat: true, fps: 22, tint: 0x9fd4f0 });
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          d.burst(p.pos.x + Math.cos(a) * 2.4, p.pos.y + Math.sin(a) * 2.4, 0x9fd4f0, 4);
          if (i % 2 === 0) d.vfx('fx_ice_shatter_a', p.pos.x + Math.cos(a) * 2.2, p.pos.y + Math.sin(a) * 2.2, { scale: 0.8, lift: 14, alpha: 0.85 });
        }
        for (const foe of d.enemiesNear(p.pos.x, p.pos.y, 3)) {
          if (foe.hitRecoveryTicks === 0 && foe.def.kind.startsWith('boss')) continue; // Wardens shrug it off.
          foe.action = 'hit';
          foe.actionTicks = syn.status ? 140 : 110; // Frozen solid.
          this.damage(foe, 4, 8, 0, 0);
          // IMPACT: the ice closes on the body.
          d.vfx('fx_ice_shatter_b', foe.pos.x, foe.pos.y, { scale: 0.9, lift: 20, overlay: true });
        }
        d.text(p.pos.x, p.pos.y - 1.2, 'FROST NOVA', 'crit');
        break;
      }
      case 'intellect': {
        d.sfx('skillBuff');
        p.dmgBuffTicks = 900;
        p.buffMax.dmg = 900;
        p.dmgBuffMult = syn.status ? 1.55 : 1.45;
        d.glint(p.pos.x, p.pos.y);
        // CAST (it.115): a light sigil under the mage and a sparkle over the head;
        // the arcane barrier orbits the body while the buff lasts.
        d.vfx('fx_light_cast', p.pos.x, p.pos.y, { scale: 0.9, depthBias: -20, tint: 0xc0b0ff });
        d.vfx('fx_sparkle_c', p.pos.x, p.pos.y, { scale: 1.1, lift: 34, overlay: true, tint: 0xd0c0ff });
        d.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 1.0, flat: true, fps: 22, tint: 0x9f8fe8 });
        this.buffAura('dmg', 'fx_magic_barrier', { scale: 1.4, lift: 20, alpha: 0.6, overlay: true, tint: 0xc8b8ff }, () => p.dmgBuffTicks);
        d.text(p.pos.x, p.pos.y - 1.2, 'ARCANE MIGHT', 'crit');
        break;
      }
      // ---- RANGER ----
      case 'multishot': {
        d.sfx('skillArrows');
        const combat = d.combat();
        const aim = this.takeAim();
        const base = Math.atan2(aim.y, aim.x);
        // CAST (it.115): the bow's arc flashes along the aim; impacts arrive
        // through `projectile:impact` while the volley window is open.
        d.vfx('fx_wide_arc', p.pos.x, p.pos.y, { scale: 1.2, lift: 20, rotation: SkillSystem.screenAngle(aim), tint: 0xd8f0c0, overlay: true, alpha: 0.85, fps: 24 });
        d.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 0.55, flat: true, fps: 30, tint: 0xd8e8c0, alpha: 0.7 });
        this.volleyTicks = 40;
        this.volleyAim = { x: aim.x, y: aim.y };
        for (let i = -2; i <= 2; i++) {
          const a = base + i * 0.21;
          combat.fireProjectile?.({
            faction: 'player',
            kind: 'arrow',
            sourceId: p.id,
            x: p.pos.x,
            y: p.pos.y,
            targetX: p.pos.x + Math.cos(a) * 6,
            targetY: p.pos.y + Math.sin(a) * 6,
            minDamage: Math.round(prof.minDamage * syn.scale),
            maxDamage: Math.round(prof.maxDamage * syn.scale),
            toHit: 0.85,
            tint: prof.color,
          });
        }
        break;
      }
      case 'shadowstep': {
        d.sfx('skillDash');
        const aim = this.takeAim(); // Step toward the cursor (it.33).
        // CAST (it.115): the rift closes where the hero stood, smoke trailing the step.
        d.vfx('fx_warp_b', p.pos.x, p.pos.y, { scale: 0.8, lift: 20, tint: 0xb0a0e0, overlay: true });
        d.vfx('fx_smoke_dir', p.pos.x, p.pos.y, { scale: 1.0, lift: 16, rotation: SkillSystem.screenAngle(aim), alpha: 0.8, tint: 0x9088b0 });
        d.burst(p.pos.x, p.pos.y, 0x8a86a0, 8);
        this.dash(3.2);
        p.hasteTicks = 240;
        p.buffMax.haste = 240;
        p.hasteMult = syn.status ? 1.45 : 1.35;
        // ARRIVAL: the rift opens again, then the haste aura rides the hero.
        d.vfx('fx_warp_b', p.pos.x, p.pos.y, { scale: 0.8, lift: 20, tint: 0xb0a0e0, overlay: true });
        d.vfx('fx_smoke_dir', p.pos.x, p.pos.y, { scale: 1.0, lift: 16, rotation: SkillSystem.screenAngle(aim) + Math.PI, alpha: 0.8, tint: 0x9088b0 });
        this.buffAura('haste', 'fx_haste', { scale: 0.6, lift: 20, alpha: 0.5, overlay: true, fps: 15, tint: 0xb0ffc0 }, () => p.hasteTicks);
        d.burst(p.pos.x, p.pos.y, 0x8a86a0, 8);
        break;
      }
      case 'trap': {
        d.sfx('skillTrapSet');
        // VISIBLE FLOOR OBJECT (it.33): a gold rune sits armed on the tile
        // until something steps into it (or it expires).
        const runeDispose = d.zoneVisual('trap', p.pos.x, p.pos.y);
        // CAST (it.115): a gold circle turns under the rune until it springs or expires.
        const circle = d.vfx('fx_magic_circle', p.pos.x, p.pos.y, { loop: true, scale: 0.9, depthBias: -20, tint: 0xd8b860, alpha: 0.7, fps: 10 });
        const dispose = (): void => {
          runeDispose();
          circle.stop();
        };
        this.zones.push({ kind: 'trap', x: p.pos.x, y: p.pos.y, armTicks: 40, ticksLeft: 1200, dispose, syn });
        d.vfx('fx_sparkle_a', p.pos.x, p.pos.y, { scale: 0.9, lift: 10, tint: 0xe8c870, alpha: 0.9 });
        d.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 0.7, flat: true, fps: 24, tint: 0xc8b060, alpha: 0.8 });
        d.burst(p.pos.x, p.pos.y, 0xc8b060, 8);
        d.text(p.pos.x, p.pos.y - 1, 'TRAP SET', 'miss');
        break;
      }
      case 'rain': {
        const aim = this.takeAim();
        const { x: tx, y: ty } = this.aimTarget(aim, 7, 1, 4);
        d.sfx('skillArrows');
        const dispose = d.zoneVisual('rain', tx, ty);
        this.zones.push({ kind: 'rain', x: tx, y: ty, wavesLeft: 5, nextWave: 12, dispose, syn });
        // CAST (it.115): the bow's arc at the archer and a pale sigil where the sky opens.
        d.vfx('fx_wide_arc', p.pos.x, p.pos.y, { scale: 1.1, lift: 20, rotation: SkillSystem.screenAngle(aim), tint: 0xd8f0c0, overlay: true, alpha: 0.8, fps: 24 });
        d.vfx('fx_light_cast', tx, ty, { scale: 1.3, depthBias: -20, tint: 0xd8e0f0, alpha: 0.8 });
        d.vfx('vfx_ring', tx, ty, { scale: 1.4, flat: true, fps: 20, tint: 0xd8e0f0, alpha: 0.7 });
        d.text(tx, ty - 1, 'RAIN OF ARROWS', 'crit');
        break;
      }
      // ---- ROGUE ----
      case 'flurry': {
        const foe = d.enemiesNear(p.pos.x, p.pos.y, 1.8)[0];
        if (!foe) {
          d.text(p.pos.x, p.pos.y - 1, 'NO TARGET', 'miss');
          // Refund: an empty flurry costs nothing (cd stays as the price).
          p.resource = Math.min(p.resourceMax, p.resource + def.cost);
          break;
        }
        d.sfx('swing');
        p.showSlash('hit');
        // CAST (it.115): the first steel arc opens the flurry; `update` cuts the rest.
        d.vfx('fx_wide_arc', foe.pos.x, foe.pos.y, { scale: 1.0, lift: 22, rotation: 0.4, tint: STEEL, overlay: true, fps: 24 });
        d.vfx('vfx_slash', foe.pos.x, foe.pos.y, { scale: 0.45, lift: 22, fps: 30, rotation: 0.4, overlay: true, alpha: 0.7 });
        this.damage(foe, Math.round(prof.minDamage * 0.8), Math.round(prof.maxDamage * 0.8), foe.pos.x - p.pos.x, foe.pos.y - p.pos.y, 0.15);
        this.flurry = { targetId: foe.id, hitsLeft: 3, nextHit: 11, syn };
        break;
      }
      case 'poison': {
        d.sfx('skillPoison');
        p.poisonBladeTicks = 900;
        p.buffMax.poison = 900;
        // CAST (it.115): the poison sigil under the rogue, the claw over the blades;
        // a green haze rides the hero while the coat lasts. Hits land through `combat:swing`.
        d.vfx('fx_poison_cast', p.pos.x, p.pos.y, { scale: 0.8, depthBias: -20, alpha: 0.9 });
        d.vfx('fx_poison_claw', p.pos.x, p.pos.y, { scale: 0.7, lift: 22, overlay: true });
        this.buffAura('poison', 'fx_status_poison', { scale: 0.5, lift: 20, alpha: 0.45, overlay: true, fps: 15 }, () => p.poisonBladeTicks);
        d.burst(p.pos.x, p.pos.y, 0x86c85a, 10);
        d.text(p.pos.x, p.pos.y - 1.2, 'BLADES ENVENOMED', 'crit');
        break;
      }
      case 'vanish': {
        d.sfx('skillVanish');
        p.stealthTicks = syn.status ? 360 : 300;
        p.buffMax.stealth = p.stealthTicks;
        // CAST (it.115): the rift swallows the hero in a burst of smoke; when
        // the stealth clock runs out the rift reopens where they stand.
        d.vfx('fx_warp_b', p.pos.x, p.pos.y, { scale: 0.9, lift: 20, tint: 0x9a90c8, overlay: true });
        d.vfx('fx_smoke_burst', p.pos.x, p.pos.y, { scale: 1.3, lift: 14, alpha: 0.85, tint: 0x8880a0 });
        d.vfx('fx_smoke_dir', p.pos.x, p.pos.y, { scale: 1.0, lift: 18, rotation: -Math.PI / 2, alpha: 0.7, tint: 0x8880a0 });
        d.burst(p.pos.x, p.pos.y, 0x6a6480, 16);
        const token = ++this.stealthCast;
        this.watch(
          () => p.stealthTicks <= 0 || this.stealthCast !== token,
          () => {
            if (p.action === 'dead' || this.stealthCast !== token) return;
            d.vfx('fx_warp_c', p.pos.x, p.pos.y, { scale: 0.7, lift: 20, tint: 0x9a90c8, overlay: true });
            d.vfx('fx_smoke_dir', p.pos.x, p.pos.y, { scale: 0.9, lift: 16, rotation: -Math.PI / 2, alpha: 0.7, tint: 0x8880a0 });
          },
        );
        d.text(p.pos.x, p.pos.y - 1.2, 'VANISH', 'miss');
        break;
      }
      case 'shadowslash': {
        d.sfx('skillDash');
        const aim = this.takeAim(); // Cut along the cursor line (it.33).
        const sx = p.pos.x;
        const sy = p.pos.y;
        this.dash(3);
        d.shake(0.3);
        p.showSlash('crit');
        const hit = new Set<number>();
        const rot = SkillSystem.screenAngle(aim);
        // CAST (it.115): the necrotic cut opens where the hero stood; a violet
        // trail lies along the ground behind the dash.
        d.vfx('fx_necro_2', sx, sy, { scale: 0.8, lift: 20, rotation: rot, overlay: true, alpha: 0.95 });
        for (let i = 0; i <= 8; i++) {
          const px = sx + ((p.pos.x - sx) * i) / 8;
          const py = sy + ((p.pos.y - sy) * i) / 8;
          d.burst(px, py, 0x6a6480, 2);
          if (i % 2 === 1) d.vfx('fx_dash_trail', px, py, { scale: 1.4, rotation: rot, depthBias: -20, tint: 0xb090ff, alpha: 0.8 });
          for (const foe of d.enemiesNear(px, py, 1.1)) {
            if (hit.has(foe.id)) continue;
            hit.add(foe.id);
            // IMPACT: the shadow blade through the body.
            d.vfx('fx_necro_1', foe.pos.x, foe.pos.y, { scale: 0.75, lift: 20, rotation: rot, overlay: true });
            d.vfx('vfx_slash', foe.pos.x, foe.pos.y, { scale: 0.6, lift: 22, fps: 30, rotation: rot, tint: 0xc0a8ff, overlay: true, alpha: 0.8 });
            this.damage(foe, Math.round(prof.minDamage * 1.8), Math.round(prof.maxDamage * 1.8), p.facing.x, p.facing.y, 0.5);
          }
        }
        d.vfx('fx_necro_2', p.pos.x, p.pos.y, { scale: 0.7, lift: 18, rotation: rot + Math.PI, alpha: 0.8 });
        break;
      }
    }
  }
}
