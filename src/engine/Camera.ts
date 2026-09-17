/**
 * @module engine/Camera
 * Smooth follow camera with clamped mouse-wheel zoom. Rotation as a VIEW
 * control is permanently disabled by design (isometric readability +
 * deterministic picking); the only rotation the world container ever takes
 * is the shake's transient ≤ 0.6° roll, and picking accounts for it exactly.
 *
 * The camera never mutates entity state — it only transforms the world
 * container so the followed target's interpolated screen position sits at the
 * viewport center. Exponential damping gives frame-rate-independent easing.
 *
 * CAMERA FEEL (it.114). Three layers ride on the smoothed base position:
 *   - KICK: an instant offset (directional or random-angle) that decays
 *     exponentially — the recoil of a landed blow.
 *   - SHAKE: `trauma` 0..1, displacement = trauma² × CAMERA_SHAKE_MAX_PX,
 *     driven by two-sine smooth noise per axis (no per-frame RNG, so the
 *     view sways rather than jitters) plus a roll of ≤ CAMERA_SHAKE_ROT_DEG.
 *     Trauma decays linearly at `decay`/s (2.2 by default; a call may set
 *     its own).
 *   - ZOOM PUNCH: a brief push on the zoom that eases back over `ms`.
 * All displacement scales with the current zoom relative to the opening
 * zoom, so a shake reads the same size on the ground zoomed in or out, and
 * the total offset is capped. Everything is gated on `visuals.shake`.
 * The base position is kept apart from the offsets, so the shake never
 * feeds back into the follow lerp.
 *
 * THE SCENE'S ZOOM (it.115): `setCineZoom(level)` eases the wheel target to a
 * cutscene's level over ~0.6 s and `setCineZoom(null)` eases it back to the
 * zoom the player had; the wheel keeps working on the remembered value.
 */

