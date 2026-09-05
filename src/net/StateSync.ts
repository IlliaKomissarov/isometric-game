/**
 * @module net/StateSync
 * HOST-AUTHORITATIVE STATE (it.73), layered over the lockstep.
 *
 * The lockstep ships intent only, and four identical simulations stay
 * identical for as long as every peer executes every frame the same way.
 * They mostly do — but a snapshot join lands a peer a hair off the leader's
 * state, a floating-point wobble compounds over minutes, and an unnoticed
 * `Math.random()` in a new feature forks a party for good. When that
 * happens, the SYMPTOM is a mob standing in a wall on one screen and biting
 * on another. So the Party Leader is the authority for everything that is
 * not a player's own intent: several times a second it samples every foe
 * near the party and every hero, sends only what CHANGED since the last
 * sample, and every other peer pulls its own copy toward the leader's.
 *
 * WHAT GOES ON THE WIRE. A record per entity, numbers only, positions
 * quantised to 1/32 of a tile: `[id, x, y, hp, action, aiState]` for a
 * foe, `[slot, x, y, hp, resource]` for a hero. A packet carries only the
 * records whose encoding differs from the one last sent — a still foe costs
 * nothing — and a full keyframe goes out every few seconds (or on request)
 * so a peer that missed a packet, or joined from a snapshot, converges.
 *
 * INTEREST. A foe farther than INTEREST_R tiles from every hero is idle in
 * the dark and outside every fog; it is not sampled. It cannot diverge in a
 * way anyone can see, and the moment a hero nears it, it is.
 *
 * HOW A PEER CORRECTS. Never by teleporting a foe the player is watching.
 * A small error (under 3 tiles) is closed 35% per tick — a glide of a few
 * frames the eye reads as the creature's own motion; a large one snaps,
 * because it was already wrong. Health is set outright; a foe the leader
 * says is dead dies here through the combat system, so its loot and the
 * bestiary follow the same path a local kill would. Heroes are corrected
 * the same way (position, health, resource) — the leader's world is the
 * world.
 */

import type { Enemy } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import type { NetMsg, PeerNet } from './PeerNet';

/** Positions travel as integers in 1/32 tile. */
const Q = 32;
/** Foes farther than this from every hero are not sampled. */
const INTEREST_R = 18;
/** Ticks between samples (12 = five packets a second at 60 Hz). */
const SYNC_EVERY = 12;
/** Ticks between full keyframes (four seconds). */
const KEY_EVERY = 240;
/** A peer asks for a keyframe at most this often. */
const ASK_EVERY = 600;
/** Under this many tiles a correction glides; over it, it snaps. */
const SNAP_AT = 3;
const HERO_SNAP_AT = 1.5;
/** Share of the remaining error closed per tick while gliding. */
const PULL = 0.35;

const ACTIONS = ['idle', 'attack', 'hit', 'dead', 'transition'] as const;
const AI_STATES = ['idle', 'chase', 'flee'] as const;

/** `[id, x, y, hp, action, aiState]` */
export type EnemyRec = [number, number, number, number, number, number];
/** `[slot, x, y, hp, resource]` */
export type HeroRec = [number, number, number, number, number];

export interface StatePacket {
  k: number;
  e: EnemyRec[];
  h: HeroRec[];
  full: boolean;
  /**
   * Keyframes only: every foe alive on the leader's floor, wherever it is.
   * A foe that dies OUTSIDE the interest radius is never sampled, so a peer
   * whose copy is still breathing would keep it forever; the list is what
   * lets it bury the ghost.
   */
  a?: number[];
}

/** What the sync needs from the run, without knowing the run. */
export interface SyncWorld {
  /** Every foe currently in the entity table (alive or falling). */
  enemies(): Enemy[];
  /** Every seated hero. */
  heroes(): Array<{ slot: number; player: Player }>;
  enemyById(id: number): Enemy | null;
  heroBySlot(slot: number): Player | null;
  /** The leader says this foe is dead: kill it the proper way. */
  kill(enemy: Enemy): void;
}

export function encodeEnemy(e: Enemy): EnemyRec {
  return [
    e.id,
    Math.round(e.pos.x * Q),
    Math.round(e.pos.y * Q),
    Math.max(0, Math.round(e.hp)),
    Math.max(0, ACTIONS.indexOf(e.action)),
    Math.max(0, AI_STATES.indexOf(e.aiState)),
  ];
}

