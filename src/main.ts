/**
 * @module main
 * Application bootstrap and per-floor world construction.
 *
 * PERSISTENT across floors: the Pixi app, the Player (stats, inventory,
 * paperdoll), the InputQueue, the DOM HUD, and the GameLoop.
 * PER-FLOOR (rebuilt by `buildWorld`): dungeon, viewport/camera, lighting,
 * ambience, props, loot, pathfinder, movement/combat/projectiles/enemies,
 * and input bindings. Stepping onto the stairs tears the old world down and
 * descends to a deeper, harder floor (seed derived from the base seed).
 */

import { Application } from 'pixi.js';
import { assets } from '@/core/AssetManager';
import { MAP_H, MAP_W, MAX_DEPTH, PALETTE } from '@/core/config';
import { eventBus } from '@/core/EventBus';
import { GameLoop } from '@/core/GameLoop';
import { InputBindings } from '@/core/InputBindings';
import { InputQueue } from '@/core/InputQueue';
import { state } from '@/core/StateManager';
import { Ambience } from '@/engine/Ambience';
import { Camera } from '@/engine/Camera';
import { Lighting } from '@/engine/Lighting';
import { Viewport } from '@/engine/Viewport';
import { Enemy, PHASE_DIE_TICKS, PHASE_RISE_TICKS, type EnemyKind } from '@/entities/Enemy';
import { EnemyPool } from '@/entities/EnemyPool';
import { Player } from '@/entities/Player';
import { TILE_BLOCKED, TILE_FLOOR, generateArenaMap, generateDungeon, planHearths, type DungeonMap } from '@/scenes/DungeonGenerator';
import { SkillSystem } from '@/systems/Skills';
import type { ClassArchetype } from '@/network/Serialization';
import type { GoldPile } from '@/scenes/Props';
import { placeProps, placeStairs, placeWaystone } from '@/scenes/Props';
import { SceneManager } from '@/scenes/SceneManager';
import { CombatSystem } from '@/systems/Combat';
import { InventorySystem } from '@/systems/Inventory';
import { LootSystem } from '@/systems/Loot';
import { MovementSystem } from '@/systems/Movement';
import { Pathfinder } from '@/systems/Pathfinding';
import { ProjectileSystem } from '@/systems/Projectiles';
import { StateSyncSystem } from '@/systems/StateSync';
import { audio } from '@/engine/AudioManager';
import { InventoryUI } from '@/ui/Inventory';
import { LevelSelectUI } from '@/ui/LevelSelect';
import { SettingsUI } from '@/ui/Settings';
import { MinimapUI } from '@/ui/Minimap';
import { TutorialUI } from '@/ui/Tutorial';
import { Container, Sprite } from 'pixi.js';
import type { Entity } from '@/entities/Entity';
import { ARCHETYPES, PLAYER_DEATH_TICKS } from '@/entities/Player';
import { ITEMS, overlayTextureFor, statLine } from '@/items/catalog';
import type { EquipmentSlot } from '@/network/Serialization';
import { DamageTextSystem } from '@/render/DamageText';
import { spriteLib, weaponIconUrl, type AnimName } from '@/render/SpriteLibrary';
import { ChestSystem } from '@/systems/Chests';
import { CheatMenuUI } from '@/ui/CheatMenu';
import { itemIconDataUrl } from '@/ui/itemIcons';
import { ATTACK_RANGE } from '@/systems/Movement';
import { lerpVec, vec2 } from '@/utils/Vec2';
import { worldToScreen } from '@/utils/iso';
import { mulberry32, randInt } from '@/utils/rng';

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
  /** The floor's boss (every 5th depth) — stairs stay barred while it lives. */
  boss: Enemy | null;
  bossSeen: boolean;
  unsubscribe: () => void;
}

