/**
 * @module tutorial/TutorialSystem
 * THE TRAINING GROUND (it.90): an interactive, visual onboarding that runs
 * over the live game - a highlight that picks one thing out, an arrow that
 * points at it, a card that says what it is in a line or two, a demo that
 * moves, and a condition the player meets by DOING it (walk, strike, cast,
 * quaff). Panels open themselves when a step is about them.
 *
 * NOTHING IS DARKENED (it.117). Up to it.116 the highlight was a spotlight -
 * a 9999 px box-shadow that blacked out the whole page around the one thing
 * being taught - and the owner could not see what was going on in the yard
 * while being taught to fight in it. The highlight is now ADDITIVE: a bright
 * animated rim and a glow on the target, the gold square on the ground
 * in-world, and at most a whisper of a vignette while Lord Milk demonstrates.
 * The world is legible at every moment of the lesson.
 *
 * SHE SHOWS MORE, AND SLOWER (it.117). Six of the steps now open with a
 * demonstration - the walk, the greeting, the cut, the cut again, the spell,
 * the draught - and the first showing of each runs at the step's `slow` rate.
 * That rate is RENDER-SIDE ONLY: it reaches her sprite's frame clock and the
 * show's own timers, never the simulation's fixed 60 Hz tick. Every showing
 * is cut short by ENTER.
 *
 * MODULAR BY DESIGN: the steps are data (`tutorialSteps`), the engine knows
 * nothing about the game beyond `TutorialHooks`, and `shouldAutoStart()` is
 * the one switch a mandatory first-time onboarding needs (off for now; LORD
 * MILK at the yard starts it - it.115 - or the sign beside her, and
 * `__game.tutor.start()` for QA).
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
  /**
   * WHO RUNS THE YARD (it.115): LORD MILK. Her name, her title and her face
   * sit at the head of every card, and the cards are in her voice.
   */
  mentor?: () => { name: string; role: string; portrait: HTMLCanvasElement | null };
  /** Where Lord Milk stands (it.116), for the shots and the marks. */
  milk?: () => { x: number; y: number } | null;
  /** Her own dummy (it.116): every lesson is shown on it, never on the player's. */
  milkDummy?: () => { x: number; y: number } | null;
  /**
   * THE YARD'S CAMERA (it.116): each frame, the point the camera should look
   * at and the zoom to hold (null, null: give the camera back to the player).
   * Main eases both.
   */
  frame?: (focus: { x: number; y: number } | null, zoom: number | null) => void;
  /** Cinema bars in or out (it.116). */
  bars?: (on: boolean) => void;
  /** A ring on the ground under what the card is about (it.116); null clears it. */
  mark?: (at: { x: number; y: number } | null) => void;
  /**
   * LORD MILK SHOWS HOW (it.116, slowed it.117): she performs the lesson on the
   * dummy (or the hero) at `on` - a step, a swing, a spell, a draught, a hand
   * raised in greeting - and the call answers how long it takes, in seconds
   * (0: she could not). `rate` is a RENDER-SIDE speed: 0.5 plays her clip at
   * half pace so the player can read what her body is doing. It reaches her
   * sprite's frame clock and the show's own timers and NOTHING else - the
   * simulation's fixed 60 Hz tick never hears about it.
   */
  lesson?: (kind: Lesson, on: { x: number; y: number }, rate: number) => number;
}

export type Lesson = 'move' | 'strike' | 'skill' | 'quaff' | 'interact';

