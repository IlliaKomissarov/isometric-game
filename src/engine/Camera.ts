/**
 * @module engine/Camera
 * Smooth follow camera with clamped mouse-wheel zoom. Rotation is permanently
 * disabled by design (isometric readability + deterministic picking).
 *
 * The camera never mutates entity state — it only transforms the world
 * container so the followed target's interpolated screen position sits at the
 * viewport center. Exponential damping gives frame-rate-independent easing.
 */

import type { Application } from 'pixi.js';
import { CAMERA_LERP, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '@/core/config';
import { damp, vec2, type Vec2 } from '@/utils/Vec2';
import { screenToWorld, worldToScreen } from '@/utils/iso';
import type { Viewport } from './Viewport';

export class Camera {
  private zoom = 1.0;
  private targetZoom = 1.0;
  private readonly focusScreen = vec2();
  private initialized = false;
  private kickX = 0;
  private kickY = 0;
  private trauma = 0;

  constructor(
    private readonly app: Application,
    private readonly viewport: Viewport,
  ) {
    app.canvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        const dir = Math.sign(e.deltaY);
        this.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.targetZoom - dir * ZOOM_STEP));
      },
      { passive: false },
    );
  }

  /**
   * Track a world-space position (already render-interpolated by the caller).
   * Call once per render frame.
   */
  follow(worldPos: Vec2, dt: number): void {
    worldToScreen(worldPos.x, worldPos.y, this.focusScreen);

    // Smooth zoom toward the wheel target.
    this.zoom += (this.targetZoom - this.zoom) * damp(10, dt);

    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    const targetX = cx - this.focusScreen.x * this.zoom;
    const targetY = cy - this.focusScreen.y * this.zoom;

    const world = this.viewport.world;
    if (!this.initialized) {
      // First frame: snap, don't glide in from (0,0).
      world.position.set(targetX, targetY);
      this.initialized = true;
    } else {
      const t = damp(CAMERA_LERP, dt);
      world.position.set(
        world.position.x + (targetX - world.position.x) * t,
        world.position.y + (targetY - world.position.y) * t,
      );
    }
    // Impact kick: a decaying offset punched in by combat hits.
    const decay = Math.exp(-10 * dt);
    this.kickX *= decay;
    this.kickY *= decay;
    // Trauma shake: tiny random tremble, quadratic falloff (subtle by design).
    let shakeX = 0;
    let shakeY = 0;
    if (this.trauma > 0) {
      const mag = this.trauma * this.trauma * 5;
      shakeX = (Math.random() * 2 - 1) * mag;
      shakeY = (Math.random() * 2 - 1) * mag * 0.7;
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }
    world.position.set(world.position.x + this.kickX + shakeX, world.position.y + this.kickY + shakeY);
    world.scale.set(this.zoom);
  }

  /** DIRECTIONAL KICK (it.48): the view recoils along the blow's screen direction. */
  addKickDir(sx: number, sy: number, strength: number): void {
    this.kickX += sx * strength;
    this.kickY += sy * strength * 0.6;
  }

  /** Punch the camera (render feedback for heavy hits/crits). */
  addKick(strength: number): void {
    const angle = Math.random() * Math.PI * 2;
    this.kickX += Math.cos(angle) * strength;
    this.kickY += Math.sin(angle) * strength * 0.6;
  }

  /**
   * SUBTLE screen shake (it.15): trauma accumulates on heavy hits and decays
   * fast; displacement scales with trauma² so small hits barely whisper and
   * only stacked violence visibly trembles. Deliberately restrained.
   */
  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Convert a pointer event position (canvas pixels) to world coordinates. */
  pointerToWorld(px: number, py: number, out: Vec2): Vec2 {
    const world = this.viewport.world;
    const localX = (px - world.position.x) / this.zoom;
    const localY = (py - world.position.y) / this.zoom;
    return screenToWorld(localX, localY, out);
  }

  /** Project a world position to canvas pixels (for screen-space hit tests). */
  worldToCanvas(wx: number, wy: number, out: Vec2): Vec2 {
    const world = this.viewport.world;
    worldToScreen(wx, wy, out);
    out.x = out.x * this.zoom + world.position.x;
    out.y = out.y * this.zoom + world.position.y;
    return out;
  }

  /** Current zoom factor (canvas pixels per iso-screen pixel). */
  get currentZoom(): number {
    return this.zoom;
  }
}
