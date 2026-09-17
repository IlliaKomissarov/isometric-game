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
 * THE TAPROOM'S REGULARS (it.99, put back it.115). These four wander in
 * circles, which reads as drinkers moving between tables indoors and as
 * aimless milling out on the street - so they are kept to the inn. it.114
 * swapped two of them for the labourer and the fencer and the owner asked,
 * loudly, why the lurkers in the tavern had been replaced. They are the
 * original four again: the Villager_01 body, the peasant, the merchant's
 * rig and the poacher. (Two of them are pixel sheets - the taproom is the one
 * room where the owner wants THESE people, not the separation rule.)
 */
export const TAVERN_FOLK: ReadonlyArray<FolkSheet> = [
  { anim: 'folk_walk', feet: true, height: 56 },
  { anim: 'villager_walk', feet: false, height: 58 },
  { anim: 'merchant_walk', feet: false, height: 58 },
  { anim: 'poacher_walk', feet: true, height: 58 },
];
/**
 * TWO TOWNS, SEPARATED FOR REAL (it.115).
 *
 * it.114 split the folk into "street" and "market" rosters and still left the
 * pixel citizens walking the old quarter beside the smooth vendors and guards -
 * "I still see low-poly NPCs next to high-poly ones". The rule is STRICT now
 * and it is by SHEET, not by district name:
 *
 *   SMOOTH_FOLK  the pre-rendered bodies (ten-to-sixteen-frame turntables):
 *                the labourer, his blue-grey re-dye the carter, the Villager_01
 *                body and the poacher. They walk the OLD QUARTER, the MARKET
 *                WARD, the open country past the gates - everywhere the
 *                vendors (smooth), the guards (smooth) and the keeper (smooth)
 *                stand. The armoured women of the duelist pack and the
 *                halberdier are NOT townsfolk and walk no street at all.
 *   PIXEL_FOLK   the chunky 34x60 composited citizens, the peasant and the
 *                merchant's rig. No street of the city: the eastern quarter
 *                borders the old one and keeps a smooth innkeeper, so it walks
 *                the smooth roster too. The pixel side is OSCAR'S BANK - the
 *                riverside farm, whose household are pixel citizens and whose
 *                walkers and near anglers are drawn to match (`RIVER_FOLK`).
 *                The taproom is the one room that mixes, by the owner's word:
 *                its four regulars are `TAVERN_FOLK`, exactly.
 *
 * `trader_walk` is a pixel re-dye too, but it is ONE man's livery (the
 * merchant out of the manor closet, it.111) and is not dealt to a roster;
 * `isPixelSheet` still classes it with the pixel side.
 */
export const SMOOTH_FOLK: ReadonlyArray<FolkSheet> = [
  // THE LABOURER (it.99): the one genuine eight-direction civilian in the packs -
  // a bare-armed man in a rust tunic, and the same man in a colder blue-grey re-dye.
  { anim: 'cit_labourer_walk', feet: true, height: 58 },
  { anim: 'cit_carter_walk', feet: true, height: 58 },
  { anim: 'folk_walk', feet: true, height: 56 },
  { anim: 'poacher_walk', feet: true, height: 58 },
];
export const PIXEL_FOLK: ReadonlyArray<FolkSheet> = [
  { anim: 'cit_farmer_walk', feet: true, height: 57 },
  { anim: 'cit_porter_walk', feet: true, height: 57 },
  { anim: 'cit_monk_walk', feet: true, height: 58 },
  { anim: 'cit_goodwife_walk', feet: true, height: 56 },
  { anim: 'cit_maid_walk', feet: true, height: 56 },
  { anim: 'villager_walk', feet: false, height: 58 },
  { anim: 'merchant_walk', feet: false, height: 58 },
];
/**
 * OSCAR'S BANK (it.115): the riverside farm is the pixel household's own, so its
 * walkers are the five composited citizens (the peasant and the merchant's rig
 * are drawn too small to stand beside them).
 */
export const RIVER_FOLK: ReadonlyArray<FolkSheet> = PIXEL_FOLK.slice(0, 5);
/** The pixel side of the line, by sheet name (the trader's livery included). */
const PIXEL_SHEETS: ReadonlySet<string> = new Set([...PIXEL_FOLK.map((f) => f.anim), 'trader_walk']);
export function isPixelSheet(anim: string): boolean {
  return PIXEL_SHEETS.has(anim);
}
/** THE OLD NAMES (it.114) still compile: both the old quarter's roster and the ward's are the smooth one now. */
export const STREET_FOLK: ReadonlyArray<FolkSheet> = SMOOTH_FOLK;
export const MARKET_FOLK: ReadonlyArray<FolkSheet> = SMOOTH_FOLK;
/** Coats, aprons and cloaks: a colour per walker, multiplied into the scene's light. */
const FOLK_COATS: readonly number[] = [0xffffff, 0xe8d0b0, 0xc8d8e8, 0xd8c8e0, 0xe0d8b0, 0xc0d8c0, 0xf0d0c0, 0xd0d0d8];
/**
 * PERSONAL SPACE (it.102, made real it.107).
 *
 * `FOLK_SPACING` is the hard floor - closer than this and the shoulder pass at
 * the bottom of `update` prises them apart. It was 0.66, which is well inside
 * the width of a drawn body, so two of the folk could stand visibly inside one
 * another and still be "apart" by the rule.
 *
 * `FOLK_PERSONAL` is the wider radius they STEER out of, and it is the half that
 * was missing. Up to it.106 the folk each walked their own A* road knowing
 * nothing about anybody else, and the only thing keeping them off each other was
 * a positional shove applied after the fact - so they walked into each other,
 * overlapped, and were slowly pushed out again, every time. The squad learned
 * this in it.103; the town's people learn it here. The point is to never REACH
 * the shoulder pass.
 */
