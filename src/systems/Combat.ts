/**
 * @module systems/Combat
 * classic ARPG–model combat: animated attack actions, to-hit rolls, damage
 * ranges, crits, hit recovery (stun), knockback, and dodgeable strikes.
 *
 * THE MODEL (mirrors the original game's feel):
 * - An attack is an ACTION, not an instant: WINDUP ticks → the strike frame
 *   (all rolls happen here) → RECOVER ticks. If the victim moved out of
 *   reach during the windup, the strike whiffs — attacks are dodgeable.
 * - Issuing a move order cancels the player's windup (positional commitment).
 * - To-hit roll first; a miss deals nothing and reads as a grey whiff arc.
 * - Damage rolls a min–max range (weapon-defined); 10% crits deal double
 *   with heavier knockback.
 * - HIT RECOVERY: any hit ≥ the threshold interrupts the victim into a
 *   flinch ('hit' action) for their per-type recovery ticks — fast weapons
 *   can stunlock, exactly like D1.
 * - Every roll comes from a seeded stream → co-op deterministic.
 *
 * `dealDamage` remains the ONLY hp mutator in the codebase.
 */

import { eventBus } from '@/core/EventBus';
import type { InputCommand } from '@/core/InputQueue';
import { state } from '@/core/StateManager';
import type { Entity } from '@/entities/Entity';
import type { Player } from '@/entities/Player';
import { mulberry32, randInt, type Rng } from '@/utils/rng';
import { canStandAt, type WalkableFn } from './Collision';
import type { MovementSystem } from './Movement';

export type SwingResult = 'hit' | 'crit' | 'miss';

export interface DamageEvent {
  sourceId: number;
  targetId: number;
  amount: number;
  /** Unit knockback direction (world space); omit for no push. */
  knockX?: number;
  knockY?: number;
  /** Knockback distance in tiles. */
  knockDist?: number;
  /** Maces: stagger the victim regardless of the damage threshold. */
  forceStagger?: boolean;
  /** Thorns (it.53): a reflected wound never reflects again. */
  reflected?: boolean;
}

// Player warrior baseline (per-class tables arrive with the abilities task).
// Swing timing now comes from the wielded weapon (WEAPON_TIMING in the
// catalog) — stored per swing so equipping mid-recovery can't desync.
const PLAYER_TO_HIT = 0.8;
const PLAYER_CRIT_CHANCE = 0.1;
const PLAYER_HIT_RECOVERY_TICKS = 10;

/** Hits below this post-armor damage do not interrupt the victim. */
const STUN_THRESHOLD = 4;
/**
 * The player has POISE: only heavy blows (a zombie's, a crit) stagger them.
 * Without this, a pack of 3-damage Fallen chain-interrupts every windup and
 * the player can never finish a swing — verified unplayable in testing.
 */
const PLAYER_STUN_THRESHOLD = 8;
const KNOCKBACK_TILES = 0.16;
const CRIT_KNOCKBACK_TILES = 0.38;

/** Auto-target radius for action-button (SPACE) swings. Equals STRIKE_REACH
 * so anything selectable is also hittable (a gap between the two produced a
 * whiff-forever livelock in testing). */
const BUTTON_TARGET_RANGE = 1.7;

/**
 * Melee resolution reach — deliberately GREATER than every selection range,
 * or a target acquired at the selection edge whiffs forever (a livelock
 * found in testing: both fighters idling at 1.5 tiles, nobody in reach).
 */
const STRIKE_REACH = 1.7;

/** One hero's swing state (it.59: one per party seat). */
interface SwingState {
  target: Entity | null;
  /** How the current swing started: click orders can be move-cancelled. */
  source: 'click' | 'button';
  held: boolean;
  /** Timing locked in at swing start (from the weapon profile). */
  windup: number;
  recover: number;
}

export class CombatSystem {
  private readonly rand: Rng;
  private readonly swings: SwingState[] = [];

  /** The stream's position (a world snapshot carries it; it.73). */
  get rngState(): number {
    return this.rand.state;
  }
  set rngState(v: number) {
    this.rand.state = v;
  }

  /** Wired by main after ProjectileSystem exists (avoids a construction cycle). */
  fireProjectile: ((opts: import('./Projectiles').ProjectileSpawn) => void) | null = null;

  /** Aim provider (it.33, per hero since it.59): untargeted swings and
   *  shots go toward the hero's aim point, never into stale-facing space. */
  aimDir: ((p: Player) => { x: number; y: number }) | null = null;

