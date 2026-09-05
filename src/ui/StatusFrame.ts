/**
 * @module ui/StatusFrame
 * THE PLAYER STATUS FRAME (it.66): the top-left corner of the HUD.
 *
 * One obsidian-glass plate carrying everything a player checks mid-fight —
 * an animated portrait, the level badge, the health and resource gauges, the
 * experience sliver and the purse, with the active buffs docked beneath it.
 *
 * WHY THE GLOBES RETIRED. Two 150 px globes at the foot of the screen were
 * the single largest thing standing in the combat corridor, and on a phone
 * they ate a third of the play area for two numbers. A corner plate reads
 * faster (the bars share one baseline, so a glance compares them), never
 * crosses the fight, and leaves the thumbs the whole lower band.
 *
 * THE GAUGES LERP. A bar that snaps tells you a number changed; a bar that
 * eases tells you HOW MUCH it changed, because the eye reads the length of
 * the travel. Behind each fill sits a slower GHOST in a dimmed shade of the
 * same colour, so a hit leaves a bright wound that drains away over a beat —
 * the ARPG convention, and the cheapest possible damage readout.
 *
 * The lerp runs on its own rAF because it is a purely visual quantity: it
 * must never enter the fixed-step simulation, and it must be free to skip
 * frames without the sim noticing. On a hidden page rAF is paused, so
 * `update()` settles instead of easing and QA measures the true values.
 */

import type { Player } from '@/entities/Player';

/** How much of the remaining gap a gauge closes per frame. */
const FILL_LERP = 0.22;
/** The ghost trails well behind, which is what makes a hit legible. */
const GHOST_LERP = 0.055;
/** Below this the two are the same to the eye; stop animating and settle. */
const EPSILON = 0.0006;

interface Gauge {
  fill: HTMLElement;
  ghost: HTMLElement;
  text: HTMLElement;
  shown: number;
  ghosted: number;
}

export class StatusFrame {
  private readonly root: HTMLElement;
  private readonly portrait: HTMLCanvasElement;
  private readonly lvl: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly xpText: HTMLElement;
  private readonly gold: HTMLElement;
  private readonly hp: Gauge;
  private readonly res: Gauge;
  private raf = 0;
  private frameIndex = 0;
  private portraitTimer = 0;

  constructor(
    private readonly player: Player,
    /** The class's idle frames, drawn as a living portrait. */
    private readonly getFrames: () => HTMLCanvasElement[],
  ) {
    this.root = document.createElement('div');
    this.root.id = 'status-frame';
    this.root.className = 'ds-panel hud-el';
    this.root.innerHTML =
      '<div class="sf-port"><canvas width="64" height="64"></canvas><b class="sf-lvl">1</b></div>' +
      '<div class="sf-gauges">' +
      '<div class="ds-bar sf-hp"><i class="ds-ghost"></i><i class="ds-fill"></i><i class="ds-gloss"></i><span class="ds-bar-text">0</span></div>' +
      '<div class="ds-bar sf-res"><i class="ds-ghost"></i><i class="ds-fill"></i><i class="ds-gloss"></i><span class="ds-bar-text">0</span></div>' +
      '<div class="ds-bar sf-xp"><i class="ds-fill"></i><i class="ds-gloss"></i><span class="ds-bar-text">XP</span></div>' +
      '</div>' +
      '<div class="sf-purse"><span class="sf-coin">&#9670;</span><b>0</b></div>';
    StatusFrame.stack().appendChild(this.root);

    this.portrait = this.root.querySelector('canvas') as HTMLCanvasElement;
    this.lvl = this.root.querySelector('.sf-lvl') as HTMLElement;
    this.gold = this.root.querySelector('.sf-purse b') as HTMLElement;
    const gauge = (sel: string): Gauge => {
      const el = this.root.querySelector(sel) as HTMLElement;
      return {
        fill: el.querySelector('.ds-fill') as HTMLElement,
        ghost: (el.querySelector('.ds-ghost') ?? el.querySelector('.ds-fill')) as HTMLElement,
        text: el.querySelector('.ds-bar-text') as HTMLElement,
        shown: 1,
        ghosted: 1,
      };
    };
    this.hp = gauge('.sf-hp');
    this.res = gauge('.sf-res');
    const xp = this.root.querySelector('.sf-xp') as HTMLElement;
    this.xpFill = xp.querySelector('.ds-fill') as HTMLElement;
    this.xpText = xp.querySelector('.ds-bar-text') as HTMLElement;

    // The resource keeps its own colour: arcane blue for mana, emerald for
    // stamina. A class carries exactly one of the two, so the second gauge
    // is that class's, named and tinted for it.
    this.root.classList.add(player.resourceName === 'MANA' ? 'res-mana' : 'res-stamina');
    this.root.dataset.res = player.resourceName;

    this.tick = this.tick.bind(this);
    this.update();
    this.settle();
    this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * THE TOP-LEFT STACK. The plate, the buffs, the depth plaque and the run
   * timer are four separate elements that all want the same corner. Fixed
   * positions would make each one guess the others' height — and the guess
   * is wrong the moment the HUD scale changes. A flex column measures
   * instead, so the corner cannot overlap itself at any size.
   */
  private static stack(): HTMLElement {
    let el = document.getElementById('hud-tl');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hud-tl';
      document.body.appendChild(el);
    }
    return el;
  }

