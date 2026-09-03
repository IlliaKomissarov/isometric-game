/**
 * @module systems/Movement
 * Player locomotion: click-to-move path following + direct WASD control.
 *
 * The system consumes deterministic `InputCommand`s each fixed tick — it never
 * reads DOM events directly. Two modes:
 *
 *   'path'   — following an A* waypoint list toward a clicked destination.
 *   'direct' — velocity from held movement keys, normalized diagonals,
 *              wall-sliding collision.
 *
 * Any DIRECT_MOVE command instantly cancels the active path (mode toggle is
 * seamless mid-walk); a MOVE_TO command returns to path mode.
 */

import { Sprite } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { PLAYER_SPEED, TILE_H } from '@/core/config';
import { spriteLib } from '@/render/SpriteLibrary';
import { eventBus } from '@/core/EventBus';
import type { InputCommand } from '@/core/InputQueue';
import { state } from '@/core/StateManager';
import type { Viewport } from '@/engine/Viewport';
import type { Entity } from '@/entities/Entity';
import type { Player } from '@/entities/Player';
import { normalize, vec2 } from '@/utils/Vec2';
import { tileCenter, worldToScreen } from '@/utils/iso';
import { hasLineOfSight } from '@/utils/los';
import { moveWithCollision, type WalkableFn } from './Collision';
import type { ChestSystem } from './Chests';
import type { LootSystem } from './Loot';
import type { Pathfinder } from './Pathfinding';

/** Distance (tile units) at which a waypoint counts as reached. */
const WAYPOINT_EPSILON = 0.08;

/** Melee reach: approach stops and swings begin inside this distance. */
export const ATTACK_RANGE = 1.2;

/** Ticks between re-paths while chasing an attack target. */
const ATTACK_REPATH_TICKS = 30;

/** Distance at which a targeted ground item is collected. */
const PICKUP_RANGE = 0.9;

export type MoveMode = 'path' | 'direct';

export class MovementSystem {
  private mode: MoveMode = 'path';
  private path: Array<{ x: number; y: number }> = [];
  private pathIndex = 0;
  private readonly directDir = vec2();
  private readonly scratch = vec2();
  private readonly destinationMarker: Sprite;
  private attackTarget: Entity | null = null;
  private attackRepathCooldown = 0;
  private readonly lastAttackGoal = vec2(-1, -1);
  private pickupTarget: { uid: number; x: number; y: number } | null = null;
  private chestTarget: { id: number; x: number; y: number } | null = null;

  constructor(
    private readonly player: Player,
    private readonly pathfinder: Pathfinder,
    private readonly isWalkable: WalkableFn,
    private readonly loot: LootSystem,
    private readonly chests: ChestSystem,
    /** Current attack range: melee reach or the wielded weapon's fire range. */
    private readonly getAttackRange: () => number,
    viewport: Viewport,
  ) {
    // Destination marker: the pack's tile highlight when available, else the
    // procedural diamond. Tinted gold to sit in the palette.
    if (spriteLib.loaded) {
      this.destinationMarker = new Sprite(spriteLib.single('tile_highlight'));
      this.destinationMarker.scale.set(2.46); // 26px art diamond → 64px tile.
      this.destinationMarker.tint = 0xd8a83c;
      this.destinationMarker.alpha = 0.85;
    } else {
      this.destinationMarker = new Sprite(assets.get('pathDot'));
    }
    this.destinationMarker.anchor.set(0.5, 0.5);
    this.destinationMarker.visible = false;
    viewport.groundLayer.addChild(this.destinationMarker);
  }

  /** Apply one tick's worth of drained input commands (local or remote). */
  applyCommands(commands: ReadonlyArray<InputCommand>): void {
    for (const cmd of commands) {
      switch (cmd.type) {
        case 'MOVE_TO':
          this.attackTarget = null;
          this.pickupTarget = null;
          this.chestTarget = null;
          this.startPathTo(cmd.gx, cmd.gy);
          break;
        case 'DIRECT_MOVE':
          this.attackTarget = null;
          this.pickupTarget = null;
          this.chestTarget = null;
          this.setMode('direct');
          this.directDir.x = cmd.dx;
          this.directDir.y = cmd.dy;
          break;
        case 'STOP':
          this.attackTarget = null;
          this.pickupTarget = null;
          this.chestTarget = null;
          this.directDir.x = 0;
          this.directDir.y = 0;
          this.clearPath();
          break;
        case 'PICKUP': {
          const item = this.loot.getItem(cmd.itemUid);
          if (item) this.orderPickup(item.uid, item.x, item.y);
          break;
        }
        case 'PICKUP_NEAREST': {
          // E = INTERACT: whichever is closer — ground loot or an unopened
          // chest — gets the walk-up-and-use treatment.
          const px = this.player.pos.x;
          const py = this.player.pos.y;
          const item = this.loot.findNearest(px, py, 2.5);
          const chest = this.chests.findNearestUnopened(px, py, 2.5);
          const itemDist = item ? Math.hypot(item.x - px, item.y - py) : Infinity;
          const chestDist = chest ? Math.hypot(chest.x - px, chest.y - py) : Infinity;
          if (item && itemDist <= chestDist) {
            this.orderPickup(item.uid, item.x, item.y);
          } else if (chest) {
            this.attackTarget = null;
            this.pickupTarget = null;
            this.chestTarget = { id: chest.id, x: chest.x, y: chest.y };
            this.startPathTo(Math.floor(chest.x), Math.floor(chest.y));
            this.setMode('path');
          }
          break;
        }
        case 'OPEN_CHEST': {
          const chest = this.chests.getChest(cmd.chestId);
          if (chest && !chest.opened) {
            this.attackTarget = null;
            this.pickupTarget = null;
            this.chestTarget = { id: chest.id, x: chest.x, y: chest.y };
            this.startPathTo(Math.floor(chest.x), Math.floor(chest.y));
            this.setMode('path');
          }
          break;
        }
        case 'ATTACK': {
          const target = state.getEntity(cmd.targetId);
          if (target && target.kind === 'enemy' && target.hp > 0) {
            this.pickupTarget = null;
            this.chestTarget = null;
            this.attackTarget = target;
            this.attackRepathCooldown = 0;
            this.lastAttackGoal.x = -1;
            this.lastAttackGoal.y = -1;
            this.clearPath();
            this.setMode('path');
          }
          break;
        }
      }
    }
  }

