# STATE ARTIFACT — Crypt of the Hollow King

A persistent tracking document for system health, architecture, audits and the roadmap.
Update it with every iteration that changes a system's shape, a measured number, or a known issue.

- **Project version:** 0.1.0 (iteration 98, 2026-09-08)
- **Branch / deploy:** `main` → GitHub Pages (`gh-pages`), https://illiakomissarov.github.io/isometric-game/
- **Owner:** Illia Komissarov

## 1. Health scorecard

| Metric | Target | Current | Status |
| --- | --- | --- | --- |
| `npm run build` | 0 errors | 0 errors, 0 TypeScript errors | OK |
| Type safety | no `any` | 0 `any` casts in `src/` (strict, `noUnusedLocals`) | OK |
| Console errors (title, run, co-op, transitions) | 0 | 0 in every verified tab | OK |
| Simulation rate | 60 Hz fixed | 60 Hz, render-interpolated, Worker clock when hidden | OK |
| Frame budget | 16.7 ms | scaler steps the buffer 2 → 1.5 → 1 → 0.75x on a rolling 60-frame mean | OK |
| Render cost, depth II desktop | — | `renderer.render` 0.08 ms culled vs 0.14 ms unculled (1,173 world sprites, 48% off-screen); world lighting update ~1 ms | Measured |
| Enemy separation | O(n) | spatial hash, one-tile cells, no per-tick allocation | OK |
| Memory across floors | flat | camera wheel listener leak fixed (it.74); textures freed on rebuild; VFX/projectile/text/burst pools; gore capped at 260 decals | OK |
| Device matrix (33 devices × 2 orientations + 4 browser-bar landscapes) | 74/74 | 74/74 | OK |
| Scripted playthrough (`src/dev/qa75.ts`, 339 checks at it.98) | 0 failures | 339/339 on seed 3 (mage), incl. the cellar errand end to end and the locked and unlocked inn room; 280/280 on seed 42 (warrior, deep) with the eleven-device tutorial sweep; 10 earlier sessions, seeds 1-10, all classes | OK |
| Tick cost, depth III, 35 foes | < 2 ms | 0.21 ms idle, 0.62 ms in combat | Measured |
| Co-op | 4 seats, no desync | leader-authoritative sync at 10 Hz (foes, heroes, loot), snapshot join 3–5 s, guarded seat reclaim, barrier watchdog; four-tab session verified it.77 | OK |
| Bundle | vendor split | `pixi`, `peer`, `index` chunks; sourcemaps on | OK |

## 2. Component relationship matrix