const ROMAN = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
];

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

  // CURSOR FIRST (it.25 freeze fix): the gothic pointer is injected BEFORE
  // the long asset load, so it exists during the loading screen and from
  // the very first frame after a post-victory reload — the "cursor stops
  // working after the boss floor" was the system pointer showing on a
  // style-less loading screen. Also drawn ~15% smaller for precision.
  installCursor(app.canvas);

  // --- Persistent services --------------------------------------------------
  assets.init(app.renderer);

  // External art packs (knight, skeleton, stone floors, glint, gold, UI).
  // A failed load degrades gracefully to the procedural placeholder art.
  const loadingOverlay = document.getElementById('loading');
  try {
    await spriteLib.load(app.renderer);
    // ONE environment pipeline (it.17 revert): the proven stone set for all
    // depths; the bands are subtle tints baked inside buildStoneEnvironment.
    assets.buildStoneEnvironment(spriteLib.single('ground_stone'));
  } catch (err) {
    console.warn('[boot] Asset packs unavailable — using procedural art.', err);
  }
  loadingOverlay?.classList.add('done');

  // PROPER ARPG CURSOR (it.16): a hand-pixeled gothic pointer — obsidian
  // outline, plated-steel body with row shading, gold trim edge. Crisp at
  // 2× nearest-neighbor, hotspot at the tip. (The rotated-blade experiment
  // is gone; no cursor pack exists in assets, so this is drawn to match
  // the oubliette pixel-art language.)
  // (Cursor already installed at boot start — see installCursor.)

  const inputQueue = new InputQueue();

  const seedParam = new URLSearchParams(location.search).get('seed');
  const baseSeed = seedParam !== null ? Number(seedParam) >>> 0 : (Date.now() ^ 0x9e3779b9) >>> 0;

  // CLASS SELECTION (it.32/33): a clean pre-run screen — four archetypes,
  // four bodies, four skill sets, LIVE ANIMATED PREVIEWS of each hero.
  // `?class=` bypasses it (tests/links).
  const PREVIEW_IDLE: Record<ClassArchetype, AnimName> = {
    warrior: 'knight_idle',
    mage: 'mage_idle',
    ranger: 'ranger_idle',
    rogue: 'rogue_idle',
  };
  /** South-facing idle frames, alpha-cropped to the painted body so every
   *  hero previews at the SAME height regardless of pack padding. */
  const classPreviewFrames = (cls: ClassArchetype): HTMLCanvasElement[] => {
    if (!spriteLib.loaded || !spriteLib.hasAnim(PREVIEW_IDLE[cls])) return [];
    const anim = spriteLib.anim(PREVIEW_IDLE[cls]);
    const out: HTMLCanvasElement[] = [];
    for (let f = 0; f < anim.frameCount; f++) {
      const spr = new Sprite(anim.frames[6][f]); // Facing S.
      const raw = app.renderer.extract.canvas(spr) as HTMLCanvasElement;
      spr.destroy();
      const ctx = raw.getContext('2d');
      if (!ctx) continue;
      // Alpha-scan the painted bounds.
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
    return out;
  };
  const pickClass = (): Promise<ClassArchetype> => {
    const valid = ['warrior', 'mage', 'ranger', 'rogue'] as const;
    const param = new URLSearchParams(location.search).get('class');
    if (param && (valid as readonly string[]).includes(param)) {
      return Promise.resolve(param as ClassArchetype);
    }
    return new Promise((resolve) => {
      const overlay = document.getElementById('class-select');
      overlay?.classList.add('show');
      const timers: number[] = [];
      overlay?.querySelectorAll('.class-card').forEach((card) => {
        const cls = (card as HTMLElement).dataset.class as ClassArchetype;
        // Live animated model preview atop each card (it.33).
        const frames = classPreviewFrames(cls);
        if (frames.length > 0) {
          const cv = document.createElement('canvas');
          cv.className = 'cc-preview';
          cv.width = 96;
          cv.height = 116;
          card.insertBefore(cv, card.firstChild);
          const cctx = cv.getContext('2d')!;
          let fi = 0;
          const draw = (): void => {
            cctx.clearRect(0, 0, cv.width, cv.height);
            cctx.drawImage(frames[fi % frames.length], 0, 0);
            fi++;
          };
          draw();
          timers.push(window.setInterval(draw, 200));
        }
        card.addEventListener('click', () => {
          overlay.classList.remove('show');
          timers.forEach((t) => clearInterval(t));
          audio.sfx('equip');
          resolve(cls);
        });
      });
    });
  };
  const chosenClass = await pickClass();

  const player = new Player(chosenClass);
  state.register(player);
  // Starter kit fits the trade (it.32): the class's basic arms.
  if (chosenClass === 'ranger') player.addItem('short_bow');
  else if (chosenClass !== 'mage') player.addItem('rusty_sword');
  if (spriteLib.loaded) player.enableKnightRig(); // The class body replaces the crystal.

  /**
   * Live ANIMATED paperdoll (it.15): a set of idle-animation frames of the
   * actual in-world hero (armor tint + item-colored slot gems baked into
   * each frame). InventoryUI cycles them — the menu character breathes.
   */
  const PREVIEW_SLOTS: readonly EquipmentSlot[] = ['cloak', 'legs', 'torso', 'head', 'offHand', 'mainHand'];
  const buildPaperdollFrames = (): HTMLCanvasElement[] => {
    const buildRig = (bodyTexIndex: number): HTMLCanvasElement => {
      const rig = new Container();
      if (spriteLib.loaded) {
        const body = new Sprite(spriteLib.frame('knight_idle', 6, bodyTexIndex)); // Facing S.
        body.anchor.set(0.5, 0.8);
        body.tint = player.getEquipmentTint();
        body.scale.set(1.35);
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
      const canvas = app.renderer.extract.canvas(rig) as HTMLCanvasElement;
      rig.destroy({ children: true });
      return canvas;
    };
    if (!spriteLib.loaded) return [buildRig(0)];
    const idle = spriteLib.anim('knight_idle');
    const frames: HTMLCanvasElement[] = [];
    for (let f = 0; f < idle.frameCount; f += 2) frames.push(buildRig(f));
    return frames;
  };

  const inventorySystem = new InventorySystem(player);
  const stateSync = new StateSyncSystem(inputQueue);
  new InventoryUI(player, inputQueue, 0, buildPaperdollFrames);
  const tutorial = new TutorialUI();
  const minimap = new MinimapUI();
  new SettingsUI();

  // AUDIO UNLOCK (browser autoplay policy): the first gesture builds the
  // Web Audio graph, plays the mystic REVEAL sting, then loops the BGM.
  const unlockAudio = (): void => audio.unlock();
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  // `?depth=N` starts on a deeper floor (debug/testing convenience).
  const depthParam = Number(new URLSearchParams(location.search).get('depth'));
  let floor =
    Number.isFinite(depthParam) && depthParam >= 1 ? Math.min(Math.floor(depthParam), MAX_DEPTH) : 1;
  let pendingDescend = false;
  let pendingArena = false;
  let victoryShown = false;

  /** Cheat state survives floor transitions (worlds are rebuilt). */
  const cheatState = { god: false };

  // --- HUD refs -------------------------------------------------------------
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
  const updateProgressHud = (): void => {
    if (levelLabel) levelLabel.textContent = `LVL ${player.level}`;
    if (xpFill) xpFill.style.width = `${Math.round((player.xp / player.xpToNext()) * 100)}%`;
    if (goldLabel) goldLabel.textContent = `${player.gold}`;
  };

  const updateOrb = (): void => {
    const frac = Math.max(0, player.hp / player.hpMax);
    if (orbFill) orbFill.style.height = `${Math.round(frac * 100)}%`;
    if (orbLabel) orbLabel.textContent = `${player.hp}`;
    orb?.classList.toggle('low', frac < 0.3 && frac > 0);
  };
  const updateDepth = (): void => {
    if (depthLabel) depthLabel.textContent = `DEPTH ${ROMAN[floor - 1] ?? floor}`;
  };
  updateOrb();
  updateDepth();
  updateProgressHud();

  // --- Floor run timer ------------------------------------------------------
  const timerLabel = document.getElementById('timer');
  const descendSub = document.getElementById('descend-sub');
  let floorStartTick = 0;
  const formatTime = (ticks: number): string => {
    const totalSec = Math.floor(ticks / 60);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  eventBus.on('input:modeChanged', ({ mode }) => {
    rowMove?.classList.toggle('active', mode === 'path');
    rowDirect?.classList.toggle('active', mode === 'direct');
  });

  // --- Per-floor world construction ----------------------------------------
  const buildWorld = (floorNum: number, mode: 'normal' | 'arena' = 'normal'): World => {
    const isArena = mode === 'arena';
    const seed = ((baseSeed + floorNum * 7919) ^ (isArena ? 0xa11e4a : 0)) >>> 0;
    state.dungeonSeed = seed;
    // STRUCTURAL REVERT (it.15, user-directed): every depth uses the same
    // clean layout rules as floors 1–2 — depth identity comes from the
    // palette/tileset bands and prop dressing, not from layout gimmicks.
    // BOSS ARENAS (it.28): boss floors funnel into a dedicated sealed hall —
    // one vast open room, ringed by candelabra fire, no internal clutter.
    const dungeon = isArena ? generateArenaMap(30, 22, seed) : generateDungeon(MAP_W, MAP_H, seed);
    // Solid hearth props claim their tiles BEFORE anything reads the grid —
    // collision, pathing, rendering and prop placement all agree (it.16).
    let hearths: Array<{ x: number; y: number }>;
    if (isArena) {
      // Decorated ring: burning candelabras at the corners and edge midpoints.
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
    lighting.build(dungeon.width, dungeon.height, (gx, gy) => scene.isOpaque(gx, gy));
    // Theme bands: 1–2 stone crypts · 3–9 buried temple · 10–14 frozen
    // halls · 15–20 ember depths. Each band reads distinct at a glance.
    const theme = !spriteLib.loaded
      ? 'stone'
      : floorNum <= 2
        ? 'stone'
        : floorNum <= 9
          ? 'temple'
          : floorNum <= 14
            ? 'frost'
            : 'ember';
    scene.build(dungeon, viewport, lighting, theme);
    audio.setBgmDeep(floorNum >= 10); // The deep bands breathe a darker drone.
    // Boss arena music (it.28): the floor's intense track fades in the
    // moment the arena builds — and back to the dungeon BGM when we leave.
    audio.setBossMusic(isArena, floorNum);

    const ambience = new Ambience(viewport);
    if (spriteLib.loaded) ambience.setGlintFrames(spriteLib.anim('glint').frames[0]);
    const goldPiles = placeProps(dungeon, viewport, lighting, ambience, hearths);
    // Arena stairs sit at the hall's far east end and stay HIDDEN until
    // every combatant inside the seal is dead.
    // BOSS FLOORS (it.29): NO stairs on the base floor at all — the
    // farthest room IS the boss chamber threshold: a crimson seal burns at
    // its heart, and stepping anywhere inside the room instantly teleports
    // into the arena. No ladder to find, no tile to click.
    const arenaRoom = dungeon.rooms[0];
    const isPortalFloor = !isArena && isBossFloor(floorNum);
    let arenaThreshold: World['arenaThreshold'] = null;
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
      stairs = { x: gx, y: gy, sprite: seal };
    } else {
      stairs = placeStairs(
        dungeon,
        viewport,
        lighting,
        isArena
          ? { hidden: true, at: { x: arenaRoom.x + arenaRoom.w - 3, y: arenaRoom.y + Math.floor(arenaRoom.h / 2) } }
          : undefined,
      );
    }

    const loot = new LootSystem(viewport, seed);
    const chests = new ChestSystem(viewport, lighting, loot, seed);
    if (!isArena) chests.place(dungeon, [stairs]); // The arena floor stays clean.
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
      if (packSprite && spriteLib.loaded && spriteLib.hasAnim(packSprite.walk)) {
        const anim = spriteLib.anim(packSprite.death);
        const frames = anim.frames[enemy.renderDir] ?? anim.frames[0];
        const corpse = new Sprite(frames[frames.length - 1]);
        corpse.anchor.set(0.5, packSprite.anchorY);
        corpse.scale.set(packSprite.scale);
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
            // Ember Warden lobs fire bolts; archers loose plain arrows.
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
    if (isArena) {
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
      spawnFloorEnemies(dungeon, enemies, floorNum, stairs, seed);
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

    // Floor-1 tutorial anchors: waystone + proximity hints.
    if (floorNum === 1) {
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
      // rendered sprite (texture × rig scale × anchor via clickBox) instead
      // of one fixed 22×68 family box — so a click on any part of the
      // visible body (torso, head, a towering boss's chest) registers, and
      // never lands "below" the model.
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
    const pickChest = (canvasX: number, canvasY: number): number | null =>
      chests.pickAtCanvas(canvasX, canvasY, camera);
    const input = new InputBindings(app.canvas, camera, inputQueue, 0, scene.isWalkable, pickEnemy, pickItem, pickChest);

    lighting.updateVisibility(Math.floor(player.pos.x), Math.floor(player.pos.y));
    minimap.setWorld(dungeon, lighting, stairs);
    const unsubscribe = eventBus.on('player:tileChanged', ({ gx, gy }) => {
      lighting.updateVisibility(gx, gy);
      minimap.markDirty();
    });

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
      arenaCleared: false,
      arenaThreshold,
      goldPiles,
      targetRing,
      playerHalo,
      dmgText,
      boss,
      bossSeen: false,
      unsubscribe,
    };
  };

  const destroyWorld = (w: World): void => {
    w.unsubscribe();
    w.input.destroy();
    w.projectiles.clear();
    w.enemies.destroyAll();
    player.container.removeFromParent(); // Survives the viewport teardown.
    w.viewport.destroy();
  };

  let world = buildWorld(floor);

  // MOUSE AIM TRACKING (it.33): skills cast toward the cursor's world
  // point — the last known pointer position feeds the aim vector.
  const lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, seen: false };
  app.canvas.addEventListener('pointermove', (e: PointerEvent) => {
    lastMouse.x = e.offsetX;
    lastMouse.y = e.offsetY;
    lastMouse.seen = true;
  });

  // --- ACTIVE SKILLS (it.32): hotkeys 1–4, wired to the CURRENT floor ------
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
    text: (x, y, m, s) => world.dmgText.show(x, y, m, s),
    sfx: (n) => audio.sfx(n as Parameters<typeof audio.sfx>[0]),
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
        const glow = new Sprite(assets.get('glow'));
        glow.anchor.set(0.5);
        glow.blendMode = 'add';
        glow.tint = 0xff8040;
        glow.scale.set(1.3);
        glow.alpha = 0.55;
        glow.position.set(s.x, s.y);
        world.viewport.ambienceLayer.addChild(glow);
        made.push(glow);
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

  // Skill bar DOM: one slot per class skill, cooldown sweep + cost readout.
  const skillSlotEls: Array<{ root: HTMLElement; cd: HTMLElement; num: HTMLElement }> = [];
  {
    const bar = document.getElementById('skill-bar');
    if (bar) {
      skills.skills.forEach((def, i) => {
        const slot = document.createElement('div');
        slot.className = 'skill-slot';
        // Rich hover tooltip (it.33): name, cost, cooldown, description.
        slot.innerHTML =
          `<div class="skill-glyph">${def.glyph}</div>` +
          `<div class="skill-key">${i + 1}</div>` +
          (def.cost > 0 ? `<div class="skill-cost">${def.cost}</div>` : '') +
          `<div class="skill-cd"></div><div class="skill-cd-num"></div>` +
          `<div class="skill-name">${def.name.toUpperCase()}</div>` +
          `<div class="skill-tip"><b>${def.name}</b>` +
          `<span>${def.cost > 0 ? `${def.cost} ${player.resourceName.toLowerCase()} · ` : ''}${Math.round(def.cd / 60)}s cooldown</span>` +
          `<p>${def.hint}</p></div>`;
        bar.appendChild(slot);
        skillSlotEls.push({
          root: slot,
          cd: slot.querySelector('.skill-cd') as HTMLElement,
          num: slot.querySelector('.skill-cd-num') as HTMLElement,
        });
      });
    }
    const label = document.getElementById('resource-label');
    if (label) label.textContent = player.resourceName;
    document.getElementById('resource-fill')?.classList.toggle('stamina', player.resourceName === 'STAMINA');
  }

  const resourceFill = document.getElementById('resource-fill');
  const updateSkillHud = (): void => {
    if (resourceFill) resourceFill.style.width = `${Math.round((player.resource / player.resourceMax) * 100)}%`;
    skills.skills.forEach((def, i) => {
      const el = skillSlotEls[i];
      if (!el) return;
      const cd = skills.cooldowns[i];
      if (cd > 0) {
        el.root.classList.add('cooling');
        el.cd.style.height = `${Math.round((cd / def.cd) * 100)}%`;
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
  const floorFade = document.getElementById('floor-fade');
  let transitioning = false;
  const withFade = (work: () => void): void => {
    if (transitioning) return;
    transitioning = true;
    audio.sfx('stairs');
    floorFade?.classList.add('show');
    setTimeout(() => {
      work();
      setTimeout(() => {
        floorFade?.classList.remove('show');
        transitioning = false;
      }, 140);
    }, 300);
  };

  const descend = (): void =>
    withFade(() => {
      const clearTime = formatTime(state.tick - floorStartTick);
      destroyWorld(world);
      skills.clearZones(); // Firewalls/traps stay in the old world's grave.
      floor++;
      world = buildWorld(floor);
      updateDepth();
      levelSelect.unlock(floor);
      // The run timer resets cleanly on every floor transition.
      floorStartTick = state.tick;
      if (descendSub) descendSub.textContent = `Depth ${ROMAN[floor - 2] ?? floor - 1} delved in ${clearTime}`;
      descendNote?.classList.add('show');
      descendSub?.classList.add('show');
      setTimeout(() => {
        descendNote?.classList.remove('show');
        descendSub?.classList.remove('show');
      }, 2600);
    });

  /**
   * BOSS ARENA TELEPORT (it.28): crossing the boss-floor threshold seizes
   * the player and drops them into the depth's sealed fighting hall — same
   * depth number, dedicated open map, boss music already rising.
   */
  const enterArena = (): void =>
    withFade(() => {
      destroyWorld(world);
      skills.clearZones();
      world = buildWorld(floor, 'arena');
      player.action = 'idle';
      updateOrb();
      world.dmgText.show(player.pos.x + 1.2, player.pos.y - 0.6, 'THE ARENA SEALS SHUT', 'crit');
    });

  /** Level-select jump: fade-covered travel to any unlocked depth. */
  const jumpToFloor = (target: number): void => {
    if (target === floor) return;
    withFade(() => {
      destroyWorld(world);
      skills.clearZones();
      floor = target;
      world = buildWorld(floor);
      updateDepth();
      floorStartTick = state.tick;
      player.action = 'idle';
      updateOrb();
    });
  };

  /**
   * THE ENDING (it.15): the final keeper is dust and the last stair stands
   * open — the screen sinks to black and the epilogue rises. A true close,
   * not a floating banner.
   */
  const runEndgame = (): void => {
    audio.sfx('victory');
    const overlay = document.getElementById('endgame');
    const stats = document.getElementById('endgame-stats');
    if (stats) {
      const totalSec = Math.floor(state.tick / 60);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      stats.textContent = `TWENTY DEPTHS CONQUERED · ${m}:${s.toString().padStart(2, '0')} IN THE DARK · THE HOLLOW KING IS DUST`;
    }
    overlay?.classList.add('show');
    document.getElementById('endgame-again')?.addEventListener('click', () => {
      location.href = location.pathname; // A fresh seed, a fresh descent.
    });
  };
  const levelSelect = new LevelSelectUI(jumpToFloor);
  levelSelect.unlock(floor);

  // --- Cheat menu (F1 / `) --------------------------------------------------
  // Animated idle portrait: pre-extract a handful of knight idle frames as
  // canvases (south-facing, armor-tinted) — the menu animates them itself.
  const portraitFrames: HTMLCanvasElement[] = [];
  if (spriteLib.loaded) {
    const idle = spriteLib.anim('knight_idle');
    for (let f = 0; f < idle.frameCount; f += 2) {
      const spr = new Sprite(idle.frames[6][f]);
      spr.tint = player.getEquipmentTint();
      spr.scale.set(2);
      portraitFrames.push(app.renderer.extract.canvas(spr) as HTMLCanvasElement);
      spr.destroy();
    }
  }
  new CheatMenuUI({
    toggleGod: () => {
      cheatState.god = !cheatState.god;
      world.combat.godMode = cheatState.god;
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
      withFade(() => {
        destroyWorld(world);
        skills.clearZones();
        floor = dest;
        world = buildWorld(floor, arena && isBossFloor(floor) ? 'arena' : 'normal');
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
        iconHtml:
          def.icon && spriteLib.loaded
            ? `<img class="cheat-icon" src="${weaponIconUrl(def.icon)}" alt="">`
            : `<img class="cheat-icon cheat-icon-px" src="${itemIconDataUrl(def)}" alt="">`,
      })),
    portraitFrames: () => portraitFrames,
  });

  // --- Cross-floor event wiring (registered once) ---------------------------
  // Crits emit combat:swing immediately before their entity:damaged — the
  // remembered target id styles that one damage number gold.
  let lastCritTarget = -1;
  eventBus.on('entity:damaged', ({ entityId, amount, dirX, dirY }) => {
    const entity = state.getEntity(entityId);
    if (!entity) return;
    // Visceral directional blood — heavier hits bleed harder.
    world.ambience.bloodSpray(entity.pos.x, entity.pos.y, dirX, dirY, Math.min(18, 7 + amount));
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
    if (entity instanceof Enemy) {
      entity.onDamaged();
      world.camera.addKick(2.5); // Felt on every landed blow.
    } else if (entity === player) {
      player.onDamaged();
      world.camera.addKick(5);
      updateOrb();
      tutorial.notify('hurt', 'You bleed. Their heavy blows are telegraphed — step away as they rear back.');
    }
  });

  eventBus.on('combat:swing', ({ sourceId, targetId, result }) => {
    lastCritTarget = result === 'crit' ? targetId : -1;
    if (result === 'miss') {
      const at = state.getEntity(targetId) ?? state.getEntity(sourceId);
      if (at) world.dmgText.show(at.pos.x, at.pos.y, 'miss', 'miss');
    }
    if (result === 'crit') {
      // "CRIT!" banner floats above where the damage number will appear
      // ((x-0.4, y-0.4) in world space is straight up in screen space).
      const target = state.getEntity(targetId);
      if (target) world.dmgText.show(target.pos.x - 0.4, target.pos.y - 0.4, 'CRIT!', 'crit');
    }
    if (sourceId !== player.id) {
      // Every ENEMY melee strike whooshes at its strike frame (it.21) —
      // ranged foes already sound their bow/bolt at launch. A species
      // attack grunt rides on top (voice-pack 'shouting' pool when live).
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
        world.camera.addKick(4.5);
        world.camera.addShake(0.3);
        if (target) world.ambience.burst(target.pos.x, target.pos.y, 0xffd9a0, 8);
      } else if (result === 'hit' && target) {
        // Steel-on-flesh sparks on every landed blow (particle pass, it.15).
        world.ambience.burst(target.pos.x, target.pos.y, 0xd8c8a0, 3);
      }
    }
  });

  eventBus.on('projectile:impact', ({ x, y, kind, hitFlesh }) => {
    if (hitFlesh) audio.sfx(kind === 'bolt' ? 'boltImpact' : 'arrowHit');
    else if (kind === 'arrow') audio.sfx('arrowWall'); // Clatter off stone.
    if (kind === 'bolt') {
      world.ambience.burst(x, y, 0xffb060, hitFlesh ? 8 : 5);
    } else if (!hitFlesh) {
      world.ambience.puff(x, y); // Arrow clattering off stone.
    }
  });

  // Footstep dust + stone footfalls (render feedback; `world` read at call time).
  player.onStep = (x, y) => {
    world.ambience.puff(x, y);
    audio.sfx('step');
  };

  eventBus.on('item:dropped', ({ itemId, x, y }) => {
    tutorial.notify('loot', 'A treasure has fallen — press E near it, or click to claim it.');
    // Rare finds announce themselves with the pack's treasure glint.
    if (ITEMS[itemId]?.rarity === 'rare') world.ambience.playGlint(x, y);
  });

  // An idle thing in the dark just noticed you (species growl/hiss/moan).
  eventBus.on('enemy:aggro', ({ entityId }) => {
    const entity = state.getEntity(entityId);
    const v = entity instanceof Enemy ? voiceProfile(entity.def.kind) : { pitch: 1, bank: 'hGrunt' };
    audio.enemyVoice('idle', v.pitch, v.bank);
  });

  eventBus.on('chest:reached', ({ chestId }) => world.chests.open(chestId));
  eventBus.on('chest:opened', ({ x, y }) => {
    audio.sfx('chest');
    world.ambience.playGlint(x, y);
    world.camera.addKick(2);
    tutorial.notify('chest', 'The old locks give easily. Take what the dead no longer need.');
  });

  eventBus.on('item:pickupArrived', ({ uid }) => {
    const itemId = world.loot.pickup(uid);
    if (itemId) {
      audio.sfx('pickup');
      player.addItem(itemId);
      tutorial.notify('inv', 'Press I to open your inventory and equip your spoils.');
    }
  });

  eventBus.on('entity:died', ({ entityId }) => {
    const entity = state.getEntity(entityId);
    if (entity instanceof Enemy) {
      // PHASED BOSS (it.30): a form with a nextPhase does not die — its hp
      // pool emptied, so the full death animation plays, the boss goes
      // invincible, and the next form rises. No xp, no loot, no clear.
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
        world.dmgText.show(player.pos.x - 0.4, player.pos.y - 0.4, 'LEVEL UP!', 'crit');
        updateOrb(); // Max HP grew (and partially refilled).
      }
      updateProgressHud();
      if (entity === world.boss) {
        // DRAMATIC BOSS DEATH (it.15): the keeper strobes through its long
        // collapse (Enemy render side) while staged explosions ripple off
        // the body, then the trophies erupt in a loot explosion.
        const bx = entity.pos.x;
        const by = entity.pos.y;
        const w = world; // Capture — the sequence must hit THIS floor's systems.
        w.camera.addKick(9);
        w.camera.addShake(0.55);
        // Eight explosion pulses ride the ~4-second collapse (it.17): blood
        // and fire ripple off the strobing body, growing toward the finale.
        for (let i = 0; i < 8; i++) {
          setTimeout(() => {
            if (world !== w) return; // Floor changed mid-sequence — stand down.
            const spread = 0.8 + i * 0.12;
            w.ambience.bloodSpray(bx + (Math.random() - 0.5) * spread, by + (Math.random() - 0.5) * spread, undefined, undefined, 12 + i * 2);
            w.ambience.burst(bx, by, i % 2 === 0 ? 0xffb060 : 0xd85a3a, 8 + i);
            w.camera.addShake(0.16 + i * 0.02);
          }, 200 + i * 340);
        }
        // The VICTORY BEAT: only after the body burns down to its fade does
        // the treasure erupt — a clear, earned pause before the reward.
        setTimeout(() => {
          if (world !== w) return;
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + 0.5;
            w.loot.dropRareAt(bx + Math.cos(a) * 0.9, by + Math.sin(a) * 0.9);
          }
          w.ambience.playGlint(bx, by);
          w.ambience.burst(bx, by, 0xffd9a0, 20);
          w.camera.addKick(7);
          w.camera.addShake(0.4);
          // (It.28: the gate sound moved to the ARENA CLEAR beat below —
          // the stair only opens once every combatant is down.)
        }, 3300);
        bossNote?.classList.add('show');
        setTimeout(() => bossNote?.classList.remove('show'), 4200);
      } else {
        world.loot.tryDropAt(entity.pos.x, entity.pos.y);
      }
      // Death gore: a heavy radial blowout on top of the directional spray.
      world.ambience.bloodSpray(entity.pos.x, entity.pos.y, undefined, undefined, entity === world.boss ? 34 : 22);
      world.ambience.burst(entity.pos.x, entity.pos.y, 0x7c150c, entity === world.boss ? 18 : 10);
      entity.beginDeath();

      // ARENA CLEAR (it.28): the stair stays hidden until EVERY combatant
      // in the seal — keeper, honor guard, and anything it summoned — is
      // down. Then the way down reveals itself and the war music recedes.
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
          const delay = entity === w.boss ? 3600 : 1100;
          setTimeout(() => {
            if (world !== w) return;
            w.stairs.sprite.renderable = true;
            w.lighting.registerProp(w.stairs.x, w.stairs.y, w.stairs.sprite);
            w.ambience.burst(w.stairs.x + 0.5, w.stairs.y + 0.5, 0xffd9a0, 20);
            w.ambience.playGlint(w.stairs.x + 0.5, w.stairs.y + 0.5);
            w.dmgText.show(w.stairs.x + 0.5, w.stairs.y + 0.2, 'THE WAY OPENS', 'crit');
            audio.sfx('gateOpen');
            audio.setBossMusic(false);
          }, delay);
        }
      }
      return;
    }
    if (entity === player) {
      // The knight falls where he stood (Die sheet plays out), THEN rises
      // again at the entrance — see the death timer in the update loop.
      player.action = 'dead';
      player.actionTicks = 0;
      inputQueue.enqueue({ type: 'STOP', playerId: 0 });
      deathNote?.classList.add('show');
      setTimeout(() => deathNote?.classList.remove('show'), 2600);
    }
  });

  // MULTI-PHASE FINAL BOSS FEEDBACK (it.28): the Hollow King's breaks are
  // theatrical — roar, quake, gore, recolored bar. Sim drives via Enemy.
  eventBus.on('boss:phase', ({ phase }) => {
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
      // It.30: each rebirth is a NEW body rising from the last one's death.
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
    updateOrb();
  };

  // --- Loop -----------------------------------------------------------------
  const cameraFocus = vec2();
  const pickRingScratch = vec2();
  let lastRenderTime = performance.now();

  const loop = new GameLoop({
    update: (dt, tick) => {
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
      world.movement.update(dt);
      world.combat.update();
      skills.update();
      world.projectiles.update(dt);
      state.forEach((entity) => entity.update(dt));
      world.enemies.separate();

      // Player death animation runs to completion before the respawn.
      if (player.action === 'dead') {
        player.actionTicks++;
        if (player.actionTicks >= PLAYER_DEATH_TICKS) respawnPlayer();
      }

      // Stairs: stepping on them schedules the descent — unless the floor's
      // Warden still lives (boss floors bar the way down).
      // COMBAT VOICE HEARTBEAT (it.27): every ~2.5 s one nearby hunter
      // speaks (growl/hiss/moan at its species pitch) — the fight never
      // falls silent for long. Render-only side effect; sim untouched.
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
          // DESTROY, don't hide (it.26): the fog-gated loop anim used to
          // resurrect hidden piles — destroyed sprites stay gone.
          pile.sprite.destroy();
          pile.glow.destroy();
          player.gold += pile.amount;
          audio.sfx('gold');
          world.dmgText.show(pile.x, pile.y, `+${pile.amount} gold`, 'crit');
          updateProgressHud();
        }
      }

      // PROXIMITY TRIGGER (it.19): TOUCHING the staircase starts the descent
      // — no exact tile-center landing, no clicking. The only gate anywhere
      // is a living warden on its own boss floor.
      const stairsDist = Math.hypot(
        player.pos.x - (world.stairs.x + 0.5),
        player.pos.y - (world.stairs.y + 0.5),
      );
      // INSTANT ARENA TELEPORT (it.29): the moment the player steps inside
      // the boss chamber's room bounds, the arena seizes them — no stair,
      // no ladder, no click. Immediate fade-teleport.
      if (player.action !== 'dead' && world.arenaThreshold && !transitioning) {
        const t = world.arenaThreshold;
        const px = Math.floor(player.pos.x);
        const py = Math.floor(player.pos.y);
        if (px >= t.x && px < t.x + t.w && py >= t.y && py < t.y + t.h) {
          pendingArena = true;
        }
      }

      if (player.action !== 'dead' && stairsDist < 0.8) {
        if (!world.isArena && isBossFloor(floor)) {
          // Fallback portal (the seal itself) — threshold normally fires first.
          pendingArena = true;
        } else if (world.isArena && !world.arenaCleared) {
          // The stair is hidden while the seal holds — nothing to touch.
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
    },
    render: (alpha) => {
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
      world.projectiles.updateRender(world.lighting);
      world.chests.updateRender(timeSec);
      world.dmgText.update(frameDt);

      // The hero's warm halo rides his interpolated position, breathing gently.
      const halo = worldToScreen(cameraFocus.x, cameraFocus.y, pickRingScratch);
      world.playerHalo.position.set(halo.x, halo.y - 22);
      world.playerHalo.alpha = 0.3 + Math.sin(timeSec * 3.1) * 0.05;
      if (timerLabel) timerLabel.textContent = formatTime(state.tick - floorStartTick);

      // Proximity prompt: an "E — OPEN" chip floats over a nearby chest.
      const nearChest = world.chests.findNearestUnopened(player.pos.x, player.pos.y, 2.2);
      if (
        interactHint &&
        nearChest &&
        world.lighting.isVisible(Math.floor(nearChest.x), Math.floor(nearChest.y))
      ) {
        const p = world.camera.worldToCanvas(nearChest.x, nearChest.y, pickRingScratch);
        interactHint.style.left = `${Math.round(p.x)}px`;
        interactHint.style.top = `${Math.round(p.y - 64)}px`;
        // COMBAT DIM (it.33): the label fades way back while anything is
        // hunting the player — loot text must never shout over a fight.
        // (It is already pointer-events: none, so it never eats clicks.)
        let inCombat = false;
        world.enemies.forEachActive((e) => {
          if (e.hp > 0 && e.aiState === 'chase') inCombat = true;
        });
        interactHint.style.opacity = inCombat ? '0.25' : '';
        interactHint.classList.add('show');
      } else {
        interactHint?.classList.remove('show');
      }

      // Entity fog gate with a neighbor fallback: a cornered enemy whose
      // center drifts onto an unseen wall tile must NOT vanish (the
      // invisible-when-cornered bug) — any adjacent visible tile keeps it.
      const entityVisible = (x: number, y: number): boolean => {
        const gx = Math.floor(x);
        const gy = Math.floor(y);
        // A creature on a NEVER-SEEN (black) tile is strictly invisible —
        // rendering it there paints it over the void (the halberdier-over-
        // darkness bug). The 8-neighbor fallback only rescues bodies whose
        // tile is EXPLORED terrain (the cornered-archer case).
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
          const tint = world.lighting.getTintAt(enemy.pos.x, enemy.pos.y, 0.5);
          // Own tile unseen (neighbor-visible corner case): dim neutral, not black.
          enemy.setLightTint(tint === 0 ? 0x6b6472 : tint);
        }
      });
      // The hero sits in the same lighting language as the world (generous
      // floor so he never vanishes, but darkness visibly presses in).
      player.setSceneTint(world.lighting.getTintAt(player.pos.x, player.pos.y, 0.7));

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

      // Boss health bar: revealed the first time the Warden is sighted.
      // It.30 phased boss: the bar is PER PHASE — each form owns a fresh
      // 100% pool (no segmented single pool: notches hidden, fill recolored
      // per form). During a transition the emptied bar drains to 0, then
      // visibly refills as the next form rises.
      if (world.boss && (world.boss.hp > 0 || world.boss.action === 'transition')) {
        const boss = world.boss;
        const phased = !!boss.def.nextPhase || boss.phase > 1;
        if (!world.bossSeen && entityVisible(boss.pos.x, boss.pos.y)) {
          world.bossSeen = true;
          audio.sfx('bossHorn'); // The war horn: a keeper has seen you.
          const nameEl = document.getElementById('boss-bar-name');
          if (nameEl) {
            nameEl.textContent =
              `${boss.def.name.toUpperCase()} · LVL ${boss.level}` + (phased ? ` · PHASE ${boss.phase}/3` : '');
          }
        }
        if (world.bossSeen && bossBar && bossBarFill) {
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
            // Dying half: the emptied pool stays at 0. Rising half: the
            // NEXT phase's fresh bar visibly fills with the body.
            pct =
              boss.actionTicks < PHASE_DIE_TICKS
                ? 0
                : Math.min(100, ((boss.actionTicks - PHASE_DIE_TICKS) / PHASE_RISE_TICKS) * 100);
          } else {
            pct = (boss.hp / boss.hpMax) * 100;
          }
          bossBarFill.style.width = `${Math.round(pct)}%`;
        }
      } else {
        bossBar?.classList.remove('show');
      }

      updateSkillHud(); // Cooldown sweeps + resource bar (it.32).
      tutorial.update(cameraFocus.x, cameraFocus.y, frameDt);
      minimap.update(cameraFocus.x, cameraFocus.y, timeSec);
      world.camera.follow(cameraFocus, frameDt);
      app.renderer.render(app.stage);
    },
  });
  loop.start();

  // Dev-only debug handle for console inspection and automated testing.
  if (import.meta.env.DEV) {
    Object.defineProperty(window, '__game', {
      configurable: true,
      get: () => ({ state, player, loop, audio, skills, ...world, floor }),
    });
  }
}