/** A step's framing: the points to keep in view, the zoom, and whether the bars come down. */
export interface Shot {
  at: Array<{ x: number; y: number }>;
  zoom: number;
  bars?: boolean;
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
  /** The camera for this step (it.116); absent, the player's own. */
  shot?: (c: StepCtx) => Shot;
  /** The ground ring (it.116). */
  mark?: (c: StepCtx) => { x: number; y: number } | null;
  /** Lord Milk demonstrates first (it.116). */
  lesson?: Lesson;
  /**
   * ...and the first showing runs at this fraction of speed (it.117): 0.4 is
   * a demonstration slow enough to read. The reminder, eight seconds later,
   * always plays at full pace - by then the player knows what they are looking
   * at and only needs the shape of it again.
   */
  slow?: number;
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
const or = '<span class="tut-or">or</span>';

/**
 * EVERY CONTROL AT ONCE (it.116): the reference card near the end. One row a
 * verb, every way to do it - the mouse, both key sets, the touch buttons.
 */
function controlsGrid(touch: boolean): string {
  const k = (...c: string[]): string => c.map((x) => `<kbd>${x}</kbd>`).join('');
  const rows: Array<[string, string]> = touch
    ? [
        ['Move', 'drag the stick on the left · tap the ground'],
        ['Attack', 'hold the swords button · tap an enemy'],
        ['Skills', 'the four buttons on the arc'],
        ['Potions', 'the two flasks above the stick'],
        ['Talk, open, loot', 'the hand button · tap the thing'],
        ['Town portal', 'the portal button'],
        ['Windows', 'the icon bar under the map'],
      ]
    : [
        ['Move', `click the ground · ${k('W', 'A', 'S', 'D')} · ${k('↑', '←', '↓', '→')}`],
        ['Attack', `click an enemy · hold ${k('Space')} or ${k('F')}`],
        ['Skills', `${k('1', '2', '3', '4')} · click the slot`],
        ['Potions', `${k('Q')} heal · ${k('R')} mana or stamina · click the flask`],
        ['Talk, open, loot', `${k('E')} · click it`],
        ['Town portal', `${k('T')} · the portal button`],
        ['Inventory · character · talents', k('I', 'C', 'K')],
        ['Journal · map · bestiary', k('H', 'M', 'B')],
        ['Depths · settings · pause', `${k('L', 'O')} ${k('Esc')}`],
        ['Zoom', 'mouse wheel'],
        ['Next card', k('Enter')],
      ];
  return `<div class="tut-grid">${rows.map(([a, b]) => `<b>${a}</b><span>${b}</span>`).join('')}</div>`;
}

/**
 * ONE ZOOM FOR THE WHOLE YARD (it.117). Every step of the lesson used to name
 * its own level - 2.1, then 1.7, then 1.85, then 1.75 - so the view breathed in
 * and out on every card for no reason anyone could see. There are two levels
 * now and only two: the yard's, held from the first card to the last, and a
 * hair closer while Lord Milk is actually demonstrating something. The gate at
 * the end is the one exception: it is on the other side of the quarter.
 */
const YARD_ZOOM = 1.9;
const WATCH_ZOOM = 2.2;
const GATE_ZOOM = 1.3;

/** The steps: three chapters, seventeen beats, each a sentence or two. */
export const tutorialSteps: TutorialStep[] = [
  {
    id: 'welcome',
    chapter: 'I · The yard',
    title: 'The training ground',
    text: (c) => `A few minutes here and you will know how to move, fight, heal and find your way around, ${c.hooks.className().toLowerCase()}. Do what each card asks and it moves on by itself.`,
    demo: () => '<div class="tut-hero" data-hero></div>',
    shot: (c) => ({ at: [c.hooks.hero(), milkAt(c)], zoom: YARD_ZOOM, bars: true }),
    mark: (c) => milkAt(c),
    lesson: 'interact', // She turns and salutes the hero (it.117): the lesson opens on a person, not a card.
  },
  {
    id: 'move',
    title: 'Moving',
    text: (c) => (c.touch ? 'Watch me cross the yard. Then drag on the left side of the screen to bring up the stick, or tap the ground to walk there. Walk a few steps.' : 'Watch me cross the yard. Then click the ground to walk there, or steer with W A S D or the arrow keys - you walk around anything in the way. Walk a few steps.'),
    demo: (c) => (c.touch ? `${stick()}${or}${tap('tap')}` : `${mouse()}${or}${keys('W', 'A', 'S', 'D')}${or}${keys('↑', '←', '↓', '→')}`),
    lesson: 'move', // SHE WALKS IT FIRST (it.117).
    shot: (c) => ({ at: [c.hooks.hero(), milkAt(c)], zoom: YARD_ZOOM }),
    done: (c) => c.moved >= 4,
    progress: (c) => `walked ${Math.min(4, Math.floor(c.moved))} / 4 tiles`,
  },
  {
    id: 'strike',
    title: 'Attacking',
    text: (c) => (c.touch ? 'Watch the swing - slowly, so you can see where the weight goes. Then walk up to a dummy and hold the swords button: you attack whatever is nearest.' : 'Watch the swing - slowly, so you can see where the weight goes. Then click a dummy, or stand next to it and hold Space or F: you keep attacking the nearest enemy while the key is down.'),
    target: (c) => nearestDummy(c),
    mark: (c) => nearestDummy(c)?.world ?? null,
    demo: (c) => (c.touch ? tap('⚔') : `${mouse()}${or}${keys('Space')}${or}${keys('F')}`),
    lesson: 'strike',
    slow: 0.45, // HALF PACE AND A LITTLE (it.117): the lunge, the cut, the recovery.
    shot: (c) => ({ at: [c.hooks.hero(), nearestDummy(c)?.world ?? c.hooks.hero()], zoom: YARD_ZOOM }),
    done: (c) => c.hits >= 3,
    progress: (c) => `landed ${Math.min(3, c.hits)} / 3 hits`,
  },
  {
    id: 'damage',
    title: 'Damage',
    text: () => 'Here it is again, slower still. The number over the target is the damage that landed; gold numbers are critical hits. Armor soaks part of every blow, so tough enemies show smaller numbers.',
    target: (c) => nearestDummy(c),
    mark: (c) => nearestDummy(c)?.world ?? null,
    lesson: 'strike',
    slow: 0.3, // THE NUMBER IS THE POINT (it.117): slow enough to read it as it rises.
    shot: (c) => ({ at: [c.hooks.hero(), nearestDummy(c)?.world ?? c.hooks.hero()], zoom: YARD_ZOOM }),
    progress: (c) => (c.lastHit > 0 ? `last hit ${c.lastHit} · best ${c.bestHit}` : ''),
  },
  {
    id: 'skill',
    title: 'Skills',
    text: (c) => (c.touch ? 'Watch the spell leave the hand. Then tap the first skill button on the right. Skills cost mana or stamina, and the button darkens until the skill is ready again.' : 'Watch the spell leave the hand. Then press 1 (or click the first slot) with the cursor on the dummy. Skills sit on 1 to 4, cost mana or stamina, and the slot darkens until they are ready again.'),
    target: (c) => ({ selector: c.touch ? '#touch-controls .tc-skill-0' : '#skill-bar .skill-slot:not(.belt-slot)' }),
    mark: (c) => nearestDummy(c)?.world ?? null,
    demo: (c) => (c.touch ? tap('1') : `${keys('1', '2', '3', '4')}${or}${mouse()}`),
    lesson: 'skill',
    slow: 0.5,
    shot: (c) => ({ at: [c.hooks.hero(), nearestDummy(c)?.world ?? c.hooks.hero()], zoom: YARD_ZOOM }),
    done: (c) => c.casts >= 1,
    progress: (c) => `cast ${Math.min(1, c.casts)} / 1`,
  },
  {
    id: 'quaff',
    title: 'Potions',
    text: (c) => (c.touch ? 'Watch, then tap a flask above the stick: red heals, blue restores mana or stamina. Each has its own cooldown. Drink one now - in my yard the flasks are on me, so nothing you drink here comes out of your pack.' : 'Watch, then press Q for a healing potion or R for mana or stamina - or click the flask on the bar. Each has its own cooldown. Drink one now: in my yard the flasks are on me, so nothing you drink here comes out of your pack.'),
    target: (c) => ({ selector: c.touch ? '#touch-controls .tc-potion' : '#skill-bar .belt-slot' }),
    demo: (c) => (c.touch ? tap('Q') : `${keys('Q', 'R')}${or}${mouse()}`),
    lesson: 'quaff',
    slow: 0.55,
    shot: (c) => ({ at: [c.hooks.hero(), milkAt(c)], zoom: YARD_ZOOM }),
    done: (c) => c.quaffs >= 1,
    progress: (c) => `drank ${Math.min(1, c.quaffs)} / 1`,
  },
  {
    id: 'inventory',
    chapter: 'II · Your gear',
    title: 'Inventory',
    text: (c) => (c.touch ? 'Tap an item to equip or use it; hold it to compare with what you wear - green is better, red is worse.' : 'I opens it. Click an item to equip or use it; hover it to compare with what you wear - green is better, red is worse.'),
    target: () => ({ selector: '#inv-panel', pad: 6 }),
    demo: (c) => (c.touch ? '' : keys('I')),
    enter: (c) => c.hooks.panels.open('inventory'),
    exit: (c) => c.hooks.panels.close('inventory'),
  },
  {
    id: 'character',
    title: 'Character',
    text: () => 'Damage, armor, critical chance, dodge, and what each point of Strength, Agility and Intellect gives you.',
    target: () => ({ selector: '#char-sheet', pad: 6 }),
    demo: (c) => (c.touch ? '' : keys('C')),
    enter: (c) => c.hooks.panels.open('character'),
    exit: (c) => c.hooks.panels.close('character'),
  },
  {
    id: 'talents',
    title: 'Talents',
    text: () => 'Every level gives a point for skills and passives. This is also where you choose which learned skills sit on slots 1 to 4.',
    target: () => ({ selector: '#skill-tree', pad: 6 }),
    demo: (c) => (c.touch ? '' : keys('K')),
    enter: (c) => c.hooks.panels.open('talents'),
    exit: (c) => c.hooks.panels.close('talents'),
  },
  {
    id: 'crafting',
    title: 'The forge',
    text: () => 'At the rack by the campfire: break down gear for materials, craft from blueprints, upgrade up to +15 and add enchantments.',
    target: () => ({ selector: '#craft-panel', pad: 6 }),
    enter: (c) => c.hooks.panels.open('crafting'),
    exit: (c) => c.hooks.panels.close('crafting'),
  },
  {
    id: 'journal',
    title: 'Journal',
    text: (c) => (c.touch ? 'Every item, status effect, recipe and combat rule, explained. The book on the icon bar opens it.' : 'Every item, status effect, recipe and combat rule, explained. H opens it anywhere.'),
    target: () => ({ selector: '#codex', pad: 6 }),
    demo: (c) => (c.touch ? '' : keys('H')),
    enter: (c) => c.hooks.panels.open('journal'),
    exit: (c) => c.hooks.panels.close('journal'),
  },
  {
    id: 'plate',
    chapter: 'III · The road',
    title: 'Your status',
    text: () => 'Health, mana or stamina, experience, level and gold. Active buffs line up underneath with their timers.',
    target: () => ({ selector: '#status-frame', pad: 8 }),
  },
  {
    id: 'chart',
    title: 'Map and windows',
    text: (c) => (c.touch ? 'The map remembers where you have been - tap it to enlarge. The icons under it open every window.' : 'The map remembers where you have been - M enlarges it. The icons under it open every window.'),
    target: () => ({ selector: '#hud-tr', pad: 8 }),
    demo: (c) => (c.touch ? '' : keys('M')),
  },
  {
    id: 'interact',
    title: 'Talking and looting',
    text: (c) => (c.touch ? 'The hand button talks to people, opens doors and chests, and picks up loot - or just tap the thing. Walk over to me and try it.' : 'E talks to people, opens doors and chests, and picks up loot - or just click the thing. Walk over to me and press E.'),
    target: (c) => ({ selector: c.touch ? '#touch-controls .tc-interact' : undefined, world: c.touch ? undefined : milkAt(c) }),
    mark: (c) => milkAt(c),
    demo: (c) => (c.touch ? tap('✋') : `${keys('E')}${or}${mouse()}`),
    lesson: 'interact', // She raises a hand and waits for it (it.117).
    shot: (c) => ({ at: [c.hooks.hero(), milkAt(c)], zoom: YARD_ZOOM }),
    done: (c) => c.interacts >= 1,
    progress: (c) => `used ${Math.min(1, c.interacts)} / 1`,
  },
  {
    id: 'portal',
    title: 'Town portal',
    text: (c) => (c.touch ? 'The portal button brings you back to town from anywhere, free, every twelve seconds.' : 'T, or the portal button, brings you back to town from anywhere - free, every twelve seconds.'),
    target: (c) => ({ selector: c.touch ? '#touch-controls .tc-portal' : '#tp-button' }),
    demo: (c) => (c.touch ? '' : keys('T')),
  },
  {
    id: 'controls',
    title: 'All controls',
    text: () => 'Everything in one place, in case you forget.',
    demo: (c) => controlsGrid(c.touch),
  },
  {
    id: 'gate',
    title: 'The crypt gate',
    text: () => 'At the top of the old quarter. Twenty levels deep, a boss on every fifth. That is everything - go.',
    target: (c) => ({ world: c.hooks.gate(), pad: 30 }),
    mark: (c) => c.hooks.gate(),
    shot: (c) => ({ at: [c.hooks.gate()], zoom: GATE_ZOOM, bars: true }),
  },
];

function milkAt(c: StepCtx): { x: number; y: number } {
  return c.hooks.milk?.() ?? TutorialSystem.yardPost;
}

/** The dummy closest to a point (Lord Milk's lessons use the one beside her, it.116). */
function dummyNear(c: StepCtx, p: { x: number; y: number }): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const d of c.hooks.dummies()) {
    const dist = Math.hypot(d.x - p.x, d.y - p.y);
    if (dist < bd) {
      bd = dist;
      best = { x: d.x, y: d.y };
    }
  }
  return best;
}

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

