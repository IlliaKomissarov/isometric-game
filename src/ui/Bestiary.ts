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
import { atlasUrl, rowForDir, spriteLib } from '@/render/SpriteLibrary';

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
};

const CATEGORY = (kind: EnemyKind): string => (kind.startsWith('boss') ? 'WARDEN' : 'CREATURE');

export class BestiaryUI {
  private readonly panel: HTMLElement;
  private visible = false;
  private selected: EnemyKind | null = null;
  private timer: number | null = null;
  private readonly offs: Array<() => void> = [];
  private readonly abort = new AbortController();

  constructor(private readonly player: Player) {
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
    const kinds = (Object.keys(ENEMY_TYPES) as EnemyKind[]).filter((k) => p.bestiaryRevealed || p.bestiary.has(k));
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

  /** CSS sprite from the atlas strip: south-facing idle (or walk) row, scaled to `height` px. */
  private spriteCss(kind: EnemyKind, height: number): { style: string; frames: number; cellW: number; row: number; file: string; scale: number } | null {
    const sp = ENEMY_TYPES[kind].sprite;
    if (!sp) return null;
    const anim = sp.idle ?? sp.walk;
    const e = spriteLib.entry(anim);
    if (!e) return null;
    const painted = e.painted;
    const paintedH = painted ? painted.bottom - painted.top + 1 : e.origH;
    const scale = height / (paintedH * e.scale);
    const row = e.dirCount === 8 ? rowForDir(anim, 6) : 0;
    const style = `width:${e.cellW}px;height:${e.cellH}px;background-image:url(${atlasUrl(e.file)});background-position:0px ${-row * e.cellH}px;transform:scale(${scale.toFixed(3)});`;
    return { style, frames: e.frameCount, cellW: e.cellW, row, file: e.file, scale };
  }

  private render(): void {
    this.stopAnim();
    // The list keeps its scroll across a re-render (it.49): picking an entry no longer snaps to the top.
    const keepScroll = this.panel.querySelector<HTMLElement>('.bs-list')?.scrollTop ?? 0;
    const p = this.player;
    const kinds = Object.keys(ENEMY_TYPES) as EnemyKind[];
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
      const css = this.spriteCss(sel, sel.startsWith('boss') ? 150 : 96);
      // UNKNOWN (it.43): a solid black silhouette — the fog-of-war shadow of a thing not yet met.
      const look = known ? 'filter:drop-shadow(0 6px 6px rgba(0,0,0,.8)) sepia(0.15);' : 'filter:brightness(0) drop-shadow(0 0 6px rgba(0,0,0,.9));opacity:0.9;';
      const preview = css
        ? `<div class="bs-stage${known ? '' : ' unknown'}"><div class="bs-sprite" data-anim style="${css.style}${look}"></div></div>`
        : `<div class="bs-stage"><div class="bs-nosprite">${known ? def.name : '???'}</div></div>`;
      const stat = (k: string, v: string, note = ''): string => `<div class="bs-stat"><span>${k}</span><b>${known ? v : '???'}</b>${known && note ? `<i>${note}</i>` : ''}</div>`;
      const level = Math.max(1, p.level);
      const scaled = Math.round(def.hp * levelHpScale(level));
      detail = `
        ${preview}
        <div class="bs-title"><h4>${known ? def.name : '???'}</h4><span>${known ? `${CATEGORY(sel)} · seen ${rec.seen} · slain ${rec.killed}` : 'unseen'}</span></div>
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
    this.panel.querySelectorAll<HTMLButtonElement>('.bs-row[data-kind]').forEach((b) => {
      b.addEventListener('click', () => {
        audio.sfx('uiClick');
        this.selected = b.dataset.kind as EnemyKind;
        this.render();
      });
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
    });
    // Breathe: step the strip's frames on a slow cadence.
    const spriteEl = this.panel.querySelector<HTMLElement>('.bs-sprite[data-anim]');
    if (spriteEl && sel) {
      const css = this.spriteCss(sel, 1);
      if (css && css.frames > 1) {
        let f = 0;
        this.timer = window.setInterval(() => {
          f = (f + 1) % css.frames;
          spriteEl.style.backgroundPosition = `${-f * css.cellW}px ${-css.row * (parseFloat(spriteEl.style.height) || 0)}px`;
        }, 140);
      }
    }
  }

  destroy(): void {
    this.abort.abort();
    this.stopAnim();
    for (const off of this.offs) off();
    this.panel.remove();
  }
}