| Component | Depends on | Feeds | Owner rule |
| --- | --- | --- | --- |
| `core/GameLoop` | Worker clock, `Lockstep.canStep` gate | every system's `update`, the render callback | one frame authority; Pixi ticker stopped |
| `core/InputBindings` / `InputQueue` | DOM, `SceneManager.isWalkable` | commands drained once per tick | the only path from DOM to sim |
| `net/Lockstep` | `PeerNet` | merged frames per tick, barrier | intent only; history + snapshot frames |
| `net/StateSync` | `PeerNet`, entity table, `LootSystem` | corrections on peers (foes, heroes, loot) | leader is the authority; host never corrects itself |
| `net/PeerNet` | PeerJS, TURN settings | lobby, frames, snapshots, heartbeat | shape-checks every inbound message |
| `systems/Combat` | seeded RNG, seats, movement | damage events, deaths, XP | sole hp mutator (state sync is the one override) |
| `systems/Skills` / `SkillTree` | player, combat RNG | casts, buffs, cooldowns | learn/unlock via commands only |
| `entities/EnemyPool` / `Enemy` | Pathfinding, Collision, lighting | AI, spawns, phases | ids assigned at pool construction (snapshot id base) |
| `engine/Lighting` | dungeon grid, player tile | per-tile tint, visible set, cutaway | owns sprite `visible` for fog |
| `render/Culling` | viewport, camera | `renderable` on static sprites | never touches entities or `visible` |
| `engine/Camera` | app screen, layout `stageZoom` | world transform | destroyed with its world |
| `core/OrientationManager` | layout viewport, touch detection, settings | CSS custom properties + body classes | the only source of layout truth |
| `ui/FitScaler` | layout | panel scale, `--fit-scale` | legibility floors; scroll past them |
| `items/compare` / `ui/itemTip` | catalog, player equipment | the item card for inventory, shop, stash, forge | pure rows; the caller resolves "yours" |
| `items/instance` / `affixes` / `registry` | catalog, the Raven icons | every derived item definition (`itemDef`), rolls | ids stay strings; stats derive, never store |
| `systems/Crafting` / `ui/CampCrafting` | player pouch, `craft` RNG | salvage, forge, transmute, refine, reinforce | commands only; the panel reads |
| `systems/Town` | `itemDef`, `rollGear`, tick | stock, buyback, restock clock | rolls seeded by (seed, serial) |
| `systems/Status` / `items/effects` | combat, enemy pool | statuses on foes; traits read by the player; marks and tints | pure wounds through `dealDamage`; never a second hp mutator |
| `ui/Codex` / `ui/itemFilter` | every item table | the book; chips, orders and borders on every list | generated from the tables; rows keep their index |
| `ui/TouchControls` / `SystemBar` / `StatusFrame` / `Minimap` | layout, queue, player | commands, HUD | act on pointerup for windows |
| `core/PerformanceScaler` | rAF timing | buffer resolution, `quality`, particle budget, colour grade gate | hysteresis, 2 s cooldown |
| `persist/SaveGame` | player, floors, stash, stats | slots 1–3, co-op slots 11–14 | versioned schema |
| `core/Difficulty` (it.89) | the class screen's pick, the save, the party's start | `Combat.dealDamage` (blows on heroes, tourist hits-to-kill), `Enemy` (life, sight, pace, cadence), the journal | one table; part of the run, never read from a clock or the DOM |
| `ui/Dialogue` + the quest ledger (it.87) | `Villagers` (the gatekeeper), `quests` in the save | choices as promises; the forest errand's states | the sim counts the forest's foes; the panel only speaks |
| `engine/AudioManager` (it.89) | `MusicState` from main, the SFX calls, the bundle under `public/assets/audio` | one music bed and one ambience bed per zone, capped SFX voices | render-side only; `claimVoice` caps 4 a bank, 24 total |
| `tutorial/TutorialSystem` (it.90) | `TutorialHooks` (hero, dummies, panels, viewport, world-to-page), the command stream, `entity:damaged` | the spotlight, arrow, card and chapter overlay; panels opened on cue | render-side only; steps are data; `shouldAutoStart` is the onboarding switch |
| `town/Reclaim` (it.91) | the barricade's sprites, the ambience, a grid-open hook, a camera-focus hook | `GateFx` (a cart aside, carts toppling) and `ReclaimScene` (the letterboxed procession) | render-side only; the grid opens through main's hook on the QUEST tick |

## 3. Audit log and refactoring summary (iteration 74)

Audit scope: disposal paths, listener cleanup, hot-loop allocations, draw submission, texture
filtering, type safety, error boundaries, bundle shape.

| Finding | Severity | Fix |
| --- | --- | --- |
| `Camera` added a `wheel` listener to the canvas per floor build and never removed it; each floor change kept the previous camera, viewport and scene graph alive through the closure | High (leak) | `Camera.destroy()` removes the listener; `destroyWorld` calls it |
| `EnemyPool.separate` copied the active set and tested every pair each tick (O(n²), 780 pairs at 40 foes) | Medium (CPU) | one-tile spatial hash, pairs resolved once by id order, buckets reused |
| Every world sprite was submitted to the batcher every frame regardless of the camera | Medium (CPU/GPU) | `render/Culling.ts`: `renderable = false` outside the screen plus margin, entities kept; writes only on change so Pixi's cached instructions survive |
| Filtered (non-pixel) atlases drawn below 1× shimmered | Low (visual) | `autoGenerateMipmaps` on `linear` atlas sources; pixel-art stays `nearest` |
| Unhandled promise rejections vanished without context | Medium (diagnosability) | global `unhandledrejection` and `error` handlers with a searchable prefix |
| No colour grading; the crypt read flat on bright panels | Low (visual) | `ColorMatrixFilter` (contrast +8%, saturation −6%) on the stage, gated off at the scaler's low rung, a Settings toggle |
| Single 835 KB bundle; Pixi re-downloaded on every deploy | Low (load) | Rollup `manualChunks`: `pixi`, `peer` |
| VFX sprites allocated and destroyed per effect | Low (GC) | pooled (it.73) |
| Type safety | — | 0 `any`; strict mode; no change needed |
| Listener cleanup elsewhere | — | run-scoped UIs use `AbortController`; singletons (settings, audio, save panel) live for the page |