const CHAPTER_MS = 1500;

export class TutorialSystem {
  /** Lord Milk's post (it.115), the sign without her: the fallback when `hooks.milk` is absent (set by main from the layout). */
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
  /**
   * LORD MILK'S TURN (it.116). While `watchUntil` has not passed she is
   * showing the step's lesson and the camera is on her and the dummy, bars
   * down; `lessonAgain` is when she shows it again if the player has not
   * done it yet (no bars the second time).
   */
  private watchUntil = 0;
  private watchBars = false;
  private lessonAgain = 0;
  private barsOn = false;
  /** True while the showing in progress is the SLOW one (it.117): the chip says so. */
  private watchSlow = false;
  /** What the layer is wearing, so the class list is only touched on a change. */
  private watchOn = false;

  constructor(private readonly hooks: TutorialHooks) {
    this.ctx = { touch: hooks.touch(), moved: 0, hits: 0, bestHit: 0, lastHit: 0, casts: 0, quaffs: 0, interacts: 0, hooks };
    this.layer = document.createElement('div');
    this.layer.id = 'tut-layer';
    this.layer.innerHTML = `
      <div id="tut-spot"></div>
      <div id="tut-arrow"><svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 4 L36 24 L26 24 L26 36 L14 36 L14 24 L4 24 Z" fill="#ffd070" stroke="#3a2a10" stroke-width="2" stroke-linejoin="round"/></svg></div>
      <div id="tut-card">
        <div class="tut-head"><span class="tut-step"></span><span class="tut-title"></span><button class="tut-x" type="button" data-tut="end" title="End the tutorial"><i></i></button></div>
        <div class="tut-mentor" hidden><span class="tut-face"></span><span class="tut-who"><b></b><i></i></span></div>
        <div class="tut-text"></div>
        <div class="tut-demo"></div>
        <div class="tut-foot"><span class="tut-progress"></span><span class="tut-buttons"><button class="menu-btn tut-btn" type="button" data-tut="back">Back</button><button class="menu-btn tut-btn tut-next" type="button" data-tut="next">Next</button></span></div>
      </div>
      <div id="tut-chapter"><b></b></div>
      <div id="tut-watch"><b></b><i>press ENTER to skip</i></div>
      <div class="tut-bar tut-bar-top"></div><div class="tut-bar tut-bar-bottom"></div>`;
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
          // EVERY DEMONSTRATION IS SKIPPABLE (it.117). While Lord Milk is showing
          // something the key cuts HER short and hands the yard straight back -
          // one more press moves the card on. A demo you have seen twice should
          // never stand between you and the next thing.
          if (performance.now() < this.watchUntil) {
            this.watchUntil = 0;
            this.lessonAgain = 0;
            return;
          }
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
    // The camera, the bars and the ring go back to the player (it.116).
    this.hooks.frame?.(null, null);
    this.setBars(false);
    this.hooks.mark?.(null);
    this.index = -1;
    this.watchUntil = 0;
    this.lessonAgain = 0;
    this.watchOn = false;
    this.layer.classList.remove('show', 'tut-watching', 'tut-slow');
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
    this.direct(step);
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
    this.showMentor(q);
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
    nextBtn.textContent = i === this.steps.length - 1 ? 'Finish' : step.done ? 'Skip' : 'Next';
    this.card.classList.remove('tut-done', 'tut-in');
    void this.card.offsetWidth; // Restart the entrance animation.
    this.card.classList.add('tut-in');
    this.heroTimer = 0;
    this.watchUntil = 0;
    this.lessonAgain = 0;
    this.watchSlow = false;
    if (step.lesson) this.showLesson(step, true);
    this.direct(step);
    this.place(step, true);
  }