  constructor(
    /** CO-OP (it.59): one hero per seat (null = empty seat); index = seat. */
    private readonly players: ReadonlyArray<Player | null>,
    private readonly movements: ReadonlyArray<MovementSystem | null>,
    private readonly isWalkable: WalkableFn,
    /** Nearest living, targetable enemy to a point (wired in main). */
    private readonly findNearestEnemy: (x: number, y: number, range: number) => Entity | null,
    seed: number,
  ) {
    this.rand = mulberry32(seed ^ 0xc0bba7e5);
    for (let i = 0; i < players.length; i++) this.swings.push({ target: null, source: 'click', held: false, windup: 14, recover: 18 });
  }

  /** The seat a hero entity sits in, or -1 for anything that is not a party hero. */
  seatOf(entity: Entity | null | undefined): number {
    if (!entity) return -1;
    for (let i = 0; i < this.players.length; i++) if (this.players[i] === entity) return i;
    return -1;
  }

  /**
   * The living hero nearest a point (the enemy AI's target rule, it.59).
   * A Vanished rogue is skipped unless `includeHidden`; when nobody
   * qualifies the first hero standing (or lying) anywhere is returned so the
   * AI always has a point to think about.
   */
  nearestPlayer(x: number, y: number, includeHidden = false): Player | null {
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (!p || p.action === 'dead' || p.hp <= 0) continue;
      if (!includeHidden && p.stealthed) continue;
      const d = Math.hypot(p.pos.x - x, p.pos.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) return best;
    for (const p of this.players) if (p) return p;
    return null;
  }

  /** Consume this tick's action-button commands (shares the drained array). */
  applyCommands(commands: ReadonlyArray<InputCommand>): void {
    for (const cmd of commands) {
      const sw = this.swings[cmd.playerId];
      if (!sw) continue;
      if (cmd.type === 'ATTACK_DOWN') sw.held = true;
      else if (cmd.type === 'ATTACK_UP') sw.held = false;
    }
  }

  /**
   * The enemy a hero is about to strike / locked onto — drives the
   * target ring. Null when nothing is targeted.
   */
  getDisplayTarget(seat = 0): Entity | null {
    const p = this.players[seat];
    const sw = this.swings[seat];
    const mv = this.movements[seat];
    if (!p || !sw || !mv) return null;
    if (p.action === 'attack' && sw.target && sw.target.hp > 0) {
      return sw.target;
    }
    const clickTarget = mv.peekAttackTarget();
    if (clickTarget) return clickTarget;
    if (sw.held) {
      const profile = p.weaponProfile;
      const range = profile.ranged ? profile.range : BUTTON_TARGET_RANGE;
      return this.findNearestEnemy(p.pos.x, p.pos.y, range);
    }
    return null;
  }

  /** Fixed-tick step: advances every hero's attack state machine (seat order). */
  update(): void {
    for (let i = 0; i < this.players.length; i++) this.updateSeat(i);
  }

  private updateSeat(i: number): void {
    const p = this.players[i];
    const mv = this.movements[i];
    const sw = this.swings[i];
    if (!p || !mv || !sw) return;
    if (p.action === 'dead') return;

    if (p.action === 'hit') {
      if (--p.actionTicks <= 0) p.action = 'idle';
      return;
    }

    if (p.action === 'attack') {
      this.advancePlayerSwing(i);
      return;
    }

    // Idle: a click-ordered target in reach swings first…
    const clickTarget = mv.getAttackTargetInRange();
    if (clickTarget) {
      this.beginPlayerSwing(i, clickTarget, 'click');
      return;
    }
    // …otherwise the held action button swings at whatever is close —
    // or at the air (whiff), exactly like mashing A in Dark Alliance.
    if (sw.held) {
      const profile = p.weaponProfile;
      const range = profile.ranged ? profile.range : Math.max(BUTTON_TARGET_RANGE, profile.range);
      const target = this.findNearestEnemy(p.pos.x, p.pos.y, range);
      this.beginPlayerSwing(i, target, 'button');
    }
  }

  private beginPlayerSwing(i: number, target: Entity | null, source: 'click' | 'button'): void {
    const p = this.players[i]!;
    const sw = this.swings[i];
    const profile = p.weaponProfile;
    p.action = 'attack';
    p.actionTicks = 0;
    sw.target = target;
    sw.source = source;
    // FROST-TOUCHED (it.53): a chilled hero swings a third slower.
    const chill = p.chillTicks > 0 ? 1.33 : 1;
    sw.windup = Math.round(profile.windupTicks * chill);
    sw.recover = Math.round(profile.recoverTicks * chill);
    if (!target && this.aimDir) {
      // No victim picked: the swing/draw still goes where the hero aims.
      const a = this.aimDir(p);
      p.facing.x = a.x;
      p.facing.y = a.y;
    }
    if (target) {
      const dx = target.pos.x - p.pos.x;
      const dy = target.pos.y - p.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      p.facing.x = dx / len;
      p.facing.y = dy / len;
    }
  }