Items examined and left as they are, with reasons:

- **Shadow maps, PCF/VSM, PBR, anisotropy.** The renderer is 2D sprites on Pixi; there are no
  meshes, materials or shadow maps. Lighting is a per-tile lightmap that tints sprites, with
  baked directional floor shadows per sprite. Anisotropic filtering is not exposed by Pixi v8.
- **Bloom.** The atmosphere layer (embers, mist, the hero halo) is already additive; a blur
  pass over it would also blur the damage numbers that share the layer. Not applied.
- **Resolution cap.** `Math.min(devicePixelRatio, 2)` was already in place, with the scaler
  stepping down under load.
- **Fixed-step decoupling.** The loop was already fixed-step with render interpolation.

### Iteration 75 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| Desktop inventory ran off a 639 px window and covered the system bar | Medium (UI) | hangs under the bar, scrolls inside the remaining height |
| Thumb-stick base stayed where last touched; off-screen after rotation on 15 configs | Medium (touch) | base recentres on release |
| Class screen heading clipped on short windows (flex centring overflow) | Medium (UI) | `margin: auto` centring, scroll from the top |
| Same-value DOM writes every frame (clock, hint, boss bar, cooldown text) | Low (CPU) | write only on change |

### Iteration 76 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| Inventory tooltip rendered under the window (z 20 vs 40) | Medium (UI) | the item card sits at z 62 above every window |
| No way to judge an item against the worn piece | Feature | `items/compare.ts` + the shared card: THIS / YOURS rows, deltas, verdict; long press on touch |

### Iteration 77 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| Loot was outside the authority: a drifted peer laid a different item, or none | High (co-op) | drops / pickups ride the sample, keyframes carry the floor's loot; peers lay, replace, sweep |
| A stale seat claim evicted a live player | High (co-op) | a seat whose link answered inside 6 s is never reclaimed over its holder |
| Lobby portraits shook (per-frame trim + 7 fps counter) | Medium (UI) | one union box for every frame; `uiIdleFrame` pacing |
| No inspection of ground loot | Feature | the item card over a fallen item |

### Iteration 78 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| Thirty static items, no levels, no affixes, no crafting | Feature | the Raven registry (160 bases), instances in the id, affixes, uniques, the camp forge, the economy |
| Flat armor and linear foe scaling could not meet an exponential item curve | High (balance) | foes, hero HP and armor share the 1.08 curve; armor is a share weighed by the attacker's tier |
| Level-ups added a flat +4 HP; a load trusted the saved max | Low | both go through `baseHpMax()` |

### Iteration 79 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| Settings opened under the title menu (z 40 vs 85): CLOSE unreachable | High (UI) | `#settings-panel.open { z-index: 96 }` |
| A phone sheet scrolled its heading and close cross away | High (touch) | sticky headings on every sheet; a cross on Settings and Depths |
| Repaints discarded scroll offsets (spending a skill point snapped to the top) | Medium (touch) | `ui/keepScroll.ts` around ten panels' repaints |

