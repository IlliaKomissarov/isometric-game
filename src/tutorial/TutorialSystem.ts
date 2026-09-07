/**
 * @module tutorial/TutorialSystem
 * THE TRAINING GROUND (it.90): an interactive, visual onboarding that runs
 * over the live game - a spotlight that cuts the screen down to one thing,
 * an arrow that points at it, a card that says what it is in a line or two,
 * a demo that moves, and a condition the player meets by DOING it (walk,
 * strike, cast, quaff). Panels open themselves when a step is about them.
 *
 * MODULAR BY DESIGN: the steps are data (`tutorialSteps`), the engine knows
 * nothing about the game beyond `TutorialHooks`, and `shouldAutoStart()` is
 * the one switch a mandatory first-time onboarding needs (off for now; the
 * sign at the yard starts it, `__game.tutor.start()` for QA).
 *
 * RENDER-SIDE ONLY: the system reads the simulation (positions, hp, the
 * commands the local hero issued) and never writes it. Opening a panel is
 * DOM; warping the party to the yard goes through main's own placement.
 */

export type PanelKind = 'inventory' | 'character' | 'talents' | 'crafting' | 'journal';

export interface TutorialHooks {
  touch: () => boolean;
  /** The local hero: where it stands, its life. */
  hero: () => { x: number; y: number; hp: number; hpMax: number };
  /** The practice dummies on this floor (empty off the town). */
  dummies: () => Array<{ id: number; x: number; y: number; hp: number; hpMax: number }>;
  /** A world point to CSS pixels on the page. */
  worldToPage: (x: number, y: number) => { x: number; y: number };
  panels: { open: (kind: PanelKind) => void; close: (kind: PanelKind) => void; isOpen: (kind: PanelKind) => boolean };
  /** Put the party at the yard's mark. */
  warpToYard: () => void;
  /** The crypt gate, for the last arrow. */
  gate: () => { x: number; y: number };
  /** Idle frames of the hero's class for the welcome card (null when none). */
  heroFrames: () => HTMLCanvasElement[] | null;
  /** The hero's class name, for the card. */
  className: () => string;
  /** The layout viewport (the simulated phone box in QA, the window otherwise): the card and the spot stay inside it. */
  viewport: () => { w: number; h: number };
  onFinish?: () => void;
}

interface StepCtx {
  touch: boolean;
  moved: number;
  hits: number;
  bestHit: number;
  lastHit: number;
  casts: number;
  quaffs: number;
  interacts: number;
  hooks: TutorialHooks;
}

export interface TutorialStep {
  id: string;
  /** A chapter title flashes before this step. */
  chapter?: string;
  title: string;
  text: (c: StepCtx) => string;
  /** What the spotlight frames: a CSS selector, or a world point. */
  target?: (c: StepCtx) => { selector?: string; world?: { x: number; y: number }; pad?: number } | null;
  /** A moving demo inside the card (HTML). */
  demo?: (c: StepCtx) => string;
  enter?: (c: StepCtx) => void;
  exit?: (c: StepCtx) => void;
  /** Met by doing: the step advances itself. Absent = a NEXT button. */
  done?: (c: StepCtx) => boolean;
  progress?: (c: StepCtx) => string;
}

export const TUTORIAL_DONE_KEY = 'iso-arpg-tutorial-done';
/** THE ONE SWITCH: true = every new delver walks the yard before the crypt. Off while the yard is for testing. */
export const AUTO_ONBOARD = false;

/** Whether a run should open with the tutorial (the future mandatory onboarding). */
export function shouldAutoStart(): boolean {
  if (!AUTO_ONBOARD) return false;
  try {
    return localStorage.getItem(TUTORIAL_DONE_KEY) !== '1';
  } catch {
    return false;
  }
}

const keys = (...caps: string[]): string => `<span class="tut-keys">${caps.map((k, i) => `<kbd style="animation-delay:${(i * 0.22).toFixed(2)}s">${k}</kbd>`).join('')}</span>`;
const stick = (): string => '<span class="tut-stick"><i></i></span>';
const tap = (label: string): string => `<span class="tut-tap"><i></i><b>${label}</b></span>`;
const mouse = (): string => '<span class="tut-mouse"><i></i></span>';

