/**
 * @module ui/idleFade
 * THE QUIET HUD (it.117). On a phone the head-up furniture is the single
 * largest thing standing between the player and the game: an icon rail down
 * the right, a chart in the corner, a zone chip, a command sheet. The thumb
 * stick has faded itself since it.66 and nobody has ever missed it. This does
 * the same for the rest.
 *
 * THE RULE IS "NOT NEEDED", NOT "NOT TOUCHED". A few seconds without input
 * dims the things you look at between fights — the rail, the chart, the zone
 * chip, the command sheet, the log. It never touches the health plate, the
 * objectives or the notices, because those are exactly what a player reads
 * while their hands are busy and reading them must never cost a tap.
 *
 * NOTHING VANISHES MID-FIGHT: a swing, a wound, a growl or a level-up wakes
 * the HUD as surely as a finger does. That is why this listens to the bus as
 * well as to the glass — a player being hit is not idle, whatever the input
 * devices think.
 *
 * It is a CLASS ON THE BODY (`hud-idle`) and nothing else, so the stylesheet
 * decides what dims and by how much, and a single `:active`-style wake path
 * puts everything back in one frame.
 */

import { eventBus } from '@/core/EventBus';
import { layout } from '@/core/OrientationManager';

/** Quiet for this long and the furniture dims. */
const IDLE_MS = 4500;
/** The wake is instant; the fade is slow, so it never reads as a glitch. */
const CSS = `
:root { --hud-idle-ms: 900ms; }
body.hud-idle #system-bar,
body.hud-idle #zone-label,
body.hud-idle #minimap:not(.expanded),
body.hud-idle #controls,
body.hud-idle #chat.collapsed,
body.hud-idle #fullscreen-btn {
  opacity: 0.34;
  transition: opacity var(--hud-idle-ms) ease 0.1s;
}
/* The hotbar is a control, not decoration: it dims, but stays readable. */
body.hud-idle #skill-bar { opacity: 0.66; transition: opacity var(--hud-idle-ms) ease 0.1s; }
/* Coming back is immediate — a fade-in here would feel like lag on a tap. */
#system-bar, #zone-label, #minimap, #controls, #skill-bar, #fullscreen-btn { transition: opacity 0.12s ease; }
/* THE PLATE, THE OBJECTIVES AND THE NOTICES NEVER DIM. Named here so a later
   hand adding a body-wide rule cannot quietly take them with it. */
body.hud-idle #status-frame,
body.hud-idle #quest-track,
body.hud-idle #hud-buffs,
body.hud-idle #toast-stack,
body.hud-idle #boss-bar { opacity: 1; }
/* NO "DESKTOP KEEPS IT BRIGHT" RULE HERE, deliberately. The first cut had one
   ('body:not(.input-touch) #system-bar { opacity: 1 }') and it tied on
   specificity with the dimming rule above — same one id, one class, one
   element — so the later rule won and the HUD never dimmed anywhere. It was
   redundant anyway: 'hud-idle' is only ever put on the body when the layout
   reports a touch screen, so a pointer never sees it. */
`;

class IdleFade {
  private timer = 0;
  private started = false;
  private held = 0;
  private readonly offs: Array<() => void> = [];

  /** Begin watching. Safe to call more than once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (!document.getElementById('idle-fade-css')) {
      const style = document.createElement('style');
      style.id = 'idle-fade-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const wake = (): void => this.wake();
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const) {
      window.addEventListener(ev, wake, { capture: true, passive: true });
      this.offs.push(() => window.removeEventListener(ev, wake, { capture: true } as EventListenerOptions));
    }
    // A fight is not idleness. These are the four events that only ever fire
    // while something is happening to the hero or in front of them.
    for (const ev of ['entity:damaged', 'combat:swing', 'enemy:aggro', 'entity:healed'] as const) {
      this.offs.push(eventBus.on(ev, wake));
    }
    this.wake();
  }

  /**
   * Hold the HUD awake (a panel is open, a conversation is running). Balanced
   * calls: `hold(true)` … `hold(false)`.
   */
  hold(on: boolean): void {
    this.held = Math.max(0, this.held + (on ? 1 : -1));
    if (on) this.wake();
    else if (!this.held) this.wake();
  }

  /** Full opacity now; dim again after a quiet beat. */
  wake(): void {
    document.body.classList.remove('hud-idle');
    window.clearTimeout(this.timer);
    if (!this.started) return;
    this.timer = window.setTimeout(() => {
      // A held HUD, a desktop pointer, or a screen with no run on it: nothing
      // to dim. The timer simply does not arm again until the next wake.
      if (this.held > 0 || !layout.state.touch) return;
      if (!document.body.classList.contains('in-run')) return;
      document.body.classList.add('hud-idle');
    }, IDLE_MS);
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.started = false;
    this.held = 0;
    document.body.classList.remove('hud-idle');
  }
}

export const idleFade = new IdleFade();