  /** Adopt the corner's other tenants once they exist (they are built later). */
  private adopt(): void {
    const stack = StatusFrame.stack();
    // The co-op party roster (it.59) joins the column too: it used to be
    // pinned at 96 px from the top, straight through the plate.
    for (const id of ['hud-buffs', 'party-hud', 'char-stats', 'depth-label', 'timer']) {
      const el = document.getElementById(id);
      if (el && el.parentElement !== stack) stack.appendChild(el);
    }
  }

  /** Pull the real values in. Safe to call as often as the game likes. */
  update(): void {
    this.adopt();
    const p = this.player;
    this.lvl.textContent = `${p.level}`;
    this.gold.textContent = `${p.gold}`;
    const hpMax = Math.max(1, p.hpMax);
    const resMax = Math.max(1, p.resourceMax);
    this.hp.text.textContent = `${Math.max(0, Math.round(p.hp))} / ${Math.round(hpMax)}`;
    this.res.text.textContent = `${Math.max(0, Math.round(p.resource))} / ${Math.round(resMax)}`;
    const next = Math.max(1, p.xpToNext());
    this.xpFill.style.width = `${Math.min(100, Math.max(0, (p.xp / next) * 100)).toFixed(2)}%`;
    this.xpText.textContent = `${p.xp} / ${next}`;
    this.root.classList.toggle('hurt', p.hp / hpMax < 0.3 && p.hp > 0);
    // A hidden page never runs rAF, so nothing would ever ease. Settle now.
    if (document.hidden) this.settle();
  }

  /** Snap both gauges to the truth — used when no frames are coming. */
  private settle(): void {
    const p = this.player;
    this.hp.shown = this.hp.ghosted = Math.min(1, Math.max(0, p.hp / Math.max(1, p.hpMax)));
    this.res.shown = this.res.ghosted = Math.min(1, Math.max(0, p.resource / Math.max(1, p.resourceMax)));
    this.paint();
  }

  private paint(): void {
    for (const g of [this.hp, this.res]) {
      g.fill.style.width = `${(g.shown * 100).toFixed(2)}%`;
      g.ghost.style.width = `${(g.ghosted * 100).toFixed(2)}%`;
    }
  }

  private tick(): void {
    this.raf = requestAnimationFrame(this.tick);
    const p = this.player;
    const targets: Array<[Gauge, number]> = [
      [this.hp, Math.min(1, Math.max(0, p.hp / Math.max(1, p.hpMax)))],
      [this.res, Math.min(1, Math.max(0, p.resource / Math.max(1, p.resourceMax)))],
    ];
    let moved = false;
    for (const [g, target] of targets) {
      if (Math.abs(target - g.shown) > EPSILON) {
        g.shown += (target - g.shown) * FILL_LERP;
        moved = true;
      } else g.shown = target;
      // The ghost only ever trails a LOSS. A gain should read instantly, so
      // it jumps up with the fill and eases only on the way down.
      if (g.ghosted < g.shown) g.ghosted = g.shown;
      else if (g.ghosted - g.shown > EPSILON) {
        g.ghosted += (g.shown - g.ghosted) * GHOST_LERP;
        moved = true;
      } else g.ghosted = g.shown;
    }
    if (moved) this.paint();
    this.drawPortrait();
  }

  /** The portrait breathes: the class's idle cycle at roughly 8 fps. */
  private drawPortrait(): void {
    const frames = this.getFrames();
    if (!frames.length) return;
    if (++this.portraitTimer % 7 !== 0) return;
    this.frameIndex = (this.frameIndex + 1) % frames.length;
    const src = frames[this.frameIndex];
    const ctx = this.portrait.getContext('2d');
    if (!ctx || !src.width) return;
    const w = this.portrait.width;
    const h = this.portrait.height;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    // Frame the HEAD AND SHOULDERS: the sprite is a full body, so the crop
    // takes the top 62% and centres it, which is where the face sits in
    // every one of the class rigs.
    const cropH = src.height * 0.62;
    const scale = Math.min(w / src.width, h / cropH) * 1.35;
    const dw = src.width * scale;
    const dh = cropH * scale;
    ctx.drawImage(src, 0, 0, src.width, cropH, (w - dw) / 2, (h - dh) / 2 - h * 0.06, dw, dh);
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.root.remove();
  }
}