  private advancePlayerSwing(i: number): void {
    const p = this.players[i]!;
    const sw = this.swings[i];
    const mv = this.movements[i]!;
    // A click swing is cancelled when a newer order cleared its target;
    // button swings are short and always complete (attack commitment).
    if (sw.source === 'click' && !mv.hasAttackTarget()) {
      p.action = 'idle';
      sw.target = null;
      return;
    }
    p.actionTicks++;
    if (p.actionTicks === sw.windup) {
      this.resolvePlayerStrike(i);
    }
    if (p.actionTicks >= sw.windup + sw.recover) {
      p.action = 'idle';
    }
  }

  private resolvePlayerStrike(i: number): void {
    const p = this.players[i]!;
    const sw = this.swings[i];
    const profile = p.weaponProfile;
    if (profile.ranged) {
      this.loosePlayerProjectile(i, profile.range);
      return;
    }
    const target = sw.target;
    // Strike reach must always cover the selection range (livelock rule).
    const reach = Math.max(STRIKE_REACH, profile.range + 0.5);
    const inReach =
      target &&
      target.hp > 0 &&
      Math.hypot(target.pos.x - p.pos.x, target.pos.y - p.pos.y) <= reach;

    // The swing's travel direction: toward the primary target, else facing.
    let dirX = p.facing.x;
    let dirY = p.facing.y;
    if (inReach && target) {
      const tdx = target.pos.x - p.pos.x;
      const tdy = target.pos.y - p.pos.y;
      const tlen = Math.hypot(tdx, tdy) || 1;
      dirX = tdx / tlen;
      dirY = tdy / tlen;
    }

    // PRIMARY strike: full treatment (crit roll, max-roll display, stuns).
    let primaryHit = false;
    if (inReach && target) {
      if (this.rand() < PLAYER_TO_HIT) {
        primaryHit = true;
        let amount = randInt(this.rand, profile.minDamage, profile.maxDamage);
        // Max-roll reads as a critical (display); true crits also double.
        const maxRoll = amount === profile.maxDamage;
        const crit = this.rand() < profile.critChance;
        if (crit) amount *= 2;
        eventBus.emit('combat:swing', {
          sourceId: p.id,
          targetId: target.id,
          result: crit || maxRoll ? 'crit' : 'hit',
        });
        this.dealDamage({
          sourceId: p.id,
          targetId: target.id,
          amount,
          knockX: dirX,
          knockY: dirY,
          knockDist: crit ? CRIT_KNOCKBACK_TILES : KNOCKBACK_TILES,
          forceStagger: profile.stuns,
        });
      } else {
        eventBus.emit('combat:swing', { sourceId: p.id, targetId: target.id, result: 'miss' });
      }
    } else {
      eventBus.emit('combat:swing', { sourceId: p.id, targetId: target?.id ?? -1, result: 'miss' });
    }

    // AoE ARC (it.15, widened it.33): the blade carries through every OTHER
    // enemy grouped inside the sweep — reach extended ~0.4 tiles past the
    // primary strike and the arc opened from ~55° to ~70° per side, so
    // clustered packs get cleaved fluidly — each takes its own to-hit +
    // damage roll (no crit double).
    const nearby = this.enemiesNear?.(p.pos.x, p.pos.y, reach + 0.4) ?? [];
    for (const foe of nearby) {
      if (foe === target || foe.hp <= 0 || foe.action === 'dead') continue;
      const fdx = foe.pos.x - p.pos.x;
      const fdy = foe.pos.y - p.pos.y;
      const flen = Math.hypot(fdx, fdy) || 1;
      if ((fdx / flen) * dirX + (fdy / flen) * dirY < 0.34) continue; // Outside the arc.
      if (this.rand() >= PLAYER_TO_HIT) continue;
      const amount = randInt(this.rand, profile.minDamage, profile.maxDamage);
      this.dealDamage({
        sourceId: p.id,
        targetId: foe.id,
        amount,
        knockX: fdx / flen,
        knockY: fdy / flen,
        knockDist: KNOCKBACK_TILES,
      });
    }
    void primaryHit;
  }