export function encodeHero(slot: number, p: Player): HeroRec {
  return [slot, Math.round(p.pos.x * Q), Math.round(p.pos.y * Q), Math.max(0, Math.round(p.hp)), Math.max(0, Math.round(p.resource))];
}

/** Every foe on the floor, unfiltered — what a world snapshot carries. */
export function encodeAllEnemies(world: SyncWorld): EnemyRec[] {
  return world.enemies().map(encodeEnemy);
}

export class HostStateSync {
  private readonly lastEnemy = new Map<number, string>();
  private readonly lastHero = new Map<number, string>();
  private forceFull = true;
  private readonly off: () => void;

  constructor(
    private readonly net: PeerNet,
    private readonly world: SyncWorld,
  ) {
    this.off = net.onMessage((m) => {
      if (m.t === 'sf') this.forceFull = true;
    });
  }

  /** A new floor stands: nothing sent before applies. */
  reset(): void {
    this.lastEnemy.clear();
    this.lastHero.clear();
    this.forceFull = true;
  }

  /** Once per executed tick, after the systems ran. */
  sample(tick: number): void {
    if (tick % SYNC_EVERY !== 0) return;
    const full = this.forceFull || tick % KEY_EVERY === 0;
    this.forceFull = false;
    const heroes = this.world.heroes();
    const e: EnemyRec[] = [];
    for (const foe of this.world.enemies()) {
      if (!this.near(foe, heroes)) continue;
      const rec = encodeEnemy(foe);
      const key = rec.join(',');
      if (!full && this.lastEnemy.get(foe.id) === key) continue;
      this.lastEnemy.set(foe.id, key);
      e.push(rec);
    }
    const h: HeroRec[] = [];
    for (const { slot, player } of heroes) {
      const rec = encodeHero(slot, player);
      const key = rec.join(',');
      if (!full && this.lastHero.get(slot) === key) continue;
      this.lastHero.set(slot, key);
      h.push(rec);
    }
    if (!full && e.length === 0 && h.length === 0) return;
    const a = full ? this.world.enemies().filter((f) => f.action !== 'dead').map((f) => f.id) : undefined;
    this.net.broadcast({ t: 'st', k: tick, e, h, full, a });
  }

  private near(foe: Enemy, heroes: Array<{ slot: number; player: Player }>): boolean {
    for (const { player } of heroes) {
      if (Math.abs(player.pos.x - foe.pos.x) > INTEREST_R || Math.abs(player.pos.y - foe.pos.y) > INTEREST_R) continue;
      return true;
    }
    return false;
  }

  destroy(): void {
    this.off();
  }
}

interface Pull {
  x: number;
  y: number;
}

export class ClientStateSync {
  private packet: StatePacket | null = null;
  private readonly pulls = new Map<number, Pull>();
  private readonly heroPulls = new Map<number, Pull>();
  private lastAsk = -ASK_EVERY;
  /** Foes the leader named that this sim does not have (a full keyframe repairs the count). */
  private unknown = 0;
  private readonly off: () => void;
  /** Corrections applied since the run began (the party HUD's diagnostics). */
  corrections = 0;

  constructor(
    private readonly net: PeerNet,
    private readonly world: SyncWorld,
  ) {
    this.off = net.onMessage((m: NetMsg) => {
      if (m.t !== 'st' || !Array.isArray(m.e) || !Array.isArray(m.h)) return;
      // A later packet supersedes an unapplied earlier one — except that a
      // delta cannot replace an unapplied keyframe.
      if (this.packet && this.packet.full && !m.full) {
        this.packet.e.push(...m.e);
        this.packet.h.push(...m.h);
        this.packet.k = m.k;
        return;
      }
      this.packet = { k: m.k, e: m.e, h: m.h, full: !!m.full, a: Array.isArray(m.a) ? m.a : undefined };
    });
  }

  /** A new floor stands here: forget the old floor's corrections. */
  reset(): void {
    this.packet = null;
    this.pulls.clear();
    this.heroPulls.clear();
  }

