/**
 * @module ui/VirtualJoystick
 * THE THUMB STICK (it.63, rebuilt it.64): direct pointer tracking, no lag.
 *
 * The base SPAWNS UNDER THE THUMB on `pointerdown` — wherever inside its zone
 * the finger lands becomes the centre — so the very first pixel of travel is
 * already a heading. One captured pointer id owns the stick from down to up,
 * and every other pointer on the glass is left alone, which is what lets the
 * right thumb cast while the left one walks.
 *
 * ZERO LATENCY is three things: `touch-action: none` on the element (no
 * 300 ms tap arbitration, no scroll or double-tap-zoom to wait for), the
 * knob written straight from the pointer's own coordinates inside the event
 * (no rAF hop, no easing), and a heading published the instant it changes by
 * more than a hair. There is no smoothing anywhere in the path.
 */

export interface JoystickOptions {
  /** Travel from the base's centre, in CSS px, at which the heading is full. */
  radius?: number;
  /** Below this fraction of the radius the stick reads as centred. */
  deadzone?: number;
}

/** Headings closer than this are the same heading (dedupe, not smoothing). */
const EPSILON = 0.02;

export class VirtualJoystick {
  readonly root: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private radius: number;
  private deadzone: number;
  /** The current heading, screen space, unit length (0,0 = centred). */
  x = 0;
  y = 0;
  private readonly abort = new AbortController();

  /** Fired the moment the heading changes (and once on release). */
  onChange: ((x: number, y: number) => void) | null = null;

  constructor(parent: HTMLElement, opts: JoystickOptions = {}) {
    this.radius = opts.radius ?? 60;
    this.deadzone = opts.deadzone ?? 0.12;

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
    this.root.addEventListener('lostpointercapture', (e) => this.onUp(e), { signal });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
  }

  setRadius(r: number): void {
    this.radius = r;
  }

  setDeadzone(d: number): void {
    this.deadzone = d;
  }

  get active(): boolean {
    return this.pointerId !== null;
  }

  private onDown(e: PointerEvent): void {
    if (this.pointerId !== null) return; // Another thumb already owns the stick.
    e.preventDefault();
    this.pointerId = e.pointerId;
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic or already-released pointer cannot be captured */
    }
    // THE BASE COMES TO THE THUMB: the touch point is the new centre.
    const zone = this.root.getBoundingClientRect();
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.base.style.left = `${e.clientX - zone.left}px`;
    this.base.style.top = `${e.clientY - zone.top}px`;
    this.root.classList.add('held');
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - this.originX;
    const dy = e.clientY - this.originY;
    const dist = Math.hypot(dx, dy);
    const travel = Math.min(dist, this.radius);
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;
    // Written straight from the event — no interpolation, no deferred frame.
    this.knob.style.transform = `translate(calc(-50% + ${(ux * travel).toFixed(1)}px), calc(-50% + ${(uy * travel).toFixed(1)}px))`;
    if (travel / this.radius < this.deadzone) this.set(0, 0);
    else this.set(ux, uy);
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
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.recentre();
    this.set(0, 0);
  }

  private set(x: number, y: number): void {
    const changed = Math.hypot(x - this.x, y - this.y) > EPSILON || (x === 0 && y === 0 && (this.x !== 0 || this.y !== 0));
    this.x = x;
    this.y = y;
    if (changed) this.onChange?.(x, y);
  }

  /**
   * THE BASE COMES HOME (it.75): it spawned under the last thumb and stayed
   * there, so after a rotation or a resize it could sit off the screen or
   * over another control. Released, it returns to the zone's centre.
   */
  private recentre(): void {
    this.base.style.left = '';
    this.base.style.top = '';
  }

  /** Release without a pointer event (a rotation, a modal, teardown). */
  reset(): void {
    this.pointerId = null;
    this.root.classList.remove('held');
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.recentre();
    this.set(0, 0);
  }

  destroy(): void {
    this.abort.abort();
    this.root.remove();
  }
}