### Iteration 80 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| 60% of weapons were the same numbers behind another icon | High (design) | thirty-seven shapes with roles, three tiers with different innates, uniques with two |
| Weapons did nothing but damage | Feature | six statuses and ten traits; twelve forge enchantments from found recipes |
| Q and R were hard-wired to two potions, no cooldown, no sound | High (UX) | the assignable belt, category cooldowns, six new draughts, quaff cues |
| Crafting rules lived only in code | Medium (UX) | the forge's RECIPES book |
| The anvil prop was a pack icon | Low (art) | the town's weapon rack |
| Desktop bar under the chart could crowd the corner | Low (UI) | a right-edge column; the inventory rises |

### Iteration 81 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| No in-game explanation of items, statuses, recipes or crafting | High (UX) | the codex, ten chapters, generated from the tables |
| Special pieces looked like plain ones | Medium (UX) | effect borders and gems everywhere an item is drawn |
| No sorting or filtering on any list | Medium (UX) | `ui/itemFilter.ts` on inventory, shop, stash, forge; TIDY |
| A status on a foe was a burst and nothing else | Medium (UX) | names, strips, gems above the head, body tint |
| Two icon families and a generated one side by side | Low (art) | every item on the Raven pack |
| The XP bar had no name | Low (UX) | HP / MANA / XP labels with glyphs |

### Iteration 82 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| The inventory cross died after any repaint while open | High (UX) | rewired on every paint; every window's cross in the harness |
| The codex was not found | Medium (UX) | THE JOURNAL: bar label, H, buttons in the inventory, forge and shop, a hint |
| Bulwark, regrowth and Strength life scaled with item power into absurdity | High (balance) | flat armor 0.6–3 × power; regrowth a share of life; Strength life flat |
| Effects read as text only | Medium (UX) | icons on the card with plain sentences; icons above foes' heads |
| The inventory looked different on every screen | Low (UI) | one restyle, cell size by tier |

