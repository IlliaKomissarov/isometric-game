# Feature Checklist & Milestone Tracker

## Milestone 1 — Core Framework MVP ✅ (2026-08-31)

- [x] Vite + TypeScript (strict) + Pixi.js v8 scaffold, `@/` path alias
- [x] Fixed-timestep game loop (60 Hz sim, interpolated render) — `src/core/GameLoop.ts`
- [x] Typed EventBus — `src/core/EventBus.ts`
- [x] Deterministic input command queue — `src/core/InputQueue.ts`
- [x] Procedural placeholder assets (stone floors ×4, wall blocks, class markers, fog, path marker) — `src/core/AssetManager.ts`
- [x] Isometric projection + exact inverse picking — `src/utils/iso.ts`
- [x] Layered viewport (ground / depth-sorted objects / fog) — `src/engine/Viewport.ts`
- [x] Smooth follow camera, clamped wheel zoom (0.6–2.2), rotation disabled — `src/engine/Camera.ts`
- [x] Seeded BSP dungeon generator (rooms + L-corridors, connectivity by construction) — `src/scenes/DungeonGenerator.ts`
- [x] Two-layer dynamic fog of war (hidden / explored shroud / visible, Bresenham LOS) — `src/engine/FogOfWar.ts`
- [x] A* pathfinding (binary heap, typed arrays, no corner cutting) — `src/systems/Pathfinding.ts`
- [x] Click-to-move + WASD/Arrows toggle, normalized diagonals, wall sliding — `src/systems/Movement.ts`, `src/systems/Collision.ts`
- [x] Entity base + Player (4 archetypes, paperdoll layer stack) + pooled Enemy dummies
- [x] Multiplayer-ready stubs: serialization contracts, lockstep StateSync, command envelopes
- [x] Zero TypeScript errors at `--strict`; dev server verified running

## Milestone 2 — Combat & Interaction ✅ core loop (2026-08-31)

User-confirmed direction: **Diablo 1 deliberate pacing** (0.8 s swings).

- [x] Basic melee attack (click enemy → approach → auto-swing → damage) — `src/systems/Combat.ts`
- [x] Enemy aggro + chase AI (LOS + radius aggro, throttled A*, 3 s give-up) — `src/entities/Enemy.ts`
- [x] Screen-space enemy picking (click anywhere on the sprite body)
- [x] Health bars above damaged enemies + hit flash
- [x] Death/despawn flow through EnemyPool (single `entity:died` emission from Combat)
- [x] `?seed=` URL param + `window.__game` dev handle + `loop.step(n)` deterministic test driver
- [x] Swing lunge + player hit-flash + walk-bob animation feedback (2026-08-31 it.3)
- [x] Enemy strikes back (8 dmg / 1.2 s) + Diablo-style health orb UI (2026-08-31 it.3)
- [x] Player death → epitaph → respawn at entrance (2026-08-31 it.3)
- [x] Entity separation — enemies keep 0.55 tiles from the player (2026-08-31 it.3)
- [ ] Screen-shake on heavy hits (deferred — needs camera-offset hook)

## Iteration 3 — Lighting, Cutaway & Art Direction ✅ (2026-08-31)

- [x] Lighting rewritten as a tile lightmap (tint-based, Diablo 1 model) — fixes
      wrongly-darkened lit objects; warm/cool ramp + torch flicker + smooth glide
- [x] Cutaway vision: walls occluding the player fade to 0.32 alpha and back
- [x] Hidden-geometry silhouette leak fixed (`visible=false`, not black tint)
- [x] Latent EnemyPool preallocation bug fixed (phantom enemies at origin)
- [x] Gothic typography (Cinzel + IM Fell English) across all UI
- [x] COMMANDS panel with hotkey chips + active-mode highlight; cinematic vignette
- [x] Ambient ember-mote particle layer tied to the light field

## Milestone 3 — Items & Paperdoll ✅ core (2026-08-31 it.4)