  /** Once per executed tick, after the systems ran. */
  apply(tick: number): void {
    if (this.packet && this.packet.k <= tick) {
      const p = this.packet;
      this.packet = null;
      this.absorb(p, tick);
    }
    for (const [id, t] of this.pulls) {
      const e = this.world.enemyById(id);
      if (!e || e.action === 'dead') {
        this.pulls.delete(id);
        continue;
      }
      if (this.glide(e.pos, t)) this.pulls.delete(id);
    }
    for (const [slot, t] of this.heroPulls) {
      const p = this.world.heroBySlot(slot);
      if (!p || p.action === 'dead') {
        this.heroPulls.delete(slot);
        continue;
      }
      if (this.glide(p.pos, t)) this.heroPulls.delete(slot);
    }
  }

  /** Close part of the gap; true once it is closed. */
  private glide(pos: { x: number; y: number }, t: Pull): boolean {
    const dx = t.x - pos.x;
    const dy = t.y - pos.y;
    if (Math.hypot(dx, dy) < 0.04) {
      pos.x = t.x;
      pos.y = t.y;
      return true;
    }
    pos.x += dx * PULL;
    pos.y += dy * PULL;
    return false;
  }

  private absorb(p: StatePacket, tick: number): void {
    let unknown = 0;
    for (const rec of p.e) {
      if (!Array.isArray(rec) || rec.length < 6) continue;
      const [id, qx, qy, hp, act, ai] = rec;
      const e = this.world.enemyById(id);
      if (!e) {
        if (hp > 0) unknown++;
        continue;
      }
      if (hp <= 0 || ACTIONS[act] === 'dead') {
        this.pulls.delete(id);
        if (e.action !== 'dead') {
          this.world.kill(e);
          this.corrections++;
        }
        continue;
      }
      if (e.action === 'dead') continue;
      if (Math.abs(e.hp - hp) >= 1) {
        e.hp = hp;
        this.corrections++;
      }
      const x = qx / Q;
      const y = qy / Q;
      const d = Math.hypot(x - e.pos.x, y - e.pos.y);
      if (d > SNAP_AT) {
        e.warpTo(x, y);
        this.pulls.delete(id);
        this.corrections++;
      } else if (d > 0.12) {
        this.pulls.set(id, { x, y });
        this.corrections++;
      } else this.pulls.delete(id);
      const state = AI_STATES[ai];
      if (state && e.aiState !== state && e.action === 'idle') e.aiState = state;
    }
    for (const rec of p.h) {
      if (!Array.isArray(rec) || rec.length < 5) continue;
      const [slot, qx, qy, hp, res] = rec;
      const hero = this.world.heroBySlot(slot);
      if (!hero || hero.action === 'dead') continue;
      if (Math.abs(hero.hp - hp) >= 1) hero.hp = Math.min(hero.hpMax, hp);
      if (Math.abs(hero.resource - res) >= 1) hero.resource = Math.min(hero.resourceMax, res);
      const x = qx / Q;
      const y = qy / Q;
      const d = Math.hypot(x - hero.pos.x, y - hero.pos.y);
      if (d > HERO_SNAP_AT) {
        hero.warpTo(x, y);
        this.heroPulls.delete(slot);
      } else if (d > 0.1) this.heroPulls.set(slot, { x, y });
      else this.heroPulls.delete(slot);
    }
    if (p.full && p.a) {
      // THE GHOSTS: alive here, gone on the leader's floor.
      const alive = new Set(p.a);
      for (const foe of this.world.enemies()) {
        if (foe.action === 'dead' || alive.has(foe.id)) continue;
        if (!(foe.pos.x || foe.pos.y)) continue; // A pooled foe that was never spawned.
        this.pulls.delete(foe.id);
        this.world.kill(foe);
        this.corrections++;
      }
    }
    this.unknown = unknown;
    // The leader names foes this sim does not have: ask for a keyframe (the
    // delta stream cannot introduce a foe, only a snapshot join or a full
    // packet's health readings can reconcile the count).
    if (this.unknown > 2 && tick - this.lastAsk >= ASK_EVERY) {
      this.lastAsk = tick;
      this.net.send({ t: 'sf' });
    }
  }

  destroy(): void {
    this.off();
    this.pulls.clear();
    this.heroPulls.clear();
  }
}
