# Crypt of the Hollow King

A dark-fantasy isometric action RPG for the browser. Twenty depths, four delvers, one crown of ash.
Deterministic 60 Hz simulation, four-player online co-op with no server, and a HUD that fits a
240 px feature phone and an 8K monitor from the same code.

**Play:** https://illiakomissarov.github.io/isometric-game/

## Key features

- **Isometric ARPG combat.** Diablo-paced action model: wind-up, strike frame, recover; to-hit,
  crits, knockback, hit recovery and stagger; melee, bows and wands; four classes with talent
  paths, synergies and passives; loot in three rarities with a paperdoll; a town hub with a
  shop, a stash and a coliseum; boss floors every fifth depth with multi-phase wardens.
- **Real-time multiplayer without a server.** Four seats over WebRTC data channels brokered by
  PeerJS. Deterministic lockstep carries only intent; the Party Leader is the authority for every
  creature and hero, so no peer can drift out of sync. Room codes, a party lobby with portraits,
  latency and readiness, party chat, a shared stash.
- **Boss and mob fights that match on every screen.** The leader samples every foe near the party
  five times a second and sends only what changed; peers glide their copies into place, apply
  health, and bury what the leader killed.
- **Seamless reconnect and mid-run joining.** A player who drops returns to the same seat with one
  tap on REJOIN LAST PARTY; a new player joins a delve in progress from a 3 KB world snapshot and
  is live in a few seconds. Leader-gated portals move the whole party at once.
- **Adaptive touch UI.** A status plate, a folding system bar, a tappable chart, a thumb stick that
  spawns under the finger, a skill arc with icons and cooldowns, idle fade, haptics, and windows
  that reflow instead of shrinking. Verified across 74 device configurations.
- **Fog of war and lighting** as a per-tile lightmap that tints the world, cutaway walls,
  baked directional floor shadows, ember and mist atmosphere, and a dynamic resolution scaler
  that keeps 60 FPS on weak hardware.

## Tech stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript 5.7 (strict, `noUnusedLocals`, ES2022 target) |
| Renderer | Pixi.js 8.6 (WebGL, sprite batching, render groups, `ColorMatrixFilter`) |
| Simulation | Custom fixed-timestep loop (60 Hz, Fiedler pattern, render interpolation), Web Worker clock for hidden tabs |
| Physics and pathing | Custom: axis-separated square colliders, spatial-hash separation, A* with a binary heap and corner-cut rules |
| Random | Seeded mulberry32 streams with readable state (deterministic lockstep, snapshot joins) |
| Networking | PeerJS 1.5 (WebRTC data channels, public signalling, optional player-supplied TURN), custom lockstep, host-authoritative state sync |
| Audio | Web Audio API synthesis (SFX, ducking, buses) plus streamed music tracks |
| UI | Hand-written DOM with an obsidian-glass design system, SVG icons, `FitScaler` contain-fit, `OrientationManager` layout spine |
| Persistence | `localStorage` saves (versioned), co-op hero slots, floor memories, settings, last party |
| Build | Vite 6 (vendor chunks for Pixi and PeerJS), `tsc --noEmit` typecheck, esbuild |
| Assets | Grid atlases + `manifest.json` baked in-browser (dev endpoint), PNG UI packs, Cinzel / Crimson Pro / Darinia fonts |
| Deploy | GitHub Pages through a native-git publisher (`scripts/deploy-pages.mjs`) |
| Dev tooling | Device-matrix harness (`src/dev/qa66.ts`), asset purge script, in-page debug handles (`window.__game`, `__menu`, `__layout`) |

There is no game server, no backend and no analytics. Everything runs in the browser.

## Architecture

The simulation is a pure function of a seed and an ordered command stream. Input from the DOM
becomes a serialisable `InputCommand`, queued and drained once per fixed tick. Rendering reads
entity state and never writes it. That one rule is what makes four peers agree.

```
DOM / touch ──▶ InputBindings ──▶ InputQueue ──▶ GameLoop (60 Hz) ──▶ Systems ──▶ Entities
                                       │                                   │
                                       ▼                                   ▼
                              Lockstep (co-op)                       Pixi scene graph
                             frames over PeerJS               Lighting · Culling · Camera
                                       │
                                       ▼
                             StateSync (leader authority)
```