const FOLK_SPACING = 0.92;
const FOLK_PERSONAL = 1.45;
/** How hard a neighbour bends a walker's heading (0 = none, 1 = straight away). */
const FOLK_AVOID = 0.75;
/**
 * THE HERO HAS RIGHT OF WAY (it.115). "NPCs constantly crash into each other
 * and block paths": a walker whose road the hero is standing on, or who is
 * about to walk into the hero, STOPS - for up to `HERO_WAIT` seconds - and
 * shuffles half a tile to the side of its heading, away from the hero, so
 * the way is open. If the hero is still there when the wait runs out, the
 * errand is dropped and a new one found from wherever the walker stands.
 * `HERO_YIELD` is how close, in tiles, to the walker or to the point a step
 * ahead of it on its path.
 */
const HERO_YIELD = 0.7;
const HERO_WAIT = 1.2;
const SIDESTEP = 0.45; // tiles moved aside while yielding
const SIDESTEP_SPEED = 0.9; // tiles / s
/**
 * BLOCKED IS NOT STANDING (it.115). A walker whose feet have not moved for
 * `STUCK_LIMIT` seconds while it was supposed to be walking - two of them
 * head-on in a lane, one pinned against a cask by a neighbour's shove - drops
 * its road and paths again from where it is, instead of shoving for ever.
 */
const STUCK_LIMIT = 2;
/** Row width of the `dests` key: wider than any floor in the game. */
const DEST_W = 1024;
const GUARD_IDLE = 'poacher_idle';
/** The gatekeeper wears the guard's mail (it.87). */
const KEEPER_IDLE = 'guard_idle';
/**
 * THE VENDORS ARE SMOOTH TOO (it.115). The armourer used to be drawn on
 * `merchant_walk` and the alchemist on `villager_walk` - both pixel sheets -
 * behind stalls in districts whose every walker is a smooth render. The
 * armourer wears the carter's blue-grey now (tinted by the ward if it asks),
 * the alchemist the Villager_01 body dyed violet. The old sheets are the
 * fallback when the new ones are not resident.
 */
const MERCHANT_BODY = 'cit_carter_walk';
const ALCHEMIST_BODY = 'folk_walk';

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
/**
 * THE RIVERSIDE FARM (it.106, given a voice it.108).
 *
 * it.106's nine lines were pleasant and said nothing: "quiet water today", "the
 * nets are set". Nobody on this bank had been robbed at knifepoint that morning
 * to hear them talk. These are the people the hero found against a barn wall
 * with three of the free company counting their coin, and they are Oscar's own
 * household and neighbours - so they talk about THAT, about the river they live
 * off, and about the bridge up-river, which since it.110 is a road the city
 * keeps rather than a fire nobody talks about. The three lines that used to say
 * the span had burned are gone with the span that had: the bridge STANDS, it has
 * two knights on it, and what the household says about it is what people who
 * live beside a garrisoned crossing actually say.
 *
 * Split in three so the bank does not sound like one person: what the household
 * says, what the anglers say, and what any of them might say in passing.
 */
export const RIVER_WORDS = [
  // The morning itself, still close.
  'Three of them. Three, and he would not give them the boat.',
  'I have not put the shutters back yet. I keep thinking I will need them.',
  'The girl still runs inside when a cart comes up the track.',
  'They took the seed corn in the spring. There was nothing left to take.',
  'They came down the river, not the road. That is how nobody saw them.',
  // The river, and the living got from it.
  'The nets are set. Good current this morning.',
  'Perch are running. They always run after a cold night.',
  'Mind the jetty - it is slick where the planks have gone green.',
  'That deep bend past the reeds is where the big ones sit.',
  'We eat what the water gives us. It has been generous lately.',
  // The bridge up the track, and the ground on the other side of it.
  'The watch put two men back on the span the week the fields were taken.',
  'Nobody crosses without leave in writing. I have watched them turn a carter round.',
  'Oscar has his grandfather\u2019s seal, and that is the only paper on this bank worth anything.',
  'Do not go over there for the walk. There was a battle on that ground and it is still on it.',
  // And the hero.
  'You are welcome at this fire whenever you want it.',
  'We owe you the roof over us, and he knows it.',
  'Stay and rest. Nobody on this bank will ask you a thing.',
];

/** LORD MILK on her yard (it.115): a word to whoever is passing. */
export const MILK_WORDS = ['Guard up.', 'Again. Slower.', 'The dummies are waiting.', 'Feet, then blade.', 'Talk to me if you want the yard.', 'Shield first.'];

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
  /**
   * DOORWAYS ARE NOT FOR STANDING IN (it.115): tiles (an inn's door, a
   * house's threshold, a gateway) no walker picks as the end of an errand,
   * nor any tile within one step of them.
   */
  keepClear?: ReadonlyArray<{ x: number; y: number }>;
  /**
   * PEOPLE WHO STAND (it.115): named bodies on an idle loop - LORD MILK on the
   * training ground is the first. They breathe on their own sheet's idle, face
   * where they are told, cast a shadow, and the walkers steer round them.
   */
  figures?: ReadonlyArray<StandingFigure>;
}