  /**
   * Ranged strike frame: loose an arrow/bolt toward the target's CURRENT
   * position (dodgeable in flight) — or straight along the facing when
   * firing at the air. To-hit and damage roll on impact, like enemy arrows.
   */
  private loosePlayerProjectile(i: number, range: number): void {
    const p = this.players[i]!;
    const profile = p.weaponProfile;
    const target = this.swings[i].target;
    let tx: number;
    let ty: number;
    if (target && target.hp > 0) {
      tx = target.pos.x;
      ty = target.pos.y;
      const dx = tx - p.pos.x;
      const dy = ty - p.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      p.facing.x = dx / len;
      p.facing.y = dy / len;
    } else {
      tx = p.pos.x + p.facing.x * range;
      ty = p.pos.y + p.facing.y * range;
    }
    this.fireProjectile?.({
      faction: 'player',
      kind: profile.kind === 'wand' ? 'bolt' : 'arrow',
      sourceId: p.id,
      x: p.pos.x,
      y: p.pos.y,
      targetX: tx,
      targetY: ty,
      minDamage: profile.minDamage,
      maxDamage: profile.maxDamage,
      toHit: PLAYER_TO_HIT,
      tint: profile.color,
    });
  }

  /** Resolve a player projectile contacting an enemy (rolls happen here). */
  projectileHitEnemy(
    sourceId: number,
    enemy: Entity,
    minDamage: number,
    maxDamage: number,
    toHit: number,
    dirX: number,
    dirY: number,
  ): void {
    if (enemy.hp <= 0 || enemy.action === 'dead') return;
    if (this.rand() >= toHit) return; // Whiffed past — impact VFX still fires.
    let amount = randInt(this.rand, minDamage, maxDamage);
    const maxRoll = amount === maxDamage; // Max-roll = critical display.
    const crit = this.rand() < PLAYER_CRIT_CHANCE;
    if (crit) amount *= 2;
    eventBus.emit('combat:swing', { sourceId, targetId: enemy.id, result: crit || maxRoll ? 'crit' : 'hit' });
    this.dealDamage({
      sourceId,
      targetId: enemy.id,
      amount,
      knockX: dirX,
      knockY: dirY,
      knockDist: crit ? CRIT_KNOCKBACK_TILES : KNOCKBACK_TILES,
    });
  }

  /** God mode (cheat menu): the player takes no damage while true. */
  godMode = false;

  /** The floor's seeded RNG — skills roll on it (deterministic, it.32). */
  get rng(): () => number {
    return this.rand;
  }

  /**
   * All living enemies within `r` tiles of a point (AoE cleave sweep).
   * Wired by main (fog-independent — the blade doesn't care what you see).
   */
  enemiesNear?: (x: number, y: number, r: number) => Entity[];

