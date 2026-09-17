/**
 * @module ui/Bestiary
 * The bestiary window (it.42, hotkey B): every creature the hero has laid
 * eyes on, with its living sprite (the atlas strip animated straight from
 * the PNG — no atlas residency needed), a lore snippet, base stats, and
 * the depth scaling the sim applies (hp ×(1 + 0.3·(level−1)), +1 damage
 * and +½ armor per level). Unseen kinds show as silhouettes with "???".
 *
 * Encounters are hero state (`Player.bestiary`, persisted in the save):
 * `seen` counts first sightings, `killed` counts kills.
 */

import { eventBus } from '@/core/EventBus';
import { audio } from '@/engine/AudioManager';
import { ENEMY_TYPES, levelHpScale, type EnemyKind } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import { animatePreviews, previewHtml } from '@/ui/sheetPreview';

const LORE: Partial<Record<EnemyKind, string>> = {
  fallen: 'Runts of the crypt: what is left of the tomb-diggers who broke the first seal. They swarm, and they run when the swarm thins.',
  zombie: 'Slow, patient, and hungry. The dead of the lower town, walked back up the stair by whatever now sits the Hollow throne.',
  skeleton: 'A blade that remembers the arm. The risen guard still drill in the dark, and still keep formation when they close.',
  archer: 'Marksmen of the old garrison. They keep their distance and loose on sight; close the gap or duck behind stone.',
  ahoul: 'A ghast that feeds on fear before flesh. Faster than it looks, and it looks fast.',
  shaman: 'Blood-priests who bought their afterlife with other people\'s. Their bolts sap; their chanting rallies the dead.',
  graveGuard: 'Armoured wardens buried with their charge. Heavy blows, heavy tread — every swing is telegraphed, every swing lands hard.',
  skelMage: 'Marrow Warlocks: the crypt\'s librarians. They stand back, hurl fire, and hate being touched.',
  boss: 'The Tomb Warden. First of the keepers, bound to the fifth depth by an oath older than the kingdom. It does not tire.',
  guard: 'Crypt Sentinels never left their post. Their halberds reach farther than any blade you carry.',
  wolf: 'Moon-cursed ravagers loosed in the deep kennels. They circle, they lunge, and they bleed you for the pack.',
  lizard: 'Ashscale duelists from the ember warrens. Quick feet, quicker steel; they parry what they see coming.',
  bossFrost: 'The Frost Warden holds the tenth depth in a killing cold. Its blows slow the blood; its breath stops it.',
  bossEmber: 'Vyrissa, the Ember Maw. The fire that hollowed the mountain wears a woman\'s shape here, and not for long.',
  shambler: 'Risen villagers, taken whole from the streets above. They are slow, and there are always more.',
  hydra: 'A crimson hydra bred in the deepest cistern. Cut a head and two attend the funeral.',
  bossHollow: 'The Hollow King, as he was crowned: a man, once. Beneath the crown there is only the wanting.',
  bossHollowKnight: 'The Hollow King rises again in the plate he was buried in. The oath that holds the wardens holds him too.',
  bossHollowLich: 'What remains when even the armour is spent: the hunger itself, robed in the dark. The last seal.',
  orc: 'Orc slingers slipped in through the drowned levels. Small, quick, and never alone; they throw first and rush the stunned.',
  poacher: 'Crypt poachers came for the burial gold and stayed for the dark. Good with a bow, better at running.',
  spider: 'The Crypt Widow nests in the burial niches and hunts by touch. Quick, quiet, and never alone for long.',
  bandit: 'Looters who came over the east wall the night the quarter burned. Bows, knives, and no cause but the taking.',
  brigand: 'The looters\' hard men: deserters in stolen mail, a polearm each. They hold the streets the fire left.',
  // THE NEW FLESH (it.114).
  redWidow: 'A widow gone red on whatever it has been eating. It is faster than the crypt kind, and it does not wait for you to notice.',
  boneWidow: 'The old ones: pale, slow, and armoured in their own dead skins. They sit under the cellars and let the cellars come to them.',
  venomWidow: 'Green in the joints and wet at the mouth. The bite is small; the legs stop answering a breath later.',
  orcBrute: 'An orc grown past the point of thinking. The club comes up slow and down once, and nothing you carry will make it flinch.',
  frostWolf: 'A ravager that went too deep and came back rimed. The axe it carries is cold enough to burn; the cut stays with you.',
  treant: 'A tree that was in the blighted ground too long and learned to walk. It is slower than anything alive and harder than most stone.',
  drake: 'A red drake out of the ember warrens, wings too short to fly and a throat that does not need them. It keeps its distance and breathes.',
  wyrm: 'A feathered serpent from the old mine shrines, quick and thin-skinned. It comes at you in a rush and dies just as fast.',
  markedGhoul: 'A ghoul with blue marks cut into it by someone who wanted it kept. It fights until it is hurt, then goes to tell them.',
  orcSpearman: 'Orc pikemen who hold the mine galleries in ranks. The spear lands a full step before you think you are in reach.',
  orcWarrior: 'The orc women fight in the front, not behind it. A blade each, mail they took off somebody, and no interest in retreat.',
  giantMoth: 'A moth the size of a dog, drawn to the torches and to the blood. Weak, quick, and never where it was a moment ago.',
  corpse: 'The newer dead, still in the clothes they were buried in. Slow and sturdy; it takes a while for a body this fresh to understand it is dead.',
  halberdier: 'The company\'s polearm men. They hold the line the blades stand behind, and the halberd reaches farther than anything you carry.',
  reaper: 'A caped killer who works the deep tombs for whoever is paying. Fast, precise, and gone before the body has finished falling.',
  duelist: 'The company\'s fencer. She parries what she sees coming, and she sees most of it.',
  apexPredator: 'Something bred, not born: a crystalline hunter loosed in the deepest halls. It is quick for its size and its size is the problem.',
  apexStalker: 'The predator\'s leaner kin. Faster, lighter, and it watches you for a while before it decides.',
  krampus: 'The Horned One of the deep woods. The charcoal-burners left it goats; the goats ran out.',
  gargoyle: 'A temple guardian cut from stone and given something to guard. It stands until it does not, and then it is very close.',
  tealSpider: 'A forest spider gone green in the canopy. Quick, quiet, and it drops from above where the crypt kind climbs from below.',
  fleshGolem: 'Flayed and stitched from several people who did not agree to it. Slow, enormous, and it does not stagger.',
  creeper: 'A hooded thing with claws that hunts the middle depths. It comes low and fast and it does not make a sound until it is on you.',
};