  /** True while an attack order stands (any range). CombatSystem polls this. */
  hasAttackTarget(): boolean {
    return this.attackTarget !== null;
  }

  /** The standing click-ordered attack target, if alive (target-ring display). */
  peekAttackTarget(): Entity | null {
    if (this.attackTarget && this.attackTarget.hp > 0) return this.attackTarget;
    return null;
  }

  /** Fixed-tick advance. */
  update(dt: number): void {
    const prevTileX = Math.floor(this.player.pos.x);
    const prevTileY = Math.floor(this.player.pos.y);

    // Rooted while swinging, flinching, or dead — but tile-change detection
    // below still runs so knockback repositioning updates the fog.
    if (this.player.action !== 'idle') {
      this.detectTileChange(prevTileX, prevTileY);
      return;
    }

    if (this.mode === 'direct') {
      this.updateDirect(dt);
    } else if (this.attackTarget) {
      this.updateAttackApproach(dt);
    } else {
      // Chest approach: arrive check before advancing the path.
      if (this.chestTarget) {
        const chest = this.chests.getChest(this.chestTarget.id);
        if (!chest || chest.opened) {
          this.chestTarget = null;
        } else if (
          Math.hypot(this.chestTarget.x - this.player.pos.x, this.chestTarget.y - this.player.pos.y) <= 1.25
        ) {
          eventBus.emit('chest:reached', { chestId: this.chestTarget.id });
          this.chestTarget = null;
          this.clearPath();
        }
      }
      // Ground-item collection: arrive check before advancing the path.
      if (this.pickupTarget) {
        if (!this.loot.getItem(this.pickupTarget.uid)) {
          this.pickupTarget = null; // Someone else grabbed it (co-op future).
        } else if (
          Math.hypot(this.pickupTarget.x - this.player.pos.x, this.pickupTarget.y - this.player.pos.y) <=
          PICKUP_RANGE
        ) {
          eventBus.emit('item:pickupArrived', { uid: this.pickupTarget.uid });
          this.pickupTarget = null;
          this.clearPath();
        }
      }
      this.updatePath(dt);
    }

    this.detectTileChange(prevTileX, prevTileY);
  }

  private detectTileChange(prevTileX: number, prevTileY: number): void {
    const tileX = Math.floor(this.player.pos.x);
    const tileY = Math.floor(this.player.pos.y);
    if (tileX !== prevTileX || tileY !== prevTileY) {
      eventBus.emit('player:tileChanged', { gx: tileX, gy: tileY });
    }
  }

  private get speed(): number {
    return PLAYER_SPEED * this.player.speedMult;
  }

  private updateDirect(dt: number): void {
    if (this.directDir.x === 0 && this.directDir.y === 0) return;
    // Normalize so diagonals aren't √2 faster; input is screen-axis-aligned,
    // and world axes ARE the isometric diagonals, so this feels correct.
    normalize(this.scratch, this.directDir);
    moveWithCollision(this.player.pos, this.scratch.x * this.speed * dt, this.scratch.y * this.speed * dt, this.isWalkable);
  }