  /**
   * Resolve an enemy's melee strike frame against the player. Called by the
   * enemy AI exactly at its strike tick — the range re-check here is what
   * makes telegraphed attacks dodgeable.
   */
  enemyStrike(
    source: Entity,
    minDamage: number,
    maxDamage: number,
    toHit: number,
    reach: number,
    effect?: 'slow',
  ): void {
    // The body hunted the nearest unhidden hero (it.59): that is who it swings at.
    const p = this.nearestPlayer(source.pos.x, source.pos.y);
    if (!p || p.action === 'dead') return;
    const dx = p.pos.x - source.pos.x;
    const dy = p.pos.y - source.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > reach || this.rand() >= toHit) {
      eventBus.emit('combat:swing', { sourceId: source.id, targetId: p.id, result: 'miss' });
      return;
    }
    // Class dodge (it.32): rangers slip, rogues weave, Vanish is absolute.
    if (p.dodgeChance > 0 && this.rand() < p.dodgeChance) {
      eventBus.emit('combat:swing', { sourceId: source.id, targetId: p.id, result: 'miss' });
      return;
    }
    const amount = randInt(this.rand, minDamage, maxDamage);
    eventBus.emit('combat:swing', { sourceId: source.id, targetId: p.id, result: 'hit' });
    if (effect === 'slow') p.applySlow(180); // Frost Warden: 3 s of frozen legs.
    const len = dist || 1;
    this.dealDamage({
      sourceId: source.id,
      targetId: p.id,
      amount,
      knockX: dx / len,
      knockY: dy / len,
      knockDist: KNOCKBACK_TILES,
    });
  }

  /** Resolve a projectile impact on the player (archers, future casters). */
  projectileHit(sourceId: number, targetId: number, minDamage: number, maxDamage: number, toHit: number, dirX: number, dirY: number): void {
    const p = this.players[this.seatOf(state.getEntity(targetId))];
    if (!p || p.action === 'dead') return;
    if (this.rand() >= toHit) {
      eventBus.emit('combat:swing', { sourceId, targetId: p.id, result: 'miss' });
      return;
    }
    const amount = randInt(this.rand, minDamage, maxDamage);
    eventBus.emit('combat:swing', { sourceId, targetId: p.id, result: 'hit' });
    this.dealDamage({ sourceId, targetId: p.id, amount, knockX: dirX, knockY: dirY, knockDist: KNOCKBACK_TILES });
  }

  /**
   * Restore hp (it.39 potions / shrines). The ONLY other legal hp mutator
   * besides dealDamage — same guards (dead things stay dead).
   */
  heal(targetId: number, amount: number): number {
    const target = state.getEntity(targetId);
    if (!target || target.hp <= 0 || target.action === 'dead') return 0;
    const before = target.hp;
    target.hp = Math.min(target.hpMax, target.hp + Math.max(0, Math.round(amount)));
    return target.hp - before;
  }

  /** Apply damage. The only legal way hp changes anywhere in the game. */
  dealDamage(event: DamageEvent): void {
    const target = state.getEntity(event.targetId);
    if (!target || target.hp <= 0 || target.action === 'dead') return;
    const targetHero = this.players[this.seatOf(target)] ?? null;
    if (this.godMode && targetHero) return; // Cheat: untouchable.

    // Skill buffs (it.32): War Cry / Arcane Intellect amplify the hero's
    // outgoing damage; Stone Skin absorbs a fraction of what comes in.
    let rolled = event.amount;
    const sourceHero = this.players[this.seatOf(state.getEntity(event.sourceId))] ?? null;
    if (sourceHero) rolled = Math.round(rolled * sourceHero.damageMult);
    if (targetHero && targetHero.damageReduction > 0) {
      rolled = Math.round(rolled * (1 - targetHero.damageReduction));
    }
    // Armor is flat reduction; a landed hit always deals at least 1.
    // Thorns (it.53) bites past armor — it is the hero's own steel coming back.
    const amount = Math.max(1, rolled - (event.reflected ? 0 : target.armor));
    target.hp = Math.max(0, target.hp - amount);
    eventBus.emit('entity:damaged', {
      entityId: event.targetId,
      amount,
      dirX: event.knockX,
      dirY: event.knockY,
    });

    // ELITE AFFIXES (it.53).
    const source = state.getEntity(event.sourceId) as (Entity & { affix?: string | null }) | null;
    if (source && !sourceHero && source.affix === 'vampiric' && source.hp > 0) {
      // Vampiric: a fifth of every wound flows back into the champion.
      source.hp = Math.min(source.hpMax, source.hp + Math.ceil(amount * 0.2));
      eventBus.emit('entity:healed', { entityId: source.id, amount: Math.ceil(amount * 0.2) });
    }
    const thorny = (target as Entity & { affix?: string | null }).affix === 'thorns';
    if (thorny && sourceHero && !event.reflected && target.hp > 0) {
      // Thorns: 15 % of the blow comes back at the striker.
      this.dealDamage({ sourceId: target.id, targetId: sourceHero.id, amount: Math.max(1, Math.ceil(amount * 0.15)), reflected: true });
    }

    if (target.hp === 0) {
      eventBus.emit('entity:died', { entityId: event.targetId });
      return;
    }

    // Hit recovery: hard hits interrupt whatever the victim was doing.
    // Maces (forceStagger) bypass the threshold — crushing blows always tell.
    const isPlayer = !!targetHero;
    if (event.forceStagger || amount >= (isPlayer ? PLAYER_STUN_THRESHOLD : STUN_THRESHOLD)) {
      const recovery = isPlayer ? PLAYER_HIT_RECOVERY_TICKS : target.hitRecoveryTicks;
      if (recovery > 0) {
        target.action = 'hit';
        target.actionTicks = recovery;
      }
    }

    // Knockback with wall collision.
    if (event.knockX !== undefined && event.knockY !== undefined && event.knockDist) {
      const nx = target.pos.x + event.knockX * event.knockDist;
      const ny = target.pos.y + event.knockY * event.knockDist;
      if (canStandAt(nx, ny, this.isWalkable)) {
        target.pos.x = nx;
        target.pos.y = ny;
      }
    }
  }
}
