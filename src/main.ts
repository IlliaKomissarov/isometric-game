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

import { Application, Container, Sprite } from 'pixi.js';
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
import { TILE_BLOCKED, TILE_FLOOR, generateArenaMap, generateDungeon, planHearths, type DungeonMap } from '@/scenes/DungeonGenerator';
import { SkillSystem } from '@/systems/Skills';
import { StatsBoardUI } from '@/ui/StatsBoard';
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
import { LevelSelectUI } from '@/ui/LevelSelect';
import { SettingsUI } from '@/ui/Settings';
import { MinimapUI } from '@/ui/Minimap';
import { TutorialUI } from '@/ui/Tutorial';
import { MainMenuUI } from '@/ui/MainMenu';
import { RunMenusUI } from '@/ui/RunMenus';
import type { Entity } from '@/entities/Entity';
import { ITEMS, overlayTextureFor, statLine } from '@/items/catalog';
import type { EquipmentSlot } from '@/network/Serialization';
import { DamageTextSystem } from '@/render/DamageText';
import { spriteLib, uiAssetUrl, type AnimName } from '@/render/SpriteLibrary';
import { ChestSystem } from '@/systems/Chests';
import { CheatMenuUI } from '@/ui/CheatMenu';
import { itemIconHtml } from '@/ui/itemIcons';
import { lerpVec, vec2 } from '@/utils/Vec2';
import { worldToScreen } from '@/utils/iso';
import { mulberry32, randInt } from '@/utils/rng';
import { buildTownLayout, type TownLayout } from '@/town/TownMap';
import { placeTownProps, type Interactable, type Occluder } from '@/town/TownProps';
import { Villagers } from '@/town/Villagers';
import { CampHeroes } from '@/town/CampHeroes';
import { VFX_ANIMS, VfxSystem } from '@/render/Vfx';
import { SkillTreeUI } from '@/ui/SkillTree';
import { CharacterSheetUI } from '@/ui/CharacterSheet';
import { BestiaryUI } from '@/ui/Bestiary';
import { GoreSystem } from '@/render/Gore';
import { makeDraggable } from '@/ui/draggable';
import { auditTownLayout } from '@/town/TownMap';
import { TownSystem } from '@/systems/Town';
import { ShopUI } from '@/ui/Shop';
import { StashUI } from '@/ui/Stash';
import { SavePanelUI } from '@/ui/SavePanel';
import { base64ToBytes, bytesToBase64, saves, type FloorMemory, type SaveGame, type StashState } from '@/persist/SaveGame';

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
  input: InputBindings;
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
    occluders: Occluder[];
    interactables: Interactable[];
    /** Label manager hook (it.50): the E-prompt's spot, so its plate stands down. */
    setPromptAt: (x: number | null, y?: number) => void;
    stashSprite: Sprite | null;
    /** The three unpicked heroes resting at the fire (it.40). */
    campHeroes: CampHeroes;
    /** Render-frame dressing update (gate fog) + teardown. */
    update: (dt: number) => void;
    destroyDressing: () => void;
  } | null;
  /** Roster spawn indexes killed on this floor (FloorMemory). */
  killed: Set<number>;
}