/** A named body standing at its post on its own idle sheet (it.115). */
export interface StandingFigure {
  /** Tile (the body stands on its centre). */
  x: number;
  y: number;
  anim: AnimName;
  /** Painted height on screen, px (the hero is 56). */
  height: number;
  /** Canonical facing: 0 E, 2 N, 4 W, 6 S (screen). */
  dir: number;
  /** A dye multiplied into the scene light (white: none). */
  tint?: number;
  /** Idle frames per second. */
  fps?: number;
  /** A bank of words over the head now and then (none: silent). */
  words?: string[];
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

const BUBBLE_LIFE = 3.4; // 2.2 until it.114: a line should outlast the glance that found it.

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
  /** Seconds left standing aside for the hero (it.115); 0 when walking normally. */
  yield: number;
  /** The sidestep taken while yielding: a unit heading and the distance still to go. */
  sideX: number;
  sideY: number;
  sideLeft: number;
  /** Seconds the feet have not moved while the walker was meant to be walking. */
  stuck: number;
  /** The destination tile this walker holds (`dests`), or -1 (it.115: no two share one). */
  dest: number;
  /** How far the current waypoint was at the top of the frame (the stuck test, it.115). */
  gap: number;
  /** Whether the feet moved under the walker's own power this frame (walk frames or the stand). */
  moving: boolean;
}

interface Figure {
  root: Container;
  body: Sprite;
  spec: StandingFigure;
  scale: number;
  clock: number;
  x: number;
  y: number;
  bubble: Bubble;
}

/** A hero's feet, as the walkers see them (it.115). */
export interface HeroFeet {
  x: number;
  y: number;
}

/**
 * EVERY DISTRICT SEES EVERY OTHER (it.115). The old quarter, the market ward
 * and the eastern quarter are three `Villagers`, and their streets meet: a
 * walker of one used to walk straight through a walker of the other, because
 * each only knew its own. The live instances are listed here and the steering
 * and the shoulder pass read all of them.
 */
