/**
 * @module core/Haptics
 * VIBRATION (it.69): a pulse on the glass for the moments a screen shake
 * carries on a desktop — a blow taken, a kill, a crit, a level, a death.
 *
 * Render-side only: nothing here is consulted by the simulation, so a party
 * stays in lockstep whatever each phone does. `navigator.vibrate` is a
 * courtesy the browser may refuse (iOS Safari has no such API at all;
 * Chrome ignores it without a user gesture on the page first), so every
 * call is wrapped and none is awaited.
 *
 * RATE-LIMITED: a pack of four hitting on the same tick would otherwise
 * queue four pulses into one long buzz. One pattern per 70 ms; a stronger
 * pattern may replace a weaker one that is still in flight.
 */

import { visuals } from '@/core/VisualSettings';

const GAP_MS = 70;
let lastAt = 0;
let lastWeight = 0;

const can = (): boolean => visuals.haptics && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

function pulse(pattern: number | number[], weight: number): void {
  if (!can()) return;
  const now = performance.now();
  if (now - lastAt < GAP_MS && weight <= lastWeight) return;
  lastAt = now;
  lastWeight = weight;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* refused: a courtesy, never a requirement */
  }
}

export const haptics = {
  /** A button or a bar entry under the thumb. */
  tap(): void {
    pulse(10, 1);
  },
  /** A blow landed on the hero; heavier blows buzz longer. */
  hurt(fraction: number): void {
    pulse(Math.round(18 + Math.min(1, Math.max(0, fraction)) * 42), 2);
  },
  /** The hero's crit: two sharp knocks. */
  crit(): void {
    pulse([14, 30, 22], 2);
  },
  /** A foe falls. */
  kill(): void {
    pulse(22, 2);
  },
  /** A boss falls. */
  bossKill(): void {
    pulse([40, 50, 40, 50, 70], 4);
  },
  /** A skill fired. */
  cast(): void {
    pulse(14, 1);
  },
  /** A draught drunk. */
  drink(): void {
    pulse([10, 40, 10], 1);
  },
  /** The hero levels: a rising triplet. */
  levelUp(): void {
    pulse([30, 60, 40, 60, 60], 3);
  },
  /** The hero falls. */
  death(): void {
    pulse([90, 80, 160], 5);
  },
};