- [x] Item data model (11 items, 6 slots, 3 rarities) — `src/items/catalog.ts`
- [x] Deterministic loot drops + ground rendering + click-to-collect — `src/systems/Loot.ts`
- [x] Inventory panel (I key) with equip/unequip through the command queue
- [x] Equipment visuals: instant tinted paperdoll overlays on the model
- [x] Item stat tooltip (folded into `ui/Inventory.ts`)
- [x] Stats live in combat: weapon damage bonus + flat armor reduction
- [ ] Diablo-style tetris grid + drag-and-drop (current: list backpack)
- [ ] Item drop BACK to the ground from inventory
- [ ] Rarity affixes / randomized stats

## Iteration 4 — Dramatic Lighting ✅ (2026-08-31)

- [x] Colored static light sources baked per tile (`Lighting.addSource`, additive compose)
- [x] Braziers: warm orange sources + pulsing glows + ember hotspots — `src/scenes/Props.ts`
- [x] Arcane floor runes: cold violet glow + halo
- [x] Stronger torch flicker + independent source-flicker rhythm
- [x] Particle count 40→64, 35% ember-biased toward braziers
- [ ] Enemy-enemy separation (they stack on each other when crowding)

## Milestone 4 — Diablo Combat & Dungeon Depth ✅ (2026-08-31 it.5)

- [x] Animated attack actions: windup → strike frame → recovery on every entity
- [x] To-hit rolls, weapon min–max damage, crits ×2, misses with whiff feedback
- [x] Hit recovery / stunlock with per-type recovery ticks; knockback
- [x] Dodgeable telegraphs (range re-checked at the strike frame)
- [x] Swing animation (weapon arc + slash VFX), enemy telegraph/flinch/death anims
- [x] Blood particle bursts + persistent corpse stains
- [x] Enemy roster: fallen (flees) / zombie (tank) / bone archer (kites, shoots)
- [x] Pooled projectile system (arrows dodgeable in flight)
- [x] Enemy-enemy separation (no stacking)
- [x] Multi-floor dungeon: stairs, per-floor rebuild, scaling packs, DEPTH HUD
- [ ] Enemy windup audio/visual "clang" polish, screen shake on crits
- [ ] Player attack-speed stat (weapons all swing at warrior baseline)
- [ ] Floor-themed palettes (catacombs/caves) for deeper depths

## Iteration 6 — Controls, Weight & Clarity ✅ (2026-08-31)

- [x] Hybrid controls: SPACE/F auto-targeted strikes (hold to chain, air whiffs), E loot grab, full keyboard play
- [x] Target ring — always-visible marker on the foe being struck
- [x] Grounded shadow split + hop-cycle walk + squash & stretch + movement lean
- [x] Impact frames (pose hold on landed hits) + camera kick + gravity blood
- [x] Wall lighting corrected: lit by the brightest adjacent visible floor face
- [x] Player poise (no perma-stunlock from trash hits) — livelock fix
- [x] Strike reach ≥ target-selection range — whiff-livelock fix
- [x] Close-range steering with A* fallback — doorway-deadlock fix
- [x] Tutorial: waystone + proximity/event hint banners (move/strike/stairs/loot/inventory/dodge)
- [ ] Health potions / recovery (player hp only refills on death — grind risk)
- [ ] Gamepad support (the command layer is ready for it)

## Iteration 7 — Ranged, Minimap, Paperdoll Preview ✅ (2026-08-31)

- [x] Weapon families (blade/bow/wand) with per-family timing, range, and art
- [x] Player projectiles: arrows + magic bolts, faction-aware collision, impact VFX
- [x] Bow gameplay: approach-to-range with LOS, held-SPACE auto-fire, dodgeable shots
- [x] New weapons: Short Bow (starter), Hunter's Bow, Emberwand
- [x] Minimap (M): fog-revealed tiles only, stairs marker, pulsing player dot
- [x] Live paperdoll preview in the inventory (renderer.extract, updates on equip)
- [x] Bow draw/release animation, footstep dust, idle breathing, crit sparks
- [x] Sub-agent board updated: minimap done; potions/gamepad/floor-themes specs added; blueprint table
- [ ] Quiver/ammo model (arrows are currently infinite)
- [ ] Ranged enemies leading their shots (they aim at your current position)

## Iteration 8 — Asset Packs, Chests & Timer ✅ (2026-08-31)