  private updatePath(dt: number): void {
    if (this.pathIndex >= this.path.length) return;
    const waypoint = this.path[this.pathIndex];
    const target = tileCenter(waypoint.x, waypoint.y, this.scratch);
    const dx = target.x - this.player.pos.x;
    const dy = target.y - this.player.pos.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= WAYPOINT_EPSILON) {
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) this.clearPath();
      return;
    }

    const step = Math.min(this.speed * dt, dist);
    // Path tiles are guaranteed walkable, but collision keeps us honest at
    // corner transitions with the entity radius.
    moveWithCollision(this.player.pos, (dx / dist) * step, (dy / dist) * step, this.isWalkable);
  }

  /**
   * The current attack target IF it is alive and inside attack range
   * (melee reach, or firing range WITH line of sight for ranged weapons).
   * CombatSystem polls this each tick to time swings.
   */
  getAttackTargetInRange(): Entity | null {
    const target = this.attackTarget;
    if (!target || target.hp <= 0) {
      this.attackTarget = null;
      return null;
    }
    const dist = Math.hypot(target.pos.x - this.player.pos.x, target.pos.y - this.player.pos.y);
    const range = this.getAttackRange();
    if (dist > range) return null;
    if (range > 2 && !this.hasLosToTarget(target)) return null;
    return target;
  }

  /** Sight check for ranged engagement (walls block arrows). */
  private hasLosToTarget(target: Entity): boolean {
    return hasLineOfSight(
      Math.floor(this.player.pos.x),
      Math.floor(this.player.pos.y),
      Math.floor(target.pos.x),
      Math.floor(target.pos.y),
      (gx, gy) => !this.isWalkable(gx, gy),
    );
  }

  private orderPickup(uid: number, x: number, y: number): void {
    this.attackTarget = null;
    this.chestTarget = null;
    this.pickupTarget = { uid, x, y };
    this.startPathTo(Math.floor(x), Math.floor(y));
    this.setMode('path');
  }

  /** Chase the attack target with throttled re-pathing; stop inside reach. */
  private updateAttackApproach(dt: number): void {
    const target = this.attackTarget!;
    if (target.hp <= 0) {
      this.attackTarget = null;
      this.clearPath();
      return;
    }
    const dist = Math.hypot(target.pos.x - this.player.pos.x, target.pos.y - this.player.pos.y);
    const range = this.getAttackRange();
    if (dist <= range && (range <= 2 || this.hasLosToTarget(target))) {
      this.clearPath(); // In reach — hold ground; CombatSystem swings/looses.
      return;
    }

    if (this.attackRepathCooldown > 0) this.attackRepathCooldown--;
    const gx = Math.floor(target.pos.x);
    const gy = Math.floor(target.pos.y);
    const goalMoved = gx !== this.lastAttackGoal.x || gy !== this.lastAttackGoal.y;
    if ((this.path.length === 0 || goalMoved) && this.attackRepathCooldown === 0) {
      const path = this.pathfinder.findPath(Math.floor(this.player.pos.x), Math.floor(this.player.pos.y), gx, gy);
      if (path) {
        this.path = path;
        this.pathIndex = 0;
        this.lastAttackGoal.x = gx;
        this.lastAttackGoal.y = gy;
      }
      this.attackRepathCooldown = ATTACK_REPATH_TICKS;
    }
    this.updatePath(dt);
  }

  private startPathTo(gx: number, gy: number): void {
    const sx = Math.floor(this.player.pos.x);
    const sy = Math.floor(this.player.pos.y);
    let path = this.pathfinder.findPath(sx, sy, gx, gy);
    if (!path) path = this.pathToNearest(sx, sy, gx, gy); // SMART CLICKS (it.48).
    if (!path || path.length === 0) return; // Already there — ignore click.

    this.path = path;
    this.pathIndex = 0;
    this.setMode('path');

    // Show destination marker centered on the goal tile.
    const goal = path[path.length - 1];
    const center = tileCenter(goal.x, goal.y, this.scratch);
    const screen = worldToScreen(center.x, center.y, this.scratch);
    const offsetY = spriteLib.loaded ? 0 : TILE_H / 4; // Highlight is tile-centered.
    this.destinationMarker.position.set(screen.x, screen.y + offsetY);
    this.destinationMarker.visible = true;

    eventBus.emit('player:pathStarted', { path });
  }

  /**
   * SMART CLICKS (it.48): a click on rock, a wall or a sealed pocket walks to
   * the reachable tile NEAREST the click (ties broken toward the hero), so a
   * click beside a doorway or into a corridor mouth still moves the hero.
   */
  private pathToNearest(sx: number, sy: number, gx: number, gy: number): Array<{ x: number; y: number }> | null {
    const cands: Array<{ x: number; y: number; d: number }> = [];
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = gx + dx;
          const y = gy + dy;
          if (!this.isWalkable(x, y)) continue;
          cands.push({ x, y, d: Math.hypot(dx, dy) + 0.15 * Math.hypot(x - sx, y - sy) });
        }
      }
      if (cands.length >= 6) break;
    }
    cands.sort((a, b) => a.d - b.d);
    let tries = 0;
    for (const c of cands) {
      if (tries++ >= 10) break;
      if (c.x === sx && c.y === sy) continue;
      const path = this.pathfinder.findPath(sx, sy, c.x, c.y);
      if (path && path.length > 0) return path;
    }
    return null;
  }

  private clearPath(): void {
    this.path = [];
    this.pathIndex = 0;
    this.destinationMarker.visible = false;
  }

  private setMode(mode: MoveMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'direct') this.clearPath();
    eventBus.emit('input:modeChanged', { mode });
  }
}
