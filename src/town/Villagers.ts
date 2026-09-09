/**
 * @module town/Villagers
 * Ambient townsfolk (it.39, re-skinned it.43): render-only wanderers that
 * stroll the square, pause, and turn — never simulation entities (they
 * cannot be hit, they carry no state, and their randomness is render-side
 * by design). The shopkeeper stands behind the stall and breathes; two
 * GATE GUARDS (the poacher pack's idle) keep watch at the dungeon gate.
 *
 * Bodies come from the `folk_walk` atlas (the Villager_01 pack: 8 walk
 * directions × 15 frames, feet-true cells); frame 0 doubles as standing.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { spriteLib, stableDir, type AnimName } from '@/render/SpriteLibrary';
import type { Room } from '@/scenes/DungeonGenerator';
import { depthKey, worldToScreen } from '@/utils/iso';
import { vec2 } from '@/utils/Vec2';

/** Painted height on screen — the hero standard. */
const FOLK_HEIGHT = 56;
const WALK_SPEED = 1.25; // tiles / s
const CYCLES_PER_TILE = 0.5;
/**
 * A WALKER CARRIES ITS OWN SHEET (it.98). A sheet is not interchangeable with
 * another - painted height, anchor, frame count and scale all differ - so each
 * walker holds its own. Every anim named here is registered in
 * `SpriteLibrary.DIR_ROW_FIX`, so they all face the way they walk. `feet` marks a
 * sheet whose cells end at the sole (anchor 1); the others are padded below.
 */
export interface FolkSheet {
  anim: AnimName;
  feet: boolean;
  height: number;
}
/**
 * THE TAPROOM'S REGULARS (it.99). These four wander in circles, which reads as
 * drinkers moving between tables indoors and as aimless milling out on the street -
 * so they are kept to the inn, and the town gets bodies of its own below.
 */
export const TAVERN_FOLK: ReadonlyArray<FolkSheet> = [
  { anim: 'folk_walk', feet: true, height: 56 },
  { anim: 'villager_walk', feet: false, height: 58 },
  { anim: 'merchant_walk', feet: false, height: 58 },
  { anim: 'poacher_walk', feet: true, height: 58 },
];
/**
 * THE TOWN'S OWN PEOPLE (it.99). Five civilians composited from the layered pack -
 * a bearded farmer, a porter, a robed monk, a goodwife and a maid - so a street is
 * a crowd of different people instead of the taproom's four regulars milling about
 * outdoors. They are drawn small, so they stand a shade under the taproom's folk.
 */
export const STREET_FOLK: ReadonlyArray<FolkSheet> = [
  { anim: 'cit_farmer_walk', feet: true, height: 57 },
  { anim: 'cit_porter_walk', feet: true, height: 57 },
  { anim: 'cit_monk_walk', feet: true, height: 58 },
  { anim: 'cit_goodwife_walk', feet: true, height: 56 },
  { anim: 'cit_maid_walk', feet: true, height: 56 },
  // THE LABOURER (it.99): the one genuine eight-direction civilian in the packs -
  // a bare-armed man in a rust tunic, and the same man in a colder blue-grey re-dye.
  { anim: 'cit_labourer_walk', feet: true, height: 58 },
  { anim: 'cit_carter_walk', feet: true, height: 58 },
];
/** Coats, aprons and cloaks: a colour per walker, multiplied into the scene's light. */
const FOLK_COATS: readonly number[] = [0xffffff, 0xe8d0b0, 0xc8d8e8, 0xd8c8e0, 0xe0d8b0, 0xc0d8c0, 0xf0d0c0, 0xd0d0d8];
const GUARD_IDLE = 'poacher_idle';
/** The gatekeeper wears the guard's mail (it.87). */
const KEEPER_IDLE = 'guard_idle';

/**
 * AMBIENT CHATTER (it.91): a word or two over a head now and then. Tiny
 * bubbles, render-only, one per speaker, never two at once on the same
 * head; the words come from the district's own bank.
 */