- [x] SpriteLibrary loader: knight grid sheets + Lords-of-Pain per-frame anims
- [x] Player = HD Knight: 8-dir idle/run, two alternating swings, MeleeSpin for
      Doombringer, CastSpell for bow/wand, TakeDamage flinch; armor tints the model
- [x] Skeleton enemy: real walk + death animations (4th distinct enemy type)
- [x] Real stone floors from the pack's ground texture (diamond-masked variants)
- [x] Lootable chests: indicator, walk-up open, 2–3 guaranteed drops, glint VFX
- [x] Gold-pile animated decor; loading overlay; graceful procedural fallback
- [x] Floor run timer (deterministic, resets per floor, shown in descend banner)
- [ ] Warrior/LoP idle+walk set as an alternate class skin (files already indexed)
- [ ] Knight Die sheet on player death (currently instant respawn)
- [ ] Attack frames for skeleton when the FULL pack is purchased

## Iteration 9 — Palette Discipline & Full Sprite Replacement ✅ (2026-08-31)

- [x] Nearest-neighbor scaling for pixel-art pack sprites (crisp, GBA-style)
- [x] Knight scene-lit (armor tint × torch light) — no more glowing hero
- [x] ALL enemies replaced with tinted pack variants (ember/rot/bone/frost)
- [x] Real idle frames (warrior), breathing on all idle sprites, zombie death via tinted collapse
- [x] Distance-coupled walk/run cycles — foot-sliding eliminated
- [x] Global pacing pass: slower swings, windups, idles, death, glint, gold
- [x] Player death plays the knight Die sheet before respawn
- [x] Inventory: scrollable backpack compartment + real-knight paperdoll preview
- [x] Tile-highlight destination marker; rare drops glint
- [ ] Enemy attack/hit frames when the FULL Lords-of-Pain pack is acquired
- [ ] Per-floor enemy tint themes (deeper = colder/darker variants)

## Iteration 10 — Critical Overhaul ✅ (2026-08-31)

- [x] Hollow Knight replaces the anim-less warrior-zombie (full knight sheets, dusk tint)
- [x] Animated lunge attacks for all Lords-of-Pain mobs (no frozen strikes)
- [x] Run/walk pacing overhaul (speed 4.0, stride 5, enemy strides −25%)
- [x] Stone-textured wall blocks (pack material on all three faces)
- [x] Blue runes dropped; waystone gold; crates (Boxes pack) as room clutter
- [x] Crisp SVG gothic cursor
- [x] Grid inventory with real oubliette weapon icons + rarity borders
- [x] Stats extracted to an always-visible readout beside the orb
- [x] Combat mechanics LOCKED (hybrid controls + feedback + full mob anims)
- [x] Temple Kit as the deep tileset (floors 3+, retinted; user-approved) — it.10b
- [x] Full arsenal: katana/axe/mace/polearm families, 9 new items, real icons — it.10b
- [ ] Copings stone trim as wall-top variety
- [ ] Health potions (spr_wep_heal icon is loaded and waiting)

## Iteration 11 — Purge, Validation & QoL ✅ (2026-08-31)

- [x] Glitchy crates purged; temple material re-sampled (clean depth-3 look)
- [x] ALL mobs = fully-animated knight variants (LoP skeletons retired from combat)
- [x] Dread Archer uses the CastSpell sheet as its real draw-and-loose animation
- [x] Direction hysteresis — no more sprite-flip jitter on diagonals
- [x] Weapon-scaled slash arcs with identity-color blending
- [x] E = interact (loot OR chest); chest halos + "E OPEN" proximity prompt
- [x] Inventory stacking with quantity badges; generated pixel icons for all gear
- [x] Level select (L) with persisted unlocks
- [x] Cornered-enemy invisibility fixed (neighbor-fallback fog gate)
- [ ] Map the Boxes sheet's true diamond-packed frames (crates return later)
- [ ] Temple depth: consider raising floor brightness a notch (user feedback)

## Iteration 11b — Boss Floors ✅ (2026-08-31)

- [x] Every 5th depth: the Tomb Warden guards barred stairs (unstaggerable, spin sweeps)
- [x] Boss health bar on sighting; "THE WARDEN FALLS" banner; 3 guaranteed rare trophies
- [x] Temple floors lifted a notch (overlay 0.62→0.46)
- [x] Unique boss modifiers per crypt (frost warden, ember warden…) — it.12
- [ ] Arena-shaped boss room generation (currently the normal farthest room)