/** The steps: three chapters, sixteen beats, each a line or two. */
export const tutorialSteps: TutorialStep[] = [
  {
    id: 'welcome',
    chapter: 'I · THE YARD',
    title: 'THE TRAINING GROUND',
    text: (c) => `Three dummies, a yard, no one watching. Learn the crypt's ways here, ${c.hooks.className().toLowerCase()} - it takes two minutes.`,
    demo: () => '<div class="tut-hero" data-hero></div>',
  },
  {
    id: 'move',
    title: 'MOVE',
    text: (c) => (c.touch ? 'Press anywhere on the left and drag: the stick spawns under your thumb.' : 'Click where you want to stand, or hold W A S D. The hero paths around what blocks the way.'),
    demo: (c) => (c.touch ? stick() : `${mouse()}${keys('W', 'A', 'S', 'D')}`),
    done: (c) => c.moved >= 4,
    progress: (c) => `walked ${Math.min(4, Math.floor(c.moved))} / 4 tiles`,
  },
  {
    id: 'strike',
    title: 'TARGET AND STRIKE',
    text: (c) => (c.touch ? 'Walk to a dummy and hold the blades: the hero turns to the nearest foe and swings.' : 'Click a dummy, or stand beside it and hold SPACE: the hero turns to the nearest foe and swings.'),
    target: (c) => nearestDummy(c),
    demo: (c) => (c.touch ? tap('ATTACK') : keys('SPACE')),
    done: (c) => c.hits >= 3,
    progress: (c) => `landed ${Math.min(3, c.hits)} / 3 blows`,
  },
  {
    id: 'damage',
    title: 'DAMAGE',
    text: () => 'Every blow rolls to hit, then for damage; armor turns a share. The number over the dummy is what landed - crits read gold.',
    target: (c) => nearestDummy(c),
    progress: (c) => (c.lastHit > 0 ? `last blow ${c.lastHit} · best ${c.bestHit}` : ''),
  },
  {
    id: 'skill',
    title: 'SKILLS',
    text: (c) => (c.touch ? 'The arc on the right holds four skills. Tap the first at a dummy: it costs resource and starts a cooldown.' : 'Skills sit on 1 2 3 4. Press 1 near a dummy: it costs resource and starts a cooldown sweep on the slot.'),
    target: (c) => ({ selector: c.touch ? '#touch-controls .tc-skill-0' : '#skill-bar .skill-slot:not(.belt-slot)' }),
    demo: (c) => (c.touch ? tap('1') : keys('1')),
    done: (c) => c.casts >= 1,
    progress: (c) => `cast ${Math.min(1, c.casts)} / 1`,
  },
  {
    id: 'quaff',
    title: 'DRAUGHTS',
    text: (c) => (c.touch ? 'The flasks above the stick: the red heals, the blue restores. Each has its own cooldown; the belt in your pack decides what fills them.' : 'Q heals, R restores. Each has its own cooldown; the belt in your pack decides what fills them. Quaff one now.'),
    target: (c) => ({ selector: c.touch ? '#touch-controls .tc-potion' : '#skill-bar .belt-slot' }),
    demo: (c) => (c.touch ? tap('Q') : keys('Q', 'R')),
    done: (c) => c.quaffs >= 1,
    progress: (c) => `quaffed ${Math.min(1, c.quaffs)} / 1`,
  },
  {
    id: 'inventory',
    chapter: 'II · THE PACK',
    title: 'THE PACK',
    text: (c) => (c.touch ? 'Your pack and the doll that wears it. Tap a piece to equip it; hold one for its card - its numbers beside yours, green better, red worse.' : 'Your pack and the doll that wears it. Click a piece to equip it; hover for its card - its numbers beside yours, green better, red worse.'),
    target: () => ({ selector: '#inv-panel', pad: 6 }),
    demo: (c) => (c.touch ? '' : keys('I')),
    enter: (c) => c.hooks.panels.open('inventory'),
    exit: (c) => c.hooks.panels.close('inventory'),
  },
  {
    id: 'character',
    title: 'THE HERO',
    text: () => 'Your numbers: damage, armor, crit, dodge, and where every point of Strength, Agility or Intellect goes.',
    target: () => ({ selector: '#char-sheet', pad: 6 }),
    demo: (c) => (c.touch ? '' : keys('C')),
    enter: (c) => c.hooks.panels.open('character'),
    exit: (c) => c.hooks.panels.close('character'),
  },
  {
    id: 'talents',
    title: 'TALENTS AND HOTKEYS',
    text: () => 'A point a level buys skills and passives. Put any learned skill on slots 1 to 4 here - that is how you rebind them.',
    target: () => ({ selector: '#skill-tree', pad: 6 }),
    demo: (c) => (c.touch ? '' : keys('K')),
    enter: (c) => c.hooks.panels.open('talents'),
    exit: (c) => c.hooks.panels.close('talents'),
  },
  {
    id: 'crafting',
    title: 'THE CAMP FORGE',
    text: () => 'Salvage what you will not wear, forge from blueprints, reinforce to +15, lay an enchantment. The rack by the campfire opens this.',
    target: () => ({ selector: '#craft-panel', pad: 6 }),
    enter: (c) => c.hooks.panels.open('crafting'),
    exit: (c) => c.hooks.panels.close('crafting'),
  },
  {
    id: 'journal',
    title: 'THE JOURNAL',
    text: (c) => (c.touch ? 'Every rule in one book: items, statuses, recipes, combat, the dark\'s measure. The book on the bar opens it anywhere.' : 'Every rule in one book: items, statuses, recipes, combat, the dark\'s measure. H opens it anywhere.'),
    target: () => ({ selector: '#codex', pad: 6 }),
    demo: (c) => (c.touch ? '' : keys('H')),
    enter: (c) => c.hooks.panels.open('journal'),
    exit: (c) => c.hooks.panels.close('journal'),
  },
  {
    id: 'plate',
    chapter: 'III · THE ROAD',
    title: 'THE PLATE',
    text: () => 'Life, resource and experience, your level and your gold. Buffs and wards line up beneath it with their clocks.',
    target: () => ({ selector: '#status-frame', pad: 8 }),
  },
  {
    id: 'chart',
    title: 'THE CHART AND THE BAR',
    text: (c) => (c.touch ? 'The chart remembers where you have been; tap it to enlarge. The bar under it opens every window.' : 'The chart remembers where you have been; M enlarges it. The bar under it opens every window.'),
    target: () => ({ selector: '#hud-tr', pad: 8 }),
    demo: (c) => (c.touch ? '' : keys('M')),
  },
  {
    id: 'interact',
    title: 'INTERACT',
    text: (c) => (c.touch ? 'The open hand talks, loots and opens - chests, keys, merchants, the gatekeeper. Try it on the sign.' : 'E talks, loots and opens - chests, keys, merchants, the gatekeeper. Press it at the sign.'),
    target: (c) => ({ selector: c.touch ? '#touch-controls .tc-interact' : undefined, world: c.touch ? undefined : yardPost(c) }),
    demo: (c) => (c.touch ? tap('E') : keys('E')),
    done: (c) => c.interacts >= 1,
    progress: (c) => `used ${Math.min(1, c.interacts)} / 1`,
  },
  {
    id: 'portal',
    title: 'THE WAY HOME',
    text: (c) => (c.touch ? 'The rift on the right casts the way home from any depth, on a twelve-second breath. Free.' : 'T casts the way home from any depth, on a twelve-second breath. Free.'),
    target: (c) => ({ selector: c.touch ? '#touch-controls .tc-portal' : '#tp-button' }),
    demo: (c) => (c.touch ? '' : keys('T')),
  },
  {
    id: 'gate',
    title: 'THE CRYPT GATE',
    text: () => 'Twenty depths, a warden every fifth, one crown of ash. The gate is at the top of the old quarter. Go.',
    target: (c) => ({ world: c.hooks.gate(), pad: 30 }),
  },
];

