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

export class SkillSystem {
  /** Remaining cooldown ticks per slot (UI reads this). */
  readonly cooldowns = [0, 0, 0, 0];
  private zones: Zone[] = [];
  /** enemyId → poison state (Poison Blade DoT / rogue synergy). */
  private readonly poisons = new Map<number, { ticksLeft: number; nextBite: number }>();
  /** enemyId → burn state (mage synergy). */
  private readonly burns = new Map<number, { ticksLeft: number; nextBite: number }>();
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
      this.poisons.set(targetId, { ticksLeft: 160, nextBite: 25 });
    });
  }

  /** Run teardown (it.36): drop the bus subscription and any zones. */
  destroy(): void {
    this.offSwing();
    this.clearZones();
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
    this.poisons.clear();
    this.burns.clear();
    this.flurry = null;
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
    this.cooldowns[slot] = Math.round(def.cd * (synergy ? SYNERGY.cooldown : 1));
    this.syn = synergy ? { scale: SYNERGY.power, status: def.cls } : NO_SYNERGY;
    this.execute(def);
    this.syn = NO_SYNERGY;
  }

  /** One tick of skill machinery: cooldowns, zones, DoTs, staged hits. */
  update(): void {
    for (let i = 0; i < 4; i++) if (this.cooldowns[i] > 0) this.cooldowns[i]--;

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
          this.deps.vfx('vfx_explosion', zone.x, zone.y, { scale: 1.6, lift: 26, fps: 24 });
          this.deps.vfx('vfx_ring', zone.x, zone.y, { scale: 1.2, flat: true, fps: 22, tint: 0xffc070 });
          this.deps.burst(zone.x, zone.y, 0xffd98a, 16);
          this.deps.glint(zone.x, zone.y);
          for (const foe of this.deps.enemiesNear(zone.x, zone.y, 1.9)) {
            this.damage(foe, 18, 28, foe.pos.x - zone.x, foe.pos.y - zone.y, 0.8);
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
          }
        }
        if (zone.wavesLeft > 0) survivors.push(zone);
        else zone.dispose();
      }
    }
    this.syn = NO_SYNERGY;
    this.zones = survivors;

    // DoTs: poison (green) and burn (ember).
    this.tickDot(this.poisons, 3, 30, 0x86c85a);
    this.tickDot(this.burns, 2, 20, 0xff9040);

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
          this.deps.vfx('vfx_slash', foe.pos.x, foe.pos.y, { scale: 0.55, lift: 22, fps: 30, rotation: this.rand() * Math.PI * 2, tint: 0xffffff, overlay: true });
          this.flurry.hitsLeft--;
          this.flurry.nextHit = 11;
          if (this.flurry.hitsLeft <= 0) this.flurry = null;
        } else {
          this.flurry = null;
        }
      }
    }
  }

  private tickDot(map: Map<number, { ticksLeft: number; nextBite: number }>, dmg: number, period: number, color: number): void {
    for (const [id, dot] of map) {
      dot.ticksLeft--;
      dot.nextBite--;
      if (dot.nextBite <= 0) {
        dot.nextBite = period;
        const foe = this.deps.enemiesNear(this.deps.player.pos.x, this.deps.player.pos.y, 40).find((e) => e.id === id);
        if (!foe || foe.hp <= 0) {
          map.delete(id);
          continue;
        }
        this.deps.combat().dealDamage({ sourceId: this.deps.player.id, targetId: id, amount: dmg });
        this.deps.burst(foe.pos.x, foe.pos.y, color, 4);
      }
      if (dot.ticksLeft <= 0) map.delete(id);
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
        this.burns.set(foe.id, { ticksLeft: 180, nextBite: 20 });
        break;
      case 'rogue':
        this.poisons.set(foe.id, { ticksLeft: 160, nextBite: 25 });
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
        d.vfx('vfx_vortex', p.pos.x, p.pos.y, { scale: 1.7, lift: 14, fps: 26, tint: syn.status ? 0xffd090 : 0xd8d8e8 });
        d.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 1.0, flat: true, fps: 24, tint: 0xd8cfc0, alpha: 0.7 });
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          d.burst(p.pos.x + Math.cos(a + 0.26) * 1.9, p.pos.y + Math.sin(a + 0.26) * 1.9, 0xd8cfc0, 3);
        }
        for (const foe of d.enemiesNear(p.pos.x, p.pos.y, 2.2)) {
          this.damage(foe, Math.round(prof.minDamage * 1.4), Math.round(prof.maxDamage * 1.4), foe.pos.x - p.pos.x, foe.pos.y - p.pos.y, 0.7);
        }
        break;
      }
      case 'charge': {
        d.sfx('skillDash');
        const aim = this.takeAim(); // Charge where the cursor points (it.33).
        const sx = p.pos.x;
        const sy = p.pos.y;
        d.vfx('vfx_ring', sx, sy, { scale: 0.7, flat: true, fps: 26, tint: 0xd8b070, alpha: 0.8 });
        this.dash(4);
        d.shake(0.25);
        const hit = new Set<number>();
        const steps = 8;
        for (let i = 0; i <= steps; i++) {
          const px = sx + ((p.pos.x - sx) * i) / steps;
          const py = sy + ((p.pos.y - sy) * i) / steps;
          if (i % 2 === 0) d.burst(px, py, 0xc8b090, 3);
          if (i % 4 === 2) d.vfx('vfx_strike', px, py, { scale: 0.7, lift: 18, fps: 28, rotation: SkillSystem.screenAngle(aim) + Math.PI, tint: 0xe8d0a0, alpha: 0.85 });
          for (const foe of d.enemiesNear(px, py, 1.1)) {
            if (hit.has(foe.id)) continue;
            hit.add(foe.id);
            this.damage(foe, Math.round(prof.minDamage * 1.2), Math.round(prof.maxDamage * 1.2), p.facing.x, p.facing.y, 1.2);
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
        d.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 1.5, flat: true, fps: 22, tint: 0xffb060 });
        d.vfx('vfx_aura', p.pos.x, p.pos.y, { scale: 1.0, lift: 22, fps: 18, tint: 0xffc080, overlay: true });
        break;
      }
      case 'stoneskin': {
        d.sfx('skillBuff');
        p.drTicks = 420;
        p.buffMax.dr = 420;
        p.drFrac = syn.status ? 0.65 : 0.55;
        d.text(p.pos.x, p.pos.y - 1.2, 'STONE SKIN', 'miss');
        d.vfx('vfx_aura', p.pos.x, p.pos.y, { scale: 1.0, lift: 22, fps: 16, tint: 0xb0a898, overlay: true });
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
        d.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 0.6, flat: true, fps: 28, tint: 0xff9040, alpha: 0.8 });
        const dist = Math.hypot(tx - p.pos.x, ty - p.pos.y);
        const dmgMin = Math.round(prof.minDamage * 1.8);
        const dmgMax = Math.round(prof.maxDamage * 1.8);
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
            d.vfx('vfx_explosion', ix, iy, { scale: 1.5, lift: 24, fps: 26 });
            d.vfx('vfx_ring', ix, iy, { scale: 1.1, flat: true, fps: 24, tint: 0xff9040 });
            d.burst(ix, iy, 0xffb060, 12);
            d.glint(ix, iy);
            for (const victim of d.enemiesNear(ix, iy, 1.8)) {
              this.damage(victim, dmgMin, dmgMax, victim.pos.x - ix, victim.pos.y - iy, 0.6);
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
        this.zones.push({
          kind: 'firewall',
          cells,
          ticksLeft: 360,
          dispose: () => disposers.forEach((fn) => fn()),
          syn,
        });
        for (const cell of cells) d.burst(cell.x, cell.y, 0xffb060, 6);
        d.vfx('vfx_ring', cx, cy, { scale: 1.3, flat: true, fps: 24, tint: 0xff9040, alpha: 0.8 });
        break;
      }
      case 'frostnova': {
        d.sfx('freeze');
        d.shake(0.25);
        d.vfx('vfx_splash', p.pos.x, p.pos.y, { scale: 2.2, lift: 10, fps: 16, tint: 0xbfe6ff });
        d.vfx('vfx_whirl', p.pos.x, p.pos.y, { scale: 1.9, flat: true, fps: 22, tint: 0x9fd4f0 });
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          d.burst(p.pos.x + Math.cos(a) * 2.4, p.pos.y + Math.sin(a) * 2.4, 0x9fd4f0, 4);
        }
        for (const foe of d.enemiesNear(p.pos.x, p.pos.y, 3)) {
          if (foe.hitRecoveryTicks === 0 && foe.def.kind.startsWith('boss')) continue; // Wardens shrug it off.
          foe.action = 'hit';
          foe.actionTicks = syn.status ? 140 : 110; // Frozen solid.
          this.damage(foe, 4, 8, 0, 0);
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
        d.vfx('vfx_aura', p.pos.x, p.pos.y, { scale: 1.1, lift: 24, fps: 18, tint: 0xb8a8f0, overlay: true });
        d.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 1.0, flat: true, fps: 22, tint: 0x9f8fe8 });
        d.text(p.pos.x, p.pos.y - 1.2, 'ARCANE MIGHT', 'crit');
        break;
      }
      // ---- RANGER ----
      case 'multishot': {
        d.sfx('skillArrows');
        const combat = d.combat();
        const aim = this.takeAim();
        const base = Math.atan2(aim.y, aim.x);
        d.vfx('vfx_ring', p.pos.x, p.pos.y, { scale: 0.55, flat: true, fps: 30, tint: 0xd8e8c0, alpha: 0.7 });
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
        this.takeAim(); // Step toward the cursor (it.33).
        d.vfx('vfx_whirl', p.pos.x, p.pos.y, { scale: 0.8, flat: true, fps: 30, tint: 0x8a86c0, alpha: 0.8 });
        d.burst(p.pos.x, p.pos.y, 0x8a86a0, 8);
        this.dash(3.2);
        p.hasteTicks = 240;
        p.buffMax.haste = 240;
        p.hasteMult = syn.status ? 1.45 : 1.35;
        d.vfx('vfx_whirl', p.pos.x, p.pos.y, { scale: 0.8, flat: true, fps: 30, tint: 0x8a86c0, alpha: 0.8 });
        d.burst(p.pos.x, p.pos.y, 0x8a86a0, 8);
        break;
      }
      case 'trap': {
        d.sfx('skillTrapSet');
        // VISIBLE FLOOR OBJECT (it.33): a gold rune sits armed on the tile
        // until something steps into it (or it expires).
        const dispose = d.zoneVisual('trap', p.pos.x, p.pos.y);
        this.zones.push({ kind: 'trap', x: p.pos.x, y: p.pos.y, armTicks: 40, ticksLeft: 1200, dispose, syn });
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
        d.vfx('vfx_slash', foe.pos.x, foe.pos.y, { scale: 0.55, lift: 22, fps: 30, rotation: 0.4, overlay: true });
        this.damage(foe, Math.round(prof.minDamage * 0.8), Math.round(prof.maxDamage * 0.8), foe.pos.x - p.pos.x, foe.pos.y - p.pos.y, 0.15);
        this.flurry = { targetId: foe.id, hitsLeft: 3, nextHit: 11, syn };
        break;
      }
      case 'poison': {
        d.sfx('skillPoison');
        p.poisonBladeTicks = 900;
        p.buffMax.poison = 900;
        d.vfx('vfx_aura', p.pos.x, p.pos.y, { scale: 0.9, lift: 22, fps: 18, tint: 0x86c85a, overlay: true });
        d.burst(p.pos.x, p.pos.y, 0x86c85a, 10);
        d.text(p.pos.x, p.pos.y - 1.2, 'BLADES ENVENOMED', 'crit');
        break;
      }
      case 'vanish': {
        d.sfx('skillVanish');
        p.stealthTicks = syn.status ? 360 : 300;
        p.buffMax.stealth = p.stealthTicks;
        d.vfx('vfx_whirl', p.pos.x, p.pos.y, { scale: 1.1, flat: true, fps: 26, tint: 0x5a5478 });
        d.vfx('vfx_splash', p.pos.x, p.pos.y, { scale: 1.2, lift: 18, fps: 18, tint: 0x6a6480, alpha: 0.8 });
        d.burst(p.pos.x, p.pos.y, 0x6a6480, 16);
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
        for (let i = 0; i <= 8; i++) {
          const px = sx + ((p.pos.x - sx) * i) / 8;
          const py = sy + ((p.pos.y - sy) * i) / 8;
          d.burst(px, py, 0x6a6480, 2);
          for (const foe of d.enemiesNear(px, py, 1.1)) {
            if (hit.has(foe.id)) continue;
            hit.add(foe.id);
            d.vfx('vfx_slash', foe.pos.x, foe.pos.y, { scale: 0.7, lift: 22, fps: 30, rotation: SkillSystem.screenAngle(aim), tint: 0xc0a8ff, overlay: true });
            this.damage(foe, Math.round(prof.minDamage * 1.8), Math.round(prof.maxDamage * 1.8), p.facing.x, p.facing.y, 0.5);
          }
        }
        d.vfx('vfx_strike', p.pos.x, p.pos.y, { scale: 0.8, lift: 18, fps: 30, rotation: SkillSystem.screenAngle(aim) + Math.PI, tint: 0xb0a0e8 });
        break;
      }
    }
  }
}
