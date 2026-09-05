/**
 * @module core/VisualSettings
 * VISUAL TOGGLES (it.61): screen shake, blood & gore, the hurt flash and the
 * ambient particle density. Read at the effect sites (Camera, Gore,
 * Ambience, the title scene); persisted in localStorage. Render-side only —
 * never consulted by the simulation, so a party stays in lockstep whatever
 * each player switches off.
 */

export interface VisualSettings {
  shake: boolean;
  gore: boolean;
  flash: boolean;
  particles: boolean;
  /** Vibration on hits, kills and level-ups (phones and tablets; it.69). */
  haptics: boolean;
  /** The colour grade (it.74): a touch of contrast and desaturation over the crypt. */
  grade: boolean;
}

const KEY = 'iso-arpg-visuals';

export const visuals: VisualSettings = { shake: true, gore: true, flash: true, particles: true, haptics: true, grade: true };

try {
  const raw = localStorage.getItem(KEY);
  if (raw) Object.assign(visuals, JSON.parse(raw) as Partial<VisualSettings>);
} catch {
  /* storage unavailable or corrupt: defaults stand */
}

/** Fired after a toggle changes (the renderer re-reads the grade). */
export const visualListeners = new Set<() => void>();

export function setVisual<K extends keyof VisualSettings>(key: K, value: VisualSettings[K]): void {
  visuals[key] = value;
  for (const fn of visualListeners) fn();
  try {
    localStorage.setItem(KEY, JSON.stringify(visuals));
  } catch {
    /* ignore */
  }
}