function nearestDummy(c: StepCtx): { world: { x: number; y: number }; pad: number } | null {
  const h = c.hooks.hero();
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const d of c.hooks.dummies()) {
    const dist = Math.hypot(d.x - h.x, d.y - h.y);
    if (dist < bd) {
      bd = dist;
      best = { x: d.x, y: d.y };
    }
  }
  return best ? { world: best, pad: 26 } : null;
}

function yardPost(c: StepCtx): { x: number; y: number } {
  void c;
  return TutorialSystem.yardPost;
}

const CHAPTER_MS = 1500;

export class TutorialSystem {
  /** The sign's world point (set by main from the layout). */
  static yardPost = { x: 16.5, y: 70.5 };

  private readonly layer: HTMLElement;
  private readonly spot: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly card: HTMLElement;
  private readonly chapterEl: HTMLElement;
  private readonly abort = new AbortController();
  private steps: TutorialStep[] = tutorialSteps;
  private index = -1;
  private running = false;
  private ctx: StepCtx;
  private lastHero = { x: 0, y: 0 };
  private doneAt = 0;
  private chapterUntil = 0;
  private heroTimer = 0;
  private dummyIds = new Set<number>();

  constructor(private readonly hooks: TutorialHooks) {
    this.ctx = { touch: hooks.touch(), moved: 0, hits: 0, bestHit: 0, lastHit: 0, casts: 0, quaffs: 0, interacts: 0, hooks };
    this.layer = document.createElement('div');
    this.layer.id = 'tut-layer';
    this.layer.innerHTML = `
      <div id="tut-spot"></div>
      <div id="tut-arrow"><svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 4 L36 24 L26 24 L26 36 L14 36 L14 24 L4 24 Z" fill="#ffd070" stroke="#3a2a10" stroke-width="2" stroke-linejoin="round"/></svg></div>
      <div id="tut-card">
        <div class="tut-head"><span class="tut-step"></span><span class="tut-title"></span><button class="tut-x" type="button" data-tut="end" title="End the tutorial"><i></i></button></div>
        <div class="tut-text"></div>
        <div class="tut-demo"></div>
        <div class="tut-foot"><span class="tut-progress"></span><span class="tut-buttons"><button class="menu-btn tut-btn" type="button" data-tut="back">BACK</button><button class="menu-btn tut-btn tut-next" type="button" data-tut="next">NEXT</button></span></div>
      </div>
      <div id="tut-chapter"><b></b></div>`;
    document.body.appendChild(this.layer);
    this.spot = this.layer.querySelector('#tut-spot')!;
    this.arrow = this.layer.querySelector('#tut-arrow')!;
    this.card = this.layer.querySelector('#tut-card')!;
    this.chapterEl = this.layer.querySelector('#tut-chapter')!;
    this.card.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tut]');
      if (!b) return;
      e.stopPropagation();
      const act = b.dataset.tut;
      if (act === 'next') this.next();
      else if (act === 'back') this.back();
      else if (act === 'end') this.end(false);
    });
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (!this.running) return;
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.next();
        }
      },
      { signal: this.abort.signal, capture: true },
    );
  }

  get isRunning(): boolean {
    return this.running;
  }

  get stepId(): string {
    return this.steps[this.index]?.id ?? '';
  }

  get stepIndex(): number {
    return this.index;
  }

  /** Begin at the yard: the party is placed, the counters reset, the first card rises. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.ctx = { touch: this.hooks.touch(), moved: 0, hits: 0, bestHit: 0, lastHit: 0, casts: 0, quaffs: 0, interacts: 0, hooks: this.hooks };
    this.dummyIds = new Set(this.hooks.dummies().map((d) => d.id));
    this.hooks.warpToYard();
    const h = this.hooks.hero();
    this.lastHero = { x: h.x, y: h.y };
    document.body.classList.add('tutorial-on');
    this.layer.classList.add('show');
    this.index = -1;
    this.go(0);
  }

  /** Leave the yard: finished (remembered) or abandoned. */
  end(finished: boolean): void {
    if (!this.running) return;
    const cur = this.steps[this.index];
    cur?.exit?.(this.ctx);
    this.running = false;
    this.index = -1;
    this.layer.classList.remove('show');
    document.body.classList.remove('tutorial-on');
    if (finished) {
      try {
        localStorage.setItem(TUTORIAL_DONE_KEY, '1');
      } catch {
        /* ignore */
      }
      this.hooks.onFinish?.();
    }
  }

  next(): void {
    if (!this.running) return;
    if (this.index >= this.steps.length - 1) {
      this.end(true);
      return;
    }
    this.go(this.index + 1);
  }

  back(): void {
    if (!this.running || this.index <= 0) return;
    this.go(this.index - 1);
  }

  /** The local hero issued a command (fed by main from the command stream). */
  noteCommand(type: string): void {
    if (!this.running) return;
    if (type === 'SKILL') this.ctx.casts++;
    else if (type === 'USE_QUICK') this.ctx.quaffs++;
    else if (type === 'PICKUP_NEAREST') this.ctx.interacts++;
  }

  /** A blow landed somewhere (fed by main); only the dummies count. */
  noteDamage(entityId: number, amount: number): void {
    if (!this.running || !this.dummyIds.has(entityId)) return;
    this.ctx.hits++;
    this.ctx.lastHit = amount;
    if (amount > this.ctx.bestHit) this.ctx.bestHit = amount;
  }

  /** Per render frame: walk distance, the spotlight's place, the step's condition. */
  update(dt: number): void {
    if (!this.running) return;
    const h = this.hooks.hero();
    const d = Math.hypot(h.x - this.lastHero.x, h.y - this.lastHero.y);
    if (d < 2) this.ctx.moved += d; // A warp is not a walk.
    this.lastHero = { x: h.x, y: h.y };
    const step = this.steps[this.index];
    if (!step) return;
    this.place(step);
    const prog = this.card.querySelector<HTMLElement>('.tut-progress');
    if (prog && step.progress) {
      const t = step.progress(this.ctx);
      if (prog.textContent !== t) prog.textContent = t;
    }
    if (this.chapterUntil > 0 && performance.now() > this.chapterUntil) {
      this.chapterUntil = 0;
      this.chapterEl.classList.remove('show');
    }
    // The hero demo: idle frames, time-based.
    const heroEl = this.card.querySelector<HTMLElement>('[data-hero]');
    if (heroEl) {
      this.heroTimer += dt;
      const frames = this.hooks.heroFrames();
      if (frames && frames.length) {
        const i = Math.floor(this.heroTimer * 6) % frames.length;
        const cv = heroEl.firstElementChild as HTMLCanvasElement | null;
        if (!cv || cv.dataset.i !== String(i)) {
          const src = frames[i];
          const c = cv ?? document.createElement('canvas');
          c.width = src.width;
          c.height = src.height;
          c.getContext('2d')?.drawImage(src, 0, 0);
          c.dataset.i = String(i);
          if (!cv) heroEl.appendChild(c);
        }
      }
    }
    if (step.done) {
      const ok = step.done(this.ctx);
      this.card.classList.toggle('tut-done', ok);
      if (ok) {
        if (this.doneAt === 0) this.doneAt = performance.now();
        else if (performance.now() - this.doneAt > 900) this.next();
      } else this.doneAt = 0;
    }
  }

  destroy(): void {
    this.abort.abort();
    this.layer.remove();
    document.body.classList.remove('tutorial-on');
  }

  private go(i: number): void {
    const prev = this.steps[this.index];
    prev?.exit?.(this.ctx);
    this.index = i;
    this.doneAt = 0;
    const step = this.steps[i];
    this.ctx.touch = this.hooks.touch();
    if (step.chapter) {
      const b = this.chapterEl.querySelector('b');
      if (b) b.textContent = step.chapter;
      this.chapterEl.classList.remove('show');
      void this.chapterEl.offsetWidth;
      this.chapterEl.classList.add('show');
      this.chapterUntil = performance.now() + CHAPTER_MS;
    }
    step.enter?.(this.ctx);
    const q = <T extends HTMLElement>(sel: string): T => this.card.querySelector<T>(sel)!;
    q('.tut-step').textContent = `${i + 1} / ${this.steps.length}`;
    q('.tut-title').textContent = step.title;
    q('.tut-text').innerHTML = step.text(this.ctx);
    const demo = step.demo?.(this.ctx) ?? '';
    const demoEl = q('.tut-demo');
    demoEl.innerHTML = demo;
    demoEl.hidden = !demo;
    q('.tut-progress').textContent = step.progress?.(this.ctx) ?? '';
    q<HTMLButtonElement>('[data-tut=back]').hidden = i === 0;
    const nextBtn = q<HTMLButtonElement>('[data-tut=next]');
    nextBtn.textContent = i === this.steps.length - 1 ? 'INTO THE CRYPT' : step.done ? 'SKIP STEP' : 'NEXT';
    this.card.classList.remove('tut-done', 'tut-in');
    void this.card.offsetWidth; // Restart the entrance animation.
    this.card.classList.add('tut-in');
    this.heroTimer = 0;
    this.place(step, true);
  }

  /** Frame the target, aim the arrow, seat the card beside it. */
  private place(step: TutorialStep, jump = false): void {
    const t = step.target?.(this.ctx) ?? null;
    let rect: { left: number; top: number; width: number; height: number } | null = null;
    if (t?.selector) {
      const el = document.querySelector<HTMLElement>(t.selector);
      if (el && el.getClientRects().length) {
        const r = el.getBoundingClientRect();
        const pad = t.pad ?? 8;
        rect = { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
      }
    } else if (t?.world) {
      const p = this.hooks.worldToPage(t.world.x, t.world.y);
      const pad = t.pad ?? 26;
      rect = { left: p.x - pad, top: p.y - pad * 2.2, width: pad * 2, height: pad * 2.8 };
    }
    const { w: vw, h: vh } = this.hooks.viewport();
    this.spot.classList.toggle('jump', jump);
    if (rect) {
      this.spot.classList.add('on');
      this.spot.style.left = `${Math.round(rect.left)}px`;
      this.spot.style.top = `${Math.round(rect.top)}px`;
      this.spot.style.width = `${Math.round(rect.width)}px`;
      this.spot.style.height = `${Math.round(rect.height)}px`;
    } else {
      this.spot.classList.remove('on');
    }
    // The card: below the target when there is room, else above, else beside; centred when there is no target.
    const cw = Math.min(380, vw - 24);
    const ch = this.card.offsetHeight || 200;
    let cx = (vw - cw) / 2;
    let cy = (vh - ch) / 2;
    let side: 'top' | 'bottom' | 'left' | 'right' | 'none' = 'none';
    if (rect) {
      const gap = 22;
      if (rect.top + rect.height + gap + ch < vh - 12) {
        side = 'bottom';
        cy = rect.top + rect.height + gap;
      } else if (rect.top - gap - ch > 12) {
        side = 'top';
        cy = rect.top - gap - ch;
      } else if (rect.left + rect.width + gap + cw < vw - 12) {
        side = 'right';
        cx = rect.left + rect.width + gap;
        cy = Math.max(12, Math.min(vh - ch - 12, rect.top + rect.height / 2 - ch / 2));
      } else if (rect.left - gap - cw > 12) {
        side = 'left';
        cx = rect.left - gap - cw;
        cy = Math.max(12, Math.min(vh - ch - 12, rect.top + rect.height / 2 - ch / 2));
      } else {
        // A target as big as the screen (a panel): the card sits low and centred, the panel's head stays clear.
        side = 'none';
        cx = (vw - cw) / 2;
        cy = Math.max(12, vh - ch - 14);
      }
      if (side === 'bottom' || side === 'top') cx = Math.max(12, Math.min(vw - cw - 12, rect.left + rect.width / 2 - cw / 2));
    }
    this.card.style.width = `${Math.round(cw)}px`;
    this.card.style.left = `${Math.round(cx)}px`;
    this.card.style.top = `${Math.round(cy)}px`;
    // The arrow sits between the card and the target and points at the target.
    if (rect && side !== 'none') {
      this.arrow.classList.add('on');
      const size = 40;
      let ax = rect.left + rect.width / 2 - size / 2;
      let ay = rect.top + rect.height / 2 - size / 2;
      let rot = 0;
      if (side === 'bottom') {
        ay = rect.top + rect.height + 2;
        rot = 0;
      } else if (side === 'top') {
        ay = rect.top - size - 2;
        rot = 180;
      } else if (side === 'right') {
        ax = rect.left + rect.width + 2;
        rot = -90;
      } else {
        ax = rect.left - size - 2;
        rot = 90;
      }
      this.arrow.style.left = `${Math.round(ax)}px`;
      this.arrow.style.top = `${Math.round(ay)}px`;
      this.arrow.style.setProperty('--rot', `${rot}deg`);
    } else this.arrow.classList.remove('on');
  }
}
