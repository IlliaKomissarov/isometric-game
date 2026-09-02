/**
 * @module systems/Skills
 * Active class skills (it.32): 4 per archetype on hotkeys 1–4, with
 * cooldowns, resource costs (mana/stamina), timed buffs, ground zones
 * (firewall / traps / arrow rain), dashes and DoTs.
 *
 * DETERMINISM: casts arrive as 'SKILL' InputCommands and every effect
 * resolves through CombatSystem.dealDamage — the one legal hp mutator.
 * The system itself is world-agnostic: it reaches the CURRENT floor's
 * systems through the lazy accessors in `SkillDeps` (main rewires nothing
 * on floor change; it only calls `clearZones()`).
 */

import { eventBus } from '@/core/EventBus';
import type { InputCommand } from '@/core/InputQueue';
import type { Enemy } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import type { ClassArchetype } from '@/network/Serialization';
import { canStandAt } from '@/systems/Collision';
import type { CombatSystem } from '@/systems/Combat';
import { randInt } from '@/utils/rng';

export interface SkillDef {
  id: string;
  name: string;
  /** HUD glyph (a rune-like character on the action bar). */
  glyph: string;
  /** Cooldown in simulation ticks (60/s). */
  cd: number;
  /** Resource cost (mana or stamina by class). */
  cost: number;
  /** One-line HUD tooltip. */
  hint: string;
}

/** The 16 skills — 4 per class, slots map to hotkeys 1–4. */
export const CLASS_SKILLS: Record<ClassArchetype, SkillDef[]> = {
  warrior: [
    { id: 'whirlwind', name: 'Whirlwind', glyph: '⚔', cd: 300, cost: 25, hint: '360° steel — strikes everything around you' },
    { id: 'charge', name: 'Charge', glyph: '➤', cd: 420, cost: 20, hint: 'Dash forward, scattering and wounding foes' },
    { id: 'warcry', name: 'War Cry', glyph: '♜', cd: 900, cost: 15, hint: '+35% damage for 10 s' },
    { id: 'stoneskin', name: 'Stone Skin', glyph: '⛨', cd: 900, cost: 20, hint: 'Absorb 55% of damage for 7 s' },
  ],
  mage: [
    { id: 'fireball', name: 'Fireball', glyph: '✸', cd: 200, cost: 18, hint: 'Explosive burst at the nearest foe' },
    { id: 'firewall', name: 'Firewall', glyph: '♒', cd: 600, cost: 30, hint: 'A line of flame that burns for 6 s' },
    { id: 'frostnova', name: 'Frost Nova', glyph: '❄', cd: 540, cost: 25, hint: 'Freeze everything near you' },
    { id: 'intellect', name: 'Arcane Intellect', glyph: '✦', cd: 1200, cost: 0, hint: '+45% spell damage for 15 s' },
  ],
  ranger: [
    { id: 'multishot', name: 'Multishot', glyph: '⋔', cd: 200, cost: 18, hint: 'A fan of five arrows' },
    { id: 'shadowstep', name: 'Shadow Step', glyph: '➟', cd: 300, cost: 15, hint: 'Quick dash + 4 s of haste' },
    { id: 'trap', name: 'Explosive Trap', glyph: '☒', cd: 480, cost: 20, hint: 'Plant a mine at your feet' },
    { id: 'rain', name: 'Rain of Arrows', glyph: '⇊', cd: 800, cost: 35, hint: 'Arrow storm on the nearest pack' },
  ],
  rogue: [
    { id: 'flurry', name: 'Blade Flurry', glyph: '≋', cd: 220, cost: 18, hint: 'Four lightning cuts on one victim' },
    { id: 'poison', name: 'Poison Blade', glyph: '☠', cd: 700, cost: 15, hint: 'Coat your blades — hits poison for 15 s' },
    { id: 'vanish', name: 'Vanish', glyph: '◍', cd: 900, cost: 25, hint: 'Untouchable and unseen for 5 s' },
    { id: 'shadowslash', name: 'Shadow Slash', glyph: '⌁', cd: 420, cost: 25, hint: 'Dash through foes, cutting deep' },
  ],
};

