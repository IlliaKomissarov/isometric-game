/**
 * @module ui/LoadingScreen
 * THE DARK-FANTASY LOADING SCREEN (it.62).
 *
 * One overlay for every zone change — town to dungeon, floor to floor,
 * dungeon to arena, the coliseum, a portal home, a co-op warp. Dark slate
 * under gold filigree borders, the carved rune seal turning at its heart, a
 * bronze progress bar that fills as the floor's atlases stream in and its
 * world is built, and a lore tip drawn from the crypt's own bestiary.
 *
 * The bar is honest: `step()` reports real progress (atlas fetch, world
 * build, first tick). Between reports it creeps toward the next milestone
 * so the bar never sits frozen, and it always finishes at 100% before the
 * screen lifts. Pure DOM — it must render while the sim is mid-teardown.
 */

import { audio } from '@/engine/AudioManager';

/** Every stage a floor change passes through, with the bar's target after it. */
export type LoadStage = 'open' | 'atlases' | 'world' | 'ready';

const TARGET: Record<LoadStage, number> = { open: 0.08, atlases: 0.55, world: 0.9, ready: 1 };

const TIPS: readonly string[] = [
  'The dead keep formation. Break the line before it closes on you.',
  'A warden holds every fifth depth. Nothing leaves its hall while anything inside still breathes.',
  'Champions carry an aura and always pay: frost slows the swing, thorns bite back, the vampiric drink what they take.',
  'The town clock stands still. Only floors you walk and waves you fight are counted.',
  'A teleporter rises at the heart of a cleared arena. It is the only way out.',
  'Blows are telegraphed. Step away as they rear back and the strike falls on empty stone.',
  'The stash belongs to the slot, not the delver. What you leave there outlives you.',
  'Scrolls are not the only way home: the rite on the hotbar is free, on a twelve-second breath.',
  'Elites drop what ordinary bones never will. Hunt the ones wearing light.',
  'Fire clings, frost holds, poison keeps working after the blade is gone.',
  'Your own path casts stronger and recovers faster. Another path costs double a rank.',
  'The Hollow King wears three shapes. Only the last one stays down.',
  'A chest opened is a chest remembered. The floor keeps its own accounts.',
  'Torchlight does not reach the corners. What you have not seen is not empty.',
  'In a party, the leader opens the way. The rest arrive on the same step.',
];

export class LoadingScreen {
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly title: HTMLElement;
  private shown = 0;
  private target = 0;
  private raf = 0;
  private visible = false;
  private lastT = 0;
  private tipIndex = Math.floor(Math.random() * TIPS.length);

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'loading-screen';
    this.root.innerHTML = `
      <div class="ls-frame">
        <div class="ls-fil ls-fil-top"></div>
        <div class="ls-fil ls-fil-bottom"></div>
        <div class="ls-corner tl"></div><div class="ls-corner tr"></div><div class="ls-corner bl"></div><div class="ls-corner br"></div>
        <div class="ls-seal"><i></i><b></b></div>
        <h2 class="ls-title">DESCENDING</h2>
        <div class="ls-track"><div class="ls-bar"></div></div>
        <p class="ls-tip"></p>
      </div>`;
    document.body.appendChild(this.root);
    this.bar = this.root.querySelector('.ls-bar')!;
    this.tip = this.root.querySelector('.ls-tip')!;
    this.title = this.root.querySelector('.ls-title')!;
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /** Raise the screen for a transition. `label` names where the party is going. */
  open(label: string): void {
    this.title.textContent = label.toUpperCase();
    this.tipIndex = (this.tipIndex + 1 + Math.floor(Math.random() * (TIPS.length - 1))) % TIPS.length;
    this.tip.textContent = TIPS[this.tipIndex];
    this.shown = 0;
    this.target = TARGET.open;
    this.paint();
    if (!this.visible) {
      this.visible = true;
      this.root.classList.add('open');
      audio.sfx('stairs');
      this.lastT = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
  }

  /** A stage completed: the bar walks to that milestone. */
  step(stage: LoadStage): void {
    this.target = Math.max(this.target, TARGET[stage]);
  }

  /** Fill to the end and lift. Resolves once the overlay is out of the way. */
  async close(): Promise<void> {
    if (!this.visible) return;
    this.target = 1;
    // Let the bar reach the end before the screen lifts (never a stuck bar).
    const deadline = performance.now() + 400;
    while (this.shown < 0.995 && performance.now() < deadline) await new Promise((r) => setTimeout(r, 16));
    this.shown = 1;
    this.paint();
    this.root.classList.add('lifting');
    await new Promise((r) => setTimeout(r, 220));
    this.visible = false;
    cancelAnimationFrame(this.raf);
    this.root.classList.remove('open', 'lifting');
  }

  /** Tear it down with the run (nothing survives a teardown). */
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }

  private frame(now: number): void {
    if (!this.visible) return;
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    // Ease toward the milestone, then creep the last sliver so the bar is
    // never frozen while a slow fetch runs.
    const gap = this.target - this.shown;
    this.shown += gap * Math.min(1, dt * 6);
    if (gap < 0.02 && this.target < 1) this.shown = Math.min(this.target, this.shown + dt * 0.01);
    this.paint();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private paint(): void {
    this.bar.style.width = `${(Math.max(0, Math.min(1, this.shown)) * 100).toFixed(1)}%`;
  }
}
