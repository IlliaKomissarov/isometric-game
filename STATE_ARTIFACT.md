# STATE ARTIFACT — Crypt of the Hollow King

A persistent tracking document for system health, architecture, audits and the roadmap.
Update it with every iteration that changes a system's shape, a measured number, or a known issue.

- **Project version:** 0.1.0 (iteration 77, 2026-09-05)
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
| Scripted playthrough (`src/dev/qa75.ts`, 73-91 checks) | 0 failures | 10 sessions, seeds 1-10, all classes: 0 failures after fixes | OK |
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
| `items/compare` / `ui/itemTip` | catalog, player equipment | the item card for inventory, shop, stash | pure rows; the caller resolves "yours" |
| `ui/TouchControls` / `SystemBar` / `StatusFrame` / `Minimap` | layout, queue, player | commands, HUD | act on pointerup for windows |
| `core/PerformanceScaler` | rAF timing | buffer resolution, `quality`, particle budget, colour grade gate | hysteresis, 2 s cooldown |
| `persist/SaveGame` | player, floors, stash, stats | slots 1–3, co-op slots 11–14 | versioned schema |

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
| 0.3 | Audio | per-floor ambience beds, positional SFX pan by screen position |
| 0.4 | Rendering | a dedicated glow layer for additive light without touching text; light-source shadows on walls |
| 0.4 | Tooling | automated device-matrix run in CI (headless Chrome), bundle-size budget check |
| 1.0 | Release | account-less cloud saves via shareable codes, spectator seats, replay files from the command stream |