/** Lazy world accessors — always resolve against the CURRENT floor. */
export interface SkillDeps {
  player: Player;
  combat: () => CombatSystem;
  enemiesNear: (x: number, y: number, r: number) => Enemy[];
  isWalkable: (gx: number, gy: number) => boolean;
  /** FX hooks (render-side; safe to no-op). */
  burst: (x: number, y: number, color: number, n: number) => void;
  glint: (x: number, y: number) => void;
  shake: (amount: number) => void;
  text: (x: number, y: number, msg: string, style: 'crit' | 'miss') => void;
  sfx: (name: string) => void;
  /**
   * TARGETED CASTING (it.33): unit vector from the player toward the mouse
   * cursor's world point (falls back to facing) — every directional skill
   * fires where the player is AIMING, never into empty space behind them.
   */
  aim: () => { x: number; y: number };
  /**
   * Persistent ground visual for a zone (trap rune / flame bed / rain
   * sigil); returns a dispose function. Render-side.
   */
  zoneVisual: (kind: 'trap' | 'fire' | 'rain', x: number, y: number) => () => void;
}

interface FirewallZone { kind: 'firewall'; cells: Array<{ x: number; y: number }>; ticksLeft: number; dispose: () => void }
interface TrapZone { kind: 'trap'; x: number; y: number; armTicks: number; ticksLeft: number; dispose: () => void }
interface RainZone { kind: 'rain'; x: number; y: number; wavesLeft: number; nextWave: number; dispose: () => void }
type Zone = FirewallZone | TrapZone | RainZone;

export class SkillSystem {
  /** Remaining cooldown ticks per slot (UI reads this). */
  readonly cooldowns = [0, 0, 0, 0];
  private zones: Zone[] = [];
  /** enemyId → poison state (Poison Blade DoT). */
  private readonly poisons = new Map<number, { ticksLeft: number; nextBite: number }>();
  /** Blade Flurry: staged follow-up cuts. */
  private flurry: { targetId: number; hitsLeft: number; nextHit: number } | null = null;

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

  /** The active class's skill defs (HUD + casting). */
  get skills(): SkillDef[] {
    return CLASS_SKILLS[this.deps.player.archetype];
  }

  /** Floor change: ground zones and pending cuts belong to the old floor. */
  clearZones(): void {
    for (const zone of this.zones) zone.dispose();
    this.zones = [];
    this.poisons.clear();
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

  apply(commands: InputCommand[]): void {
    for (const cmd of commands) {
      if (cmd.type === 'SKILL') this.cast(cmd.slot);
    }
  }

  private cast(slot: number): void {
    const p = this.deps.player;
    const def = this.skills[slot];
    if (!def || p.action === 'dead') return;
    if (this.cooldowns[slot] > 0) {
      this.deps.sfx('ui');
      return;
    }
    if (!p.spendResource(def.cost)) {
      this.deps.text(p.pos.x, p.pos.y - 1, p.resourceName === 'MANA' ? 'NO MANA' : 'WINDED', 'miss');
      this.deps.sfx('ui');
      return;
    }
    this.cooldowns[slot] = def.cd;
    this.execute(def.id);
  }

  /** One tick of skill machinery: cooldowns, zones, DoTs, staged hits. */
  update(): void {
    for (let i = 0; i < 4; i++) if (this.cooldowns[i] > 0) this.cooldowns[i]--;

    // Ground zones.
    const survivors: Zone[] = [];
    for (const zone of this.zones) {
      if (zone.kind === 'firewall') {
        zone.ticksLeft--;
        if (zone.ticksLeft % 14 === 0) {
          for (const cell of zone.cells) {
            this.deps.burst(cell.x, cell.y, zone.ticksLeft % 28 === 0 ? 0xffb060 : 0xd85a3a, 3);
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
          this.deps.burst(zone.x, zone.y, 0xffd98a, 26);
          this.deps.burst(zone.x, zone.y, 0xffb060, 20);
          this.deps.burst(zone.x, zone.y, 0xd85a3a, 14);
          this.deps.glint(zone.x, zone.y);
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            this.deps.burst(zone.x + Math.cos(a) * 1.4, zone.y + Math.sin(a) * 1.4, 0xd85a3a, 4);
          }
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
          }
          for (const foe of this.deps.enemiesNear(zone.x, zone.y, 2.0)) {
            this.damage(foe, 6, 10, 0, 0);
          }
        }
        if (zone.wavesLeft > 0) survivors.push(zone);
        else zone.dispose();
      }
    }
    this.zones = survivors;

    // Poison DoT.
    for (const [id, poison] of this.poisons) {
      poison.ticksLeft--;
      poison.nextBite--;
      if (poison.nextBite <= 0) {
        poison.nextBite = 30;
        const foe = this.deps.enemiesNear(this.deps.player.pos.x, this.deps.player.pos.y, 40).find((e) => e.id === id);
        if (!foe || foe.hp <= 0) {
          this.poisons.delete(id);
          continue;
        }
        this.deps.combat().dealDamage({ sourceId: this.deps.player.id, targetId: id, amount: 3 });
        this.deps.burst(foe.pos.x, foe.pos.y, 0x86c85a, 4);
      }
      if (poison.ticksLeft <= 0) this.poisons.delete(id);
    }

    // Blade Flurry follow-up cuts.
    if (this.flurry) {
      this.flurry.nextHit--;
      if (this.flurry.nextHit <= 0) {
        const p = this.deps.player;
        const foe = this.deps.enemiesNear(p.pos.x, p.pos.y, 2.0).find((e) => e.id === this.flurry!.targetId);
        if (foe && foe.hp > 0) {
          const prof = p.weaponProfile;
          this.damage(foe, Math.round(prof.minDamage * 0.8), Math.round(prof.maxDamage * 0.8), foe.pos.x - p.pos.x, foe.pos.y - p.pos.y, 0.15);
          this.deps.sfx('swing');
          p.showSlash('hit');
          this.flurry.hitsLeft--;
          this.flurry.nextHit = 11;
          if (this.flurry.hitsLeft <= 0) this.flurry = null;
        } else {
          this.flurry = null;
        }
      }
    }
  }