## Iteration 12 — Light, Mob Variety, Combat Text, Cheats, 20-Floor Arc ✅ (2026-08-31)

- [x] Warm hero halo + brighter tint floors (enemies 0.5, player 0.7) — readable dark
- [x] Rotting Ghoul = dedicated zombie pack (walk/idle/attack/dying, 8-dir, scale 0.26)
- [x] Dread Archer = ranger bow pack (idle/run/draw-loose/hit/death, ownShadow, scale 0.3)
- [x] Animated bonfire props (vfx pack) replace vector braziers; brick stairs sprite
      (black sheet ground chroma-keyed at load)
- [x] Floating combat text: white enemy dmg, red player dmg, gold crits, grey misses
- [x] Cheat menu (F1/`): God mode (in dealDamage, survives floors), heal, all items,
      slay visible, reveal floor
- [x] MAX_DEPTH=20; unique boss per crypt: V Tomb Warden (unstaggerable) / X Frost
      Warden (slowing blows) / XV Ember Warden (fire-bolt caster) / XX Hollow King
      (summons at half hp); per-boss bar name; victory banner on the depth-XX stairs
- [x] Speed 3.9→4.3; permanent corpses (death-anim last frame) + blood stains
- [x] Vector purge: ground drops use generated pixel icons (no diamond glyphs)
- [x] Per-boss custom (non-knight) sprite sheets — it.13 (dragon XV, orc XX)
- [ ] Boss arena rooms
- [ ] Blood decal variety (directional splatter along the killing blow)

## Iteration 13 — Final Polish: Light, Fire Purge, Audit, Menu Overhaul ✅ (2026-09-01)

- [x] Depth 3+ darkness fixed (radius 4.5, shadow floor lifted, temple overlay 0.30)
- [x] Fire visuals PURGED — invisible warm hearths + drifting crypt-mist patches
- [x] Archer corner bug: no retreat into walls (point-blank shot when cornered),
      8-neighbor render fog fallback
- [x] Max-roll = CRIT display + floating gold "CRIT!" banner
- [x] Asset audit: crimson DRAGON boss (Depth XV), ORC BERSERKER king (Depth XX),
      HALBERDIER "Crypt Sentinel" regular mob (depths 4+) — all full anim sets
- [x] Cheat menu overhaul: animated knight portrait, powers grid, categorized
      scrollable arsenal (tabs + per-item give + take-all)
- [x] No new libraries (Pixi v8 pipeline sufficient — documented decision)
- [x] Frames_320x320 GROUND set integrated (Ashscale Duelist) — it.14
- [ ] Frames_320x320 AERIAL set (Air_Fly/Air_Death) — a future flying elite
- [ ] vfx/Effect_BloodImpact + SmallHit/BigHit as hit VFX upgrades

## Iteration 14 — Deep-Level Rescue, Roster, Collision & Gore ✅ (2026-09-01)

- [x] Theme bands: stone 1–2 / temple 3–9 / frost 10–14 / ember 15–20
- [x] Pillar colonnades in large rooms (3+), grander halls (10+), connectivity-safe
- [x] Ruin dressing: cracked tiles ×3, rubble piles, broken-column stumps
- [x] Dragon/naga MORPH GLITCH purged (FireBreath = different creature, banned)
- [x] Two new mobs: Moon-Cursed Ravager (werewolf, 6+), Ashscale Duelist (lizardman, 10+)
- [x] Size normalization (tiny spearman fixed: guard 0.42, archer 0.36, naga 1.0)
- [x] Wall-clipping fixed: radius-aware separation + per-tick bounds clamp
- [x] Directional blood sprays on hit + death gore blowouts
- [ ] Boss arena room shapes
- [ ] Blood pools that persist on heavy hits (currently death-only stains)

## Iteration 15 — Game Feel, FX, Endings & Infernus Kit ✅ (2026-09-01)

- [x] Depth 3+ layout reverted to clean 1–2 rules (palette bands carry identity)
- [x] Theme retints baked race-proof (multiplied fills); new band tones
- [x] Wall-flicker fixed (cutaway hysteresis); fog culling fixed (no mobs over void)
- [x] Melee AoE cleave arc (~55°, independent rolls) — verified 3-mob hit
- [x] Subtle trauma-based screen shake (heavy hits, crits, boss deaths)
- [x] Hit-spark particles; boss death sequence (strobe + staged explosions + loot burst)
- [x] Animated inventory paperdoll (idle frames, live equipment)
- [x] Cursor rebuilt from the real oubliette falcon-blade sprite
- [x] Floor-fade transitions; full endgame epilogue with stats + DELVE AGAIN
- [x] Infernus kit: altars, graves, bones, gore, candelabra lights, dragon centerpiece
- [ ] Full Infernus building tileset as a wall/floor swap (biggest visual step left)
- [ ] Audio pass (no sound at all yet — the single loudest missing feel element)

## Iteration 16 — Designer Corrections ✅ (2026-09-01)

- [x] Collision rule: standing props block (TILE_BLOCKED hearths) or don't exist
- [x] Clutter purge: rubble/columns/graves/gore/altar/dragon removed
- [x] Candelabra spin fixed (rotation-pose sheet → one static cell)
- [x] Stairs visually DESCEND (banded pit into black); ascending pack deleted
- [x] Flee AI: safe-distance stop + cornered desperation latch
- [x] Final boss rebodied: massive rotting colossus (no knight)
- [x] Bottom HUD bar, pixel-gauntlet-style cursor, text pass
- [x] Asset deletion protocol executed (6 dirs + FireBreath, ~1,365 files)
- [ ] Frost/Ember warden bodies are still knight variants (only the FINAL
      boss was mandated — candidates: benched orc pack, werewolf giant)

## Iteration 17 — Presentation Revert & Boss Beats ✅ (2026-09-01)

- [x] ONE render pipeline for all depths (stone set; bands = multiply tints only)
- [x] Temple Kit path retired; crack decals removed
- [x] Real descending staircase (treads/risers/flanks/threshold, floor-matched)
- [x] Boss deaths extended to ~4 s: anim → strobing hold → pale glow → fade,
      eight growing explosion pulses, loot beat delayed to 3.3 s
- [x] Audio pass — it.18 (Web Audio engine, real tracks + synth SFX, settings)
- [ ] Milestone 5 co-op transport

## Iteration 18 — Audio Phase & Real Staircase ✅ (2026-09-01)

- [x] AudioManager: bus graph, gesture unlock + retry, persisted volumes
- [x] Real tracks: reveal intro, BGM loop, war horn, bolt cast, death undertone, chant
- [x] Synth SFX for every essential effect (swing/hit/crit/bow/hurt/death/loot/UI/fanfare)
- [x] Full event-trigger wiring incl. UI blips and floor-transition motif
- [x] Settings panel (O): Master/Music/Effects sliders + mute, persisted
- [x] REAL descending staircase sprite (Infernus Stairs_Inverted, exact tile width)
- [x] Per-band BGM variation (gloomy drone on floors 10+) — it.19
- [x] Sampled combat SFX from the real recordings (slice + pitch-jitter engine) — it.19
- [x] Stairs proximity trigger + tone-baked staircase — it.19
- [x] Fantasy SFX pack fully mapped (13 variant banks, footsteps, freeze) — it.20
- [x] Enemy click hit-box covers tall bosses — it.20
- [ ] Positional audio (pan/attenuate SFX by distance to camera)
- [ ] Ambient beds from the pack's Cave/Interior loops (BGS folder)

## Iteration 36 - Studio Overhaul: Atlases, Purge, Menus, Scale, Audio, VFX (2026-09-02)

- [x] Asset audit + bake: 89 anims / 19 singles into public/assets/atlas (49 MB, cropped, half-res packs)
- [x] PURGE: 2,921 MB / 217 entries of raw packs, unused audio, dummy folders removed (scripts/purge-assets.mjs)
- [x] Lazy atlas streaming per floor + next-floor prefetch; production menu at 0.8 s / 206 KB
- [x] Main menu (DESCEND / CHOOSE YOUR DELVER / SETTINGS & CONTROLS / CREDITS) + title theme
- [x] Run lifecycle: startRun/destroy - restart, main menu, hero re-select without a refresh
- [x] Pause menu (ESC) + death overlay (RISE AGAIN / RESTART / MAIN MENU); epilogue MAIN MENU
- [x] Idle ping-pong pacing (mage/rogue/skeletons), time-based idle clock
- [x] Unit height standard: heroes + mobs 56 px, bosses 128 px, from manifest painted bounds
- [x] Item icon overhaul (20x20 shaded pixel art) + lit slot tiles + rarity glows
- [x] Music state machine (menu/dungeon/boss/victory), ducking, UI/pickup SFX banks, deferred combat bank decode
- [x] Impact sparks, projectile trails, dynamic floor shadows
- [x] QA: 4 classes, floors 1-20, arenas 5/10/15/20, Hollow King phases, victory - zero console errors
- [ ] Positional audio (pan/attenuate by distance) - still open
- [ ] Item drop back to the ground from the inventory - still open

## Iteration 37 - Stability Pass (2026-09-02)

- [x] Level-transition freeze: preload-then-build-then-swap, sync buildWorld, loop error boundary, fade watchdog
- [x] Direction audit of every unit; ranger/zombie/halberdier/werewolf/lizardman mirrored, hydra/naga/villager reflected - fixed via SpriteLibrary.rowForDir
- [x] Mage/rogue/skeleton idle slowed to a 2.2 fps ping-pong breath
- [x] START -> class select -> CONFIRM flow; CHANGE CLASS from pause and death; credits filled
- [x] Ground drops compact (<= 33 px); gold piles saturated + pulsing glow + twinkles
- [x] Impact flash + victim-side slash arc on every landed hit
- [x] QA loop: menu -> select -> floor 1 -> floor change -> directions -> gold; zero console errors

## Iteration 39 - Town Hub, Vendors, Save/Load, Stash (2026-09-02)

- [x] Town assets audited, baked (houses, tileset, placeables, campfire, torch, well, peasants), raw test-models pruned
- [x] Floor 0 town: handcrafted square, cottages with roof cutaway, campfire/torch lighting, villagers, town music
- [x] Merchant buy/sell UI; potions (Q/R) and Scroll of Town Portal; stash UI with gold
- [x] Town portal there and back with exact FloorMemory (chests, gold, kills, explored, arena)
- [x] SaveGame: 3 LocalStorage slots, autosave on town arrival / pause / SAVE & EXIT; CONTINUE / LOAD GAME / overwrite picker
- [x] QA loop: start -> town -> vendor -> stash -> gate -> floor 1 -> portal -> town -> save & exit -> load; zero console errors

## Iteration 40 - Town Redesign, Market, Camp Heroes, Buyback, Skill Art (2026-09-02)

- [x] Second test-models upload audited: 16 skill glyphs + 16 painted item icons baked to assets/ui; UI pack rejected; raw folder pruned
- [x] 46x40 town: forest belt + cliff ring, market square with four stalls, two residential quarters, streets and lanes, campsite, vault
- [x] Stone archway gate with braziers, cold light and drifting fog; well removed; collision audit (flood fill) at build
- [x] Resting heroes: the three unpicked classes idle around the campfire (render-only Player rigs)
- [x] Cottage interiors: door column walkable, roof cutaway 20% inside / 38% behind
- [x] Merchant buyback counter + BUYBACK command; Violet Elixir; gold math verified
- [x] Skill slots use the baked glyphs with cast flash; panels/tooltips/cells reframed; painted item art everywhere
- [x] Cheat menu HERO tab: instant level 1-30
- [x] QA: streets, cottage entry, camp, vendor cycle, level cheat, zero console errors

## Milestone 5 — Co-op Foundation

- [ ] WebSocket/WebRTC transport implementing `INetworkTransport`
- [ ] Lockstep command relay end-to-end (2 peers)
- [ ] Snapshot hash drift detection
- [ ] 4-class party spawn & camera behavior

## Backlog / Polish

- [ ] Audio triggers on EventBus events — spec in `sub_tasks/sound-effect-triggers.md`
- [ ] Minimap from explored-fog bitset — spec in `sub_tasks/minimap.md`
- [ ] Real sprite art replacing procedural placeholders (drop-in via AssetManager keys)
- [ ] Torch-light color grading / ambient flicker
