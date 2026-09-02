/**
 * @module ui/Tutorial
 * Diegetic onboarding: proximity hint zones + one-shot event hints, shown as
 * a fading banner. Pure render/DOM — reads the player position, never touches
 * simulation state. Each hint shows once per session (the `seen` set
 * persists across floor rebuilds; zones are per-floor via `setZones`).
 */

export interface HintZone {
  id: string;
  x: number;
  y: number;
  radius: number;
  text: string;
}

const SHOW_SECONDS = 5.5;
const GAP_SECONDS = 0.8;

export class TutorialUI {
  private readonly banner: HTMLElement;
  private zones: ReadonlyArray<HintZone> = [];
  private readonly seen = new Set<string>();
  private readonly queue: string[] = [];
  private showTimer = 0;
  private gapTimer = 0;

  constructor() {
    this.banner = document.createElement('div');
    this.banner.id = 'hint-banner';
    document.body.appendChild(this.banner);
  }

  /** Run teardown (it.36). */
  destroy(): void {
    this.banner.remove();
  }

  /** Replace the proximity zones (called by each floor build). */
  setZones(zones: ReadonlyArray<HintZone>): void {
    this.zones = zones;
  }

  /** Fire a one-shot event hint (item drops, first kill, …). */
  notify(id: string, text: string): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.queue.push(text);
  }

  /** Per-render-frame: zone checks + banner timing. */
  update(px: number, py: number, dt: number): void {
    for (const zone of this.zones) {
      if (this.seen.has(zone.id)) continue;
      if (Math.hypot(zone.x - px, zone.y - py) <= zone.radius) {
        this.seen.add(zone.id);
        this.queue.push(zone.text);
      }
    }

    if (this.showTimer > 0) {
      this.showTimer -= dt;
      if (this.showTimer <= 0) {
        this.banner.classList.remove('show');
        this.gapTimer = GAP_SECONDS;
      }
      return;
    }
    if (this.gapTimer > 0) {
      this.gapTimer -= dt;
      return;
    }
    const next = this.queue.shift();
    if (next !== undefined) {
      this.banner.textContent = next;
      this.banner.classList.add('show');
      this.showTimer = SHOW_SECONDS;
    }
  }
}