  /** Roll + deliver skill damage through the one legal channel. */
  private damage(foe: Enemy, min: number, max: number, kx: number, ky: number, knock = 0.4): void {
    const len = Math.hypot(kx, ky) || 1;
    this.deps.combat().dealDamage({
      sourceId: this.deps.player.id,
      targetId: foe.id,
      amount: randInt(this.rand, min, max),
      knockX: kx / len,
      knockY: ky / len,
      knockDist: knock,
    });
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

  private execute(id: string): void {
    const p = this.deps.player;
    const prof = p.weaponProfile;
    const d = this.deps;
    switch (id) {
      // ---- WARRIOR ----
      case 'whirlwind': {
        d.sfx('skillWhirl');
        d.shake(0.3);
        p.showSlash('crit');
        // Double steel ring: an inner flash and an outer trailing arc.
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          d.burst(p.pos.x + Math.cos(a) * 1.0, p.pos.y + Math.sin(a) * 1.0, 0xfff1d8, 3);
          d.burst(p.pos.x + Math.cos(a + 0.26) * 1.9, p.pos.y + Math.sin(a + 0.26) * 1.9, 0xd8cfc0, 4);
        }
        for (const foe of d.enemiesNear(p.pos.x, p.pos.y, 2.2)) {
          this.damage(foe, Math.round(prof.minDamage * 1.4), Math.round(prof.maxDamage * 1.4), foe.pos.x - p.pos.x, foe.pos.y - p.pos.y, 0.7);
        }
        break;
      }
      case 'charge': {
        d.sfx('skillDash');
        this.takeAim(); // Charge where the cursor points (it.33).
        const sx = p.pos.x;
        const sy = p.pos.y;
        this.dash(4);
        d.shake(0.25);
        const hit = new Set<number>();
        const steps = 8;
        for (let i = 0; i <= steps; i++) {
          const px = sx + ((p.pos.x - sx) * i) / steps;
          const py = sy + ((p.pos.y - sy) * i) / steps;
          if (i % 2 === 0) d.burst(px, py, 0xc8b090, 3);
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
        p.dmgBuffMult = 1.35;
        d.text(p.pos.x, p.pos.y - 1.2, 'WAR CRY!', 'crit');
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          d.burst(p.pos.x + Math.cos(a) * 0.9, p.pos.y + Math.sin(a) * 0.9, 0xffd98a, 4);
        }
        break;
      }
      case 'stoneskin': {
        d.sfx('skillBuff');
        p.drTicks = 420;
        p.drFrac = 0.55;
        d.text(p.pos.x, p.pos.y - 1.2, 'STONE SKIN', 'miss');
        d.burst(p.pos.x, p.pos.y, 0xb0a898, 16);
        break;
      }
      // ---- MAGE ----
      case 'fireball': {
        // AIMED (it.33): the burst lands on the nearest foe along the aim
        // cone, else exactly where the cursor points.
        const aim = this.takeAim();
        const foe = d
          .enemiesNear(p.pos.x, p.pos.y, 7)
          .find((e) => {
            const dx = e.pos.x - p.pos.x;
            const dy = e.pos.y - p.pos.y;
            const len = Math.hypot(dx, dy) || 1;
            return (dx / len) * aim.x + (dy / len) * aim.y > 0.5;
          }) ?? d.enemiesNear(p.pos.x, p.pos.y, 7)[0];
        const tx = foe ? foe.pos.x : p.pos.x + aim.x * 4;
        const ty = foe ? foe.pos.y : p.pos.y + aim.y * 4;
        d.sfx('skillFire');
        d.shake(0.3);
        d.burst(tx, ty, 0xfff1d8, 10);
        d.burst(tx, ty, 0xffb060, 22);
        d.burst(tx, ty, 0xd85a3a, 14);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          d.burst(tx + Math.cos(a) * 1.5, ty + Math.sin(a) * 1.5, 0xd85a3a, 3);
        }
        d.glint(tx, ty);
        for (const victim of d.enemiesNear(tx, ty, 1.8)) {
          this.damage(victim, Math.round(prof.minDamage * 1.8), Math.round(prof.maxDamage * 1.8), victim.pos.x - tx, victim.pos.y - ty, 0.6);
        }
        break;
      }
      case 'firewall': {
        d.sfx('skillFire');
        // A line perpendicular to the AIM, 2.5 tiles toward the cursor.
        const aim = this.takeAim();
        const cx = p.pos.x + aim.x * 2.5;
        const cy = p.pos.y + aim.y * 2.5;
        const px = -aim.y;
        const py = aim.x;
        const cells: Array<{ x: number; y: number }> = [];
        for (let i = -2; i <= 2; i++) cells.push({ x: cx + px * i, y: cy + py * i });
        const disposers = cells.map((cell) => d.zoneVisual('fire', cell.x, cell.y));
        this.zones.push({
          kind: 'firewall',
          cells,
          ticksLeft: 360,
          dispose: () => disposers.forEach((fn) => fn()),
        });
        for (const cell of cells) d.burst(cell.x, cell.y, 0xffb060, 8);
        break;
      }
      case 'frostnova': {
        d.sfx('freeze');
        d.shake(0.25);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          d.burst(p.pos.x + Math.cos(a) * 1.2, p.pos.y + Math.sin(a) * 1.2, 0xe8f4ff, 3);
          d.burst(p.pos.x + Math.cos(a) * 2.4, p.pos.y + Math.sin(a) * 2.4, 0x9fd4f0, 5);
        }
        for (const foe of d.enemiesNear(p.pos.x, p.pos.y, 3)) {
          if (foe.hitRecoveryTicks === 0 && foe.def.kind.startsWith('boss')) continue; // Wardens shrug it off.
          foe.action = 'hit';
          foe.actionTicks = 110; // Frozen solid.
          this.damage(foe, 4, 8, 0, 0);
        }
        d.text(p.pos.x, p.pos.y - 1.2, 'FROST NOVA', 'crit');
        break;
      }
      case 'intellect': {
        d.sfx('skillBuff');
        p.dmgBuffTicks = 900;
        p.dmgBuffMult = 1.45;
        d.glint(p.pos.x, p.pos.y);
        d.burst(p.pos.x, p.pos.y, 0xb8a8f0, 18);
        d.text(p.pos.x, p.pos.y - 1.2, 'ARCANE MIGHT', 'crit');
        break;
      }
      // ---- RANGER ----
      case 'multishot': {
        d.sfx('skillArrows');
        const combat = d.combat();
        const aim = this.takeAim();
        const base = Math.atan2(aim.y, aim.x);
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
            minDamage: prof.minDamage,
            maxDamage: prof.maxDamage,
            toHit: 0.85,
            tint: prof.color,
          });
        }
        break;
      }
      case 'shadowstep': {
        d.sfx('skillDash');
        this.takeAim(); // Step toward the cursor (it.33).
        d.burst(p.pos.x, p.pos.y, 0x8a86a0, 12);
        d.burst(p.pos.x, p.pos.y, 0x4a4458, 8);
        this.dash(3.2);
        p.hasteTicks = 240;
        p.hasteMult = 1.35;
        d.burst(p.pos.x, p.pos.y, 0x8a86a0, 12);
        break;
      }
      case 'trap': {
        d.sfx('skillTrapSet');
        // VISIBLE FLOOR OBJECT (it.33): a gold rune sits armed on the tile
        // until something steps into it (or it expires).
        const dispose = d.zoneVisual('trap', p.pos.x, p.pos.y);
        this.zones.push({ kind: 'trap', x: p.pos.x, y: p.pos.y, armTicks: 40, ticksLeft: 1200, dispose });
        d.burst(p.pos.x, p.pos.y, 0xc8b060, 8);
        d.text(p.pos.x, p.pos.y - 1, 'TRAP SET', 'miss');
        break;
      }
      case 'rain': {
        const aim = this.takeAim();
        const foe = d.enemiesNear(p.pos.x, p.pos.y, 7).find((e) => {
          const dx = e.pos.x - p.pos.x;
          const dy = e.pos.y - p.pos.y;
          const len = Math.hypot(dx, dy) || 1;
          return (dx / len) * aim.x + (dy / len) * aim.y > 0.5;
        }) ?? d.enemiesNear(p.pos.x, p.pos.y, 7)[0];
        const tx = foe ? foe.pos.x : p.pos.x + aim.x * 4;
        const ty = foe ? foe.pos.y : p.pos.y + aim.y * 4;
        d.sfx('skillArrows');
        const dispose = d.zoneVisual('rain', tx, ty);
        this.zones.push({ kind: 'rain', x: tx, y: ty, wavesLeft: 5, nextWave: 12, dispose });
        d.text(tx, ty - 1, 'RAIN OF ARROWS', 'crit');
        break;
      }
      // ---- ROGUE ----
      case 'flurry': {
        const foe = d.enemiesNear(p.pos.x, p.pos.y, 1.8)[0];
        if (!foe) {
          d.text(p.pos.x, p.pos.y - 1, 'NO TARGET', 'miss');
          // Refund: an empty flurry costs nothing (cd stays as the price).
          p.resource = Math.min(p.resourceMax, p.resource + this.skills[0].cost);
          break;
        }
        d.sfx('swing');
        p.showSlash('hit');
        this.damage(foe, Math.round(prof.minDamage * 0.8), Math.round(prof.maxDamage * 0.8), foe.pos.x - p.pos.x, foe.pos.y - p.pos.y, 0.15);
        this.flurry = { targetId: foe.id, hitsLeft: 3, nextHit: 11 };
        break;
      }
      case 'poison': {
        d.sfx('skillPoison');
        p.poisonBladeTicks = 900;
        d.burst(p.pos.x, p.pos.y, 0x86c85a, 14);
        d.text(p.pos.x, p.pos.y - 1.2, 'BLADES ENVENOMED', 'crit');
        break;
      }
      case 'vanish': {
        d.sfx('skillVanish');
        p.stealthTicks = 300;
        d.burst(p.pos.x, p.pos.y, 0x6a6480, 24);
        d.burst(p.pos.x, p.pos.y, 0x2c2838, 14);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          d.burst(p.pos.x + Math.cos(a) * 0.8, p.pos.y + Math.sin(a) * 0.8, 0x8a86a0, 3);
        }
        d.text(p.pos.x, p.pos.y - 1.2, 'VANISH', 'miss');
        break;
      }
      case 'shadowslash': {
        d.sfx('skillDash');
        this.takeAim(); // Cut along the cursor line (it.33).
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
            this.damage(foe, Math.round(prof.minDamage * 1.8), Math.round(prof.maxDamage * 1.8), p.facing.x, p.facing.y, 0.5);
          }
        }
        break;
      }
    }
  }
}
