/**
 * @module core/InputBindings
 * Translates raw DOM events into deterministic InputQueue commands.
 *
 * This is the ONLY module that listens to mouse/keyboard. Hybrid scheme
 * (classic ARPG mouse + BG:DA action buttons):
 *   - Left click on a visible enemy → ATTACK (locked target)
 *   - Left click on ground loot     → PICKUP
 *   - Left click on walkable ground → MOVE_TO (tile via camera unprojection)
 *   - WASD / Arrow keys → DIRECT_MOVE with a world-space direction
 *   - SPACE / F held    → ATTACK_DOWN/UP (auto-targeted swings; whiffs air)
 *   - E                 → PICKUP_NEAREST
 *   - All move keys released → STOP
 *
 * Key-to-world mapping: screen intent (sx, sy) maps to world axes as
 * (sy + sx, sy - sx), so "W" moves visually up-screen along the isometric
 * diagonal. Diagonal normalization happens in the MovementSystem.
 */

import type { Camera } from '@/engine/Camera';
import { vec2 } from '@/utils/Vec2';
import type { InputQueue } from './InputQueue';

const KEY_AXES: Record<string, { sx: number; sy: number }> = {
  KeyW: { sx: 0, sy: -1 },
  ArrowUp: { sx: 0, sy: -1 },
  KeyS: { sx: 0, sy: 1 },
  ArrowDown: { sx: 0, sy: 1 },
  KeyA: { sx: -1, sy: 0 },
  ArrowLeft: { sx: -1, sy: 0 },
  KeyD: { sx: 1, sy: 0 },
  ArrowRight: { sx: 1, sy: 0 },
};

const ATTACK_KEYS = new Set(['Space', 'KeyF']);

/** Focus sits in a text field: game keys must not fire (chat, lobby, it.59). */
function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

export class InputBindings {
  private readonly held = new Set<string>();
  private readonly attackHeld = new Set<string>();
  private readonly worldScratch = vec2();
  private readonly abort = new AbortController();
  /** GROUND INSPECTION (it.77): the cursor rests on a fallen item (uid) or on nothing (null). Mouse only. */
  onHoverItem: ((uid: number | null, clientX: number, clientY: number) => void) | null = null;
  private lastHoverAt = 0;
  private hoverUid: number | null = null;
  /** CO-OP (it.59): when true, pointer aim is streamed as AIM commands (throttled). */
  aimSync = false;
  private lastAimSent = 0;
  private readonly lastAim = vec2(NaN, NaN);