/** MEN, NOT MONSTERS (it.114): the looters, the company and its officers, the mines' orcs, the hired killer. */
export const MAN_KINDS: ReadonlySet<EnemyKind> = new Set<EnemyKind>([
  'poacher', 'bandit', 'brigand', 'mercenary', 'general', 'chief',
  'halberdier', 'duelist', 'orcSpearman', 'orcWarrior', 'reaper',
]);

const CATEGORY = (kind: EnemyKind): string => (kind.startsWith('boss') ? 'WARDEN' : MAN_KINDS.has(kind) ? 'MAN' : 'CREATURE');

export class BestiaryUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private selected: EnemyKind | null = null;
  private timer: number | null = null;
  private readonly offs: Array<() => void> = [];
  private readonly abort = new AbortController();

  constructor(
    private readonly player: Player,
    /** THE MENAGERIE (it.114): "try this body on" from a creature's page. */
    private readonly hooks: { tryOut?: (kind: EnemyKind) => void } = {},
  ) {
    this.panel = document.createElement('div');
    this.panel.id = 'bestiary';
    document.body.appendChild(this.panel);
    this.offs.push(eventBus.on('bestiary:changed', () => this.visible && this.render()));
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'KeyB' && !e.repeat) {
          e.preventDefault();
          this.toggle();
        } else if ((e.code === 'ArrowDown' || e.code === 'ArrowUp') && this.visible) {
          // ARROW KEYS (it.49): step through the known entries.
          e.preventDefault();
          e.stopImmediatePropagation();
          this.step(e.code === 'ArrowDown' ? 1 : -1);
        } else if (e.code === 'Escape' && this.visible) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.close();
        }
      },
      { signal: this.abort.signal, capture: true },
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /** Move the selection through the KNOWN entries (wrapping). */
  private step(dir: number): void {
    const p = this.player;
    const kinds = (Object.keys(ENEMY_TYPES) as EnemyKind[]).filter((k) => !ENEMY_TYPES[k].passive && (p.bestiaryRevealed || p.bestiary.has(k))); // No dummies in the book (it.90).
    if (!kinds.length) return;
    const i = this.selected ? kinds.indexOf(this.selected) : -1;
    this.selected = kinds[(i + dir + kinds.length) % kinds.length];
    audio.sfx('uiHover');
    this.render();
    this.panel.querySelector<HTMLElement>('.bs-row.lit')?.scrollIntoView({ block: 'nearest' });
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  open(): void {
    if (this.visible) return;
    this.visible = true;
    this.panel.classList.add('open');
    audio.sfx('invOpen');
    this.render();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove('open');
    this.stopAnim();
    audio.sfx('invClose');
  }

  private stopAnim(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * THE LIVING PORTRAIT (it.115): the kind's idle, facing the camera, feet on
   * the stage's ground line, at its size relative to the other kinds (x1.7 of
   * the world size, so a brute stands over a ghast here as on the sand).
   */
  private preview(kind: EnemyKind, look: string): string {
    const sp = ENEMY_TYPES[kind].sprite;
    if (!sp) return '';
    const base = kind.startsWith('boss') ? 128 : 56;
    return previewHtml({ anim: sp.idle ?? sp.walk, idle: sp.idle, walk: sp.walk, attack: sp.attack, height: base * (sp.heightMult ?? 1) * 1.7 }, 300, 190, 14, look);
  }

  private render(): void {
    this.stopAnim();
    // The list keeps its scroll across a re-render (it.49): picking an entry no longer snaps to the top.
    const keepScroll = this.panel.querySelector<HTMLElement>('.bs-list')?.scrollTop ?? 0;
    const p = this.player;
    const kinds = (Object.keys(ENEMY_TYPES) as EnemyKind[]).filter((k) => !ENEMY_TYPES[k].passive);
    const revealed = p.bestiaryRevealed;
    const isKnown = (k: EnemyKind): boolean => revealed || p.bestiary.has(k);
    const seenKinds = kinds.filter(isKnown);
    if (!this.selected) this.selected = seenKinds[0] ?? kinds[0];
    const list = kinds
      .map((k) => {
        const rec = p.bestiary.get(k);
        const def = ENEMY_TYPES[k];
        const known = isKnown(k);
        return `<button class="bs-row${known ? '' : ' unknown'}${this.selected === k ? ' lit' : ''}" data-kind="${k}">
          <span class="bs-row-name">${known ? def.name : '???'}</span>
          <span class="bs-row-meta">${known ? `${CATEGORY(k)} · ${rec?.killed ?? 0} slain${revealed && !rec ? ' · revealed' : ''}` : 'unseen · a shadow in the dark'}</span>
        </button>`;
      })
      .join('');
    const sel = this.selected;
    let detail = '<div class="bs-empty">Nothing has crossed your path yet. The dark keeps its census.</div>';
    if (sel) {
      const def = ENEMY_TYPES[sel];
      const known = isKnown(sel);
      const rec = p.bestiary.get(sel) ?? { seen: 0, killed: 0 };
      const pv = this.preview(sel, '');
      // UNKNOWN (it.43): a solid black silhouette — the fog-of-war shadow of a thing not yet met.
      const look = known ? 'filter:drop-shadow(0 6px 6px rgba(0,0,0,.8)) sepia(0.15);' : 'filter:brightness(0) drop-shadow(0 0 6px rgba(0,0,0,.9));opacity:0.9;';
      const preview = pv
        ? `<div class="bs-stage${known ? '' : ' unknown'}"><div style="position:relative;width:300px;height:190px;flex:none">${this.preview(sel, look)}</div></div>`
        : `<div class="bs-stage"><div class="bs-nosprite">${known ? def.name : '???'}</div></div>`;
      const stat = (k: string, v: string, note = ''): string => `<div class="bs-stat"><span>${k}</span><b>${known ? v : '???'}</b>${known && note ? `<i>${note}</i>` : ''}</div>`;
      const level = Math.max(1, p.level);
      const scaled = Math.round(def.hp * levelHpScale(level));
      detail = `
        ${preview}
        <div class="bs-title"><h4>${known ? def.name : '???'}</h4><span>${known ? `${CATEGORY(sel)} · seen ${rec.seen} · slain ${rec.killed}` : 'unseen'}</span>${known ? `<small class="bs-ref">kind <b>${sel}</b> · sheets <b>${def.sprite ? def.sprite.walk.replace(/_[a-z]+$/, '') + '_*' : def.single ?? '—'}</b></small>` : ''}${known && this.hooks.tryOut && def.sprite ? `<button class="ds-btn bs-tryout" data-tryout="${sel}">✦ SHOW ON THE SAND</button>` : ''}</div>
        <p class="bs-lore">${known ? (LORE[sel] ?? 'No scholar survived long enough to write of this one.') : 'Something moves down there. Meet it, or switch on the Forbidden Arts, and its page fills in.'}</p>
        <div class="bs-stats">
          ${stat('Vitality', `${def.hp}`, `≈${scaled} at level ${level}`)}
          ${stat('Damage', `${def.minDamage}–${def.maxDamage}`, '+1 per level')}
          ${stat('Armor', `${def.armor ?? 0}`, '+½ per level')}
          ${stat('Accuracy', `${Math.round(def.toHit * 100)}%`)}
          ${stat('Speed', `${Math.round(def.speedMult * 100)}%`)}
          ${stat('Reach', def.reach > 0 ? `${def.reach} tiles` : def.ranged ? `ranged · ${def.ranged.range} tiles` : '—')}
          ${stat('Wind-up', `${(def.windupTicks / 60).toFixed(2)}s`, 'the dodge window')}
          ${def.fleeBelowFrac ? stat('Flees', `below ${Math.round(def.fleeBelowFrac * 100)}% life`) : ''}
          ${def.hitEffect === 'slow' ? stat('Blows', 'chill and slow you') : ''}
          ${def.summons ? stat('Calls', 'reinforcements when hurt') : ''}
        </div>
        <div class="bs-scale">Depth scaling: life ×(1 + 0.3·(level−1)) · damage +1/level · armor +½/level. Rare spawns roll one level above their floor.</div>`;
    }
    this.panel.innerHTML = `
      <div class="bs-head drag-handle"><h3>BESTIARY</h3><span class="bs-count">${seenKinds.length} / ${kinds.length} KNOWN</span><button class="tp-close" data-close title="Close (ESC)"><i></i></button></div>
      <div class="bs-body"><div class="bs-list">${list}</div><div class="bs-detail">${detail}</div></div>`;
    const listEl = this.panel.querySelector<HTMLElement>('.bs-list');
    if (listEl) listEl.scrollTop = keepScroll;
    const closeBtn = this.panel.querySelector<HTMLElement>('[data-close]');
    closeBtn?.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    closeBtn?.addEventListener('click', () => {
      audio.sfx('uiClick');
      this.close();
    });
    const tryBtn = this.panel.querySelector<HTMLButtonElement>('[data-tryout]');
    tryBtn?.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    tryBtn?.addEventListener('click', () => {
      audio.sfx('uiClick');
      const kind = tryBtn.dataset.tryout as EnemyKind;
      this.close();
      this.hooks.tryOut?.(kind);
    });
    this.panel.querySelectorAll<HTMLButtonElement>('.bs-row[data-kind]').forEach((b) => {
      b.addEventListener('click', () => {
        audio.sfx('uiClick');
        this.selected = b.dataset.kind as EnemyKind;
        this.render();
      });
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    });
    // Breathe (it.115): the shared preview ticker - a calm idle, not a twitch.
    animatePreviews(this.panel);
  }

  destroy(): void {
    this.abort.abort();
    this.stopAnim();
    for (const off of this.offs) off();
    this.panel.remove();
  }
}
