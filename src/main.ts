/**
 * @module main
 * Application bootstrap, the title screen, and the RUN lifecycle.
 *
 * BOOT (once per page): the Pixi app, procedural assets, the atlas
 * manifest + core singles, the gothic cursor, the main menu, settings.
 * RUN (`startRun`, any number of times per page — it.36): the Player, the
 * InputQueue, the DOM HUD, the GameLoop, every EventBus subscription and
 * UI panel. A run returns a handle whose `destroy()` tears ALL of it down,
 * so RESTART RUN / RETURN TO MAIN MENU / a different hero never need a
 * browser refresh.
 * PER-FLOOR (rebuilt by `buildWorld` inside a run): dungeon, viewport,
 * camera, lighting, ambience, props, loot, pathfinder, movement, combat,
 * projectiles, enemies, input bindings. Each floor's sprite atlases stream
 * in under the transition fade (lazy loading — see SpriteLibrary.ensure).
 */

import { installTouchGuards } from '@/core/touchGuards';
import { Application, Container, Graphics, Sprite, Text, ColorMatrixFilter, type Texture } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { MAP_H, MAP_W, MAX_DEPTH, PALETTE } from '@/core/config';
import { eventBus, type GameEvents } from '@/core/EventBus';
import { GameLoop } from '@/core/GameLoop';
import { InputBindings } from '@/core/InputBindings';
import { InputQueue, type InputCommand } from '@/core/InputQueue';
import { state } from '@/core/StateManager';
import { Ambience } from '@/engine/Ambience';
import { Camera } from '@/engine/Camera';
import { Lighting } from '@/engine/Lighting';
import { Viewport } from '@/engine/Viewport';
import { animsForKind, Enemy, PHASE_DIE_TICKS, PHASE_RISE_TICKS, type EnemyKind } from '@/entities/Enemy';
import { EnemyPool } from '@/entities/EnemyPool';
import { animsForHero, ARCHETYPES, Player, PLAYER_DEATH_TICKS } from '@/entities/Player';
import { TILE_BLOCKED, TILE_FLOOR, generateArenaMap, generateDungeon, planHearths, type DungeonMap, type Room } from '@/scenes/DungeonGenerator';
import { SkillSystem } from '@/systems/Skills';
import { CLASS_SKILLS, skillCost } from '@/systems/SkillTree';
import { LeaderboardUI } from '@/ui/LeaderboardPanel';
import { StatsManager } from '@/systems/StatsManager';
import { dressColiseum, generateColiseumMap, type ColiseumMap } from '@/scenes/Coliseum';
import { AFFIXES, FROST_AURA_RADIUS, LOOTER_KINDS } from '@/entities/Enemy';
import type { ClassArchetype } from '@/network/Serialization';
import type { GoldPile } from '@/scenes/Props';
import { placeProps, placeStairs, placeWaystone } from '@/scenes/Props';
import { SceneManager } from '@/scenes/SceneManager';
import { CombatSystem } from '@/systems/Combat';
import { InventorySystem } from '@/systems/Inventory';
import { LootSystem } from '@/systems/Loot';
import { MovementSystem, ATTACK_RANGE } from '@/systems/Movement';
import { Pathfinder } from '@/systems/Pathfinding';
import { ProjectileSystem } from '@/systems/Projectiles';
import { StateSyncSystem } from '@/systems/StateSync';
import { audio } from '@/engine/AudioManager';
import { InventoryUI } from '@/ui/Inventory';
import { hideItemTip, showItemTip, wornFor } from '@/ui/itemTip';
import { LevelSelectUI } from '@/ui/LevelSelect';
import { SettingsUI } from '@/ui/Settings';
import { MinimapUI } from '@/ui/Minimap';
import { TutorialUI } from '@/ui/Tutorial';
import { MainMenuUI } from '@/ui/MainMenu';
import { RunMenusUI } from '@/ui/RunMenus';
import type { Entity } from '@/entities/Entity';
import { ITEMS, overlayTextureFor, statLine, type ItemDef } from '@/items/catalog';
import { ilvlForDepth, itemDef, powerScale, rollGear } from '@/items/instance';
import { CraftingEngine } from '@/systems/Crafting';
import { StatusSystem } from '@/systems/Status';
import { QUAFF_COOLDOWN, quaffCategory } from '@/systems/Inventory';
import { decodeItemId } from '@/items/instance';
import { CampCraftingUI } from '@/ui/CampCrafting';
import { CodexUI } from '@/ui/Codex';
import type { EquipmentSlot } from '@/network/Serialization';
import { DamageTextSystem } from '@/render/DamageText';
import { spriteLib, uiAssetUrl, type AnimName } from '@/render/SpriteLibrary';
import { ChestSystem } from '@/systems/Chests';
import { CheatMenuUI } from '@/ui/CheatMenu';
import { itemIconHtml, itemIconTexture } from '@/ui/itemIcons';
import { lerpVec, vec2 } from '@/utils/Vec2';
import { worldToScreen } from '@/utils/iso';
import { mulberry32, randInt } from '@/utils/rng';
import { buildTownLayout, LOOTER_COUNT, type EastState, type TownLayout } from '@/town/TownMap';
import { GateFx, ProcessionScene } from '@/town/Reclaim';
import { buildInnLayout } from '@/scenes/Inn';
import { buildCellarLayout } from '@/scenes/Cellar';
import { buildFarmLayout } from '@/scenes/Farmlands';
import { placeTownProps, type Interactable, type Occluder, type TownDressing } from '@/town/TownProps';
import { buildForestLayout, bareLayout } from '@/scenes/Forest';
import { MINES_H, MINES_W, planMines, type MineDoor, type MineKey } from '@/scenes/Mines';
import { CrtFilter } from '@/render/CrtFilter';
import { asDifficultyId, DIFFICULTIES, DIFFICULTY_KEY, DIFFICULTY_ORDER, difficulty, readPreferredDifficulty, SPAWN_WARD_TICKS, type DifficultyId } from '@/core/Difficulty';
import { DialogueUI } from '@/ui/Dialogue';
import { shouldAutoStart, TutorialSystem, type PanelKind } from '@/tutorial/TutorialSystem';
import { unthrottledTimeout } from '@/core/workerTimer';
import type { TownMap } from '@/town/TownMap';
import { NoticeBoardUI } from '@/ui/NoticeBoard';
import { RECLAIMED_WORDS, REFUGEE_WORDS, STREET_FOLK, TAVERN_WORDS, TOWN_WORDS, Villagers } from '@/town/Villagers';
import { Squad } from '@/systems/Squad';
import { CampHeroes } from '@/town/CampHeroes';
import { VFX_ANIMS, VfxSystem } from '@/render/Vfx';
import { SkillTreeUI } from '@/ui/SkillTree';
import { CharacterSheetUI } from '@/ui/CharacterSheet';
import { BestiaryUI } from '@/ui/Bestiary';
import { GoreSystem } from '@/render/Gore';
import { hasLineOfSight } from '@/utils/los';
import { PARTY_COLORS, PARTY_COLOR_CSS, PARTY_MAX, type LinkState, type MemberInfo, type SnapshotPayload } from '@/net/PeerNet';
import { CATCH_UP_STEPS, Lockstep } from '@/net/Lockstep';
import { ClientStateSync, HostStateSync, encodeAllEnemies, type SyncWorld } from '@/net/StateSync';
import { ChatUI } from '@/ui/Chat';
import { CoopLobbyUI, type CoopStart } from '@/ui/CoopLobby';
import { TitleScreen } from '@/ui/TitleScreen';
import { LoadingScreen } from '@/ui/LoadingScreen';
import { layout } from '@/core/OrientationManager';
import { perf } from '@/core/PerformanceScaler';
import { haptics } from '@/core/Haptics';
import { uiIdleFrame } from '@/render/animUtil';
/** The screen layout, reachable inside `buildWorld`, where `layout` names a town plan. */
const screenLayout = layout;
import { touchControls, fullscreenButton } from '@/ui/TouchControls';
import { StatusFrame } from '@/ui/StatusFrame';
import { SystemBar } from '@/ui/SystemBar';
import { fit } from '@/ui/FitScaler';
import { visuals, visualListeners } from '@/core/VisualSettings';
import { cullWorld, type CullStats } from '@/render/Culling';
import type { PlayerSave } from '@/persist/SaveGame';
import { makeDraggable } from '@/ui/draggable';
import { auditTownLayout } from '@/town/TownMap';
import { TownSystem } from '@/systems/Town';
import { ShopUI } from '@/ui/Shop';
import { StashUI } from '@/ui/Stash';
import { SavePanelUI } from '@/ui/SavePanel';
import { base64ToBytes, bytesToBase64, emptyFloorMemory, SAVE_VERSION, saves, type FloorMemory, type SaveGame, type StashState } from '@/persist/SaveGame';

/** Everything owned by one dungeon floor. */
interface World {
  dungeon: DungeonMap;
  viewport: Viewport;
  camera: Camera;
  scene: SceneManager;
  lighting: Lighting;
  ambience: Ambience;
  loot: LootSystem;
  movement: MovementSystem;
  combat: CombatSystem;
  projectiles: ProjectileSystem;
  enemies: EnemyPool;
  chests: ChestSystem;
  /** THE STATUS ENGINE (it.80): bleed, poison, burn, chill, shock, stun on foes. */
  status: StatusSystem;
  input: InputBindings;
  /** CO-OP (it.59): one locomotion system per party seat (null = empty seat). `movement` is the local hero's. */
  movements: Array<MovementSystem | null>;
  /** CO-OP (it.60): build a locomotion system for a hero seated mid-run on THIS floor. */
  makeMovement: (hero: Player, slot: number) => MovementSystem;
  stairs: { x: number; y: number; sprite: Sprite };
  /** Sealed boss arena floor (it.28): stairs hidden until every foe falls. */
  isArena: boolean;
  arenaCleared: boolean;
  /** Boss-floor chamber rect (it.29): stepping inside INSTANTLY teleports
   *  into the arena — no stair/ladder interaction. Null elsewhere. */
  arenaThreshold: { x: number; y: number; w: number; h: number } | null;
  /** Collectible floor gold (proximity pickup each tick). */
  goldPiles: GoldPile[];
  targetRing: Sprite;
  /** Warm additive halo that rides the hero (readability in deep dark). */
  playerHalo: Sprite;
  /** Floating combat numbers (per-floor: lives in the viewport's layers). */
  dmgText: DamageTextSystem;
  /** Animated spell strips (it.41). */
  vfx: VfxSystem;
  /** Persistent floor gore (it.43). */
  gore: GoreSystem;
  /** The floor's boss (every 5th depth) — stairs stay barred while it lives. */
  boss: Enemy | null;
  bossSeen: boolean;
  unsubscribe: () => void;
  /** Town-only (it.39): the layout, its folk, cutaway occluders, interactables. */
  town: {
    layout: TownLayout;
    villagers: Villagers;
    /** THE MARKET WARD's folk and vendors (it.84). */
    villagers2: Villagers;
    /** THE EASTERN QUARTER (it.91): the refugees at the gate, or the folk come home; the innkeeper among them. */
    villagers3: Villagers | null;
    /** The barricade's carts by tile (it.91), from the dresser's gate map. */
    gates: Map<string, Sprite>;
    occluders: Occluder[];
    interactables: Interactable[];
    /** Label manager hook (it.50): the E-prompt's spot, so its plate stands down. */
    setPromptAt: (x: number | null, y?: number) => void;
    /** A plate re-titled or hidden (it.91). */
    setPlate: (x: number, y: number, label: string | null) => void;
    stashSprite: Sprite | null;
    /** SARAH (it.98): her sprite and the id of her word, held back until the vault is clear. */
    cellarGirl: { sprite: Sprite | null; id: number } | null;
    /** The three unpicked heroes resting at the fire (it.40). */
    campHeroes: CampHeroes;
    /** Render-frame dressing update (gate fog) + teardown. */
    update: (dt: number) => void;
    destroyDressing: () => void;
  } | null;
  /** Roster spawn indexes killed on this floor (FloorMemory). */
  killed: Set<number>;
  /** The entity id counter when this floor's foes were spawned (it.73). */
  idBase: number;
  coliseum: ColiseumState | null;
  /** THE VICTORY TELEPORTER (it.57): rises at the heart of the depth XX arena once the King is dust. */
  victoryPortal: { x: number; y: number } | null;
  /** THE QUARRY MINES (it.85); null on every other floor. */
  mines: MinesState | null;
  /** ENEMIES REMAINING (it.88): how many foes the floor woke with, for the forest's tally. */
  foesAtStart: number;
  /** THE FARMLANDS (it.100): the city's guards who went in with the hero. */
  squad: Squad | null;
  /** THE FARMLANDS (it.100): the man who commands the company, while he stands. */
  farmGeneral: Enemy | null;
}

type FloorMode = 'normal' | 'arena' | 'hub' | 'coliseum' | 'forest' | 'mines' | 'inn' | 'cellar' | 'farm';
/** THE DARK FOREST and THE QUARRY MINES (it.85): two floors past the depths' numbers. */
const FOREST_FLOOR = 101;
const MINES_FLOOR = 102;
/** THE GILDED STAG INSIDE (it.92): the inn's own floor. */
const INN_FLOOR = 103;
/** THE CELLAR (it.97): the vault under the taproom. */
const CELLAR_FLOOR = 104;
/** THE FARMLANDS (it.100): the burning fields along the marsh path. */
const FARM_FLOOR = 105;
const FOREST_POOL: EnemyKind[] = ['wolf', 'wolf', 'wolf', 'poacher', 'poacher', 'spider', 'spider', 'orc'];
const MINES_POOL: EnemyKind[] = ['orc', 'orc', 'spider', 'spider', 'lizard', 'shaman', 'archer', 'shambler', 'skeleton'];
/** THE CELLAR (it.97): what crawled in under the inn - vermin and the risen, no men. */
const CELLAR_POOL: EnemyKind[] = ['spider', 'spider', 'spider', 'zombie', 'zombie', 'ahoul', 'skeleton', 'shambler'];
/** THE FARMLANDS (it.100): a company that took the fields - men under arms, nothing else. */
const FARM_POOL: EnemyKind[] = ['mercenary', 'mercenary', 'mercenary', 'brigand', 'bandit', 'poacher'];
/** The mode a floor number stands for (the arena is decided by the caller). */
const modeFor = (f: number): FloorMode => (f === 0 ? 'hub' : f < 0 ? 'coliseum' : f === FOREST_FLOOR ? 'forest' : f === MINES_FLOOR ? 'mines' : f === INN_FLOOR ? 'inn' : f === CELLAR_FLOOR ? 'cellar' : f === FARM_FLOOR ? 'farm' : 'normal');

/** THE QUARRY (it.85): the gates, the keys, the hall and the way home. */
interface MinesState {
  doors: MineDoor[];
  keys: MineKey[];
  bossRoom: Room;
  boss: { x: number; y: number };
  gates: Map<string, Sprite>;
  level: number;
  dressing: TownDressing;
}

/** THE TRIAL COLISEUM (it.53): wave state, sim-owned. */
interface ColiseumState {
  waves: number;
  wave: number;
  phase: 'intermission' | 'fight' | 'done';
  /** Ticks left in the current intermission. */
  timer: number;
  alive: number;
  pads: Array<{ x: number; y: number }>;
  center: { x: number; y: number };
  /** The way home, once the last wave falls. */
  exit: { x: number; y: number } | null;
  /** Active-clock reading when the trial began (it.54). */
  startActive: number;
  update: (dt: number) => void;
  destroy: () => void;
}

/** What `startRun` hands back: the only handle the menus need. */
interface RunHandle {
  archetype: ClassArchetype;
  /** Save slot this run writes to (it.39). */
  slot: number;
  /** The slot's shared stash (restart/change-class keep it). */
  stash: () => StashState;
  /** Write the slot now; false when storage refused. */
  save: () => boolean;
  /** Endgame (it.43): back to the town camp with the run intact. */
  returnToTown: () => void;
  destroy: () => void;
}

const ROMAN = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
];

const VALID_CLASSES = ['warrior', 'mage', 'ranger', 'rogue'] as const;
const LAST_HERO_KEY = 'iso-arpg-last-hero';

/** Idle animation per class (previews, portraits, paperdoll). */
const PREVIEW_IDLE: Record<ClassArchetype, AnimName> = {
  warrior: 'knight_idle',
  mage: 'mage_idle',
  ranger: 'ranger_idle',
  rogue: 'rogue_idle',
};

/** Boss ladder + level milestones (it.23/it.28, shared by the arena spawner). */
const BOSS_LADDER: EnemyKind[] = ['boss', 'bossFrost', 'bossEmber', 'bossHollow'];
const BOSS_LEVELS: Record<number, number> = { 5: 7, 10: 13, 15: 18, 20: 25 };

async function boot(): Promise<void> {
  // --- Renderer -------------------------------------------------------------
  const app = new Application();
  // THE STAGE BOX (it.63): in portrait the crypt keeps the upper band and a
  // control pad takes the rest, so the renderer follows `#app` — whose size
  // the OrientationManager owns — rather than the whole window.
  const appEl = document.getElementById('app')!;
  await app.init({
    resizeTo: appEl,
    antialias: false,
    background: PALETTE.background,
    preference: 'webgl',
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
  });
  appEl.appendChild(app.canvas);
  (window as unknown as { __app: Application }).__app = app; // Dev aid: the renderer, for the harness (it.85).
  app.ticker.stop(); // The fixed-timestep GameLoop drives rendering.
  // Every reflow frame resizes the buffer, so a rotation glides instead of
  // snapping; the camera reads `app.screen`, so centring follows for free.
  layout.onReflow(() => app.resize());
  perf.attach(app); // The rolling frame budget owns the buffer resolution.

  // THE ERROR BOUNDARY (it.74): a rejected promise nobody awaited used to
  // vanish into the console with no context. Both paths now log with a
  // prefix a search can find, and never throw again from inside the handler.
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[unhandled] promise rejected:', e.reason);
    e.preventDefault();
  });
  window.addEventListener('error', (e) => {
    console.error('[unhandled] error:', e.message, e.error);
  });

  // THE COLOUR GRADE (it.74): one full-screen pass — a little contrast, a
  // little less saturation — over everything Pixi draws (the DOM HUD is
  // untouched). One pass at 2x resolution is what a weak phone cannot
  // spare, so it runs only at the scaler's top rung, and the player can
  // switch it off.
  const grade = new ColorMatrixFilter();
  grade.contrast(0.08, true);
  grade.saturate(-0.06, true);
  // THE RETRO CRT (it.85): a second full-screen pass, off by default, the player's switch.
  const crt = new CrtFilter(1);
  const applyGrade = (): void => {
    const on = visuals.grade && perf.quality !== 'low';
    const list = [...(on ? [grade] : []), ...(visuals.crt ? [crt] : [])];
    app.stage.filters = list.length ? list : null;
    app.stage.filterArea = list.length ? app.screen : undefined;
  };
  applyGrade();
  perf.onQuality(() => applyGrade());
  layout.onReflow(() => applyGrade());
  visualListeners.add(applyGrade);
  void fullscreenButton; // The corner control exists for every screen (it.64).
  // CONTAIN-FIT (it.64): no window may be cropped on any viewport. Centred
  // panels keep their translate; flex-centred ones scale on their own.
  // READABLE FLOORS (it.68). A window is never shrunk into a miniature: the
  // floor is where its type stops being legible, and past it the window
  // REFLOWS (an orientation layout in the CSS) and SCROLLS inside itself.
  fit.add(document.querySelector('#class-select .cs-fit'), { maxW: 0.94, maxH: 0.92, minScale: 0.75 });
  fit.add(document.querySelector('#main-menu .mm-panel'), { maxW: 0.94, maxH: 0.92, minScale: 0.8 });
  fit.add(document.querySelector('#credits .modal-panel'), { maxW: 0.92, maxH: 0.9, minScale: 0.75 });
  fit.add(document.querySelector('#pause-menu .modal-panel'), { maxW: 0.94, maxH: 0.92, minScale: 0.85 });
  fit.add(document.querySelector('#death-menu .modal-panel'), { maxW: 0.94, maxH: 0.92, minScale: 0.85 });
  fit.add(document.querySelector('#exit-modal .am-box'), { maxW: 0.92, maxH: 0.9, minScale: 0.8 });
  fit.add(document.querySelector('#coop-panel .cp-frame'), { maxW: 0.94, maxH: 0.92, minScale: 0.7 });
  fit.add(document.querySelector('#loading-screen .ls-frame'), { maxW: 0.92, maxH: 0.9, minScale: 0.7 });
  fit.add(document.getElementById('settings-panel'), { maxW: 0.94, maxH: 0.92, minScale: 0.8, base: 'translate(-50%, -50%)' });

  // CURSOR FIRST (it.25 freeze fix): the gothic pointer exists during the
  // loading screen and from the very first frame of every run.
  installCursor(app.canvas);

  // --- Persistent services --------------------------------------------------
  assets.init(app.renderer);

  // Atlas manifest + core singles (under 1 MB — the menu appears at once).
  // A failed load degrades gracefully to the procedural placeholder art.
  const loadingOverlay = document.getElementById('loading');
  try {
    await spriteLib.load();
    // ONE environment pipeline (it.17 revert): the proven stone set for all
    // depths; the bands are subtle tints baked inside buildStoneEnvironment.
    assets.buildStoneEnvironment(spriteLib.single('ground_stone'));
    // CHEST MODEL (it.44): the isometric pack's dark-wood chest replaces the procedural box on every floor.
    if (spriteLib.hasSingle('chest_closed_iso')) assets.registerTexture('chest_closed', spriteLib.single('chest_closed_iso'));
    if (spriteLib.hasSingle('chest_open_iso')) assets.registerTexture('chest_open', spriteLib.single('chest_open_iso'));
    // Town ground (it.39): the tileset's cobble / grass / dirt diamonds.
    ['town_cobble', 'town_grass', 'town_dirt', 'town_sand', 'inn_boards', 'inn_stone', 'cellar_flag', 'cellar_dirt', 'farm_ash'].forEach((name, i) => {
      if (spriteLib.hasSingle(name)) assets.registerTexture(`floor_town_${i}`, spriteLib.single(name));
      // TERRAIN VARIANTS (it.56): `<kind>_0..3` from the grass / dirt / sand sheets and the projected stone tiles.
      for (let v = 0; v < 4; v++) if (spriteLib.hasSingle(`${name}_${v}`)) assets.registerTexture(`floor_town_${i}_${v}`, spriteLib.single(`${name}_${v}`));
    });
  } catch (err) {
    console.warn('[boot] Sprite atlases unavailable — using procedural art.', err);
  }
  loadingOverlay?.classList.add('done');

  const settings = new SettingsUI();

  // AUDIO UNLOCK (browser autoplay policy): the first gesture builds the
  // Web Audio graph; the wanted music bed (menu) starts the moment it does.
  audio.setMusic('menu');
  installTouchGuards(); // THE GLASS RULES (it.83): no pinch zoom, no bounce, no callout on a phone.
  const unlockAudio = (): void => audio.unlock();
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  let lastHero: ClassArchetype | null = null;
  try {
    const stored = localStorage.getItem(LAST_HERO_KEY);
    if (stored && (VALID_CLASSES as readonly string[]).includes(stored)) lastHero = stored as ClassArchetype;
  } catch {
    /* storage unavailable */
  }

  // --- Hero previews (shared by class select, portraits, paperdoll) ---------
  /** South-facing idle frames, alpha-cropped to the painted body so every
   *  hero previews at the SAME height regardless of pack padding. */
  const previewCache = new Map<ClassArchetype, HTMLCanvasElement[]>();
  const classPreviewFrames = (cls: ClassArchetype): HTMLCanvasElement[] => {
    const cached = previewCache.get(cls);
    if (cached) return cached;
    if (!spriteLib.loaded || !spriteLib.hasAnim(PREVIEW_IDLE[cls])) return [];
    const anim = spriteLib.anim(PREVIEW_IDLE[cls]);
    const out: HTMLCanvasElement[] = [];
    // ONE BOX FOR EVERY FRAME (it.77): each frame used to be trimmed to its
    // own pixels and re-centred in the portrait, so a breathing body whose
    // silhouette grew a pixel jumped across the frame — the rogue and the
    // mage shook. The union box keeps the feet planted and the scale fixed.
    const raws: HTMLCanvasElement[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let f = 0; f < anim.frameCount; f++) {
      const spr = new Sprite(anim.frames[6][f]); // Facing S.
      const raw = app.renderer.extract.canvas({ target: spr, resolution: 1 }) as HTMLCanvasElement;
      spr.destroy();
      const ctx = raw.getContext('2d');
      if (!ctx) continue;
      const img = ctx.getImageData(0, 0, raw.width, raw.height);
      for (let y = 0; y < raw.height; y++) {
        for (let x = 0; x < raw.width; x++) {
          if (img.data[(y * raw.width + x) * 4 + 3] > 20) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      raws.push(raw);
    }
    if (!(maxX > minX && maxY > minY)) return [];
    const sw = maxX - minX + 1;
    const sh = maxY - minY + 1;
    const scale = Math.min(96 / sw, 108 / sh);
    const dw = Math.round(sw * scale);
    const dh = Math.round(sh * scale);
    for (const raw of raws) {
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 116;
      const cctx = c.getContext('2d')!;
      cctx.imageSmoothingEnabled = false;
      cctx.drawImage(raw, minX, minY, sw, sh, Math.round((96 - dw) / 2), 116 - dh - 4, dw, dh);
      out.push(c);
    }
    // Ping-pong short idles so the preview breathes instead of snapping.
    const frames = out.length <= 6 && out.length > 2 ? [...out, ...out.slice(1, -1).reverse()] : out;
    previewCache.set(cls, frames);
    return frames;
  };

  let openSavePanel: (mode: 'load' | 'new') => void = () => {};
  // --- Class select (a modal over the menu, cancellable) --------------------
  const pickClass = async (): Promise<ClassArchetype | null> => {
    await spriteLib.ensure(VALID_CLASSES.map((c) => PREVIEW_IDLE[c]));
    return new Promise((resolve) => {
      const overlay = document.getElementById('class-select')!;
      overlay.classList.add('show');
      fit.schedule(); // Contain-fit the whole screen the moment it appears (it.64).
      const timers: number[] = [];
      const ac = new AbortController();
      const finish = (cls: ClassArchetype | null): void => {
        overlay.classList.remove('show');
        timers.forEach((t) => clearInterval(t));
        ac.abort();
        resolve(cls);
      };
      // SELECT → CONFIRM (it.37): a card click highlights the delver; the
      // CONFIRM button (or Enter) starts the descent. The remembered hero
      // comes pre-selected.
      const confirmBtn = overlay.querySelector<HTMLButtonElement>('[data-cs-confirm]');
      let selected: ClassArchetype | null = lastHero;
      const cards = overlay.querySelectorAll<HTMLElement>('.class-card');
      const paint = (): void => {
        cards.forEach((c) => c.classList.toggle('selected', c.dataset.class === selected));
        if (confirmBtn) {
          confirmBtn.disabled = !selected;
          confirmBtn.textContent = selected ? `CONFIRM · ${selected.toUpperCase()}` : 'CONFIRM';
        }
      };
      paint();
      // THE DARK'S MEASURE (it.89): five settings under the delvers; the choice is kept for the next run.
      const diffRow = overlay.querySelector<HTMLElement>('#difficulty-cards');
      let chosenDifficulty = readPreferredDifficulty();
      if (diffRow) {
        diffRow.innerHTML = DIFFICULTY_ORDER.map((id) => {
          const d = DIFFICULTIES[id];
          return `<button type="button" class="diff-card" data-diff="${id}"><b>${d.name}</b><span class="dc-tag">${d.tag}</span><span class="dc-blurb">${d.blurb}</span></button>`;
        }).join('');
        const paintDiff = (): void => diffRow.querySelectorAll<HTMLElement>('.diff-card').forEach((b) => b.classList.toggle('selected', b.dataset.diff === chosenDifficulty));
        paintDiff();
        diffRow.querySelectorAll<HTMLButtonElement>('.diff-card').forEach((b) => {
          b.addEventListener('mouseenter', () => audio.sfx('uiHover'), { signal: ac.signal });
          b.addEventListener(
            'click',
            () => {
              audio.sfx('uiClick');
              chosenDifficulty = asDifficultyId(b.dataset.diff);
              try {
                localStorage.setItem(DIFFICULTY_KEY, chosenDifficulty);
              } catch {
                /* ignore */
              }
              paintDiff();
            },
            { signal: ac.signal },
          );
        });
        fit.schedule(); // The row is in the screen now: contain-fit again (it.89).
      }
      confirmBtn?.addEventListener(
        'click',
        () => {
          if (!selected) return;
          audio.sfx('heroSelect');
          finish(selected);
        },
        { signal: ac.signal },
      );
      cards.forEach((card) => {
        const cls = card.dataset.class as ClassArchetype;
        // Live animated model preview atop each card (it.33).
        let cv = card.querySelector<HTMLCanvasElement>('canvas.cc-preview');
        if (!cv) {
          cv = document.createElement('canvas');
          cv.className = 'cc-preview';
          cv.width = 96;
          cv.height = 116;
          card.insertBefore(cv, card.firstChild);
        }
        const frames = classPreviewFrames(cls);
        if (frames.length > 0) {
          const cctx = cv.getContext('2d')!;
          let shown = -1;
          const draw = (): void => {
            const i = uiIdleFrame(frames.length, performance.now() / 1000);
            if (i === shown) return;
            shown = i;
            cctx.clearRect(0, 0, cv!.width, cv!.height);
            cctx.drawImage(frames[i], 0, 0);
          };
          draw();
          timers.push(window.setInterval(draw, 50)); // Slow, time-based, ping-ponged (it.72).
        }
        card.addEventListener('mouseenter', () => audio.sfx('uiHover'), { signal: ac.signal });
        card.addEventListener(
          'click',
          () => {
            audio.sfx('uiClick');
            selected = cls;
            paint();
          },
          { signal: ac.signal },
        );
      });
      overlay.querySelector('[data-cs-back]')?.addEventListener(
        'click',
        () => {
          audio.sfx('uiBack');
          finish(null);
        },
        { signal: ac.signal },
      );
      // LOAD A SAVED DELVER (it.61): the slot panel lives behind the class screen now.
      overlay.querySelector('[data-cs-load]')?.addEventListener(
        'click',
        () => {
          audio.sfx('uiClick');
          finish(null);
          openSavePanel('load');
        },
        { signal: ac.signal },
      );
      window.addEventListener(
        'keydown',
        (e: KeyboardEvent) => {
          if (e.code === 'Escape') finish(null);
          if ((e.code === 'Enter' || e.code === 'NumpadEnter') && selected) {
            audio.sfx('heroSelect');
            finish(selected);
          }
        },
        { signal: ac.signal },
      );
    });
  };

  // --- Run lifecycle --------------------------------------------------------
  let run: RunHandle | null = null;

  /** A new game waiting for a slot (every slot was taken → OVERWRITE). */
  let pendingNewClass: ClassArchetype | null = null;
  const savePanel = new SavePanelUI({
    load: (slot) => {
      const s = saves.read(slot);
      // DEEP SAVE (it.48): a v3 save with a remembered spot resumes RIGHT THERE.
      if (s) void beginRun(s.player.archetype, s.pos && s.floor > 0 ? s.floor : 0, { slot, save: s });
      else mainMenu.show();
    },
    overwrite: (slot) => {
      const cls = pendingNewClass;
      pendingNewClass = null;
      if (!cls) {
        mainMenu.show();
        return;
      }
      saves.remove(slot);
      void beginRun(cls, 0, { slot });
    },
    onClose: () => {
      pendingNewClass = null;
      if (!run) mainMenu.show();
    },
  });

  // THE TITLE ATMOSPHERE (it.61): the Pixi scene under the menu; its own rAF.
  const titleScreen = new TitleScreen(app);
  // THE LOADING SCREEN (it.62): one overlay for every zone change.
  const loading = new LoadingScreen();
  titleScreen.onUndim = () => mainMenu.focusStack();
  // EXIT GAME: a browser tab cannot always be closed by a script — say so.
  const exitModal = document.getElementById('exit-modal')!;
  const closeExit = (): void => exitModal.classList.remove('open');
  exitModal.querySelector('[data-exit-stay]')?.addEventListener('click', () => {
    audio.sfx('uiBack');
    closeExit();
  });
  exitModal.querySelector('[data-exit-go]')?.addEventListener('click', () => {
    audio.sfx('uiConfirm');
    run?.save();
    window.close();
    window.setTimeout(() => {
      const note = exitModal.querySelector<HTMLElement>('.am-say');
      if (note) note.textContent = 'This window was not opened by the game, so it cannot close itself — close the tab to leave. Your last save is kept.';
    }, 300);
  });
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Escape' && exitModal.classList.contains('open')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      audio.sfx('uiBack');
      closeExit();
    }
  }, { capture: true });

  openSavePanel = (mode) => savePanel.open(mode);
  const mainMenu = new MainMenuUI({
    // CO-OP MULTIPLAYER (it.59): the party lobby.
    coop: () => {
      mainMenu.hide();
      coopLobby.open(lastHero);
    },
    exit: () => {
      const note = exitModal.querySelector<HTMLElement>('.am-say');
      if (note) note.textContent = 'The crypt keeps what you have won. Leave the dark for now?';
      exitModal.classList.add('open');
    },
    spark: (x, y) => titleScreen.burst(x, y),
    // START GAME always opens the character selection (it.37 flow rule).
    play: () => void openClassSelect(),
    // CONTINUE resumes the most recent slot in town (it.39).
    continueGame: () => {
      const s = saves.latest();
      if (s) void beginRun(s.player.archetype, s.pos && s.floor > 0 ? s.floor : 0, { slot: s.slot, save: s });
    },
    settings: () => settings.open(),
  });
  mainMenu.setLastHero(lastHero);

  let introPlayed = false;
  const showMainMenu = (): void => {
    document.body.classList.remove('in-run');
    audio.setMusic('menu');
    const latest = saves.latest();
    mainMenu.setContinue(latest ? { cls: latest.player.archetype, level: latest.player.level, floor: latest.pos && latest.floor > 0 ? latest.floor : 0, difficulty: DIFFICULTIES[asDifficultyId(latest.difficulty)].name } : null);
    titleScreen.show();
    mainMenu.show();
    fit.schedule(); // The stack was display:none until now — measure it (it.64).
    if (!introPlayed) {
      // THE OPENING (it.62): black, fog, embers, then the logo and the horn.
      introPlayed = true;
      titleScreen.playIntro(1.5);
      mainMenu.playIntro();
      window.setTimeout(() => audio.sfx('introHorn'), 620);
    }
    performance.mark('boot:menu'); // Boot-time telemetry (QA reads it).
  };

  const openClassSelect = async (): Promise<void> => {
    mainMenu.hide();
    const cls = await pickClass();
    if (cls) await startNewGame(cls);
    else mainMenu.show();
  };

  /** A fresh descent claims the first empty slot; when none is free, pick one to overwrite. */
  const startNewGame = async (cls: ClassArchetype): Promise<void> => {
    const slot = saves.firstFree();
    if (slot === null) {
      pendingNewClass = cls;
      savePanel.open('new');
      return;
    }
    await beginRun(cls, 0, { slot });
  };

  interface RunOptions {
    slot: number;
    save?: SaveGame;
    /** Restart / change class: a fresh hero that keeps the slot's stash. */
    stash?: StashState;
    /** CO-OP (it.59): the party this run belongs to. */
    coop?: CoopStart;
    /** THE DARK'S MEASURE (it.89): a new run's difficulty (a loaded run keeps its own). */
    difficulty?: DifficultyId;
  }

  /**
   * CO-OP HEROES (it.59): each class keeps one persistent co-op hero in a
   * hidden slot (11–14) — the lobby shows its level, the run saves to it.
   */
  const COOP_SLOT: Record<ClassArchetype, number> = { warrior: 11, mage: 12, ranger: 13, rogue: 14 };
  const coopLobby = new CoopLobbyUI({
    ensurePreviews: () => spriteLib.ensure(VALID_CLASSES.map((c) => PREVIEW_IDLE[c])),
    previewFor: (cls) => classPreviewFrames(cls),
    heroFor: (cls) => saves.read(COOP_SLOT[cls])?.player ?? null,
    // One life is a solo vow (it.89): a party never runs hardcore.
    difficulty: () => {
      const d = readPreferredDifficulty();
      return d === 'hardcore' ? 'hard' : d;
    },
    stashFor: (cls) => saves.read(COOP_SLOT[cls])?.stash ?? { items: [], gold: 0 },
    start: (cfg) => {
      const me = cfg.members.find((m) => m.slot === cfg.localSlot);
      if (!me) return;
      // A snapshot join (it.73) lands on the floor the party is on, not in town.
      void beginRun(me.cls, cfg.snapshot ? cfg.snapshot.floor : 0, { slot: COOP_SLOT[me.cls], save: saves.read(COOP_SLOT[me.cls]) ?? undefined, coop: cfg });
    },
    closed: () => showMainMenu(),
  });

  let starting = false;
  const beginRun = async (cls: ClassArchetype, startFloor = 0, opts: RunOptions = { slot: saves.firstFree() ?? 1 }): Promise<void> => {
    if (starting) return;
    starting = true;
    mainMenu.hide();
    titleScreen.hide(); // The run takes the stage.
    lastHero = cls;
    mainMenu.setLastHero(cls);
    try {
      localStorage.setItem(LAST_HERO_KEY, cls);
    } catch {
      /* ignore */
    }
    const fade = document.getElementById('floor-fade');
    fade?.classList.add('show', 'loading');
    loading.open(opts.coop ? 'joining the party' : startFloor > 0 ? `descending to depth ${startFloor}` : 'entering the crypt');
    try {
      run?.destroy();
      run = null;
      loading.step('atlases');
      run = await startRun(cls, startFloor, opts);
      loading.step('ready');
      performance.mark('run:ready');
    } catch (err) {
      console.error('[run] failed to start:', err);
      opts.coop?.net.destroy(); // Never leave a party link dangling behind a failed run.
      showMainMenu();
    } finally {
      fade?.classList.remove('loading');
      fade?.classList.remove('show');
      void loading.close();
      starting = false;
    }
  };

  const restartRun = (): void => {
    const cls = run?.archetype ?? lastHero ?? 'warrior';
    const slot = run?.slot ?? saves.firstFree() ?? 1;
    const stash = run?.stash();
    void beginRun(cls, 0, { slot, stash });
  };
  const exitToMenu = (): void => {
    run?.destroy();
    run = null;
    showMainMenu();
  };
  /** Pause/death → CHANGE CLASS: tear the run down and reopen the selection. */
  const changeClass = (): void => {
    const slot = run?.slot ?? saves.firstFree() ?? 1;
    const stash = run?.stash();
    run?.destroy();
    run = null;
    document.body.classList.remove('in-run');
    audio.setMusic('menu');
    mainMenu.hide();
    void (async () => {
      const cls = await pickClass();
      if (cls) await beginRun(cls, 0, { slot, stash });
      else showMainMenu();
    })();
  };

  // Epilogue buttons are wired ONCE (the overlay outlives runs).
  document.getElementById('endgame-again')?.addEventListener('click', () => {
    audio.sfx('uiConfirm');
    document.getElementById('endgame')?.classList.remove('show');
    restartRun();
  });
  document.getElementById('endgame-town')?.addEventListener('click', () => {
    audio.sfx('uiConfirm');
    document.getElementById('endgame')?.classList.remove('show');
    run?.returnToTown();
  });
  document.getElementById('endgame-menu')?.addEventListener('click', () => {
    audio.sfx('uiBack');
    document.getElementById('endgame')?.classList.remove('show');
    exitToMenu();
  });

  /**
   * ONE RUN: everything from hero creation to the game loop, torn down by
   * the returned handle. `?class=` (tests/links) skips the menu.
   */
  async function startRun(chosenClass: ClassArchetype, startFloor: number, opts: RunOptions): Promise<RunHandle> {
    let alive = true;
    const loaded = opts.save ?? null;
    const slot = opts.slot;
    // THE DARK'S MEASURE (it.89): a run keeps its difficulty - the save's, else the
    // picker's; a party takes the leader's, and one life is a solo vow.
    const difficultyId: DifficultyId = opts.coop
      ? (asDifficultyId(opts.coop.difficulty) === 'hardcore' ? 'hard' : asDifficultyId(opts.coop.difficulty))
      : loaded?.difficulty !== undefined
        ? asDifficultyId(loaded.difficulty)
        : (opts.difficulty ?? readPreferredDifficulty());
    difficulty.set(difficultyId);
    /** HARDCORE (it.89): the one life is spent - the slot is wiped and nothing writes it again. */
    let hardcoreOver = false;
    const subs: Array<() => void> = [];
    const subsOnLayout: Array<() => void> = [];
    const on = <K extends keyof GameEvents>(event: K, handler: (payload: GameEvents[K]) => void): void => {
      subs.push(eventBus.on(event, handler));
    };
    const timers = new Set<() => void>();
    /**
     * A timeout that dies with the run (boss sequences, banners, the fades).
     * On a worker's clock (it.90): a hidden tab throttles the page's timers
     * to once a minute, which stalled every floor transition.
     */
    const later = (fn: () => void, ms: number): void => {
      const cancel = unthrottledTimeout(() => {
        timers.delete(cancel);
        if (alive) fn();
      }, ms);
      timers.add(cancel);
    };
    const ac = new AbortController();

    document.body.classList.add('in-run');
    state.clear();
    const inputQueue = new InputQueue();
    // THE VIRTUAL CONTROLS (it.63): live for this run, silent behind a modal.
    touchControls.attach(inputQueue, {
      blocked: () =>
        !!document.querySelector('#inv-panel.open, #skill-tree.open, #char-sheet.open, #bestiary.open, .town-panel.open, #leaderboard.open, #settings-panel.open, #cheat-menu.open, #level-select.open, #minimap.expanded, #pause-menu.show, #death-menu.show, #arena-modal.open, #victory-modal.open, #exit-modal.open, #cine-layer.show') || transitioning,
    });
    // A rotation must never leave a thumb "held" on the old layout.
    subsOnLayout.push(layout.onChange(() => touchControls.releaseAll()));

    // ---- THE PARTY (it.59) --------------------------------------------------
    // Solo is a party of one. In co-op every peer builds the SAME roster in
    // seat order, from the SAME hero sheets, so entity ids and everything
    // downstream line up on four machines (deterministic lockstep).
    const coop = opts.coop ?? null;
    const net = coop?.net ?? null;
    const localSlot = coop?.localSlot ?? 0;
    inputQueue.stamp = localSlot;
    // The roster the WORLD starts from: a mid-run joiner (it.60) replays the
    // party's original start and joins by a JOIN frame like everyone else saw.
    const roster: MemberInfo[] = coop
      ? coop.history
        ? coop.history.members
        : coop.snapshot
          ? coop.snapshot.members
          : coop.members
      : [{ slot: 0, name: 'You', cls: chosenClass, ready: true, hero: null, online: true }];
    const seatCount = coop ? PARTY_MAX : 1;
    /** The Party Leader's seat: the only hero whose feet open stairs, gates and portals. */
    let leaderSlot = 0;
    const lockstep = net ? new Lockstep(net, localSlot, coop!.members.filter((m) => m.online).map((m) => m.slot)) : null;
    if (lockstep && coop?.history) lockstep.loadHistory(coop.history);
    /** THE AUTHORITY (it.73): the leader samples, everyone else corrects. */
    let hostSync: HostStateSync | null = null;
    let clientSync: ClientStateSync | null = null;
    /** A snapshot joiner builds its floor's foes from the leader's id counter. */
    let pendingIdBase: number | null = coop?.snapshot ? coop.snapshot.idBase : null;
    /** The party's opening stash (what a late joiner replays from). */
    const startStash: StashState = coop ? { items: [...coop.stash.items], gold: coop.stash.gold } : { items: [], gold: 0 };
    const chat = coop ? new ChatUI({ send: (text) => net?.chat(text) }) : null;
    /** A hero revives beside the floor's entrance ten seconds after falling (co-op only). */
    const COOP_REVIVE_TICKS = 600;
    const ownStash: StashState = loaded?.stash ?? { items: [], gold: 0 };

    const seedParam = new URLSearchParams(location.search).get('seed');
    const baseSeed = coop ? coop.seed : loaded ? loaded.seed : seedParam !== null ? Number(seedParam) >>> 0 : (Date.now() ^ 0x9e3779b9) >>> 0;
    /** Per-floor memory (it.39): rebuilt floors look the way they were left. A party starts with none — the crypt must match on every peer. */
    const floors: Record<number, FloorMemory> = coop ? (coop.snapshot ? { ...coop.snapshot.floors } : {}) : loaded ? { ...loaded.floors } : {};
    const memKey = (f: number, arena: boolean): number => (arena ? 1000 + f : f);
    let deepestFloor = coop ? (coop.snapshot?.deepest ?? 0) : (loaded?.deepestFloor ?? 0);
    /** THE QUEST LEDGER (it.87): quest id → 'new' | 'active' | 'done'. */
    const quests: Record<string, string> = { ...(loaded?.quests ?? {}) };
    // RECORDS (it.54): the dungeon and arena ledgers — global, merged with the slot's copy.
    const stats = new StatsManager();
    stats.load();
    stats.merge(loaded?.stats);
    /** THE ACTIVE CLOCK (it.54): ticks only on dungeon floors and during a live wave. */
    let activeTicks = loaded?.activeTicks ?? 0;
    let floorActiveTicks = 0;
    const playtimeBase = loaded?.playtimeTicks ?? 0;
    const createdAt = loaded?.createdAt ?? Date.now();

    // `?depth=N` starts on a deeper floor (debug/testing convenience).
    const depthParam = Number(new URLSearchParams(location.search).get('depth'));
    let floor =
      Number.isFinite(depthParam) && depthParam >= 1 ? Math.min(Math.floor(depthParam), MAX_DEPTH) : startFloor;

    // Every hero's atlases (+ the knight fallback) stream in before
    // anything renders; buildWorld fetches the floor's roster itself.
    await spriteLib.ensure([...roster.flatMap((m) => animsForHero(m.cls)), ...animsForHero('warrior')]);

    /** RESTORE (it.39): the sheet, the bags, the worn gear. */
    const applyHeroSave = (p: Player, ps: PlayerSave): void => {
      p.level = ps.level;
      p.xp = ps.xp;
      p.gold = ps.gold;
      p.hpMax = p.baseHpMax(); // The curve, not the saved number (it.78).
      p.hp = Math.min(p.hpMax, Math.max(1, ps.hp));
      p.resource = Math.min(p.resourceMax, ps.resource);
      p.skillPoints = ps.skillPoints;
      for (const id of ps.unlocked) p.unlockedSkills.add(id);
      for (const id of ps.passives) p.passives.add(id);
      for (const [k, v] of Object.entries(ps.bestiary ?? {})) p.bestiary.set(k, { seen: v.seen, killed: v.killed });
      p.goldCollected = ps.goldCollected ?? 0;
      ps.loadout.forEach((id, i) => {
        p.loadout[i] = id && p.unlockedSkills.has(id) ? id : null;
      });
      for (const [k, v] of Object.entries(ps.materials ?? {})) if (v > 0) p.addMaterial(k, v);
      if (ps.belt) p.belt = [ps.belt[0] ?? null, ps.belt[1] ?? null];
      for (const k of ps.recipes ?? []) p.recipes.add(k);
      for (const id of ps.backpack) if (itemDef(id)) p.addItem(id);
      for (const { itemId } of ps.equipped) {
        if (!itemDef(itemId)) continue;
        p.addItem(itemId);
        p.equipFromBackpack(p.backpack.length - 1);
      }
    };
    /** STARTER KIT (it.42): the class weapon and a chest piece go straight onto the paperdoll. */
    const giveStarterKit = (p: Player, cls: ClassArchetype): void => {
      const starterWeapon = cls === 'ranger' ? 'short_bow' : cls === 'mage' ? 'apprentice_wand' : cls === 'rogue' ? 'worn_katana' : 'rusty_sword';
      const starterChest = cls === 'mage' ? 'cloth_robe' : 'leather_jerkin';
      for (const id of [starterWeapon, starterChest]) {
        p.addItem(id);
        p.equipFromBackpack(p.backpack.length - 1);
      }
      // SECONDARY ARM (it.48): a bow for the melee trades, a blade for the ranger.
      p.addItem(cls === 'ranger' ? 'rusty_sword' : 'short_bow');
      // Every delver leaves town with two draughts and a way back (it.39).
      p.addItem('health_potion');
      p.addItem('health_potion');
      // THE FIRST SKILL IS FREE (it.68): a new hero leaves town with its
      // class's opening skill on slot 1 — the free point spent on it — so
      // the hotbar is never four locks and a mystery on the first screen.
      // Deterministic: every peer builds a fresh hero the same way.
      const first = CLASS_SKILLS[cls][0];
      if (first && !p.unlockedSkills.has(first.id)) {
        p.skillPoints = Math.max(0, p.skillPoints - skillCost(p, first));
        p.unlockedSkills.add(first.id);
        if (!p.loadout.includes(first.id)) {
          const free = p.loadout.indexOf(null);
          p.loadout[free >= 0 ? free : 0] = first.id;
        }
      }
    };

    /** One party seat: the hero, its colours, its co-op bookkeeping. */
    interface Seat {
      slot: number;
      name: string;
      cls: ClassArchetype;
      color: number;
      colorCss: string;
      player: Player;
      /** Left the party (LEAVE frame / lost link): despawned, ignored everywhere. */
      gone: boolean;
      /** The local joiner before its JOIN frame lands (it.60): built, not yet in the world. */
      pending: boolean;
      /** Link health from the leader's heartbeat (it.60). */
      link: LinkState | 'lagging';
      /** Last AIM point from this seat's command stream (co-op). */
      aim: { x: number; y: number } | null;
      /** Overhead nameplate + hp bar (co-op). */
      plate: { root: Container; bar: Graphics; note: Text } | null;
    }
    const party: Array<Seat | null> = [];
    /** The live seat → hero table shared with combat / projectiles (a seat that leaves goes null). */
    const seatPlayers: Array<Player | null> = [];
    const makeSeat = (s: number, name: string, cls: ClassArchetype, p: Player): Seat => ({ slot: s, name, cls, color: PARTY_COLORS[s] ?? 0xffffff, colorCss: PARTY_COLOR_CSS[s] ?? '#fff', player: p, gone: false, pending: false, link: 'ok', aim: null, plate: null });
    for (let s = 0; s < seatCount; s++) {
      const m = roster.find((r) => r.slot === s);
      if (!m) {
        party.push(null);
        seatPlayers.push(null);
        continue;
      }
      const p = new Player(m.cls);
      state.register(p);
      const sheet = coop ? m.hero : (loaded?.player ?? null);
      if (sheet) applyHeroSave(p, sheet);
      else giveStarterKit(p, m.cls);
      if (spriteLib.loaded) p.enableKnightRig(); // The class body replaces the crystal.
      party.push(makeSeat(s, m.name, m.cls, p));
      seatPlayers.push(p);
    }
    /**
     * A MID-RUN JOINER (it.60): the hero exists on this screen from the start
     * (the HUD needs it) but enters the world — and the entity table, with
     * the id every peer assigns — only when its JOIN frame executes. It waits
     * OUTSIDE the seat table: the seat number may still belong to a departed
     * player whose LEAVE is somewhere in the replay.
     */
    let pendingLocal: Seat | null = null;
    // A RECLAIMED SEAT (it.73): the snapshot already holds our seat (the
    // leader kept it through the grace window) — our hero is in the world,
    // no JOIN frame is coming, and there is nothing to wait for.
    const seatedAlready = !!coop?.snapshot && roster.some((m) => m.slot === localSlot);
    if ((coop?.history || coop?.snapshot) && !seatedAlready) {
      const p = new Player(chosenClass);
      const sheet = coop.hero ?? loaded?.player ?? null;
      if (sheet) applyHeroSave(p, sheet);
      else giveStarterKit(p, chosenClass);
      if (spriteLib.loaded) p.enableKnightRig();
      pendingLocal = makeSeat(localSlot, coop.members.find((m) => m.slot === localSlot)?.name ?? 'You', chosenClass, p);
      pendingLocal.pending = true;
    }
    const me = pendingLocal ?? party[localSlot]!;
    const player = me.player;
    const seatOf = (entity: Entity | null | undefined): Seat | null => {
      if (!entity) return null;
      for (const s of party) if (s && !s.gone && !s.pending && s.player === entity) return s;
      return null;
    };
    const leaderHero = (): Player => (party[leaderSlot] && !party[leaderSlot]!.gone && !party[leaderSlot]!.pending ? party[leaderSlot]!.player : player);
    const liveSeats = (): Seat[] => party.filter((s): s is Seat => !!s && !s.gone && !s.pending);
    /** Spread the party around a tile: the leader on it, the rest on the nearest free tiles. */
    const RING: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 1], [1, 2]];
    const placeParty = (cx: number, cy: number, isWalkable: (gx: number, gy: number) => boolean): void => {
      let k = 0;
      for (const seat of liveSeats()) {
        let placed = false;
        for (; k < RING.length; k++) {
          const gx = Math.floor(cx) + RING[k][0];
          const gy = Math.floor(cy) + RING[k][1];
          if (!isWalkable(gx, gy)) continue;
          seat.player.warpTo(k === 0 ? cx : gx + 0.5, k === 0 ? cy : gy + 0.5);
          k++;
          placed = true;
          break;
        }
        if (!placed) seat.player.warpTo(cx, cy);
        seat.player.action = 'idle';
      }
    };
    /** CO-OP NAMEPLATES (it.59): the nickname and an hp bar over every hero, in the seat colour. */
    const makePlate = (seat: Seat): void => {
      if (seat.plate) return;
      const root = new Container();
      root.position.set(0, -96);
      const label = new Text({
        text: seat.name,
        style: { fontFamily: 'Cinzel, Georgia, serif', fontSize: 11, fontWeight: '700', fill: seat.colorCss, stroke: { color: 0x000000, width: 3 }, letterSpacing: 1 },
      });
      label.anchor.set(0.5, 1);
      label.position.set(0, -2);
      label.resolution = 2;
      const bar = new Graphics();
      // LINK NOTE (it.60): "RECONNECTING…" under the bar while the seat's link is out.
      const note = new Text({ text: '', style: { fontFamily: 'Cinzel, Georgia, serif', fontSize: 8, fontWeight: '700', fill: '#e8b060', stroke: { color: 0x000000, width: 3 }, letterSpacing: 1 } });
      note.anchor.set(0.5, 0);
      note.position.set(0, 7);
      note.resolution = 2;
      note.visible = false;
      root.addChild(label, bar, note);
      seat.player.container.addChild(root);
      seat.plate = { root, bar, note };
    };
    if (coop) for (const seat of liveSeats()) makePlate(seat);
    const updatePlates = (): void => {
      for (const seat of liveSeats()) {
        const pl = seat.plate;
        if (!pl) continue;
        const frac = Math.max(0, Math.min(1, seat.player.hp / Math.max(1, seat.player.hpMax)));
        pl.bar.clear();
        pl.bar.rect(-24, 0, 48, 5).fill({ color: 0x000000, alpha: 0.75 });
        pl.bar.rect(-23, 1, 46 * frac, 3).fill({ color: seat.player.action === 'dead' ? 0x553333 : seat.color });
        pl.root.alpha = seat.player.action === 'dead' ? 0.55 : 1;
        pl.root.scale.set(Enemy.hudScale);
        const noteText = seat.link === 'reconnecting' ? 'RECONNECTING…' : seat.link === 'lagging' ? 'LAGGING…' : '';
        if (pl.note.text !== noteText) pl.note.text = noteText;
        pl.note.visible = noteText !== '';
        if (noteText) pl.note.alpha = 0.6 + 0.4 * Math.sin(performance.now() / 250);
      }
    };
    /** Aim (it.33, per seat since it.59): the mouse in solo; the seat's AIM stream in co-op. */
    const aimWorldPoint = (p: Player): { x: number; y: number } | null => {
      if (coop) {
        const seat = seatOf(p);
        return seat?.aim ? { x: seat.aim.x, y: seat.aim.y } : null;
      }
      return lastMouse.seen ? world.camera.pointerToWorld(lastMouse.x, lastMouse.y, vec2()) : null;
    };
    const aimFor = (p: Player): { x: number; y: number } => {
      const w = aimWorldPoint(p);
      if (w) {
        const dx = w.x - p.pos.x;
        const dy = w.y - p.pos.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.2) return { x: dx / len, y: dy / len };
      }
      const flen = Math.hypot(p.facing.x, p.facing.y) || 1;
      return { x: p.facing.x / flen, y: p.facing.y / flen };
    };
    let leaderNoteCooldown = 0;
    const leaderOnlyNote = (): void => {
      if (leaderNoteCooldown > 0) return;
      leaderNoteCooldown = 90;
      world.dmgText.show(player.pos.x, player.pos.y - 1.2, 'ONLY THE PARTY LEADER OPENS THE WAY', 'miss');
    };

    /**
     * Live ANIMATED paperdoll (it.15): idle-animation frames of the actual
     * in-world hero (armor tint + item-colored slot gems baked into each
     * frame). InventoryUI cycles them — the menu character breathes.
     */
    const PREVIEW_SLOTS: readonly EquipmentSlot[] = ['cloak', 'legs', 'torso', 'head', 'offHand', 'mainHand'];
    const heroIdleAnim = (): AnimName | null =>
      spriteLib.loaded && spriteLib.hasAnim(PREVIEW_IDLE[player.archetype]) ? PREVIEW_IDLE[player.archetype] : null;
    const buildPaperdollFrames = (): HTMLCanvasElement[] => {
      const buildRig = (bodyTexIndex: number): HTMLCanvasElement => {
        const rig = new Container();
        const idleAnim = heroIdleAnim();
        if (idleAnim) {
          // The CHOSEN class breathes in the panel at ONE normalized height
          // (data-driven from the atlas painted bounds, it.36).
          const body = new Sprite(spriteLib.frame(idleAnim, 6, bodyTexIndex)); // Facing S.
          body.anchor.set(0.5, 0.8);
          if (player.archetype === 'warrior') body.tint = player.getEquipmentTint();
          const ph = spriteLib.paintedHeight(idleAnim) || 60;
          body.scale.set(78 / ph);
          rig.addChild(body);
          // Item-colored gems under the model mark each worn slot.
          let gemIndex = 0;
          for (const slot of PREVIEW_SLOTS) {
            const itemId = player.getEquipped(slot);
            const def = itemId ? itemDef(itemId) : undefined;
            if (!def) continue;
            const gem = new Sprite(assets.get('mote'));
            gem.anchor.set(0.5);
            gem.tint = def.color;
            gem.scale.set(1.4);
            gem.position.set(-30 + gemIndex * 12, 34);
            gemIndex++;
            rig.addChild(gem);
          }
        } else {
          const body = new Sprite(assets.get(ARCHETYPES[player.archetype].markerTexture));
          body.anchor.set(0.5, 1.0);
          body.position.set(0, 6);
          rig.addChild(body);
          for (const slot of PREVIEW_SLOTS) {
            const itemId = player.getEquipped(slot);
            const def = itemId ? itemDef(itemId) : undefined;
            if (!def) continue;
            const overlay = new Sprite(assets.get(overlayTextureFor(def)));
            overlay.anchor.set(0.5, 1.0);
            overlay.position.set(0, 6);
            overlay.tint = def.color;
            rig.addChild(overlay);
          }
          rig.scale.set(2.4);
        }
        const canvas = app.renderer.extract.canvas({ target: rig, resolution: 1 }) as HTMLCanvasElement;
        rig.destroy({ children: true });
        return canvas;
      };
      const idleAnim = heroIdleAnim();
      if (!idleAnim) return [buildRig(0)];
      const idle = spriteLib.anim(idleAnim);
      const frames: HTMLCanvasElement[] = [];
      const step = Math.max(1, Math.floor(idle.frameCount / 6));
      for (let f = 0; f < idle.frameCount; f += step) frames.push(buildRig(f));
      return frames.length <= 6 && frames.length > 2 ? [...frames, ...frames.slice(1, -1).reverse()] : frames;
    };

    // Town economy + stash (it.39): the stash belongs to the SLOT — in co-op
    // the PARTY shares the leader's stash (it.59) and every deposit or
    // withdrawal is a lockstep command, so all four see the same chest.
    const town = new TownSystem((slot) => (party[slot] && !party[slot]!.gone ? party[slot]!.player : null), coop ? coop.stash : (opts.stash ?? loaded?.stash ?? { items: [], gold: 0 }));
    let townVisits = coop ? 0 : loaded ? 1 : 0;
    // THE CAMP FORGE (it.78): a run-level system like the town; its rolls
    // come from the run's own seeded stream so four peers share the sparks.
    const crafting = new CraftingEngine(
      { getPlayer: (slot) => (party[slot] && !party[slot]!.gone ? party[slot]!.player : null), inTown: () => !!world.town, deepestFloor: () => deepestFloor },
      baseSeed,
    );
    let pendingPortal = false;
    let portalCooldown = 0;
    /** HIT-STOP (it.48): sim ticks frozen when heavy steel lands — the frame the blow READS. */
    let hitStopTicks = 0;
    const hitStop = (ticks: number): void => {
      if (world.town || coop) return; // Lockstep never holds a frame (it.59).
      hitStopTicks = Math.min(3, Math.max(hitStopTicks, ticks));
    };
    const vignetteEl = document.getElementById('vignette');
    let hurtFlashTimer = 0;
    /** The interact hint's last markup (written only on change; it.75). */
    let lastHintHtml = '';
    let bossGoneTimer = 0;
    /** LEVEL-UP PILLARS (it.48): golden light columns climbing off the hero. */
    const pillars: Array<{ sprite: Sprite; life: number }> = [];
    /** ACTIVE BUFF RINGS (it.48): on the HUD and over the hero's head. */
    const hudBuffs = document.createElement('div');
    hudBuffs.id = 'hud-buffs';
    document.body.appendChild(hudBuffs);
    const headBuffs = document.createElement('div');
    headBuffs.id = 'player-buffs';
    document.body.appendChild(headBuffs);
    let buffKey = '';
    const buffScratch = vec2();
    /** THE TRIAL COLISEUM HUD (it.53): the wave line, the cleared banner, the master's dialog. */
    const waveHud = document.createElement('div');
    waveHud.id = 'wave-hud';
    document.body.appendChild(waveHud);
    const waveBanner = document.createElement('div');
    waveBanner.id = 'wave-banner';
    document.body.appendChild(waveBanner);
    const showWaveBanner = (text: string): void => {
      waveBanner.textContent = text;
      waveBanner.classList.remove('show');
      void waveBanner.offsetWidth;
      waveBanner.classList.add('show');
      later(() => waveBanner.classList.remove('show'), 2600);
    };
    const arenaModal = document.createElement('div');
    arenaModal.id = 'arena-modal';
    arenaModal.innerHTML = `
      <div class="am-box">
        <h3>THE ARENA MASTER</h3>
        <p class="am-say">“Beyond this arch the sand drinks whatever bleeds. Waves come from the four gates, and between them you get fifteen breaths to loot and drink. Enter the Trial Coliseum — how long will you last?”</p>
        <div class="am-choices">
          <button data-waves="5"><b>5 WAVES</b><span>a skirmish</span></button>
          <button data-waves="10"><b>10 WAVES</b><span>a trial</span></button>
          <button data-waves="15"><b>15 WAVES</b><span>an ordeal</span></button>
          <button data-waves="20"><b>20 WAVES</b><span>the crown</span></button>
        </div>
        <button class="am-cancel" data-cancel>Not today</button>
      </div>`;
    document.body.appendChild(arenaModal);
    const openArenaModal = (): void => {
      arenaModal.classList.add('open');
      audio.sfx('invOpen');
    };
    const closeArenaModal = (): void => {
      if (!arenaModal.classList.contains('open')) return;
      arenaModal.classList.remove('open');
      audio.sfx('invClose');
    };
    arenaModal.querySelector('[data-cancel]')?.addEventListener('click', closeArenaModal);
    arenaModal.querySelectorAll<HTMLButtonElement>('[data-waves]').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
      b.addEventListener('click', () => {
        audio.sfx('uiConfirm');
        arenaModal.classList.remove('open');
        inputQueue.enqueue({ type: 'WARP', playerId: localSlot, to: 'coliseum', n: Number(b.dataset.waves) });
      });
    });
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'Escape' && arenaModal.classList.contains('open')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          closeArenaModal();
        }
      },
      { signal: ac.signal, capture: true },
    );
    /** SPAWN RISE (it.54): a body climbs out of the sand through a ring of dust. */
    const riseFromSand = (e: Enemy, ticks: number): void => {
      e.beginRise(ticks);
      world.vfx.play('vfx_ring', e.pos.x, e.pos.y, { scale: 0.75, flat: true, fps: 22, tint: 0xd8c090, alpha: 0.9 });
      world.ambience.sparks(e.pos.x, e.pos.y, 0, 0, 10, 0xd8c090);
    };
    /** BOSS ENTRANCE (it.54): the ground shakes, a red beam stands on the gate, the horn sounds. */
    const bossEntrance = (b: Enemy): void => {
      world.camera.addShake(0.85);
      world.camera.addKick(9);
      audio.sfx('arenaHorn');
      const s = worldToScreen(b.pos.x, b.pos.y, vec2());
      const beam = new Sprite(assets.get('glow'));
      beam.anchor.set(0.5, 0.9);
      beam.blendMode = 'add';
      beam.tint = 0xff3030;
      beam.scale.set(1.8, 7);
      beam.alpha = 0.95;
      beam.position.set(s.x, s.y + 6);
      world.viewport.ambienceLayer.addChild(beam);
      pillars.push({ sprite: beam, life: -0.6 }); // A longer beat than a level-up.
      world.vfx.play('vfx_pentagram', b.pos.x, b.pos.y, { fps: 9, scale: 1.3, depthBias: -60, alpha: 0.95 });
      world.ambience.burst(b.pos.x, b.pos.y, 0xff4040, 40);
      world.ambience.bloodSpray(b.pos.x, b.pos.y, undefined, undefined, 20);
      hitStop(3);
    };

    /**
     * THE TELEPORTER (it.56): the carved stone pad squashed onto the sand at
     * the arena's centre, the blue rune ring turning above it, a vortex in
     * its throat and a column of light. Render-side sprites; the sim only
     * knows the exit tile.
     */
    let teleporterFx: { pad: Sprite; rune: Sprite; rune2: Sprite; beam: Sprite; clock: number } | null = null;
    /**
     * THE IRON GATES (it.85). Pure simulation: a living hero within a stride of
     * a shut gate, carrying its key, opens it — the key is spent, the tile is
     * floor, the sprite swings, the fog and the map learn the corridor. Without
     * the key the gate says so over its bars, now and then.
     */
    const openGate = (d: MineDoor): void => {
      const m = world.mines;
      if (!m || d.open) return;
      d.open = true;
      for (const tile of d.tiles) {
        world.dungeon.grid[tile.y * world.dungeon.width + tile.x] = TILE_FLOOR;
        const spr = m.gates.get(`${tile.x},${tile.y}`);
        if (spr && spriteLib.hasSingle('gate_open')) spr.texture = spriteLib.single('gate_open');
      }
      world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
      minimap.markDirty();
      world.dmgText.show(d.x + 0.5, d.y - 0.4, `GATE ${ROMAN[d.key - 1] ?? d.key} OPENS`, 'crit');
      world.ambience.burst(d.x + 0.5, d.y + 0.5, 0xd8b060, 16);
      audio.sfx('gateIron'); // Iron and the gate's groan (it.89).
      eventBus.emit('inventory:changed', {});
    };
    const tickMines = (): void => {
      const m = world.mines;
      if (!m) return;
      for (const seat of liveSeats()) {
        const hero = seat.player;
        if (hero.hp <= 0) continue;
        for (const d of m.doors) {
          if (d.open) continue;
          if (!d.tiles.some((tile) => Math.hypot(hero.pos.x - (tile.x + 0.5), hero.pos.y - (tile.y + 0.5)) <= 1.6)) continue;
          const ki = hero.backpack.indexOf(`quarry_key_${d.key}`);
          if (ki < 0) {
            if (seat.slot === localSlot && state.tick % 120 === 0) world.dmgText.show(d.x + 0.5, d.y - 0.4, `LOCKED · KEY ${ROMAN[d.key - 1] ?? d.key} LIES ELSEWHERE`, 'miss');
            continue;
          }
          hero.backpack.splice(ki, 1);
          openGate(d);
        }
      }
      // THE KEEPER (it.88) falls in its arena past the seal; a cleared hall raises the way home on its first tick.
    };
    const spawnTeleporterAt = (tx: number, ty: number): void => {
      const s = worldToScreen(tx + 0.5, ty + 0.5, vec2());
      const mk = (single: string, scaleX: number, scaleY: number, tint: number, additive: boolean, layer: 'ground' | 'ambience'): Sprite => {
        const spr = new Sprite(spriteLib.hasSingle(single) ? spriteLib.single(single) : assets.get('glow'));
        spr.anchor.set(0.5);
        spr.scale.set(scaleX, scaleY);
        spr.tint = tint;
        if (additive) spr.blendMode = 'add';
        spr.position.set(s.x, s.y);
        (layer === 'ground' ? world.viewport.groundLayer : world.viewport.ambienceLayer).addChild(spr);
        return spr;
      };
      // THE NEW TELEPORTER (it.87): the stone disc from the teleporter model and its rune ring.
      const pad = mk('portal_pad', 0.62, 0.62, 0xffffff, false, 'ground');
      const rune = mk('portal_rune', 0.66, 0.66, 0xffffff, true, 'ambience');
      const rune2 = mk('portal_rune', 0.42, 0.42, 0x9fd0ff, true, 'ambience');
      rune2.alpha = 0.7;
      const beam = mk('glow', 1.6, 6.5, 0x6fa0ff, true, 'ambience');
      beam.anchor.set(0.5, 0.92);
      beam.alpha = 0.55;
      teleporterFx = { pad, rune, rune2, beam, clock: 0 };
      world.vfx.play('vfx_vortex', tx + 0.5, ty + 0.5, { loop: true, fps: 18, scale: 1.1, flat: true, tint: 0x8fb8ff, alpha: 0.75 });
      world.lighting.addSource(tx + 0.5, ty + 0.5, 3.2, 90, 140, 255, 0.7);
      world.ambience.burst(tx + 0.5, ty + 0.5, 0x8fb8ff, 30);
      audio.sfx('portal');
    };
    const openExitTeleporter = (): void => {
      const c = world.coliseum;
      if (!c || c.exit) return;
      c.exit = { x: c.center.x, y: c.center.y };
      spawnTeleporterAt(c.exit.x, c.exit.y);
    };
    /** THE VICTORY CHOICE (it.57): on the depth XX teleporter — home, or the crown. */
    const victoryModal = document.createElement('div');
    victoryModal.id = 'victory-modal';
    victoryModal.innerHTML = `
      <div class="am-box">
        <h3>THE HOLLOW KING IS DUST</h3>
        <p class="am-say">The teleporter hums beneath your feet. The crypt is broken and the dark has no master left. Step through to the town with your spoils, or take the crown and let the ending be told.</p>
        <div class="am-choices am-two">
          <button data-victory="town"><b>RETURN TO TOWN</b><span>keep delving</span></button>
          <button data-victory="crown"><b>CLAIM THE CROWN</b><span>the ending</span></button>
        </div>
        <button class="am-cancel" data-cancel>Not yet</button>
      </div>`;
    document.body.appendChild(victoryModal);
    let victoryPortalArmed = true;
    const closeVictoryModal = (): void => {
      if (!victoryModal.classList.contains('open')) return;
      victoryModal.classList.remove('open');
      victoryPortalArmed = false; // Step off and back on to ask again.
      audio.sfx('invClose');
    };
    victoryModal.querySelector('[data-cancel]')?.addEventListener('click', closeVictoryModal);
    victoryModal.querySelectorAll<HTMLButtonElement>('[data-victory]').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.sfx('uiHover'));
      b.addEventListener('click', () => {
        audio.sfx('uiConfirm');
        victoryModal.classList.remove('open');
        inputQueue.enqueue({ type: 'WARP', playerId: localSlot, to: b.dataset.victory === 'crown' ? 'crown' : 'town' });
      });
    });
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code === 'Escape' && victoryModal.classList.contains('open')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          closeVictoryModal();
        }
      },
      { signal: ac.signal, capture: true },
    );

    /** One wave: more bodies and more champions every time (sim). */
    const spawnWave = (c: ColiseumState): void => {
      const n = Math.min(24, 4 + c.wave * 2);
      const pool = kindPoolFor(Math.min(20, Math.max(1, c.wave * 2 - 1)));
      const rand = mulberry32((baseSeed ^ (c.wave * 0x51a7)) >>> 0);
      const eliteChance = Math.min(0.6, 0.15 + (c.wave - 1) * 0.04);
      for (let i = 0; i < n; i++) {
        const pad = c.pads[i % c.pads.length];
        const jx = (rand() - 0.5) * 2.4;
        const jy = (rand() - 0.5) * 2.4;
        const kind = pool[Math.floor(rand() * pool.length)];
        const e = world.enemies.spawn(kind, pad.x + 0.5 + jx, pad.y + 0.5 + jy, c.wave + 1);
        const roll = rand();
        if (roll < eliteChance) e.setAffix(AFFIXES[Math.floor((roll / eliteChance) * 3) % 3]);
        e.aiState = 'chase';
        riseFromSand(e, 24 + Math.floor(rand() * 18));
      }
      c.alive = n;
      // BOSS WAVES (it.54): every fifth wave a warden climbs the sand.
      if (c.wave % 5 === 0) {
        const kind = BOSS_LADDER[Math.min(BOSS_LADDER.length - 1, c.wave / 5 - 1)];
        const pad = c.pads[0];
        const b = world.enemies.spawn(kind, pad.x + 0.5, pad.y + 0.5, c.wave + 3);
        b.aiState = 'chase';
        riseFromSand(b, 70);
        world.boss = b;
        world.bossSeen = false;
        c.alive++;
        bossEntrance(b);
        showWaveBanner(`${b.def.name.toUpperCase()} ENTERS`);
      } else {
        audio.sfx('bossHorn');
        showWaveBanner(`WAVE ${c.wave}`);
      }
    };
    const updateColiseum = (): void => {
      const c = world.coliseum;
      if (!c) return;
      if (c.phase === 'intermission') {
        c.timer--;
        if (c.timer <= 0) {
          c.wave++;
          spawnWave(c);
          c.phase = 'fight';
        }
      } else if (c.phase === 'fight') {
        let alive = 0;
        world.enemies.forEachActive((e) => {
          if (e.hp > 0 || e.action === 'transition') alive++;
        });
        c.alive = alive;
        if (alive === 0) {
          audio.sfx('gateOpen');
          stats.noteArenaWave(c.wave); // The ledger (it.54).
          stats.save();
          if (c.wave >= c.waves) {
            c.phase = 'done';
            stats.recordArenaClear(player.archetype, c.waves, activeTicks - c.startActive); // The trial's time (it.54).
            showWaveBanner('TRIAL COMPLETE!');
            // The prize beside the way home (the teleporter rises at the centre).
            world.chests.spawnAt(c.center.x - 3, c.center.y + 1, true);
            openExitTeleporter();
            audio.setBossMusic(false);
            audio.sfx('victory');
            tutorial.notify('coliseumDone', 'The crowd roars. Open the coliseum chest, then step onto the teleporter at the centre to go home.');
          } else {
            c.phase = 'intermission';
            c.timer = 15 * 60;
            showWaveBanner('WAVE CLEARED!');
          }
        }
      }
      // The teleporter (it.56): opened by the last wave or by T; stepping onto its pad goes home.
      if (c.exit && !transitioning) {
        const lead = leaderHero();
        if (Math.hypot(lead.pos.x - (c.exit.x + 0.5), lead.pos.y - (c.exit.y + 0.5)) < 0.9) leaveColiseum();
        else if (coop && Math.hypot(player.pos.x - (c.exit.x + 0.5), player.pos.y - (c.exit.y + 0.5)) < 0.9) leaderOnlyNote();
      }
    };
    let emptyArenaTicks = 0;
    let portalReturn: { floor: number; arena: boolean; x: number; y: number } | null = null;
    let portalArmed = false;
    let pendingInteract: number | null = null;
    /** THE BEDSIDE (it.92): the bed the hero is walking to, to lie on when there. */
    let pendingRest: number | null = null;
    const makeInventory = (p: Player, slot: number): InventorySystem => {
      const inv = new InventorySystem(p, {
        heal: (fraction) => {
          const healed = world.combat.heal(p.id, Math.round(p.hpMax * fraction));
          if (p === player) audio.sfx('potion');
          if (healed > 0) {
            world.dmgText.show(p.pos.x, p.pos.y - 0.3, `+${healed}`, 'miss');
            world.ambience.burst(p.pos.x, p.pos.y, 0xd83030, 10);
          }
          if (p === player) updateOrb();
        },
        restore: (fraction) => {
          p.resource = Math.min(p.resourceMax, p.resource + p.resourceMax * fraction);
          if (p === player) audio.sfx('potion');
          world.ambience.burst(p.pos.x, p.pos.y, 0x6f86b8, 10);
        },
        buff: (kind, ticks) => {
          if (p !== player) return;
          audio.sfx('skillBuff');
          const label = kind === 'haste' ? 'HASTE' : kind === 'stone' ? 'STONE SKIN' : 'MIGHT';
          world.dmgText.show(p.pos.x, p.pos.y - 1.1, `${label} · ${Math.round(ticks / 60)} s`, 'crit');
          world.ambience.burst(p.pos.x, p.pos.y, kind === 'haste' ? 0x7fd67f : kind === 'stone' ? 0x9fb4e8 : 0xffb347, 12);
        },
        learned: (key) => {
          if (p !== player) return;
          audio.sfx('uiConfirm');
          world.dmgText.show(p.pos.x, p.pos.y - 1.1, `RECIPE LEARNED · ${key.toUpperCase()}`, 'crit');
          tutorial.notify('recipe', 'A recipe learned — lay it on a weapon at the camp forge (ENCHANT).');
        },
        refuse: (reason) => {
          if (p !== player) return;
          audio.sfx('uiBack');
          world.dmgText.show(p.pos.x, p.pos.y - 0.9, reason === 'nothing on the belt' ? 'NOTHING ON THE BELT · I' : reason === 'none left' ? 'NONE LEFT' : `NOT YET · ${reason}`, 'miss');
        },
        portal: () => {
          if (coop && slot !== leaderSlot) {
            if (slot === localSlot) leaderOnlyNote();
            return false;
          }
          if (world.town || transitioning || pendingPortal) return false;
          pendingPortal = true;
          return true;
        },
      });
      inv.slot = slot;
      return inv;
    };
    const inventories: Array<InventorySystem | null> = party.map((s) => (s ? makeInventory(s.player, s.slot) : null));
    if (pendingLocal) inventories[localSlot] = makeInventory(pendingLocal.player, localSlot); // The HUD binds before the JOIN lands.
    const stateSync = new StateSyncSystem(inputQueue);
    const inventoryUI = new InventoryUI(player, inputQueue, 0, buildPaperdollFrames);
    const tutorial = new TutorialUI();
    const minimap = new MinimapUI();
    // THE it.66 HUD: a status plate in the top-left corner and a system bar
    // in the top-right. Both are created before the first HUD update so no
    // call site has to guard against a half-built frame.
    const statusFrame = new StatusFrame(player, () => classPreviewFrames(player.archetype));
    const systemBar = new SystemBar();

    let pendingDescend = false;
    let pendingArena = false;
    let victoryShown = false;

    /** Cheat state survives floor transitions (worlds are rebuilt). */
    const cheatState = { god: false };

    // --- HUD refs -----------------------------------------------------------
    const deathNote = document.getElementById('death-note');
    const descendNote = document.getElementById('descend-note');
    const depthLabel = document.getElementById('depth-label');
    /** THE ZONE CHIP (it.84): under the map — a district in town, the depth below. */
    const setZoneLabel = (text: string): void => {
      const el = document.getElementById('zone-label');
      if (el && el.textContent !== text) el.textContent = text;
    };
    const rowMove = document.getElementById('row-move');
    const rowDirect = document.getElementById('row-direct');
    const interactHint = document.getElementById('interact-hint');
    const bossNote = document.getElementById('boss-note');
    const bossBar = document.getElementById('boss-bar');
    const bossBarFill = document.getElementById('boss-bar-fill');

    // Progression HUD (it.66): the corner plate carries level, XP and gold.
    // The globes, the XP strip and the purse it replaced were four elements
    // at three anchors; the plate is one element at one.
    const updateProgressHud = (): void => statusFrame.update();

    /** ACTIVE BUFF RINGS (it.48): rebuilt when the set changes, ticked every frame. */
    const buffIconHtml = (b: { icon: string | null; glyph: string }): string =>
      b.icon ? `<img src="${uiAssetUrl(`skills/${b.icon}.png`)}" alt="" draggable="false">` : `<span>${b.glyph}</span>`;
    const updateBuffHud = (): void => {
      const buffs = player.activeBuffs();
      const key = buffs.map((b) => b.id).join(',');
      if (key !== buffKey) {
        buffKey = key;
        hudBuffs.innerHTML = buffs
          .map((b) => `<div class="buff${b.debuff ? ' debuff' : ''}" data-buff="${b.id}" title="${b.name}">${buffIconHtml(b)}<i class="buff-ring"></i><b class="buff-time"></b></div>`)
          .join('');
        headBuffs.innerHTML = buffs.map((b) => `<div class="buff${b.debuff ? ' debuff' : ''}" data-buff="${b.id}">${buffIconHtml(b)}<i class="buff-ring"></i><b class="buff-time"></b></div>`).join('');
      }
      if (!buffs.length || player.action === 'dead') {
        headBuffs.classList.remove('show');
        return;
      }
      for (const b of buffs) {
        const frac = Math.max(0, Math.min(1, b.ticks / b.max));
        const secs = b.ticks < 600 ? (b.ticks / 60).toFixed(1) : `${Math.ceil(b.ticks / 60)}`; // "3.5s" under ten seconds (it.49).
        for (const root of [hudBuffs, headBuffs]) {
          const el = root.querySelector<HTMLElement>(`[data-buff="${b.id}"]`);
          if (!el) continue;
          el.style.setProperty('--p', `${Math.round(frac * 360)}deg`);
          const t = el.querySelector('.buff-time');
          if (t) t.textContent = `${secs}s`;
        }
      }
      const hp = world.camera.worldToCanvas(player.pos.x, player.pos.y, buffScratch);
      headBuffs.style.left = `${Math.round(hp.x)}px`;
      headBuffs.style.top = `${Math.round(hp.y - 92 * world.camera.currentZoom)}px`;
      headBuffs.classList.add('show');
    };

    /** Health changed: the corner plate is the sole readout (it.66). */
    const updateOrb = (): void => statusFrame.update();
    const updateDepth = (): void => {
      // THE FOREST AND THE QUARRY (it.85) carry their names, not a depth.
      const place = floor === FOREST_FLOOR ? 'THE DARK FOREST' : floor === MINES_FLOOR ? 'THE QUARRY MINES' : floor === INN_FLOOR ? 'THE GILDED STAG' : floor === CELLAR_FLOOR ? 'THE CELLAR' : floor === FARM_FLOOR ? 'THE FARMLANDS' : null;
      if (depthLabel) depthLabel.textContent = place ?? (floor === 0 ? 'THE TOWN' : floor < 0 ? 'THE COLISEUM' : `DEPTH ${ROMAN[floor - 1] ?? floor}`);
      setZoneLabel(place ?? (floor === 0 ? 'THE OLD QUARTER' : floor < 0 ? 'THE COLISEUM' : `DEPTH ${ROMAN[floor - 1] ?? floor} · THE CRYPT`));
      document.body.classList.toggle('in-town', floor === 0); // Deep edge shadow in town (it.57).
      document.body.classList.toggle('afire', floor === FARM_FLOOR && quests.farm !== 'done'); // THE FIELD BURNS (it.100).
      if (floor > 0 && floor <= MAX_DEPTH) stats.noteDepth(floor);
    };
    updateOrb();
    updateDepth();
    updateProgressHud();

    // --- Floor run timer ----------------------------------------------------
    const timerLabel = document.getElementById('timer');
    const descendSub = document.getElementById('descend-sub');
    let floorStartTick = 0;
    void floorStartTick;
    const formatTime = (ticks: number): string => {
      const totalSec = Math.floor(ticks / 60);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
    };

    on('input:modeChanged', ({ mode, playerId }) => {
      if (playerId !== localSlot) return;
      rowMove?.classList.toggle('active', mode === 'path');
      rowDirect?.classList.toggle('active', mode === 'direct');
    });

    // --- Per-floor world construction --------------------------------------
    /**
     * LAZY ATLASES (it.36): stream a floor's roster BEFORE anything is torn
     * down — the old floor keeps simulating while the fetch runs. A failed
     * fetch only costs sprites (procedural markers fall back); it can never
     * hang a transition (it.37 error boundary).
     */
    const preloadFloor = async (floorNum: number, mode: FloorMode): Promise<void> => {
      try {
        await spriteLib.ensure(animsForFloor(floorNum, mode));
      } catch (err) {
        console.warn('[floor] atlas preload failed — procedural fallback:', err);
      }
      loading.step('atlases'); // The floor's roster is in (it.62).
    };

    // SYNCHRONOUS world construction (it.37): no await between the old
    // floor's teardown and the new floor's first tick — the freeze was the
    // loop touching a destroyed world during the old async gap.
    /** LOOTABLE CHESTS (it.92): a district's chest the save says was opened. */
    const townChestOpened = (floorNum: number, x: number, y: number): boolean => (quests.chests ?? '').split(';').includes(`${floorNum}:${x},${y}`);
    /** THE EASTERN QUARTER (it.91): how the town is built from the errand's state. */
    /** THE CELLAR (it.97): the keeper has asked, so her back door is unbolted. */
    const cellarAsked = (): boolean => quests.cellar === 'active' || quests.cellar === 'done';
    const eastStateOf = (): EastState => (quests.east === 'done' || quests.east === 'cleared' ? 'cleared' : quests.east === 'open' ? 'open' : 'sealed');
    const LOOTER_LEVEL = 5;
    /** The looters at their posts, the first `killed` of them already counted dead; two champions among the twenty. */
    const spawnLooters = (pool: EnemyPool, posts: ReadonlyArray<{ x: number; y: number; kind: 'bandit' | 'brigand' }>, killed: number): void => {
      posts.forEach((b, i) => {
        if (i < killed) return;
        const e = pool.spawn(b.kind, b.x + 0.5, b.y + 0.5, LOOTER_LEVEL);
        if (i === 7 || i === 15) e.setAffix(AFFIXES[i % AFFIXES.length]);
      });
    };
    const buildWorld = (floorNum: number, mode: FloorMode = 'normal'): World => {
      const isArena = mode === 'arena';
      const isHub = mode === 'hub';
      const isColiseum = mode === 'coliseum';
      const isForest = mode === 'forest';
      const isMines = mode === 'mines';
      const isInn = mode === 'inn';
      const isCellar = mode === 'cellar';
      const isFarm = mode === 'farm';
      const seed = isHub ? (baseSeed ^ 0x70a1) >>> 0 : isColiseum ? (baseSeed ^ 0xc0115e) >>> 0 : isForest ? (baseSeed ^ 0xf0e57) >>> 0 : isMines ? (baseSeed ^ 0x3a1e5) >>> 0 : isInn ? (baseSeed ^ 0x1a5) >>> 0 : isCellar ? (baseSeed ^ 0xce11a5) >>> 0 : isFarm ? (baseSeed ^ 0xfa27) >>> 0 : ((baseSeed + floorNum * 7919) ^ (isArena ? 0xa11e4a : 0)) >>> 0;
      state.dungeonSeed = seed;
      // The forest and the quarry fight at the hero's own depth (it.85): a step past the deepest floor reached.
      const forestLevel = Math.max(2, Math.min(MAX_DEPTH, deepestFloor + 1));
      const minesLevel = Math.max(4, Math.min(MAX_DEPTH, deepestFloor + 2));
      const isMinesArena = isArena && floorNum === MINES_FLOOR; // THE QUARRY ARENA (it.88): past the hall's seal.
      // THE CELLAR (it.97) fights a step under the forest's measure: it is the errand a hero takes early.
      const cellarLevel = Math.max(2, Math.min(MAX_DEPTH, deepestFloor + 1));
      // THE FARMLANDS (it.100) are a pitched battle, so they fight a step above the woods.
      const farmLevel = Math.max(3, Math.min(MAX_DEPTH, deepestFloor + 2));
      const floorLevel = isForest ? forestLevel : isMines || isMinesArena ? minesLevel : isCellar ? cellarLevel : isFarm ? farmLevel : floorNum;
      const forestSafe = quests.forest === 'done';
      const forest = isForest ? buildForestLayout(seed, forestSafe) : null;
      // THE GILDED STAG (it.96/97): the room opens once the errand is paid; the
      // cellar door once the keeper asks for his drink back; the woman stands by
      // the bar once she has been walked up out of the dark.
      const inn = isInn ? buildInnLayout(seed, quests.east === 'done', cellarAsked(), quests.cellar === 'done') : null;
      const cellar = isCellar ? buildCellarLayout(seed, quests.cellar === 'done') : null;
      // THE FARMLANDS (it.100): burning while the company holds them, quiet once they do not.
      const farmWon = quests.farm === 'done';
      const farm = isFarm ? buildFarmLayout(seed, farmWon) : null;
      const layout = isHub ? buildTownLayout({ east: eastStateOf(), farmOpen: quests.farm === 'active' || quests.farm === 'done' }) : forest ? forest.layout : inn ? inn.layout : cellar ? cellar.layout : farm ? farm.layout : null;
      const memory: FloorMemory | undefined = isHub || isColiseum || isForest || isInn || isCellar || isFarm ? undefined : floors[memKey(floorNum, isArena)];
      // STRUCTURAL REVERT (it.15, user-directed): every depth uses the same
      // clean layout rules as floors 1–2 — depth identity comes from the
      // palette/tileset bands and prop dressing, not from layout gimmicks.
      // BOSS ARENAS (it.28): boss floors funnel into a dedicated sealed hall —
      // one vast open room, ringed by candelabra fire, no internal clutter.
      const dungeon = layout ? layout.map : isColiseum ? generateColiseumMap(seed) : isArena ? generateArenaMap(30, 22, seed) : isMines ? generateDungeon(MINES_W, MINES_H, seed, { pillars: true, minRoom: 5 }) : generateDungeon(MAP_W, MAP_H, seed);
      // Solid hearth props claim their tiles BEFORE anything reads the grid —
      // collision, pathing, rendering and prop placement all agree (it.16).
      let hearths: Array<{ x: number; y: number }>;
      if (isHub || isColiseum || isForest || isInn || isCellar || isFarm) {
        hearths = []; // The town, the coliseum, the forest, the inn, its cellar and the fields light themselves.
      } else if (isArena) {
        const room = dungeon.rooms[0];
        const mx = room.x + Math.floor(room.w / 2);
        const my = room.y + Math.floor(room.h / 2);
        hearths = [
          { x: room.x + 1, y: room.y + 1 },
          { x: room.x + room.w - 2, y: room.y + 1 },
          { x: room.x + 1, y: room.y + room.h - 2 },
          { x: room.x + room.w - 2, y: room.y + room.h - 2 },
          { x: mx, y: room.y + 1 },
          { x: mx, y: room.y + room.h - 2 },
          { x: room.x + 1, y: my - 3 },
          { x: room.x + 1, y: my + 3 },
        ];
        for (const h of hearths) {
          if (dungeon.grid[h.y * dungeon.width + h.x] === TILE_FLOOR) {
            dungeon.grid[h.y * dungeon.width + h.x] = TILE_BLOCKED;
          }
        }
      } else {
        hearths = planHearths(dungeon);
      }
      // THE QUARRY'S PLAN (it.85): gates on the way, keys in the side rooms, the hall at the end.
      // Remembered gates stand open before the scene builds (walls and sight read the grid).
      const minesPlan = isMines ? planMines(dungeon, seed) : null;
      if (minesPlan) {
        for (const d of minesPlan.doors) {
          if (memory?.doorsOpened?.includes(d.key)) {
            d.open = true;
            for (const tile of d.tiles) {
              dungeon.grid[tile.y * dungeon.width + tile.x] = TILE_FLOOR;
              const gp = minesPlan.props.find((pr) => pr.kind === 'gate' && pr.x === tile.x && pr.y === tile.y);
              if (gp) gp.variant = 'gate_open';
            }
          }
        }
      }

      const viewport = new Viewport(app);
      const camera = new Camera(app, viewport);
      camera.setLayoutZoom(screenLayout.state.stageZoom); // The screen's zoom bias (it.66).
      const scene = new SceneManager();
      const lighting = new Lighting();
      // Sight is blocked by ARCHITECTURE only — solid props don't cast fog.
      // The town is daylight-wide: every stall visible from the campfire.
      // TOWN LIGHT (it.45): dusk — full light only close to the hero, the rest
      // of the square falls to the torches, lanterns and the campfire.
      lighting.build(dungeon.width, dungeon.height, (gx, gy) => scene.isOpaque(gx, gy), isHub ? { sightRadius: 36, fullRadius: 5 } : isColiseum ? { sightRadius: 8, fullRadius: 99 } : isForest ? { sightRadius: 16, fullRadius: 4 } : isInn ? { sightRadius: 40, fullRadius: 30 } : isCellar ? { sightRadius: 8, fullRadius: 3 } : isFarm ? { sightRadius: 20, fullRadius: quests.farm === 'done' ? 24 : 9 } : undefined); // The inn is lit end to end (it.92); its cellar is not (it.97).
      if (isColiseum) lighting.omniscient = true; // No fog in the trial (it.53).
      // Theme bands: 1–2 stone crypts · 3–9 buried temple · 10–14 frozen
      // halls · 15–20 ember depths. Each band reads distinct at a glance.
      const theme = !spriteLib.loaded
        ? 'stone'
        : isHub || isColiseum || isForest
          ? 'town'
        : isInn
          ? 'inn'
        : isCellar
          ? 'cellar'
        : isFarm
          ? 'town'
        : isMines || isMinesArena
          ? 'stone'
        : floorNum <= 2
          ? 'stone'
          : floorNum <= 9
            ? 'temple'
            : floorNum <= 14
              ? 'frost'
              : 'ember';
      scene.build(dungeon, viewport, lighting, theme);
      // THE ZONES SING (it.89): the forest and the quarry carry their own beds.
      if (isHub) {
        audio.setMusic('town'); // The title theme keeps the town (Tristram rule).
      } else if (isColiseum) {
        audio.setMusic('boss', 5); // The trial fights to the warden's drums (it.53).
      } else if (isForest) {
        audio.setMusic('forest', floorNum);
      } else if (isInn) {
        audio.setMusic('town'); // The inn keeps the town's tune (it.92).
      } else if (isFarm) {
        audio.setMusic(quests.farm === 'done' ? 'town' : 'forest', floorNum); // The fields fight, then they rest (it.100).
      } else if (isCellar) {
        audio.setMusic('mines', floorNum); // Under the boards the tune goes cold (it.97).
      } else if (isMines) {
        audio.setMusic('mines', floorNum);
      } else {
        audio.setBgmDeep(!isMinesArena && floorNum >= 10); // The deep bands breathe a darker drone.
        // Boss arena music (it.28): the floor's intense track fades in the
        // moment the arena builds — and back to the dungeon BGM when we leave.
        audio.setBossMusic(isArena, floorNum);
      }

      const ambience = new Ambience(viewport);
      ambience.setBudget(perf.particleBudget); // A weak device gets a calmer crypt (it.66).
      if (spriteLib.loaded) ambience.setGlintFrames(spriteLib.anim('glint').frames[0]);
      const goldPiles = isHub || isColiseum || isForest || isInn || isCellar || isFarm ? [] : placeProps(dungeon, viewport, lighting, ambience, hearths);
      // Gold already scooped on a remembered floor stays gone.
      if (memory) {
        for (const i of memory.takenGold) {
          const pile = goldPiles[i];
          if (pile && !pile.taken) {
            pile.taken = true;
            pile.sprite.destroy();
            pile.glow.destroy();
          }
        }
      }
      // BOSS FLOORS (it.29): NO stairs on the base floor at all — the
      // farthest room IS the boss chamber threshold: a crimson seal burns at
      // its heart, and stepping ONTO the seal (it.87: not merely into the room)
      // teleports into the arena. Arena stairs sit at the hall's far east end, hidden
      // until every combatant inside the seal is dead.
      const arenaRoom = dungeon.rooms[0];
      const isPortalFloor = !isArena && !isHub && isBossFloor(floorNum);
      // THE QUARRY'S SEAL (it.88): the keeper's hall carries a seal like the
      // wardens' floors; past it lies the hydra's own arena. Once that arena
      // is cleared the hall holds the way home instead (the remembered clear).
      const minesHallCleared = isMines && !!floors[memKey(floorNum, true)]?.arenaCleared;
      let arenaThreshold: World['arenaThreshold'] = null;
      let bossSigil: { x: number; y: number } | null = null;
      let stairs: { x: number; y: number; sprite: Sprite };
      let sealRoom: { x: number; y: number; w: number; h: number } | null = null;
      if (isPortalFloor) {
        let best = dungeon.rooms[dungeon.rooms.length - 1];
        let bestDist = -1;
        for (const room of dungeon.rooms) {
          const d = Math.hypot(room.x + room.w / 2 - dungeon.spawn.x, room.y + room.h / 2 - dungeon.spawn.y);
          if (d > bestDist) {
            bestDist = d;
            best = room;
          }
        }
        sealRoom = best;
      } else if (isMines && minesPlan && !minesHallCleared) {
        sealRoom = minesPlan.bossRoom;
      }
      if (sealRoom) {
        const best = sealRoom;
        arenaThreshold = { x: best.x, y: best.y, w: best.w, h: best.h };
        const gx = best.x + Math.floor(best.w / 2);
        const gy = best.y + Math.floor(best.h / 2);
        const s = worldToScreen(gx, gy, vec2());
        const seal = new Sprite(assets.get('glow'));
        seal.anchor.set(0.5);
        seal.blendMode = 'add';
        seal.tint = 0xd0303a; // The warden's seal smolders blood-red.
        seal.position.set(s.x, s.y);
        viewport.ambienceLayer.addChild(seal);
        ambience.addGlow(seal, gx, gy, 0.55, 3.4);
        lighting.addSource(gx, gy, 3.2, 210, 60, 60, 0.55);
        bossSigil = { x: gx + 0.5, y: gy + 0.5 }; // BOSS SIGIL (it.48): drawn once the VFX layer exists.
        // The quarry keeps its untouchable stair (it.85): its seal is the threshold, never the stair.
        stairs = isMines ? placeStairs(dungeon, viewport, lighting, { hidden: true, at: { x: 1, y: 1 } }) : { x: gx, y: gy, sprite: seal };
      } else {
        stairs = placeStairs(
          dungeon,
          viewport,
          lighting,
          layout
            ? { at: isForest || isInn || isCellar || isFarm ? { x: 1, y: 1 } : layout.gate, hidden: true } // The dungeon gate: the archway IS the model — no stair sprite in the opening (it.47).
            : isMines
              ? { hidden: true, at: { x: 1, y: 1 } } // The quarry has no stair (a wall tile no one can touch): the way home is the teleporter after the hall (it.85).
            : isArena
              ? { hidden: true, at: { x: arenaRoom.x + arenaRoom.w - 3, y: arenaRoom.y + Math.floor(arenaRoom.h / 2) } }
              : isColiseum
                ? { hidden: true, at: { x: 1, y: 1 } } // No stair in the trial (it.53).
                : undefined,
        );
      }

      const loot = new LootSystem(viewport, seed);
      loot.ilvl = ilvlForDepth(Math.max(1, floorLevel)); // What this floor drops (it.78; the forest and the quarry at the hero's depth, it.85).
      const chests = new ChestSystem(viewport, lighting, loot, seed);
      if (!isArena && !isHub && !isColiseum && !isForest && !isInn && !isCellar && !isFarm) chests.place(dungeon, [stairs, ...(minesPlan?.keys ?? [])]); // The arena floors stay clean; a chest never sits on a key (it.85).
      // LOOTABLE CHESTS (it.92): the districts' small chests, on the layout's spots, the opened ones remembered by the save.
      if (layout?.chests) for (const c of layout.chests) if (!townChestOpened(floorNum, c.x, c.y)) chests.spawnAt(c.x, c.y, false, true);
      // THE KEYS (it.85): ground items in their side rooms; a taken key stays taken.
      if (minesPlan) {
        for (const k of minesPlan.keys) {
          if (memory?.keysTaken?.includes(k.key)) continue;
          loot.spawnId(`quarry_key_${k.key}`, k.x + 0.5, k.y + 0.5);
          k.uid = loot.findNearest(k.x + 0.5, k.y + 0.5, 0.4)?.uid ?? -1;
        }
      }
      if (memory) chests.applyMemory(memory.openedChests);
      const pathfinder = new Pathfinder(dungeon.width, dungeon.height, scene.isWalkable);
      // Attack/approach range follows the wielded weapon (reach or fire range).
      // ONE LOCOMOTION SYSTEM PER SEAT (it.59): each answers only its own commands.
      const makeMovement = (hero: Player, slot: number): MovementSystem => {
        const mv = new MovementSystem(hero, pathfinder, scene.isWalkable, loot, chests, () => Math.max(ATTACK_RANGE, hero.weaponProfile.range), viewport);
        mv.playerId = slot;
        return mv;
      };
      const movements: Array<MovementSystem | null> = party.map((seat) => (!seat || seat.gone || seat.pending ? null : makeMovement(seat.player, seat.slot)));
      // The local joiner (it.60) drives nothing until its JOIN lands; a throwaway keeps `movement` non-null.
      const movement = movements[localSlot] ?? makeMovement(player, localSlot);
      // Enemy queries are wired through a late-bound pool reference
      // (combat must exist before the pool, whose AI deps call into combat).
      let enemiesRef: EnemyPool | null = null;
      /** TARGETING query: fog-gated (you can only aim at what you can see).
       *  In co-op (it.59) the fog is per-screen, so the gate is pure sim: line of sight. */
      const findNearestEnemy = (x: number, y: number, range: number): Entity | null => {
        let best: Entity | null = null;
        let bestDist = range;
        enemiesRef?.forEachActive((enemy) => {
          if (enemy.hp <= 0 || enemy.action === 'dead') return;
          if (coop) {
            if (!hasLineOfSight(Math.floor(x), Math.floor(y), Math.floor(enemy.pos.x), Math.floor(enemy.pos.y), scene.isOpaque)) return;
          } else if (!lighting.isVisible(Math.floor(enemy.pos.x), Math.floor(enemy.pos.y))) return;
          const d = Math.hypot(enemy.pos.x - x, enemy.pos.y - y);
          if (d <= bestDist) {
            bestDist = d;
            best = enemy;
          }
        });
        return best;
      };
      /** COLLISION query: pure simulation — projectiles ignore fog entirely. */
      const findEnemyAt = (x: number, y: number, radius: number): Entity | null => {
        let best: Entity | null = null;
        let bestDist = radius;
        enemiesRef?.forEachActive((enemy) => {
          if (enemy.hp <= 0 || enemy.action === 'dead') return;
          const d = Math.hypot(enemy.pos.x - x, enemy.pos.y - y);
          if (d <= bestDist) {
            bestDist = d;
            best = enemy;
          }
        });
        return best;
      };
      const combat = new CombatSystem(seatPlayers, movements, scene.isWalkable, findNearestEnemy, seed);
      combat.godMode = cheatState.god; // Cheats survive the floor transition.
      // Untargeted swings aim at the mouse cursor (it.33) — per seat since it.59.
      combat.aimDir = aimFor;
      // AoE cleave sweep: every living enemy in range (fog-independent sim).
      combat.enemiesNear = (x, y, r) => {
        const out: Entity[] = [];
        enemiesRef?.forEachActive((enemy) => {
          if (enemy.hp <= 0 || enemy.action === 'dead') return;
          if (Math.hypot(enemy.pos.x - x, enemy.pos.y - y) <= r) out.push(enemy);
        });
        return out;
      };
      // THE STATUS ENGINE (it.80): the floor's wounds over time, fed by the weapons' procs.
      const status = new StatusSystem({
        enemyById: (id) => {
          const e = state.getEntity(id);
          return e instanceof Enemy ? e : null;
        },
        enemiesNear: (x, y, r) => (combat.enemiesNear?.(x, y, r) ?? []) as Enemy[],
        combat: () => combat,
        burst: (x, y, c, n) => ambience.burst(x, y, c, n),
        text: (x, y, m, st) => dmgText.show(x, y, m, st),
        vfx: (anim, x, y, opts) => {
          vfx.play(anim, x, y, opts);
        },
      });
      combat.status = status;
      const projectiles = new ProjectileSystem(viewport, scene.isWalkable, seatPlayers, findEnemyAt);
      const vfx = new VfxSystem(viewport.objectLayer, viewport.ambienceLayer);
      const gore = new GoreSystem(viewport.groundLayer);
      projectiles.combat = combat;
      combat.fireProjectile = (opts) => {
        audio.sfx(opts.kind === 'bolt' ? 'bolt' : 'bow');
        projectiles.spawn(opts);
      };
      const dmgText = new DamageTextSystem(viewport.ambienceLayer);

      /**
       * PERMANENT battlefield memory: the death animation's final frame stays
       * on the ground as a corpse, ringed by dark blood stains. Both are fog-
       * registered ground props — the floor remembers every kill.
       */
      const corpseScratch = vec2();
      const leaveCorpse = (enemy: Enemy): void => {
        const x = enemy.pos.x;
        const y = enemy.pos.y;
        const gx = Math.floor(x);
        const gy = Math.floor(y);
        const s = worldToScreen(x, y, corpseScratch);
        for (let i = 0; i < 2; i++) {
          const stain = new Sprite(assets.get('splat'));
          stain.anchor.set(0.5);
          stain.tint = 0x561410;
          stain.alpha = 0.8;
          stain.rotation = Math.random() * Math.PI * 2;
          stain.scale.set(0.8 + Math.random() * 0.7, 0.55 + Math.random() * 0.4);
          stain.position.set(s.x + (Math.random() - 0.5) * 20, s.y + 6 + (Math.random() - 0.5) * 10);
          viewport.groundLayer.addChild(stain);
          lighting.registerProp(gx, gy, stain);
        }
        const packSprite = enemy.def.sprite;
        if (packSprite && spriteLib.loaded && spriteLib.hasAnim(packSprite.walk) && spriteLib.hasAnim(packSprite.death)) {
          const anim = spriteLib.anim(packSprite.death);
          const frames = anim.frames[enemy.renderDir] ?? anim.frames[0];
          const corpse = new Sprite(frames[frames.length - 1]);
          corpse.anchor.set(0.5, packSprite.anchorY);
          corpse.scale.set(enemy.bodyScale);
          corpse.position.set(s.x, s.y + 2);
          viewport.groundLayer.addChild(corpse);
          lighting.registerProp(gx, gy, corpse);
        }
      };

      // THE ID BASE (it.73): the pool registers every foe it can hold right
      // here, so this is the counter a snapshot joiner must start from — set
      // before the pool exists, and read before it exists.
      if (pendingIdBase !== null) {
        state.nextId = pendingIdBase;
        pendingIdBase = null;
      }
      const idBase = state.nextId;
      const enemies = new EnemyPool(
        viewport,
        {
          pathfinder,
          isWalkable: scene.isWalkable,
          isOpaque: scene.isOpaque,
          // CO-OP (it.59): every body hunts the nearest unhidden living hero.
          getPlayerPos: (self) => combat.nearestPlayer(self.pos.x, self.pos.y)?.pos ?? player.pos,
          meleeStrike: (src, min, max, toHit, reach, effect) =>
            combat.enemyStrike(src, min, max, toHit, reach, effect),
          shootArrow: (src, tx, ty, min, max, toHit) => {
            // The Ember Maw breathes the full Firespray; lesser casters crack
            // fireballs; archers loose arrows (it.26).
            if (src.def.kind === 'bossEmber' || src.def.kind === 'bossHollowLich') audio.sfx('bossCast');
            else audio.sfx(src.def.projectile === 'bolt' ? 'bolt' : 'bow');
            projectiles.spawn({
              faction: 'enemy',
              kind: src.def.projectile ?? 'arrow',
              sourceId: src.id,
              x: src.pos.x,
              y: src.pos.y,
              targetX: tx,
              targetY: ty,
              minDamage: min,
              maxDamage: max,
              toHit,
            });
          },
          // Rogue Vanish (it.32): a hidden player cannot be seen or hunted.
          isPlayerHidden: (self) => combat.nearestPlayer(self.pos.x, self.pos.y)?.stealthed ?? false,
          // Hollow King at half health: two Ember Wretches claw out of the floor.
          summonMinions: (x, y) => {
            audio.sfx('summon');
            for (const off of [
              { dx: 1.2, dy: 0.4 },
              { dx: -1.2, dy: -0.4 },
            ]) {
              const sx = scene.isWalkable(Math.floor(x + off.dx), Math.floor(y + off.dy)) ? x + off.dx : x;
              const sy = scene.isWalkable(Math.floor(x + off.dx), Math.floor(y + off.dy)) ? y + off.dy : y;
              enemies.spawn('fallen', sx, sy, floorNum);
            }
            ambience.burst(x, y, 0xcab87a, 14);
          },
          onDeathComplete: (enemy) => {
            leaveCorpse(enemy);
            enemies.kill(enemy);
          },
        },
        scene.isWalkable,
      );
      enemiesRef = enemies;
      // ARENA COMBATANTS (it.28): the keeper holds the east of the hall with a
      // small honor guard of the depth's flesh. Regular floors roll their
      // seeded packs — boss floors now spawn NO boss outside the arena.
      let boss: Enemy | null = null;
      let generalBody: Enemy | null = null;
      const killed = new Set<number>(memory?.killedSpawns ?? []);
      const arenaAlreadyCleared = isArena && !!memory?.arenaCleared;
      if (isHub || isColiseum || isInn || arenaAlreadyCleared || (isForest && forestSafe) || (isCellar && quests.cellar === 'done') || (isFarm && farmWon)) {
        // No enemies in town; a cleared arena stays empty with its stair open; a cleared forest is a safe road (it.87).
      } else if (isArena) {
        const room = dungeon.rooms[0];
        const cx = room.x + Math.floor(room.w * 0.68) + 0.5;
        const cy = room.y + Math.floor(room.h / 2) + 0.5;
        // THE QUARRY'S KEEPER (it.88): the hydra holds its own arena past the seal, with a pit guard.
        const kind: EnemyKind = isMinesArena ? 'hydra' : BOSS_LADDER[Math.min(Math.floor(floorNum / 5), BOSS_LADDER.length) - 1];
        boss = enemies.spawn(kind, cx, cy, isMinesArena ? minesLevel + 3 : (BOSS_LEVELS[floorNum] ?? floorNum + 2));
        if (isMinesArena) boss.setAffix('vampiric'); // The keeper drinks what it bites.
        const pool = isMinesArena ? MINES_POOL : kindPoolFor(floorNum);
        const rand = mulberry32(seed ^ 0x9a7e0a);
        const guardRing = [
          { dx: -2.6, dy: -2.1 },
          { dx: -2.6, dy: 2.1 },
          { dx: 2.4, dy: -2.4 },
          { dx: 2.4, dy: 2.4 },
          { dx: -4.2, dy: 0 },
        ];
        for (const off of guardRing) {
          const guardBody = enemies.spawn(pool[Math.floor(rand() * pool.length)], cx + off.dx, cy + off.dy, isMinesArena ? minesLevel : floorNum);
          const affixRoll = rand();
          if (affixRoll < 0.15) guardBody.setAffix(AFFIXES[Math.floor((affixRoll / 0.15) * 3) % 3]); // Elite honor guard (it.53).
        }
      } else {
        spawnFloorEnemies(dungeon, enemies, floorLevel, stairs, seed, killed, isForest ? FOREST_POOL : isMines ? MINES_POOL : isCellar ? CELLAR_POOL : isFarm ? FARM_POOL : undefined);
        // THE GENERAL (it.100) stands at the head of the lane his company holds. He
        // is spawned with them, before the tally is taken, so the field is not
        // "clear" while he is still on it.
        if (isFarm && farm) generalBody = enemies.spawn('general', farm.farm.general.x + 0.5, farm.farm.general.y + 0.5, floorLevel + 2);
        // THE QUARRY'S KEEPER (it.88) waits in its arena past the hall's seal, not in the hall.
      }
      // ENEMIES REMAINING (it.88): what the floor woke with.
      let foesAtStart = 0;
      enemies.forEachActive((e) => {
        if (e.hp > 0) foesAtStart++;
      });
      // A remembered-cleared arena (it.58): no stair — the teleporter rises on the first tick.
      // RITUAL CIRCLES (it.48): the wardens' sigil marks BOSS floors only —
      // the arena's heart and the seal room on depths V / X / XV / XX.
      if (isArena) {
        const room = dungeon.rooms[0];
        vfx.play('vfx_pentagram', room.x + room.w / 2, room.y + room.h / 2, { loop: true, fps: 8, scale: 1.6, depthBias: -60, alpha: 0.85 });
      } else if (bossSigil) {
        vfx.play('vfx_pentagram', bossSigil.x, bossSigil.y, { loop: true, fps: 7, scale: 1.35, depthBias: -60, alpha: 0.85 });
      }

      // TOWN DRESSING (it.39): cottages, stall, campfire, torches, well,
      // the stash chest, and the folk who live here.
      // THE TRIAL COLISEUM (it.53): dressing + wave state.
      let coliseumState: ColiseumState | null = null;
      if (isColiseum) {
        const cmap = dungeon as ColiseumMap;
        const dressing = dressColiseum(cmap, viewport, lighting, ambience);
        coliseumState = { waves: 5, wave: 0, phase: 'intermission', timer: 5 * 60, alive: 0, pads: cmap.pads, center: cmap.center, exit: null, startActive: 0, update: dressing.update, destroy: dressing.destroy };
      }
      let townState: World['town'] = null;
      // THE QUARRY'S DRESSING (it.85): pit props, torches and the iron gates, drawn by the town's dresser.
      const minesDressing = minesPlan ? placeTownProps(bareLayout(dungeon as TownMap, minesPlan.props, 'THE QUARRY MINES'), viewport, lighting, ambience) : null;
      if (layout) {
        const dressing = placeTownProps(layout, viewport, lighting, ambience);
        // AMBIENT CHATTER (it.91): every peaceful head in town speaks a word now and then.
        // THE STREETS (it.92): the folk walk the district's roads, path-found, and keep to them three times in four.
        const streets = { roads: layout.road, mapWidth: layout.map.width };
        const villagers = isForest
          ? new Villagers(viewport.objectLayer, scene.isWalkable, layout.wander, forestSafe ? 6 : 0, null, layout.guards, null, {}, null, { chatter: forestSafe ? TOWN_WORDS : undefined, sheets: STREET_FOLK }) // A cleared forest keeps folk and sentries (it.87).
          : isCellar
            ? new Villagers(viewport.objectLayer, scene.isWalkable, layout.wander, 0, null, [], null)
          : isFarm
            ? new Villagers(viewport.objectLayer, scene.isWalkable, layout.wander, farmWon ? 8 : 0, null, [], null, {}, null, { chatter: farmWon ? TOWN_WORDS : undefined, sheets: STREET_FOLK })
          : isInn
            ? new Villagers(viewport.objectLayer, scene.isWalkable, layout.wander, 5, null, [], null, {}, layout.inn?.keeper ?? null, { chatter: TAVERN_WORDS, keeperAnim: 'folk_walk', keeperTint: 0xe8d8b8 })
            : new Villagers(viewport.objectLayer, scene.isWalkable, layout.wander, 9, layout.merchant, [...layout.guards, layout.arenaMaster], layout.alchemist, {}, layout.gatekeeper ?? null, { chatter: TOWN_WORDS, sheets: STREET_FOLK, ...streets });
        // THE MARKET WARD (it.84): its own folk, the jeweler in gold, the scribe in ice-blue, the bowyer a ranger, two sentries at the gate.
        const villagers2 = isForest || isInn || isCellar || isFarm
          ? new Villagers(viewport.objectLayer, scene.isWalkable, layout.wander2, 0, null, [], null)
          : new Villagers(viewport.objectLayer, scene.isWalkable, layout.wander2, 8, layout.jeweler, [...layout.guards2, layout.bowyer], layout.scribe, { merchant: 0xffe2a8, alchemist: 0xa8dcff }, null, { chatter: TOWN_WORDS, sheets: STREET_FOLK, ...streets });
        // THE EASTERN QUARTER (it.91): the refugees huddled before the barricade with the innkeeper among
        // them - or, the quarter reclaimed, ten of the folk on the burnt square and the keeper behind his counter.
        const east = layout.east;
        const villagers3 = isHub && east
          ? east.state === 'cleared'
            ? new Villagers(viewport.objectLayer, scene.isWalkable, east.wander3, 12, null, [], null, {}, null, { chatter: RECLAIMED_WORDS, sheets: STREET_FOLK, ...streets }) // The keeper is behind his own bar now (it.92).
            : new Villagers(viewport.objectLayer, scene.isWalkable, east.refuge, 4, null, [], null, {}, east.innkeeper, { chatter: REFUGEE_WORDS, sheets: STREET_FOLK, keeperAnim: 'folk_walk', keeperTint: 0xe8d8b8 })
          : null;
        const campHeroes = new CampHeroes(viewport.objectLayer, chosenClass, layout.campSpots, layout.campfire);
        // THE TRAINING GROUND (it.90): a passive foe stands on every dummy tile - struck, it flinches and heals.
        if (isHub) for (const p of layout.props) if (p.kind === 'dummy') enemies.spawn(p.variant === 'dummy_b' ? 'dummyB' : 'dummy', p.x + 0.5, p.y + 0.5, 1);
        // THE LOOTERS (it.91): while the errand is open, the quarter's posts hold what the militia has not yet counted dead.
        if (isHub && east && east.state === 'open') spawnLooters(enemies, east.banditPosts, Number(quests.looters ?? 0));
        // COLLISION AUDIT (it.40): no walkable pocket may be sealed off by props.
        const audit = isHub ? auditTownLayout(layout) : { unreachable: [], missing: [] };
        if (audit.unreachable.length || audit.missing.length) {
          console.warn('[town] layout audit:', audit.unreachable.length, 'unreachable tiles', audit.unreachable.slice(0, 12), 'missing:', audit.missing);
        }
        townState = {
          layout,
          villagers,
          villagers2,
          villagers3,
          gates: dressing.gates,
          occluders: dressing.occluders,
          interactables: dressing.interactables,
          setPromptAt: dressing.setPromptAt,
          setPlate: dressing.setPlate,
          stashSprite: dressing.stashSprite,
          cellarGirl: dressing.cellarGirl,
          campHeroes,
          update: dressing.update,
          destroyDressing: dressing.destroy,
        };
      }

      // SARAH (it.98): she is not standing in the open while the vault still has
      // something in it. Built with the floor, hidden and unreachable until the
      // last monster is down - `revealCellarGirl` puts her back.
      if (isCellar && townState?.cellarGirl && quests.cellar !== 'done') {
        let stillDown = 0;
        enemies.forEachActive((e) => {
          if (e.hp > 0 && e.action !== 'dead') stillDown++;
        });
        if (stillDown > 0) {
          const g = townState.cellarGirl;
          // Taken OUT OF THE LAYER, not just hidden: the ambience rewrites `visible`
          // from the fog every frame and the culler owns `renderable`, so a detached
          // sprite is the only hiding place that holds.
          if (g.sprite?.parent) g.sprite.parent.removeChild(g.sprite);
          const at = townState.interactables.findIndex((i) => i.id === g.id);
          if (at >= 0) townState.interactables.splice(at, 1);
        }
      }

      // THE CITY'S OWN (it.100): the guards and their officer form up on the muster
      // ground. Only while the field is contested - once it is won they have gone home.
      let squad: Squad | null = null;
      if (isFarm && farm) {
        ambience.setSmoke(!farm.farm.won); // The crypt's mist reads as smoke over a burning field.
        if (!farm.farm.won) squad = new Squad(viewport.objectLayer, scene.isWalkable, farm.farm.squad, { rate: 1.0, damage: 11, leash: 17 });
      }

      // Target ring: unmistakable marker under whatever the player is striking.
      const targetRing = new Sprite(assets.get('targetRing'));
      targetRing.anchor.set(0.5, 0.5);
      targetRing.visible = false;
      viewport.groundLayer.addChild(targetRing);

      // The hero's own warm light: an additive halo that keeps him and anything
      // pressing in on him readable, even where the crypt light never reaches.
      const playerHalo = new Sprite(assets.get('glow'));
      playerHalo.anchor.set(0.5);
      playerHalo.blendMode = 'add';
      playerHalo.tint = 0xffa050;
      playerHalo.scale.set(2.8);
      playerHalo.alpha = 0.32;
      viewport.ambienceLayer.addChild(playerHalo);

      // Floor-1 tutorial anchors: waystone + proximity hints — FIRST visit only
      // (it.48): a rebuilt depth I (back from town) no longer grows a second
      // portal-looking stone beside the arrival spot.
      tutorial.setZones([]); // A rebuilt floor carries no stale zones (it.48).
      if (floorNum === 1 && !memory) {
        const waystone = placeWaystone(dungeon, viewport, lighting, ambience);
        tutorial.setZones([
          {
            id: 'move',
            x: dungeon.spawn.x + 0.5,
            y: dungeon.spawn.y + 0.5,
            radius: 2.5,
            text: screenLayout.state.touch
              ? 'Push the left thumb-stick — or tap the ground — to move through the dark.'
              : 'Click the ground — or hold W A S D — to move through the dark.',
          },
          {
            id: 'strike',
            x: waystone.x + 0.5,
            y: waystone.y + 0.5,
            radius: 2.2,
            text: screenLayout.state.touch
              ? 'The waystone hums: hold the crossed blades to swing. Tap a foe to hunt it down.'
              : 'The waystone hums: press SPACE to swing your blade. Click a foe to hunt it down.',
          },
          {
            id: 'stairs',
            x: stairs.x + 0.5,
            y: stairs.y + 0.5,
            radius: 4.5,
            text: 'Stairs lead ever downward. The dark grows crueler below.',
          },
        ]);
      } else {
        tutorial.setZones([]);
      }

      // The party joins this floor's stage at its entrance (it.59: spread around it).
      for (const seat of liveSeats()) viewport.objectLayer.addChild(seat.player.container);
      placeParty(dungeon.spawn.x + 0.5, dungeon.spawn.y + 0.5, scene.isWalkable);

      // Screen-space pickers for attack/loot clicks.
      const pickScratch = vec2();
      const pickEnemy = (canvasX: number, canvasY: number): number | null => {
        const zoom = camera.currentZoom;
        // HITBOX RECALIBRATION (it.29): each enemy's box comes from its LIVE
        // rendered sprite (texture × rig scale × anchor via clickBox) so a
        // click on any part of the visible body registers.
        let bestId: number | null = null;
        let bestDist = Infinity;
        enemies.forEachActive((enemy) => {
          if (enemy.hp <= 0) return;
          if (!lighting.isVisible(Math.floor(enemy.pos.x), Math.floor(enemy.pos.y))) return;
          const feet = camera.worldToCanvas(enemy.pos.x, enemy.pos.y, pickScratch);
          const box = enemy.clickBox();
          const halfW = box.halfW * zoom + 4;
          const yTop = feet.y + box.top * zoom - 4;
          const yBot = feet.y + box.bottom * zoom + 6;
          const dx = canvasX - feet.x;
          if (dx < -halfW || dx > halfW || canvasY < yTop || canvasY > yBot) return;
          const centerDist = Math.abs(dx) + Math.abs(canvasY - (yTop + yBot) / 2);
          if (centerDist < bestDist) {
            bestDist = centerDist;
            bestId = enemy.id;
          }
        });
        return bestId;
      };
      const pickItem = (canvasX: number, canvasY: number): number | null =>
        loot.pickAtCanvas(canvasX, canvasY, camera, lighting);
      const pickChest = (canvasX: number, canvasY: number): number | null => {
        if (townState) {
          // Town: clicking the stall or the stash walks up and opens it.
          const zoom = camera.currentZoom;
          for (const it of townState.interactables) {
            const p = camera.worldToCanvas(it.x, it.y, pickScratch);
            if (Math.abs(canvasX - p.x) <= 44 * zoom && canvasY >= p.y - 70 * zoom && canvasY <= p.y + 14 * zoom) return it.id;
          }
          return chests.pickAtCanvas(canvasX, canvasY, camera); // A TOWN CHEST (it.92).
        }
        return chests.pickAtCanvas(canvasX, canvasY, camera);
      };
      const input = new InputBindings(app.canvas, camera, inputQueue, localSlot, scene.isWalkable, pickEnemy, pickItem, pickChest);
      input.aimSync = !!coop; // The cursor rides the command stream (it.59).
      // GROUND INSPECTION (it.77): the cursor resting on a fallen item raises
      // the item card, laid beside what the hero wears in that slot.
      input.onHoverItem = (uid, x, y) => {
        const item = uid === null ? null : loot.getItem(uid);
        const def = item ? itemDef(item.itemId) : undefined;
        if (!def) {
          hideItemTip();
          return;
        }
        showItemTip(def, x, y, 'on the ground · click to claim', def.slot === 'consumable' ? undefined : wornFor(player, def));
      };

      lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
      // A ZONE REMEMBERS WHAT IT SHOWED YOU (it.98). Every floor now restores its own
      // explored bitset - the crypt through its FloorMemory, and the town-shaped floors
      // (the town, the forest, the quarry, the taproom, the vault) through the same
      // record, which `captureFloor` writes a fog-only entry into for them.
      const rememberedFog = memory?.explored ?? floors[memKey(floorNum, isArena)]?.explored;
      if (rememberedFog) lighting.unpackExplored(base64ToBytes(rememberedFog));
      minimap.setWorld(dungeon, lighting, stairs);
      // THE MARKS (it.85): keys, gates, the keeper and the way home — each only once its tile is explored.
      minimap.setMarkers(() => {
        const out: Array<{ x: number; y: number; kind: 'key' | 'door' | 'door-open' | 'boss' | 'portal' | 'foe'; always?: boolean }> = [];
        if (minesPlan) {
          for (const k of minesPlan.keys) if (k.uid >= 0 && loot.getItem(k.uid)) out.push({ x: k.x, y: k.y, kind: 'key' });
          for (const d of minesPlan.doors) out.push({ x: d.x, y: d.y, kind: d.open ? 'door-open' : 'door' });
          if (!world.arenaCleared) out.push({ x: minesPlan.boss.x, y: minesPlan.boss.y, kind: 'boss' }); // The seal (it.88).
          if (world.victoryPortal) out.push({ x: world.victoryPortal.x, y: world.victoryPortal.y, kind: 'portal' });
        }
        // THE EASTERN QUARTER (it.91): every looter a red pip while the errand is open; the inn's door once it is cleared.
        const east = isHub ? layout?.east : undefined;
        if (east) {
          if (quests.east === 'open') enemies.forEachActive((e) => {
            if (e.hp > 0 && e.action !== 'dead' && LOOTER_KINDS.has(e.def.kind)) out.push({ x: Math.floor(e.pos.x), y: Math.floor(e.pos.y), kind: 'foe', always: true });
          });
          else if (quests.east === 'cleared') out.push({ x: east.door.x, y: east.door.y + 1, kind: 'portal', always: true });
        }
        // THE FOREST ERRAND (it.91): its beasts marked the same way.
        if (isForest && quests.forest === 'active') enemies.forEachActive((e) => {
          if (e.hp > 0 && e.action !== 'dead') out.push({ x: Math.floor(e.pos.x), y: Math.floor(e.pos.y), kind: 'foe', always: true });
        });
        return out;
      });
      const unsubscribe = eventBus.on('player:tileChanged', ({ gx, gy, playerId }) => {
        if (playerId !== localSlot) return; // The fog is the LOCAL hero's eyes (it.59).
        lighting.updateVisibility(gx, gy);
        minimap.markDirty();
      });

      // PREFETCH (it.36): the next floor's roster streams in the background
      // while this one is played, so the next descent is instant.
      if (!isArena && floorNum < MAX_DEPTH) void spriteLib.ensure(animsForFloor(floorNum + 1, 'normal'));
      if (isPortalFloor) void spriteLib.ensure(animsForFloor(floorNum, 'arena'));
      if (!isHub) void spriteLib.ensure(animsForFloor(0, 'hub')); // A portal home is always one scroll away.

      return {
        dungeon,
        viewport,
        camera,
        scene,
        lighting,
        ambience,
        loot,
        movement,
        movements,
        makeMovement,
        combat,
        projectiles,
        enemies,
        chests,
        input,
        stairs,
        isArena,
        arenaCleared: arenaAlreadyCleared || minesHallCleared, // SOFTLOCK FIX (it.44): a remembered clear stays cleared.
        arenaThreshold,
        goldPiles,
        status,
        targetRing,
        playerHalo,
        dmgText,
        vfx,
        gore,
        boss,
        bossSeen: false,
        unsubscribe,
        town: townState,
        killed,
        idBase,
        coliseum: coliseumState,
        victoryPortal: null,
        mines: minesPlan ? { ...minesPlan, gates: minesDressing?.gates ?? new Map(), level: minesLevel, dressing: minesDressing! } : null,
        foesAtStart,
        squad,
        farmGeneral: generalBody,
      };
    };

    const destroyWorld = (w: World): void => {
      w.unsubscribe();
      w.town?.villagers.destroy();
      w.town?.villagers2.destroy();
      w.town?.villagers3?.destroy();
      w.mines?.dressing.destroy();
      w.town?.campHeroes.destroy();
      w.town?.destroyDressing();
      w.coliseum?.destroy();
      w.squad?.destroy();
      teleporterFx = null;
      w.input.destroy();
      hideItemTip(); // No card outlives its floor (it.77).
      w.camera.destroy(); // The wheel listener went with the camera (it.74).
      w.projectiles.clear();
      w.vfx.clear();
      w.gore.clear();
      w.enemies.destroyAll();
      // The heroes survive the viewport teardown — but only detach them if
      // they still stand in THIS world (the next one may already own them).
      for (const seat of liveSeats()) if (seat.player.container.parent === w.viewport.objectLayer) seat.player.container.removeFromParent();
      w.viewport.destroy();
    };

    await preloadFloor(floor, modeFor(floor));
    let world = buildWorld(floor, (coop?.snapshot?.arena || loaded?.arena) && isBossFloor(floor) ? 'arena' : modeFor(floor));
    // A rotation re-biases the camera for its new box, and a slipping frame
    // rate thins the embers — both per run, because the world is per run.
    subsOnLayout.push(layout.onReflow((s) => world.camera.setLayoutZoom(s.stageZoom)));
    subsOnLayout.push(perf.onQuality(() => world.ambience.setBudget(perf.particleBudget)));

    /** Remember the current dungeon floor exactly as the hero leaves it (it.39). */
    const captureFloor = (): void => {
      if (world.coliseum) return; // The trial has no fog and is never remembered.
      const key = memKey(floor, world.isArena);
      if (world.town) {
        // A town-shaped floor is rebuilt from its layout and the quest ledger every
        // visit, so it remembers ONE thing: how much of itself it has shown you.
        // Its chests live in `quests.chests`, and nothing else here would survive.
        floors[key] = { ...(floors[key] ?? emptyFloorMemory()), explored: bytesToBase64(world.lighting.packExplored()) };
        return;
      }
      const takenGold: number[] = [];
      world.goldPiles.forEach((p, i) => {
        if (p.taken) takenGold.push(i);
      });
      floors[key] = {
        openedChests: world.chests.openedIndexes(),
        takenGold,
        killedSpawns: [...world.killed],
        explored: bytesToBase64(world.lighting.packExplored()),
        arenaCleared: world.isArena || world.mines ? world.arenaCleared : (floors[key]?.arenaCleared ?? false),
        // THE QUARRY (it.85): which gates stand open, which keys are taken.
        doorsOpened: world.mines ? world.mines.doors.filter((d) => d.open).map((d) => d.key) : floors[key]?.doorsOpened,
        keysTaken: world.mines ? world.mines.keys.filter((k) => k.uid < 0 || !world.loot.getItem(k.uid)).map((k) => k.key) : floors[key]?.keysTaken,
      };
    };

    /** Write the save slot (it.39): the sheet, bags, stash, floor memories. */
    /** A hero's sheet as the save keeps it — and as a world snapshot ships it (it.73). */
    const heroSheet = (p: Player): PlayerSave => {
      const equipped: SaveGame['player']['equipped'] = [];
      for (const s of ['head', 'torso', 'legs', 'mainHand', 'offHand', 'cloak', 'ring'] as const) {
        const itemId = p.getEquipped(s);
        if (itemId) equipped.push({ slot: s, itemId });
      }
      return {
        archetype: p.archetype,
        level: p.level,
        xp: p.xp,
        gold: p.gold,
        hp: p.hp,
        hpMax: p.hpMax,
        resource: p.resource,
        backpack: [...p.backpack],
        equipped,
        skillPoints: p.skillPoints,
        unlocked: [...p.unlockedSkills],
        loadout: [...p.loadout],
        passives: [...p.passives],
        bestiary: Object.fromEntries([...p.bestiary].map(([k, v]) => [k, { ...v }])),
        goldCollected: p.goldCollected,
        materials: Object.fromEntries(p.materials),
        belt: [...p.belt],
        recipes: [...p.recipes],
      };
    };
    const saveNow = (): boolean => {
      if (!alive || hardcoreOver) return false; // A spent life is never written back (it.89).
      captureFloor(); // Every floor writes its fog down now (it.98); the function decides the rest.
      const save: SaveGame = {
        version: SAVE_VERSION,
        slot,
        seed: baseSeed,
        createdAt,
        updatedAt: Date.now(),
        floor,
        // DEEP SAVE (it.48): the exact spot — a load resumes here, not in town.
        pos: world.town ? undefined : { x: player.pos.x, y: player.pos.y },
        arena: world.isArena,
        deepestFloor,
        playtimeTicks: playtimeBase + state.tick,
        player: heroSheet(player),
        stats: stats.snapshot(),
        activeTicks,
        // CO-OP (it.59): the party's stash is the LEADER's; a joiner keeps its own slot's stash.
        stash: coop && !net?.isHost ? { items: [...ownStash.items], gold: ownStash.gold } : { items: [...town.stash.items], gold: town.stash.gold },
        floors: { ...floors },
        quests: { ...quests },
        difficulty: difficultyId,
      };
      const ok = saves.write(save);
      if (ok) {
        audio.sfx('save');
        world.dmgText.show(player.pos.x, player.pos.y - 0.6, 'PROGRESS SAVED', 'miss');
      }
      return ok;
    };

    /**
     * BUILD-THEN-SWAP (it.37): the next floor is constructed while the
     * current one still exists; only on success is the old floor destroyed.
     * A generation/build error keeps the player on the current floor with
     * a console error instead of a dead loop. Returns false on failure.
     */
    const swapWorld = (make: () => World): boolean => {
      // THE FOG IS TAKEN WITH US (it.98): whatever the outgoing floor had revealed is
      // written down before it is torn apart - including a rebuild of the SAME floor,
      // which is how the taproom keeps its light when its back door is unbolted.
      captureFloor();
      let next: World;
      try {
        next = make();
      } catch (err) {
        console.error('[floor] build failed — staying on the current floor:', err);
        // The failed attempt may have re-parented the heroes; put them back.
        for (const seat of liveSeats()) {
          if (seat.player.container.parent !== world.viewport.objectLayer) world.viewport.objectLayer.addChild(seat.player.container);
        }
        return false;
      }
      const old = world;
      world = next;
      // A PROCESSION (it.92) belongs to the floor it played on: its walkers die with that floor's layer.
      if (reclaim) {
        reclaim.destroy();
        reclaim = null;
        cineFocus = null;
      }
      for (const sk of skillSystems) sk?.clearZones(); // Firewalls/traps stay in the old world's grave.
      arenaTeleporterIn = 0;
      bossLoot = null;
      destroyWorld(old);
      interactHint?.classList.remove('show', 'dim'); // No floating chips survive a floor.
      pendingInteract = null;
      // A stale "on the stairs" flag from the old floor must never fire on
      // the new one (double-descend guard, it.39).
      pendingDescend = false;
      pendingArena = false;
      return true;
    };

    /**
     * Arriving in town (it.39): restock the merchant, drop a return portal
     * when the hero came by scroll, and AUTOSAVE.
     */
    const enterTown = (viaPortal: boolean): void => {
      const t = world.town;
      if (!t) return;
      floor = 0;
      updateDepth();
      floorStartTick = state.tick;
      floorActiveTicks = 0;
      for (const seat of liveSeats()) seat.player.action = 'idle';
      if (viaPortal) {
        placeParty(t.layout.portal.x + 0.5, t.layout.portal.y + 0.5, world.scene.isWalkable);
        world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
        audio.sfx('portal');
      }
      if (portalReturn) {
        // The way back: a cold blue rift at the portal stone.
        const s = worldToScreen(t.layout.portal.x + 0.5, t.layout.portal.y + 0.5, vec2());
        const glow = new Sprite(assets.get('glow'));
        glow.anchor.set(0.5);
        glow.blendMode = 'add';
        glow.tint = 0x6fa0ff;
        glow.scale.set(1.7, 2.4);
        glow.position.set(s.x, s.y - 22);
        world.viewport.ambienceLayer.addChild(glow);
        world.ambience.addGlow(glow, t.layout.portal.x, t.layout.portal.y, 0.8, 1.7);
        // THE NEW TELEPORTER (it.87): the stone disc and its rune at the portal stone.
        const ring = new Sprite(spriteLib.hasSingle('portal_pad') ? spriteLib.single('portal_pad') : assets.get('targetRing'));
        ring.anchor.set(0.5);
        ring.scale.set(spriteLib.hasSingle('portal_pad') ? 0.62 : 1);
        ring.position.set(s.x, s.y);
        world.viewport.groundLayer.addChild(ring);
        if (spriteLib.hasSingle('portal_rune')) {
          const rune = new Sprite(spriteLib.single('portal_rune'));
          rune.anchor.set(0.5);
          rune.blendMode = 'add';
          rune.scale.set(0.66);
          rune.position.set(s.x, s.y);
          world.viewport.ambienceLayer.addChild(rune);
          world.ambience.addGlow(rune, t.layout.portal.x, t.layout.portal.y, 0.9, 0.66);
        }
        world.lighting.addSource(t.layout.portal.x + 0.5, t.layout.portal.y + 0.5, 2.6, 90, 140, 255, 0.6);
        portalArmed = false;
      }
      townVisits++;
      town.restockIfDue(baseSeed, deepestFloor, state.tick);
      // FAST TRAVEL HINT (it.48): back from the depths, the DEPTHS menu is the quick way down.
      if (deepestFloor > 0) tutorial.notify('fastTravel', 'Back in town — press L to open DEPTHS and fast-travel to any floor you have reached.');
      minimap.markDirty();
      saveNow();
    };

    /** Scroll of Town Portal: remember where we stood, then fade to town. */
    const castPortal = (): void =>
      withFade(async () => {
        const lead = leaderHero();
        portalReturn = { floor, arena: world.isArena, x: lead.pos.x, y: lead.pos.y };
        captureFloor();
        await preloadFloor(0, 'hub');
        if (!swapWorld(() => buildWorld(0, 'hub'))) {
          portalReturn = null;
          return;
        }
        enterTown(true);
      }, 'the portal home');

    /** Step back through the town portal to the remembered floor and spot. */
    const returnThroughPortal = (): void =>
      withFade(async () => {
        const r = portalReturn;
        if (!r) return;
        portalReturn = null;
        const mode: FloorMode = r.arena ? 'arena' : modeFor(r.floor);
        await preloadFloor(r.floor, mode);
        if (!swapWorld(() => buildWorld(r.floor, mode))) return;
        floor = r.floor;
        updateDepth();
        floorStartTick = state.tick;
        floorActiveTicks = 0;
        placeParty(r.x, r.y, world.scene.isWalkable);
        world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
        minimap.markDirty();
        updateOrb();
        audio.sfx('portal');
      }, 'back through the rift');

    if (world.town) enterTown(false);

    // MOUSE AIM TRACKING (it.33): skills cast toward the cursor's world
    // point — the last known pointer position feeds the aim vector.
    const lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, seen: false };
    app.canvas.addEventListener(
      'pointermove',
      (e: PointerEvent) => {
        lastMouse.x = e.offsetX;
        lastMouse.y = e.offsetY;
        lastMouse.seen = true;
      },
      { signal: ac.signal },
    );

    // --- ACTIVE SKILLS (it.32): hotkeys 1–4, wired to the CURRENT floor ----
    // ONE SKILL SYSTEM PER SEAT (it.59): the HUD binds to the local hero's.
    const makeSkills = (hero: Player, slot: number): SkillSystem => new SkillSystem({
      player: hero,
      slot,
      combat: () => world.combat,
      status: () => world.status,
      enemiesNear: (x, y, r) => {
        const out: Enemy[] = [];
        world.enemies.forEachActive((e) => {
          if (e.hp > 0 && e.action !== 'dead' && Math.hypot(e.pos.x - x, e.pos.y - y) <= r) out.push(e);
        });
        out.sort((a, b) => Math.hypot(a.pos.x - x, a.pos.y - y) - Math.hypot(b.pos.x - x, b.pos.y - y));
        return out;
      },
      isWalkable: (gx, gy) => world.scene.isWalkable(gx, gy),
      burst: (x, y, c, n) => world.ambience.burst(x, y, c, n),
      glint: (x, y) => world.ambience.playGlint(x, y),
      shake: (a) => world.camera.addShake(a),
      inTown: () => !!world.town, // Respec is a town rite (it.48).
      interruptMove: () => world.movements[slot]?.interrupt(), // Casts cut the walk (it.53).
      text: (x, y, m, s) => world.dmgText.show(x, y, m, s),
      sfx: (n) => audio.sfx(n as Parameters<typeof audio.sfx>[0]),
      vfx: (anim, x, y, opts) => world.vfx.play(anim, x, y, opts),
      aim: () => aimFor(hero),
      // The aim's exact world point (it.38): ground zones land ON it.
      aimPoint: () => aimWorldPoint(hero),
      zoneVisual: (kind, x, y) => {
        // Persistent ground objects for skill zones (it.33): a gold trap
        // rune, a burning flame bed, or a pale rain sigil.
        const s = worldToScreen(x, y, vec2());
        const made: Sprite[] = [];
        if (kind === 'trap') {
          const ring = new Sprite(assets.get('targetRing'));
          ring.anchor.set(0.5);
          ring.tint = 0xc8b060;
          ring.scale.set(0.55);
          ring.alpha = 0.9;
          ring.position.set(s.x, s.y);
          world.viewport.groundLayer.addChild(ring);
          made.push(ring);
          const glow = new Sprite(assets.get('glow'));
          glow.anchor.set(0.5);
          glow.blendMode = 'add';
          glow.tint = 0xc8b060;
          glow.scale.set(0.8);
          glow.alpha = 0.3;
          glow.position.set(s.x, s.y);
          world.viewport.ambienceLayer.addChild(glow);
          made.push(glow);
        } else if (kind === 'fire') {
          // FLAME BED (it.41): the baked fire_wall strip loops on the cell.
          const flame = world.vfx.play('vfx_firewall', x, y, { loop: true, scale: 1.05, lift: 22, fps: 22 });
          const glow = new Sprite(assets.get('glow'));
          glow.anchor.set(0.5);
          glow.blendMode = 'add';
          glow.tint = 0xff8040;
          glow.scale.set(1.3);
          glow.alpha = 0.45;
          glow.position.set(s.x, s.y);
          world.viewport.ambienceLayer.addChild(glow);
          made.push(glow);
          return () => {
            flame.stop();
            for (const spr of made) if (!spr.destroyed) spr.destroy();
          };
        } else {
          const ring = new Sprite(assets.get('targetRing'));
          ring.anchor.set(0.5);
          ring.tint = 0xd8cfa8;
          ring.scale.set(0.9);
          ring.alpha = 0.6;
          ring.position.set(s.x, s.y);
          world.viewport.groundLayer.addChild(ring);
          made.push(ring);
        }
        return () => {
          for (const spr of made) if (!spr.destroyed) spr.destroy();
        };
      },
    });
    const skillSystems: Array<SkillSystem | null> = party.map((s) => (s ? makeSkills(s.player, s.slot) : null));
    if (pendingLocal) skillSystems[localSlot] = makeSkills(pendingLocal.player, localSlot); // The HUD binds before the JOIN lands.
    const skills = skillSystems[localSlot]!;
    subs.push(() => {
      for (const sk of skillSystems) sk?.destroy();
    });
    // BOSS DISINTEGRATION (it.43): embers lift off the collapsing body each frame.
    Enemy.onBossDeathFrame = (e, p) => {
      if (p < 0.45) return;
      const n = p > 0.8 ? 3 : 1;
      for (let i = 0; i < n; i++) {
        if (Math.random() > 0.7) continue;
        const ox = (Math.random() - 0.5) * 1.4;
        const oy = (Math.random() - 0.5) * 0.7;
        world.ambience.trail(e.pos.x + ox, e.pos.y + oy, 10 + Math.random() * 80, Math.random() < 0.5 ? 0xffb060 : 0xff6a30, true);
        if (Math.random() < 0.15) world.ambience.burst(e.pos.x + ox, e.pos.y + oy, 0xffd9a0, 2);
      }
    };
    subs.push(() => {
      Enemy.onBossDeathFrame = null;
    });

    // Skill bar DOM (it.41): one slot per HOTBAR entry — rebuilt whenever
    // the tree changes the loadout. Empty slots point at the tree (K).
    const skillSlotEls: Array<{ root: HTMLElement; cd: HTMLElement; num: HTMLElement }> = [];
    const lastSkillCd: number[] = [0, 0, 0, 0];
    const skillBar = document.getElementById('skill-bar');
    // TOWN PORTAL button (it.43): the built-in free way home, beside the hotbar.
    const tpButton = document.createElement('button');
    tpButton.id = 'tp-button';
    // The PORTAL RITE lives on the HUD (it.49): the scroll's own icon, the T key, the cooldown.
    tpButton.innerHTML = `<span class="tp-icon">${itemIconHtml(ITEMS.scroll_town_portal)}</span><kbd>T</kbd><i></i>`;
    tpButton.title = 'Town Portal (T) — a rift home, free, 12 s cooldown';
    tpButton.addEventListener('click', () => inputQueue.enqueue({ type: 'TOWN_PORTAL', playerId: 0 }));
    document.body.appendChild(tpButton);
    // THE BELT ON THE BAR (it.80): Q and R beside the skills, with the count and the cooldown.
    const beltEls: Array<{ root: HTMLElement; count: HTMLElement; cd: HTMLElement; icon: string } | null> = [null, null];
    const buildBelt = (): void => {
      if (!skillBar) return;
      for (const old of skillBar.querySelectorAll('.belt-slot')) old.remove();
      for (let i = 0; i < 2; i++) {
        const base = player.belt[i];
        const def = base ? itemDef(base) : undefined;
        const slot = document.createElement('div');
        slot.className = `skill-slot belt-slot${def ? '' : ' empty'}`;
        slot.innerHTML = def
          ? `<div class="skill-glyph has-icon">${itemIconHtml(def, 'skill-icon', 'skill-icon')}</div><div class="skill-key">${i === 0 ? 'Q' : 'R'}</div><div class="skill-cost belt-count">0</div><div class="skill-cd"></div><div class="skill-cd-num"></div><div class="skill-tip"><b>${def.name}</b><span>${i === 0 ? 'Q' : 'R'} · assign in the inventory (▾)</span><p>${statLine(def)}</p></div>`
          : `<div class="skill-glyph skill-empty"><span class="skill-lock" aria-hidden="true">◈</span></div><div class="skill-key">${i === 0 ? 'Q' : 'R'}</div><div class="skill-cd"></div><div class="skill-cd-num"></div><div class="skill-tip skill-tip-locked"><b>Empty</b><span>${i === 0 ? 'Q' : 'R'} has no draught</span><p>Open the inventory (I) and press ▾ beside the key to choose one.</p></div>`;
        slot.addEventListener('click', () => inputQueue.enqueue({ type: 'USE_QUICK', playerId: 0, kind: i === 0 ? 'health' : 'mana' }));
        skillBar.appendChild(slot);
        beltEls[i] = def ? { root: slot, count: slot.querySelector('.belt-count') as HTMLElement, cd: slot.querySelector('.skill-cd') as HTMLElement, icon: def.icon ?? def.art ?? '' } : null;
      }
    };
    const updateBelt = (): void => {
      const faces: Array<{ icon: string; count: number; cdFrac: number } | null> = [null, null];
      for (let i = 0; i < 2; i++) {
        const base = player.belt[i];
        const def = base ? itemDef(base) : undefined;
        const el = beltEls[i];
        if (!def) continue;
        const count = player.backpack.filter((x) => decodeItemId(x)?.base === base).length;
        const cat = def.use ? quaffCategory(def.use) : null;
        const left = cat ? (player.quaffCd.get(cat) ?? 0) : 0;
        const frac = cat && left > 0 ? Math.min(1, left / QUAFF_COOLDOWN[cat]) : 0;
        faces[i] = { icon: itemIconHtml(def, 'tc-draught-icon', 'tc-draught-icon'), count, cdFrac: frac };
        if (!el) continue;
        const n = String(count);
        if (el.count.textContent !== n) el.count.textContent = n;
        el.root.classList.toggle('poor', count === 0);
        const h = `${Math.round(frac * 100)}%`;
        if (el.cd.style.height !== h) el.cd.style.height = h;
        el.root.classList.toggle('cooling', frac > 0);
      }
      touchControls.setDraughts(faces);
    };
    subs.push(eventBus.on('belt:changed', () => buildBelt()));
    const buildSkillBar = (): void => {
      if (!skillBar) return;
      skillBar.innerHTML = '';
      skillSlotEls.length = 0;
      skills.skills.forEach((def, i) => {
        const slot = document.createElement('div');
        slot.className = 'skill-slot' + (def ? (skills.isSynergy(def) ? ' synergy' : '') : ' empty');
        // Rich hover tooltip (it.33): name, cost, cooldown, description.
        slot.innerHTML = def
          ? (def.icon
              ? `<div class="skill-glyph has-icon"><img class="skill-icon" src="${uiAssetUrl(`skills/${def.icon}.png`)}" alt="${def.name}" draggable="false"></div>`
              : `<div class="skill-glyph">${def.glyph}</div>`) +
            `<div class="skill-flash"></div>` +
            `<div class="skill-key">${i + 1}</div>` +
            (def.cost > 0 ? `<div class="skill-cost">${def.cost}</div>` : '') +
            `<div class="skill-cd"></div><div class="skill-cd-num"></div>` +
            `<div class="skill-name">${def.name.toUpperCase()}</div>` +
            `<div class="skill-tip"><b>${def.name}${skills.isSynergy(def) ? ' · SYNERGY' : ''}</b>` +
            `<span>${def.cost > 0 ? `${def.cost} ${player.resourceName.toLowerCase()} · ` : ''}${Math.round((def.cd * (skills.isSynergy(def) ? 0.8 : 1)) / 60)}s cooldown</span>` +
            `<p>${def.hint}</p></div>`
          : `<div class="skill-glyph skill-empty"><span class="skill-lock" aria-hidden="true">\u{1F512}</span></div><div class="skill-flash"></div><div class="skill-key">${i + 1}</div>` +
            `<div class="skill-cd"></div><div class="skill-cd-num"></div>` +
            `<div class="skill-tip skill-tip-locked"><b>Locked</b><span>${player.skillPoints > 0 ? `${player.skillPoints} skill point${player.skillPoints === 1 ? '' : 's'} to spend` : 'Requires a skill point'}</span><p>${player.skillPoints > 0 ? 'Press K to open the Skill Tree and learn a skill.' : 'Gain a level, then press K to learn a skill.'}</p></div>`;
        skillBar.appendChild(slot);
        skillSlotEls.push({
          root: slot,
          cd: slot.querySelector('.skill-cd') as HTMLElement,
          num: slot.querySelector('.skill-cd-num') as HTMLElement,
        });
      });
      // THE THUMB CLUSTER SHOWS THE SAME SKILLS (it.67): icon, cost and cooldown.
      touchControls.setSkills(
        skills.skills.map((def) => (def ? { name: def.name, icon: def.icon ? uiAssetUrl(`skills/${def.icon}.png`) : null, glyph: def.glyph, cost: def.cost } : null)),
      );
    };
    buildSkillBar();
    buildBelt();
    subs.push(eventBus.on('skills:changed', () => buildSkillBar()));

    // The resource gauge lives on the corner plate (it.66); this keeps the
    // portal button and the cooldown sweeps current.
    const updateSkillHud = (): void => {
      statusFrame.update();
      const tpNote = tpButton.querySelector('i');
      if (tpNote) tpNote.textContent = world.town ? 'in town' : portalCooldown > 0 ? `${Math.ceil(portalCooldown / 60)}s` : 'ready';
      tpButton.classList.toggle('cooling', portalCooldown > 0 || !!world.town);
      skills.skills.forEach((def, i) => {
        const el = skillSlotEls[i];
        if (!el || !def) return;
        const cd = skills.cooldowns[i];
        // CAST FLASH (it.40): a cooldown that just started means the skill fired.
        if (cd > 0 && lastSkillCd[i] === 0) {
          haptics.cast();
          el.root.classList.remove('cast');
          void el.root.offsetWidth;
          el.root.classList.add('cast');
        }
        lastSkillCd[i] = cd;
        // WRITE ONLY ON CHANGE (it.75): these ran sixty times a second and a
        // same-value write still dirties layout. Compare first.
        if (cd > 0) {
          el.root.classList.add('cooling');
          const h = `${Math.min(100, Math.round((cd / def.cd) * 100))}%`;
          if (el.cd.style.height !== h) el.cd.style.height = h;
          const n = `${Math.ceil(cd / 60)}`;
          if (el.num.textContent !== n) el.num.textContent = n;
        } else if (el.root.classList.contains('cooling')) {
          el.root.classList.remove('cooling');
          el.cd.style.height = '0%';
          el.num.textContent = '';
        }
        el.root.classList.toggle('poor', player.resource < def.cost);
        touchControls.setCooldown(i, cd > 0 ? Math.min(1, cd / def.cd) : 0, cd > 0 ? cd / 60 : 0, player.resource < def.cost);
      });
      updateBelt();
    };

    // SMOOTH FLOOR TRANSITIONS (it.15): a quick fade-to-black covers the
    // world teardown/rebuild so floors never pop. Guarded against re-entry.
    // It.36: the work is ASYNC (atlases may stream in) — the fade holds and
    // shows a "delving" label until the new floor is fully built.
    const floorFade = document.getElementById('floor-fade');
    let transitioning = false;
    let transitionSerial = 0;
    /** The tick being executed (set at the top of every tickUpdate). */
    let simTick = 0;
    const withFade = (work: () => Promise<void>, label?: string): void => {
      if (transitioning) return;
      transitioning = true;
      const serial = ++transitionSerial;
      audio.sfx('stairs');
      floorFade?.classList.add('show');
      if (label) loading.open(label); // THE LOADING SCREEN (it.62).
      // THE BARRIER (it.59): nothing past this tick runs on any peer until
      // every peer's new floor stands — the party steps out together.
      lockstep?.enterBarrier(simTick + 1);
      const finish = (): void => {
        if (!alive || serial !== transitionSerial) return;
        loading.step('ready');
        void loading.close();
        floorFade?.classList.remove('loading');
        if (lockstep && lockstep.inBarrier) {
          lockstep.markReady(); // `transitioning` clears on RESUME — the same tick for all.
          return;
        }
        later(() => {
          floorFade?.classList.remove('show');
          transitioning = false;
        }, 140);
      };
      later(() => {
        floorFade?.classList.add('loading');
        void work()
          .then(() => loading.step('world'))
          .catch((err) => console.error('[floor] transition failed:', err))
          .finally(finish);
      }, 300);
      // WATCHDOG (it.37): nothing may hold the fade forever — if the work
      // has not settled in 20 s the screen is handed back with an error.
      later(() => {
        if (transitioning && serial === transitionSerial) {
          console.error('[floor] transition watchdog fired — releasing the fade');
          finish();
        }
      }, 20000);
    };

    const descend = (): void =>
      withFade(async () => {
        const next = floor + 1;
        await preloadFloor(next, 'normal');
        const clearTime = formatTime(floorActiveTicks);
        const fromTown = !!world.town;
        if (!fromTown && floor > 0) stats.recordFloorClear(player.archetype, floor, floorActiveTicks); // SPEEDRUN LEDGER (it.54).
        if (!fromTown) captureFloor();
        if (!swapWorld(() => buildWorld(next))) return;
        floor = next;
        deepestFloor = Math.max(deepestFloor, floor);
        updateDepth();
        levelSelect.unlock(floor);
        // The run timer resets cleanly on every floor transition.
        floorStartTick = state.tick;
        floorActiveTicks = 0;
        if (descendSub) descendSub.textContent = fromTown ? 'The gate seals behind you' : `Depth ${ROMAN[floor - 2] ?? floor - 1} delved in ${clearTime}`;
        descendNote?.classList.add('show');
        descendSub?.classList.add('show');
        later(() => {
          descendNote?.classList.remove('show');
          descendSub?.classList.remove('show');
        }, 5200); // Doubled (it.50).
      }, `descending to depth ${ROMAN[floor] ?? floor + 1}`);

    /**
     * BOSS ARENA TELEPORT (it.28): crossing the boss-floor threshold seizes
     * the player and drops them into the depth's sealed fighting hall.
     */
    const enterArena = (): void =>
      withFade(async () => {
        await preloadFloor(floor, 'arena');
        captureFloor();
        if (!swapWorld(() => buildWorld(floor, 'arena'))) return;
        for (const seat of liveSeats()) seat.player.action = 'idle';
        updateOrb();
        world.dmgText.show(player.pos.x + 1.2, player.pos.y - 0.6, 'THE ARENA SEALS SHUT', 'crit');
      }, 'the arena seals shut');

    /** THE TRIAL COLISEUM (it.53): fade out of town into the sand. */
    const enterColiseum = (waves: number): void =>
      withFade(async () => {
        await preloadFloor(-1, 'coliseum');
        captureFloor(); // Every floor writes its fog down now (it.98); the function decides the rest.
        if (!swapWorld(() => buildWorld(-1, 'coliseum'))) return;
        floor = -1;
        updateDepth();
        floorStartTick = state.tick;
        floorActiveTicks = 0;
        for (const seat of liveSeats()) seat.player.action = 'idle';
        const c = world.coliseum;
        if (c) {
          c.waves = waves;
          c.wave = 0;
          c.phase = 'intermission';
          c.timer = 5 * 60;
          c.startActive = activeTicks;
        }
        placeParty(world.dungeon.spawn.x + 0.5, world.dungeon.spawn.y + 0.5, world.scene.isWalkable);
        world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
        minimap.markDirty();
        updateOrb();
        world.dmgText.show(player.pos.x, player.pos.y - 1.4, 'THE TRIAL BEGINS', 'crit');
        tutorial.notify('coliseum', 'The Trial Coliseum: waves pour from the four gates. Between waves you have fifteen seconds to loot and drink. T abandons the trial.');
      }, 'the trial coliseum');
    /** Home from the sand — no return rift, the trial is over. */
    const leaveColiseum = (): void =>
      withFade(async () => {
        await preloadFloor(0, 'hub');
        if (!swapWorld(() => buildWorld(0, 'hub'))) return;
        portalReturn = null;
        stats.save(); // The ledger lands the moment the sand is left (it.55).
        enterTown(false);
      }, 'back to town');

    /** Level-select jump: fade-covered travel to any unlocked depth. */
    const jumpToFloor = (target: number): void => {
      if (target === floor) return;
      withFade(async () => {
        await preloadFloor(target, 'normal');
        captureFloor(); // Every floor writes its fog down now (it.98); the function decides the rest.
        if (!swapWorld(() => buildWorld(target))) return;
        floor = target;
        deepestFloor = Math.max(deepestFloor, floor);
        updateDepth();
        floorStartTick = state.tick;
        floorActiveTicks = 0;
        for (const seat of liveSeats()) seat.player.action = 'idle';
        updateOrb();
      }, `depth ${ROMAN[target - 1] ?? target}`);
    };

    /**
     * THE ENDING (it.15): the final keeper is dust and the last stair stands
     * open — the screen sinks to black and the epilogue rises.
     */
    const runEndgame = (): void => {
      audio.sfx('victory');
      audio.setMusic('victory');
      const overlay = document.getElementById('endgame');
      const stats = document.getElementById('endgame-stats');
      if (stats) {
        const totalSec = Math.floor(state.tick / 60);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        stats.textContent = `TWENTY DEPTHS CONQUERED · ${m}:${s.toString().padStart(2, '0')} IN THE DARK · THE HOLLOW KING IS DUST`;
      }
      overlay?.classList.add('show');
    };
    const levelSelect = new LevelSelectUI((target) => inputQueue.enqueue({ type: 'WARP', playerId: localSlot, to: 'floor', n: target }));
    levelSelect.unlock(Math.min(MAX_DEPTH, Math.max(floor, deepestFloor)));
    // DEEP SAVE (it.48): the hero stands exactly where the save was written.
    if (loaded?.pos && floor > 0 && !world.town) {
      const p = loaded.pos;
      const gx = Math.floor(p.x);
      const gy = Math.floor(p.y);
      if (world.scene.isWalkable(gx, gy)) player.warpTo(p.x, p.y);
      world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
      minimap.markDirty();
      updateOrb();
    }

    // --- Cheat menu (F1 / `) ------------------------------------------------
    const portraitFrames: HTMLCanvasElement[] = classPreviewFrames(player.archetype);
    // In co-op the cheat menu stays shut (it.59): a local-only edit would fork the sim.
    const cheatMenu = new CheatMenuUI({
      toggleGod: () => {
        cheatState.god = !cheatState.god;
        world.combat.godMode = cheatState.god;
        // God mode reveals the bestiary (it.43) — every page fills in while it is on.
        player.bestiaryRevealed = cheatState.god;
        eventBus.emit('bestiary:changed', {});
        return cheatState.god;
      },
      healFull: () => {
        if (player.action !== 'dead') player.hp = player.hpMax;
        updateOrb();
      },
      giveItem: (id) => {
        if (itemDef(id)) player.addItem(id);
      },
      killVisibleEnemies: () => {
        world.enemies.forEachActive((enemy) => {
          if (enemy.hp <= 0 || enemy.action === 'dead') return;
          if (!world.lighting.isVisible(Math.floor(enemy.pos.x), Math.floor(enemy.pos.y))) return;
          world.combat.dealDamage({ sourceId: player.id, targetId: enemy.id, amount: 99999 });
        });
      },
      revealFloor: () => {
        world.lighting.revealAll();
        minimap.markDirty();
      },
      // QUICK TELEPORT (it.33): jump straight to any floor or boss arena.
      teleport: (target: number, arena: boolean) => {
        const dest = Math.max(1, Math.min(target, MAX_DEPTH));
        withFade(async () => {
          const mode: FloorMode = arena && isBossFloor(dest) ? 'arena' : 'normal';
          await preloadFloor(dest, mode);
          captureFloor(); // Every floor writes its fog down now (it.98); the function decides the rest.
          if (!swapWorld(() => buildWorld(dest, mode))) return;
          floor = dest;
          deepestFloor = Math.max(deepestFloor, floor);
          updateDepth();
          floorStartTick = state.tick;
        floorActiveTicks = 0;
          player.action = 'idle';
          levelSelect.unlock(floor);
          updateOrb();
        });
      },
      items: () =>
        Object.values(ITEMS).map((def) => ({
          id: def.id,
          name: def.name,
          slot: def.slot,
          rarity: def.rarity,
          stats: statLine(def),
          iconHtml: itemIconHtml(def, 'cheat-icon', 'cheat-icon-px'),
        })),
      portraitFrames: () => portraitFrames,
      setLevel: (level) => {
        player.setLevel(level);
        updateOrb();
        updateProgressHud();
        eventBus.emit('skills:changed', {});
        eventBus.emit('inventory:changed', {}); // Stat readouts re-derive from the new level.
        audio.sfx('levelUp');
        world.ambience.burst(player.pos.x, player.pos.y, 0xf0d070, 16);
      },
      addSkillPoints: (n) => {
        player.skillPoints += n;
        audio.sfx('levelUp');
        eventBus.emit('skills:changed', {});
      },
      heroInfo: () => ({
        skillPoints: player.skillPoints,
        level: player.level,
        xp: player.xp,
        xpToNext: player.xpToNext(),
        hpMax: player.hpMax,
        dmgMin: player.levelDamageMin,
        dmgMax: player.levelDamageMax,
      }),
    });

    // --- Cross-floor event wiring (per run) ----------------------------------
    // Crits emit combat:swing immediately before their entity:damaged — the
    // remembered target id styles that one damage number gold.
    let lastCritTarget = -1;
    on('entity:damaged', ({ entityId, amount, dirX, dirY }) => {
      const entity = state.getEntity(entityId);
      if (!entity) return;
      tutor.noteDamage(entityId, amount);
      if (entity instanceof Enemy && entity.def.passive) {
        // A TRAINING DUMMY (it.90): wood, not flesh - chips fly, the post knocks, the number reads.
        world.ambience.burst(entity.pos.x, entity.pos.y, 0xb08a55, Math.min(14, 5 + amount));
        world.dmgText.show(entity.pos.x, entity.pos.y, `${amount}`, entityId === lastCritTarget ? 'crit' : 'enemy');
        audio.sfx('hit');
        audio.sfx(amount >= 8 ? 'chest' : 'skillTrapSet');
        entity.onDamaged();
        if (!player.weaponProfile.ranged) audio.sfx('swing');
        world.camera.addKick(amount >= 12 ? 3.5 : 2);
        return;
      }
      // Visceral directional blood — heavier hits bleed harder.
      world.ambience.bloodSpray(entity.pos.x, entity.pos.y, dirX, dirY, Math.min(18, 7 + amount));
      if (amount >= 5) {
        world.gore.drip(entity.pos.x, entity.pos.y, amount >= 12 ? 2 : 1);
        world.vfx.play('vfx_bloodhit', entity.pos.x, entity.pos.y, { scale: 0.9, lift: 22, fps: 30, additive: false, overlay: true });
        if (amount >= 8) audio.sfx('goreHit'); // The wet layer (it.48): blood on stone.
      }
      const kind = entity === player ? 'player' : entityId === lastCritTarget ? 'crit' : 'enemy';
      world.dmgText.show(entity.pos.x, entity.pos.y, `${amount}`, kind);
      audio.sfx(entity === player ? 'hurt' : 'hit');
      // Species pain voice over the impact; heavy rolls tear wet (it.25).
      if (entity instanceof Enemy) {
        const v = voiceProfile(entity.def.kind);
        audio.enemyVoice('hurt', v.pitch, v.bank);
        if (amount >= 12) audio.sfx('gore');
      }
      // The Frost Warden's blow just froze the legs — the ice crackles.
      if (entity === player && player.slowTicks >= 178) audio.sfx('freeze');
      // Heavy blows tremble the view (subtle, quadratic — see Camera.addShake).
      if (amount >= 10) world.camera.addShake(entity === player ? 0.3 : 0.18);
      // DIRECTIONAL RECOIL (it.48): the view kicks along the blow's screen direction.
      const kdx = (dirX ?? 0) - (dirY ?? 0);
      const kdy = ((dirX ?? 0) + (dirY ?? 0)) * 0.5;
      const klen = Math.hypot(kdx, kdy);
      if (entity instanceof Enemy) {
        entity.onDamaged();
        // LAYERED IMPACT (it.48): the weapon's own slash rides under the hit + pain.
        if (!player.weaponProfile.ranged) audio.sfx('swing');
        if (klen > 0) world.camera.addKickDir(kdx / klen, kdy / klen, amount >= 12 ? 4 : 2.5);
        else world.camera.addKick(2.5); // Felt on every landed blow.
        if (amount >= 8) world.vfx.play('vfx_burst', entity.pos.x, entity.pos.y, { scale: 0.55, lift: 20, fps: 30 });
        if (amount >= 12) hitStop(1);
        // Impact sparks (it.36): steel meets flesh — a hot fleck burst.
        world.ambience.sparks(entity.pos.x, entity.pos.y, dirX ?? 0, dirY ?? 0, Math.min(10, 4 + (amount >> 1)));
        // Impact flash + victim-side arc (it.37): the blow READS at the body.
        const ranged = player.weaponProfile.ranged;
        world.ambience.impactFlash(entity.pos.x, entity.pos.y, ranged ? 0xffb060 : 0xfff0d0, 0.8 + Math.min(1.2, amount / 16));
        if (!ranged) world.ambience.slashArc(entity.pos.x, entity.pos.y, dirX ?? 1, dirY ?? 0, 0xffe6c0, 0.8);
      } else if (entity instanceof Player && entity !== player) {
        entity.onDamaged(); // A party-mate's hurt flash (it.59).
      } else if (entity === player) {
        player.onDamaged();
        // HURT (it.48): a red flash at the edges and a recoil away from the blow.
        if (klen > 0) world.camera.addKickDir(kdx / klen, kdy / klen, 6);
        else world.camera.addKick(5);
        hurtFlashTimer = 0.15; // A short pulse (it.49), max alpha 0.25 in the stylesheet.
        if (visuals.flash) vignetteEl?.classList.add('hurt');
        haptics.hurt(amount / Math.max(1, player.hpMax)); // The glass takes the blow too (it.69).
        updateOrb();
        tutorial.notify('hurt', 'You bleed. Their heavy blows are telegraphed — step away as they rear back.');
      }
    });

    on('entity:healed', ({ entityId, amount }) => {
      // VAMPIRIC (it.53): the champion's drink reads as a crimson number.
      const e = state.getEntity(entityId);
      if (e) world.dmgText.show(e.pos.x + 0.3, e.pos.y - 0.6, `+${amount}`, 'player');
    });

    on('combat:swing', ({ sourceId, targetId, result }) => {
      lastCritTarget = result === 'crit' ? targetId : -1;
      if (result === 'crit' && sourceId === player.id) haptics.crit();
      if (result === 'miss') {
        const at = state.getEntity(targetId) ?? state.getEntity(sourceId);
        if (at) world.dmgText.show(at.pos.x, at.pos.y, 'miss', 'miss');
      }
      if (result === 'crit') {
        const target = state.getEntity(targetId);
        if (target) world.dmgText.show(target.pos.x - 0.4, target.pos.y - 0.4, 'CRIT!', 'crit');
      }
      const strikerSeat = seatOf(state.getEntity(sourceId));
      if (strikerSeat && strikerSeat.player !== player) {
        // A party-mate's swing (it.59): its arc and whoosh, no enemy grunt.
        if (!strikerSeat.player.weaponProfile.ranged) {
          strikerSeat.player.showSlash(result);
          if (result === 'miss') audio.sfx('swing');
        }
      } else if (sourceId !== player.id) {
        // Every ENEMY melee strike whooshes at its strike frame (it.21) —
        // ranged foes already sound their bow/bolt at launch. A species
        // attack grunt rides on top.
        audio.sfx('enemySwing');
        const striker = state.getEntity(sourceId);
        if (striker instanceof Enemy) {
          const v = voiceProfile(striker.def.kind);
          audio.enemyVoice('attack', v.pitch, v.bank);
        }
      }
      if (sourceId === player.id) {
        // Slash arc is melee feedback; ranged shots get projectile-impact VFX.
        if (!player.weaponProfile.ranged) player.showSlash(result);
        if (result === 'miss' && !player.weaponProfile.ranged) audio.sfx('swing'); // Whiff whoosh.
        if (result === 'crit') audio.sfx('crit');
        const target = state.getEntity(targetId);
        if (result === 'crit') {
          hitStop(2); // Heavy steel (it.48): two frozen frames.
          world.camera.addKick(4.5);
          world.camera.addShake(0.3);
          if (target) world.ambience.burst(target.pos.x, target.pos.y, 0xffd9a0, 8);
        } else if (result === 'hit' && target) {
          // Steel-on-flesh sparks on every landed blow (particle pass, it.15).
          world.ambience.burst(target.pos.x, target.pos.y, 0xd8c8a0, 3);
        }
      }
    });

    on('projectile:impact', ({ x, y, kind, hitFlesh }) => {
      if (hitFlesh) audio.sfx(kind === 'bolt' ? 'boltImpact' : 'arrowHit');
      else if (kind === 'arrow') audio.sfx('arrowWall'); // Clatter off stone.
      if (kind === 'bolt') {
        world.vfx.play('vfx_burst', x, y, { scale: 0.7, lift: 18, fps: 22 });
        world.ambience.burst(x, y, 0xffb060, hitFlesh ? 6 : 4);
        world.ambience.sparks(x, y, 0, 0, 6);
      } else if (kind === 'fireball') {
        /* The fireball's own onImpact drew the explosion. */
      } else if (!hitFlesh) {
        world.ambience.puff(x, y); // Arrow clattering off stone.
        world.ambience.sparks(x, y, 0, 0, 3);
      }
    });

    // Footstep dust + stone footfalls (render feedback; `world` read at call time).
    player.onStep = (x, y) => {
      world.ambience.puff(x, y);
      audio.sfx('step');
    };

    /** THE REWARD NOTE (it.88): a banner under the boss bar - a quest item taken, a purse paid. */
    const rewardNote = document.createElement('div');
    rewardNote.id = 'reward-note';
    document.body.appendChild(rewardNote);
    let rewardTimer = 0;
    const showReward = (text: string): void => {
      rewardNote.textContent = text;
      rewardNote.classList.add('show');
      window.clearTimeout(rewardTimer);
      rewardTimer = window.setTimeout(() => rewardNote.classList.remove('show'), 3400);
    };
    /** ENEMIES REMAINING (it.88): the forest's tally, in the corner column under the plate. */
    const questHud = document.createElement('div');
    questHud.id = 'quest-hud';
    (document.getElementById('hud-tl') ?? document.body).appendChild(questHud);
    subs.push(() => {
      window.clearTimeout(rewardTimer);
      rewardNote.remove();
      questHud.remove();
    });
    /**
     * A KEY IS TAKEN (it.88): a quest item is not a coin. The hero holds it
     * up - it rises turning in a gold halo, sparks fly, the world holds its
     * breath for four ticks, a bell and a chime, a note over the head and
     * the banner at the top.
     */
    const keyTaken = (hero: Player, def: ItemDef): void => {
      const x = hero.pos.x;
      const y = hero.pos.y;
      world.ambience.burst(x, y, 0xffd070, 26);
      world.ambience.playGlint(x, y);
      const tex = def.icon && spriteLib.loaded && spriteLib.hasSingle(`wicon_${def.icon}`) ? spriteLib.single(`wicon_${def.icon}`) : itemIconTexture(def);
      world.ambience.playRise(tex, x, y, 0xffe8a0);
      world.camera.addKick(3);
      hitStop(4);
      if (hero === player) {
        audio.sfx('keyTaken'); // Iron in the hand (it.89).
        world.dmgText.show(x, y - 1.5, `${def.name.toUpperCase()} · TAKEN`, 'crit');
        showReward(`QUEST ITEM · ${def.name.toUpperCase()}`);
      }
    };

    // THE SPAWN WARD (it.89): a blow broke on the ward - say so, not every tick.
    let lastWardNote = -100;
    on('entity:warded', ({ entityId }) => {
      const e = state.getEntity(entityId);
      if (!e || state.tick - lastWardNote < 20) return;
      lastWardNote = state.tick;
      world.dmgText.show(e.pos.x, e.pos.y - 1.0, 'WARDED', 'miss');
    });

    on('item:dropped', ({ itemId, x, y }) => {
      tutorial.notify('loot', screenLayout.state.touch ? 'A treasure has fallen — tap it, or press the open hand beside it.' : 'A treasure has fallen — press E near it, or click to claim it.');
      // Rare finds announce themselves with the pack's treasure glint.
      if (['rare', 'epic', 'legendary', 'mythic'].includes(itemDef(itemId)?.rarity ?? '')) world.ambience.playGlint(x, y);
    });

    // An idle thing in the dark just noticed you (species growl/hiss/moan).
    on('enemy:aggro', ({ entityId }) => {
      const entity = state.getEntity(entityId);
      const v = entity instanceof Enemy ? voiceProfile(entity.def.kind) : { pitch: 1, bank: 'hGrunt' };
      audio.enemyVoice('idle', v.pitch, v.bank);
    });

    on('chest:reached', ({ chestId }) => world.chests.open(chestId));
    on('chest:opened', ({ x, y }) => {
      // A TOWN CHEST (it.92) stays opened: the save remembers it by floor and tile.
      if (world.town) {
        const key = `${floor}:${Math.floor(x)},${Math.floor(y)}`;
        const had = (quests.chests ?? '').split(';').filter(Boolean);
        if (!had.includes(key)) quests.chests = [...had, key].join(';');
      }
      interactHint?.classList.remove('show', 'dim'); // The prompt dies with the lock.
      audio.sfx('chest');
      world.ambience.playGlint(x, y);
      world.camera.addKick(2);
      tutorial.notify('chest', 'The old locks give easily. Take what the dead no longer need.');
    });

    on('item:pickupArrived', ({ uid, playerId }) => {
      const seat = party[playerId];
      if (!seat || seat.gone) return;
      const itemId = world.loot.pickup(uid);
      if (itemId) {
        seat.player.addItem(itemId);
        const keyDef = itemDef(itemId);
        if (keyDef?.use?.key) {
          keyTaken(seat.player, keyDef);
          return;
        }
        if (seat.player === player) {
          audio.sfx(['rare', 'epic', 'legendary', 'mythic'].includes(itemDef(itemId)?.rarity ?? '') ? 'rarePickup' : 'pickup');
          tutorial.notify('inv', 'Press I to open your inventory and equip your spoils.');
          tutorial.notify('journal', 'The JOURNAL (H, or the book on the bar) explains every item, effect and recipe.');
        } else if (chat) {
          chat.system(`${seat.name} picked up ${itemDef(itemId)?.name ?? itemId}.`);
        }
      }
    });

    on('entity:died', ({ entityId }) => {
      const entity = state.getEntity(entityId);
      if (entity instanceof Enemy) {
        if (entity.spawnIndex >= 0) world.killed.add(entity.spawnIndex); // FloorMemory (it.39).
        if (entity.def.kind.startsWith('boss')) haptics.bossKill();
        else haptics.kill();
        player.noteKill(entity.def.kind); // Bestiary (it.42).
        eventBus.emit('bestiary:changed', {});
        stats.noteKill(!!world.coliseum, entity.def.kind.startsWith('boss')); // The ledgers (it.54).
        if (world.coliseum && (entity.affix || entity.def.kind.startsWith('boss'))) {
          // THE CROWD ROARS (it.54): a champion or a boss falls on the sand.
          audio.sfx('crowd');
          world.vfx.play('vfx_bloodburst', entity.pos.x, entity.pos.y, { scale: 1.3, lift: 16, fps: 30, additive: false });
          world.ambience.burst(entity.pos.x, entity.pos.y, 0xffd070, 34);
          world.ambience.playGlint(entity.pos.x, entity.pos.y);
          world.dmgText.show(entity.pos.x, entity.pos.y - 1.6, 'THE CROWD ROARS', 'crit');
        }
        // PHASED BOSS (it.30): a form with a nextPhase does not die.
        if (entity.beginPhaseTransition()) {
          audio.sfx('bossDie');
          world.camera.addKick(8);
          world.camera.addShake(0.5);
          world.ambience.bloodSpray(entity.pos.x, entity.pos.y, undefined, undefined, 30);
          world.ambience.burst(entity.pos.x, entity.pos.y, 0x7c150c, 16);
          world.dmgText.show(entity.pos.x, entity.pos.y - 1.4, 'THE FORM FALLS — SOMETHING STIRS…', 'crit');
          return;
        }
        if (entity === world.boss) audio.sfx('bossDie');
        else {
          const v = voiceProfile(entity.def.kind);
          audio.enemyVoice('die', v.pitch, v.bank);
        }
        // XP flows strictly from kills (it.22): value scales with the foe's
        // floor-scaled hp. Level-ups burst gold light and ring the shimmer.
        // CO-OP (it.59): every hero on the floor shares the kill in full.
        const xpGain = entity.xpValue();
        let levelsGained = 0;
        for (const seat of liveSeats()) {
          const lv = seat.player.grantXp(xpGain);
          if (seat.player === player) levelsGained = lv;
          else if (lv > 0) {
            world.ambience.burst(seat.player.pos.x, seat.player.pos.y, 0xffd98a, 20);
            world.vfx.play('vfx_ring', seat.player.pos.x, seat.player.pos.y, { scale: 1.2, flat: true, fps: 20, tint: 0xffd070 });
            chat?.system(`${seat.name} reached level ${seat.player.level}.`);
          }
        }
        world.dmgText.show(entity.pos.x, entity.pos.y - 0.5, `+${xpGain} xp`, 'miss');
        if (levelsGained > 0) {
          audio.sfx('levelUp');
          world.ambience.burst(player.pos.x, player.pos.y, 0xffd98a, 26);
          world.ambience.playGlint(player.pos.x, player.pos.y);
          world.camera.addShake(0.25);
          // The overhead banner carries the words now (it.50) — no floating duplicate.
          world.vfx.play('vfx_ring', player.pos.x, player.pos.y, { scale: 1.2, flat: true, fps: 20, tint: 0xffd070 });
          // GOLDEN PILLAR (it.48): a column of light climbs off the hero; a second chime rings.
          audio.sfx('rarePickup');
          haptics.levelUp();
          // SCREEN FLASH + BANNER (it.49).
          {
            const flash = document.getElementById('level-flash');
            const banner = document.getElementById('levelup-banner');
            if (flash) {
              flash.classList.add('show');
              later(() => flash.classList.remove('show'), 120);
            }
            if (banner) {
              banner.innerHTML = `LEVEL UP!<small>LEVEL ${player.level} · +${levelsGained} SKILL POINT${levelsGained > 1 ? 'S' : ''}</small>`;
              banner.classList.add('show');
              later(() => banner.classList.remove('show'), 4500); // Readable (it.50).
            }
          }
          world.vfx.play('vfx_aura', player.pos.x, player.pos.y, { scale: 1.5, lift: 30, fps: 16, tint: 0xffd070, overlay: true });
          {
            const s = worldToScreen(player.pos.x, player.pos.y, vec2());
            const pillar = new Sprite(assets.get('glow'));
            pillar.anchor.set(0.5, 0.9);
            pillar.blendMode = 'add';
            pillar.tint = 0xffd070;
            pillar.scale.set(1.4, 5.5);
            pillar.alpha = 0.95;
            pillar.position.set(s.x, s.y + 6);
            world.viewport.ambienceLayer.addChild(pillar);
            pillars.push({ sprite: pillar, life: 0 });
          }
          tutorial.notify('skillpoint', screenLayout.state.touch ? 'A skill point is yours — open the Talents from the bar in the corner.' : 'A skill point is yours — press K to open the Skill Tree.');
          updateOrb(); // Max HP grew (and partially refilled).
          eventBus.emit('skills:changed', {});
        }
        updateProgressHud();
        if (entity === world.boss) {
          // DRAMATIC BOSS DEATH (it.15): staged explosions ripple off the
          // strobing body, then the trophies erupt in a loot explosion.
          const bx = entity.pos.x;
          const by = entity.pos.y;
          const w = world; // Capture — the sequence must hit THIS floor's systems.
          w.camera.addKick(9);
          w.camera.addShake(0.55);
          for (let i = 0; i < 8; i++) {
            later(() => {
              if (world !== w) return; // Floor changed mid-sequence — stand down.
              const spread = 0.8 + i * 0.12;
              w.ambience.bloodSpray(bx + (Math.random() - 0.5) * spread, by + (Math.random() - 0.5) * spread, undefined, undefined, 12 + i * 2);
              w.ambience.burst(bx, by, i % 2 === 0 ? 0xffb060 : 0xd85a3a, 8 + i);
              w.camera.addShake(0.16 + i * 0.02);
            }, 200 + i * 340);
          }
          // The VICTORY BEAT: only after the body burns down to its fade does
          // the treasure erupt — a clear, earned pause before the reward.
          // Tick-clocked (it.59): loot is sim state, so the beat counts ticks.
          bossLoot = { x: bx, y: by, ticks: 198, world: w };
          if (bossNote) bossNote.textContent = floor === MINES_FLOOR ? 'THE KEEPER FALLS' : 'THE WARDEN FALLS'; // The quarry's keeper (it.88).
          bossNote?.classList.add('show');
          later(() => bossNote?.classList.remove('show'), 8400); // Doubled (it.50).
        } else {
          if (entity.affix) world.loot.dropForced(entity.pos.x, entity.pos.y); // Champions always pay (it.53).
          else world.loot.tryDropAt(entity.pos.x, entity.pos.y);
        }
        // Death gore: a heavy radial blowout on top of the directional spray.
        world.ambience.bloodSpray(entity.pos.x, entity.pos.y, undefined, undefined, entity === world.boss ? 34 : 22);
        world.ambience.burst(entity.pos.x, entity.pos.y, 0x7c150c, entity === world.boss ? 18 : 10);
        // PERSISTENT GORE (it.43): the floor keeps the kill.
        world.gore.kill(entity.pos.x, entity.pos.y, entity.facing.x, entity.facing.y, entity === world.boss);
        hitStop(entity === world.boss ? 3 : 2);
        world.vfx.play('vfx_splat', entity.pos.x, entity.pos.y, { scale: entity === world.boss ? 2.2 : 1.3, flat: true, fps: 24, additive: false, depthBias: -30, alpha: 0.9 });
        audio.sfx('goreKill');
        entity.beginDeath();

        // ARENA CLEAR (it.28): the stair stays hidden until EVERY combatant
        // in the seal is down. Then the way down reveals itself.
        if (world.isArena && !world.arenaCleared) {
          let remaining = 0;
          world.enemies.forEachActive((e) => {
            // A transitioning phased boss has hp 0 but is very much alive.
            if (e !== entity && (e.hp > 0 || e.action === 'transition')) remaining++;
          });
          if (remaining === 0) {
            world.arenaCleared = true;
            town.markBossCleared(); // The merchants restock on a warden's fall (it.78).
            const w = world;
            // Boss last: wait out the collapse + loot beat. Minion last: brief pause.
            const delay = entity === w.boss ? 7600 : 1100;
            // FINAL DEPTH (it.49): no automatic ending. The Hollow King's spoils lie
            // where he fell; the teleporter rises at the arena's heart (it.58) and the
            // ending waits for the hero to STEP ON IT. Tick-clocked since it.59.
            arenaTeleporterIn = Math.round((delay / 1000) * 60);
          }
        }
        return;
      }
      const fallen = seatOf(entity);
      if (fallen) {
        // The hero falls where they stood (death sheet plays out), THEN the
        // death overlay offers RISE AGAIN / RESTART / MAIN MENU (it.36).
        // CO-OP (it.59): they lie there and rise beside the entrance later.
        fallen.player.action = 'dead';
        fallen.player.actionTicks = 0;
        if (fallen.player === player) {
          inputQueue.enqueue({ type: 'STOP', playerId: localSlot });
          deathNote?.classList.add('show');
          if (!coop) later(() => deathNote?.classList.remove('show'), 5200); // Doubled (it.50).
          else chat?.system('You have fallen. You rise beside the entrance in 10 s.');
        } else {
          chat?.system(`${fallen.name} has fallen.`);
        }
      }
    });

    // MULTI-PHASE FINAL BOSS FEEDBACK (it.28): the Hollow King's breaks are
    // theatrical — roar, quake, gore, recolored bar. Sim drives via Enemy.
    on('boss:phase', ({ phase }) => {
      const b = world.boss;
      if (!b) return;
      audio.sfx('bossHorn');
      const v = voiceProfile(b.def.kind);
      audio.enemyVoice('idle', v.pitch * 0.85, v.bank);
      world.camera.addKick(7);
      world.camera.addShake(0.55);
      world.ambience.burst(b.pos.x, b.pos.y, phase === 3 ? 0xd8e8ff : 0xe8c06a, 30);
      world.ambience.bloodSpray(b.pos.x, b.pos.y, undefined, undefined, phase === 3 ? 34 : 24);
      world.dmgText.show(
        b.pos.x,
        b.pos.y - 1.4,
        phase === 3 ? 'THE LICH RISES — FINAL FORM!' : 'THE KING RISES IN GRAVE-ARMOR!',
        'crit',
      );
      const nameEl = document.getElementById('boss-bar-name');
      if (nameEl) {
        nameEl.textContent = `${b.def.name.toUpperCase()} · LVL ${b.level} · PHASE ${phase}/3`;
      }
    });

    /** The bed that played before the death sheet's lament (it.89). */
    let musicBeforeDeath = audio.currentMusic;
    const respawnPlayer = (): void => {
      player.warpTo(world.dungeon.spawn.x + 0.5, world.dungeon.spawn.y + 0.5);
      player.hp = player.hpMax;
      player.action = 'idle';
      // THE SPAWN WARD (it.89): five seconds in which no blow can land.
      player.wardTicks = SPAWN_WARD_TICKS;
      world.lighting.updateVisibility(world.dungeon.spawn.x, world.dungeon.spawn.y);
      world.ambience.burst(player.pos.x, player.pos.y, 0x9fd0ff, 22);
      world.dmgText.show(player.pos.x, player.pos.y - 1.2, `WARDED · ${SPAWN_WARD_TICKS / 60} s`, 'crit');
      audio.sfx('ward');
      audio.setMusic(musicBeforeDeath === 'death' || musicBeforeDeath === 'gameover' || musicBeforeDeath === 'none' ? 'dungeon' : musicBeforeDeath, floor);
      minimap.markDirty();
      updateOrb();
    };
    /** CO-OP REVIVE (it.59): the fallen hero rises beside the floor's entrance at half health (sim, deterministic). */
    const reviveSeat = (seat: Seat): void => {
      const hero = seat.player;
      let placed = false;
      for (const [ox, oy] of RING) {
        const gx = world.dungeon.spawn.x + ox;
        const gy = world.dungeon.spawn.y + oy;
        if (!world.scene.isWalkable(gx, gy)) continue;
        hero.warpTo(gx + 0.5, gy + 0.5);
        placed = true;
        break;
      }
      if (!placed) hero.warpTo(world.dungeon.spawn.x + 0.5, world.dungeon.spawn.y + 0.5);
      hero.hp = Math.max(1, Math.round(hero.hpMax * 0.5));
      hero.action = 'idle';
      hero.actionTicks = 0;
      hero.wardTicks = SPAWN_WARD_TICKS; // THE SPAWN WARD (it.89), the party too.
      world.ambience.burst(hero.pos.x, hero.pos.y, 0xffd98a, 18);
      if (hero === player) {
        world.lighting.updateVisibility(Math.floor(hero.pos.x), Math.floor(hero.pos.y));
        minimap.markDirty();
        updateOrb();
        deathNote?.classList.remove('show');
        world.dmgText.show(hero.pos.x, hero.pos.y - 1.2, `YOU RISE AGAIN · WARDED ${SPAWN_WARD_TICKS / 60} s`, 'crit');
        audio.sfx('ward');
      } else {
        chat?.system(`${seat.name} rises again.`);
      }
    };
    /** A seat leaves the party (LEAVE frame / the leader's link died): the hero despawns on every peer. */
    const removeSeat = (slot: number): void => {
      const seat = party[slot];
      if (!seat || seat.gone) return;
      seat.gone = true;
      seatPlayers[slot] = null;
      world.movements[slot] = null;
      skillSystems[slot]?.clearZones();
      skillSystems[slot] = null;
      inventories[slot] = null;
      state.unregister(seat.player.id);
      seat.player.container.removeFromParent();
      seat.player.destroy();
      refreshPartyHud(); // The leader's [System] line already told everyone.
    };
    /**
     * A hero joins mid-run (it.60): the JOIN frame seats them on every peer on
     * the same tick — a new body for the others, the waiting one for the joiner.
     */
    const addSeat = (slot: number, name: string, cls: ClassArchetype, hero: PlayerSave | null): void => {
      let seat = party[slot];
      if (slot === localSlot && pendingLocal) {
        // Our own JOIN: the waiting hero takes the seat (a stale occupant makes way).
        if (seat && !seat.gone) removeSeat(slot);
        seat = pendingLocal;
        pendingLocal = null;
        party[slot] = seat;
      } else if (seat && !seat.gone && !seat.pending) return; // Already seated.
      if (!seat || seat.gone) {
        const p = new Player(cls);
        if (hero) applyHeroSave(p, hero);
        else giveStarterKit(p, cls);
        void spriteLib.ensure(animsForHero(cls)).then(() => {
          if (!alive || party[slot]?.player !== p) return;
          p.enableKnightRig(); // Render only — the sim never waits on art.
        });
        seat = makeSeat(slot, name, cls, p);
        party[slot] = seat;
      }
      seat.gone = false;
      seat.pending = false;
      seat.link = 'ok';
      state.register(seat.player);
      seatPlayers[slot] = seat.player;
      world.viewport.objectLayer.addChild(seat.player.container);
      let placed = false;
      for (const [ox, oy] of RING) {
        const gx = world.dungeon.spawn.x + ox;
        const gy = world.dungeon.spawn.y + oy;
        if (!world.scene.isWalkable(gx, gy)) continue;
        seat.player.warpTo(gx + 0.5, gy + 0.5);
        placed = true;
        break;
      }
      if (!placed) seat.player.warpTo(world.dungeon.spawn.x + 0.5, world.dungeon.spawn.y + 0.5);
      seat.player.action = 'idle';
      world.movements[slot] = world.makeMovement(seat.player, slot);
      skillSystems[slot] ??= makeSkills(seat.player, slot); // The local joiner's already serve its HUD.
      inventories[slot] ??= makeInventory(seat.player, slot);
      if (coop) makePlate(seat);
      world.ambience.burst(seat.player.pos.x, seat.player.pos.y, 0x8fb8ff, 22);
      if (seat.player === player) {
        world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
        minimap.markDirty();
        updateOrb();
        eventBus.emit('skills:changed', {});
        eventBus.emit('inventory:changed', {});
      }
      refreshPartyHud();
    };
    /** Tick-clocked beats (it.59): the arena teleporter and the boss's loot burst. */
    let arenaTeleporterIn = 0;
    let bossLoot: { x: number; y: number; ticks: number; world: World } | null = null;
    const raiseArenaTeleporter = (): void => {
      const w = world;
      if (!w.isArena || w.victoryPortal) return;
      // THE TELEPORTER (it.58): every arena's only way out rises at its heart —
      // no stair. Depths V / X / XV descend; depth XX asks home-or-crown.
      const room = w.dungeon.rooms[0];
      const px = room.x + Math.floor(room.w / 2);
      const py = room.y + Math.floor(room.h / 2);
      w.victoryPortal = { x: px, y: py };
      spawnTeleporterAt(px, py);
      victoryPortalArmed = true;
      w.ambience.burst(px + 0.5, py + 0.5, 0xffd9a0, 20);
      w.ambience.playGlint(px + 0.5, py + 0.5);
      w.dmgText.show(px + 0.5, py + 0.2, floor === MINES_FLOOR ? 'THE QUARRY IS QUIET · THE WAY HOME OPENS' : floor >= MAX_DEPTH ? 'THE TELEPORTER RISES · HOME, OR THE CROWN' : 'THE TELEPORTER RISES · STEP ON TO DESCEND', 'crit');
      if (floor === MINES_FLOOR) tutorial.notify('quarryTeleporter', 'The keeper is down. Take the spoils, then step onto the teleporter at the heart of the arena to go home.');
      else if (floor >= MAX_DEPTH) tutorial.notify('lastStair', 'The Hollow King is dust. Claim his spoils, then step onto the teleporter at the heart of the arena \u2014 home, or the crown.');
      else tutorial.notify('arenaTeleporter', 'The warden is down. Take the spoils, then step onto the teleporter at the heart of the arena to go deeper.');
      audio.sfx('gateOpen');
      audio.setBossMusic(false);
    };
    /**
     * Home from anywhere (the victory choice, the epilogue, a WARP town).
     * `atGate` walks the party out of the passage they actually used (it.98) instead
     * of dropping them in the middle of the old quarter, half the town from it.
     */
    const goHome = (atGate?: 'forest'): void =>
      withFade(async () => {
        await preloadFloor(0, 'hub');
        if (!swapWorld(() => buildWorld(0, 'hub'))) return;
        enterTown(false);
        if (atGate) {
          const gw = world.town?.layout.gateways.find((g) => g.dest === atGate);
          if (gw) {
            // The cobble just inside the gate yard, between its two pillars.
            placeParty(gw.x - 0.5, gw.y + 0.5, world.scene.isWalkable);
            world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
            minimap.markDirty();
          }
        }
      }, 'back to town');
    /** THE ROAD EAST (it.85): out of the ward into the dark forest, and down into the quarry. */
    const goPlace = (dest: number, label: string): void =>
      withFade(async () => {
        const mode = modeFor(dest);
        await preloadFloor(dest, mode);
        captureFloor(); // Every floor writes its fog down now (it.98); the function decides the rest.
        if (!swapWorld(() => buildWorld(dest, mode))) return;
        floor = dest;
        updateDepth();
        floorStartTick = state.tick;
        floorActiveTicks = 0;
        player.action = 'idle';
        world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
        minimap.markDirty();
        updateOrb();
      }, label);
    const goForest = (): void => goPlace(FOREST_FLOOR, 'east, into the dark forest');
    /**
     * THE GATEKEEPER (it.87): the sentry at the eastern road. The road is
     * shut until the hero takes the forest's errand; open once it is taken;
     * a thank-you and a hundred gold when the last wolf is down.
     */
    /** THE KEEPER'S FACE (it.88): his own idle frame, cropped to the head, for the dialogue's portrait. */
    const portraitFromTexture = (tex: Texture, tint: number): HTMLCanvasElement | null => {
      const spr = new Sprite(tex);
      spr.tint = tint;
      const raw = app.renderer.extract.canvas({ target: spr, resolution: 1 }) as HTMLCanvasElement;
      spr.destroy();
      const ctx = raw.getContext('2d');
      if (!ctx || raw.width === 0) return null;
      const img = ctx.getImageData(0, 0, raw.width, raw.height);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < raw.height; y++) {
        for (let x = 0; x < raw.width; x++) {
          if (img.data[(y * raw.width + x) * 4 + 3] > 24) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return null;
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      // The head: a square a little wider than the shoulders, from the crown down.
      const side = Math.max(8, Math.round(Math.min(bw * 1.25, bh * 0.5)));
      const sx = Math.round(minX + bw / 2 - side / 2);
      const sy = Math.max(0, minY - 2);
      const out = document.createElement('canvas');
      out.width = 96;
      out.height = 96;
      const octx = out.getContext('2d');
      if (!octx) return null;
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(raw, sx, sy, side, side, 0, 0, 96, 96);
      return out;
    };
    let keeperFace: HTMLCanvasElement | null | undefined;
    const keeperPortrait = (): HTMLCanvasElement | null => {
      if (keeperFace === undefined) keeperFace = spriteLib.loaded && spriteLib.hasAnim('guard_idle') ? portraitFromTexture(spriteLib.frame('guard_idle', 5, 0), 0xd8c8a8) : null;
      return keeperFace;
    };
    const gatekeeper = async (): Promise<void> => {
      const state = quests.forest ?? 'new';
      const who = { speaker: 'SIR HAM', role: 'sentry of the eastern road', portrait: keeperPortrait() };
      if (state === 'done') {
        const v = await dialogue.open({
          ...who,
          lines: ['The road\'s open. Our people are back in the clearings.', 'The quarry is at the far end of the woods. Be careful down there.'],
          choices: [
            { label: 'GO EAST', sub: 'through the forest to the quarry', value: 'go' },
            { label: 'NOT NOW', value: 'stay' },
          ],
        });
        if (v === 'go') goForest();
        return;
      }
      if (state === 'active') {
        const v = await dialogue.open({
          ...who,
          lines: ['There are still beasts out there. Finish the job and the gold (100) is yours.'],
          choices: [
            { label: 'BACK TO THE FOREST', value: 'go' },
            { label: 'NOT NOW', value: 'stay' },
          ],
        });
        if (v === 'go') goForest();
        return;
      }
      const v = await dialogue.open({
        ...who,
        lines: [
          'The road\'s closed. There are wolves in the woods, and poachers with them. I can\'t spare anyone.',
          'Clear the forest and I\'ll open the road. The guild pays a hundred gold (100) for it.',
        ],
        choices: [
          { label: 'I\'LL DO IT', sub: 'take the job and go now', value: 'accept' },
          { label: 'NOT NOW', value: 'stay' },
        ],
      });
      if (v === 'accept') {
        quests.forest = 'active';
        tutorial.say('Job taken: clear the forest and the road opens.');
        goForest();
      }
    };
    // ---- THE EASTERN QUARTER (it.91): the barricade, the errand, the looters, the reclaiming, the inn ----
    /** The innkeeper's face: the peasant body's front frame in her warm coat. */
    let innFace: HTMLCanvasElement | null | undefined;
    const innPortrait = (): HTMLCanvasElement | null => {
      if (innFace === undefined) innFace = spriteLib.loaded && spriteLib.hasAnim('folk_walk') ? portraitFromTexture(spriteLib.frame('folk_walk', 6, 0), 0xe8d8b8) : null;
      return innFace;
    };
    let girlFace: HTMLCanvasElement | null | undefined;
    /** THE CELLAR (it.97): her own idle frame, cropped to the head. */
    const girlPortrait = (): HTMLCanvasElement | null => {
      if (girlFace === undefined) girlFace = spriteLib.loaded && spriteLib.hasAnim('cellar_girl') ? portraitFromTexture(spriteLib.frame('cellar_girl', 0, 0), 0xffffff) : null;
      return girlFace;
    };
    let refugeeFace: HTMLCanvasElement | null | undefined;
    const refugeePortrait = (): HTMLCanvasElement | null => {
      if (refugeeFace === undefined) refugeeFace = spriteLib.loaded && spriteLib.hasAnim('folk_walk') ? portraitFromTexture(spriteLib.frame('folk_walk', 6, 0), 0xffffff) : null;
      return refugeeFace;
    };
    /** Looters still standing in the quarter. */
    const lootersAlive = (): number => {
      let n = 0;
      world.enemies.forEachActive((e) => {
        if (e.hp > 0 && e.action !== 'dead' && LOOTER_KINDS.has(e.def.kind)) n++;
      });
      return n;
    };
    /** The barricade's carts as the dresser drew them, by gate tile. */
    const eastCarts = (): Array<{ sprite: Sprite; x: number; y: number }> => {
      const t = world.town;
      const east = t?.layout.east;
      if (!t || !east) return [];
      const out: Array<{ sprite: Sprite; x: number; y: number }> = [];
      for (const g of east.gateTiles) {
        const spr = t.gates.get(`${g.x},${g.y}`);
        if (spr && !spr.destroyed) out.push({ sprite: spr, x: g.x, y: g.y });
      }
      return out;
    };
    /** A QUEST command's step, applied on every peer on the same tick. */
    const applyEastStep = (step: string): void => {
      const t = world.town;
      const east = t?.layout.east;
      if (!t) return;
      if (step === 'accept' && east && floor === 0 && (quests.east ?? 'new') === 'new') {
        quests.east = 'open';
        quests.looters = '0';
        // The militia drags the gap's cart aside: the tile is road, the sprite slides to the verge.
        world.dungeon.grid[east.gap.y * world.dungeon.width + east.gap.x] = TILE_FLOOR;
        const cart = t.gates.get(`${east.gap.x},${east.gap.y}`);
        if (cart && !cart.destroyed) gateFx.pullAside(cart, east.gap.x, east.gap.y);
        t.setPlate(east.gap.x, east.gap.y, 'THE EAST GATE');
        spawnLooters(world.enemies, east.banditPosts, 0);
        world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
        minimap.markDirty();
        audio.sfx('gateOpen');
        world.ambience.burst(east.gap.x + 0.5, east.gap.y + 0.5, 0xb0a088, 18);
        world.dmgText.show(east.gap.x + 0.5, east.gap.y - 0.6, 'THE CART IS PULLED ASIDE · GO EAST', 'crit');
        tutorial.say(`Job taken: clear the Eastern Quarter of its ${LOOTER_COUNT} looters.`);
        saveNow();
      } else if (step === 'reward' && quests.east === 'cleared' && floor === INN_FLOOR) {
        quests.east = 'done';
        // The purse and the steel under the floorboards: two hundred gold, a bow and a sword to every hero of the party.
        for (const seat of liveSeats()) {
          seat.player.gold += 200;
          const rand = mulberry32(((state.tick * 31 + seat.player.id * 7) ^ 0x91e) >>> 0);
          const ilvl = Math.max(4, ilvlForDepth(Math.max(1, deepestFloor)));
          seat.player.addItem(rollGear(rand, ilvl, { base: 'hunters_bow', floor: 'rare' }));
          seat.player.addItem(rollGear(rand, ilvl, { base: 'soldier_blade', floor: 'rare' }));
        }
        eventBus.emit('inventory:changed', {});
        showReward('REWARD RECEIVED · 200 GOLD · A BOW · A SWORD');
        world.dmgText.show(player.pos.x, player.pos.y - 0.9, '+200 GOLD · THE CORNER ROOM IS YOURS', 'crit');
        audio.sfx('questDone');
        world.ambience.burst(player.pos.x, player.pos.y, 0xffd070, 26);
        world.ambience.playGlint(player.pos.x, player.pos.y);
        saveNow();
        // THE ROOM IS YOURS (it.96): the key turns, the door swings, and the inn is
        // rebuilt with the room open - the bed and the warded chest waiting in it.
        withFade(async () => {
          await preloadFloor(INN_FLOOR, 'inn');
          if (!swapWorld(() => buildWorld(INN_FLOOR, 'inn'))) return;
          const at = world.town?.layout.inn;
          if (at) placeParty(at.keeper.x + 0.5, at.keeper.y + 2.5, world.scene.isWalkable);
          world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
          minimap.markDirty();
          audio.sfx('gateOpen');
          tutorial.say('The room at the back is yours. The chest in it is warded - what you leave there you can take from any stash, and your party can reach it too.');
        }, 'the key turns');
      }
    };
    /** E at the barricade, or at the inn's counter: the refugees, then the keeper. */
    const innkeeperTalk = async (): Promise<void> => {
      const st = quests.east ?? 'new';
      const who = { speaker: 'COLESLAW', role: 'innkeeper of the Gilded Stag', portrait: innPortrait() };
      if (st === 'new') {
        const first = await dialogue.open({
          speaker: 'A REFUGEE',
          role: 'of the eastern quarter',
          portrait: refugeePortrait(),
          lines: ['They came over the east wall at night. By morning the quarter was burning.', 'Looters. Twenty of them, the militia says. They\'re still in there, in our houses.'],
          choices: [
            { label: 'TALK TO THE INNKEEPER', sub: 'she has work for you', value: 'next' },
            { label: 'NOT NOW', value: 'stay' },
          ],
        });
        if (first !== 'next') return;
        const v = await dialogue.open({
          ...who,
          lines: ['That\'s my inn in there, and they\'re drinking my cellar dry. Clear the quarter - all twenty - and these people can go home.', 'Two hundred gold (200) when it\'s done, and a bow and a sword I\'ve had put away. The militia will move a cart for you.'],
          choices: [
            { label: 'I\'LL DO IT', sub: 'the militia moves a cart aside', value: 'go' },
            { label: 'NOT NOW', value: 'stay' },
          ],
        });
        if (v === 'go') inputQueue.enqueue({ type: 'QUEST', playerId: localSlot, id: 'east', step: 'accept' });
        return;
      }
      if (st === 'open') {
        await dialogue.open({
          ...who,
          lines: [`Still looters in there - ${lootersAlive()} left, the militia says. Watch the ones with bows; they run when you get close.`],
          choices: [{ label: 'UNDERSTOOD', value: 'ok' }],
        });
        return;
      }
      if (st === 'cleared') {
        const v = await dialogue.open({
          ...who,
          lines: ['You did it. The streets are ours again.', 'Two hundred gold (200), the bow and the sword - they\'re yours. And the back room, for as long as you want it: a bed, and a chest the guild warded. Leave anything in it and you can take it out of any stash anywhere - your friends too.'],
          choices: [{ label: 'THANK YOU', sub: 'the gold, the bow, the sword, and the key to the room', value: 'reward' }],
        });
        if (v === 'reward') inputQueue.enqueue({ type: 'QUEST', playerId: localSlot, id: 'east', step: 'reward' });
        return;
      }
      // ---- THE CELLAR (it.97): her second errand, and her thanks for it ----
      const cel = quests.cellar ?? 'new';
      if (cel === 'new') {
        const v = await dialogue.open({
          ...who,
          lines: [
            'Sit down, you\'ve earned a drink. On the house.',
            'Ah. That\'s the trouble - every bottle I have is down in the cellar, and I have not been down there since the looters left. Something else went down after them. I can hear it through the boards at night.',
            'I gave you the bow and the sword. Go down and see what it is, and bring my stock back up. I\'m not proud about it - I am frightened of that stair.',
          ],
          choices: [
            { label: 'I\'LL GO DOWN', sub: 'he unbolts the back door', value: 'go' },
            { label: 'NOT NOW', value: 'stay' },
          ],
        });
        if (v === 'go') inputQueue.enqueue({ type: 'QUEST', playerId: localSlot, id: 'cellar', step: 'accept' });
        return;
      }
      if (cel === 'active') {
        await dialogue.open({
          ...who,
          lines: ['The back door\'s open. Mind the dark down there - I never got round to lighting it properly.'],
          choices: [{ label: 'UNDERSTOOD', value: 'ok' }],
        });
        return;
      }
      if (cel === 'done') {
        await dialogue.open({
          ...who,
          lines: [
            'You brought Sarah up with you. She works my tables - three years now - and I had her down as gone with the rest of them.',
            'I do not know what to say except thank you. Twice now. The room is yours, the chest is yours, and you will never pay for a drink in here again.',
          ],
          choices: [{ label: 'THANKS', value: 'ok' }],
        });
        return;
      }
      await dialogue.open({
        ...who,
        lines: ['Rest whenever you like. The room\'s yours, and the warded chest with it.'],
        choices: [{ label: 'THANKS', value: 'ok' }],
      });
    };
    /** The last looter falls: the letterboxed reclaiming, then the town rebuilt with the carts gone and the folk home. */
    let reclaim: ProcessionScene | null = null;
    /** The tile the scene's fog was last opened from, so it is only recomputed on a change. */
    let cineFogTile = -1;
    const cineFocusHooks = {
      focus: (x: number, y: number): void => {
        if (!cineFocus) {
          cineCur.x = cameraFocus.x;
          cineCur.y = cameraFocus.y;
        }
        cineFocus = { x, y };
      },
      release: (): void => {
        cineFocus = null;
        cineFogTile = -1;
        // The hero has the light back, at the floor's own radii.
        world.lighting.setSceneLight(false);
        world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
      },
    };
    const startReclaim = (): void => {
      const t = world.town;
      const east = t?.layout.east;
      if (!t || !east || reclaim) return;
      audio.sfx('questDone');
      const eastRoute = [east.gap, east.inside, { x: 72, y: 34 }, { x: 80, y: 38 }, { x: 84, y: 37 }];
      lightTheWayIn(east.approach, eastRoute); // The road through the barricade is lit before they come up it (it.98).
      reclaim = new ProcessionScene({
        layer: world.viewport.objectLayer,
        ambience: world.ambience,
        fx: gateFx,
        carts: eastCarts(),
        open: () => {
          for (const g of east.gateTiles) world.dungeon.grid[g.y * world.dungeon.width + g.x] = TILE_FLOOR;
          t.setPlate(east.gap.x, east.gap.y, null);
          world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
          minimap.markDirty();
        },
        at: east.gap,
        from: east.approach,
        route: eastRoute,
        titles: [['THE EASTERN QUARTER', 'the barricade comes down'], ['THE PEOPLE RETURN', 'twenty looters fallen · the quarter reclaimed']],
        ...cineFocusHooks,
        sfx: (n) => audio.sfx(n),
        onDone: () => {
          reclaim?.destroy();
          reclaim = null;
          withFade(async () => {
            await preloadFloor(0, 'hub');
            const at = { x: player.pos.x, y: player.pos.y };
            if (!swapWorld(() => buildWorld(0, 'hub'))) return;
            enterTown(false);
            placeParty(at.x, at.y, world.scene.isWalkable);
            world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
            minimap.markDirty();
            tutorial.say('The quarter is yours. The innkeeper is back at the Gilded Stag with your pay.');
            saveNow();
          }, 'the quarter reclaimed');
        },
      });
    };
    /** Each tick in town: the count, and the reclaiming when it reaches zero. */
    const tickEastQuest = (): void => {
      if (floor !== 0 || quests.east !== 'open' || transitioning || !world.town?.layout.east) return;
      const alive = lootersAlive();
      const killed = String(LOOTER_COUNT - alive);
      if (quests.looters !== killed) quests.looters = killed;
      if (alive === 0) {
        quests.east = 'cleared';
        world.dmgText.show(player.pos.x, player.pos.y - 1.2, 'THE LAST LOOTER FALLS · THE QUARTER IS QUIET', 'crit');
        startReclaim();
      }
    };
    /** Ticks left before the cleared forest sends the party home. */
    let forestReturnTicks = -1;
    /** The last beast falls: a moment, then the way home, then the gatekeeper's thanks (it.87). */
    /**
     * THE WAY IN IS LIT (it.98). A procession's people come from off the map, over
     * ground the hero has usually never stood on - unlit, and often unexplored, so
     * they walked in as silhouettes or not at all. Open the fog along the route and
     * hang a warm lamp over its first stretch for as long as the scene runs.
     */
    const lightTheWayIn = (from: { x: number; y: number }, route: ReadonlyArray<{ x: number; y: number }>): void => {
      // The scene's own sight and full-brightness radius, for as long as the bars are down.
      world.lighting.setSceneLight(true);
      cineFogTile = -1;
      // A warm lamp over every stretch of the road, and over the ground between the
      // waypoints too - the folk are walking the whole way, not just the first leg.
      const lamps: Array<{ x: number; y: number }> = [from];
      let prev = from;
      for (const at of route) {
        const steps = Math.max(1, Math.round(Math.hypot(at.x - prev.x, at.y - prev.y) / 5));
        for (let i = 1; i <= steps; i++) lamps.push({ x: prev.x + ((at.x - prev.x) * i) / steps, y: prev.y + ((at.y - prev.y) * i) / steps });
        prev = at;
      }
      for (const at of lamps) {
        world.lighting.updateVisibility(Math.round(at.x), Math.round(at.y)); // The road is seen before it is walked.
        world.lighting.addSource(at.x + 0.5, at.y + 0.5, 10, 255, 216, 164, 0.9);
      }
      world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
    };
    /** THE FOREST'S HOMECOMING (it.92): the last beast down, the folk walk in from the town road through the clearings before the way home. */
    const startForestScene = (): void => {
      if (reclaim) return;
      const forestFrom = { x: 3, y: 20 };
      const forestRoute = [{ x: 8, y: 20 }, { x: 14, y: 17 }, { x: 20, y: 21 }, { x: 26, y: 24 }, { x: 28, y: 22 }];
      lightTheWayIn(forestFrom, forestRoute);
      reclaim = new ProcessionScene({
        layer: world.viewport.objectLayer,
        ambience: world.ambience,
        fx: gateFx,
        carts: [],
        at: { x: 6, y: 20 },
        from: forestFrom,
        route: forestRoute,
        titles: [['THE DARK FOREST', 'the last beast falls · the road is open'], ['THE PEOPLE RETURN', 'the clearings are theirs again']],
        walkers: 7,
        keepWalkers: true, // They stay in the clearing (it.93).
        ...cineFocusHooks,
        sfx: (n) => audio.sfx(n),
        onDone: () => {
          reclaim?.destroy();
          reclaim = null;
          forestReturnTicks = 1; // The next tick pays the errand, here in the forest.
        },
      });
    };
    const tickForestQuest = (): void => {
      if (floor !== FOREST_FLOOR || quests.forest !== 'active' || transitioning) return;
      if (forestReturnTicks < 0) {
        let alive = 0;
        world.enemies.forEachActive((e) => {
          if (e.hp > 0 && e.action !== 'dead') alive++;
        });
        if (alive > 0) return;
        forestReturnTicks = 0; // Held while the homecoming plays; its end sets the clock to one.
        world.dmgText.show(player.pos.x, player.pos.y - 1.2, 'THE FOREST IS QUIET', 'crit');
        audio.sfx('questDone');
        startForestScene();
        return;
      }
      if (forestReturnTicks === 0) return; // The homecoming is on.
      if (--forestReturnTicks > 0) return;
      forestReturnTicks = -1;
      // PAID HERE (it.93): the gatekeeper came up the road with his people; the thanks and the gold are given in the clearing, no road home.
      quests.forest = 'done';
      for (const seat of liveSeats()) seat.player.gold += 100; // The guild's purse, every hero of the party.
      eventBus.emit('inventory:changed', {});
      showReward('REWARD RECEIVED · 100 GOLD');
      audio.sfx('questDone'); // The fanfare (it.89).
      world.ambience.burst(player.pos.x, player.pos.y, 0xffd070, 26);
      world.dmgText.show(player.pos.x, player.pos.y - 0.8, '+100 GOLD · THE FOREST ERRAND', 'crit');
      void dialogue.open({
        speaker: 'SIR HAM',
        role: 'come up the road with his people',
        portrait: keeperPortrait(),
        lines: ['All of them? Good work. Here\'s your pay from the guild - a hundred gold (100).', 'The quarry is at the far end of the woods. Whatever is down there, it isn\'t wolves. The road home is behind you when you want it.'],
        choices: [{ label: 'THANKS', value: 'ok' }],
      });
      saveNow();
    };
    // ================= THE CELLAR (it.97) =================================
    // The keeper's second errand: her stock is in the vault under the taproom
    // and something has moved in among the casks. The back door is locked until
    // she asks; the woman at the deep end is not seen until the dark is cleared.
    /** Ticks left before the rescue's dialogue, once the cutscene has played. */
    let cellarSceneTicks = -1;
    /**
     * SARAH steps out (it.98). She is built with the floor but kept dark and
     * wordless while anything is still moving in the vault; the moment the last
     * one is down she is shown where she has been hiding, and her word comes back.
     */
    const revealCellarGirl = (): void => {
      const g = world.town?.cellarGirl;
      if (!g) return;
      if (g.sprite && !g.sprite.parent) {
        g.sprite.visible = true;
        world.viewport.objectLayer.addChild(g.sprite);
      }
      const list = world.town!.interactables;
      if (!list.some((i) => i.id === g.id)) {
        const at = world.town!.layout.cellar?.girl;
        if (at) list.push({ id: g.id, kind: 'cellargirl', x: at.x + 0.5, y: at.y + 0.5, label: 'E · SPEAK', tiles: [{ x: at.x, y: at.y }, { x: at.x - 1, y: at.y }, { x: at.x + 1, y: at.y }, { x: at.x, y: at.y - 1 }, { x: at.x, y: at.y + 1 }] });
      }
    };
    /** The way down into the vault, and back up into the taproom. */
    const goCellar = (): void => goPlace(CELLAR_FLOOR, 'down into the cellar');
    const leaveCellar = (): void =>
      withFade(async () => {
        await preloadFloor(INN_FLOOR, 'inn');
        if (!swapWorld(() => buildWorld(INN_FLOOR, 'inn'))) return;
        floor = INN_FLOOR;
        updateDepth();
        floorStartTick = state.tick;
        floorActiveTicks = 0;
        player.action = 'idle';
        const at = world.town?.layout.inn?.cellarDoor;
        if (at) placeParty(at.x + 1.5, at.y + 0.5, world.scene.isWalkable);
        world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
        minimap.markDirty();
        updateOrb();
      }, 'up to the taproom');
    /** The cutscene: the bars close, the camera finds her among the casks. */
    const startCellarScene = (): void => {
      if (reclaim) return;
      const at = world.town?.layout.cellar?.girl ?? { x: 29, y: 22 };
      // The camera is about to look into a corner the hero has never lit: open
      // the fog there first, or the scene plays over solid black.
      world.lighting.updateVisibility(at.x, at.y);
      reclaim = new ProcessionScene({
        layer: world.viewport.objectLayer,
        ambience: world.ambience,
        fx: gateFx,
        carts: [],
        at: { x: at.x, y: at.y },
        from: { x: at.x, y: at.y },
        route: [],
        titles: [['THE CELLAR IS QUIET', 'the last of them falls among the casks'], ['SOMEONE IS DOWN HERE', 'a light behind the crates, and a voice']],
        walkers: 0,
        keepWalkers: true,
        hold: 4.5, // Nobody walks in this one: hold on her, then let her speak.
        ...cineFocusHooks,
        sfx: (n) => audio.sfx(n),
        onDone: () => {
          reclaim?.destroy();
          reclaim = null;
          world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y)); // The sight comes back to the hero.
          cellarSceneTicks = 1; // The next tick gives her her words.
        },
      });
    };
    /** Her thanks, and the errand paid where she stands. */
    const girlRescueTalk = async (): Promise<void> => {
      const v = await dialogue.open({
        speaker: 'SARAH',
        role: 'of the Gilded Stag',
        portrait: girlPortrait(),
        lines: [
          'Is it over? Are they dead? I was hiding from the looters in the basement, and then these monsters appeared...',
          'I was hiding here until you showed up. Thank you for saving me!',
        ],
        choices: [{ label: '...', sub: 'she presses a purse and a draught into your hand', value: 'ok' }],
      });
      if (v !== null) inputQueue.enqueue({ type: 'QUEST', playerId: localSlot, id: 'cellar', step: 'rescue' });
    };
    /** A word with her afterwards, down here or behind the bar. */
    const girlTalk = async (): Promise<void> => {
      await dialogue.open({
        speaker: 'SARAH',
        role: 'of the Gilded Stag',
        portrait: girlPortrait(),
        lines: [
          quests.cellar === 'done'
            ? 'Thank you. I mean it. I would still be behind those crates if you had not come down.'
            : 'Please - do not leave me down here.',
        ],
        choices: [{ label: 'TAKE CARE', value: 'ok' }],
      });
    };
    /** Each tick in the vault: the count, then the scene, then her words. */
    const tickCellarQuest = (): void => {
      if (floor !== CELLAR_FLOOR || quests.cellar !== 'active' || transitioning) return;
      if (cellarSceneTicks === -2) return; // Played already: her words are open, or were closed unanswered.
      if (cellarSceneTicks < 0) {
        let alive = 0;
        world.enemies.forEachActive((e) => {
          if (e.hp > 0 && e.action !== 'dead') alive++;
        });
        if (alive > 0) return;
        cellarSceneTicks = 0; // Held while the scene plays; its end sets the clock to one.
        revealCellarGirl(); // Only now does she come out from behind the crates (it.98).
        world.dmgText.show(player.pos.x, player.pos.y - 1.2, 'THE CELLAR IS QUIET', 'crit');
        audio.sfx('questDone');
        startCellarScene();
        return;
      }
      if (cellarSceneTicks === 0) return; // The scene is on.
      if (--cellarSceneTicks > 0) return;
      cellarSceneTicks = -2; // Spent: the scene never plays twice.
      void girlRescueTalk();
    };
    /**
     * The ledger's two steps. `accept` unlocks the back door and rebuilds the
     * taproom around the hero so the key turns in front of them; `rescue` pays
     * her hundred gold and her draught to every hero of the party.
     */
    const applyCellarStep = (step: string): void => {
      if (step === 'accept') {
        if (quests.east !== 'done' || (quests.cellar ?? 'new') !== 'new' || floor !== INN_FLOOR) return;
        quests.cellar = 'active';
        saveNow();
        audio.sfx('gateOpen');
        withFade(async () => {
          await preloadFloor(INN_FLOOR, 'inn');
          if (!swapWorld(() => buildWorld(INN_FLOOR, 'inn'))) return;
          const at = world.town?.layout.inn?.cellarDoor;
          if (at) placeParty(at.x + 2.5, at.y + 0.5, world.scene.isWalkable);
          world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
          minimap.markDirty();
          tutorial.say('The back door is open. Whatever is in his cellar, it is between you and the drink.');
        }, 'the bolt slides back');
        return;
      }
      if (step !== 'rescue' || quests.cellar !== 'active' || floor !== CELLAR_FLOOR) return;
      quests.cellar = 'done';
      for (const seat of liveSeats()) {
        seat.player.gold += 100;
        seat.player.addItem('health_potion');
      }
      eventBus.emit('inventory:changed', {});
      showReward('REWARD RECEIVED · 100 GOLD · A HEALTH DRAUGHT');
      audio.sfx('questDone');
      world.ambience.burst(player.pos.x, player.pos.y, 0xffd070, 26);
      world.dmgText.show(player.pos.x, player.pos.y - 0.8, '+100 GOLD · A HEALTH DRAUGHT', 'crit');
      saveNow();
    };

    // ================= THE FARMLANDS (it.100) =============================
    // The city's third errand, and its first pitched battle: a free company has
    // taken the fields along the marsh path and put the crop to the torch, and
    // the officer at the training ground wants them off it.
    //
    // `quests.farm`:  new -> 'active' (the muster is taken) -> 'done' (the field is the city's).
    /** True once the woods and the eastern quarter are both settled. */
    const farmOffered = (): boolean => quests.forest === 'done' && quests.east === 'done';
    /** Ticks left before the officer's word, once the rally has played. */
    let rallyTicks = -1;
    /** Ticks left before the victory scene pays out. */
    let farmWonTicks = -1;
    /** The general's next taunt, and the cooldown on his hand. */
    let generalLine = 0;
    let generalCool = 0;
    const GENERAL_LINES = [
        'HOLD THE ROWS',
        'THE CITY STARVES',
        'BURN IT ALL',
        'YOU BROUGHT CHILDREN',
        'NO ONE EATS TONIGHT',
    ];
    const officerPortrait = (): HTMLCanvasElement | null => keeperPortrait();
    const goFarm = (): void => goPlace(FARM_FLOOR, 'out to the fields');

    /** The muster: the crowd gathers on the yard and the officer speaks. */
    const startRally = (): void => {
      if (reclaim || !world.town) return;
      const yard = world.town.layout.training?.mark ?? { x: 16, y: 72 };
      const from = { x: 22, y: 70 };
      const route = [{ x: 20, y: 71 }, { x: 18, y: 72 }, { x: yard.x + 1, y: yard.y }];
      lightTheWayIn(from, route);
      reclaim = new ProcessionScene({
        layer: world.viewport.objectLayer,
        ambience: world.ambience,
        fx: gateFx,
        carts: [],
        at: { x: yard.x, y: yard.y },
        from,
        route,
        titles: [['THE FIELDS ARE BURNING', 'the city gathers at the training ground'], ['A COMPANY HOLDS THE ROWS', 'the officer calls for a sword']],
        walkers: 10,
        keepWalkers: true,
        hold: 6,
        ...cineFocusHooks,
        sfx: (n) => audio.sfx(n),
        onDone: () => {
          reclaim?.destroy();
          reclaim = null;
          world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
          rallyTicks = 1;
        },
      });
    };

    /** The officer's word at the yard, and the muster taken. */
    const officerTalk = async (): Promise<void> => {
      const who = { speaker: 'CAPTAIN ORDWAY', role: 'of the city watch', portrait: officerPortrait() };
      if (quests.farm === 'done') {
        await dialogue.open({
          ...who,
          lines: ['The fields are ours, and the carts are running again. The city eats because you went out there.'],
          choices: [{ label: 'GOOD', value: 'ok' }],
        });
        return;
      }
      if (quests.farm === 'active') {
        await dialogue.open({
          ...who,
          lines: ['My men are on the muster ground and the road is open. Go when you are ready - and stay near them, they fight better with someone to follow.'],
          choices: [{ label: 'UNDERSTOOD', value: 'ok' }],
        });
        return;
      }
      const v = await dialogue.open({
        ...who,
        lines: [
          'You have heard it by now. There is no bread in the market and there will be none next week either.',
          'A free company came up the marsh path and took the fields. They are burning the crop as they go - not to hold it, just so we cannot have it.',
          'I am taking every guard I can arm and going out there tonight. I would rather go with you than without you.',
        ],
        choices: [
          { label: 'I WILL COME', sub: 'the squad musters at the marsh gate', value: 'go' },
          { label: 'NOT YET', value: 'stay' },
        ],
      });
      if (v === 'go') inputQueue.enqueue({ type: 'QUEST', playerId: localSlot, id: 'farm', step: 'accept' });
    };

    /** The victory: the officer, then the folk back onto the land. */
    const startFarmVictory = (): void => {
      if (reclaim) return;
      const at = world.town?.layout.farm?.entry ?? { x: 5, y: 33 };
      const from = { x: 2, y: 33 };
      const route = [{ x: 8, y: 32 }, { x: 16, y: 28 }, { x: 26, y: 22 }, { x: 34, y: 18 }, { x: 40, y: 14 }];
      lightTheWayIn(from, route);
      reclaim = new ProcessionScene({
        layer: world.viewport.objectLayer,
        ambience: world.ambience,
        fx: gateFx,
        carts: [],
        at: { x: at.x + 2, y: at.y - 2 },
        from,
        route,
        titles: [['THE FIELD IS TAKEN', 'the company is broken and its general is down'], ['THE PEOPLE COME OUT', 'there will be a harvest after all']],
        walkers: 9,
        keepWalkers: true,
        ...cineFocusHooks,
        sfx: (n) => audio.sfx(n),
        onDone: () => {
          reclaim?.destroy();
          reclaim = null;
          world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
          farmWonTicks = 1;
        },
      });
    };

    /**
     * Each tick in town: once the woods and the quarter are settled, walking onto
     * the training ground calls the muster - once, and never during a fade.
     */
    const tickRally = (): void => {
      if (floor !== 0 || transitioning || !world.town) return;
      if (rallyTicks === 0) return; // the rally is playing
      if (rallyTicks > 0) {
        if (--rallyTicks > 0) return;
        rallyTicks = -1;
        void officerTalk();
        return;
      }
      if (!farmOffered() || (quests.farm ?? 'new') !== 'new') return;
      const yard = world.town.layout.training?.mark;
      if (!yard) return;
      if (Math.hypot(player.pos.x - (yard.x + 0.5), player.pos.y - (yard.y + 0.5)) > 5) return;
      rallyTicks = 0;
      audio.sfx('questDone');
      startRally();
    };

    /**
     * Each tick in the fields: the general leans on the hero while he stands, and
     * the last man down brings the people back out.
     */
    const tickFarmQuest = (): void => {
      if (floor !== FARM_FLOOR || transitioning) return;
      if (quests.farm !== 'active') return;
      // THE GENERAL'S WORD (it.100): while he is on his feet and the hero is in
      // his reach, he shreds their plate and takes their legs, and says so.
      const gen = world.farmGeneral;
      if (gen && gen.hp > 0 && gen.action !== 'dead') {
        const d = Math.hypot(gen.pos.x - player.pos.x, gen.pos.y - player.pos.y);
        if (generalCool > 0) generalCool--;
        else if (d < 11) {
          generalCool = 300; // once every five seconds at most
          for (const seat of liveSeats()) {
            seat.player.applyShred(240, 0.35);
            seat.player.applySlow(120);
          }
          world.dmgText.show(gen.pos.x, gen.pos.y - 1.9, GENERAL_LINES[generalLine % GENERAL_LINES.length], 'crit');
          generalLine++;
          world.ambience.burst(player.pos.x, player.pos.y, 0xff6a4a, 16);
          audio.sfx('bossHorn');
        }
      }
      if (farmWonTicks === 0) return; // the victory scene is on
      if (farmWonTicks > 0) {
        if (--farmWonTicks > 0) return;
        farmWonTicks = -1;
        quests.farm = 'done';
        for (const seat of liveSeats()) seat.player.gold += 250;
        eventBus.emit('inventory:changed', {});
        showReward('REWARD RECEIVED · 250 GOLD · THE FIELDS ARE THE CITYS');
        audio.sfx('questDone');
        world.ambience.burst(player.pos.x, player.pos.y, 0xffd070, 30);
        saveNow();
        void dialogue.open({
          speaker: 'CAPTAIN ORDWAY',
          role: 'on the taken ground',
          portrait: officerPortrait(),
          lines: [
            'That was not a brawl, that was a battle, and you fought it like someone who has read one.',
            'Two hundred and fifty from the city purse. The carts will be running by morning, and there will be bread in the market by the end of the week.',
            'The marsh path is still barricaded. Whatever came up it once can come up it again - but that is a worry for another night.',
          ],
          choices: [{ label: 'IT WAS A GOOD DAY', value: 'ok' }],
        });
        return;
      }
      let alive = 0;
      world.enemies.forEachActive((e) => {
        if (e.hp > 0 && e.action !== 'dead') alive++;
      });
      if (alive > 0) return;
      farmWonTicks = 0;
      if (world.squad) world.squad.fighting = false;
      world.dmgText.show(player.pos.x, player.pos.y - 1.2, 'THE FIELD IS TAKEN', 'crit');
      audio.sfx('questDone');
      startFarmVictory();
    };

    /** The ledger's one step: the muster is taken and the road out opens. */
    const applyFarmStep = (step: string): void => {
      if (step !== 'accept' || !farmOffered() || (quests.farm ?? 'new') !== 'new' || floor !== 0) return;
      quests.farm = 'active';
      saveNow();
      audio.sfx('gateOpen');
      tutorial.say('The squad musters at the marsh gate, south of the market plaza. Go out when you are ready.');
    };

    const goMines = (): void => goPlace(MINES_FLOOR, 'down into the quarry');
    /** THE GILDED STAG (it.92): through the door into the inn's own floor, and back out to its step. */
    const goInn = (): void => goPlace(INN_FLOOR, 'into the Gilded Stag');
    const leaveInn = (): void =>
      withFade(async () => {
        await preloadFloor(0, 'hub');
        if (!swapWorld(() => buildWorld(0, 'hub'))) return;
        enterTown(false);
        const door = world.town?.layout.east?.door;
        if (door) placeParty(door.x + 0.5, door.y + 1.5, world.scene.isWalkable);
        world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
        minimap.markDirty();
        updateOrb();
      }, 'out to the street');

    // ---- PARTY HUD + WAITING VEIL (it.59) --------------------------------
    const partyHud = document.createElement('div');
    partyHud.id = 'party-hud';
    if (coop) document.body.appendChild(partyHud);
    const partyRows = new Map<number, { hp: HTMLElement; row: HTMLElement; ping: HTMLElement }>();
    const refreshPartyHud = (): void => {
      if (!coop) return;
      partyHud.innerHTML = '';
      partyRows.clear();
      for (const seat of liveSeats()) {
        const row = document.createElement('div');
        row.className = 'ph-row' + (seat.slot === localSlot ? ' me' : '');
        row.style.setProperty('--slot-color', seat.colorCss);
        const name = document.createElement('b');
        name.textContent = seat.name + (seat.slot === leaderSlot ? ' ★' : '');
        const cls = document.createElement('span');
        cls.textContent = seat.cls;
        const ping = document.createElement('u');
        ping.className = 'ph-ping';
        const bar = document.createElement('div');
        bar.className = 'ph-bar';
        const hp = document.createElement('i');
        bar.appendChild(hp);
        row.append(name, cls, ping, bar);
        partyHud.appendChild(row);
        partyRows.set(seat.slot, { hp, row, ping });
      }
    };
    refreshPartyHud();
    let partyHudClock = 0;
    const coopWait = document.createElement('div');
    coopWait.id = 'coop-wait';
    coopWait.innerHTML = '<div class="cw-box"><b>WAITING FOR THE PARTY</b><span></span></div>';
    if (coop) document.body.appendChild(coopWait);
    const updatePartyHud = (dt: number): void => {
      partyHudClock += dt;
      if (partyHudClock < 0.1) return;
      partyHudClock = 0;
      for (const seat of liveSeats()) {
        const r = partyRows.get(seat.slot);
        if (!r) continue;
        r.hp.style.width = `${Math.max(0, Math.min(100, (seat.player.hp / Math.max(1, seat.player.hpMax)) * 100)).toFixed(1)}%`;
        r.row.classList.toggle('dead', seat.player.action === 'dead');
        r.row.classList.toggle('reconnecting', seat.link === 'reconnecting');
        r.row.classList.toggle('lagging', seat.link === 'lagging');
        // LATENCY (it.60): the leader's heartbeat round trip, green / amber / red.
        if (net) {
          const ms = seat.slot === localSlot && !net.isHost ? net.ping : seat.slot === 0 ? 0 : (net.members.find((m) => m.slot === seat.slot)?.ping ?? 0);
          const text = seat.link === 'reconnecting' ? 'RECONNECTING…' : seat.slot === 0 && net.isHost ? 'HOST' : `${ms} ms`;
          if (r.ping.textContent !== text) r.ping.textContent = text;
          r.ping.className = 'ph-ping ' + (seat.link === 'reconnecting' ? 'poor' : ms < 80 ? 'good' : ms < 200 ? 'fair' : 'poor');
        }
      }
      if (lockstep && net) {
        const catching = lockstep.catchingUp;
        const hostOut = !net.isHost && net.hostLink === 'reconnecting';
        const ms = lockstep.stalledMs;
        const show = catching || hostOut || ms > 700;
        coopWait.classList.toggle('show', show);
        const title = coopWait.querySelector('b');
        const span = coopWait.querySelector('span');
        if (show && title && span) {
          if (catching) {
            title.textContent = 'CATCHING UP WITH THE PARTY';
            span.textContent = `${Math.round(lockstep.replayProgress * 100)}% of the delve so far`;
          } else if (hostOut) {
            title.textContent = 'RECONNECTING';
            span.textContent = 'reaching the Party Leader again…';
          } else {
            title.textContent = 'WAITING FOR THE PARTY';
            const missing = lockstep.isLeader ? lockstep.missingSlots(state.tick + 1).map((s) => party[s]?.name ?? `seat ${s + 1}`) : [];
            span.textContent = lockstep.inBarrier ? 'the floor is being raised on every screen…' : missing.length ? `waiting on ${missing.join(', ')}` : 'waiting for the leader…';
          }
        }
      }
      if (coop && player.action === 'dead' && deathNote) {
        const left = Math.max(0, Math.ceil((COOP_REVIVE_TICKS - player.actionTicks) / 60));
        deathNote.dataset.revive = `YOU RISE AGAIN IN ${left}s`;
      }
    };

    if (coop) cheatMenu.destroy();

    // --- Loop ---------------------------------------------------------------
    const cameraFocus = vec2();
    /** THE RECLAIMING (it.91): where the camera looks instead of the hero, and its eased position. */
    let cineFocus: { x: number; y: number } | null = null;
    let cineBlend = false;
    const cineCur = vec2();
    const gateFx = new GateFx(() => world.ambience);
    let restGlint = 0;
    /**
     * TARGET POINTERS (it.91): chevrons on the screen's edge toward the
     * nearest three quest targets off it - the quarter's looters, the
     * forest's beasts - each with its distance in strides.
     */
    const foePointers = document.createElement('div');
    foePointers.id = 'foe-pointers';
    for (let i = 0; i < 3; i++) {
      const p = document.createElement('div');
      p.className = 'foe-ptr';
      p.innerHTML = '<i></i><b></b>';
      foePointers.appendChild(p);
    }
    document.body.appendChild(foePointers);
    subs.push(() => foePointers.remove());
    const ptrScratch = vec2();
    /** OVERHEAD MARKS (it.92): a bobbing red chevron over every quest target on the screen; a pool of twenty-four. */
    // THE CITY'S OWN (it.100): eight blue chevrons, enough for any squad.
    const allyOver = document.createElement('div');
    allyOver.id = 'ally-over';
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('div');
      p.className = 'ally-mk';
      p.innerHTML = '<i></i>';
      allyOver.appendChild(p);
    }
    document.body.appendChild(allyOver);
    subs.push(() => allyOver.remove());
    /** Blue chevrons over the squad, wherever they are on screen. */
    const updateAllyMarks = (): void => {
      const els = allyOver.children;
      const squad = world.squad;
      let n = 0;
      if (squad && !reclaim) {
        const rect = app.canvas.getBoundingClientRect();
        const W = screenLayout.state.w;
        const H = screenLayout.state.h;
        for (const m of squad.positions()) {
          if (n >= els.length) break;
          const c = world.camera.worldToCanvas(m.x, m.y, ptrScratch);
          const px = rect.left + c.x;
          const py = rect.top + c.y - 74 * world.camera.currentZoom;
          if (px < 8 || px > W - 8 || py < 8 || py > H - 8) continue;
          const el = els[n++] as HTMLElement;
          el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
          el.classList.toggle('officer', m.officer);
          el.classList.add('show');
        }
      }
      for (let i = n; i < els.length; i++) (els[i] as HTMLElement).classList.remove('show');
    };
    const foeOver = document.createElement('div');
    foeOver.id = 'foe-over';
    for (let i = 0; i < 24; i++) {
      const p = document.createElement('i');
      foeOver.appendChild(p);
    }
    document.body.appendChild(foeOver);
    subs.push(() => foeOver.remove());
    const updateFoePointers = (targets: Array<{ x: number; y: number }> | null): void => {
      const els = foePointers.children;
      const overs = foeOver.children;
      if (!targets || !targets.length || reclaim) {
        for (let i = 0; i < els.length; i++) (els[i] as HTMLElement).classList.remove('show');
        for (let i = 0; i < overs.length; i++) (overs[i] as HTMLElement).classList.remove('show');
        return;
      }
      const W = screenLayout.state.w;
      const H = screenLayout.state.h;
      const rect = app.canvas.getBoundingClientRect();
      const margin = screenLayout.state.touch ? 34 : 28;
      const sorted = targets
        .map((t) => ({ t, d: Math.hypot(t.x - player.pos.x, t.y - player.pos.y) }))
        .sort((a, b) => a.d - b.d);
      let shown = 0;
      let over = 0;
      const placed: Array<{ x: number; y: number }> = [];
      for (const { t, d } of sorted) {
        const c = world.camera.worldToCanvas(t.x, t.y, ptrScratch);
        const px = rect.left + c.x;
        const py = rect.top + c.y;
        const inside = px > 40 && px < W - 40 && py > 40 && py < H - 40;
        if (inside) {
          // On the screen: a chevron over the head.
          if (over < overs.length && world.lighting.isVisible(Math.floor(t.x), Math.floor(t.y))) {
            const el = overs[over++] as HTMLElement;
            el.style.transform = `translate(${px.toFixed(1)}px, ${(py - 78 * world.camera.currentZoom).toFixed(1)}px)`;
            el.classList.add('show');
          }
          continue;
        }
        if (shown >= els.length) continue;
        const cx = W / 2;
        const cy = H / 2;
        const dx = px - cx;
        const dy = py - cy;
        // Clamp the ray to the padded screen rectangle.
        const sx = (W / 2 - margin) / Math.max(1e-3, Math.abs(dx));
        const sy = (H / 2 - margin) / Math.max(1e-3, Math.abs(dy));
        const s = Math.min(sx, sy, 1);
        const ex = cx + dx * s;
        const ey = cy + dy * s;
        if (placed.some((q) => Math.hypot(q.x - ex, q.y - ey) < 34)) continue; // Two in one direction share one chevron.
        placed.push({ x: ex, y: ey });
        const el = els[shown++] as HTMLElement;
        el.style.transform = `translate(${ex.toFixed(1)}px, ${ey.toFixed(1)}px)`;
        (el.firstElementChild as HTMLElement).style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
        el.lastElementChild!.textContent = `${Math.round(d)}`;
        el.classList.add('show');
      }
      for (let i = shown; i < els.length; i++) (els[i] as HTMLElement).classList.remove('show');
      for (let i = over; i < overs.length; i++) (overs[i] as HTMLElement).classList.remove('show');
    };
    const pickRingScratch = vec2();
    let lastRenderTime = performance.now();

    // ERROR BOUNDARY (it.37): an exception inside a tick or a frame must
    // never kill the rAF loop (that was a silent freeze). Report the first
    // few, keep running.
    let loopErrors = 0;
    /** Culling state (a DEV switch: `__game.setCull(false)` to compare). */
    let cullOn = true;
    let cullStats: CullStats = { total: 0, culled: 0 };
    const keepSet = new Set<Container>();
    const reportLoopError = (where: string, err: unknown): void => {
      loopErrors++;
      if (loopErrors <= 5) console.error(`[loop] ${where} threw (${loopErrors}):`, err);
    };

    const loop = new GameLoop({
      update: (dt, tick) => {
        try {
          tickUpdate(dt, tick);
        } catch (err) {
          reportLoopError('update', err);
        }
      },
      render: (alpha) => {
        try {
          frameRender(alpha);
        } catch (err) {
          reportLoopError('render', err);
        }
      },
    });

    function tickUpdate(dt: number, tick: number): void {
      {
        simTick = tick;
        if (hitStopTicks > 0) {
          // HIT-STOP (it.48): the world holds its breath for a frame or two.
          hitStopTicks--;
          return;
        }
        if (pendingDescend) {
          pendingDescend = false;
          descend();
        }
        if (pendingArena) {
          pendingArena = false;
          enterArena();
        }
        state.tick = tick;
        stateSync.update(tick);
        // THE ACTIVE CLOCK (it.54): the town and the intermissions stand still.
        if (!world.town && (!world.coliseum || world.coliseum.phase === 'fight')) {
          activeTicks++;
          floorActiveTicks++;
        }

        state.forEach((entity) => entity.beginTick());
        // THE COMMAND STREAM (it.59): solo drains the local queue; co-op ships
        // it and executes the party's merged frame for this tick.
        if (reclaim?.running) inputQueue.clear(); // THE RECLAIMING (it.91): the hero watches.
        const local = inputQueue.drain();
        const commands = lockstep ? lockstep.frame(tick, local) : local;
        if (leaderNoteCooldown > 0) leaderNoteCooldown--;
        for (const cmd of commands) if (cmd.playerId === localSlot) tutor.noteCommand(cmd.type); // THE TRAINING GROUND (it.90).
        for (const cmd of commands) {
          if (cmd.type === 'AIM') {
            const seat = party[cmd.playerId];
            if (seat && !seat.gone) seat.aim = { x: cmd.x, y: cmd.y };
          } else if (cmd.type === 'LEAVE') {
            removeSeat(cmd.playerId);
          } else if (cmd.type === 'JOIN') {
            addSeat(cmd.playerId, cmd.name, cmd.cls, cmd.hero);
          } else if (cmd.type === 'QUEST') {
            // THE EASTERN QUARTER (it.91): the leader's word, everyone's tick.
            if (coop && cmd.playerId !== leaderSlot) continue;
            if (cmd.id === 'east') applyEastStep(cmd.step);
      else if (cmd.id === 'cellar') applyCellarStep(cmd.step); // THE CELLAR (it.97).
            else if (cmd.id === 'farm') applyFarmStep(cmd.step); // THE FARMLANDS (it.100).
          } else if (cmd.type === 'WARP') {
            if (coop && cmd.playerId !== leaderSlot) {
              if (cmd.playerId === localSlot) leaderOnlyNote();
              continue;
            }
            if (transitioning) continue;
            if (cmd.to === 'coliseum') {
              chat?.system('Leader entering the Coliseum. Warping party...');
              enterColiseum(cmd.n ?? 5);
            } else if (cmd.to === 'town') {
              victoryShown = false;
              chat?.system('Leader returning to town. Warping party...');
              // THE ROAD HOME (it.98): out of the woods you step back onto the eastern
              // road, where you left it - not into the middle of the old quarter.
              goHome(floor === FOREST_FLOOR ? 'forest' : undefined);
            } else if (cmd.to === 'floor' && cmd.n !== undefined) {
              chat?.system(`Leader fast-travelling to depth ${ROMAN[cmd.n - 1] ?? cmd.n}. Warping party...`);
              jumpToFloor(cmd.n);
            } else if (cmd.to === 'crown') {
              if (!victoryShown) {
                victoryShown = true;
                runEndgame();
              }
            } else if (cmd.to === 'portalBack') {
              returnThroughPortal();
            }
          }
        }
        for (const mv of world.movements) mv?.applyCommands(commands);
        world.combat.applyCommands(commands);
        for (const inv of inventories) inv?.apply(commands);
        for (const sk of skillSystems) sk?.apply(commands); // Hotkeys 1–4 (it.32).
        town.apply(commands); // Buy / sell / stash (it.39).
        crafting.apply(commands); // The camp forge (it.78).
        if (world.mines) tickMines(); // THE IRON GATES (it.85): a key at a gate opens it.
        tickForestQuest(); // THE FOREST ERRAND (it.87).
        tickEastQuest(); // THE EASTERN QUARTER (it.91).
        tickCellarQuest(); // THE CELLAR (it.97).
        tickRally(); // THE MUSTER (it.100).
        tickFarmQuest(); // THE FARMLANDS (it.100).
        // THE CITY'S OWN (it.100): the squad fights on the sim tick, so a co-op
        // party stays in step and `dealDamage` remains the only hp mutator.
        if (world.squad) {
          const foes: Array<{ id: number; hp: number; action: string; pos: { x: number; y: number } }> = [];
          world.enemies.forEachActive((e) => {
            if (e.hp > 0 && e.action !== 'dead') foes.push(e);
          });
          world.squad.step(dt, foes, (targetId, amount) => world.combat.dealDamage({ sourceId: player.id, targetId, amount }));
        }
        if (world.town) town.restockIfDue(baseSeed, deepestFloor, tick); // The merchants' clock (it.78).
        if (world.town) handleTownInteraction(commands);
        for (const cmd of commands) {
          if (cmd.type !== 'TOWN_PORTAL') continue;
          // FREE TOWN PORTAL (it.43): T opens the way home on a 12 s cooldown.
          // CO-OP (it.59): only the Party Leader's rift moves the party.
          if (coop && cmd.playerId !== leaderSlot) {
            if (cmd.playerId === localSlot) leaderOnlyNote();
            continue;
          }
          if (world.town) world.dmgText.show(player.pos.x, player.pos.y - 1, 'YOU ARE HOME', 'miss');
          else if (world.coliseum) {
            // T (it.56): the teleporter rises at the centre; a second T while it stands leaves at once.
            if (world.coliseum.exit) leaveColiseum();
            else {
              openExitTeleporter();
              world.dmgText.show(player.pos.x, player.pos.y - 1.2, 'THE WAY HOME OPENS AT THE CENTRE', 'miss');
            }
          }
          else if (transitioning || pendingPortal) break;
          else if (portalCooldown > 0) world.dmgText.show(player.pos.x, player.pos.y - 1, `PORTAL IN ${Math.ceil(portalCooldown / 60)}s`, 'miss');
          else {
            pendingPortal = true;
            portalCooldown = 720;
            audio.sfx('portal');
          }
        }
        if (portalCooldown > 0) portalCooldown--;
        if (pendingPortal) {
          pendingPortal = false;
          castPortal();
        }
        for (const mv of world.movements) mv?.update(dt);
        world.combat.update();
        for (const sk of skillSystems) sk?.update();
        if (++sheetClock % 60 === 0) charSheetUI.tick();
        world.projectiles.update(dt);
        world.status.update(); // Wounds over time (it.80).
        // SEEKER (it.80): the party's best drop luck rides the floor's loot.
        let seek = 0;
        for (const seat of liveSeats()) seek = Math.max(seek, seat.player.traitPower('seeker'));
        world.loot.luck = 1 + 0.25 * seek;
        // THE AUTHORITY (it.73): the leader samples what changed; every
        // other peer pulls its copy toward the leader's.
        hostSync?.sample(tick);
        clientSync?.apply(tick);
        state.forEach((entity) => entity.update(dt));
        world.enemies.separate();
        // FROST-TOUCHED AURAS (it.53): a chilled hero inside three tiles of a frost champion.
        world.enemies.forEachActive((e) => {
          if (e.affix !== 'frost' || e.hp <= 0) return;
          for (const seat of liveSeats()) {
            const hero = seat.player;
            if (Math.hypot(e.pos.x - hero.pos.x, e.pos.y - hero.pos.y) < FROST_AURA_RADIUS) hero.chillTicks = Math.max(hero.chillTicks, 12);
          }
        });
        // TICK-CLOCKED BEATS (it.59): sim state must never wait on a wall clock.
        if (arenaTeleporterIn > 0 && --arenaTeleporterIn === 0) raiseArenaTeleporter();
        if (bossLoot && --bossLoot.ticks <= 0) {
          const bl = bossLoot;
          bossLoot = null;
          if (world === bl.world) {
            for (let i = 0; i < 3; i++) {
              const a = (i / 3) * Math.PI * 2 + 0.5;
              world.loot.dropRareAt(bl.x + Math.cos(a) * 0.9, bl.y + Math.sin(a) * 0.9);
            }
            world.ambience.playGlint(bl.x, bl.y);
            world.ambience.burst(bl.x, bl.y, 0xffd9a0, 20);
            audio.sfx('barrelBreak'); // The hoard bursts (it.89).
            world.camera.addKick(7);
            world.camera.addShake(0.4);
          }
        }
        if (world.coliseum) updateColiseum();
        // A remembered-cleared arena (it.58): the teleporter stands from the first tick.
        if ((world.isArena || world.mines) && world.arenaCleared && !world.victoryPortal && !transitioning) {
          const room = world.dungeon.rooms[0];
          world.victoryPortal = world.mines ? { x: world.mines.boss.x, y: world.mines.boss.y } : { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) };
          spawnTeleporterAt(world.victoryPortal.x, world.victoryPortal.y);
          victoryPortalArmed = true;
        }
        if (world.victoryPortal && !transitioning && !victoryShown) {
          const vp = world.victoryPortal;
          const lead = leaderHero();
          const d = Math.hypot(lead.pos.x - (vp.x + 0.5), lead.pos.y - (vp.y + 0.5));
          if (d > 1.6) victoryPortalArmed = true;
          else if (d < 0.9 && victoryPortalArmed && !victoryModal.classList.contains('open')) {
            victoryPortalArmed = false;
            if (world.mines || floor === MINES_FLOOR) {
              // THE WAY HOME (it.85): the quarry's teleporter goes back to town (from its arena too, it.88).
              if (localSlot === leaderSlot) goHome();
              else leaderOnlyNote();
            } else if (floor >= MAX_DEPTH) {
              if (localSlot === leaderSlot) {
                victoryModal.classList.add('open');
                audio.sfx('portal');
              } else {
                world.dmgText.show(player.pos.x, player.pos.y - 1.2, 'THE LEADER WEIGHS THE CROWN', 'miss');
              }
            } else {
              pendingDescend = true; // Depths V / X / XV: the teleporter goes deeper (it.58).
            }
          }
          if (coop && localSlot !== leaderSlot && Math.hypot(player.pos.x - (vp.x + 0.5), player.pos.y - (vp.y + 0.5)) < 0.9) leaderOnlyNote();
        }

        // Player death animation runs to completion, then the death overlay
        // takes over (it.36) — the loop freezes until a choice is made.
        // CO-OP (it.59): no overlay — the fallen rise beside the entrance after ten seconds.
        for (const seat of liveSeats()) {
          const hero = seat.player;
          if (hero.action !== 'dead') continue;
          hero.actionTicks++;
          if (coop) {
            if (hero.actionTicks >= COOP_REVIVE_TICKS) reviveSeat(seat);
          } else if (hero.actionTicks >= PLAYER_DEATH_TICKS && !runMenus.isDeathShown) {
            haptics.death();
            // HARDCORE (it.89): the one life is spent. The slot is wiped before the
            // sheet shows, so no reload and no closing tab can raise the delver again.
            const hardcore = difficulty.current.lives === 1;
            if (hardcore && !hardcoreOver) {
              hardcoreOver = true;
              saves.remove(slot);
            }
            if (audio.currentMusic !== 'death' && audio.currentMusic !== 'gameover') musicBeforeDeath = audio.currentMusic;
            audio.setMusic(hardcore ? 'gameover' : 'death', floor);
            runMenus.showDeath(
              `${floor < 0 ? 'The Coliseum' : floor === FOREST_FLOOR ? 'The forest' : floor === MINES_FLOOR ? 'The quarry' : floor === CELLAR_FLOOR ? 'The cellar' : floor === FARM_FLOOR ? 'The farmlands' : `Depth ${ROMAN[floor - 1] ?? floor}`} · level ${hero.level} · ${formatTime(state.tick)} in the dark · ${difficulty.current.name}`,
              hardcore,
            );
          }
        }

        // COMBAT VOICE HEARTBEAT (it.27): every ~2.5 s one nearby hunter
        // speaks — the fight never falls silent for long. Render-only.
        if (tick % 150 === 0) {
          const hunters: Enemy[] = [];
          world.enemies.forEachActive((e) => {
            if (e.hp > 0 && e.aiState === 'chase' && Math.hypot(e.pos.x - player.pos.x, e.pos.y - player.pos.y) < 8) {
              hunters.push(e);
            }
          });
          if (hunters.length > 0 && Math.random() < 0.7) {
            const speaker = hunters[Math.floor(Math.random() * hunters.length)];
            const v = voiceProfile(speaker.def.kind);
            audio.enemyVoice('idle', v.pitch, v.bank);
          }
        }

        // GOLD PICKUP (it.22): walking over a pile scoops it up — whichever hero gets there (it.59).
        for (const pile of world.goldPiles) {
          if (pile.taken) continue;
          for (const seat of liveSeats()) {
            const hero = seat.player;
            if (hero.action === 'dead' || Math.hypot(hero.pos.x - pile.x, hero.pos.y - pile.y) >= 0.75) continue;
            pile.taken = true;
            // DESTROY, don't hide (it.26): destroyed sprites stay gone.
            pile.sprite.destroy();
            pile.glow.destroy();
            // GOLD ON THE CURVE (it.78): piles grow at half the power curve, prices at all of it.
            const scooped = Math.round(pile.amount * (0.5 + 0.5 * powerScale(world.loot.ilvl)) * (1 + 0.25 * hero.traitPower('fortune')));
            hero.gold += scooped;
            hero.goldCollected += scooped;
            if (hero === player) audio.sfx('gold');
            world.ambience.sparks(pile.x, pile.y, 0, 0, 6, 0xffd870);
            world.dmgText.show(pile.x, pile.y, `+${pile.amount} gold`, 'crit');
            if (hero === player) updateProgressHud();
            break;
          }
        }

        // PROXIMITY TRIGGER (it.19): TOUCHING the staircase starts the descent.
        // CO-OP (it.59): the PARTY LEADER's feet decide; everyone else is warned.
        const lead = leaderHero();
        const stairsDist = Math.hypot(
          lead.pos.x - (world.stairs.x + 0.5),
          lead.pos.y - (world.stairs.y + 0.5),
        );
        if (coop && localSlot !== leaderSlot && !world.isArena && !world.town && Math.hypot(player.pos.x - (world.stairs.x + 0.5), player.pos.y - (world.stairs.y + 0.5)) < 0.8) leaderOnlyNote();
        // INSTANT ARENA TELEPORT (it.29): stepping inside the boss chamber's
        // room bounds seizes the player — immediate fade-teleport.
        // THE SEAL, NOT THE ROOM (it.87): the whole chamber used to seize the
        // hero at its door. Now the seal at the room's heart is the way in -
        // step onto it - and the room says so once at the door.
        if (lead.action !== 'dead' && world.arenaThreshold && !transitioning) {
          const t = world.arenaThreshold;
          const px = Math.floor(lead.pos.x);
          const py = Math.floor(lead.pos.y);
          const sx = t.x + Math.floor(t.w / 2) + 0.5;
          const sy = t.y + Math.floor(t.h / 2) + 0.5;
          if (px >= t.x && px < t.x + t.w && py >= t.y && py < t.y + t.h) {
            if (world.mines) tutorial.notify('sealQuarry', 'The keeper\'s seal burns at the heart of the hall. Step onto it when you are ready - the arena seals behind you.');
            else tutorial.notify('sealRoom', 'The warden\'s seal burns at the heart of this chamber. Step onto it when you are ready - the arena seals behind you.');
            if (Math.hypot(lead.pos.x - sx, lead.pos.y - sy) < 1.1) pendingArena = true;
          }
        }

        // Town portal home → back through the rift (armed once the leader steps off it).
        if (world.town && portalReturn && !transitioning) {
          const pt = world.town.layout.portal;
          const d = Math.hypot(lead.pos.x - (pt.x + 0.5), lead.pos.y - (pt.y + 0.5));
          if (!portalArmed && d > 1.4) portalArmed = true;
          if (portalArmed && d < 0.7) returnThroughPortal();
        }

        // ARENA SAFETY (it.44): a sealed arena with nothing left breathing opens
        // itself — no rebuild, portal trip or spawn accounting can strand the hero.
        if (world.isArena && !world.arenaCleared && !transitioning) {
          let breathing = 0;
          world.enemies.forEachActive((e) => {
            if (e.hp > 0 || e.action === 'transition') breathing++;
          });
          emptyArenaTicks = breathing === 0 ? emptyArenaTicks + 1 : 0;
          if (emptyArenaTicks >= 45) {
            world.arenaCleared = true;
            town.markBossCleared(); // The merchants restock on a warden's fall (it.78).
            world.stairs.sprite.renderable = true;
            world.lighting.registerProp(world.stairs.x, world.stairs.y, world.stairs.sprite);
            world.ambience.burst(world.stairs.x + 0.5, world.stairs.y + 0.5, 0xffd9a0, 20);
            tutorial.notify('arenaopen', 'Nothing left breathes here. The way down opens.');
          }
        }

        // The town gate opens on CONTACT (it.44): touching the archway's front tile descends at once.
        const gateReach = world.town ? 1.05 : 0.8;
        if (lead.action !== 'dead' && stairsDist < gateReach) {
          if (!world.isArena && floor > 0 && isBossFloor(floor)) {
            pendingArena = true; // Fallback portal (the seal itself).
          } else if (world.isArena && !world.arenaCleared) {
            tutorial.notify('bossgate', 'The arena is sealed. Nothing leaves while anything inside still breathes.');
          } else if (world.isArena) {
            // Arenas leave only through the teleporter (it.58): the hidden stair is inert.
          } else if (floor >= MAX_DEPTH) {
            // Depth XX arena cleared, the Hollow King fallen: conquered.
            if (!victoryShown) {
              victoryShown = true;
              runEndgame();
            }
          } else {
            pendingDescend = true;
          }
        }

        eventBus.emit('sim:tick', { tick });
      }
    }

    function frameRender(alpha: number): void {
      {
        const now = performance.now();
        const frameDt = Math.max(0, Math.min((now - lastRenderTime) / 1000, 0.1)); // A clock that steps back (a stubbed one, a resumed tab) never runs a frame backwards (it.92).
        lastRenderTime = now;
        const timeSec = now / 1000;

        state.forEach((entity) => entity.syncRender(alpha));
        lerpVec(cameraFocus, player.prevPos, player.pos, alpha);
        // THE RECLAIMING (it.91): the camera crosses to the gate and back on its own clock.
        if (cineFocus || cineBlend) {
          const goal = cineFocus ?? cameraFocus;
          const k = 1 - Math.exp(-2.4 * frameDt);
          cineCur.x += (goal.x - cineCur.x) * k;
          cineCur.y += (goal.y - cineCur.y) * k;
          cineBlend = !!cineFocus || Math.hypot(goal.x - cineCur.x, goal.y - cineCur.y) > 0.05;
          cameraFocus.x = cineCur.x;
          cameraFocus.y = cineCur.y;
        }

        // A CUTSCENE CARRIES ITS OWN LIGHT (it.99): while the camera is off the hero,
        // the fog is opened from where the camera looks, so the ground the procession
        // walks over is VISIBLE - and therefore re-tinted every frame by the wide
        // scene light below, instead of sitting at the flat explored shadow.
        if (cineFocus) {
          const ct = Math.floor(cameraFocus.y) * world.dungeon.width + Math.floor(cameraFocus.x);
          if (ct !== cineFogTile) {
            cineFogTile = ct;
            world.lighting.updateVisibility(Math.floor(cameraFocus.x), Math.floor(cameraFocus.y));
          }
        }
        world.lighting.updateRender(cameraFocus.x, cameraFocus.y, frameDt, timeSec);
        world.ambience.update(
          cameraFocus.x,
          cameraFocus.y,
          frameDt,
          timeSec,
          (x, y) => world.lighting.getLightAt(x, y),
          (gx, gy) => world.lighting.isVisible(gx, gy),
        );
        world.loot.updateRender(timeSec, world.lighting);
        world.projectiles.updateRender(world.lighting, world.ambience, frameDt);
        world.vfx.update(frameDt);
        {
          // HUD occlusion (it.41): overhead bars and numbers hold screen size at any zoom.
          const z = world.camera.currentZoom;
          Enemy.hudScale = Math.max(0.5, Math.min(1.1, 1 / Math.max(0.01, z)));
          world.dmgText.setZoom(z);
        }
        world.chests.updateRender(timeSec);
        world.dmgText.update(frameDt);
        // IT.48: level-up pillars fade, the hurt flash clears, the buff rings turn.
        for (let i = pillars.length - 1; i >= 0; i--) {
          const p = pillars[i];
          if (p.sprite.destroyed) {
            // The floor swapped under it (its layer took the sprite along).
            pillars.splice(i, 1);
            continue;
          }
          p.life += frameDt;
          const t = Math.max(0, p.life / 1.5);
          p.sprite.alpha = 0.95 * (1 - t) * (1 - t);
          p.sprite.scale.set(1.4 + t * 0.8, 5.5 + t * 4);
          if (t >= 1) {
            p.sprite.destroy();
            pillars.splice(i, 1);
          }
        }
        if (hurtFlashTimer > 0) {
          hurtFlashTimer -= frameDt;
          if (hurtFlashTimer <= 0) vignetteEl?.classList.remove('hurt');
        }
        updateBuffHud();
        if (world.coliseum) {
          const c = world.coliseum;
          c.update(frameDt);
          if (teleporterFx) {
            const f = teleporterFx;
            if (f.pad.destroyed) teleporterFx = null;
            else {
              f.clock += frameDt;
              f.rune.rotation = f.clock * 0.6;
              f.rune2.rotation = -f.clock * 1.1;
              f.rune.alpha = 0.75 + 0.25 * Math.sin(f.clock * 3);
              f.beam.alpha = 0.4 + 0.2 * Math.sin(f.clock * 2.3);
              f.beam.scale.x = 1.6 + 0.15 * Math.sin(f.clock * 4);
            }
          }
          waveHud.textContent =
            c.phase === 'intermission'
              ? `WAVE ${c.wave + 1} / ${c.waves} · NEXT WAVE IN ${Math.ceil(c.timer / 60)}s`
              : c.phase === 'fight'
                ? `WAVE ${c.wave} / ${c.waves} · ${c.alive} FOE${c.alive === 1 ? '' : 'S'} REMAIN`
                : 'TRIAL COMPLETE · claim the chest, then take the rift home';
          waveHud.classList.toggle('calm', c.phase !== 'fight');
          waveHud.classList.add('show');
        } else {
          waveHud.classList.remove('show');
        }
        // OVERHEAD LEVEL-UP BANNER (it.50): rides above the hero while it shows.
        {
          const banner = document.getElementById('levelup-banner');
          if (banner?.classList.contains('show')) {
            const bp = world.camera.worldToCanvas(player.pos.x, player.pos.y, buffScratch);
            banner.style.left = `${Math.round(bp.x)}px`;
            banner.style.top = `${Math.round(bp.y - 150 * world.camera.currentZoom)}px`;
          }
        }

        // The hero's warm halo rides his interpolated position, breathing gently.
        const halo = worldToScreen(cameraFocus.x, cameraFocus.y, pickRingScratch);
        world.playerHalo.position.set(halo.x, halo.y - 22);
        // THE SPAWN WARD (it.89): the halo turns pale blue and breathes fast while no blow can land.
        if (player.wardTicks > 0) {
          world.playerHalo.tint = 0x9fd0ff;
          world.playerHalo.alpha = 0.42 + Math.sin(timeSec * 12) * 0.16;
          world.playerHalo.scale.set(3.2 + Math.sin(timeSec * 12) * 0.25);
        } else {
          if (world.playerHalo.tint !== 0xffa050) {
            world.playerHalo.tint = 0xffa050;
            world.playerHalo.scale.set(2.8);
          }
          world.playerHalo.alpha = 0.3 + Math.sin(timeSec * 3.1) * 0.05;
        }
        if (timerLabel) {
          const t = formatTime(activeTicks); // The active clock (it.54).
          if (timerLabel.textContent !== t) timerLabel.textContent = t;
        }

        // Proximity prompt: an "E — OPEN" chip floats over a nearby chest —
        // or, in town, over the stall / stash / gate / portal (it.39).
        let nearChest = world.chests.findNearestUnopened(player.pos.x, player.pos.y, 2.2);
        let townPrompt = world.town ? nearestTownPrompt() : null;
        // A TOWN CHEST (it.92): whichever is nearer speaks - the chest or the stall.
        if (nearChest && townPrompt && Math.hypot(nearChest.x - player.pos.x, nearChest.y - player.pos.y) < Math.hypot(townPrompt.x - player.pos.x, townPrompt.y - player.pos.y)) townPrompt = null;
        else if (nearChest && townPrompt) nearChest = null;
        world.town?.setPromptAt(townPrompt ? townPrompt.x : null, townPrompt?.y);
        if (interactHint && townPrompt) {
          const p = world.camera.worldToCanvas(townPrompt.x, townPrompt.y, pickRingScratch);
          interactHint.style.left = `${Math.round(p.x)}px`;
          interactHint.style.top = `${Math.round(p.y - townPrompt.lift)}px`;
          if (lastHintHtml !== townPrompt.html) {
            lastHintHtml = townPrompt.html;
            interactHint.innerHTML = townPrompt.html;
          }
          interactHint.classList.remove('dim');
          interactHint.classList.add('show');
        } else if (
          interactHint &&
          nearChest &&
          world.lighting.isVisible(Math.floor(nearChest.x), Math.floor(nearChest.y))
        ) {
          if (lastHintHtml !== '<kbd>E</kbd> OPEN') {
            lastHintHtml = '<kbd>E</kbd> OPEN';
            interactHint.innerHTML = lastHintHtml;
          }
          const p = world.camera.worldToCanvas(nearChest.x, nearChest.y, pickRingScratch);
          interactHint.style.left = `${Math.round(p.x)}px`;
          interactHint.style.top = `${Math.round(p.y - 64)}px`;
          // COMBAT DIM (it.33): the label fades way back while anything is
          // hunting the player — loot text must never shout over a fight.
          let inCombat = false;
          world.enemies.forEachActive((e) => {
            if (e.hp > 0 && e.aiState === 'chase') inCombat = true;
          });
          interactHint.classList.toggle('dim', inCombat);
          interactHint.classList.add('show');
        } else {
          // It.38: the chip used to keep an inline opacity when it hid — a
          // faint "E OPEN" then floated forever near the player.
          interactHint?.classList.remove('show', 'dim');
        }

        // Entity fog gate with a neighbor fallback: a cornered enemy whose
        // center drifts onto an unseen wall tile must NOT vanish.
        const entityVisible = (x: number, y: number): boolean => {
          const gx = Math.floor(x);
          const gy = Math.floor(y);
          if (world.lighting.getState(gx, gy) === 0) return false;
          for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) {
              if (world.lighting.isVisible(gx + ox, gy + oy)) return true;
            }
          return false;
        };
        world.enemies.forEachActive((enemy) => {
          const visible = entityVisible(enemy.pos.x, enemy.pos.y);
          enemy.container.visible = visible;
          if (visible) {
            if (!enemy.noted && enemy.hp > 0) {
              // BESTIARY (it.42): first sighting of this body.
              enemy.noted = true;
              player.noteSeen(enemy.def.kind);
              eventBus.emit('bestiary:changed', {});
            }
            const tint = world.lighting.getTintAt(enemy.pos.x, enemy.pos.y, 0.5);
            // Own tile unseen (neighbor-visible corner case): dim neutral, not black.
            enemy.setLightTint(tint === 0 ? 0x6b6472 : tint);
            enemy.setShadowLight(world.lighting.lightDirAt(enemy.pos.x, enemy.pos.y));
          }
        });
        // The heroes sit in the same lighting language as the world (the whole party, it.59).
        for (const seat of liveSeats()) {
          const hero = seat.player;
          hero.setSceneTint(world.lighting.getTintAt(hero.pos.x, hero.pos.y, 0.7));
          hero.setShadowLight(world.lighting.lightDirAt(hero.pos.x, hero.pos.y));
        }
        if (coop) {
          updatePlates();
          updatePartyHud(frameDt);
        }

        if (world.town) {
          const t = world.town;
          t.villagers.update(frameDt, (x, y) => world.lighting.getTintAt(x, y, 0.8));
          t.villagers2.update(frameDt, (x, y) => world.lighting.getTintAt(x, y, 0.8));
          t.villagers3?.update(frameDt, (x, y) => world.lighting.getTintAt(x, y, 0.8));
          // THE CITY'S OWN (it.100): drawn between the ticks they were moved on,
          // and lit by the field they are standing in.
          world.squad?.draw(alpha, (x, y) => world.lighting.getTintAt(x, y, 0.85));
          gateFx.update(frameDt); // THE BARRICADE (it.91): a cart aside, or every cart down.
          reclaim?.update(frameDt);
          // THE SLEEPER (it.92): a few pale motes rise from the bed while the hero rests.
          if (player.resting) {
            restGlint += frameDt;
            if (restGlint > 1.3) {
              restGlint = 0;
              world.ambience.burst(player.pos.x + 0.2, player.pos.y - 0.6, 0xdce8ff, 3, { lowEnergy: true });
            }
          }
        }
        world.loot.updateBeacons((x, y) => world.lighting.isVisible(x, y), timeSec); // THE KEY BEACONS (it.87).
        // ENEMIES REMAINING (it.88): the forest's tally under the plate. LOOTERS REMAINING (it.91): the quarter's.
        let questTargets: Array<{ x: number; y: number }> | null = null;
        if (floor === FOREST_FLOOR && world.foesAtStart > 0) {
          let alive = 0;
          const targets: Array<{ x: number; y: number }> = [];
          world.enemies.forEachActive((e) => {
            if (e.hp > 0 && e.action !== 'dead') {
              alive++;
              targets.push({ x: e.pos.x, y: e.pos.y });
            }
          });
          if (quests.forest === 'active') questTargets = targets;
          const tally = `ENEMIES REMAINING · ${alive} / ${world.foesAtStart}`;
          if (questHud.textContent !== tally) questHud.textContent = tally;
          questHud.classList.add('show');
        } else if (floor === FARM_FLOOR && quests.farm === 'active' && world.foesAtStart > 0) {
          // TROOPS REMAINING (it.100): the company's count, and a chevron on each of
          // them - the same screen-edge pointers the forest uses, which already widen
          // their margin on a touch screen.
          const targets: Array<{ x: number; y: number }> = [];
          world.enemies.forEachActive((e) => {
            if (e.hp > 0 && e.action !== 'dead') targets.push({ x: e.pos.x, y: e.pos.y });
          });
          questTargets = targets;
          const tally = `TROOPS REMAINING · ${targets.length} / ${world.foesAtStart}`;
          if (questHud.textContent !== tally) questHud.textContent = tally;
          questHud.classList.add('show');
        } else if (floor === 0 && quests.east === 'open' && world.town?.layout.east) {
          const targets: Array<{ x: number; y: number }> = [];
          world.enemies.forEachActive((e) => {
            if (e.hp > 0 && e.action !== 'dead' && LOOTER_KINDS.has(e.def.kind)) targets.push({ x: e.pos.x, y: e.pos.y });
          });
          questTargets = targets;
          const tally = `LOOTERS REMAINING · ${targets.length} / ${LOOTER_COUNT}`;
          if (questHud.textContent !== tally) questHud.textContent = tally;
          questHud.classList.add('show');
        } else if (questHud.classList.contains('show')) questHud.classList.remove('show');
        updateFoePointers(questTargets);
        updateAllyMarks(); // THE CITY'S OWN (it.100).
        if (world.town) {
          const t = world.town;
          // THE ZONE CHIP (it.84): which district the hero stands in.
          {
            const zx = Math.floor(player.pos.x);
            const zy = Math.floor(player.pos.y);
            const d = t.layout.districts.find((q) => zx >= q.x && zx < q.x + q.w && zy >= q.y && zy < q.y + q.h);
            setZoneLabel(d?.name ?? 'THE TOWN');
            // The depth label at top-left says the district too (a micro handset has no chip).
            if (depthLabel && depthLabel.textContent !== (d?.name ?? 'THE TOWN')) depthLabel.textContent = d?.name ?? 'THE TOWN';
          }
          t.campHeroes.update((x, y) => world.lighting.getTintAt(x, y, 0.7));
          t.update(frameDt);
          const heroTx = Math.floor(player.pos.x);
          const heroTy = Math.floor(player.pos.y);
          // ROOF CUTAWAY (it.39): a cottage or tree the hero stands behind fades
          // so the body never disappears under a roof.
          const hs = worldToScreen(cameraFocus.x, cameraFocus.y, pickRingScratch);
          const heroDepth = (cameraFocus.x + cameraFocus.y) * 16;
          const k = 1 - Math.exp(-12 * frameDt);
          // EVERY BODY BEHIND A TREE (it.87): the other heroes and every foe in
          // sight fade the trunk in front of them too, so nothing fights unseen.
          const bodies: Array<{ x: number; y: number; depth: number }> = [];
          for (const seat of liveSeats()) if (seat.player !== player && seat.player.hp > 0) {
            const ps = worldToScreen(seat.player.pos.x, seat.player.pos.y, vec2());
            bodies.push({ x: ps.x, y: ps.y, depth: (seat.player.pos.x + seat.player.pos.y) * 16 });
          }
          world.enemies.forEachActive((e) => {
            if (e.hp <= 0 || !world.lighting.isVisible(Math.floor(e.pos.x), Math.floor(e.pos.y))) return;
            const es = worldToScreen(e.pos.x, e.pos.y, vec2());
            bodies.push({ x: es.x, y: es.y, depth: (e.pos.x + e.pos.y) * 16 });
          });
          // EVERY HEAD IN TOWN (it.92): a villager behind a roof or a trunk ghosts it too - no building draws over a walker.
          for (const vs of [t.villagers, t.villagers2, t.villagers3]) {
            if (!vs) continue;
            for (const v of vs.positions()) {
              if (!world.lighting.isVisible(Math.floor(v.x), Math.floor(v.y))) continue;
              const ps = worldToScreen(v.x, v.y, vec2());
              bodies.push({ x: ps.x, y: ps.y, depth: (v.x + v.y) * 16 });
            }
          }
          for (const o of t.occluders) {
            const spr = o.sprite;
            const w = spr.width;
            const h = spr.height;
            const left = spr.position.x - w * spr.anchor.x + w * 0.12;
            const right = left + w * 0.76;
            const top = spr.position.y - h * spr.anchor.y;
            const bottom = top + h * 0.9;
            let behind = o.depth > heroDepth && hs.x > left && hs.x < right && hs.y - 30 > top && hs.y - 30 < bottom;
            if (!behind) for (const b of bodies) if (o.depth > b.depth && b.x > left && b.x < right && b.y - 30 > top && b.y - 30 < bottom) { behind = true; break; }
            // INSIDE (it.40): standing in a cottage's door column — the roof
            // and front wall drop to a ghost so the room reads.
            const inside = heroTx >= o.tiles.x && heroTx < o.tiles.x + o.tiles.w && heroTy >= o.tiles.y && heroTy < o.tiles.y + o.tiles.h;
            // A TREE IS A GHOST (it.88): whatever stands behind a trunk reads through it.
            const target = inside ? 0.2 : behind ? (o.tree ? 0.12 : 0.38) : 1;
            spr.alpha += (target - spr.alpha) * k;
          }
          if (t.stashSprite && spriteLib.hasSingle('stash_open')) {
            t.stashSprite.texture = spriteLib.single(stashUI.isOpen ? 'stash_open' : 'stash_closed');
          }
        }

        // Target ring: pulsing bracket under the foe the player is striking.
        const target = world.combat.getDisplayTarget(localSlot);
        if (target) {
          const s = worldToScreen(target.pos.x, target.pos.y, pickRingScratch);
          world.targetRing.position.set(s.x, s.y);
          const pulse = 1 + Math.sin(timeSec * 7) * 0.07;
          world.targetRing.scale.set(pulse);
          world.targetRing.alpha = 0.75 + Math.sin(timeSec * 7) * 0.2;
          world.targetRing.visible = true;
        } else {
          world.targetRing.visible = false;
        }

        // BOSS HEALTH BAR (it.48): shown the moment the warden stands in its
        // arena (or is sighted anywhere), name · level · numeric HP, and it
        // lingers three seconds past the killing blow instead of vanishing.
        const bossHpEl = document.getElementById('boss-bar-hp');
        if (world.boss && (world.boss.hp > 0 || world.boss.action === 'transition')) {
          const boss = world.boss;
          const phased = !!boss.def.nextPhase || boss.phase > 1;
          if (!world.bossSeen && (world.isArena || entityVisible(boss.pos.x, boss.pos.y))) {
            world.bossSeen = true;
            audio.sfx('bossHorn'); // The war horn: a keeper has seen you.
          }
          if (world.bossSeen && bossBar && bossBarFill) {
            const nameEl = document.getElementById('boss-bar-name');
            const label = `${boss.def.name.toUpperCase()} · LVL ${boss.level}` + (phased ? ` · PHASE ${boss.phase}/3` : '');
            if (nameEl && nameEl.textContent !== label) nameEl.textContent = label;
            bossGoneTimer = 0;
            bossBar.classList.add('show');
            const notches = document.getElementById('boss-bar-notches');
            if (notches) notches.style.display = phased ? 'none' : '';
            bossBarFill.style.background =
              boss.phase === 3
                ? 'linear-gradient(180deg, #b8cff0, #46689c)' // Lich: pale sorcery.
                : boss.phase === 2
                  ? 'linear-gradient(180deg, #e8c06a, #96601e)' // War-knight: grave-gold.
                  : ''; // Phase 1 / other bosses: stylesheet default.
            let pct: number;
            if (boss.action === 'transition') {
              pct =
                boss.actionTicks < PHASE_DIE_TICKS
                  ? 0
                  : Math.min(100, ((boss.actionTicks - PHASE_DIE_TICKS) / PHASE_RISE_TICKS) * 100);
            } else {
              pct = (boss.hp / boss.hpMax) * 100;
            }
            // The fill lives inside the frame's window (11.7% → 88.3% of the track), so
            // its width is hp/max × that window (it.49) — proportional and smooth.
            // PIXEL FILL (it.50): recomputed every frame from hp/max × the frame's
            // window (76.6% of the measured track width) — never a clamped percentage.
            {
              const track = bossBarFill.parentElement;
              const windowPx = (track ? track.clientWidth : 420) * 0.766;
              bossBarFill.style.width = `${Math.max(0, (Math.max(0, Math.min(100, pct)) / 100) * windowPx).toFixed(1)}px`;
            }
            if (bossHpEl) {
              const t = boss.action === 'transition' ? 'RISING' : `${Math.max(0, Math.ceil(boss.hp))} / ${boss.hpMax}`;
              if (bossHpEl.textContent !== t) bossHpEl.textContent = t;
            }
          }
        } else if (bossBar?.classList.contains('show')) {
          // The warden fell: the bar reads empty through the death beat, then fades.
          if (bossBarFill) bossBarFill.style.width = '0px';
          if (bossHpEl) bossHpEl.textContent = world.boss ? `0 / ${world.boss.hpMax}` : '';
          bossGoneTimer += frameDt;
          if (bossGoneTimer > 3 || !world.boss) bossBar.classList.remove('show');
        }

        updateSkillHud(); // Cooldown sweeps + resource bar (it.32).
        tutorial.update(cameraFocus.x, cameraFocus.y, frameDt);
        tutor.update(frameDt); // THE TRAINING GROUND (it.90).
        minimap.update(cameraFocus.x, cameraFocus.y, timeSec);
        world.camera.follow(cameraFocus, frameDt);
        // OFF-SCREEN CULLING (it.74): only what the camera sees is handed
        // to the batcher. Entities are kept whatever their place.
        if (cullOn) {
          keepSet.clear();
          state.forEach((e) => keepSet.add(e.container));
          cullStats = cullWorld(world.viewport, app.screen.width, app.screen.height, keepSet);
        }
        app.renderer.render(app.stage);
      }
    }

    // --- Pause / death menus (it.36) -----------------------------------------
    // --- Town panels + interaction (it.39) ------------------------------------
    const shopUI = new ShopUI(player, town, inputQueue, () => state.tick);
    const stashUI = new StashUI(player, town, inputQueue);
    const craftUI = new CampCraftingUI(player, inputQueue, () => deepestFloor);
    // THE JOURNAL (it.81, it.82): H, the bar, and a button on every window that needs it.
    const craftLog: Array<{ tick: number; text: string; ok: boolean }> = [];
    const codexUI = new CodexUI(() => player.recipes, () => craftLog, () => deepestFloor);
    const noticeUI = new NoticeBoardUI(); // THE BOUNTY BOARD (it.84).
    const dialogue = new DialogueUI(); // THE SPOKEN WORD (it.87).
    subs.push(
      eventBus.on('journal:open', ({ chapter }) => codexUI.open(chapter as Parameters<CodexUI['open']>[0])),
      eventBus.on('craft:result', ({ ok, text }) => {
        craftLog.unshift({ tick: state.tick, text, ok });
        if (craftLog.length > 60) craftLog.length = 60;
      }),
    );
    const skillTreeUI = new SkillTreeUI(player, inputQueue, () => !!world.town);
    // EVERY WINDOW FITS (it.65): the run's panels are built per run, so they
    // are registered here rather than at boot.
    // By id (it.66): the hero sheet and the bestiary are built a few lines
    // below this, and a registration by element silently dropped them.
    for (const id of ['inv-panel', 'skill-tree', 'char-sheet', 'bestiary', 'cheat-menu', 'shop-panel', 'stash-panel', 'craft-panel', 'codex', 'notice-board', 'dialogue-panel', 'leaderboard', 'level-select']) {
      fit.addById(id, { maxW: 0.94, maxH: 0.92, minScale: 0.8, base: 'translate(-50%, -50%)', responsive: true });
    }
    const charSheetUI = new CharacterSheetUI(player);
    const bestiaryUI = new BestiaryUI(player);
    /**
     * THE TRAINING GROUND (it.90): the interactive tutorial over the live
     * game. Its hooks are the only thing it knows about the run.
     */
    const panelOf = (kind: PanelKind): { open: () => void; close: () => void; isOpen: () => boolean } => {
      switch (kind) {
        case 'inventory':
          return { open: () => { if (!document.getElementById('inv-panel')?.classList.contains('open')) inventoryUI.toggle(); }, close: () => { if (document.getElementById('inv-panel')?.classList.contains('open')) inventoryUI.toggle(); }, isOpen: () => !!document.getElementById('inv-panel')?.classList.contains('open') };
        case 'character':
          return { open: () => charSheetUI.open(), close: () => charSheetUI.close(), isOpen: () => charSheetUI.isOpen };
        case 'talents':
          return { open: () => skillTreeUI.open(), close: () => skillTreeUI.close(), isOpen: () => skillTreeUI.isOpen };
        case 'crafting':
          return { open: () => craftUI.open(), close: () => craftUI.close(), isOpen: () => craftUI.isOpen };
        case 'journal':
          return { open: () => codexUI.open('combat'), close: () => codexUI.close(), isOpen: () => codexUI.isOpen };
      }
    };
    const pageScratch = vec2();
    const tutor = new TutorialSystem({
      touch: () => screenLayout.state.touch,
      hero: () => ({ x: player.pos.x, y: player.pos.y, hp: player.hp, hpMax: player.hpMax }),
      dummies: () => {
        const out: Array<{ id: number; x: number; y: number; hp: number; hpMax: number }> = [];
        world.enemies.forEachActive((e) => {
          if (e.def.passive) out.push({ id: e.id, x: e.pos.x, y: e.pos.y, hp: e.hp, hpMax: e.hpMax });
        });
        return out;
      },
      worldToPage: (x, y) => {
        // `worldToCanvas` answers in CSS pixels of the canvas box (app.screen), not backing pixels.
        const c = world.camera.worldToCanvas(x, y, pageScratch);
        const r = app.canvas.getBoundingClientRect();
        return { x: r.left + c.x, y: r.top + c.y };
      },
      panels: {
        open: (k) => panelOf(k).open(),
        close: (k) => panelOf(k).close(),
        isOpen: (k) => panelOf(k).isOpen(),
      },
      warpToYard: () => {
        const t = world.town?.layout.training;
        if (!t) return;
        TutorialSystem.yardPost = { x: t.post.x + 0.5, y: t.post.y + 0.5 };
        placeParty(t.mark.x + 0.5, t.mark.y + 0.5, world.scene.isWalkable);
        world.lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
        minimap.markDirty();
      },
      gate: () => {
        const g = world.town?.layout.gate ?? { x: player.pos.x, y: player.pos.y };
        return { x: g.x + 0.5, y: g.y + 0.5 };
      },
      heroFrames: () => (spriteLib.loaded ? classPreviewFrames(chosenClass) : null),
      className: () => chosenClass,
      viewport: () => ({ w: screenLayout.state.w, h: screenLayout.state.h }),
      onFinish: () => {
        world.dmgText.show(player.pos.x, player.pos.y - 1.2, 'THE YARD IS DONE · THE GATE WAITS', 'crit');
        audio.sfx('questDone');
      },
    });
    /** The sign at the yard (it.90): the word, then the tutorial. */
    const offerTraining = async (): Promise<void> => {
      if (tutor.isRunning) return;
      const v = await dialogue.open({
        speaker: 'THE TRAINING GROUND',
        role: 'a sign by the dummies',
        lines: ['A yard to practise in: moving, fighting, skills, potions, the pack, the forge. It takes a couple of minutes.'],
        choices: [
          { label: 'START TRAINING', sub: 'the yard walks you through it', value: 'go' },
          { label: 'NOT NOW', value: 'stay' },
        ],
      });
      if (v === 'go') tutor.start();
    };
    if (shouldAutoStart() && world.town) later(() => tutor.start(), 600); // The mandatory onboarding, when it is switched on.
    // DUNGEON RECORDS (it.48): the board's tallies come straight from the run.
    // THE HALL OF RECORDS (it.54): the board opens the two-tab leaderboard.
    const statsUI = new LeaderboardUI(stats, () => ({ cls: player.archetype, playtimeTicks: playtimeBase + state.tick, gold: player.goldCollected }));
    // DRAGGABLE WINDOWS (it.41): every panel by its header, remembered per panel.
    const undrag = [
      ['inv-panel', 'inventory'],
      ['shop-panel', 'shop'],
      ['stash-panel', 'stash'],
      ['stats-board', 'stats'],
      ['skill-tree', 'skilltree'],
      ['char-sheet', 'charsheet'],
      ['bestiary', 'bestiary'],
      ['cheat-menu', 'cheat'],
    ]
      .map(([id, key]) => {
        const el = document.getElementById(id);
        return el ? makeDraggable(el, key) : null;
      })
      .filter((f): f is () => void => !!f);
    let sheetClock = 0;
    /** The one radius (it.58): the prompt shows inside it and E acts inside it. */
    const PROMPT_RANGE = 2.6;
    const interactableDist = (it: Interactable): number => {
      let best = Infinity;
      for (const tile of it.tiles) best = Math.min(best, Math.hypot(player.pos.x - (tile.x + 0.5), player.pos.y - (tile.y + 0.5)));
      return best;
    };
    const openInteractable = (it: Interactable): void => {
      // THE CORNER ROOM (it.91): the keeper's until the errand is paid.
      if (it.room && quests.east !== 'done') {
        tutorial.say('The keeper\'s room - not yours yet. Ask at the bar.');
        return;
      }
      if (it.kind === 'innkeeper') {
        if (coop && localSlot !== leaderSlot) leaderOnlyNote();
        else void innkeeperTalk();
        return;
      }
      if (it.kind === 'inn') {
        // THE GILDED STAG'S DOOR (it.92): barred while the looters hold the quarter; the inn's own floor after.
        if (quests.east !== 'cleared' && quests.east !== 'done') {
          tutorial.say('The door is barred from inside. You can hear them in there.');
          return;
        }
        if (coop && localSlot !== leaderSlot) leaderOnlyNote();
        else goInn();
        return;
      }
      if (it.kind === 'inndoor') {
        if (coop && localSlot !== leaderSlot) leaderOnlyNote();
        else leaveInn();
        return;
      }
      // THE CELLAR (it.97): the back door, the stair up, and the woman behind the casks.
      if (it.kind === 'cellardoor') {
        if (!cellarAsked()) tutorial.say('Bolted, and the innkeeper has the key. He has not asked you to go down there.');
        else if (coop && localSlot !== leaderSlot) leaderOnlyNote();
        else goCellar();
        return;
      }
      if (it.kind === 'farmgate') {
        tutorial.say(it.note ?? 'The way past the fields is still barricaded.');
        return;
      }
      if (it.kind === 'cellarup') {
        if (coop && localSlot !== leaderSlot) leaderOnlyNote();
        else leaveCellar();
        return;
      }
      if (it.kind === 'cellargirl') {
        void girlTalk();
        return;
      }
      if (it.kind === 'bed') {
        // Walk to the bedside first (it.92): the lying-down starts from beside the bed, not from across the room.
        const d = Math.hypot(player.pos.x - it.x, player.pos.y - it.y);
        if (d > 1.6 && !player.resting) {
          pendingRest = it.id;
          walkToInteractable(it, localSlot, it.tiles.slice(0, 2)); // Beside the bed's own tiles, not its ring.
          return;
        }
        pendingRest = null;
        inputQueue.enqueue({ type: 'REST', playerId: localSlot, x: it.x, y: it.y });
        return;
      }
      if (it.kind === 'merchant') shopUI.open('armorer');
      else if (it.kind === 'alchemist') shopUI.open('alchemist');
      else if (it.kind === 'jeweler' || it.kind === 'scribe' || it.kind === 'bowyer') shopUI.open(it.kind);
      else if (it.kind === 'notice') noticeUI.open();
      else if (it.kind === 'gateway') {
        // THE MARSH GATE (it.100): the road the fields lie along. Shut until the
        // officer asks, and a plain road out to them after.
        if (it.label.includes('MARSH')) {
          if (!farmOffered() || (quests.farm ?? 'new') === 'new') tutorial.say(it.note ?? 'The way is not open yet.');
          else if (coop && localSlot !== leaderSlot) leaderOnlyNote();
          else goFarm();
          return;
        }
        if (it.dest === 'forest') {
          if (coop && localSlot !== leaderSlot) leaderOnlyNote();
          else void gatekeeper();
        } else tutorial.say(it.note ?? 'The way is not open yet.');
      } else if (it.kind === 'quarry') {
        if (coop && localSlot !== leaderSlot) leaderOnlyNote();
        else goMines();
      } else if (it.kind === 'townroad') inputQueue.enqueue({ type: 'WARP', playerId: localSlot, to: 'town' });
      else if (it.kind === 'board') statsUI.open();
      else if (it.kind === 'arena') openArenaModal();
      else if (it.kind === 'forge') craftUI.open();
      else if (it.kind === 'training') {
        // THE MUSTER (it.100): once the woods and the quarter are settled, the post
        // at the yard is where the officer stands.
        if (farmOffered() && quests.farm !== undefined) void officerTalk();
        else void offerTraining();
      }
      else stashUI.open();
    };
    /** E in town / a click on the stall or stash: walk up, then open. */
    function handleTownInteraction(commands: ReadonlyArray<InputCommand>): void {
      const t = world.town;
      if (!t) return;
      for (const cmd of commands) {
        const seat = party[cmd.playerId];
        if (!seat || seat.gone) continue;
        const hero = seat.player;
        const isLocal = cmd.playerId === localSlot;
        const isLeader = cmd.playerId === leaderSlot;
        if (cmd.type === 'PICKUP_NEAREST') {
          // SYMMETRICAL E (it.41): an open trade / stash window closes on the same key.
          if (isLocal && dialogue.isOpen) continue; // The word is on the table: E does nothing else (it.87).
          if (isLocal && (shopUI.isOpen || stashUI.isOpen || statsUI.isOpen || noticeUI.isOpen || arenaModal.classList.contains('open'))) {
            shopUI.close();
            stashUI.close();
            statsUI.close();
            noticeUI.close();
            closeArenaModal();
            continue;
          }
          // E at the portal stone or the gate takes it (no need to step in) —
          // the radii MATCH THE PROMPT (it.58): if the chip is showing, E acts.
          // CO-OP (it.59): only the leader's E moves the party.
          if (portalReturn && !transitioning) {
            const pt = t.layout.portal;
            if (Math.hypot(hero.pos.x - (pt.x + 0.5), hero.pos.y - (pt.y + 0.5)) < 3) {
              if (isLeader) returnThroughPortal();
              else if (isLocal) leaderOnlyNote();
              continue;
            }
          }
          if (!transitioning && Math.hypot(hero.pos.x - (t.layout.gate.x + 0.5), hero.pos.y - (t.layout.gate.y + 0.5)) < 3.2) {
            if (isLeader) pendingDescend = true;
            else if (isLocal) leaderOnlyNote();
            continue;
          }
          if (!isLocal) continue; // Stalls and boards are windows on THIS screen.
          let best: Interactable | null = null;
          let bestD = PROMPT_RANGE;
          for (const it of t.interactables) {
            const d = interactableDist(it);
            if (d < bestD) {
              bestD = d;
              best = it;
            }
          }
          if (best) openInteractable(best);
        } else if (cmd.type === 'OPEN_CHEST') {
          const it = t.interactables.find((i) => i.id === cmd.chestId);
          if (!it) continue;
          if (isLocal) pendingInteract = it.id;
          walkToInteractable(it, cmd.playerId);
        }
      }
      if (pendingInteract !== null) {
        const it = t.interactables.find((i) => i.id === pendingInteract);
        if (!it) pendingInteract = null;
        else if (interactableDist(it) <= PROMPT_RANGE) {
          pendingInteract = null;
          openInteractable(it);
        }
      }
      // THE BEDSIDE (it.92): the walk to the bed ends in the lying-down.
      if (pendingRest !== null) {
        const it = t.interactables.find((i) => i.id === pendingRest);
        if (!it) pendingRest = null;
        else if (Math.hypot(player.pos.x - it.x, player.pos.y - it.y) <= 1.6) {
          pendingRest = null;
          inputQueue.enqueue({ type: 'REST', playerId: localSlot, x: it.x, y: it.y });
        }
      }
    }
    /** Walk a hero to the nearest open tile beside an interactable's footprint (it.92: shared by clicks and the bed). */
    function walkToInteractable(it: Interactable, playerId = localSlot, tiles: ReadonlyArray<{ x: number; y: number }> = it.tiles): void {
      const hero = party[playerId]?.player ?? player;
      let goal: { x: number; y: number } | null = null;
      let goalD = Infinity;
      for (const tile of tiles) {
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const gx = tile.x + ox;
          const gy = tile.y + oy;
          if (!world.scene.isWalkable(gx, gy)) continue;
          const d = Math.hypot(hero.pos.x - (gx + 0.5), hero.pos.y - (gy + 0.5));
          if (d < goalD) {
            goalD = d;
            goal = { x: gx, y: gy };
          }
        }
      }
      if (goal) world.movements[playerId]?.applyCommands([{ type: 'MOVE_TO', playerId, gx: goal.x, gy: goal.y }]);
    }
    /** The nearest town prompt within reach: stall / stash / gate / portal. */
    const nearestTownPrompt = (): { x: number; y: number; html: string; lift: number } | null => {
      const t = world.town;
      if (!t) return null;
      let best: { x: number; y: number; html: string; lift: number } | null = null;
      let bestD = PROMPT_RANGE;
      for (const it of t.interactables) {
        const d = interactableDist(it);
        if (d < bestD) {
          bestD = d;
          const label = it.kind === 'bed' && player.resting ? 'RISE' : it.label.replace('E · ', '');
          best = { x: it.x, y: it.y, html: `<kbd>E</kbd> ${label}`, lift: it.kind === 'merchant' || it.kind === 'alchemist' ? 96 : it.kind === 'board' ? 70 : it.kind === 'arena' ? 100 : it.kind === 'forge' ? 64 : it.kind === 'innkeeper' ? 74 : it.kind === 'bed' ? 44 : it.kind === 'inn' ? 120 : 54 };
        }
      }
      const gd = Math.hypot(player.pos.x - (t.layout.gate.x + 0.5), player.pos.y - (t.layout.gate.y + 0.5));
      if (gd < bestD && gd < 3.2) {
        bestD = gd;
        best = { x: t.layout.gate.x + 0.5, y: t.layout.gate.y + 0.5, html: 'THE DUNGEON GATE · walk in to descend', lift: 44 };
      }
      const cf = Math.hypot(player.pos.x - (t.layout.campfire.x + 0.5), player.pos.y - (t.layout.campfire.y + 0.5));
      if (cf < bestD && cf < 2.4) {
        bestD = cf;
        best = { x: t.layout.campfire.x + 0.5, y: t.layout.campfire.y + 0.5, html: `THE CAMP · ${t.campHeroes.names.join(' · ')} rest here`, lift: 70 };
      }
      if (portalReturn) {
        const pd = Math.hypot(player.pos.x - (t.layout.portal.x + 0.5), player.pos.y - (t.layout.portal.y + 0.5));
        if (pd < bestD && pd < 3) {
          best = { x: t.layout.portal.x + 0.5, y: t.layout.portal.y + 0.5, html: `PORTAL · back to depth ${ROMAN[portalReturn.floor - 1] ?? portalReturn.floor}`, lift: 60 };
        }
      }
      return best;
    };

    const runMenus = new RunMenusUI({
      pause: () => {
        if (!coop) loop.stop(); // A party never waits on one player's menu (it.59).
        saveNow(); // Autosave on pause (it.39).
      },
      resume: () => {
        inputQueue.clear(); // Keys mashed while paused never replay.
        lastRenderTime = performance.now();
        if (!coop) loop.start();
      },
      restart: () => restartRun(),
      mainMenu: () => exitToMenu(),
      changeClass: () => changeClass(),
      saveExit: () => {
        saveNow();
        exitToMenu();
      },
      settings: () => settings.open(),
      respawn: () => respawnPlayer(),
      canPause: () => !transitioning && !victoryShown,
      cheats: () => cheatMenu.toggle(), // The pause sheet is the phone's F1 (it.67).
      journal: () => codexUI.open(), // The pause sheet is the phone's H (it.83).
    });

    // A closing tab keeps its progress (it.60): the co-op hero is what the next join restores.
    window.addEventListener('pagehide', () => saveNow(), { signal: ac.signal });

    // ---- THE WIRE (it.59) --------------------------------------------------
    /** THE LEADER IS GONE (it.60): a clean modal, a save, then home alone. */
    const lostModal = document.createElement('div');
    lostModal.id = 'coop-lost';
    lostModal.innerHTML = '<div class="am-box"><h3>THE PARTY LEADER HAS DISCONNECTED</h3><p class="am-say"></p><p class="cl-sub">Returning to town…</p></div>';
    if (coop) document.body.appendChild(lostModal);
    if (lockstep && net && chat) {
      loop.gate = (t) => lockstep.canStep(t);
      loop.extraSteps = () => (lockstep.backlog(loop.tick) > 12 ? CATCH_UP_STEPS : 0); // Sprint through a backlog (it.60).
      loop.keepAliveHidden = true; // An alt-tabbed peer must never freeze the party.
      lockstep.onResume = () => {
        transitioning = false; // The same tick on every peer.
        hostSync?.reset();
        clientSync?.reset();
        floorFade?.classList.remove('show', 'loading');
        inputQueue.clear();
      };
      lockstep.onLag = (slot, lagging) => {
        const seat = party[slot];
        if (seat && seat.link !== 'reconnecting') seat.link = lagging ? 'lagging' : 'ok';
      };
      const syncWorld: SyncWorld = {
        enemies: () => {
          const out: Enemy[] = [];
          state.forEach((e) => {
            if (e instanceof Enemy) out.push(e);
          });
          return out;
        },
        heroes: () => liveSeats().map((s) => ({ slot: s.slot, player: s.player })),
        enemyById: (id) => {
          const e = state.getEntity(id);
          return e instanceof Enemy ? e : null;
        },
        heroBySlot: (slot) => {
          const s = party[slot];
          return s && !s.gone && !s.pending ? s.player : null;
        },
        // The leader's word is the death: through the combat system, so the
        // loot, the ledger and the bestiary follow the same path as a local kill.
        kill: (e) => world.combat.dealDamage({ sourceId: player.id, targetId: e.id, amount: Math.max(1, e.hp) + 1 }),
        // THE FLOOR'S LOOT (it.77): the leader's ground is the ground.
        loot: {
          snapshot: () => world.loot.snapshot(),
          getItem: (uid) => world.loot.getItem(uid),
          place: (uid, itemId, x, y) => {
            const def = itemDef(itemId);
            if (def) world.loot.place(uid, def, x, y);
          },
          remove: (uid) => world.loot.remove(uid),
          bumpUid: (n) => world.loot.bumpUid(n),
        },
        // A health correction the player can see is shown as the number it was.
        hpText: (e, delta) => {
          if (e.container.visible) world.dmgText.show(e.pos.x, e.pos.y - 0.9, String(delta), 'enemy');
        },
      };
      if (net.isHost) {
        // What a late joiner replays (it.60): the seed, the opening roster and stash, every frame since.
        const base = net.historyProvider;
        net.historyProvider = () => ({ ...(base ? base() : { upto: -1, frames: [] }), seed: baseSeed, difficulty: difficultyId, members: roster.map((m) => ({ ...m })), stash: { items: [...startStash.items], gold: startStash.gold } });
        net.onJoin = (m) => lockstep.addMember(m.slot, { type: 'JOIN', playerId: m.slot, name: m.name, cls: m.cls, hero: m.hero });
        // THE WORLD AS IT STANDS (it.73): what a joiner gets instead of the
        // history. Null while a floor is being raised (the joiner waits a
        // heartbeat); the Coliseum's waves are not in a snapshot yet, so a
        // joiner during the trial replays the history instead.
        net.snapshotProvider = () => {
          if (transitioning) return null;
          if (world.coliseum) return undefined;
          captureFloor();
          const seated = liveSeats();
          return {
            seed: baseSeed,
            difficulty: difficultyId,
            tick: state.tick,
            floor,
            arena: world.isArena,
            members: net.members
              .filter((m) => m.online && seated.some((s) => s.slot === m.slot))
              .map((m) => ({ ...m, hero: heroSheet(seated.find((s) => s.slot === m.slot)!.player) })),
            stash: { items: [...town.stash.items], gold: town.stash.gold },
            floors: { ...floors },
            seats: seated.map((s) => ({ slot: s.slot, x: s.player.pos.x, y: s.player.pos.y, hp: s.player.hp, res: s.player.resource, dead: s.player.action === 'dead' })),
            enemies: encodeAllEnemies(syncWorld),
            loot: world.loot.snapshot(),
            rng: { combat: world.combat.rngState, loot: world.loot.rngState, chests: world.chests.rngState, craft: crafting.rngState },
            bossSeen: world.bossSeen,
            idBase: world.idBase,
            floorStartTick,
            deepest: deepestFloor,
            townVisits,
            portalReturn,
            frames: lockstep.resyncFor(state.tick),
          };
        };
        hostSync = new HostStateSync(net, syncWorld);
        // Every drop and every pickup on the leader's floor rides the next sample (it.77).
        subs.push(
          eventBus.on('item:dropped', ({ uid, itemId, x, y }) => hostSync?.lootDropped(uid, itemId, x, y)),
          eventBus.on('item:pickedUp', ({ uid }) => hostSync?.lootTaken(uid)),
        );
      } else {
        clientSync = new ClientStateSync(net, syncWorld);
      }
      subs.push(
        net.onLink((slot, state) => {
          const seat = party[slot];
          if (seat) seat.link = state;
          if (!net.isHost && slot === 0 && state === 'reconnecting') saveNow(); // Progress is safe whatever happens next.
          refreshPartyHud();
        }),
      );
      subs.push(
        net.onMessage((msg) => {
          if (msg.t === 'chat') {
            const seat = party[msg.slot];
            chat.push(seat?.name ?? `Delver ${msg.slot + 1}`, PARTY_COLOR_CSS[msg.slot] ?? '#ddd', msg.text);
          } else if (msg.t === 'sys') {
            chat.system(msg.text);
          }
        }),
      );
      // The leader vanished (it.60): the modal, a save, then the run goes on
      // ALONE and walks home — no crash, no frozen screen.
      net.onHostLost((reason) => {
        if (!alive) return;
        const say = lostModal.querySelector('.am-say');
        if (say) say.textContent = reason;
        lostModal.classList.add('open');
        audio.sfx('uiBack');
        saveNow();
        chat.system(`${reason} Returning to town alone — you can host a new party from the title.`);
        lockstep.goSolo();
        leaderSlot = localSlot;
        for (const seat of liveSeats()) if (seat.slot !== localSlot) removeSeat(seat.slot);
        if (lockstep.inBarrier) lockstep.markReady();
        transitioning = false;
        floorFade?.classList.remove('show', 'loading');
        coopWait.classList.remove('show');
        refreshPartyHud();
        later(() => {
          lostModal.classList.remove('open');
          if (!world.town && !transitioning) goHome();
        }, 2600);
      });
      chat.system(net.isHost ? `Party ${net.code} in the crypt. You are the Party Leader.` : `Party ${net.code} in the crypt. ${party[leaderSlot]?.name ?? 'The leader'} leads.${net.path === 'relay' ? ' (through the relay)' : ''}`);
      if (coop?.history) chat.system('Catching up with the delve so far — you step in the moment the party’s present is reached.');
      else if (coop?.snapshot) chat.system('You step into the delve as it stands — the leader’s world is yours.');
      chat.system('ENTER to chat · the leader opens stairs, gates and portals · the fallen rise after 10 s.');
    }
    minimap.party = coop ? () => liveSeats().filter((s) => s.player !== player).map((s) => ({ x: s.player.pos.x, y: s.player.pos.y, color: s.colorCss, dead: s.player.action === 'dead' })) : null;

    if (!world.town) audio.setMusic('dungeon');
    audio.playIntroSting();
    /**
     * A SNAPSHOT JOIN (it.73): the floor was rebuilt from the leader's seed
     * and memory; now the live things — where everyone stands, their health,
     * the loot, the random streams, the tick — take the leader's values, and
     * the lockstep continues from the leader's frames.
     */
    const applySnapshot = (s: SnapshotPayload): void => {
      loop.seek(s.tick + 1);
      state.tick = s.tick;
      simTick = s.tick;
      floorStartTick = s.floorStartTick;
      townVisits = s.townVisits;
      portalReturn = s.portalReturn;
      world.bossSeen = s.bossSeen;
      for (const seat of s.seats) {
        const sp = party[seat.slot];
        if (!sp || sp.gone || sp.pending) continue;
        sp.player.warpTo(seat.x, seat.y);
        sp.player.hp = seat.hp;
        sp.player.resource = seat.res;
      }
      for (const rec of s.enemies) {
        const e = state.getEntity(rec[0]);
        if (!(e instanceof Enemy)) continue;
        e.warpTo(rec[1] / 32, rec[2] / 32);
        e.hp = rec[3];
      }
      world.loot.restore(s.loot);
      world.combat.rngState = s.rng.combat;
      world.loot.rngState = s.rng.loot;
      world.chests.rngState = s.rng.chests;
      if (typeof s.rng.craft === 'number') crafting.rngState = s.rng.craft;
      lockstep?.loadSnapshot(s);
      updateOrb();
      updateProgressHud();
    };
    if (coop?.snapshot) applySnapshot(coop.snapshot);

    loop.start();

    // Dev-only debug handle for console inspection and automated testing.
    // `travel(floor, arena)` rebuilds a floor WITHOUT the fade timers (hidden
    // tabs throttle timers to once a minute — deterministic QA needs a
    // promise, not a setTimeout chain).
    if (import.meta.env.DEV) {
      const devTravel = async (target: number, arena = false): Promise<void> => {
        const dest = target === FOREST_FLOOR || target === MINES_FLOOR || target === INN_FLOOR || target === CELLAR_FLOOR || target === FARM_FLOOR ? target : Math.max(0, Math.min(target, MAX_DEPTH));
        const mode: FloorMode = arena && (isBossFloor(dest) || dest === MINES_FLOOR) ? 'arena' : modeFor(dest);
        await preloadFloor(dest, mode);
        captureFloor(); // Every floor writes its fog down now (it.98); the function decides the rest.
        if (!swapWorld(() => buildWorld(dest, mode))) return;
        floor = dest;
        if (floor <= MAX_DEPTH) deepestFloor = Math.max(deepestFloor, floor);
        if (mode === 'hub') enterTown(false);
        updateDepth();
        floorStartTick = state.tick;
        floorActiveTicks = 0;
        player.action = 'idle';
        if (floor <= MAX_DEPTH) levelSelect.unlock(floor);
        updateOrb();
      };
      Object.defineProperty(window, '__game', {
        configurable: true,
        get: () => ({ state, player, loop, audio, skills, sprites: spriteLib, runMenus, travel: devTravel, townSystem: town, shopUI, stashUI, craftUI, codexUI, noticeUI, dialogue, quests, difficulty, tutor, crafting, get reclaim() { return reclaim; }, lootersAlive, INN_FLOOR, get deepestFloor() { return deepestFloor; }, saveNow, portalReturn, floors, ...world, floor, party, queue: inputQueue, net, lockstep, chat, localSlot, leaderSlot, goHome, get cull() { return cullStats; }, setCull: (on: boolean) => { cullOn = on; if (!on) for (const l of [world.viewport.groundLayer, world.viewport.objectLayer]) for (const c of l.children) c.renderable = true; } }),
      });
    }

    return {
      archetype: chosenClass,
      slot,
      stash: () => (hardcoreOver ? { items: [], gold: 0 } : { items: [...town.stash.items], gold: town.stash.gold }), // A spent life takes the stash with it (it.89).
      save: saveNow,
      returnToTown: () => inputQueue.enqueue({ type: 'WARP', playerId: localSlot, to: 'town' }),
      destroy: () => {
        if (!alive) return;
        alive = false;
        // CO-OP TEARDOWN (it.59): tell the party, close the wire, drop every handle.
        if (net?.isHost) net.broadcast({ t: 'end', reason: 'The Party Leader has left the crypt.' });
        loop.gate = null;
        hostSync?.destroy();
        clientSync?.destroy();
        lockstep?.destroy();
        net?.destroy();
        chat?.destroy();
        partyHud.remove();
        coopWait.remove();
        lostModal.remove();
        minimap.party = null;
        void loading.close();
        loop.stop();
        shopUI.destroy();
        stashUI.destroy();
        craftUI.destroy();
        codexUI.destroy();
        noticeUI.destroy();
        dialogue.destroy();
        tutor.destroy();
        statsUI.destroy();
        hudBuffs.remove();
        headBuffs.remove();
        statusFrame.destroy();
        systemBar.destroy();
        vignetteEl?.classList.remove('hurt');
        tpButton.remove();
        skillTreeUI.destroy();
        charSheetUI.destroy();
        bestiaryUI.destroy();
        for (const off of undrag) off();
        for (const cancel of timers) cancel();
        timers.clear();
        for (const off of subs) off();
        for (const off of subsOnLayout) off();
        touchControls.attach(null, null);
        ac.abort();
        runMenus.destroy();
        cheatMenu.destroy();
        levelSelect.destroy();
        inventoryUI.destroy();
        minimap.destroy();
        tutorial.destroy();
        destroyWorld(world);
        for (const seat of party) if (seat && !seat.gone) seat.player.destroy();
        state.clear();
        if (skillBar) skillBar.innerHTML = '';
        // HUD back to a neutral slate for the next run.
        bossBar?.classList.remove('show');
        bossNote?.classList.remove('show');
        deathNote?.classList.remove('show');
        descendNote?.classList.remove('show');
        descendSub?.classList.remove('show');
        interactHint?.classList.remove('show');
        floorFade?.classList.remove('show', 'loading');
        document.getElementById('endgame')?.classList.remove('show');
        document.body.classList.remove('in-run');
        if (import.meta.env.DEV) {
          Object.defineProperty(window, '__game', { configurable: true, get: () => null });
        }
      },
    };
  }

  // --- Entry: `?class=` skips the menu (tests/links); otherwise the title. --
  const classParam = new URLSearchParams(location.search).get('class');
  if (classParam && (VALID_CLASSES as readonly string[]).includes(classParam)) {
    await beginRun(classParam as ClassArchetype, 1, { slot: saves.firstFree() ?? 1 });
  } else {
    showMainMenu();
  }

  if (import.meta.env.DEV) {
    (window as unknown as { __menu: unknown }).__menu = { beginRun, exitToMenu, restartRun, mainMenu, settings, coopLobby, titleScreen, savePanel, loading };
    (window as unknown as { __layout: unknown }).__layout = { layout, perf, touchControls, app, fit }; // `fit` for synchronous panel QA (it.66).
  }
}

/** Every 5th depth is a warden's crypt: sparse packs + THE BOSS at the stairs. */
export function isBossFloor(floor: number): boolean {
  return floor % 5 === 0;
}

/**
 * Every atlas a floor can put on screen: its roster's kinds (with phased
 * boss chains), the summoned wretches, and — for arenas — the keeper.
 */
function animsForFloor(floor: number, mode: FloorMode): string[] {
  // THE MARKET WARD (it.84): the standing brazier, the guild banner, the gateway light.
  // THE EASTERN QUARTER (it.91): the looters' sheets, the villager coat (the innkeeper), the fallen in the streets (the death sheets).
  if (mode === 'hub') return [...STREET_FOLK.map((f) => f.anim), 'folk_walk', 'merchant_walk', 'villager_walk', 'poacher_idle', 'guard_idle', 'campfire', 'torch', 'brazier_stand', 'banner', 'gateway', 'knight_idle', 'mage_idle', 'ranger_idle', 'rogue_idle', ...animsForKind('bandit'), ...animsForKind('brigand'), ...VFX_ANIMS];
  // THE GILDED STAG (it.96): the folk, the keeper's coat, the hearth's fire and the wall torches.
  if (mode === 'inn') return ['folk_walk', 'villager_walk', 'merchant_walk', 'poacher_walk', 'campfire', 'torch', 'inn_fire', 'inn_torch', 'cellar_girl', 'knight_idle', 'mage_idle', 'ranger_idle', 'rogue_idle', ...VFX_ANIMS];
  // THE FARMLANDS (it.100): the company, the city's guards, the fires and the folk who come back.
  if (mode === 'farm') {
    const out = new Set<string>(['torch', 'campfire', 'inn_fire', 'inn_torch', 'guard_idle', 'guard_walk', 'guard_attack', 'guard_hit', 'folk_walk', ...STREET_FOLK.map((f) => f.anim), ...VFX_ANIMS]);
    for (const k of FARM_POOL) for (const a of animsForKind(k)) out.add(a);
    return [...out];
  }
  // THE CELLAR (it.97): the wall torches, the woman at the deep end, and what crawled in.
  if (mode === 'cellar') {
    const out = new Set<string>(['torch', 'inn_torch', 'inn_fire', 'cellar_girl', 'folk_walk', ...VFX_ANIMS]);
    for (const k of CELLAR_POOL) for (const a of animsForKind(k)) out.add(a);
    return [...out];
  }
  if (mode === 'coliseum') {
    // Every wave pool plus the stands (it.53).
    const all = new Set<string>(['folk_walk', 'torch', 'crowd_m0', 'crowd_m1', 'crowd_m2', 'crowd_m3', 'crowd_m4', 'crowd_m5', 'crowd_m6', 'crowd_m7', ...VFX_ANIMS]);
    for (const f of [1, 3, 5, 9, 14, 20]) for (const k of kindPoolFor(f)) for (const a of animsForKind(k)) all.add(a);
    for (const a of animsForKind('fallen')) all.add(a);
    for (const k of BOSS_LADDER) for (const a of animsForKind(k)) all.add(a); // Boss waves (it.54).
    return [...all];
  }
  // THE FOREST AND THE QUARRY (it.85): their own packs, the town's torches and braziers, the hydra.
  if (mode === 'forest' || mode === 'mines' || (mode === 'arena' && floor === MINES_FLOOR)) {
    const out = new Set<string>(['torch', 'brazier_stand', 'campfire', 'folk_walk', 'poacher_idle', ...STREET_FOLK.map((f) => f.anim), ...VFX_ANIMS]);
    for (const k of mode === 'forest' ? FOREST_POOL : [...MINES_POOL, 'hydra' as EnemyKind]) for (const a of animsForKind(k)) out.add(a);
    return [...out];
  }
  const kinds = new Set<EnemyKind>(kindPoolFor(floor));
  kinds.add('fallen'); // Hollow King summons; cheap (shares the knight sheets).
  if (mode === 'arena') kinds.add(BOSS_LADDER[Math.min(Math.floor(floor / 5), BOSS_LADDER.length) - 1]);
  const out = new Set<string>();
  for (const k of kinds) for (const a of animsForKind(k)) out.add(a);
  return [...VFX_ANIMS, ...[...out]];
}

/**
 * Draw + globally enforce the gothic pointer (obsidian blade, gold edge,
 * crimson gem). 1.7× pixels and an injected `*`-rule so no system pointer
 * survives anywhere, ever — the loading screen included.
 */
function installCursor(canvas: HTMLCanvasElement): void {
  const ROWS = [
    'X.................',
    'XX................',
    'XGX...............',
    'XGGX..............',
    'XGOGX.............',
    'XGOOGX............',
    'XGORROGX..........',
    'XGORRROGX.........',
    'XGORROOOGX........',
    'XGOROOOOOGX.......',
    'XGOOOOOOOOGX......',
    'XGOOOOGGGGGGX.....',
    'XGOOGOOGX.........',
    'XGOGXGOOGX........',
    'XGX..XGOOGX.......',
    'XX....XGOOGX......',
    '.......XGOGX......',
    '........XGX.......',
    '.........X........',
  ];
  const c = document.createElement('canvas');
  const px = 1.7;
  c.width = Math.ceil(18 * px);
  c.height = Math.ceil(ROWS.length * px);
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < ROWS.length; y++) {
    for (let x = 0; x < 18; x++) {
      const ch = ROWS[y][x];
      if (ch === '.' || ch === undefined) continue;
      if (ch === 'X') ctx.fillStyle = '#0a080d';
      else if (ch === 'G') ctx.fillStyle = y < 8 ? '#d8b868' : '#ab8a46';
      else if (ch === 'R') ctx.fillStyle = y < 8 ? '#c03424' : '#8e1f14';
      else {
        const shade = Math.max(40, 78 - y * 2);
        ctx.fillStyle = `rgb(${shade},${shade - 4},${shade + 10})`; // Obsidian body.
      }
      ctx.fillRect(x * px, y * px, px + 0.5, px + 0.5);
    }
  }
  const cursorCss = `url(${c.toDataURL()}) 1 1, auto`;
  canvas.style.cursor = cursorCss;
  const style = document.createElement('style');
  style.textContent = `* { cursor: ${cursorCss} !important; }`;
  document.head.appendChild(style);
}

/** Per-species voice: pitch + the HORROR bank that speaks for it (it.25). */
function voiceProfile(kind: EnemyKind): { pitch: number; bank: string } {
  switch (kind) {
    case 'zombie': return { pitch: 0.9, bank: 'hZombie' };
    case 'shambler': return { pitch: 1.05, bank: 'hZombie' };
    case 'hydra': return { pitch: 0.85, bank: 'hHiss' };
    case 'ahoul': return { pitch: 1.15, bank: 'hGrowl' };
    case 'wolf': return { pitch: 0.95, bank: 'hGrowl' };
    case 'lizard': return { pitch: 1.2, bank: 'hHiss' };
    case 'skelMage': return { pitch: 0.9, bank: 'hMoan' };
    case 'guard': return { pitch: 1.05, bank: 'hGrunt' };
    case 'bandit': return { pitch: 1.15, bank: 'hGrunt' }; // Men, not monsters (it.91).
    case 'brigand': return { pitch: 1.0, bank: 'hGrunt' };
    case 'graveGuard': return { pitch: 0.95, bank: 'hGrunt' };
    case 'skeleton': return { pitch: 1.12, bank: 'hGrunt' };
    case 'archer': return { pitch: 1.18, bank: 'hGrunt' };
    case 'fallen': return { pitch: 1.25, bank: 'hGrunt' };
    case 'shaman': return { pitch: 1.0, bank: 'hGrunt' };
    case 'bossEmber': return { pitch: 0.9, bank: 'hHiss' }; // The serpent.
    default: return { pitch: 0.8, bank: 'hRoar' }; // Wardens ROAR.
  }
}

/** Depth-banded rosters (it.14): each band introduces new flesh so no two
 *  stretches of the crypt fight the same. Also feeds arena honor guards. */
function kindPoolFor(floor: number): EnemyKind[] {
  return floor === 1
    ? ['fallen', 'fallen', 'skeleton', 'skeleton', 'zombie']
    : floor <= 3
      ? ['fallen', 'skeleton', 'skeleton', 'zombie', 'archer', 'ahoul', 'ahoul', 'orc', 'orc', 'spider']
      : floor <= 5
        ? ['fallen', 'skeleton', 'zombie', 'archer', 'guard', 'guard', 'ahoul', 'shaman', 'orc', 'poacher', 'spider']
        : floor <= 9
          ? ['skeleton', 'zombie', 'archer', 'guard', 'wolf', 'wolf', 'ahoul', 'shaman', 'shaman', 'graveGuard', 'shambler', 'shambler', 'orc', 'poacher', 'spider', 'spider']
          : floor <= 14
            ? ['zombie', 'archer', 'guard', 'wolf', 'lizard', 'lizard', 'shaman', 'skelMage', 'skelMage', 'graveGuard', 'graveGuard', 'shambler', 'shambler']
            : ['zombie', 'archer', 'guard', 'wolf', 'lizard', 'lizard', 'shaman', 'skelMage', 'skelMage', 'graveGuard', 'graveGuard', 'shambler', 'hydra'];
}

/**
 * Seeded per-floor enemy composition: more and meaner packs as you descend.
 * It.28: bosses live ONLY in their sealed arenas now — boss floors here
 * roll thinner packs and leave the stair-portal unguarded.
 */
function spawnFloorEnemies(
  dungeon: DungeonMap,
  enemies: EnemyPool,
  floor: number,
  stairs: { x: number; y: number },
  seed: number,
  /** Roster indexes already killed (FloorMemory) — rolled but not spawned. */
  skip: ReadonlySet<number> = new Set(),
  /** THE FOREST AND THE QUARRY (it.85): their own packs. */
  poolOverride?: EnemyKind[],
): void {
  const rand = mulberry32(seed ^ 0x5e5e5e5e);
  const kindPool = poolOverride ?? kindPoolFor(floor);
  const bossFloor = isBossFloor(floor);
  const perRoom = bossFloor ? Math.max(1, Math.min(floor, 3) - 1) : Math.min(1 + floor, 4);
  let spawnIndex = 0;

  for (let i = 1; i < dungeon.rooms.length; i++) {
    const room = dungeon.rooms[i];
    const count = randInt(rand, Math.max(1, perRoom - 1), perRoom);
    for (let n = 0; n < count; n++) {
      const gx = room.x + randInt(rand, 0, room.w - 1);
      const gy = room.y + randInt(rand, 0, room.h - 1);
      if (gx === stairs.x && gy === stairs.y) continue;
      // Pillar tiles carved inside rooms are solid — never spawn into one.
      if (dungeon.grid[gy * dungeon.width + gx] !== 1) continue;
      const kind = kindPool[Math.floor(rand() * kindPool.length)];
      // STRICT LEVEL MATRIX (it.23): floor-N mobs are level N; ~15% spawn
      // as rare variants at N+1 — never higher.
      const level = floor + (rand() < 0.15 ? 1 : 0);
      // The RNG stream is consumed identically whether or not this one
      // spawns, so a remembered floor rolls the same roster.
      const index = spawnIndex++;
      const affixRoll = rand(); // Consumed either way — a remembered floor rolls the same champions.
      if (skip.has(index)) continue;
      const enemy = enemies.spawn(kind, gx + 0.5, gy + 0.5, level);
      enemy.spawnIndex = index;
      if (affixRoll < 0.15) enemy.setAffix(AFFIXES[Math.floor((affixRoll / 0.15) * 3) % 3]); // ELITES (it.53).
    }
  }
}

boot().catch((err) => {
  console.error('[boot] Fatal initialization error:', err);
});