export const TOWN_WORDS = ['Nice weather today.', 'Greetings.', 'So much work to do.', 'Good morning.', 'Long day.', 'Have you eaten?', 'Mind your step.', 'Off to the market.', 'Looks like rain.', 'Take care.', 'Busy today.', 'Good to see you.', 'Afternoon.', 'Back to work.'];
export const VENDOR_WORDS = ['Take a look.', 'Fair prices.', 'Fresh stock today.', 'Good morning.', 'Anything else?', 'Come back soon.'];
export const GUARD_WORDS = ['All quiet.', 'Move along.', 'Long shift.', 'Evening.', 'Nothing to report.'];
export const REFUGEE_WORDS = ['We lost everything.', 'Our house is in there.', 'Is it safe yet?', 'Cold night.', 'Any news?', 'They took it all.', 'We wait.'];
export const RECLAIMED_WORDS = ['We\'re home.', 'So much to rebuild.', 'Thank you.', 'The roof needs work.', 'Good to be back.', 'Nice weather today.', 'Back to work.'];
export const TAVERN_WORDS = ['Another round.', 'Long day.', 'Good stew tonight.', 'Cheers.', 'Warm in here.', 'Heard the news?', 'One more, then home.'];

export interface VillagerOptions {
  /** The bank the folk speak from (none: silent). */
  chatter?: string[];
  /** THE STREETS (it.92): street tiles by index (`y * width + x`); the folk walk them, and the lanes between. */
  roads?: Uint8Array;
  mapWidth?: number;
  vendorWords?: string[];
  guardWords?: string[];
  /** The keeper's colour and body (the innkeeper wears the villager's coat). */
  keeperTint?: number;
  keeperAnim?: string;
  /** THE PEOPLE OF THIS PLACE (it.99): which bodies walk here. Defaults to the taproom's. */
  sheets?: ReadonlyArray<FolkSheet>;
}

interface Bubble {
  node: Container;
  bg: Graphics;
  text: Text;
  /** Seconds until the next word. */
  wait: number;
  /** Seconds the current word has left (0: hidden). */
  life: number;
}

const BUBBLE_LIFE = 2.2;

function makeBubble(layer: Container, first: number): Bubble {
  const node = new Container();
  node.visible = false;
  const bg = new Graphics();
  const text = new Text({
    text: '',
    style: { fontFamily: 'Cinzel, Georgia, serif', fontSize: 9, fill: 0xf4e8c8, letterSpacing: 0.5 },
    resolution: 2,
  });
  text.anchor.set(0.5, 1);
  node.addChild(bg);
  node.addChild(text);
  layer.addChild(node);
  return { node, bg, text, wait: first, life: 0 };
}

function speak(b: Bubble, words: string[]): void {
  b.text.text = words[Math.floor(Math.random() * words.length)] ?? '...';
  const w = Math.ceil(b.text.width) + 10;
  const h = Math.ceil(b.text.height) + 6;
  b.bg.clear();
  b.bg.roundRect(-w / 2, -h - 6, w, h, 4).fill({ color: 0x0e0a10, alpha: 0.86 }).stroke({ color: 0x6a5630, width: 1 });
  b.bg.moveTo(-3, -6).lineTo(0, -1).lineTo(3, -6).fill({ color: 0x0e0a10, alpha: 0.86 });
  b.text.position.set(0, -9);
  b.life = BUBBLE_LIFE;
  b.node.visible = true;
  b.node.alpha = 0;
}

/**
 * THE CLEAN FRAME (it.101): while a cutscene is running the folk keep their
 * mouths shut and their bubbles off screen - a word about the weather floating
 * over a letterboxed rally is exactly the bleed-through the bars are for.
 */
let bubblesOff = false;
export function setBubblesHidden(off: boolean): void {
  bubblesOff = off;
}

/** Tick a bubble: fade in, hold, fade out; seat it over the head at (sx, sy). */
function tickBubble(b: Bubble, dt: number, words: string[] | undefined, sx: number, sy: number, depth: number): void {
  if (bubblesOff) {
    b.node.visible = false;
    return;
  }
  if (!words || !words.length) return;
  if (b.life > 0) {
    b.life -= dt;
    const t = BUBBLE_LIFE - b.life;
    b.node.alpha = Math.min(1, t / 0.25, Math.max(0, b.life) / 0.35);
    b.node.position.set(sx, sy - 2 * Math.sin(t * 2));
    b.node.zIndex = depth + 2;
    if (b.life <= 0) {
      b.node.visible = false;
      b.wait = 6 + Math.random() * 12;
    }
    return;
  }
  b.wait -= dt;
  if (b.wait <= 0) speak(b, words);
}