```
src/
  core/        GameLoop, InputQueue/Bindings, StateManager, AssetManager, OrientationManager,
               PerformanceScaler, VisualSettings, Haptics, EventBus
  engine/      Viewport (layer contract), Camera, Lighting (lightmap + fog + cutaway),
               Ambience, AudioManager
  entities/    Entity, Player, Enemy (AI, phases), EnemyPool
  systems/     Combat, Movement, Collision, Pathfinding, Projectiles, Skills, SkillTree,
               Inventory, Loot, Chests, Town, StatsManager
  scenes/      DungeonGenerator (BSP), Coliseum, Props, SceneManager
  town/        TownMap, TownProps, Villagers, CampHeroes
  net/         PeerNet (transport), Lockstep, StateSync
  render/      SpriteLibrary (atlases), Vfx, DamageText, Gore, Culling, animUtil
  ui/          Status plate, SystemBar, TouchControls, VirtualJoystick, Minimap, panels,
               menus, lobby, chat, FitScaler, icons
  items/       Catalog, rarities, weapon families
  persist/     SaveGame (versioned schema, floor memory)
  utils/       iso projection (the only place it lives), rng, Vec2, color
  dev/         QA harnesses (never bundled)
docs/          development_log.md, checklist.md, skills/ (technique notes), sub_tasks/
public/assets/ atlas/ (baked sprite grids + manifest), ui/, audio/
scripts/       deploy-pages.mjs, purge-assets.mjs
```

Invariants every change keeps:

- No `Math.random()` or wall clock in simulation code; every roll comes from a seeded stream.
- Projection math lives only in `src/utils/iso.ts`; spatial queries only through
  `SceneManager.isWalkable` / `isOpaque` and the lighting's visibility.
- Simulation never reads a container's `visible` or `renderable`; those belong to rendering.
- Every co-op mutation is a command in the stream; the leader's state sync is the only
  exception, and it only ever pulls a peer toward the leader.

## Local development

```bash
npm install
npm run dev        # Vite on http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production bundle in dist/
npm run preview    # serve the production bundle
npm run deploy     # build for GitHub Pages and publish the gh-pages branch
```

Useful URLs while developing: `?seed=42` pins the dungeon, `?class=mage` skips the menu,
`?depth=3` starts on a floor. In dev builds `window.__game` exposes the live run
(`loop.step(n)` advances the simulation deterministically), `window.__menu` the title flow, and
`window.__layout` the layout, the performance scaler and the touch controls.
`await import('/src/dev/qa66.ts'); __qa66(true)` runs the device matrix.

## Controls

**Desktop**

| Action | Keys |
| --- | --- |
| Move / target | Left click, or W A S D / arrows for direct control |
| Strike | Space / F (hold to keep swinging) |
| Take loot / interact | E |
| Skills | 1 2 3 4 |
| Potion / mana | Q / R |
| Inventory, talents, hero, bestiary | I, K, C, B |
| Map, depths, town portal | M, L, T |
| Settings, pause | O, Esc |
| Zoom | Mouse wheel |
| Forbidden Arts (cheats) | F1 or backtick |
| Party chat | Enter |

**Touch (phones and tablets)**

- Left thumb: the stick spawns wherever you press in the lower-left area; the draughts (portal,
  mana, health) sit just above it.
- Right thumb: the attack at the corner, four skills in an arc with icons and cooldown sweeps,
  the open hand to interact. The cluster fades when idle and wakes on touch.
- Top-left: the status plate (portrait, level, health, resource, experience, gold, buffs).
- Top-right: the chart (tap to expand) and the system bar: inventory, talents, hero,
  bestiary, menu, Forbidden Arts, fullscreen.
- Portrait phones get a dedicated control pad under the crypt; landscape floats the controls
  over an edge-to-edge canvas. Every window fits inside 92% x 90% of the screen or scrolls.
- The first touch on the controls asks for fullscreen; Settings has a Virtual Controls switch
  (Auto / Always / Never) and a Vibration toggle.

## Multiplayer

CO-OP MULTIPLAYER on the title screen. CREATE PARTY gives a room code; friends JOIN with it.
The leader's feet open stairs, gates and portals and the whole party travels together. If you
drop, REJOIN LAST PARTY puts you back in your seat. Phone hotspots and strict carrier NAT need
a TURN relay; paste any free TURN account's credentials under NETWORK RELAY (they stay in your
browser).

## Documentation

- `docs/development_log.md`: every iteration, what shipped, what broke, what was measured.
- `docs/checklist.md`: milestone and iteration checklists.
- `docs/skills/`: technique notes (lockstep and state sync, adaptive HUD, lighting, combat
  model, atlas pipeline, A*, BSP generation).
- `STATE_ARTIFACT.md`: health scorecard, component matrix, audit log, known issues, roadmap.