  constructor(
    canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly inputQueue: InputQueue,
    private readonly playerId: number,
    private readonly isWalkable: (gx: number, gy: number) => boolean,
    /**
     * Returns the id of a targetable (visible) enemy whose SPRITE contains the
     * given canvas-pixel point, or null. Screen-space picking so clicking any
     * part of a tall body works — never re-implement as ground-plane distance.
     */
    private readonly pickEnemy: (canvasX: number, canvasY: number) => number | null,
    /** Returns the uid of a visible ground item at the canvas point, or null. */
    private readonly pickItem: (canvasX: number, canvasY: number) => number | null,
    /** Returns the id of a visible unopened chest at the canvas point, or null. */
    private readonly pickChest: (canvasX: number, canvasY: number) => number | null,
  ) {
    const { signal } = this.abort;

    canvas.addEventListener(
      'pointerdown',
      (e: PointerEvent) => {
        if (e.button !== 0) return;
        const w = this.camera.pointerToWorld(e.offsetX, e.offsetY, this.worldScratch);
        // Picking priority: enemies, then ground loot, then walkable ground.
        const targetId = this.pickEnemy(e.offsetX, e.offsetY);
        if (targetId !== null) {
          this.inputQueue.enqueue({ type: 'ATTACK', playerId: this.playerId, targetId });
          return;
        }
        const itemUid = this.pickItem(e.offsetX, e.offsetY);
        if (itemUid !== null) {
          this.inputQueue.enqueue({ type: 'PICKUP', playerId: this.playerId, itemUid });
          return;
        }
        const chestId = this.pickChest(e.offsetX, e.offsetY);
        if (chestId !== null) {
          this.inputQueue.enqueue({ type: 'OPEN_CHEST', playerId: this.playerId, chestId });
          return;
        }
        const gx = Math.floor(w.x);
        const gy = Math.floor(w.y);
        if (!this.isWalkable(gx, gy)) return; // Clicks on walls/void are ignored.
        this.inputQueue.enqueue({ type: 'MOVE_TO', playerId: this.playerId, gx, gy });
      },
      { signal },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    canvas.addEventListener(
      'pointerleave',
      (e: PointerEvent) => {
        if (this.hoverUid !== null) this.onHoverItem?.(null, e.clientX, e.clientY);
        this.hoverUid = null;
      },
      { signal },
    );
    // AIM SYNC (it.59): the cursor's world point rides the command stream so
    // every peer resolves this hero's swings and casts toward the same spot.
    canvas.addEventListener(
      'pointermove',
      (e: PointerEvent) => {
        if (this.onHoverItem && e.pointerType !== 'touch') {
          const t = performance.now();
          if (t - this.lastHoverAt > 50) {
            this.lastHoverAt = t;
            const uid = this.pickItem(e.offsetX, e.offsetY);
            if (uid !== null || this.hoverUid !== null) this.onHoverItem(uid, e.clientX, e.clientY);
            this.hoverUid = uid;
          }
        }
        if (!this.aimSync) return;
        const now = performance.now();
        if (now - this.lastAimSent < 90) return;
        const w = this.camera.pointerToWorld(e.offsetX, e.offsetY, this.worldScratch);
        if (Math.hypot(w.x - this.lastAim.x, w.y - this.lastAim.y) < 0.2) return;
        this.lastAimSent = now;
        this.lastAim.x = w.x;
        this.lastAim.y = w.y;
        this.inputQueue.enqueue({ type: 'AIM', playerId: this.playerId, x: Math.round(w.x * 100) / 100, y: Math.round(w.y * 100) / 100 });
      },
      { signal },
    );

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (isTyping()) return; // The chat line / a name field owns the keys (it.59).
        if (ATTACK_KEYS.has(e.code)) {
          e.preventDefault();
          if (e.repeat) return;
          if (this.attackHeld.size === 0) {
            this.inputQueue.enqueue({ type: 'ATTACK_DOWN', playerId: this.playerId });
          }
          this.attackHeld.add(e.code);
          return;
        }
        if (e.code === 'KeyE') {
          e.preventDefault();
          if (!e.repeat) this.inputQueue.enqueue({ type: 'PICKUP_NEAREST', playerId: this.playerId });
          return;
        }
        // T (it.43): the built-in town portal — free, on a cooldown.
        if (e.code === 'KeyT') {
          e.preventDefault();
          if (!e.repeat) this.inputQueue.enqueue({ type: 'TOWN_PORTAL', playerId: this.playerId });
          return;
        }
        // Q / R (it.39): quaff the first healing / mana potion carried.
        if (e.code === 'KeyQ' || e.code === 'KeyR') {
          e.preventDefault();
          if (!e.repeat) this.inputQueue.enqueue({ type: 'USE_QUICK', playerId: this.playerId, kind: e.code === 'KeyQ' ? 'health' : 'mana' });
          return;
        }
        // Active skills (it.32): hotkeys 1–4 cast the class skill bar.
        if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3' || e.code === 'Digit4') {
          e.preventDefault();
          if (!e.repeat) {
            this.inputQueue.enqueue({ type: 'SKILL', playerId: this.playerId, slot: Number(e.code.slice(-1)) - 1 });
          }
          return;
        }
        if (!(e.code in KEY_AXES)) return;
        e.preventDefault();
        if (e.repeat) return;
        this.held.add(e.code);
        this.emitDirection();
      },
      { signal },
    );
    window.addEventListener(
      'keyup',
      (e: KeyboardEvent) => {
        if (this.attackHeld.delete(e.code) && this.attackHeld.size === 0) {
          this.inputQueue.enqueue({ type: 'ATTACK_UP', playerId: this.playerId });
          return;
        }
        if (!this.held.delete(e.code)) return;
        this.emitDirection();
      },
      { signal },
    );
    // Losing focus mid-hold would leave keys stuck — release everything.
    window.addEventListener(
      'blur',
      () => {
        if (this.attackHeld.size > 0) {
          this.attackHeld.clear();
          this.inputQueue.enqueue({ type: 'ATTACK_UP', playerId: this.playerId });
        }
        if (this.held.size === 0) return;
        this.held.clear();
        this.inputQueue.enqueue({ type: 'STOP', playerId: this.playerId });
      },
      { signal },
    );
  }

  /** A pointer click while aiming also pins the aim point (co-op stream). */
  private emitDirection(): void {
    let sx = 0;
    let sy = 0;
    for (const code of this.held) {
      const axis = KEY_AXES[code];
      sx += axis.sx;
      sy += axis.sy;
    }
    sx = Math.sign(sx);
    sy = Math.sign(sy);
    if (sx === 0 && sy === 0) {
      this.inputQueue.enqueue({ type: 'STOP', playerId: this.playerId });
      return;
    }
    // Screen intent → world axes (see module doc).
    this.inputQueue.enqueue({
      type: 'DIRECT_MOVE',
      playerId: this.playerId,
      dx: sy + sx,
      dy: sy - sx,
    });
  }

  /** Detach all DOM listeners (scene teardown / memory cleanup). */
  destroy(): void {
    this.abort.abort();
  }
}