/** A coat colour under the scene's own light: channel-wise multiply, both 0xRRGGBB. */
function mulTint(light: number, coat: number): number {
  if (coat === 0xffffff) return light;
  const r = (((light >> 16) & 255) * ((coat >> 16) & 255)) / 255;
  const g = (((light >> 8) & 255) * ((coat >> 8) & 255)) / 255;
  const b = ((light & 255) * (coat & 255)) / 255;
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

interface Villager {
  root: Container;
  body: Sprite;
  /** THE STREETS ARE NOT ONE MAN (it.98): this walker's own sheet and its numbers. */
  anim: AnimName;
  scale: number;
  fc: number;
  coat: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** Seconds left standing before the next stroll. */
  pause: number;
  dir: number;
  walkClock: number;
  idleClock: number;
  bubble: Bubble;
  /** THE WAY (it.92): tile centres to walk through, the next first. */
  path: Array<{ x: number; y: number }>;
}

interface Guard {
  body: Sprite;
  clock: number;
  x: number;
  y: number;
  bubble: Bubble;
}

export class Villagers {
  private readonly folk: Villager[] = [];
  private readonly guards: Guard[] = [];
  private keeper: Guard | null = null;
  private readonly scratch = vec2();
  private merchant: { body: Sprite; clock: number; scale: number; bubble: Bubble; x: number; y: number } | null = null;
  /** The ALCHEMIST (it.48): the merchant body in violet robes behind the south stall. */
  private alchemist: { body: Sprite; clock: number; scale: number; bubble: Bubble; x: number; y: number } | null = null;
  private readonly opts: VillagerOptions;
  private readonly keeperAnim: AnimName;

  constructor(
    layer: Container,
    private readonly isWalkable: (gx: number, gy: number) => boolean,
    private readonly area: Room,
    count: number,
    merchantAt: { x: number; y: number } | null,
    guardsAt: ReadonlyArray<{ x: number; y: number }> = [],
    alchemistAt: { x: number; y: number } | null = null,
    /** THE MARKET WARD (it.84): the ward's vendors wear their own colours. */
    tints: { merchant?: number; alchemist?: number } = {},
    /** THE GATEKEEPER (it.87): a sentry in mail, breathing, at the eastern road. */
    keeperAt: { x: number; y: number } | null = null,
    /** AMBIENT CHATTER and the keeper's coat (it.91). */
    opts: VillagerOptions = {},
  ) {
    this.opts = opts;
    this.keeperAnim = (opts.keeperAnim && spriteLib.hasAnim(opts.keeperAnim) ? opts.keeperAnim : KEEPER_IDLE) as AnimName;
    // Only the sheets this floor actually loaded are on the street (it.98).
    const sheets = (opts.sheets ?? TAVERN_FOLK).filter((f) => spriteLib.hasAnim(f.anim));
    if (sheets.length) {
      for (let i = 0; i < count; i++) {
        const p = this.randomTile();
        // Deal the bodies round rather than rolling them, so no street is all one man.
        const sheet = sheets[i % sheets.length];
        const sPainted = spriteLib.paintedHeight(sheet.anim) || 50;
        // A little height between people - dealt from the index, not rolled, so the
        // street does not consume a number the rest of the frame is counting on.
        const scale = (sheet.height / sPainted) * (0.94 + ((i * 5) % 7) * 0.02);
        const root = new Container();
        root.scale.set(0.8);
        const shadow = new Sprite(assets.get('shadow'));
        shadow.anchor.set(0.5, 0.5);
        shadow.alpha = 0.6;
        root.addChild(shadow);
        const body = new Sprite(spriteLib.frame(sheet.anim, 6, 0));
        body.anchor.set(0.5, sheet.feet ? 1 : 0.86);
        body.scale.set(scale / 0.8); // Undo the shadow root's scale.
        body.position.set(0, 2);
        root.addChild(body);
        layer.addChild(root);
        this.folk.push({ root, body, anim: sheet.anim, scale, fc: spriteLib.anim(sheet.anim).frameCount, coat: FOLK_COATS[(i * 3 + 1) % FOLK_COATS.length], x: p.x, y: p.y, tx: p.x, ty: p.y, pause: Math.random() * 3, dir: 6, walkClock: 0, idleClock: Math.random() * 10, bubble: makeBubble(layer, 2 + Math.random() * 10), path: [] });
      }
    }
    if (merchantAt && spriteLib.hasAnim('merchant_walk')) {
      const mp = spriteLib.paintedHeight('merchant_walk') || 57;
      const mscale = 62 / mp;
      const body = new Sprite(spriteLib.frame('merchant_walk', 6, 0));
      body.anchor.set(0.5, 0.86);
      body.scale.set(mscale);
      const s = worldToScreen(merchantAt.x + 0.5, merchantAt.y + 0.5, this.scratch);
      body.position.set(s.x, s.y + 2);
      body.zIndex = depthKey(merchantAt.x + 0.5, merchantAt.y + 0.5);
      if (tints.merchant) body.tint = tints.merchant;
      layer.addChild(body);
      this.merchant = { body, clock: 0, scale: mscale, bubble: makeBubble(layer, 4 + Math.random() * 8), x: merchantAt.x + 0.5, y: merchantAt.y + 0.5 };
    }
    // The ALCHEMIST (it.49): the peasant body in violet, not the merchant's twin.
    const ALCH = spriteLib.hasAnim('villager_walk') ? 'villager_walk' : 'merchant_walk';
    if (alchemistAt && spriteLib.hasAnim(ALCH)) {
      const mp = spriteLib.paintedHeight(ALCH) || 57;
      const mscale = 62 / mp;
      const body = new Sprite(spriteLib.frame(ALCH, 6, 0));
      body.anchor.set(0.5, 0.86);
      body.scale.set(mscale);
      body.tint = tints.alchemist ?? 0xb8a0ff; // Violet robes: the alchemist (the scribe's are ice-blue).
      const s = worldToScreen(alchemistAt.x + 0.5, alchemistAt.y + 0.5, this.scratch);
      body.position.set(s.x, s.y + 2);
      body.zIndex = depthKey(alchemistAt.x + 0.5, alchemistAt.y + 0.5);
      layer.addChild(body);
      this.alchemist = { body, clock: 0.9, scale: mscale, bubble: makeBubble(layer, 6 + Math.random() * 8), x: alchemistAt.x + 0.5, y: alchemistAt.y + 0.5 };
    }
    if (spriteLib.hasAnim(GUARD_IDLE)) {
      const gp = spriteLib.paintedHeight(GUARD_IDLE) || 60;
      const gscale = 60 / gp;
      for (const at of guardsAt) {
        const body = new Sprite(spriteLib.frame(GUARD_IDLE, 6, 0));
        body.anchor.set(0.5, 1);
        body.scale.set(gscale);
        const s = worldToScreen(at.x + 0.5, at.y + 0.5, this.scratch);
        body.position.set(s.x, s.y + 2);
        body.zIndex = depthKey(at.x + 0.5, at.y + 0.5);
        layer.addChild(body);
        this.guards.push({ body, clock: Math.random() * 3, x: at.x + 0.5, y: at.y + 0.5, bubble: makeBubble(layer, 8 + Math.random() * 10) });
      }
    }
    if (keeperAt && spriteLib.hasAnim(this.keeperAnim)) {
      const KA = this.keeperAnim;
      const kp = spriteLib.paintedHeight(KA) || 60;
      const kscale = (KA === KEEPER_IDLE ? 64 : 60) / kp;
      // COLESLAW (it.98) wears the peasant sheet, whose cells end at the sole, so he
      // is anchored at his feet like the sentry - not at the villager coat's padding.
      const kFeet = KA === KEEPER_IDLE || KA === 'folk_walk' || KA === 'poacher_walk';
      const body = new Sprite(spriteLib.frame(KA, KA === KEEPER_IDLE ? 5 : 6, 0));
      body.anchor.set(0.5, kFeet ? 1 : 0.86);
      body.scale.set(kscale);
      body.tint = opts.keeperTint ?? 0xd8c8a8;
      const s = worldToScreen(keeperAt.x + 0.5, keeperAt.y + 0.5, this.scratch);
      body.position.set(s.x, s.y + 2);
      body.zIndex = depthKey(keeperAt.x + 0.5, keeperAt.y + 0.5);
      layer.addChild(body);
      this.keeper = { body, clock: 0.4, x: keeperAt.x + 0.5, y: keeperAt.y + 0.5, bubble: makeBubble(layer, 3 + Math.random() * 6) };
    }
  }

  /** Every head's place (it.92): the folk, the vendors, the keeper - so a roof or a trunk in front of them ghosts. */
  positions(): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (const v of this.folk) out.push({ x: v.x, y: v.y });
    if (this.merchant) out.push({ x: this.merchant.x, y: this.merchant.y });
    if (this.alchemist) out.push({ x: this.alchemist.x, y: this.alchemist.y });
    for (const g of this.guards) out.push({ x: g.x, y: g.y });
    if (this.keeper) out.push({ x: this.keeper.x, y: this.keeper.y });
    return out;
  }

  /** The keeper's tile centre (it.91): where a word bubble or a portrait looks for them. */
  get keeperAt(): { x: number; y: number } | null {
    return this.keeper ? { x: this.keeper.x, y: this.keeper.y } : null;
  }

  private randomTile(): { x: number; y: number } {
    // THE STREETS (it.92): three strolls in four end on a street tile, so the folk are seen on the roads.
    const roads = this.opts.roads;
    const W = this.opts.mapWidth ?? 0;
    const wantRoad = !!roads && W > 0 && Math.random() < 0.75;
    for (let i = 0; i < 60; i++) {
      const gx = this.area.x + Math.floor(Math.random() * this.area.w);
      const gy = this.area.y + Math.floor(Math.random() * this.area.h);
      if (!this.isWalkable(gx, gy)) continue;
      if (wantRoad && i < 50 && !roads![gy * W + gx]) continue;
      return { x: gx + 0.5, y: gy + 0.5 };
    }
    return { x: this.area.x + this.area.w / 2, y: this.area.y + this.area.h / 2 };
  }

  /**
   * THE WAY (it.92): a breadth-first walk over open tiles from one tile to
   * another, inside the wander area grown by a margin. Render-only and
   * cheap (a few thousand tiles at most); null when there is no way.
   */
  private findPath(sx: number, sy: number, tx: number, ty: number): Array<{ x: number; y: number }> | null {
    const m = 3;
    const x0 = this.area.x - m;
    const y0 = this.area.y - m;
    const w = this.area.w + m * 2;
    const h = this.area.h + m * 2;
    const inBox = (x: number, y: number): boolean => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;
    if (!inBox(sx, sy) || !inBox(tx, ty)) return null;
    const prev = new Int32Array(w * h).fill(-1);
    const key = (x: number, y: number): number => (y - y0) * w + (x - x0);
    const queue: number[] = [key(sx, sy)];
    prev[queue[0]] = queue[0];
    let head = 0;
    const goal = key(tx, ty);
    while (head < queue.length) {
      const k = queue[head++];
      if (k === goal) break;
      const x = (k % w) + x0;
      const y = Math.floor(k / w) + y0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBox(nx, ny) || !this.isWalkable(nx, ny)) continue;
        const nk = key(nx, ny);
        if (prev[nk] !== -1) continue;
        prev[nk] = k;
        queue.push(nk);
      }
    }
    if (prev[goal] === -1) return null;
    const out: Array<{ x: number; y: number }> = [];
    for (let k = goal; k !== key(sx, sy); k = prev[k]) out.push({ x: (k % w) + x0 + 0.5, y: Math.floor(k / w) + y0 + 0.5 });
    out.reverse();
    // Corners cut where the diagonal is open: the walk reads as a stroll, not a march along a grid.
    const smooth: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < out.length; i++) {
      if (i + 1 < out.length && i > 0) {
        const a = out[i - 1];
        const c = out[i + 1];
        if (a.x !== c.x && a.y !== c.y && this.isWalkable(Math.floor(a.x), Math.floor(c.y)) && this.isWalkable(Math.floor(c.x), Math.floor(a.y))) continue;
      }
      smooth.push(out[i]);
    }
    return smooth;
  }

  /** Render-frame update: stroll, pause, breathe; scene-lit by the caller's tint. */
  update(dt: number, tint: (x: number, y: number) => number): void {
    for (const v of this.folk) {
      if (v.pause > 0) {
        v.pause -= dt;
        v.idleClock += dt;
        if (v.pause <= 0) {
          // A new errand: somewhere in the district, by the streets (it.92).
          let path: Array<{ x: number; y: number }> | null = null;
          for (let tries = 0; tries < 4 && !path; tries++) {
            const t = this.randomTile();
            if (Math.hypot(t.x - v.x, t.y - v.y) < 2) continue;
            path = this.findPath(Math.floor(v.x), Math.floor(v.y), Math.floor(t.x), Math.floor(t.y));
          }
          if (path && path.length) {
            v.path = path;
            v.tx = path[0].x;
            v.ty = path[0].y;
          } else v.pause = 0.8 + Math.random() * 1.5;
        }
      } else {
        const dx = v.tx - v.x;
        const dy = v.ty - v.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.12) {
          v.path.shift();
          if (v.path.length) {
            v.tx = v.path[0].x;
            v.ty = v.path[0].y;
          } else v.pause = 1.2 + Math.random() * 3.5;
        } else {
          const step = Math.min(dist, WALK_SPEED * dt);
          const nx = v.x + (dx / dist) * step;
          const ny = v.y + (dy / dist) * step;
          // The way was open when it was found; if a tile shut since, stand a moment and think again.
          if (this.isWalkable(Math.floor(nx), Math.floor(ny))) {
            v.x = nx;
            v.y = ny;
            v.walkClock += step * CYCLES_PER_TILE;
            v.dir = stableDir(dx / dist, dy / dist, v.dir);
          } else {
            v.path.length = 0;
            v.pause = 0.6 + Math.random() * 1.2;
          }
        }
      }
      const walking = v.pause <= 0;
      const frame = walking ? Math.floor(v.walkClock * v.fc) : 0;
      v.body.texture = spriteLib.frame(v.anim, v.dir, frame);
      v.body.scale.y = (v.scale / 0.8) * (walking ? 1 : 1 + Math.sin(v.idleClock * 1.6) * 0.015);
      const s = worldToScreen(v.x, v.y, this.scratch);
      v.root.position.set(s.x, s.y);
      v.root.zIndex = depthKey(v.x, v.y);
      v.body.tint = mulTint(tint(v.x, v.y), v.coat);
      tickBubble(v.bubble, dt, this.opts.chatter, s.x, s.y - FOLK_HEIGHT * 0.8 - 6, v.root.zIndex);
    }
    const vendorWords = this.opts.vendorWords ?? (this.opts.chatter ? VENDOR_WORDS : undefined);
    if (this.merchant) {
      this.merchant.clock += dt;
      this.merchant.body.scale.y = this.merchant.scale * (1 + Math.sin(this.merchant.clock * 1.4) * 0.02);
      tickBubble(this.merchant.bubble, dt, vendorWords, this.merchant.body.position.x, this.merchant.body.position.y - 60, this.merchant.body.zIndex);
    }
    if (this.alchemist) {
      this.alchemist.clock += dt;
      this.alchemist.body.scale.y = this.alchemist.scale * (1 + Math.sin(this.alchemist.clock * 1.3) * 0.02);
      tickBubble(this.alchemist.bubble, dt, vendorWords, this.alchemist.body.position.x, this.alchemist.body.position.y - 60, this.alchemist.body.zIndex);
    }
    const guardWords = this.opts.guardWords ?? (this.opts.chatter ? GUARD_WORDS : undefined);
    if (this.guards.length && spriteLib.hasAnim(GUARD_IDLE)) {
      const gfc = spriteLib.anim(GUARD_IDLE).frameCount;
      for (const g of this.guards) {
        g.clock += dt;
        g.body.texture = spriteLib.frame(GUARD_IDLE, 6, Math.floor(g.clock * 6) % gfc);
        g.body.tint = tint(g.x, g.y);
        tickBubble(g.bubble, dt, guardWords, g.body.position.x, g.body.position.y - 66, g.body.zIndex);
      }
    }
    if (this.keeper && spriteLib.hasAnim(this.keeperAnim)) {
      const k = this.keeper;
      const KA = this.keeperAnim;
      k.clock += dt;
      if (KA === KEEPER_IDLE) k.body.texture = spriteLib.frame(KA, 5, Math.floor(k.clock * 5) % spriteLib.anim(KA).frameCount);
      else k.body.scale.y = k.body.scale.x * (1 + Math.sin(k.clock * 1.5) * 0.02); // The innkeeper breathes (a walk sheet has no idle).
      k.body.tint = tint(k.x, k.y);
      tickBubble(k.bubble, dt, this.opts.chatter, k.body.position.x, k.body.position.y - 68, k.body.zIndex);
    }
  }

  destroy(): void {
    for (const v of this.folk) {
      v.root.destroy({ children: true });
      v.bubble.node.destroy({ children: true });
    }
    this.folk.length = 0;
    this.merchant?.body.destroy();
    this.merchant?.bubble.node.destroy({ children: true });
    this.merchant = null;
    this.alchemist?.body.destroy();
    this.alchemist?.bubble.node.destroy({ children: true });
    this.alchemist = null;
    for (const g of this.guards) {
      g.body.destroy();
      g.bubble.node.destroy({ children: true });
    }
    this.guards.length = 0;
    this.keeper?.body.destroy();
    this.keeper?.bubble.node.destroy({ children: true });
    this.keeper = null;
  }
}