/** Every 5th depth is a warden's crypt: sparse packs + THE BOSS at the stairs. */
export function isBossFloor(floor: number): boolean {
  return floor % 5 === 0;
}

/**
 * Draw + globally enforce the gothic pointer (obsidian blade, gold edge,
 * crimson gem). 1.7× pixels (it.25: slightly smaller for precision) and an
 * injected `*`-rule so no system pointer survives anywhere, ever — the
 * loading screen included.
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

/** Boss ladder + level milestones (it.23/it.28, shared by the arena spawner). */
const BOSS_LADDER: EnemyKind[] = ['boss', 'bossFrost', 'bossEmber', 'bossHollow'];
const BOSS_LEVELS: Record<number, number> = { 5: 7, 10: 13, 15: 18, 20: 25 };

/** Depth-banded rosters (it.14): each band introduces new flesh so no two
 *  stretches of the crypt fight the same. Also feeds arena honor guards. */
function kindPoolFor(floor: number): EnemyKind[] {
  // It.32: the new packs join the rosters — Risen Villagers shuffle through
  // the mid bands; Crimson Hydras stalk the ember depths as elites.
  return floor === 1
    ? ['fallen', 'fallen', 'skeleton', 'skeleton', 'zombie']
    : floor <= 3
      ? ['fallen', 'skeleton', 'skeleton', 'zombie', 'archer', 'ahoul', 'ahoul']
      : floor <= 5
        ? ['fallen', 'skeleton', 'zombie', 'archer', 'guard', 'guard', 'ahoul', 'shaman']
        : floor <= 9
          ? ['skeleton', 'zombie', 'archer', 'guard', 'wolf', 'wolf', 'ahoul', 'shaman', 'shaman', 'graveGuard', 'shambler', 'shambler']
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
): void {
  const rand = mulberry32(seed ^ 0x5e5e5e5e);
  const kindPool = kindPoolFor(floor);
  const bossFloor = isBossFloor(floor);
  const perRoom = bossFloor ? Math.max(1, Math.min(floor, 3) - 1) : Math.min(1 + floor, 4);

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
      enemies.spawn(kind, gx + 0.5, gy + 0.5, level);
    }
  }

}

boot().catch((err) => {
  console.error('[boot] Fatal initialization error:', err);
});
