/**
 * @module render/animUtil
 * Shared render-side animation helpers (it.36). Pure functions — no
 * simulation state, no allocations.
 */

/** Screen-space light direction for dynamic floor shadows (see Lighting.lightDirAt). */
export interface LightDir {
  /** Unit screen-space vector pointing AWAY from the dominant light. */
  x: number;
  y: number;
  /** Light strength 0..1 (0 = no directional shadow). */
  k: number;
}

/**
 * IDLE PACING (it.36): time-based, frame-rate independent idle frame.
 *
 * Short idles (≤6 frames — the big-pack 4-frame breathers) PING-PONG at a
 * slow breathing rate so the loop never snaps from its last frame back to
 * the first (the it.34 "stutter"). Longer idles (knight 15, ranger 12,
 * zombie 12) loop forward at a gentle rate.
 *
 * @param frameCount frames in the idle animation
 * @param t          seconds (render clock or sim elapsed — either is fine)
 * @param phase      per-entity offset so packs don't breathe in unison
 */
export function idleFrame(frameCount: number, t: number, phase: number): number {
  if (frameCount <= 1) return 0;
  if (frameCount <= 6) {
    // It.37: SLOW. 2.2 fps over a 6-step ping-pong = a ~2.7 s breath —
    // the mage/rogue no longer twitch between their four uneven frames.
    const cycle = frameCount * 2 - 2; // 4 frames → 0 1 2 3 2 1
    const fps = 2.2;
    const i = Math.floor(t * fps + phase) % cycle;
    return i < frameCount ? i : cycle - i;
  }
  const fps = frameCount >= 12 ? 7 : 5;
  return Math.floor(t * fps + phase) % frameCount;
}