const LIVE = new Set<Villagers>();
/** Closer than this to a body that never moves, a walker is pushed out (it.115). */
const FIXED_SPACING = 0.95;
/** The radius a walker steers out of round a body that never moves. */
const FIXED_PERSONAL = 1.6;
/** How strongly a walker keeps to its own right of an oncoming body. */
const KEEP_RIGHT = 0.9;

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
  /** The vendors' sheets, as drawn (it.115). */
  private merchantAnim: AnimName = MERCHANT_BODY;
  private alchemistAnim: AnimName = ALCHEMIST_BODY;
  /** The object layer these people live in, kept so more can be taken in later (it.104). */
  private readonly layer: Container;
  /** Destination tiles currently held by a walker (it.115): `y * DEST_W + x`. */
  private readonly dests = new Set<number>();
  /** The bodies that never move (vendors, sentries, the keeper): the walkers steer round them too (it.115). */
  private readonly fixed: Array<{ x: number; y: number }> = [];
  /** Their tiles, which no errand's road crosses (`y * DEST_W + x`). */
  private readonly fixedTiles = new Set<number>();
  /** The standing, named bodies (it.115). */
  private readonly figures: Figure[] = [];
  /** The heroes' feet this frame (it.115): errands avoid them, walkers yield to them. */
  private heroes: ReadonlyArray<HeroFeet> = [];

  constructor(
    layer: Container,
    private readonly isWalkable: (gx: number, gy: number) => boolean,
    /** Where these people live. It GROWS when a procession is handed over (it.104). */
    private area: Room,
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
    this.layer = layer;
    this.keeperAnim = (opts.keeperAnim && spriteLib.hasAnim(opts.keeperAnim) ? opts.keeperAnim : KEEPER_IDLE) as AnimName;
    // Only the sheets this floor actually loaded are on the street (it.98).
    const sheets = (opts.sheets ?? TAVERN_FOLK).filter((f) => spriteLib.hasAnim(f.anim));
    if (sheets.length) {
      for (let i = 0; i < count; i++) {
        // Set down on a free verge; a patch with none left (a small room, a
        // crowded yard) takes any open tile, and a patch with no open tile at
        // all takes nobody (it.115).
        const p = this.randomTile() ?? this.anyOpenTile();
        if (!p) break;
        this.dests.add(Math.floor(p.y) * DEST_W + Math.floor(p.x)); // Held while they stand on it.
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
        // FEET ON THE GROUND (it.104): computed from the sheet's painted bounds
        // rather than guessed at 1 or 0.86, so nobody floats and nobody sinks.
        const fa = spriteLib.footAnchor(sheet.anim);
        body.anchor.set(fa.x, fa.y);
        body.scale.set(scale / 0.8); // Undo the shadow root's scale.
        body.position.set(0, 2);
        root.addChild(body);
        layer.addChild(root);
        this.folk.push({ root, body, anim: sheet.anim, scale, fc: spriteLib.anim(sheet.anim).frameCount, coat: FOLK_COATS[(i * 3 + 1) % FOLK_COATS.length], x: p.x, y: p.y, tx: p.x, ty: p.y, pause: Math.random() * 3, dir: 6, walkClock: 0, idleClock: Math.random() * 10, bubble: makeBubble(layer, 2 + Math.random() * 10), path: [], yield: 0, sideX: 0, sideY: 0, sideLeft: 0, stuck: 0, dest: Math.floor(p.y) * DEST_W + Math.floor(p.x), gap: 0, moving: false });
      }
    }
    // THE ARMOURER (it.115): the carter's smooth body behind the stall; the merchant's pixel rig only if the carter is not resident.
    const MERCH: AnimName = spriteLib.hasAnim(MERCHANT_BODY) ? MERCHANT_BODY : 'merchant_walk';
    if (merchantAt && spriteLib.hasAnim(MERCH)) {
      this.merchantAnim = MERCH;
      const mp = spriteLib.paintedHeight(MERCH) || 57;
      const mscale = 62 / mp;
      const body = new Sprite(spriteLib.frame(MERCH, 6, 0));
      const fa = MERCH === MERCHANT_BODY ? spriteLib.footAnchor(MERCH) : { x: 0.5, y: 0.86 };
      body.anchor.set(fa.x, fa.y);
      body.scale.set(mscale);
      const s = worldToScreen(merchantAt.x + 0.5, merchantAt.y + 0.5, this.scratch);
      body.position.set(s.x, s.y + 2);
      body.zIndex = depthKey(merchantAt.x + 0.5, merchantAt.y + 0.5);
      if (tints.merchant) body.tint = tints.merchant;
      layer.addChild(body);
      this.merchant = { body, clock: 0, scale: mscale, bubble: makeBubble(layer, 4 + Math.random() * 8), x: merchantAt.x + 0.5, y: merchantAt.y + 0.5 };
      this.fixed.push({ x: this.merchant.x, y: this.merchant.y });
    }
    // The ALCHEMIST (it.49): a body in violet, not the merchant's twin. IT.115: the smooth Villager_01 body, the peasant only as a fallback.
    const ALCH: AnimName = spriteLib.hasAnim(ALCHEMIST_BODY) ? ALCHEMIST_BODY : spriteLib.hasAnim('villager_walk') ? 'villager_walk' : 'merchant_walk';
    if (alchemistAt && spriteLib.hasAnim(ALCH)) {
      this.alchemistAnim = ALCH;
      const mp = spriteLib.paintedHeight(ALCH) || 57;
      const mscale = 62 / mp;
      const body = new Sprite(spriteLib.frame(ALCH, 6, 0));
      const fa = ALCH === ALCHEMIST_BODY ? spriteLib.footAnchor(ALCH) : { x: 0.5, y: 0.86 };
      body.anchor.set(fa.x, fa.y);
      body.scale.set(mscale);
      body.tint = tints.alchemist ?? 0xb8a0ff; // Violet robes: the alchemist (the scribe's are ice-blue).
      const s = worldToScreen(alchemistAt.x + 0.5, alchemistAt.y + 0.5, this.scratch);
      body.position.set(s.x, s.y + 2);
      body.zIndex = depthKey(alchemistAt.x + 0.5, alchemistAt.y + 0.5);
      layer.addChild(body);
      this.alchemist = { body, clock: 0.9, scale: mscale, bubble: makeBubble(layer, 6 + Math.random() * 8), x: alchemistAt.x + 0.5, y: alchemistAt.y + 0.5 };
      this.fixed.push({ x: this.alchemist.x, y: this.alchemist.y });
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
        this.fixed.push({ x: at.x + 0.5, y: at.y + 0.5 });
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
      this.fixed.push({ x: this.keeper.x, y: this.keeper.y });
    }
    // PEOPLE WHO STAND (it.115): feet from the sheet's painted bounds, a shadow, an idle loop.
    for (const spec of opts.figures ?? []) {
      if (!spriteLib.hasAnim(spec.anim)) continue;
      const painted = spriteLib.paintedHeight(spec.anim) || 60;
      const scale = spec.height / painted;
      const root = new Container();
      const shadow = new Sprite(assets.get('shadow'));
      shadow.anchor.set(0.5, 0.5);
      shadow.alpha = 0.65;
      shadow.scale.set(0.9);
      root.addChild(shadow);
      const body = new Sprite(spriteLib.frame(spec.anim, spec.dir, 0));
      const fa = spriteLib.footAnchor(spec.anim);
      body.anchor.set(fa.x, fa.y);
      body.scale.set(scale);
      body.position.set(0, 2);
      root.addChild(body);
      const x = spec.x + 0.5;
      const y = spec.y + 0.5;
      const s = worldToScreen(x, y, this.scratch);
      root.position.set(s.x, s.y);
      root.zIndex = depthKey(x, y);
      layer.addChild(root);
      this.figures.push({ root, body, spec, scale, clock: Math.random() * 2, x, y, bubble: makeBubble(layer, 5 + Math.random() * 8) });
      this.fixed.push({ x, y });
    }
    for (const f of this.fixed) this.fixedTiles.add(Math.floor(f.y) * DEST_W + Math.floor(f.x));
    LIVE.add(this);
  }

  /** The first open tile of the patch, scanning from its centre outwards (it.115). */
  private anyOpenTile(): { x: number; y: number } | null {
    const cx = this.area.x + Math.floor(this.area.w / 2);
    const cy = this.area.y + Math.floor(this.area.h / 2);
    const R = Math.max(this.area.w, this.area.h);
    for (let r = 0; r <= R; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const gx = cx + dx;
          const gy = cy + dy;
          if (!this.isWalkable(gx, gy) || this.dests.has(gy * DEST_W + gx) || this.fixedTiles.has(gy * DEST_W + gx)) continue;
          return { x: gx + 0.5, y: gy + 0.5 };
        }
      }
    }
    return null;
  }

  /** A named standing body's feet (it.115), for the interaction and the harness. */
  figureAt(anim: AnimName): { x: number; y: number } | null {
    const f = this.figures.find((g) => g.spec.anim === anim);
    return f ? { x: f.x, y: f.y } : null;
  }

  /** Every head's place (it.92): the folk, the vendors, the keeper - so a roof or a trunk in front of them ghosts. */
  positions(): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (const v of this.folk) out.push({ x: v.x, y: v.y });
    if (this.merchant) out.push({ x: this.merchant.x, y: this.merchant.y });
    if (this.alchemist) out.push({ x: this.alchemist.x, y: this.alchemist.y });
    for (const g of this.guards) out.push({ x: g.x, y: g.y });
    if (this.keeper) out.push({ x: this.keeper.x, y: this.keeper.y });
    for (const f of this.figures) out.push({ x: f.x, y: f.y });
    return out;
  }

  /** The walkers alone (it.115, for the harness): where they are and what they are doing. */
  walkers(): Array<{ x: number; y: number; anim: string; state: 'walk' | 'yield' | 'stand' }> {
    return this.folk.map((v) => ({ x: v.x, y: v.y, anim: v.anim, state: v.pause > 0 ? 'stand' : v.yield > 0 ? 'yield' : 'walk' }));
  }

  /** Every sheet drawn by this district (it.115, the separation audit). */
  sheets(): string[] {
    const out = new Set<string>(this.folk.map((v) => v.anim));
    for (const f of this.figures) out.add(f.spec.anim);
    if (this.merchant) out.add(this.merchantAnim);
    if (this.alchemist) out.add(this.alchemistAnim);
    if (this.guards.length) out.add(GUARD_IDLE);
    if (this.keeper) out.add(this.keeperAnim);
    return [...out];
  }

  /** The keeper's tile centre (it.91): where a word bubble or a portrait looks for them. */
  get keeperAt(): { x: number; y: number } | null {
    return this.keeper ? { x: this.keeper.x, y: this.keeper.y } : null;
  }

  /**
   * WHERE AN ERRAND ENDS (it.92; it.115). The folk still WALK the streets -
   * the road is how the path-finder gets them anywhere - but an errand no
   * longer ENDS in one: three in four end on a VERGE (an open tile beside a
   * street), so somebody stopped for a chat is stood at the roadside and not
   * in the hero's way. No errand ends on a tile another walker holds, or on
   * or beside a doorway (`keepClear`). Null when nothing qualifies.
   */
  private randomTile(): { x: number; y: number } | null {
    const roads = this.opts.roads;
    const W = this.opts.mapWidth ?? 0;
    const hasRoads = !!roads && W > 0;
    const onRoad = (x: number, y: number): boolean => hasRoads && x >= 0 && y >= 0 && x < W && !!roads![y * W + x];
    const wantVerge = hasRoads && Math.random() < 0.75;
    const clear = this.opts.keepClear;
    for (let i = 0; i < 80; i++) {
      const gx = this.area.x + Math.floor(Math.random() * this.area.w);
      const gy = this.area.y + Math.floor(Math.random() * this.area.h);
      if (!this.isWalkable(gx, gy)) continue;
      if (this.dests.has(gy * DEST_W + gx) || this.fixedTiles.has(gy * DEST_W + gx)) continue;
      if (clear && clear.some((d) => Math.abs(d.x - gx) <= 1 && Math.abs(d.y - gy) <= 1)) continue;
      // Not beside anybody who never moves, and not where a hero stands (it.115).
      if (this.fixed.some((f) => Math.abs(f.x - gx - 0.5) < 1.6 && Math.abs(f.y - gy - 0.5) < 1.6)) continue;
      if (this.heroes.some((h) => Math.hypot(h.x - gx - 0.5, h.y - gy - 0.5) < 2)) continue;
      if (hasRoads && i < 70) {
        if (onRoad(gx, gy)) continue; // never stop IN the street
        if (wantVerge && !(onRoad(gx + 1, gy) || onRoad(gx - 1, gy) || onRoad(gx, gy + 1) || onRoad(gx, gy - 1))) continue;
      }
      return { x: gx + 0.5, y: gy + 0.5 };
    }
    return null;
  }

  /** Give a walker's held destination back (it.115). */
  private release(v: Villager): void {
    if (v.dest >= 0) this.dests.delete(v.dest);
    v.dest = -1;
  }

  /** Drop the errand and stand a moment; the next one is found from here (it.115). */
  private giveUp(v: Villager, wait: number): void {
    this.release(v);
    v.path.length = 0;
    v.tx = v.x;
    v.ty = v.y;
    v.pause = wait;
    v.stuck = 0;
  }

  /**
   * THE WAY (it.92): a breadth-first walk over open tiles from one tile to
   * another, inside the wander area grown by a margin. Render-only and
   * cheap (a few thousand tiles at most); null when there is no way.
   */
  private findPath(sx: number, sy: number, tx: number, ty: number): Array<{ x: number; y: number }> | null {
    const m = 3;
    // THE BOX FOLLOWS THE WALKER (it.104). The search box used to be the wander
    // area and nothing else, so a body standing OUTSIDE it could never find a
    // way anywhere - it sat still for ever, asking four times a second. That is
    // exactly what happened to a procession's folk when they were handed over:
    // a homecoming ends where the bars lift, which is halfway up the road, not
    // on the wander patch. The box is now the union of the area and both ends of
    // the walk, so somebody out on the road can always walk home.
    const x0 = Math.min(this.area.x, Math.floor(Math.min(sx, tx))) - m;
    const y0 = Math.min(this.area.y, Math.floor(Math.min(sy, ty))) - m;
    const w = Math.max(this.area.x + this.area.w, Math.ceil(Math.max(sx, tx))) + m - x0;
    const h = Math.max(this.area.y + this.area.h, Math.ceil(Math.max(sy, ty))) + m - y0;
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
        if (this.fixedTiles.has(ny * DEST_W + nx)) continue; // Nobody's road runs through a vendor (it.115).
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
  /**
   * A WALKER BECOMES A RESIDENT (it.104). A procession's folk used to be left
   * standing exactly where the bars lifted, for ever - twelve people frozen
   * mid-stride in a forest clearing is the first thing you see when a homecoming
   * ends. The scene hands them over instead: each one is re-made here as one of
   * the district's own, on the spot it arrived at, and from its next tick it
   * paths, wanders, pauses and talks like anybody else who lives here.
   */
  /** How many of the district's own are on the street (it.104, for the harness). */
  get count(): number {
    return this.folk.length;
  }


  adopt(at: { x: number; y: number }, anim: AnimName, coat: number): boolean {
    if (!spriteLib.hasAnim(anim)) return false;
    // THIS IS WHERE THEY LIVE NOW (it.104). A floor that was not expecting anyone
    // carries a placeholder wander patch - the un-cleared forest's is literally
    // one tile at the origin, inside a wall - so a body handed over to it could
    // never find anywhere to walk and stood still for ever. The patch grows to
    // take in whoever arrives: the clearing they came home to IS their ground.
    const box = { x: Math.max(0, Math.floor(at.x) - 5), y: Math.max(0, Math.floor(at.y) - 5), w: 11, h: 11 };
    if (this.area.w * this.area.h <= 1) this.area = box;
    else {
      const x1 = Math.max(this.area.x + this.area.w, box.x + box.w);
      const y1 = Math.max(this.area.y + this.area.h, box.y + box.h);
      this.area = { x: Math.min(this.area.x, box.x), y: Math.min(this.area.y, box.y), w: 0, h: 0 };
      this.area.w = x1 - this.area.x;
      this.area.h = y1 - this.area.y;
    }
    const painted = spriteLib.paintedHeight(anim) || 50;
    const i = this.folk.length;
    const sheet = (this.opts.sheets ?? TAVERN_FOLK).find((f) => f.anim === anim);
    const scale = ((sheet?.height ?? FOLK_HEIGHT) / painted) * (0.94 + ((i * 5) % 7) * 0.02);
    const root = new Container();
    root.scale.set(0.8);
    const shadow = new Sprite(assets.get('shadow'));
    shadow.anchor.set(0.5, 0.5);
    shadow.alpha = 0.6;
    root.addChild(shadow);
    const body = new Sprite(spriteLib.frame(anim, 6, 0));
    const fa = spriteLib.footAnchor(anim);
    body.anchor.set(fa.x, fa.y);
    body.scale.set(scale / 0.8);
    body.position.set(0, 2);
    root.addChild(body);
    this.layer.addChild(root);
    this.folk.push({
      root, body, anim, scale, fc: spriteLib.anim(anim).frameCount, coat,
      x: at.x, y: at.y, tx: at.x, ty: at.y,
      // A staggered first pause, so the crowd does not all set off on one tick.
      pause: 0.5 + Math.random() * 3.5,
      dir: 6, walkClock: 0, idleClock: Math.random() * 10,
      bubble: makeBubble(this.layer, 3 + Math.random() * 10), path: [],
      yield: 0, sideX: 0, sideY: 0, sideLeft: 0, stuck: 0, dest: -1, gap: 0, moving: false,
    });
    return true;
  }

  /**
   * A NEW ERRAND (it.92; it.115): a held, free destination, a road to it that
   * does not open by walking through a hero, and the old destination given
   * back. False when nothing was found (the walker stands a moment longer).
   */
  private newErrand(v: Villager): boolean {
    for (let tries = 0; tries < 5; tries++) {
      const t = this.randomTile();
      if (!t) continue;
      if (Math.hypot(t.x - v.x, t.y - v.y) < 2) continue;
      const path = this.findPath(Math.floor(v.x), Math.floor(v.y), Math.floor(t.x), Math.floor(t.y));
      if (!path || !path.length) continue;
      // The first steps of the road must not run through a hero's feet.
      if (this.heroes.some((h) => path.slice(0, 3).some((n) => Math.hypot(n.x - h.x, n.y - h.y) < 0.8))) continue;
      this.release(v);
      v.dest = Math.floor(t.y) * DEST_W + Math.floor(t.x);
      this.dests.add(v.dest);
      v.path = path;
      v.tx = path[0].x;
      v.ty = path[0].y;
      v.stuck = 0;
      v.gap = Math.hypot(v.tx - v.x, v.ty - v.y);
      return true;
    }
    return false;
  }

  /**
   * IS A HERO IN THIS WALKER'S WAY (it.115)? Near the walker itself, near the
   * point a step ahead of it on its heading, or standing on its next waypoint.
   * Returns that hero, or null.
   */
  private heroInWay(v: Villager, walking: boolean): HeroFeet | null {
    for (const h of this.heroes) {
      const hx = h.x - v.x;
      const hy = h.y - v.y;
      const d = Math.hypot(hx, hy);
      if (d < HERO_YIELD) return h;
      if (!walking) continue;
      const dx = v.tx - v.x;
      const dy = v.ty - v.y;
      const dl = Math.hypot(dx, dy) || 1;
      const ux = dx / dl;
      const uy = dy / dl;
      if (hx * ux + hy * uy <= 0) continue; // Behind: the walker is leaving it.
      if (Math.hypot(v.x + ux * 0.9 - h.x, v.y + uy * 0.9 - h.y) < HERO_YIELD) return h;
      if (Math.hypot(v.tx - h.x, v.ty - h.y) < 0.55 && d < 2.5) return h;
    }
    return null;
  }

  /** Stand aside: to the side of the heading that is away from the hero, if that ground is open. */
  private startYield(v: Villager, h: HeroFeet): void {
    v.yield = HERO_WAIT;
    const dx = v.tx - v.x;
    const dy = v.ty - v.y;
    const dl = Math.hypot(dx, dy);
    // A standing walker (or one on its waypoint) simply backs away from the hero.
    let px = dl > 0.05 ? -dy / dl : v.x - h.x;
    let py = dl > 0.05 ? dx / dl : v.y - h.y;
    const pl = Math.hypot(px, py) || 1;
    px /= pl;
    py /= pl;
    if (px * (v.x - h.x) + py * (v.y - h.y) < 0) {
      px = -px;
      py = -py;
    }
    const open = (sx: number, sy: number): boolean => this.isWalkable(Math.floor(v.x + sx * SIDESTEP), Math.floor(v.y + sy * SIDESTEP));
    if (open(px, py)) {
      v.sideX = px;
      v.sideY = py;
      v.sideLeft = SIDESTEP;
    } else if (open(-px, -py) && Math.hypot(v.x - px * SIDESTEP - h.x, v.y - py * SIDESTEP - h.y) >= HERO_YIELD) {
      v.sideX = -px;
      v.sideY = -py;
      v.sideLeft = SIDESTEP;
    } else v.sideLeft = 0;
  }

  /** Every walker of every live district but this one (it.115). */
  private *neighbours(v: Villager): Generator<Villager> {
    for (const vs of LIVE) for (const o of vs.folk) if (o !== v) yield o;
  }

  update(dt: number, tint: (x: number, y: number) => number, heroes: ReadonlyArray<HeroFeet> = []): void {
    this.heroes = heroes;
    for (const v of this.folk) {
      v.moving = false;
      const walking = v.pause <= 0;
      const threat = heroes.length ? this.heroInWay(v, walking && v.yield <= 0) : null;
      if (v.yield > 0 || (threat && (walking || Math.hypot(threat.x - v.x, threat.y - v.y) < HERO_YIELD))) {
        // ---- THE HERO HAS RIGHT OF WAY (it.115) ------------------------------
        if (v.yield <= 0 && threat) this.startYield(v, threat);
        v.yield -= dt;
        v.idleClock += dt;
        if (v.sideLeft > 0) {
          const m = Math.min(v.sideLeft, SIDESTEP_SPEED * dt);
          const nx = v.x + v.sideX * m;
          const ny = v.y + v.sideY * m;
          if (this.isWalkable(Math.floor(nx), Math.floor(ny))) {
            v.x = nx;
            v.y = ny;
            v.sideLeft -= m;
            v.walkClock += m * CYCLES_PER_TILE;
            v.moving = true;
            v.dir = stableDir(v.sideX, v.sideY, v.dir);
          } else v.sideLeft = 0;
        }
        if (v.yield <= 0) {
          v.yield = 0;
          const still = heroes.length ? this.heroInWay(v, walking) : null;
          if (still) {
            // Still there: this road is not happening. Stand a beat and find another.
            this.giveUp(v, 0.3 + Math.random() * 0.6);
          } else if (!walking) {
            v.pause = Math.max(v.pause, 0.2);
          }
          v.gap = Math.hypot(v.tx - v.x, v.ty - v.y);
          v.stuck = 0;
        }
        continue;
      }
      if (!walking) {
        v.pause -= dt;
        v.idleClock += dt;
        if (v.pause <= 0 && !this.newErrand(v)) v.pause = 0.8 + Math.random() * 1.5;
        continue;
      }
      const dx = v.tx - v.x;
      const dy = v.ty - v.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.12) {
        v.path.shift();
        if (v.path.length) {
          v.tx = v.path[0].x;
          v.ty = v.path[0].y;
          v.gap = Math.hypot(v.tx - v.x, v.ty - v.y);
        } else v.pause = 1.2 + Math.random() * 3.5;
        continue;
      }
      v.gap = dist;
      const step = Math.min(dist, WALK_SPEED * dt);
      // ---- GIVE WAY (it.107, it.115) ---------------------------------------
      // A repulsion off every neighbour inside `FOLK_PERSONAL` - the walkers of
      // every district, and the bodies that never move - weighted by how far
      // inside it they are, blended into the heading BEFORE the step is taken.
      // A body AHEAD also bends the walker to its own right (it.115): two people
      // meeting head-on used to push straight back at each other and stall; now
      // each passes on its own right, which is the other's left, and they part.
      let ux = dx / dist;
      let uy = dy / dist;
      let sx = 0;
      let sy = 0;
      const feel = (ox: number, oy: number, radius: number, weight: number): void => {
        const rx = v.x - ox;
        const ry = v.y - oy;
        const od = Math.hypot(rx, ry);
        if (od >= radius) return;
        if (od < 1e-4) {
          sx += 1;
          return;
        }
        const push = ((radius - od) / radius) * weight;
        sx += (rx / od) * push;
        sy += (ry / od) * push;
        const ahead = -(rx * ux + ry * uy) / od; // cos of the angle to the body, 1 = dead ahead
        if (ahead > 0.3) {
          sx += -uy * push * KEEP_RIGHT * ahead;
          sy += ux * push * KEEP_RIGHT * ahead;
        }
      };
      for (const o of this.neighbours(v)) feel(o.x, o.y, FOLK_PERSONAL, 1);
      for (const vs of LIVE) for (const f of vs.fixed) feel(f.x, f.y, FIXED_PERSONAL, 1.2);
      const sl = Math.hypot(sx, sy);
      if (sl > 1e-4) {
        const w = FOLK_AVOID * Math.min(1.4, sl);
        ux += (sx / sl) * w;
        uy += (sy / sl) * w;
        const n = Math.hypot(ux, uy) || 1;
        ux /= n;
        uy /= n;
      }
      // Never steer backwards along the road: that is how two walkers dance.
      if (ux * dx + uy * dy < 0) {
        const px = -dy / dist;
        const py = dx / dist;
        const side = ux * px + uy * py >= 0 ? 1 : -1;
        ux = px * side;
        uy = py * side;
      }
      const nx = v.x + ux * step;
      const ny = v.y + uy * step;
      if (this.isWalkable(Math.floor(nx), Math.floor(ny))) {
        v.x = nx;
        v.y = ny;
      } else if (this.isWalkable(Math.floor(v.x + ux * step), Math.floor(v.y))) {
        // Slide along whatever is in the way rather than stopping dead.
        v.x += ux * step;
      } else if (this.isWalkable(Math.floor(v.x), Math.floor(v.y + uy * step))) {
        v.y += uy * step;
      } else {
        this.giveUp(v, 0.6 + Math.random() * 1.2);
        continue;
      }
      v.walkClock += step * CYCLES_PER_TILE;
      v.moving = true;
      v.dir = stableDir(dx / dist, dy / dist, v.dir);
    }
    // NO TWO OF THEM IN THE SAME PLACE (it.102). Every villager walks an A* road
    // of its own and none of them knew about the others, so two who took the same
    // corner stood inside one another and read as a single body with a rendering
    // fault. IT.107: twice, not once. IT.115: against every district's walkers
    // (each district moves only its own, so a pair across two moves half each),
    // and against the bodies that never move (the walker takes the whole push).
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.folk.length; i++) {
        const a = this.folk[i];
        for (const vs of LIVE) {
          const own = vs === this;
          for (let j = own ? i + 1 : 0; j < vs.folk.length; j++) {
            const b = vs.folk[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let d = Math.hypot(dx, dy);
            if (d >= FOLK_SPACING) continue;
            if (d === 0) {
              dx = own ? -1 : 1;
              dy = 0;
              d = 1;
            }
            const push = (FOLK_SPACING - d) / 2;
            const ux = dx / d;
            const uy = dy / d;
            if (this.isWalkable(Math.floor(a.x - ux * push), Math.floor(a.y - uy * push))) {
              a.x -= ux * push;
              a.y -= uy * push;
            }
            if (own && this.isWalkable(Math.floor(b.x + ux * push), Math.floor(b.y + uy * push))) {
              b.x += ux * push;
              b.y += uy * push;
            }
          }
          for (const f of vs.fixed) {
            const dx = a.x - f.x;
            const dy = a.y - f.y;
            const d = Math.hypot(dx, dy);
            if (d >= FIXED_SPACING) continue;
            const ux = d > 1e-4 ? dx / d : 1;
            const uy = d > 1e-4 ? dy / d : 0;
            const push = FIXED_SPACING - d;
            if (this.isWalkable(Math.floor(a.x + ux * push), Math.floor(a.y + uy * push))) {
              a.x += ux * push;
              a.y += uy * push;
            }
          }
        }
      }
    }
    // BLOCKED IS NOT STANDING (it.115): no ground made on the waypoint for
    // `STUCK_LIMIT` seconds of walking - drop the road and find another.
    for (const v of this.folk) {
      if (v.pause > 0 || v.yield > 0) continue;
      const gap = Math.hypot(v.tx - v.x, v.ty - v.y);
      if (v.gap - gap < WALK_SPEED * dt * 0.3) v.stuck += dt;
      else v.stuck = Math.max(0, v.stuck - dt * 2);
      if (v.stuck > STUCK_LIMIT) this.giveUp(v, 0.4 + Math.random() * 0.8);
    }
    for (const v of this.folk) {
      const walking = v.moving;
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
    for (const f of this.figures) {
      f.clock += dt;
      const fc = spriteLib.anim(f.spec.anim).frameCount;
      f.body.texture = spriteLib.frame(f.spec.anim, f.spec.dir, Math.floor(f.clock * (f.spec.fps ?? 8)) % fc);
      f.body.tint = mulTint(tint(f.x, f.y), f.spec.tint ?? 0xffffff);
      tickBubble(f.bubble, dt, f.spec.words, f.root.position.x, f.root.position.y - f.spec.height - 10, f.root.zIndex);
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
    for (const f of this.figures) {
      f.root.destroy({ children: true });
      f.bubble.node.destroy({ children: true });
    }
    this.figures.length = 0;
    LIVE.delete(this);
  }
}