### Iteration 83 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| The command sheet covered the system-bar column and the portal button | Medium (UX) | moved bottom-left, height-capped, chat steps above it |
| The journal had no road from the command list or the pause sheet | Low (UX) | H in the list; JOURNAL on the pause sheet (the phone's H) |
| The journal's to-hit, Strength life and "flat × power" claims were wrong | Medium (docs) | audited against the code; worked example calls the forge's functions; harness compares |
| ARSENAL listed shapes only, with a wrong pace | Medium (docs) | THE CATALOGUE: every base, every tier, staves, uniques, armor, jewels, find box, forge badges |
| iPhone: pinch zoom stuck, bounce, callout sheet, text boost, 100vh under the toolbar | High (mobile) | touch guards module, glass CSS, `--app-h` everywhere, 100dvh fallback, web-app metas |
| The bar's row width was computed for seven entries | Low (layout) | eight |

### Iteration 84 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| A foe's level and life were invisible until hit | Medium (UX) | plates within 7 tiles of a hero, name · level above the bar |
| One district, no room to grow | Feature | THE MARKET WARD: a second clearing, the south road, the ward gate, districts on the layout |
| Every counter sold the same kinds | Feature | the jeweler, the scribe, the bowyer with their own restock tables |
| No quest surface | Feature (placeholder) | THE BOUNTY BOARD before the guildhall |
| No exits to future zones | Feature (placeholder) | two blocked gateways with a light, a plate and a note |
| No location indicator by the chart | Low (UX) | `#zone-label` under the chart, per tier |
| New anims silently skipped in the hub | Medium (asset pipeline) | added to the hub's preload list; the lesson logged |

### Iteration 85 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| The crypt opened too far away | Low (feel) | DEFAULT_ZOOM 1.5 |
| No retro look | Feature | `CrtFilter` (GLSL, highp), SETTINGS · VISUALS switch |
| Lights, trees and stores stood in streets | Medium (pathing) | road tiles marked; lamps on the verge; a final sweep; no lawn or belt in a road |
| No road east | Feature | THE DARK FOREST (floor 101), the eastern gateway open |
| No long dungeon, no locks | Feature | THE QUARRY MINES (floor 102): 104×88, three iron gates, keys in side rooms, the keeper, the teleporter home |
| Map marks would spoil the fog | Design | marks drawn only for explored tiles |
| Arriving in the quarry raised the endgame | High (bug, found in QA) | the hidden stair on a wall tile |
| Single-tile gates found one site | Medium (design) | gates span the corridor's cross-section |

### Iteration 86 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| The shortcut bar lay flat on touch laptops, tablets and wide phones | Medium (UX) | an upright stack on every layout with the height; two columns on shorter touch landscapes; `tall-screen` class |

### Iteration 87 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| No quests | Feature | the gatekeeper, the dialogue panel, the forest errand (clear, return, 100 gold, safe forest), `SaveGame.quests` |
| The old teleporter | Asset | the new model's disc and rune everywhere a portal stands |
| The key too big and hidden by south walls | Medium (UX) | a quarter scale, low, with a top-layer beacon gated by the fog |
| Gates faced one way | Low (visual) | mirrored across corridors running the other way |
| The boss chamber seized the hero at its door | Medium (design) | the seal is the way in, the room says so |
| A tree hid a foe or a partner | Medium (UX) | the cutaway fades for every visible body |
| The gatekeeper stood behind a pine | Medium (UX) | moved into the gate yard; the road's prompt names him, his tile counts as the gate's |
| The bar met the thumb cluster on a 932x430 phone (since it.86) | Low (layout) | four-across bar on touch landscapes under 480 px; matrix 74/74 |

### Iteration 88 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| A key picked up like a coin | Low (feel) | `Ambience.playRise`: the key rises spinning in a halo; sparks, hold, note, banner |
| A trunk at 0.38 still hid a wolf | Medium (UX) | trees ghost to 0.12 for any body behind them |
| The quarry had no arena; the hydra stood in a hall | Feature | the hall's seal opens THE QUARRY ARENA (`buildWorld(102,'arena')`), the way home, the remembered clear |
| Jars, pots, boxes and bins blocked tiles | Medium (UX) | `CLUTTER_KINDS` never block, in every placer |
| A faceless keeper with long lines | Low (UX) | portrait from his own frame, plain words, the gold (100) on the page, `REWARD RECEIVED · 100 GOLD` |
| No count of the forest's beasts | Low (UX) | `ENEMIES REMAINING · X / Y` under the plate |

### Iteration 89 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| One difficulty for everyone | Feature | `core/Difficulty.ts`: tourist / easy / medium / hard / hardcore, chosen with the delver, kept by the save, sent to the party |
| A risen delver could be killed on the spot | Medium (design) | `Player.wardTicks` = 300: nothing lands for five seconds, halo, buff, note |
| The new audio bundle unused | Asset | zone playlists, per-zone beds, quarry stingers, SPX effects, the books, the lament |
| Sound effects could stack without limit | Low (audio) | `claimVoice`: 4 per bank, 24 total, full banks drop the take |

### Iteration 90 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| No onboarding | Feature | `tutorial/TutorialSystem.ts`: sixteen visual steps over the live game, from the yard's sign |
| The yard's dummies were paint | Feature | passive foes that flinch, heal and never die; wood, not blood |
| Every placed town prop was pushed twice | Low (render) | `tryBlock` re-claims tiles without a second push |
| Floor transitions stalled in a hidden tab (page timers throttled to once a minute) | Medium (robustness) | `core/workerTimer.ts`: the run's `later()` waits on a Web Worker's clock |
| Tutorial cards could leave a phone's box; buttons under 44 px mid-animation | Medium (mobile) | cards clamped to the layout viewport, off-screen targets marked at the edge, 46 px touch targets, eleven-device sweep in qa75 |

### Iteration 98 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| A low arched cube stood in the cellar floor | Low (art) | the free-standing `cellar_vault`/`cellar_pier` blocks removed; columns and stock in their place. The three round archways in the wall runs stay - they are the passages |
| The rescued woman was in the vault from the moment you walked in | Medium (design) | SARAH is detached from the object layer and stripped of her interactable until the last monster falls. `visible` alone will not hold her - the ambience rewrites it from the fog each frame and the culler owns `renderable` |
| The innkeeper was a woman on the villager coat | Feature | COLESLAW, on `folk_walk`, anchored at the sole; the portrait, the body at the bar, the body at the barricade and every line follow |
| The road sentry had no name | Feature | SIR HAM, on the gate prompt and both dialogues |
| Every soul in town was the same man | Medium (feel) | four sheets dealt round the walkers, each carrying its own painted height, anchor, frame count and scale, with a coat colour multiplied into the scene light; the new sheets added to three atlas rosters |
| Fog reset on every zone change | High (feel) | `captureFloor` writes a fog-only memory for the town-shaped floors and every floor restores its own bitset; the capture moved into `swapWorld` so even a rebuild of the same floor keeps its light |
| Coming home from the forest dropped the party in the old quarter | Medium (feel) | `goHome('forest')` lands them on the cobble beside the eastern gateway they left by |
| Processions walked their people in through the dark | Medium (feel) | `lightTheWayIn` opens the fog along the route's first stretch and hangs a warm lamp over it for the scene |

### Iteration 97 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| Wall runs strobed and the hero clipped through them | High (render) | wall pieces keyed `depthKey(x, y + 1) + 4` - strictly between the tiles behind and in front, so no depth ties; and every wall-mounted piece lit from the floor it FACES through a shared `litTile`, instead of from its own wall tile whose line of sight slid along with the hero |
| No cellar under the inn | Feature | `scenes/Cellar.ts`: floor 104, its own mode and theme, a 34x26 vault of near-black tileset stone with three chambers joined by real round arches, 581 reachable tiles, no pockets |
| The inn's interior was the only lit-through interior | Feature | the cellar takes real fog (`sightRadius: 8`, `fullRadius: 3`) - the first interior in the game that has to be explored |
| Nothing to fight under the taproom | Feature | `CELLAR_POOL` - spiders, the risen, a shambler; no looters, no men. Three lootable chests off the paths |
| The keeper's story ended with the quarter | Feature | her second errand: the drink she cannot fetch, the bolted back door, the key turned in place, and a thank-you upstairs that names the woman |
| No woman in the game at all | Feature (art) | NELL, composited at bake time from the Spell of Mastery layered pack (CC-BY 4.0) - female body kit, long skirt, bodice, sash, sleeves, hair, with the pack's own idle bob. The Flare "Heroine" sheets proved to be off-hand weapon layers with no body |
| A cutscene could only run at procession length | Low | `ProcessionScene` gained an optional `hold`, and the cellar's scene opens the fog on its subject first so the camera does not pan into black |

### Iteration 96 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| The inn's floor drew as broken blocks | High (art) | one source diamond baked into four seamless quadrants (`inn_boards_0..3`, `inn_stone_0..3`) picked by tile parity; colour bled outward three passes, then an exact diamond alpha mask - no fringe, no grid |
| Walls, furniture and the bed were engine-drawn or painted from the reference | High (art) | fifty atlas entries baked from the Ancient Isometric Tileset and the Dungeon Pry placeables; `TownMap.wallsFromProps` stops `SceneManager` drawing wall cubes in the inn |
| Wall pieces floated off their tiles | Medium (render) | the tileset's own seating: the image's bottom-left meets the 2x2 block's bounding-box bottom-left; `wall_n` runs along +x, `wall_w` along +y |
| Carpets cut off; benches and the bed were an eyesore | Medium (art) | bordered Dungeon Pry carpets; the tileset's chairs, stools and tables; the bed is the project's own render regraded to walnut and linen |
| The rented room was open from the first walk in | Feature | the layout is a pure function of `quests.east`: locked the room's tiles are `TILE_WALL` (nothing drawn, nothing lit) behind `inn_door_shut`; the reward rebuilds the inn in place with the door open, the bed, the warded chest and four torches |
| The room's chest was a second, separate store | Feature | it is the town `stash` interactable - reachable from every stash point, shared by the whole party in co-op |
| The it.95 rewrite deleted the gate innkeeper's prop case | High (regression) | restored with the `chest` case beside it; caught by `qa75` |

### Iteration 92 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| Dialogue and chatter read as theatre | Low (writing) | every line rewritten plain; six everyday word banks |
| The inn was a ghosted roof over a lot | Feature | `scenes/Inn.ts`: the inn's own floor (mode `inn`, theme `inn`, plank tiles), entered at the door |
| The forest sent the hero home with a cut | Low (feel) | `ProcessionScene` bare: the folk walk into the clearings first |
| Targets on screen had no mark | Low (UX) | `#foe-over` chevrons over every quest target in sight |
| Villagers stood in corners, walked into tables | Medium (feel) | breadth-first paths along street tiles over whole districts |
| Buildings drew over villagers | Medium (render) | `Villagers.positions()` joins the roof cutaway's bodies |
| Bare cliff cubes, a dead-end lane, heaps wider than their tile | Low (map) | THE HILL ROAD gateway, trees or brush on every rim cube, heaps scaled to 66 px, the fallen on the ground layer |
| Nothing to loot in town | Feature | twelve minor chests, remembered opened by the save |

### Iteration 91 additions

| Finding | Severity | Fix |
| --- | --- | --- |
| No third district | Feature | `TownMap`: the map grown to 116 tiles, the Eastern Quarter behind a barricade, `EastState` builds |
| No errand past the forest | Feature | the innkeeper's errand: twenty human looters, a tally, pips, pointers, the `QUEST` command |
| No cutscene machinery | Feature | `town/Reclaim.ts`: letterbox, camera focus, carts toppling, the procession |
| No enterable inn, no room, no bed | Feature | The Gilded Stag with a walkable hall; `REST` + `Player.lieDown` on the death sheet's last frame; the room's chest and bench |
| Silent townsfolk | Low (feel) | word bubbles over every peaceful head, five banks by district and role |
| Looters drew as placeholder markers in town | Medium (render) | the hub's roster preloads the looters' sheets and the villager coat |

## 4. Known issues and regression log

| Issue | Status | Notes |
| --- | --- | --- |
| Foes summoned mid-floor after a snapshot join are unknown to the joiner until they die | Open | the alive list buries ghosts; a keyframe cannot create a foe |
| A foe's attack / cast animation is local to each peer | Accepted | the sample carries the action but peers do not force it; health and position are the leader's |
| Joining during a Coliseum wave uses history replay (slower) | Open | the trial's wave state is not in the snapshot |
| Floating-point drift between peers over long sessions | Mitigated | the leader's corrections bound it; no hash alarm yet |
| Culling is CPU-neutral on desktop (0.12 ms walk vs 0.05 ms saved) | Accepted | the win is GPU vertices on phones; can be disabled with `__game.setCull(false)` |
| `#interact-hint` world labels can sit under the top-left plate on landscape phones | Open, cosmetic | transient |
| iOS Safari has no vibration API | Accepted | haptics are a courtesy |
| Symmetric NAT / CGNAT pairs need a player-supplied TURN relay | Accepted | no free credential-less relay exists |

Regressions caught by the device matrix and fixed in the same iteration: `sb-row` body class
collision (it.66), `vh` units under the simulator (it.67), the ultrawide clamp on a 2.8:1 phone
box (it.69), panels under the touch layer (it.71), the enemy pool id base (it.73), the frames
lost while a joiner built its world (it.73).

## 5. Roadmap

| Version | Milestone | Scope |
| --- | --- | --- |
| 0.2 | Snapshot completeness | summons and projectiles in flight in the snapshot; Coliseum wave state; a periodic state hash with an automatic resync on mismatch |
| 0.2 | HUD placement presets | player-chosen corner layout for the plate, chart and bar on PC and mobile |
| 0.3 | Content | depths 21+, two new wardens, set items, a second town district |
| 0.3 | Audio | positional SFX pan by screen position (per-zone beds shipped in it.89) |
| 0.4 | Rendering | a dedicated glow layer for additive light without touching text; light-source shadows on walls |
| 0.4 | Tooling | automated device-matrix run in CI (headless Chrome), bundle-size budget check |
| 1.0 | Release | account-less cloud saves via shareable codes, spectator seats, replay files from the command stream |