import { visuals } from '@/core/VisualSettings';
import type { Application } from 'pixi.js';
import { CAMERA_LERP, CAMERA_SHAKE_MAX_OFFSET_PX, CAMERA_SHAKE_MAX_PX, CAMERA_SHAKE_ROT_DEG, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '@/core/config';
import { damp, vec2, type Vec2 } from '@/utils/Vec2';
import { screenToWorld, worldToScreen } from '@/utils/iso';
import type { Viewport } from './Viewport';

const DEFAULT_ZOOM = 1.5;
const TWO_PI = Math.PI * 2;

export interface ShakeOptions {
  /** Trauma lost per second (default 2.2). Lower = a longer tremble. */
  decay?: number;
}

/** Two sines at unrelated frequencies: smooth, non-repeating-looking noise in -1..1. */
function noise(t: number, f1: number, f2: number, phase: number): number {
  return (Math.sin(t * TWO_PI * f1 + phase) + 0.55 * Math.sin(t * TWO_PI * f2 + phase * 1.7 + 0.9)) / 1.55;
}

export class Camera {
  /** THE OPENING ZOOM (it.85): half again closer than the old 1.0 — the wheel still ranges ZOOM_MIN..ZOOM_MAX. */
  private zoom = DEFAULT_ZOOM;
  private targetZoom = DEFAULT_ZOOM;
  /**
   * THE LAYOUT BIAS (it.66): multiplied into the wheel zoom, never added to
   * it. The wheel stays clamped to its own range, the bias follows the
   * screen (OrientationManager.stageZoom), and the two cannot fight.
   */
  private layoutZoom = 1;
  private readonly focusScreen = vec2();
  private initialized = false;
  /** The smoothed follow position, before any kick or shake. */
  private baseX = 0;
  private baseY = 0;
  private kickX = 0;
  private kickY = 0;
  private trauma = 0;
  private traumaDecay = 2.2;
  /** The shake's own clock (seconds), advanced only while there is trauma. */
  private shakeTime = 0;
  /** Zoom punch: the amount, the seconds left and the seconds it was given. */
  private punchAmount = 0;
  private punchLeft = 0;
  private punchTotal = 0;
  private punchNow = 0;
  /** The roll applied this frame (radians), for picking. */
  private roll = 0;
  /**
   * THE SCENE'S ZOOM (it.115). A cutscene may borrow the zoom to look a speaker
   * in the face; the player's own wheel setting is remembered in `ownZoom` and
   * given back when the scene lets go. `cineLevel` is what the scene asked for
   * (null: nothing borrowed); the tween eases `targetZoom` toward `cineTo`
   * over `cineDur` seconds, in both directions, independent of the wheel.
   */
  private cineLevel: number | null = null;
  private ownZoom = DEFAULT_ZOOM;
  private cineFrom = DEFAULT_ZOOM;
  private cineTo = DEFAULT_ZOOM;
  private cineT = 0;
  private cineDur = 0;

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    // While a scene holds the zoom the wheel moves the REMEMBERED setting, so
    // the player's wish is honoured the moment the bars lift - not fought over.
    if (this.cineLevel !== null) {
      this.ownZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.ownZoom - dir * ZOOM_STEP));
      return;
    }
    this.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.targetZoom - dir * ZOOM_STEP));
  };

  constructor(
    private readonly app: Application,
    private readonly viewport: Viewport,
  ) {
    app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /**
   * THE LEAK (it.74): a camera is built per floor, and each one added a
   * wheel listener to the canvas that outlived it — every floor change
   * kept the previous camera, its viewport and the whole scene graph it
   * closed over alive. The world's teardown calls this.
   */
  destroy(): void {
    this.app.canvas.removeEventListener('wheel', this.onWheel);
  }

  /**
   * Track a world-space position (already render-interpolated by the caller).
   * Call once per render frame.
   */
  follow(worldPos: Vec2, dt: number): void {
    worldToScreen(worldPos.x, worldPos.y, this.focusScreen);

    // A scene's zoom tween (it.115): a smoothstep from where the target was to
    // where the scene wants it, or back to the player's own once released.
    if (this.cineDur > 0) {
      this.cineT = Math.min(this.cineDur, this.cineT + dt);
      const k = this.cineT / this.cineDur;
      const e = k * k * (3 - 2 * k);
      this.targetZoom = this.cineFrom + (this.cineTo - this.cineFrom) * e;
      if (this.cineT >= this.cineDur) this.cineDur = 0;
    }

    // Smooth zoom toward the wheel target.
    this.zoom += (this.targetZoom - this.zoom) * damp(10, dt);

    // Zoom punch: full push at once, quadratic ease back to nothing.
    if (this.punchLeft > 0) {
      this.punchLeft = Math.max(0, this.punchLeft - dt);
      const p = this.punchTotal > 0 ? this.punchLeft / this.punchTotal : 0;
      this.punchNow = this.punchAmount * p * p;
    } else {
      this.punchNow = 0;
    }

    const zoom = this.currentZoom;
    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    const targetX = cx - this.focusScreen.x * zoom;
    const targetY = cy - this.focusScreen.y * zoom;

    const world = this.viewport.world;
    if (!this.initialized) {
      // First frame: snap, don't glide in from (0,0).
      this.baseX = targetX;
      this.baseY = targetY;
      this.initialized = true;
    } else {
      const t = damp(CAMERA_LERP, dt);
      this.baseX += (targetX - this.baseX) * t;
      this.baseY += (targetY - this.baseY) * t;
    }

    // Offsets scale with the zoom so they read the same on the ground at any
    // wheel setting; the existing call-site magnitudes were tuned at 1.5.
    const zs = Math.max(0.5, Math.min(2, zoom / DEFAULT_ZOOM));
    let offX = 0;
    let offY = 0;
    let roll = 0;
    if (visuals.shake) {
      // Impact kick: a decaying offset punched in by combat hits.
      const decay = Math.exp(-10 * dt);
      this.kickX *= decay;
      this.kickY *= decay;
      offX = this.kickX * zs;
      offY = this.kickY * zs;
      // Trauma shake: smooth two-sine noise, quadratic falloff.
      if (this.trauma > 0) {
        this.shakeTime += dt;
        const t = this.shakeTime;
        const k = this.trauma * this.trauma;
        const mag = k * CAMERA_SHAKE_MAX_PX * zs;
        offX += noise(t, 11.3, 23.7, 0.0) * mag;
        offY += noise(t, 9.7, 27.1, 2.1) * mag * 0.7;
        roll = noise(t, 7.9, 19.3, 0.7) * k * ((CAMERA_SHAKE_ROT_DEG * Math.PI) / 180);
        this.trauma = Math.max(0, this.trauma - dt * this.traumaDecay);
      }
      // Cap the total displacement so stacked violence never throws the view.
      const cap = CAMERA_SHAKE_MAX_OFFSET_PX * zs;
      const len = Math.hypot(offX, offY);
      if (len > cap) {
        offX *= cap / len;
        offY *= cap / len;
      }
    } else {
      this.kickX = 0;
      this.kickY = 0;
      this.trauma = 0;
    }
    this.roll = roll;

    // The roll turns about the SCREEN CENTRE, not the world's origin:
    // pos' = C + R(roll)·(pos − C), rotation = roll.
    const px = this.baseX + offX;
    const py = this.baseY + offY;
    if (roll !== 0) {
      const c = Math.cos(roll);
      const s = Math.sin(roll);
      const dx = px - cx;
      const dy = py - cy;
      world.position.set(cx + dx * c - dy * s, cy + dx * s + dy * c);
    } else {
      world.position.set(px, py);
    }
    world.rotation = roll;
    world.scale.set(zoom);
  }

  /** The screen's own zoom bias; see `LayoutState.stageZoom`. */
  setLayoutZoom(z: number): void {
    this.layoutZoom = z > 0 ? z : 1;
  }

  /**
   * THE SCENE LOOKS CLOSER (it.115). `level` eases the zoom to that value over
   * ~0.6 s (a cutscene may go a little past the wheel's ceiling, to 3.2, so a
   * face fills the frame); `null` eases it back to the zoom the player had
   * before the first call. Repeated calls re-aim the tween from wherever it
   * is. A scene that never zoomed can release freely: nothing happens.
   */
  setCineZoom(level: number | null, seconds = 0.6): void {
    if (level === null) {
      if (this.cineLevel === null) return;
      this.cineLevel = null;
      this.startZoomTween(this.ownZoom, seconds);
      return;
    }
    if (this.cineLevel === null) this.ownZoom = this.cineDur > 0 ? this.cineTo : this.targetZoom;
    const to = Math.min(Math.max(ZOOM_MAX, 3.2), Math.max(ZOOM_MIN, level));
    if (this.cineLevel === to && this.cineDur === 0) return;
    this.cineLevel = to;
    this.startZoomTween(to, seconds);
  }

  /** True while a scene holds the zoom (it.115). */
  get cineZoomed(): boolean {
    return this.cineLevel !== null;
  }

  private startZoomTween(to: number, seconds: number): void {
    this.cineFrom = this.targetZoom;
    this.cineTo = to;
    this.cineT = 0;
    this.cineDur = Math.max(0.016, seconds);
  }

  /** DIRECTIONAL KICK (it.48): the view recoils along the blow's screen direction. */
  addKickDir(sx: number, sy: number, strength: number): void {
    if (!visuals.shake) return;
    this.kickX += sx * strength;
    this.kickY += sy * strength * 0.6;
  }

  /** Punch the camera (render feedback for heavy hits/crits). */
  addKick(strength: number): void {
    if (!visuals.shake) return;
    const angle = Math.random() * Math.PI * 2;
    this.kickX += Math.cos(angle) * strength;
    this.kickY += Math.sin(angle) * strength * 0.6;
  }

  /**
   * Screen shake (it.15, retuned it.114): trauma accumulates and decays;
   * displacement scales with trauma² so small hits barely whisper and only
   * stacked violence visibly sways. `decay` (trauma/s) lets a long rumble
   * (a collapsing gate) outlast a hit's flick; the slowest live decay wins
   * so a later short shake never cuts a longer one off.
   */
  addShake(amount: number, opts?: ShakeOptions): void {
    if (!visuals.shake) return;
    if (this.trauma <= 0) {
      this.traumaDecay = opts?.decay ?? 2.2;
      this.shakeTime = Math.random() * 10; // A fresh phase per burst (render-side RNG only).
    } else if (opts?.decay !== undefined) {
      this.traumaDecay = Math.min(this.traumaDecay, opts.decay);
    }
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * ZOOM PUNCH (it.114): the view pushes in by `amount` (a fraction: 0.08 =
   * 8 % closer) at once and eases back to rest over `ms`. Negative pulls out.
   */
  zoomPunch(amount: number, ms = 220): void {
    if (!visuals.shake) return;
    const seconds = Math.max(0.016, ms / 1000);
    // A stronger punch replaces a weaker one in flight; a weaker one adds a little.
    if (Math.abs(amount) >= Math.abs(this.punchNow)) {
      this.punchAmount = amount;
      this.punchLeft = this.punchTotal = seconds;
    } else {
      this.punchAmount = this.punchNow + amount * 0.5;
      this.punchLeft = this.punchTotal = Math.max(this.punchLeft, seconds);
    }
  }

  /** Convert a pointer event position (canvas pixels) to world coordinates. */
  pointerToWorld(px: number, py: number, out: Vec2): Vec2 {
    const world = this.viewport.world;
    const zoom = this.currentZoom;
    let dx = px - world.position.x;
    let dy = py - world.position.y;
    if (this.roll !== 0) {
      const c = Math.cos(-this.roll);
      const s = Math.sin(-this.roll);
      const rx = dx * c - dy * s;
      dy = dx * s + dy * c;
      dx = rx;
    }
    return screenToWorld(dx / zoom, dy / zoom, out);
  }

  /** Project a world position to canvas pixels (for screen-space hit tests). */
  worldToCanvas(wx: number, wy: number, out: Vec2): Vec2 {
    const world = this.viewport.world;
    worldToScreen(wx, wy, out);
    const zoom = this.currentZoom;
    let sx = out.x * zoom;
    let sy = out.y * zoom;
    if (this.roll !== 0) {
      const c = Math.cos(this.roll);
      const s = Math.sin(this.roll);
      const rx = sx * c - sy * s;
      sy = sx * s + sy * c;
      sx = rx;
    }
    out.x = sx + world.position.x;
    out.y = sy + world.position.y;
    return out;
  }

  /** Current zoom factor (canvas pixels per iso-screen pixel), punch included. */
  get currentZoom(): number {
    return this.zoom * this.layoutZoom * (1 + this.punchNow);
  }
}
