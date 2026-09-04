/**
 * @module ui/VirtualJoystick
 * THE THUMB STICK (it.63): an analog pad driven by raw PointerEvents.
 *
 * One pointer owns the stick from `pointerdown` to `pointerup`, captured on
 * the element so a thumb that slides off the base keeps steering. Every other
 * pointer on the screen is untouched, which is what lets the right thumb cast
 * while the left one walks. `touch-action: none` on the element kills the
 * browser's scroll, double-tap-zoom and long-press gestures outright, so
 * there is no 300 ms tax on any input.
 *
 * The stick reports a SCREEN-space unit vector. The caller turns that into
 * the isometric world axes — the same mapping the keyboard uses.
 */

export interface JoystickOptions {
  /** Radius the knob may travel from the base's centre (CSS px). */
  radius?: number;
  /** Below this fraction of the radius the stick reads as centred. */
  deadzone?: number;
  /** In floating mode the base jumps to wherever the thumb lands. */
  floating?: boolean;
}

export class VirtualJoystick {
  readonly root: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private radius: number;
  private readonly deadzone: number;
  private floating: boolean;
  /** The current stick reading, screen space, magnitude 0..1. */
  x = 0;
  y = 0;
  private readonly abort = new AbortController();

  /** Fired whenever the direction changes materially (and once on release). */
  onChange: ((x: number, y: number) => void) | null = null;

  constructor(parent: HTMLElement, opts: JoystickOptions = {}) {
    this.radius = opts.radius ?? 56;
    this.deadzone = opts.deadzone ?? 0.18;
    this.floating = opts.floating ?? false;

    this.root = document.createElement('div');
    this.root.className = 'vj-zone';
    this.base = document.createElement('div');
    this.base.className = 'vj-base';
    this.knob = document.createElement('div');
    this.knob.className = 'vj-knob';
    this.base.appendChild(this.knob);
    this.root.appendChild(this.base);
    parent.appendChild(this.root);

    const { signal } = this.abort;
    this.root.addEventListener('pointerdown', (e) => this.onDown(e), { signal });
    this.root.addEventListener('pointermove', (e) => this.onMove(e), { signal });
    this.root.addEventListener('pointerup', (e) => this.onUp(e), { signal });
    this.root.addEventListener('pointercancel', (e) => this.onUp(e), { signal });
    // A stray context menu on a long press would steal the gesture.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
  }

  setFloating(floating: boolean): void {
    this.floating = floating;
    this.root.classList.toggle('floating', floating);
    if (!floating) this.base.style.transform = '';
  }

  setRadius(r: number): void {
    this.radius = r;
  }

  get active(): boolean {
    return this.pointerId !== null;
  }

  private onDown(e: PointerEvent): void {
    if (this.pointerId !== null) return; // Another thumb already owns the stick.
    this.pointerId = e.pointerId;
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that is already gone (or a synthetic one) cannot be captured */
    }
    this.root.classList.add('held');
    const rect = this.base.getBoundingClientRect();
    if (this.floating) {
      // The base comes to the thumb, wherever inside the zone it landed.
      const zone = this.root.getBoundingClientRect();
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.base.style.transform = `translate(${e.clientX - zone.left - rect.width / 2}px, ${e.clientY - zone.top - rect.height / 2}px)`;
    } else {
      this.originX = rect.left + rect.width / 2;
      this.originY = rect.top + rect.height / 2;
    }
    e.preventDefault();
    this.onMove(e);
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - this.originX;
    const dy = e.clientY - this.originY;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, this.radius);
    const nx = dist > 0 ? (dx / dist) * clamped : 0;
    const ny = dist > 0 ? (dy / dist) * clamped : 0;
    this.knob.style.transform = `translate(${nx.toFixed(1)}px, ${ny.toFixed(1)}px)`;
    const mag = clamped / this.radius;
    if (mag < this.deadzone) this.set(0, 0);
    else this.set(dx / (dist || 1), dy / (dist || 1));
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    try {
      this.root.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    this.root.classList.remove('held');
    this.knob.style.transform = '';
    if (this.floating) this.base.style.transform = '';
    this.set(0, 0);
  }

  private set(x: number, y: number): void {
    // Only speak when the heading actually moved (or the stick centred).
    const moved = Math.hypot(x - this.x, y - this.y) > 0.06 || (x === 0 && y === 0 && (this.x !== 0 || this.y !== 0));
    this.x = x;
    this.y = y;
    if (moved) this.onChange?.(x, y);
  }

  /** Release the stick without a pointer event (orientation flip, teardown). */
  reset(): void {
    this.pointerId = null;
    this.root.classList.remove('held');
    this.knob.style.transform = '';
    if (this.floating) this.base.style.transform = '';
    this.set(0, 0);
  }

  destroy(): void {
    this.abort.abort();
    this.root.remove();
  }
}