type FloorMode = 'normal' | 'arena' | 'hub';

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
  await app.init({
    resizeTo: window,
    antialias: false,
    background: PALETTE.background,
    preference: 'webgl',
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
  });
  document.getElementById('app')!.appendChild(app.canvas);
  app.ticker.stop(); // The fixed-timestep GameLoop drives rendering.

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
    ['town_cobble', 'town_grass', 'town_dirt'].forEach((name, i) => {
      if (spriteLib.hasSingle(name)) assets.registerTexture(`floor_town_${i}`, spriteLib.single(name));
    });
  } catch (err) {
    console.warn('[boot] Sprite atlases unavailable — using procedural art.', err);
  }
  loadingOverlay?.classList.add('done');

  const settings = new SettingsUI();

  // AUDIO UNLOCK (browser autoplay policy): the first gesture builds the
  // Web Audio graph; the wanted music bed (menu) starts the moment it does.
  audio.setMusic('menu');
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
    for (let f = 0; f < anim.frameCount; f++) {
      const spr = new Sprite(anim.frames[6][f]); // Facing S.
      const raw = app.renderer.extract.canvas({ target: spr, resolution: 1 }) as HTMLCanvasElement;
      spr.destroy();
      const ctx = raw.getContext('2d');
      if (!ctx) continue;
      const img = ctx.getImageData(0, 0, raw.width, raw.height);
      let minX = raw.width;
      let minY = raw.height;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < raw.height; y += 2) {
        for (let x = 0; x < raw.width; x += 2) {
          if (img.data[(y * raw.width + x) * 4 + 3] > 20) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX <= minX || maxY <= minY) continue;
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 116;
      const cctx = c.getContext('2d')!;
      cctx.imageSmoothingEnabled = false;
      const sw = maxX - minX;
      const sh = maxY - minY;
      const scale = Math.min(96 / sw, 108 / sh);
      cctx.drawImage(raw, minX, minY, sw, sh, (96 - sw * scale) / 2, 116 - sh * scale - 4, sw * scale, sh * scale);
      out.push(c);
    }
    // Ping-pong short idles so the preview breathes instead of snapping.
    const frames = out.length <= 6 && out.length > 2 ? [...out, ...out.slice(1, -1).reverse()] : out;
    previewCache.set(cls, frames);
    return frames;
  };

  // --- Class select (a modal over the menu, cancellable) --------------------
  const pickClass = async (): Promise<ClassArchetype | null> => {
    await spriteLib.ensure(VALID_CLASSES.map((c) => PREVIEW_IDLE[c]));
    return new Promise((resolve) => {
      const overlay = document.getElementById('class-select')!;
      overlay.classList.add('show');
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
          let fi = 0;
          const draw = (): void => {
            cctx.clearRect(0, 0, cv!.width, cv!.height);
            cctx.drawImage(frames[fi % frames.length], 0, 0);
            fi++;
          };
          draw();
          timers.push(window.setInterval(draw, 220));
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

  const mainMenu = new MainMenuUI({
    // START GAME always opens the character selection (it.37 flow rule).
    play: () => void openClassSelect(),
    // CONTINUE resumes the most recent slot in town (it.39).
    continueGame: () => {
      const s = saves.latest();
      if (s) void beginRun(s.player.archetype, s.pos && s.floor > 0 ? s.floor : 0, { slot: s.slot, save: s });
    },
    loadGame: () => savePanel.open('load'),
    settings: () => settings.open(),
  });
  mainMenu.setLastHero(lastHero);

  const showMainMenu = (): void => {
    document.body.classList.remove('in-run');
    audio.setMusic('menu');
    mainMenu.setHasSave(!!saves.latest());
    mainMenu.show();
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
  }

  let starting = false;
  const beginRun = async (cls: ClassArchetype, startFloor = 0, opts: RunOptions = { slot: saves.firstFree() ?? 1 }): Promise<void> => {
    if (starting) return;
    starting = true;
    mainMenu.hide();
    lastHero = cls;
    mainMenu.setLastHero(cls);
    try {
      localStorage.setItem(LAST_HERO_KEY, cls);
    } catch {
      /* ignore */
    }
    const fade = document.getElementById('floor-fade');
    fade?.classList.add('show', 'loading');
    try {
      run?.destroy();
      run = null;
      run = await startRun(cls, startFloor, opts);
      performance.mark('run:ready');
    } catch (err) {
      console.error('[run] failed to start:', err);
      showMainMenu();
    } finally {
      fade?.classList.remove('loading');
      fade?.classList.remove('show');
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
    const subs: Array<() => void> = [];
    const on = <K extends keyof GameEvents>(event: K, handler: (payload: GameEvents[K]) => void): void => {
      subs.push(eventBus.on(event, handler));
    };
    const timers = new Set<number>();
    /** setTimeout that dies with the run (boss sequences, banners). */
    const later = (fn: () => void, ms: number): void => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        if (alive) fn();
      }, ms);
      timers.add(id);
    };
    const ac = new AbortController();

    document.body.classList.add('in-run');
    state.clear();
    const inputQueue = new InputQueue();

    const seedParam = new URLSearchParams(location.search).get('seed');
    const baseSeed = loaded ? loaded.seed : seedParam !== null ? Number(seedParam) >>> 0 : (Date.now() ^ 0x9e3779b9) >>> 0;
    /** Per-floor memory (it.39): rebuilt floors look the way they were left. */
    const floors: Record<number, FloorMemory> = loaded ? { ...loaded.floors } : {};
    const memKey = (f: number, arena: boolean): number => (arena ? 1000 + f : f);
    let deepestFloor = loaded?.deepestFloor ?? 0;
    const playtimeBase = loaded?.playtimeTicks ?? 0;
    const createdAt = loaded?.createdAt ?? Date.now();

    // `?depth=N` starts on a deeper floor (debug/testing convenience).
    const depthParam = Number(new URLSearchParams(location.search).get('depth'));
    let floor =
      Number.isFinite(depthParam) && depthParam >= 1 ? Math.min(Math.floor(depthParam), MAX_DEPTH) : startFloor;

    // The hero's own atlases (+ the knight fallback) stream in before
    // anything renders; buildWorld fetches the floor's roster itself.
    await spriteLib.ensure([...animsForHero(chosenClass), ...animsForHero('warrior')]);

    const player = new Player(chosenClass);
    state.register(player);
    // Starter kit fits the trade (it.32): the class's basic arms.
    if (loaded) {
      // RESTORE (it.39): the sheet, the bags, the worn gear.
      player.level = loaded.player.level;
      player.xp = loaded.player.xp;
      player.gold = loaded.player.gold;
      player.hpMax = loaded.player.hpMax;
      player.hp = Math.min(loaded.player.hpMax, Math.max(1, loaded.player.hp));
      player.resource = Math.min(player.resourceMax, loaded.player.resource);
      player.skillPoints = loaded.player.skillPoints;
      for (const id of loaded.player.unlocked) player.unlockedSkills.add(id);
      for (const id of loaded.player.passives) player.passives.add(id);
      for (const [k, v] of Object.entries(loaded.player.bestiary ?? {})) player.bestiary.set(k, { seen: v.seen, killed: v.killed });
      player.goldCollected = loaded.player.goldCollected ?? 0;
      loaded.player.loadout.forEach((id, i) => {
        player.loadout[i] = id && player.unlockedSkills.has(id) ? id : null;
      });
      for (const id of loaded.player.backpack) if (ITEMS[id]) player.addItem(id);
      for (const { itemId } of loaded.player.equipped) {
        if (!ITEMS[itemId]) continue;
        player.addItem(itemId);
        player.equipFromBackpack(player.backpack.length - 1);
      }
    } else {
      // STARTER KIT (it.42): the class weapon and a chest piece go straight
      // onto the paperdoll — nobody walks out of town bare-handed.
      const starterWeapon = chosenClass === 'ranger' ? 'short_bow' : chosenClass === 'mage' ? 'apprentice_wand' : chosenClass === 'rogue' ? 'worn_katana' : 'rusty_sword';
      const starterChest = chosenClass === 'mage' ? 'cloth_robe' : 'leather_jerkin';
      for (const id of [starterWeapon, starterChest]) {
        player.addItem(id);
        player.equipFromBackpack(player.backpack.length - 1);
      }
      // SECONDARY ARM (it.48): a bow for the melee trades, a blade for the ranger.
      player.addItem(chosenClass === 'ranger' ? 'rusty_sword' : 'short_bow');
      // Every delver leaves town with two draughts and a way back (it.39).
      player.addItem('health_potion');
      player.addItem('health_potion');
    }
    if (spriteLib.loaded) player.enableKnightRig(); // The class body replaces the crystal.

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
            const def = itemId ? ITEMS[itemId] : undefined;
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
            const def = itemId ? ITEMS[itemId] : undefined;
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

    // Town economy + stash (it.39): the stash belongs to the SLOT.
    const town = new TownSystem(player, opts.stash ?? loaded?.stash ?? { items: [], gold: 0 });
    let townVisits = loaded ? 1 : 0;
    let pendingPortal = false;
    let portalCooldown = 0;
    /** HIT-STOP (it.48): sim ticks frozen when heavy steel lands — the frame the blow READS. */
    let hitStopTicks = 0;
    const hitStop = (ticks: number): void => {
      if (world.town) return;
      hitStopTicks = Math.min(3, Math.max(hitStopTicks, ticks));
    };
    const vignetteEl = document.getElementById('vignette');
    let hurtFlashTimer = 0;
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
    let emptyArenaTicks = 0;
    let portalReturn: { floor: number; arena: boolean; x: number; y: number } | null = null;
    let portalArmed = false;
    let pendingInteract: number | null = null;
    const inventorySystem = new InventorySystem(player, {
      heal: (fraction) => {
        const healed = world.combat.heal(player.id, Math.round(player.hpMax * fraction));
        audio.sfx('potion');
        if (healed > 0) {
          world.dmgText.show(player.pos.x, player.pos.y - 0.3, `+${healed}`, 'miss');
          world.ambience.burst(player.pos.x, player.pos.y, 0xd83030, 10);
        }
        updateOrb();
      },
      restore: (fraction) => {
        player.resource = Math.min(player.resourceMax, player.resource + player.resourceMax * fraction);
        audio.sfx('potion');
        world.ambience.burst(player.pos.x, player.pos.y, 0x6f86b8, 10);
      },
      portal: () => {
        if (world.town || transitioning || pendingPortal) return false;
        pendingPortal = true;
        return true;
      },
    });
    const stateSync = new StateSyncSystem(inputQueue);
    const inventoryUI = new InventoryUI(player, inputQueue, 0, buildPaperdollFrames);
    const tutorial = new TutorialUI();
    const minimap = new MinimapUI();

    let pendingDescend = false;
    let pendingArena = false;
    let victoryShown = false;

    /** Cheat state survives floor transitions (worlds are rebuilt). */
    const cheatState = { god: false };

    // --- HUD refs -----------------------------------------------------------
    const orb = document.getElementById('orb');
    const orbFill = document.getElementById('orb-fill');
    const orbLabel = document.getElementById('orb-label');
    const deathNote = document.getElementById('death-note');
    const descendNote = document.getElementById('descend-note');
    const depthLabel = document.getElementById('depth-label');
    const rowMove = document.getElementById('row-move');
    const rowDirect = document.getElementById('row-direct');
    const interactHint = document.getElementById('interact-hint');
    const bossNote = document.getElementById('boss-note');
    const bossBar = document.getElementById('boss-bar');
    const bossBarFill = document.getElementById('boss-bar-fill');

    // Progression HUD: level plaque, XP bar, gold counter (it.22).
    const levelLabel = document.getElementById('level-label');
    const xpFill = document.getElementById('xp-fill');
    const goldLabel = document.getElementById('gold-label');
    const xpText = document.getElementById('xp-text');
    const updateProgressHud = (): void => {
      if (levelLabel) levelLabel.textContent = `LVL ${player.level}`;
      if (xpFill) xpFill.style.width = `${Math.round((player.xp / player.xpToNext()) * 100)}%`;
      if (xpText) xpText.textContent = `XP: ${player.xp} / ${player.xpToNext()}`; // Readable gauge (it.48).
      if (xpFill?.parentElement) xpFill.parentElement.title = `XP: ${player.xp} / ${player.xpToNext()}`;
      if (goldLabel) goldLabel.textContent = `${player.gold}`;
    };

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

    const updateOrb = (): void => {
      const frac = Math.max(0, player.hp / player.hpMax);
      if (orbFill) orbFill.style.height = `${Math.round(frac * 100)}%`;
      if (orbLabel) orbLabel.textContent = `${player.hp}`;
      orb?.classList.toggle('low', frac < 0.3 && frac > 0);
    };
    const updateDepth = (): void => {
      if (depthLabel) depthLabel.textContent = floor === 0 ? 'THE TOWN' : `DEPTH ${ROMAN[floor - 1] ?? floor}`;
    };
    updateOrb();
    updateDepth();
    updateProgressHud();

    // --- Floor run timer ----------------------------------------------------
    const timerLabel = document.getElementById('timer');
    const descendSub = document.getElementById('descend-sub');
    let floorStartTick = 0;
    const formatTime = (ticks: number): string => {
      const totalSec = Math.floor(ticks / 60);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
    };

    on('input:modeChanged', ({ mode }) => {
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
    };

    // SYNCHRONOUS world construction (it.37): no await between the old
    // floor's teardown and the new floor's first tick — the freeze was the
    // loop touching a destroyed world during the old async gap.
    const buildWorld = (floorNum: number, mode: FloorMode = 'normal'): World => {
      const isArena = mode === 'arena';
      const isHub = mode === 'hub';
      const seed = isHub ? (baseSeed ^ 0x70a1) >>> 0 : ((baseSeed + floorNum * 7919) ^ (isArena ? 0xa11e4a : 0)) >>> 0;
      state.dungeonSeed = seed;
      const layout = isHub ? buildTownLayout() : null;
      const memory: FloorMemory | undefined = isHub ? undefined : floors[memKey(floorNum, isArena)];
      // STRUCTURAL REVERT (it.15, user-directed): every depth uses the same
      // clean layout rules as floors 1–2 — depth identity comes from the
      // palette/tileset bands and prop dressing, not from layout gimmicks.
      // BOSS ARENAS (it.28): boss floors funnel into a dedicated sealed hall —
      // one vast open room, ringed by candelabra fire, no internal clutter.
      const dungeon = layout ? layout.map : isArena ? generateArenaMap(30, 22, seed) : generateDungeon(MAP_W, MAP_H, seed);
      // Solid hearth props claim their tiles BEFORE anything reads the grid —
      // collision, pathing, rendering and prop placement all agree (it.16).
      let hearths: Array<{ x: number; y: number }>;
      if (isHub) {
        hearths = []; // The town lights itself (campfire, torches).
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

      const viewport = new Viewport(app);
      const camera = new Camera(app, viewport);
      const scene = new SceneManager();
      const lighting = new Lighting();
      // Sight is blocked by ARCHITECTURE only — solid props don't cast fog.
      // The town is daylight-wide: every stall visible from the campfire.
      // TOWN LIGHT (it.45): dusk — full light only close to the hero, the rest
      // of the square falls to the torches, lanterns and the campfire.
      lighting.build(dungeon.width, dungeon.height, (gx, gy) => scene.isOpaque(gx, gy), isHub ? { sightRadius: 36, fullRadius: 5 } : undefined);
      // Theme bands: 1–2 stone crypts · 3–9 buried temple · 10–14 frozen
      // halls · 15–20 ember depths. Each band reads distinct at a glance.
      const theme = !spriteLib.loaded
        ? 'stone'
        : isHub
          ? 'town'
        : floorNum <= 2
          ? 'stone'
          : floorNum <= 9
            ? 'temple'
            : floorNum <= 14
              ? 'frost'
              : 'ember';
      scene.build(dungeon, viewport, lighting, theme);
      if (isHub) {
        audio.setMusic('town'); // The title theme keeps the town (Tristram rule).
      } else {
        audio.setBgmDeep(floorNum >= 10); // The deep bands breathe a darker drone.
        // Boss arena music (it.28): the floor's intense track fades in the
        // moment the arena builds — and back to the dungeon BGM when we leave.
        audio.setBossMusic(isArena, floorNum);
      }

      const ambience = new Ambience(viewport);
      if (spriteLib.loaded) ambience.setGlintFrames(spriteLib.anim('glint').frames[0]);
      const goldPiles = isHub ? [] : placeProps(dungeon, viewport, lighting, ambience, hearths);
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
      // its heart, and stepping anywhere inside the room instantly teleports
      // into the arena. Arena stairs sit at the hall's far east end, hidden
      // until every combatant inside the seal is dead.
      const arenaRoom = dungeon.rooms[0];
      const isPortalFloor = !isArena && !isHub && isBossFloor(floorNum);
      let arenaThreshold: World['arenaThreshold'] = null;
      let bossSigil: { x: number; y: number } | null = null;
      let stairs: { x: number; y: number; sprite: Sprite };
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
        stairs = { x: gx, y: gy, sprite: seal };
      } else {
        stairs = placeStairs(
          dungeon,
          viewport,
          lighting,
          layout
            ? { at: layout.gate, hidden: true } // The dungeon gate: the archway IS the model — no stair sprite in the opening (it.47).
            : isArena
              ? { hidden: true, at: { x: arenaRoom.x + arenaRoom.w - 3, y: arenaRoom.y + Math.floor(arenaRoom.h / 2) } }
              : undefined,
        );
      }

      const loot = new LootSystem(viewport, seed);
      const chests = new ChestSystem(viewport, lighting, loot, seed);
      if (!isArena && !isHub) chests.place(dungeon, [stairs]); // The arena floor stays clean.
      if (memory) chests.applyMemory(memory.openedChests);
      const pathfinder = new Pathfinder(dungeon.width, dungeon.height, scene.isWalkable);
      // Attack/approach range follows the wielded weapon (reach or fire range).
      const getAttackRange = (): number => Math.max(ATTACK_RANGE, player.weaponProfile.range);
      const movement = new MovementSystem(player, pathfinder, scene.isWalkable, loot, chests, getAttackRange, viewport);
      // Enemy queries are wired through a late-bound pool reference
      // (combat must exist before the pool, whose AI deps call into combat).
      let enemiesRef: EnemyPool | null = null;
      /** TARGETING query: fog-gated (you can only aim at what you can see). */
      const findNearestEnemy = (x: number, y: number, range: number): Entity | null => {
        let best: Entity | null = null;
        let bestDist = range;
        enemiesRef?.forEachActive((enemy) => {
          if (enemy.hp <= 0 || enemy.action === 'dead') return;
          if (!lighting.isVisible(Math.floor(enemy.pos.x), Math.floor(enemy.pos.y))) return;
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
      const combat = new CombatSystem(player, movement, scene.isWalkable, findNearestEnemy, seed);
      combat.godMode = cheatState.god; // Cheats survive the floor transition.
      // Untargeted swings aim at the mouse cursor (it.33).
      combat.aimDir = () => {
        if (lastMouse.seen) {
          const w = camera.pointerToWorld(lastMouse.x, lastMouse.y, vec2());
          const dx = w.x - player.pos.x;
          const dy = w.y - player.pos.y;
          const len = Math.hypot(dx, dy);
          if (len > 0.2) return { x: dx / len, y: dy / len };
        }
        const flen = Math.hypot(player.facing.x, player.facing.y) || 1;
        return { x: player.facing.x / flen, y: player.facing.y / flen };
      };
      // AoE cleave sweep: every living enemy in range (fog-independent sim).
      combat.enemiesNear = (x, y, r) => {
        const out: Entity[] = [];
        enemiesRef?.forEachActive((enemy) => {
          if (enemy.hp <= 0 || enemy.action === 'dead') return;
          if (Math.hypot(enemy.pos.x - x, enemy.pos.y - y) <= r) out.push(enemy);
        });
        return out;
      };
      const projectiles = new ProjectileSystem(viewport, scene.isWalkable, player, findEnemyAt);
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

      const enemies = new EnemyPool(
        viewport,
        {
          pathfinder,
          isWalkable: scene.isWalkable,
          isOpaque: scene.isOpaque,
          getPlayerPos: () => player.pos,
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
          isPlayerHidden: () => player.stealthed,
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
      const killed = new Set<number>(memory?.killedSpawns ?? []);
      const arenaAlreadyCleared = isArena && !!memory?.arenaCleared;
      if (isHub || arenaAlreadyCleared) {
        // No enemies in town; a cleared arena stays empty with its stair open.
      } else if (isArena) {
        const room = dungeon.rooms[0];
        const cx = room.x + Math.floor(room.w * 0.68) + 0.5;
        const cy = room.y + Math.floor(room.h / 2) + 0.5;
        const kind = BOSS_LADDER[Math.min(Math.floor(floorNum / 5), BOSS_LADDER.length) - 1];
        boss = enemies.spawn(kind, cx, cy, BOSS_LEVELS[floorNum] ?? floorNum + 2);
        const pool = kindPoolFor(floorNum);
        const rand = mulberry32(seed ^ 0x9a7e0a);
        const guardRing = [
          { dx: -2.6, dy: -2.1 },
          { dx: -2.6, dy: 2.1 },
          { dx: 2.4, dy: -2.4 },
          { dx: 2.4, dy: 2.4 },
          { dx: -4.2, dy: 0 },
        ];
        for (const off of guardRing) {
          enemies.spawn(pool[Math.floor(rand() * pool.length)], cx + off.dx, cy + off.dy, floorNum);
        }
      } else {
        spawnFloorEnemies(dungeon, enemies, floorNum, stairs, seed, killed);
      }
      if (arenaAlreadyCleared) {
        stairs.sprite.renderable = true;
        lighting.registerProp(stairs.x, stairs.y, stairs.sprite);
      }
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
      let townState: World['town'] = null;
      if (layout) {
        const dressing = placeTownProps(layout, viewport, lighting, ambience);
        const villagers = new Villagers(viewport.objectLayer, scene.isWalkable, layout.wander, 7, layout.merchant, layout.guards, layout.alchemist);
        const campHeroes = new CampHeroes(viewport.objectLayer, chosenClass, layout.campSpots, layout.campfire);
        // COLLISION AUDIT (it.40): no walkable pocket may be sealed off by props.
        const audit = auditTownLayout(layout);
        if (audit.unreachable.length || audit.missing.length) {
          console.warn('[town] layout audit:', audit.unreachable.length, 'unreachable tiles', audit.unreachable.slice(0, 12), 'missing:', audit.missing);
        }
        townState = {
          layout,
          villagers,
          occluders: dressing.occluders,
          interactables: dressing.interactables,
          setPromptAt: dressing.setPromptAt,
          stashSprite: dressing.stashSprite,
          campHeroes,
          update: dressing.update,
          destroyDressing: dressing.destroy,
        };
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
            text: 'Click the ground — or hold W A S D — to move through the dark.',
          },
          {
            id: 'strike',
            x: waystone.x + 0.5,
            y: waystone.y + 0.5,
            radius: 2.2,
            text: 'The waystone hums: press SPACE to swing your blade. Click a foe to hunt it down.',
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

      // Player joins this floor's stage at its entrance.
      viewport.objectLayer.addChild(player.container);
      player.warpTo(dungeon.spawn.x + 0.5, dungeon.spawn.y + 0.5);
      player.action = 'idle';

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
          return null;
        }
        return chests.pickAtCanvas(canvasX, canvasY, camera);
      };
      const input = new InputBindings(app.canvas, camera, inputQueue, 0, scene.isWalkable, pickEnemy, pickItem, pickChest);

      lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
      if (memory?.explored) lighting.unpackExplored(base64ToBytes(memory.explored));
      minimap.setWorld(dungeon, lighting, stairs);
      const unsubscribe = eventBus.on('player:tileChanged', ({ gx, gy }) => {
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
        combat,
        projectiles,
        enemies,
        chests,
        input,
        stairs,
        isArena,
        arenaCleared: arenaAlreadyCleared, // SOFTLOCK FIX (it.44): a remembered clear stays cleared.
        arenaThreshold,
        goldPiles,
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
      };
    };

    const destroyWorld = (w: World): void => {
      w.unsubscribe();
      w.town?.villagers.destroy();
      w.town?.campHeroes.destroy();
      w.town?.destroyDressing();
      w.input.destroy();
      w.projectiles.clear();
      w.vfx.clear();
      w.gore.clear();
      w.enemies.destroyAll();
      // The hero survives the viewport teardown — but only detach them if
      // they still stand in THIS world (the next one may already own them).
      if (player.container.parent === w.viewport.objectLayer) player.container.removeFromParent();
      w.viewport.destroy();
    };

    await preloadFloor(floor, floor === 0 ? 'hub' : 'normal');
    let world = buildWorld(floor, floor === 0 ? 'hub' : loaded?.arena && isBossFloor(floor) ? 'arena' : 'normal');

    /** Remember the current dungeon floor exactly as the hero leaves it (it.39). */
    const captureFloor = (): void => {
      if (world.town) return;
      const key = memKey(floor, world.isArena);
      const takenGold: number[] = [];
      world.goldPiles.forEach((p, i) => {
        if (p.taken) takenGold.push(i);
      });
      floors[key] = {
        openedChests: world.chests.openedIndexes(),
        takenGold,
        killedSpawns: [...world.killed],
        explored: bytesToBase64(world.lighting.packExplored()),
        arenaCleared: world.isArena ? world.arenaCleared : (floors[key]?.arenaCleared ?? false),
      };
    };

    /** Write the save slot (it.39): the sheet, bags, stash, floor memories. */
    const saveNow = (): boolean => {
      if (!alive) return false;
      if (!world.town) captureFloor();
      const equipped: SaveGame['player']['equipped'] = [];
      for (const s of ['head', 'torso', 'legs', 'mainHand', 'offHand', 'cloak', 'ring'] as const) {
        const itemId = player.getEquipped(s);
        if (itemId) equipped.push({ slot: s, itemId });
      }
      const save: SaveGame = {
        version: 3,
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
        player: {
          archetype: player.archetype,
          level: player.level,
          xp: player.xp,
          gold: player.gold,
          hp: player.hp,
          hpMax: player.hpMax,
          resource: player.resource,
          backpack: [...player.backpack],
          equipped,
          skillPoints: player.skillPoints,
          unlocked: [...player.unlockedSkills],
          loadout: [...player.loadout],
          passives: [...player.passives],
          bestiary: Object.fromEntries([...player.bestiary].map(([k, v]) => [k, { ...v }])),
          goldCollected: player.goldCollected,
        },
        stash: { items: [...town.stash.items], gold: town.stash.gold },
        floors: { ...floors },
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
      let next: World;
      try {
        next = make();
      } catch (err) {
        console.error('[floor] build failed — staying on the current floor:', err);
        // The failed attempt may have re-parented the hero; put them back.
        if (player.container.parent !== world.viewport.objectLayer) {
          world.viewport.objectLayer.addChild(player.container);
        }
        return false;
      }
      const old = world;
      world = next;
      skills.clearZones(); // Firewalls/traps stay in the old world's grave.
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
      player.action = 'idle';
      if (viaPortal) {
        player.warpTo(t.layout.portal.x + 0.5, t.layout.portal.y + 0.5);
        world.lighting.updateVisibility(t.layout.portal.x, t.layout.portal.y);
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
        const ring = new Sprite(assets.get('targetRing'));
        ring.anchor.set(0.5);
        ring.tint = 0x8fb8ff;
        ring.alpha = 0.8;
        ring.position.set(s.x, s.y);
        world.viewport.groundLayer.addChild(ring);
        world.lighting.addSource(t.layout.portal.x + 0.5, t.layout.portal.y + 0.5, 2.6, 90, 140, 255, 0.6);
        portalArmed = false;
      }
      townVisits++;
      town.restock(baseSeed, deepestFloor, townVisits);
      // FAST TRAVEL HINT (it.48): back from the depths, the DEPTHS menu is the quick way down.
      if (deepestFloor > 0) tutorial.notify('fastTravel', 'Back in town — press L to open DEPTHS and fast-travel to any floor you have reached.');
      minimap.markDirty();
      saveNow();
    };

    /** Scroll of Town Portal: remember where we stood, then fade to town. */
    const castPortal = (): void =>
      withFade(async () => {
        portalReturn = { floor, arena: world.isArena, x: player.pos.x, y: player.pos.y };
        captureFloor();
        await preloadFloor(0, 'hub');
        if (!swapWorld(() => buildWorld(0, 'hub'))) {
          portalReturn = null;
          return;
        }
        enterTown(true);
      });

    /** Step back through the town portal to the remembered floor and spot. */
    const returnThroughPortal = (): void =>
      withFade(async () => {
        const r = portalReturn;
        if (!r) return;
        portalReturn = null;
        const mode: FloorMode = r.arena ? 'arena' : 'normal';
        await preloadFloor(r.floor, mode);
        if (!swapWorld(() => buildWorld(r.floor, mode))) return;
        floor = r.floor;
        updateDepth();
        floorStartTick = state.tick;
        player.warpTo(r.x, r.y);
        player.action = 'idle';
        world.lighting.updateVisibility(Math.floor(r.x), Math.floor(r.y));
        minimap.markDirty();
        updateOrb();
        audio.sfx('portal');
      });

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
    const skills = new SkillSystem({
      player,
      combat: () => world.combat,
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
      text: (x, y, m, s) => world.dmgText.show(x, y, m, s),
      sfx: (n) => audio.sfx(n as Parameters<typeof audio.sfx>[0]),
      vfx: (anim, x, y, opts) => world.vfx.play(anim, x, y, opts),
      aim: () => {
        if (lastMouse.seen) {
          const w = world.camera.pointerToWorld(lastMouse.x, lastMouse.y, vec2());
          const dx = w.x - player.pos.x;
          const dy = w.y - player.pos.y;
          const len = Math.hypot(dx, dy);
          if (len > 0.2) return { x: dx / len, y: dy / len };
        }
        const flen = Math.hypot(player.facing.x, player.facing.y) || 1;
        return { x: player.facing.x / flen, y: player.facing.y / flen };
      },
      // The cursor's exact world point (it.38): ground zones land ON it.
      aimPoint: () => (lastMouse.seen ? world.camera.pointerToWorld(lastMouse.x, lastMouse.y, vec2()) : null),
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
    subs.push(() => skills.destroy());
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
          : `<div class="skill-glyph skill-empty">+</div><div class="skill-flash"></div><div class="skill-key">${i + 1}</div>` +
            `<div class="skill-cd"></div><div class="skill-cd-num"></div>` +
            `<div class="skill-tip"><b>Empty slot</b><span>${player.skillPoints} skill point${player.skillPoints === 1 ? '' : 's'}</span><p>Press K to open the Skill Tree and learn a skill.</p></div>`;
        skillBar.appendChild(slot);
        skillSlotEls.push({
          root: slot,
          cd: slot.querySelector('.skill-cd') as HTMLElement,
          num: slot.querySelector('.skill-cd-num') as HTMLElement,
        });
      });
      const label = document.getElementById('resource-label');
      if (label) label.textContent = player.resourceName;
      document.getElementById('resource-fill')?.classList.toggle('stamina', player.resourceName === 'STAMINA');
    };
    buildSkillBar();
    subs.push(eventBus.on('skills:changed', () => buildSkillBar()));

    const resourceFill = document.getElementById('resource-fill');
    const resourceText = document.getElementById('resource-text');
    // THE RESOURCE GLOBE (it.49): the right-hand orb — stamina gold, mana blue.
    const orb2Wrap = document.getElementById('orb2-wrap');
    const orb2Fill = document.getElementById('orb2-fill');
    const orb2Label = document.getElementById('orb2-label');
    const orb2Name = document.getElementById('orb2-name');
    if (orb2Wrap) orb2Wrap.classList.toggle('mana', player.resourceName !== 'STAMINA');
    if (orb2Name) orb2Name.textContent = player.resourceName;
    const updateSkillHud = (): void => {
      if (resourceFill) resourceFill.style.width = `${Math.round((player.resource / player.resourceMax) * 100)}%`;
      if (resourceText) resourceText.textContent = `${Math.round(player.resource)} / ${player.resourceMax}`; // Readable gauge (it.48).
      if (orb2Fill) orb2Fill.style.height = `${Math.round((player.resource / player.resourceMax) * 100)}%`;
      if (orb2Label) orb2Label.textContent = `${Math.round(player.resource)}`;
      const tpNote = tpButton.querySelector('i');
      if (tpNote) tpNote.textContent = world.town ? 'in town' : portalCooldown > 0 ? `${Math.ceil(portalCooldown / 60)}s` : 'ready';
      tpButton.classList.toggle('cooling', portalCooldown > 0 || !!world.town);
      skills.skills.forEach((def, i) => {
        const el = skillSlotEls[i];
        if (!el || !def) return;
        const cd = skills.cooldowns[i];
        // CAST FLASH (it.40): a cooldown that just started means the skill fired.
        if (cd > 0 && lastSkillCd[i] === 0) {
          el.root.classList.remove('cast');
          void el.root.offsetWidth;
          el.root.classList.add('cast');
        }
        lastSkillCd[i] = cd;
        if (cd > 0) {
          el.root.classList.add('cooling');
          el.cd.style.height = `${Math.min(100, Math.round((cd / def.cd) * 100))}%`;
          el.num.textContent = `${Math.ceil(cd / 60)}`;
        } else {
          el.root.classList.remove('cooling');
          el.cd.style.height = '0%';
          el.num.textContent = '';
        }
        el.root.classList.toggle('poor', player.resource < def.cost);
      });
    };

    // SMOOTH FLOOR TRANSITIONS (it.15): a quick fade-to-black covers the
    // world teardown/rebuild so floors never pop. Guarded against re-entry.
    // It.36: the work is ASYNC (atlases may stream in) — the fade holds and
    // shows a "delving" label until the new floor is fully built.
    const floorFade = document.getElementById('floor-fade');
    let transitioning = false;
    let transitionSerial = 0;
    const withFade = (work: () => Promise<void>): void => {
      if (transitioning) return;
      transitioning = true;
      const serial = ++transitionSerial;
      audio.sfx('stairs');
      floorFade?.classList.add('show');
      const finish = (): void => {
        if (!alive || serial !== transitionSerial) return;
        floorFade?.classList.remove('loading');
        later(() => {
          floorFade?.classList.remove('show');
          transitioning = false;
        }, 140);
      };
      later(() => {
        floorFade?.classList.add('loading');
        void work()
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
        const clearTime = formatTime(state.tick - floorStartTick);
        const fromTown = !!world.town;
        if (!fromTown) captureFloor();
        if (!swapWorld(() => buildWorld(next))) return;
        floor = next;
        deepestFloor = Math.max(deepestFloor, floor);
        updateDepth();
        levelSelect.unlock(floor);
        // The run timer resets cleanly on every floor transition.
        floorStartTick = state.tick;
        if (descendSub) descendSub.textContent = fromTown ? 'The gate seals behind you' : `Depth ${ROMAN[floor - 2] ?? floor - 1} delved in ${clearTime}`;
        descendNote?.classList.add('show');
        descendSub?.classList.add('show');
        later(() => {
          descendNote?.classList.remove('show');
          descendSub?.classList.remove('show');
        }, 5200); // Doubled (it.50).
      });

    /**
     * BOSS ARENA TELEPORT (it.28): crossing the boss-floor threshold seizes
     * the player and drops them into the depth's sealed fighting hall.
     */
    const enterArena = (): void =>
      withFade(async () => {
        await preloadFloor(floor, 'arena');
        captureFloor();
        if (!swapWorld(() => buildWorld(floor, 'arena'))) return;
        player.action = 'idle';
        updateOrb();
        world.dmgText.show(player.pos.x + 1.2, player.pos.y - 0.6, 'THE ARENA SEALS SHUT', 'crit');
      });

    /** Level-select jump: fade-covered travel to any unlocked depth. */
    const jumpToFloor = (target: number): void => {
      if (target === floor) return;
      withFade(async () => {
        await preloadFloor(target, 'normal');
        if (!world.town) captureFloor();
        if (!swapWorld(() => buildWorld(target))) return;
        floor = target;
        deepestFloor = Math.max(deepestFloor, floor);
        updateDepth();
        floorStartTick = state.tick;
        player.action = 'idle';
        updateOrb();
      });
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
    const levelSelect = new LevelSelectUI(jumpToFloor);
    levelSelect.unlock(Math.max(floor, deepestFloor));
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
        if (ITEMS[id]) player.addItem(id);
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
          if (!world.town) captureFloor();
          if (!swapWorld(() => buildWorld(dest, mode))) return;
          floor = dest;
          deepestFloor = Math.max(deepestFloor, floor);
          updateDepth();
          floorStartTick = state.tick;
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
      } else if (entity === player) {
        player.onDamaged();
        // HURT (it.48): a red flash at the edges and a recoil away from the blow.
        if (klen > 0) world.camera.addKickDir(kdx / klen, kdy / klen, 6);
        else world.camera.addKick(5);
        hurtFlashTimer = 0.15; // A short pulse (it.49), max alpha 0.25 in the stylesheet.
        vignetteEl?.classList.add('hurt');
        updateOrb();
        tutorial.notify('hurt', 'You bleed. Their heavy blows are telegraphed — step away as they rear back.');
      }
    });

    on('combat:swing', ({ sourceId, targetId, result }) => {
      lastCritTarget = result === 'crit' ? targetId : -1;
      if (result === 'miss') {
        const at = state.getEntity(targetId) ?? state.getEntity(sourceId);
        if (at) world.dmgText.show(at.pos.x, at.pos.y, 'miss', 'miss');
      }
      if (result === 'crit') {
        const target = state.getEntity(targetId);
        if (target) world.dmgText.show(target.pos.x - 0.4, target.pos.y - 0.4, 'CRIT!', 'crit');
      }
      if (sourceId !== player.id) {
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

    on('item:dropped', ({ itemId, x, y }) => {
      tutorial.notify('loot', 'A treasure has fallen — press E near it, or click to claim it.');
      // Rare finds announce themselves with the pack's treasure glint.
      if (ITEMS[itemId]?.rarity === 'rare') world.ambience.playGlint(x, y);
    });

    // An idle thing in the dark just noticed you (species growl/hiss/moan).
    on('enemy:aggro', ({ entityId }) => {
      const entity = state.getEntity(entityId);
      const v = entity instanceof Enemy ? voiceProfile(entity.def.kind) : { pitch: 1, bank: 'hGrunt' };
      audio.enemyVoice('idle', v.pitch, v.bank);
    });

    on('chest:reached', ({ chestId }) => world.chests.open(chestId));
    on('chest:opened', ({ x, y }) => {
      interactHint?.classList.remove('show', 'dim'); // The prompt dies with the lock.
      audio.sfx('chest');
      world.ambience.playGlint(x, y);
      world.camera.addKick(2);
      tutorial.notify('chest', 'The old locks give easily. Take what the dead no longer need.');
    });

    on('item:pickupArrived', ({ uid }) => {
      const itemId = world.loot.pickup(uid);
      if (itemId) {
        audio.sfx(ITEMS[itemId]?.rarity === 'rare' ? 'rarePickup' : 'pickup');
        player.addItem(itemId);
        tutorial.notify('inv', 'Press I to open your inventory and equip your spoils.');
      }
    });

    on('entity:died', ({ entityId }) => {
      const entity = state.getEntity(entityId);
      if (entity instanceof Enemy) {
        if (entity.spawnIndex >= 0) world.killed.add(entity.spawnIndex); // FloorMemory (it.39).
        player.noteKill(entity.def.kind); // Bestiary (it.42).
        eventBus.emit('bestiary:changed', {});
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
        const xpGain = entity.xpValue();
        const levelsGained = player.grantXp(xpGain);
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
          tutorial.notify('skillpoint', 'A skill point is yours — press K to open the Skill Tree.');
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
          later(() => {
            if (world !== w) return;
            for (let i = 0; i < 3; i++) {
              const a = (i / 3) * Math.PI * 2 + 0.5;
              w.loot.dropRareAt(bx + Math.cos(a) * 0.9, by + Math.sin(a) * 0.9);
            }
            w.ambience.playGlint(bx, by);
            w.ambience.burst(bx, by, 0xffd9a0, 20);
            w.camera.addKick(7);
            w.camera.addShake(0.4);
          }, 3300);
          bossNote?.classList.add('show');
          later(() => bossNote?.classList.remove('show'), 8400); // Doubled (it.50).
        } else {
          world.loot.tryDropAt(entity.pos.x, entity.pos.y);
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
            const w = world;
            // Boss last: wait out the collapse + loot beat. Minion last: brief pause.
            const delay = entity === w.boss ? 7600 : 1100;
            // FINAL DEPTH (it.49): no automatic ending. The Hollow King's spoils lie
            // where he fell; the last stair opens behind the arena and the ending
            // waits for the hero to CLIMB IT.
            later(() => {
              if (world !== w) return;
              w.stairs.sprite.renderable = true;
              w.lighting.registerProp(w.stairs.x, w.stairs.y, w.stairs.sprite);
              w.ambience.burst(w.stairs.x + 0.5, w.stairs.y + 0.5, 0xffd9a0, 20);
              w.ambience.playGlint(w.stairs.x + 0.5, w.stairs.y + 0.5);
              w.dmgText.show(w.stairs.x + 0.5, w.stairs.y + 0.2, floor >= MAX_DEPTH ? 'THE LAST STAIR OPENS' : 'THE WAY OPENS', 'crit');
              if (floor >= MAX_DEPTH) tutorial.notify('lastStair', 'The Hollow King is dust. Claim his spoils, then climb the stair at the arena\u2019s far end to end the delve.');
              audio.sfx('gateOpen');
              audio.setBossMusic(false);
            }, delay);
          }
        }
        return;
      }
      if (entity === player) {
        // The hero falls where they stood (death sheet plays out), THEN the
        // death overlay offers RISE AGAIN / RESTART / MAIN MENU (it.36).
        player.action = 'dead';
        player.actionTicks = 0;
        inputQueue.enqueue({ type: 'STOP', playerId: 0 });
        deathNote?.classList.add('show');
        later(() => deathNote?.classList.remove('show'), 5200); // Doubled (it.50).
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

    const respawnPlayer = (): void => {
      player.warpTo(world.dungeon.spawn.x + 0.5, world.dungeon.spawn.y + 0.5);
      player.hp = player.hpMax;
      player.action = 'idle';
      world.lighting.updateVisibility(world.dungeon.spawn.x, world.dungeon.spawn.y);
      minimap.markDirty();
      updateOrb();
    };

    // --- Loop ---------------------------------------------------------------
    const cameraFocus = vec2();
    const pickRingScratch = vec2();
    let lastRenderTime = performance.now();

    // ERROR BOUNDARY (it.37): an exception inside a tick or a frame must
    // never kill the rAF loop (that was a silent freeze). Report the first
    // few, keep running.
    let loopErrors = 0;
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

        state.forEach((entity) => entity.beginTick());
        const commands = inputQueue.drain();
        world.movement.applyCommands(commands);
        world.combat.applyCommands(commands);
        inventorySystem.apply(commands);
        skills.apply(commands); // Hotkeys 1–4 (it.32).
        town.apply(commands); // Buy / sell / stash (it.39).
        if (world.town) handleTownInteraction(commands);
        for (const cmd of commands) {
          if (cmd.type !== 'TOWN_PORTAL') continue;
          // FREE TOWN PORTAL (it.43): T opens the way home on a 12 s cooldown.
          if (world.town) world.dmgText.show(player.pos.x, player.pos.y - 1, 'YOU ARE HOME', 'miss');
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
        world.movement.update(dt);
        world.combat.update();
        skills.update();
        if (++sheetClock % 60 === 0) charSheetUI.tick();
        world.projectiles.update(dt);
        state.forEach((entity) => entity.update(dt));
        world.enemies.separate();

        // Player death animation runs to completion, then the death overlay
        // takes over (it.36) — the loop freezes until a choice is made.
        if (player.action === 'dead') {
          player.actionTicks++;
          if (player.actionTicks >= PLAYER_DEATH_TICKS && !runMenus.isDeathShown) {
            runMenus.showDeath(
              `Depth ${ROMAN[floor - 1] ?? floor} · level ${player.level} · ${formatTime(state.tick)} in the dark`,
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

        // GOLD PICKUP (it.22): walking over a pile scoops it up.
        for (const pile of world.goldPiles) {
          if (pile.taken) continue;
          if (Math.hypot(player.pos.x - pile.x, player.pos.y - pile.y) < 0.75) {
            pile.taken = true;
            // DESTROY, don't hide (it.26): destroyed sprites stay gone.
            pile.sprite.destroy();
            pile.glow.destroy();
            player.gold += pile.amount;
            player.goldCollected += pile.amount;
            audio.sfx('gold');
            world.ambience.sparks(pile.x, pile.y, 0, 0, 6, 0xffd870);
            world.dmgText.show(pile.x, pile.y, `+${pile.amount} gold`, 'crit');
            updateProgressHud();
          }
        }

        // PROXIMITY TRIGGER (it.19): TOUCHING the staircase starts the descent.
        const stairsDist = Math.hypot(
          player.pos.x - (world.stairs.x + 0.5),
          player.pos.y - (world.stairs.y + 0.5),
        );
        // INSTANT ARENA TELEPORT (it.29): stepping inside the boss chamber's
        // room bounds seizes the player — immediate fade-teleport.
        if (player.action !== 'dead' && world.arenaThreshold && !transitioning) {
          const t = world.arenaThreshold;
          const px = Math.floor(player.pos.x);
          const py = Math.floor(player.pos.y);
          if (px >= t.x && px < t.x + t.w && py >= t.y && py < t.y + t.h) {
            pendingArena = true;
          }
        }

        // Town portal home → back through the rift (armed once the hero steps off it).
        if (world.town && portalReturn && !transitioning) {
          const pt = world.town.layout.portal;
          const d = Math.hypot(player.pos.x - (pt.x + 0.5), player.pos.y - (pt.y + 0.5));
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
            world.stairs.sprite.renderable = true;
            world.lighting.registerProp(world.stairs.x, world.stairs.y, world.stairs.sprite);
            world.ambience.burst(world.stairs.x + 0.5, world.stairs.y + 0.5, 0xffd9a0, 20);
            tutorial.notify('arenaopen', 'Nothing left breathes here. The way down opens.');
          }
        }

        // The town gate opens on CONTACT (it.44): touching the archway's front tile descends at once.
        const gateReach = world.town ? 1.05 : 0.8;
        if (player.action !== 'dead' && stairsDist < gateReach) {
          if (!world.isArena && floor > 0 && isBossFloor(floor)) {
            pendingArena = true; // Fallback portal (the seal itself).
          } else if (world.isArena && !world.arenaCleared) {
            tutorial.notify('bossgate', 'The arena is sealed. Nothing leaves while anything inside still breathes.');
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
        const frameDt = Math.min((now - lastRenderTime) / 1000, 0.1);
        lastRenderTime = now;
        const timeSec = now / 1000;

        state.forEach((entity) => entity.syncRender(alpha));
        lerpVec(cameraFocus, player.prevPos, player.pos, alpha);

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
          const t = p.life / 1.5;
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
        world.playerHalo.alpha = 0.3 + Math.sin(timeSec * 3.1) * 0.05;
        if (timerLabel) timerLabel.textContent = formatTime(state.tick - floorStartTick);

        // Proximity prompt: an "E — OPEN" chip floats over a nearby chest —
        // or, in town, over the stall / stash / gate / portal (it.39).
        const nearChest = world.town ? null : world.chests.findNearestUnopened(player.pos.x, player.pos.y, 2.2);
        const townPrompt = world.town ? nearestTownPrompt() : null;
        world.town?.setPromptAt(townPrompt ? townPrompt.x : null, townPrompt?.y);
        if (interactHint && townPrompt) {
          const p = world.camera.worldToCanvas(townPrompt.x, townPrompt.y, pickRingScratch);
          interactHint.style.left = `${Math.round(p.x)}px`;
          interactHint.style.top = `${Math.round(p.y - townPrompt.lift)}px`;
          interactHint.innerHTML = townPrompt.html;
          interactHint.classList.remove('dim');
          interactHint.classList.add('show');
        } else if (
          interactHint &&
          nearChest &&
          world.lighting.isVisible(Math.floor(nearChest.x), Math.floor(nearChest.y))
        ) {
          interactHint.innerHTML = '<kbd>E</kbd> OPEN';
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
        // The hero sits in the same lighting language as the world.
        player.setSceneTint(world.lighting.getTintAt(player.pos.x, player.pos.y, 0.7));
        player.setShadowLight(world.lighting.lightDirAt(player.pos.x, player.pos.y));

        if (world.town) {
          const t = world.town;
          t.villagers.update(frameDt, (x, y) => world.lighting.getTintAt(x, y, 0.8));
          t.campHeroes.update((x, y) => world.lighting.getTintAt(x, y, 0.7));
          t.update(frameDt);
          const heroTx = Math.floor(player.pos.x);
          const heroTy = Math.floor(player.pos.y);
          // ROOF CUTAWAY (it.39): a cottage or tree the hero stands behind fades
          // so the body never disappears under a roof.
          const hs = worldToScreen(cameraFocus.x, cameraFocus.y, pickRingScratch);
          const heroDepth = (cameraFocus.x + cameraFocus.y) * 16;
          const k = 1 - Math.exp(-12 * frameDt);
          for (const o of t.occluders) {
            const spr = o.sprite;
            const w = spr.width;
            const h = spr.height;
            const left = spr.position.x - w * spr.anchor.x + w * 0.12;
            const right = left + w * 0.76;
            const top = spr.position.y - h * spr.anchor.y;
            const bottom = top + h * 0.9;
            const behind = o.depth > heroDepth && hs.x > left && hs.x < right && hs.y - 30 > top && hs.y - 30 < bottom;
            // INSIDE (it.40): standing in a cottage's door column — the roof
            // and front wall drop to a ghost so the room reads.
            const inside = heroTx >= o.tiles.x && heroTx < o.tiles.x + o.tiles.w && heroTy >= o.tiles.y && heroTy < o.tiles.y + o.tiles.h;
            const target = inside ? 0.2 : behind ? 0.38 : 1;
            spr.alpha += (target - spr.alpha) * k;
          }
          if (t.stashSprite && spriteLib.hasSingle('stash_open')) {
            t.stashSprite.texture = spriteLib.single(stashUI.isOpen ? 'stash_open' : 'stash_closed');
          }
        }

        // Target ring: pulsing bracket under the foe the player is striking.
        const target = world.combat.getDisplayTarget();
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
            if (bossHpEl) bossHpEl.textContent = boss.action === 'transition' ? 'RISING' : `${Math.max(0, Math.ceil(boss.hp))} / ${boss.hpMax}`;
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
        minimap.update(cameraFocus.x, cameraFocus.y, timeSec);
        world.camera.follow(cameraFocus, frameDt);
        app.renderer.render(app.stage);
      }
    }

    // --- Pause / death menus (it.36) -----------------------------------------
    // --- Town panels + interaction (it.39) ------------------------------------
    const shopUI = new ShopUI(player, town, inputQueue);
    const stashUI = new StashUI(player, town, inputQueue);
    const skillTreeUI = new SkillTreeUI(player, inputQueue, () => !!world.town);
    const charSheetUI = new CharacterSheetUI(player);
    const bestiaryUI = new BestiaryUI(player);
    // DUNGEON RECORDS (it.48): the board's tallies come straight from the run.
    const statsUI = new StatsBoardUI(() => {
      let kills = 0;
      let bosses = 0;
      for (const [kind, v] of player.bestiary) {
        kills += v.killed;
        if (kind.startsWith('boss')) bosses += v.killed;
      }
      return { kills, bosses, gold: player.goldCollected, deepest: deepestFloor, playtimeTicks: playtimeBase + state.tick };
    });
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
    const interactableDist = (it: Interactable): number => {
      let best = Infinity;
      for (const tile of it.tiles) best = Math.min(best, Math.hypot(player.pos.x - (tile.x + 0.5), player.pos.y - (tile.y + 0.5)));
      return best;
    };
    const openInteractable = (it: Interactable): void => {
      if (it.kind === 'merchant') shopUI.open('armorer');
      else if (it.kind === 'alchemist') shopUI.open('alchemist');
      else if (it.kind === 'board') statsUI.open();
      else stashUI.open();
    };
    /** E in town / a click on the stall or stash: walk up, then open. */
    function handleTownInteraction(commands: ReadonlyArray<InputCommand>): void {
      const t = world.town;
      if (!t) return;
      for (const cmd of commands) {
        if (cmd.type === 'PICKUP_NEAREST') {
          // SYMMETRICAL E (it.41): an open trade / stash window closes on the same key.
          if (shopUI.isOpen || stashUI.isOpen || statsUI.isOpen) {
            shopUI.close();
            stashUI.close();
            statsUI.close();
            continue;
          }
          // E at the portal stone or the gate takes it (no need to step in).
          if (portalReturn && !transitioning) {
            const pt = t.layout.portal;
            if (Math.hypot(player.pos.x - (pt.x + 0.5), player.pos.y - (pt.y + 0.5)) < 1.8) {
              returnThroughPortal();
              continue;
            }
          }
          if (!transitioning && Math.hypot(player.pos.x - (t.layout.gate.x + 0.5), player.pos.y - (t.layout.gate.y + 0.5)) < 2.2) {
            pendingDescend = true;
            continue;
          }
          let best: Interactable | null = null;
          let bestD = 2.1;
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
          pendingInteract = it.id;
          // Walk to the nearest walkable tile beside the footprint.
          let goal: { x: number; y: number } | null = null;
          let goalD = Infinity;
          for (const tile of it.tiles) {
            for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const gx = tile.x + ox;
              const gy = tile.y + oy;
              if (!world.scene.isWalkable(gx, gy)) continue;
              const d = Math.hypot(player.pos.x - (gx + 0.5), player.pos.y - (gy + 0.5));
              if (d < goalD) {
                goalD = d;
                goal = { x: gx, y: gy };
              }
            }
          }
          if (goal) world.movement.applyCommands([{ type: 'MOVE_TO', playerId: 0, gx: goal.x, gy: goal.y }]);
        }
      }
      if (pendingInteract !== null) {
        const it = t.interactables.find((i) => i.id === pendingInteract);
        if (!it) pendingInteract = null;
        else if (interactableDist(it) <= 1.9) {
          pendingInteract = null;
          openInteractable(it);
        }
      }
    }
    /** The nearest town prompt within reach: stall / stash / gate / portal. */
    const nearestTownPrompt = (): { x: number; y: number; html: string; lift: number } | null => {
      const t = world.town;
      if (!t) return null;
      let best: { x: number; y: number; html: string; lift: number } | null = null;
      let bestD = 2.6;
      for (const it of t.interactables) {
        const d = interactableDist(it);
        if (d < bestD) {
          bestD = d;
          best = { x: it.x, y: it.y, html: `<kbd>E</kbd> ${it.label.replace('E · ', '')}`, lift: it.kind === 'merchant' || it.kind === 'alchemist' ? 96 : it.kind === 'board' ? 70 : 54 };
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
        loop.stop();
        saveNow(); // Autosave on pause (it.39).
      },
      resume: () => {
        inputQueue.clear(); // Keys mashed while paused never replay.
        lastRenderTime = performance.now();
        loop.start();
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
    });

    if (!world.town) audio.setMusic('dungeon');
    audio.playIntroSting();
    loop.start();

    // Dev-only debug handle for console inspection and automated testing.
    // `travel(floor, arena)` rebuilds a floor WITHOUT the fade timers (hidden
    // tabs throttle timers to once a minute — deterministic QA needs a
    // promise, not a setTimeout chain).
    if (import.meta.env.DEV) {
      const devTravel = async (target: number, arena = false): Promise<void> => {
        const dest = Math.max(0, Math.min(target, MAX_DEPTH));
        const mode: FloorMode = dest === 0 ? 'hub' : arena && isBossFloor(dest) ? 'arena' : 'normal';
        await preloadFloor(dest, mode);
        if (!world.town) captureFloor();
        if (!swapWorld(() => buildWorld(dest, mode))) return;
        floor = dest;
        deepestFloor = Math.max(deepestFloor, floor);
        if (mode === 'hub') enterTown(false);
        updateDepth();
        floorStartTick = state.tick;
        player.action = 'idle';
        levelSelect.unlock(floor);
        updateOrb();
      };
      Object.defineProperty(window, '__game', {
        configurable: true,
        get: () => ({ state, player, loop, audio, skills, sprites: spriteLib, runMenus, travel: devTravel, townSystem: town, shopUI, stashUI, saveNow, portalReturn, floors, ...world, floor }),
      });
    }

    return {
      archetype: chosenClass,
      slot,
      stash: () => ({ items: [...town.stash.items], gold: town.stash.gold }),
      save: saveNow,
      returnToTown: () => {
        victoryShown = false;
        withFade(async () => {
          await preloadFloor(0, 'hub');
          if (!world.town) captureFloor();
          if (!swapWorld(() => buildWorld(0, 'hub'))) return;
          enterTown(false);
        });
      },
      destroy: () => {
        if (!alive) return;
        alive = false;
        loop.stop();
        shopUI.destroy();
        stashUI.destroy();
        statsUI.destroy();
        hudBuffs.remove();
        headBuffs.remove();
        vignetteEl?.classList.remove('hurt');
        tpButton.remove();
        skillTreeUI.destroy();
        charSheetUI.destroy();
        bestiaryUI.destroy();
        for (const off of undrag) off();
        for (const id of timers) clearTimeout(id);
        timers.clear();
        for (const off of subs) off();
        ac.abort();
        runMenus.destroy();
        cheatMenu.destroy();
        levelSelect.destroy();
        inventoryUI.destroy();
        minimap.destroy();
        tutorial.destroy();
        destroyWorld(world);
        player.destroy();
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
    (window as unknown as { __menu: unknown }).__menu = { beginRun, exitToMenu, restartRun, mainMenu, settings };
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
  if (mode === 'hub') return ['folk_walk', 'merchant_walk', 'poacher_idle', 'campfire', 'torch', 'knight_idle', 'mage_idle', 'ranger_idle', 'rogue_idle', ...VFX_ANIMS];
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
      ? ['fallen', 'skeleton', 'skeleton', 'zombie', 'archer', 'ahoul', 'ahoul', 'orc', 'orc']
      : floor <= 5
        ? ['fallen', 'skeleton', 'zombie', 'archer', 'guard', 'guard', 'ahoul', 'shaman', 'orc', 'poacher']
        : floor <= 9
          ? ['skeleton', 'zombie', 'archer', 'guard', 'wolf', 'wolf', 'ahoul', 'shaman', 'shaman', 'graveGuard', 'shambler', 'shambler', 'orc', 'poacher']
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
): void {
  const rand = mulberry32(seed ^ 0x5e5e5e5e);
  const kindPool = kindPoolFor(floor);
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
      if (skip.has(index)) continue;
      const enemy = enemies.spawn(kind, gx + 0.5, gy + 0.5, level);
      enemy.spawnIndex = index;
    }
  }
}

boot().catch((err) => {
  console.error('[boot] Fatal initialization error:', err);
});