  /**
   * Lord Milk performs the step's lesson (it.116, in slow motion it.117).
   *
   * A lesson about a body - a step across the yard, a hand raised in greeting -
   * is shown AT the hero; everything done to a target is shown on her own
   * dummy, never the player's, so their count of their own hits stays honest.
   * The first showing runs at the step's `slow` rate and wears the WATCH chip;
   * the reminder eight seconds later runs at full speed, and quietly.
   */
  private showLesson(step: TutorialStep, first: boolean): void {
    if (!step.lesson || !this.hooks.lesson) return;
    const atHero = step.lesson === 'move' || step.lesson === 'interact';
    const on = atHero ? this.hooks.hero() : this.hooks.milkDummy?.() ?? dummyNear(this.ctx, milkAt(this.ctx)) ?? this.hooks.hero();
    const rate = first ? Math.max(0.2, Math.min(1, step.slow ?? 1)) : 1;
    const secs = this.hooks.lesson(step.lesson, on, rate);
    if (secs <= 0) return;
    const now = performance.now();
    this.watchUntil = now + secs * 1000 + (first ? 1400 : 300); // A beat after it lands, to see what happened.
    this.watchBars = first;
    this.watchSlow = first && rate < 1;
    this.lessonAgain = this.watchUntil + 8000;
    const chip = this.layer.querySelector<HTMLElement>('#tut-watch b');
    if (chip) chip.textContent = this.watchSlow ? 'WATCH · SLOW' : 'WATCH';
  }

