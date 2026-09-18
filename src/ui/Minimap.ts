/**
 * @module ui/Minimap
 * THE CHART. A top-down orthographic map — never isometric, because a player
 * glancing at a corner for a third of a second has to read it, and a diamond
 * grid is not read, it is deciphered. It shows ONLY what the fog has given
 * up: explored floors and walls in shadow tones, currently-visible tiles
 * brighter, the stairs in gold once found, and the hero on top of it all.
 *
 * M OPENS IT, M CLOSES IT (it.117). Until now M toggled the CORNER map and
 * the full chart could only be reached by clicking the corner — so the key
 * that every player presses for "map" made the map disappear. M is now the
 * full chart, open and closed, which is what the key means everywhere else in
 * the genre. SHIFT+M still folds the corner away for a clean screen.
 *
 * THE MARKS ARE LEGIBLE AT BOTH SIZES (it.117). Every mark and the hero are
 * drawn at a constant SCREEN size: the canvas is stretched by CSS to two very
 * different boxes (a ~150 px corner and a ~560 px sheet) and a mark measured
 * in canvas pixels is therefore two different sizes to the eye. Each frame
 * measures the live CSS scale and divides by it, so a mark is the same number
 * of real pixels whichever box it is in. The hero is an ARROW, pointing the
 * way they face, inside a pale ring — the one thing on the chart that is
 * white, so the eye finds it before it reads anything else. Expanded, the
 * marks carry their names and the sheet carries a legend.
 *
 * Pure DOM/canvas render layer: reads `Lighting.getState` + the dungeon grid
 * and writes nothing back. The explored base layer redraws only when the fog
 * changes (`markDirty`, wired to player:tileChanged); everything else
 * composites every frame from the cached base.
 */

import { audio } from '@/engine/AudioManager';
import type { Lighting } from '@/engine/Lighting';
import { TILE_FLOOR, type DungeonMap } from '@/scenes/DungeonGenerator';
import { registerPanel } from './panelShell';

/** Canvas pixels per dungeon tile. Six, not four (it.117): the sheet is
 *  stretched to 560 px and a 4 px tile turned to porridge on the way. */
const SCALE = 6;

const COLOR_FLOOR_EXPLORED = '#3c372e';
const COLOR_FLOOR_VISIBLE = '#6a5f48';
const COLOR_WALL_EXPLORED = '#23202b';
const COLOR_WALL_VISIBLE = '#3a3444';
const COLOR_STAIRS = '#d8a83c';

/** THE QUARRY'S MARKS (it.85): drawn only once their tile has been explored. */
export interface MapMarker {
  x: number;
  y: number;
  kind: 'key' | 'door' | 'door-open' | 'boss' | 'portal' | 'foe' | 'quest' | 'gate';
  /** A quest mark (it.91): drawn before the fog lifts. */
  always?: boolean;
  /** A name, written beside the mark on the expanded sheet (it.117). */
  label?: string;
}

/** The legend, and the single source of each mark's colour. */
const MARK_COLOR: Record<MapMarker['kind'], string> = {
  quest: '#ffd670',
  boss: '#ff5f5f',
  foe: '#ff4a3a',
  key: '#ffd070',
  door: '#d0303a',
  'door-open': '#5fc87f',
  portal: '#8fb8ff',
  gate: '#9fe0c8',
};
const LEGEND: Array<[MapMarker['kind'] | 'you' | 'stairs', string]> = [
  ['you', 'you'],
  ['stairs', 'stairs'],
  ['quest', 'objective'],
  ['gate', 'gateway'],
  ['boss', 'keeper'],
  ['foe', 'foe'],
  ['key', 'key'],
  ['door', 'sealed'],
];

export class MinimapUI {
  /** Marks on the map, read every frame; each shows only when its tile is out of the fog. */
  private markers: () => ReadonlyArray<MapMarker> = () => [];

  setMarkers(fn: () => ReadonlyArray<MapMarker>): void {
    this.markers = fn;
  }

  private readonly wrap: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly legendEl: HTMLElement;

  private dungeon: DungeonMap | null = null;
  private lighting: Lighting | null = null;
  private stairs: { x: number; y: number } | null = null;
  private dirty = true;
  private visible = true;
  private readonly abort = new AbortController();
  private readonly unshell: () => void;
  /** CO-OP (it.59): the other heroes, drawn in their seat colours. */
  party: (() => Array<{ x: number; y: number; color: string; dead: boolean }>) | null = null;
  /** THE HERO'S HEADING (it.117): world-space unit facing, for the arrow. */
  private headX = 0;
  private headY = 1;

