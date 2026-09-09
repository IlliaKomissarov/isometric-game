/**
 * @module ui/CineDialogue
 * THE WORD OVER A CUTSCENE (it.102) — the corner speech box.
 *
 * Up to it.101 everything said during a scene was floating world text over the
 * speaker's head: gold, small, and gone in a second and a half. On a phone, and
 * at any distance from the camera, it was unreadable, and it never said WHO was
 * talking — a crowd scene was six anonymous shouts.
 *
 * This is the other half: a portrait box pinned in the LOWER-LEFT corner, above
 * the letterbox bar, carrying the speaker's face, their name, who they are, and
 * the line itself at panel size. The floating text stays (it still points at the
 * body who said it); this says who that body is.
 *
 * It is render-only and drives nothing: `say()` is called from the scene's own
 * update, `clear()` when the bars lift. One element for the page, reused; it
 * sits ABOVE `#cine-layer` and is the one head-up thing `body.cine` leaves on.
 */

export interface CineLine {
  speaker: string;
  /** Under the name: who they are ("of the city watch"). */
  role?: string;
  text: string;
  /** The speaker's own face, cropped to the head - main's `portraitFromTexture`. */
  portrait?: HTMLCanvasElement | null;
  /** Seconds it holds before fading on its own. Ignored when `wait` is set. */
  hold?: number;
  /**
   * THE LINE WAITS (it.103): no timer at all, and a "SPACE / TAP" prompt under
   * it. It comes down when the scene is advanced, not when a clock runs out.
   */
  wait?: boolean;
  /** The enemy's word: read in the company's red rather than the city's gold. */
  foe?: boolean;
}

export class CineDialogue {
  private readonly box: HTMLElement;
  private readonly face: HTMLElement;
  private readonly who: HTMLElement;
  private readonly role: HTMLElement;
  private readonly line: HTMLElement;
  private readonly next: HTMLElement;
  /** Seconds left on the line currently up; 0 is nothing showing. */
  private left = 0;
  /** What is on screen, so an identical repeat does not restart the animation. */
  private shown = '';

  constructor() {
    this.box = document.createElement('div');
    this.box.id = 'cine-speak';
    this.box.innerHTML = '<div class="cs-face"></div><div class="cs-body"><b class="cs-who"></b><i class="cs-role"></i><p class="cs-line"></p><span class="cs-next"><kbd>SPACE</kbd> CONTINUE</span></div>';
    document.body.appendChild(this.box);
    this.face = this.box.querySelector('.cs-face')!;
    this.who = this.box.querySelector('.cs-who')!;
    this.role = this.box.querySelector('.cs-role')!;
    this.line = this.box.querySelector('.cs-line')!;
    this.next = this.box.querySelector('.cs-next')!;
  }

  /**
   * On a touch screen there is no Space to press, and the prompt has to say so.
   * Read at SAY time, not at construction: `input-touch` is set by the layout
   * manager and can flip mid-session when a phone is plugged into a keyboard.
   */
  private setPrompt(): void {
    const touch = document.body.classList.contains('input-touch');
    const want = touch ? 'TAP TO CONTINUE' : '<kbd>SPACE</kbd> CONTINUE';
    if (this.next.innerHTML !== want) this.next.innerHTML = want;
  }

  /** Put a line up. A new one replaces whatever is there at once. */
  say(l: CineLine): void {
    const key = `${l.speaker}|${l.text}`;
    // A waited line carries no clock at all (it.103): `left` stays 0 and `update`
    // never touches it, so nothing but the player takes the line down.
    this.left = l.wait ? 0 : l.hold ?? 3.4;
    this.box.classList.toggle('waits', !!l.wait);
    if (l.wait) this.setPrompt();
    if (key === this.shown) return;
    this.shown = key;
    this.who.textContent = l.speaker;
    this.role.textContent = l.role ?? '';
    this.line.textContent = l.text;
    this.box.classList.toggle('foe', !!l.foe);
    // THE FACE. A portrait canvas is a live DOM node and may be handed to the box
    // more than once in a scene, so it is re-parented rather than copied.
    this.face.replaceChildren();
    if (l.portrait) {
      this.face.appendChild(l.portrait);
      this.box.classList.remove('faceless');
    } else this.box.classList.add('faceless');
    this.box.classList.add('show');
  }

  /** Render-frame tick: the line fades on its own when its hold runs out. */
  update(dt: number): void {
    if (this.left <= 0) return;
    this.left -= dt;
    if (this.left <= 0) {
      this.left = 0;
      this.shown = '';
      this.box.classList.remove('show');
    }
  }

  /** The bars lift: nothing is being said any more. */
  clear(): void {
    this.left = 0;
    this.shown = '';
    this.box.classList.remove('show');
  }

  destroy(): void {
    this.box.remove();
  }
}