  /**
   * THE DIRECTOR (it.116), every frame: the step's shot (or, while she shows
   * the lesson, a close two-shot of her and the dummy), the bars, the ring.
   * Panel steps give the camera back.
   */
  private direct(step: TutorialStep): void {
    const now = performance.now();
    const met = step.done?.(this.ctx) ?? false;
    if (step.lesson && !met && this.lessonAgain > 0 && now > this.lessonAgain) this.showLesson(step, false);
    let shot: Shot | null = step.shot?.(this.ctx) ?? null;
    const watching = now < this.watchUntil;
    if (watching) {
      const milk = this.hooks.milk?.();
      // What the two-shot holds: her, and whatever she is doing it to. A draught
      // is done to herself; a step and a greeting are done AT the hero (it.117).
      const other =
        step.lesson === 'quaff' ? null
        : step.lesson === 'move' || step.lesson === 'interact' ? this.hooks.hero()
        : this.hooks.milkDummy?.() ?? dummyNear(this.ctx, milk ?? milkAt(this.ctx));
      const at = [milk, other].filter((p): p is { x: number; y: number } => !!p);
      if (at.length) shot = { at, zoom: WATCH_ZOOM, bars: this.watchBars };
    }
    // THE WATCH TREATMENT (it.117): a chip that names what is happening and a
    // whisper of a vignette at the very edges. Nothing is dimmed - the owner
    // must be able to see the yard at every moment of the lesson.
    if (watching !== this.watchOn) {
      this.watchOn = watching;
      this.layer.classList.toggle('tut-watching', watching);
    }
    this.layer.classList.toggle('tut-slow', watching && this.watchSlow);
    if (shot && shot.at.length) {
      let x = 0;
      let y = 0;
      for (const p of shot.at) {
        x += p.x;
        y += p.y;
      }
      this.hooks.frame?.({ x: x / shot.at.length, y: y / shot.at.length }, shot.zoom);
    } else this.hooks.frame?.(null, null);
    this.setBars(!!shot?.bars);
    this.hooks.mark?.(step.mark?.(this.ctx) ?? null);
  }