  /** THE EXPANDED CHART (it.67): the same map, large, in the middle. */
  private expanded = false;

  constructor() {
    this.wrap = document.createElement('div');
    this.wrap.id = 'minimap';
    this.wrap.setAttribute('role', 'button');
    this.wrap.setAttribute('aria-label', 'Map — M for the full chart');
    this.canvas = document.createElement('canvas');
    this.base = document.createElement('canvas');
    this.wrap.appendChild(this.canvas);
    // The chart's furniture: a title plaque, a close mark and the legend,
    // seen only while expanded.
    const head = document.createElement('div');
    head.className = 'mm-head';
    head.innerHTML = '<span>THE CHART</span><button class="tp-close" type="button" aria-label="Close map (M or ESC)"><i></i></button>';
    this.wrap.appendChild(head);
    this.legendEl = document.createElement('div');
    this.legendEl.className = 'mm-legend';
    this.legendEl.innerHTML = LEGEND.map(
      ([k, name]) => `<span><i class="mm-key mm-key-${k}"></i>${name}</span>`,
    ).join('');
    this.wrap.appendChild(this.legendEl);
    document.body.appendChild(this.wrap);
    this.ctx = this.canvas.getContext('2d')!;
    this.baseCtx = this.base.getContext('2d')!;
    injectCss();

    // A TAP OPENS THE CHART (it.67): the corner map was too small to read on
    // a phone and the round clip hid its corners. A tap swells it to the
    // middle of the screen; a tap on the veil, the mark, ESC or M folds it
    // back. Acting on pointerup, one task late, for the same reason the
    // system bar does: the tap's click must not land in the chart.
    let down: number | null = null;
    this.wrap.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        down = e.pointerId;
      },
      { signal: this.abort.signal },
    );
    this.wrap.addEventListener(
      'pointerup',
      (e) => {
        if (down !== e.pointerId) return;
        down = null;
        e.preventDefault();
        e.stopPropagation();
        window.setTimeout(() => this.setExpanded(!this.expanded), 0);
      },
      { signal: this.abort.signal },
    );
    this.wrap.addEventListener('contextmenu', (e) => e.preventDefault(), { signal: this.abort.signal });

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        if (isTyping()) return; // Somebody is writing a note; M is an M.
        e.preventDefault();
        // SHIFT+M: fold the corner chart away without touching the sheet.
        if (e.shiftKey) {
          if (this.expanded) this.setExpanded(false);
          this.visible = !this.visible;
          this.wrap.classList.toggle('hidden', !this.visible);
          audio.sfx(this.visible ? 'mapOpen' : 'mapClose');
          return;
        }
        // M IS THE FULL CHART, BOTH WAYS (it.117).
        if (!this.visible) {
          this.visible = true;
          this.wrap.classList.remove('hidden');
        }
        this.setExpanded(!this.expanded);
      },
      { signal: this.abort.signal },
    );
    // ESCAPE is the shell's (it.117): one press, one window, and the same
    // press can never also pause the run.
    this.unshell = registerPanel({
      id: 'minimap',
      el: 'minimap',
      isOpen: () => this.expanded,
      close: () => this.setExpanded(false),
      fit: false, // The sheet sizes itself from the layout; it is never scaled.
    });
  }

  get isExpanded(): boolean {
    return this.expanded;
  }

  setExpanded(on: boolean): void {
    if (this.expanded === on) return;
    this.expanded = on;
    this.wrap.classList.toggle('expanded', on);
    document.body.classList.toggle('map-expanded', on);
    audio.sfx(on ? 'mapOpen' : 'mapClose');
    if (on) this.dirty = true;
  }

  /** Run teardown (it.36). */
  destroy(): void {
    this.abort.abort();
    this.unshell();
    document.body.classList.remove('map-expanded');
    this.wrap.remove();
  }

  /** Bind to a floor's dungeon + fog state (called by each world build). */
  setWorld(dungeon: DungeonMap, lighting: Lighting, stairs: { x: number; y: number }): void {
    this.dungeon = dungeon;
    this.lighting = lighting;
    this.stairs = stairs;
    this.canvas.width = dungeon.width * SCALE;
    this.canvas.height = dungeon.height * SCALE;
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    this.dirty = true;
  }

  /** Fog changed — the explored base layer needs a redraw. */
  markDirty(): void {
    this.dirty = true;
  }

  /** The hero's world-space facing, for the arrow (it.117). */
  setHeading(x: number, y: number): void {
    const d = Math.hypot(x, y);
    if (d < 0.001) return;
    this.headX = x / d;
    this.headY = y / d;
  }

  /**
   * How many canvas pixels make one screen pixel right now. The canvas is
   * `object-fit: contain` inside a CSS box, so the live ratio is the smaller
   * of the two axes — and it is what keeps a mark the same size to the eye in
   * a 150 px corner and on a 560 px sheet.
   */
  private canvasPerScreenPx(): number {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h || !this.canvas.width || !this.canvas.height) return 1;
    const s = Math.min(w / this.canvas.width, h / this.canvas.height);
    return s > 0.01 ? 1 / s : 1;
  }

  /** Per-render-frame composite: cached base + live marks + the hero. */
  update(px: number, py: number, time: number): void {
    if (!this.visible || !this.dungeon || !this.lighting) return;
    if (this.dirty) {
      this.redrawBase();
      this.dirty = false;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    // `u` is one screen pixel, in canvas units. Every size below is written
    // as a multiple of it, which is the whole trick.
    const u = this.canvasPerScreenPx();
    const big = this.expanded;

    // Party (it.59): steady colour-coded discs under the local arrow.
    if (this.party) {
      for (const m of this.party()) {
        ctx.fillStyle = m.color;
        ctx.globalAlpha = m.dead ? 0.35 : 1;
        ctx.beginPath();
        ctx.arc(m.x * SCALE, m.y * SCALE, 4 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.2 * u;
        ctx.strokeStyle = '#07050a';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // THE MARKS (it.85): keys, gates, the keeper and the way home — never
    // before the fog lifts, unless the mark says `always`.
    const labels: Array<{ x: number; y: number; text: string; color: string }> = [];
    for (const m of this.markers()) {
      if (!m.always && this.lighting.getState(m.x, m.y) === 0) continue;
      const cx = m.x * SCALE + SCALE / 2;
      const cy = m.y * SCALE + SCALE / 2;
      this.drawMark(ctx, m, cx, cy, u, time);
      if (big && m.label) labels.push({ x: cx, y: cy, text: m.label, color: MARK_COLOR[m.kind] });
    }

    // THE STAIRS, named, on the sheet.
    if (big && this.stairs && this.lighting.getState(this.stairs.x, this.stairs.y) !== 0) {
      labels.push({ x: this.stairs.x * SCALE + SCALE / 2, y: this.stairs.y * SCALE + SCALE / 2, text: 'STAIRS', color: COLOR_STAIRS });
    }

    this.drawHero(ctx, px * SCALE, py * SCALE, u, time);
    // Labels last, so no mark is ever written over.
    for (const l of labels) this.drawLabel(ctx, l.x, l.y, l.text, l.color, u);
  }

  /** The hero: a white arrow in a pale ring, the only white thing on the chart. */
  private drawHero(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, time: number): void {
    const pulse = 1 + Math.sin(time * 5) * 0.08;
    ctx.save();
    // The ring first — it is what the eye catches at a glance.
    ctx.beginPath();
    ctx.arc(x, y, 8.5 * u * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1.6 * u;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 6 * u, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(224, 74, 47, 0.28)';
    ctx.fill();
    // The arrow, rotated into the hero's heading.
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(this.headY, this.headX) + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -7 * u);
    ctx.lineTo(4.6 * u, 5 * u);
    ctx.lineTo(0, 2.6 * u);
    ctx.lineTo(-4.6 * u, 5 * u);
    ctx.closePath();
    ctx.fillStyle = '#fff6ea';
    ctx.strokeStyle = '#7a1c10';
    ctx.lineWidth = 1.4 * u;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** One mark. Distinct SHAPE first, distinct colour second — colour alone is not a signal. */
  private drawMark(ctx: CanvasRenderingContext2D, m: MapMarker, cx: number, cy: number, u: number, time: number): void {
    ctx.save();
    ctx.lineWidth = 1.2 * u;
    const color = MARK_COLOR[m.kind];
    if (m.kind === 'key') {
      // A KEY: a ring and a bit.
      ctx.fillStyle = color;
      ctx.strokeStyle = '#3a2a08';
      ctx.beginPath();
      ctx.arc(cx - 1.6 * u, cy - 1.6 * u, 2.8 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 4.4 * u, cy + 4.4 * u);
      ctx.moveTo(cx + 3 * u, cy + 3 * u);
      ctx.lineTo(cx + 1.8 * u, cy + 4.4 * u);
      ctx.stroke();
    } else if (m.kind === 'door' || m.kind === 'door-open') {
      // A DOOR: a square, red shut and green open, with a handle.
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000';
      ctx.fillRect(cx - 4 * u, cy - 4 * u, 8 * u, 8 * u);
      ctx.strokeRect(cx - 4 * u, cy - 4 * u, 8 * u, 8 * u);
      ctx.fillStyle = '#000';
      ctx.fillRect(cx - 1 * u, cy - 2 * u, 2 * u, 3.4 * u);
    } else if (m.kind === 'foe') {
      // A FOE: a pulsing red pip.
      ctx.fillStyle = color;
      ctx.strokeStyle = '#3a0808';
      ctx.beginPath();
      ctx.arc(cx, cy, (3 + Math.sin(time * 6 + m.x) * 0.5) * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (m.kind === 'quest') {
      // AN OBJECTIVE (it.108): a gold star with a dark rim and a ring pulsing
      // out of it, so the eye finds it on a map the size of the town's.
      const t = (performance.now() / 1000) % 1.6;
      ctx.strokeStyle = `rgba(255, 214, 120, ${(0.6 * (1 - t / 1.6)).toFixed(3)})`;
      ctx.lineWidth = 1.8 * u;
      ctx.beginPath();
      ctx.arc(cx, cy, (3 + t * 6) * u, 0, Math.PI * 2);
      ctx.stroke();
      star(ctx, cx, cy, 5.6 * u, 2.4 * u, 5);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#3a2a08';
      ctx.lineWidth = 1.2 * u;
      ctx.fill();
      ctx.stroke();
    } else if (m.kind === 'boss') {
      // A KEEPER: a diamond with a dark core.
      ctx.beginPath();
      ctx.moveTo(cx, cy - 6 * u);
      ctx.lineTo(cx + 6 * u, cy);
      ctx.lineTo(cx, cy + 6 * u);
      ctx.lineTo(cx - 6 * u, cy);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 1.8 * u, 0, Math.PI * 2);
      ctx.fillStyle = '#2a0808';
      ctx.fill();
    } else if (m.kind === 'gate') {
      // A GATEWAY (it.117): an arch. Not a dot — a way OUT reads as a shape
      // you could walk through, and there is nothing else arch-shaped here.
      ctx.strokeStyle = color;
      ctx.fillStyle = 'rgba(12, 20, 18, 0.85)';
      ctx.lineWidth = 1.8 * u;
      ctx.beginPath();
      ctx.moveTo(cx - 4.6 * u, cy + 5 * u);
      ctx.lineTo(cx - 4.6 * u, cy - 0.6 * u);
      ctx.arc(cx, cy - 0.6 * u, 4.6 * u, Math.PI, 0);
      ctx.lineTo(cx + 4.6 * u, cy + 5 * u);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      // A PORTAL / THE WAY HOME: a breathing blue ring.
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(cx, cy, (4.5 + Math.sin(time * 5) * 0.8) * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(143, 184, 255, 0.35)';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.4 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** A name beside a mark: dark plate, light text, never wider than the sheet. */
  private drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, u: number): void {
    const size = 10 * u;
    ctx.save();
    ctx.font = `700 ${size.toFixed(1)}px Cinzel, Georgia, serif`;
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width;
    // Keep the plate inside the canvas, flipping to the mark's other side at the edge.
    let lx = x + 9 * u;
    if (lx + w + 6 * u > this.canvas.width) lx = x - 9 * u - w;
    const ly = y - 9 * u;
    ctx.fillStyle = 'rgba(8, 6, 12, 0.82)';
    ctx.fillRect(lx - 3 * u, ly - size * 0.72, w + 6 * u, size * 1.44);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = u;
    ctx.strokeRect(lx - 3 * u, ly - size * 0.72, w + 6 * u, size * 1.44);
    ctx.fillStyle = color;
    ctx.fillText(text, lx, ly);
    ctx.restore();
  }

  private redrawBase(): void {
    const { dungeon, lighting } = this;
    if (!dungeon || !lighting) return;
    const ctx = this.baseCtx;
    ctx.clearRect(0, 0, this.base.width, this.base.height);

    for (let gy = 0; gy < dungeon.height; gy++) {
      for (let gx = 0; gx < dungeon.width; gx++) {
        const state = lighting.getState(gx, gy);
        if (state === 0) continue; // HIDDEN: reveal nothing.
        const isFloor = dungeon.grid[gy * dungeon.width + gx] === TILE_FLOOR;
        const visible = state === 2;
        ctx.fillStyle = isFloor
          ? visible
            ? COLOR_FLOOR_VISIBLE
            : COLOR_FLOOR_EXPLORED
          : visible
            ? COLOR_WALL_VISIBLE
            : COLOR_WALL_EXPLORED;
        ctx.fillRect(gx * SCALE, gy * SCALE, SCALE, SCALE);
      }
    }

    // The stairs, once their tile has been revealed: a gold plate with a dark
    // step across it, so it is a SHAPE and not just a brighter square.
    if (this.stairs && lighting.getState(this.stairs.x, this.stairs.y) !== 0) {
      const sx = this.stairs.x * SCALE;
      const sy = this.stairs.y * SCALE;
      ctx.fillStyle = COLOR_STAIRS;
      ctx.fillRect(sx - SCALE * 0.5, sy - SCALE * 0.5, SCALE * 2, SCALE * 2);
      ctx.fillStyle = 'rgba(24, 16, 4, 0.75)';
      ctx.fillRect(sx - SCALE * 0.5, sy + SCALE * 0.25, SCALE * 2, SCALE * 0.4);
      ctx.fillRect(sx - SCALE * 0.5, sy - SCALE * 0.1, SCALE * 2, SCALE * 0.4);
    }
  }
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, points: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/** The legend's own styling: it exists only on the expanded sheet. */
const CSS = `
/* THE SHEET IS ALWAYS REACHABLE (it.117): a micro-tier phone hides the corner
   chart to buy screen, and M must still open the full one. */
body #minimap.expanded { display: block !important; }
/* THE CHART IS NOT A SCROLLING WINDOW (it.117). ui/panelShell clamps every
   registered window's overflow, and the chart is registered so ESCAPE reaches
   it — but its veil is a position:fixed pseudo-element inset by -100vmax,
   and the sheet's centring transform makes the chart that veil's containing
   block. Clamp the overflow and the veil becomes two thousand pixels of
   scrollable nothing with a bar down the side. The chart opts out. */
body #minimap { overflow: visible !important; }
/* THE SHEET IS THE ONLY THING ON SCREEN (it.117). The chart lives inside the
   top-right stack, so its z-index is the stack's to give and the log (z 30 on
   the body) painted straight across the middle of it. Rather than fight the
   stacking contexts, the two head-up panels that would overlap the sheet
   stand down while it is open — which is what a full-screen chart wants
   anyway. The class body.map-expanded is set by setExpanded(). */
body.map-expanded #chat,
body.map-expanded #controls,
body.map-expanded #toast-stack { display: none !important; }
#minimap .mm-legend { display: none; }
body #minimap.expanded .mm-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 7px 4px 1px;
  font-family: 'Crimson Pro', Georgia, serif;
  font-size: 12px;
  color: #a89c80;
}
body #minimap.expanded .mm-legend span { display: inline-flex; align-items: center; gap: 5px; }
.mm-key { width: 9px; height: 9px; border: 1px solid #07050a; display: inline-block; }
.mm-key-you { background: #fff6ea; border-radius: 50%; box-shadow: 0 0 0 2px rgba(224, 74, 47, 0.45); }
.mm-key-stairs { background: #d8a83c; }
.mm-key-quest { background: #ffd670; transform: rotate(45deg); }
.mm-key-gate { background: #9fe0c8; border-radius: 50% 50% 0 0; }
.mm-key-boss { background: #ff5f5f; transform: rotate(45deg); }
.mm-key-foe { background: #ff4a3a; border-radius: 50%; }
.mm-key-key { background: #ffd070; border-radius: 50%; }
.mm-key-door { background: #d0303a; }
`;

function injectCss(): void {
  if (document.getElementById('minimap-css')) return;
  const style = document.createElement('style');
  style.id = 'minimap-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}