  private setBars(on: boolean): void {
    if (on === this.barsOn) return;
    this.barsOn = on;
    this.layer.classList.toggle('tut-bars', on);
    this.hooks.bars?.(on);
  }

  /** LORD MILK at the head of the card (it.115): her face once, her name and title. */
  private showMentor(q: <T extends HTMLElement>(sel: string) => T): void {
    const m = this.hooks.mentor?.();
    const row = q('.tut-mentor');
    row.hidden = !m;
    if (!m) return;
    q('.tut-who b').textContent = m.name;
    q('.tut-who i').textContent = m.role;
    const face = q('.tut-face');
    if (m.portrait && !face.firstElementChild) {
      const c = document.createElement('canvas');
      c.width = m.portrait.width;
      c.height = m.portrait.height;
      c.getContext('2d')?.drawImage(m.portrait, 0, 0);
      face.appendChild(c);
    }
  }

  /** Frame the target, aim the arrow, seat the card beside it. */
  private place(step: TutorialStep, jump = false): void {
    const t = step.target?.(this.ctx) ?? null;
    const { w: vw, h: vh } = this.hooks.viewport();
    let rect: { left: number; top: number; width: number; height: number } | null = null;
    this.spot.classList.remove('world');
    if (t?.selector) {
      const el = document.querySelector<HTMLElement>(t.selector);
      if (el && el.getClientRects().length) {
        const r = el.getBoundingClientRect();
        const pad = t.pad ?? 8;
        rect = { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
      }
    } else if (t?.world) {
      this.spot.classList.add('world'); // A round light on a place, a box round a panel (it.116).
      const p = this.hooks.worldToPage(t.world.x, t.world.y);
      const pad = t.pad ?? 26;
      // Off the screen (the crypt gate seen from the yard): the mark sits at the
      // viewport's edge on the way there and the arrow points the direction.
      const m = pad + 8;
      const px = Math.max(m, Math.min(vw - m, p.x));
      const py = Math.max(m + pad, Math.min(vh - m, p.y));
      const side = pad * 2.6; // A square round the body (it.116), feet at its lower edge.
      rect = { left: px - side / 2, top: py - side * 0.8, width: side, height: side };
    }
    this.spot.classList.toggle('jump', jump);
    // WHILE SHE SHOWS IT (it.116) nothing is pointed at: the scene is the lesson.
    const watching = performance.now() < this.watchUntil;
    if (watching) rect = null;
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
    const cw = Math.min(step.id === 'controls' ? 460 : 380, vw - 24);
    // A SHORT SCREEN (it.115): Lord Milk's face line made the card taller than a
    // phone held sideways. Under 460 px it is drawn compact, and never taller
    // than the viewport - whatever is left over scrolls inside the card.
    this.card.classList.toggle('tut-short', vh < 460);
    this.card.style.maxHeight = `${Math.max(120, vh - 24)}px`;
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
    // A SHOT WITH NOTHING TO POINT AT (it.116): the card steps to the lower
    // left, clear of the bars, so the scene it describes stays in view.
    if (!rect && step.shot) {
      cx = 12;
      cy = vh - ch - Math.max(14, vh * 0.1);
    }
    // ...and during her lesson the card waits at the right edge, off the two-shot.
    if (watching) {
      cx = vw - cw - 12;
      cy = Math.max(12, vh * 0.1 + 6);
    }
    // Whatever the target did, the card stays inside the viewport.
    cx = Math.max(12, Math.min(vw - cw - 12, cx));
    cy = Math.max(12, Math.min(vh - ch - 12, cy));
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
