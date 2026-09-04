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

## Iteration 41 - Skill Tree, Cross-Class Synergy, Spell VFX, Draggable UI (2026-09-02)

- [x] Third test-models upload audited: 12 VFX strips baked (fire/water packs); pixel explosions, hi-res and 30 FPS duplicates rejected; folder pruned
- [x] Skill points (1 + 1/level), four class paths x four tiers + passives, cross-class at double cost, own-class synergy (+30% / -20% cd / class status)
- [x] Skill tree window (K) with slot picker + hotbar footer; character sheet (C); save v2 persists progression (v1 migrates)
- [x] Fireball is an animated projectile with area detonation; every skill got strip VFX; wand bolts animated
- [x] Draggable windows by header (inventory, shop, stash, tree, sheet, cheat) with remembered positions
- [x] E closes an open vendor/stash window; E takes the portal / gate
- [x] Boss notes + depth banner top-anchored; enemy HP bars slimmer and zoom-stable; damage numbers zoom-stable
- [x] QA: unlocks, cross-class, drag + clamp, E toggles, fireball + burn on floor 1, zoom, zero console errors

## Iteration 42 - Anchors, Hitboxes, Legendary + Rings, Starter Gear, Bestiary, Typography (2026-09-02)

- [x] Feet-true painted anchors for every mob strip; click box = painted body of the current strip
- [x] Depth scaling audited: life ×(1 + 0.3·(level−1)), +1 dmg / level, +½ armor / level (new armor field)
- [x] Legendary rarity + boss-only legendary rolls; ring slot with four rings; item bonuses feed the stat getters
- [x] New heroes auto-equip class weapon + chest piece (new apprentice wand / worn katana / cloth robe)
- [x] Inventory redesign: paperdoll cross, belt Q/R, 5-wide pack grid, crisp integer-scaled icons, gray/blue/yellow/gold borders
- [x] Bestiary (B): seen/slain tracking in the save, animated atlas previews, lore, stats, scaling
- [x] Crimson Pro body face, dark halos on all UI text, heavier damage numbers
- [x] Cheat menu reframed and scrollable; bestiary draggable like the rest
- [x] QA: starters equipped, drags, torso/head hit-tests on live mobs, bestiary, zero console errors

## Iteration 43 - Deploy, Gore, Free Portal, Boss Victory, Organic Town, Pack Integration (2026-09-02)

- [x] Milestone commit pushed (rewritten without the 1.1 GB raw upload, folder ignored), Pages deployed (200)
- [x] Direction re-audit: zombie clockwise map + grave-guard half turn; new packs mapped
- [x] God mode reveals the bestiary; unknown creatures are black silhouettes with ??? stats
- [x] ARPG item phrasing (+N to Max HP, N–M Damage, ...)
- [x] Free town portal on T + HUD button (12 s cooldown); scrolls retired from kits and stock
- [x] Floor-20 victory runs itself; RETURN TO TOWN keeps the run
- [x] Persistent floor gore (splats, drips, boss pools), blood-impact strip, gore audio; 7 s boss disintegration
- [x] Fourth upload audited and preserved; tavern, well, ruin gate, iso props, pines, blood, slashes, villagers, poacher, orc, slot frames, armor icons baked
- [x] Organic 56×50 town with winding streets, market square, tavern, guards; orc + poacher mobs in the pools

## Iteration 44 - Softlock Fix, North Gate, Models, Pentagrams, Points, HUD (2026-09-02)

- [x] Portal softlock: remembered arena clears carried into the rebuild + self-opening empty arenas
- [x] Gate at the north edge, descends on contact; town v4 densely filled (7 cottages, 6 stalls, clusters, bushes)
- [x] Orc Slinger feet anchor; pack spiral stairs + dark-wood chests on every floor
- [x] Pentagram sigil strip in arenas, hidden dungeon rooms and the town woods; gore decals persist
- [x] 2 skill points per level (59 at cap); cheat +10 / max
- [x] Minimap frame, HUD backing panels, iron/oak UI sounds

## Iteration 45 - NW Gate, Dusk Town, Playlists, Darinia Font, Globe HUD (2026-09-03)

- [x] Gate north-west in the cliff with a cobbled forecourt and a built-up gate quarter; touch-to-descend
- [x] Town pentagram removed; town lit at dusk by its torches, braziers and campfire
- [x] Town + dungeon music playlists rotate on track end and on floor change
- [x] Darinia display font on headers, titles, tooltips, buttons and banners
- [x] Gargoyle health globe, framed resource and boss bars, HUD stack re-spaced

## Iteration 46 - West Cliff Gate (2026-09-03)

- [x] Dungeon gate embedded in the west cliff; forecourt, braziers, guards; high street from the threshold
- [x] All town points of interest reachable; touch-to-descend; zero console errors

## Iteration 47 - West Wall Cleanup & Flush Gate (2026-09-03)

- [x] Straight west wall column; gate segment glued into it with a measured anchor; apron cleared
- [x] Threshold inside the arch opening; touch-to-descend verified; zero console errors

## Iteration 48 - Combat Feel, Boss Bar, Buffs, Respec, Vendors, Records, Deep Save (2026-09-03)

- [x] Gate one tile out; waystone only on the first depth-I visit; fast-travel hint on return
- [x] Boss bar shows at once with name · level · numeric HP and lingers past death; readable gauges
- [x] Sentinel + grave guard direction maps corrected; hit-stop, directional kick, layered SFX, hurt flash, soft directional shadows
- [x] Smart clicks path to the nearest reachable tile
- [x] Locked-node padlocks, buff rings (HUD + overhead), level-up pillar, town-only respec
- [x] Armorer + alchemist vendors, dungeon records board
- [x] Boss-floor-only pentagrams, secondary starter arm, save v3 resumes at the exact spot

## Iteration 49 - Dual Globes, Nameplates, Orc Anchors, Tree Lines, Ending Flow (2026-09-03)

- [x] English audit + text-shadow typography pass; lock reasons read "REQUIRES LEVEL N"
- [x] Gate two tiles out; town nameplates; distinct alchemist body; camp props
- [x] Sentinel forward-facing verified; orc per-clip feet anchors; softer hurt flash
- [x] Dual globe HUD; inventory height cap; tree prerequisite lines; "3.5s" buff timers; proportional boss fill
- [x] Bestiary keeps scroll + arrow keys; level-up flash + banner; portal scroll off drop tables, HUD scroll icon
- [x] Final boss: loot first, victory on the exit stair

## Iteration 50 - Pack Grid, Boss Fill, Label Manager, Forest Ring, HUD Restructure (2026-09-03)

- [x] 48-slot scrolling pack with crisp rarity rims
- [x] Boss fill recomputed in pixels every frame
- [x] Town plates deduplicated and hidden behind their prompt; double forest ring on the cliffs
- [x] Resource globe beside the health globe; collapsible COMMANDS handle; stat icons; glowing XP bar
- [x] Overhead level-up banner; doubled hint timers; panel-wide text shadows

## Iteration 51 - Scrollbars, Pack Padding, Icon Fit, Hotbar Locks (2026-09-03)

- [x] Universal dark-fantasy scrollbars on every panel; no stock artifacts
- [x] Inventory left padding + inset rarity rims; icons fitted to 85 % of their slot
- [x] Locked hotbar placeholders with padlock and muted tooltip
- [x] Uniform window frames, close buttons and title sizes

## Iteration 53 - Elite Affixes, Trial Coliseum, Combat Acceleration (2026-09-03)

- [x] 15 % champions: +15 % scale, x1.5 life, titled nameplates, breathing floor auras
- [x] Frost-touched chill, Thorns reflection, Vampiric drain — all measured live
- [x] Arena Master arch in town; 46x40 fog-free coliseum with stands and four gate pads
- [x] 5/10/15/20-wave trials with 15 s intermissions, banners, grand chest and the rift home
- [x] Swings, strikes and shots 25 % faster; casts interrupt walking

## Iteration 54 - Split Ledgers, Active Clock, Hall of Records, Living Coliseum, Boss Waves (2026-09-03)

- [x] Dungeon and arena ledgers in StatsManager, persisted globally and in the save
- [x] Active clock: frozen in town and intermissions, ticking on floors and live waves
- [x] Two-tab Hall of Records leaderboard with ranked tables and tallies
- [x] Cheering crowd, blood, broken steel, barricades, cages, banners, flicker and sand drift
- [x] Rising spawns; wardens on every fifth wave with horn, beam, shake; the crowd roars on champion kills

## Iteration 55 - Arena Tallies, Seated 4x Crowd, Fifth Upload (2026-09-03)

- [x] Arena kills persisted in batches; Hall of Records open before any trial
- [x] 388 seated spectators on eight cheer loops, zero drift, staggered tempos
- [x] Grass / dirt / sand diamonds, rocks, watchtower, weapon racks, candle stands, iron cages baked and placed
- [x] Crypt Widow (spider pack) in the pools with a bestiary page; blood-burst strip
- [x] Dense-fill baseline fix: clusters and rocks survive the route check

## Iteration 56 - Terrain Variants, Teleporter, Arena Floor Cleanup (2026-09-03)

- [x] Four diamonds per ground kind (grass / dirt / sand / projected stone cobble), coordinate-picked
- [x] Teleporter pad + rune rings + vortex at the arena centre on the last wave or on T; step on to go home
- [x] Display cases off the sand; every walk fixture blocks its tile

## Iteration 57 - Victory Teleporter, Grim Town Palette (2026-09-03)

- [x] Teleporter at the depth XX arena heart on the King's fall (and on re-entry); town-or-crown choice
- [x] Town regraded: dark grass and earth, dimmed flagstone, shaded cliffs, twisted oaks, deep edge vignette

## Iteration 58 - Arena Teleporter Exits, Records Tabs, E Radius (2026-09-03)

- [x] Boss arenas exit by teleporter only; stair hidden and inert in arenas; depth XX keeps the victory choice
- [x] DUNGEON RECORDS / ARENA COLISEUM RECORDS independent, safe on stale saves, arena tab open before any trial
- [x] One `PROMPT_RANGE` for plate and E; chests answer E inside `CHEST_PROMPT_RANGE` without pathing

## Iteration 59 - 4-Player Online Co-op: Lockstep over PeerJS, Lobby, Shared Stash, Chat (2026-09-03)

- [x] PeerJS (free public broker, no keys) star transport; `KNG-482` codes from `crypto.getRandomValues`
- [x] Deterministic lockstep (6-tick input delay), warp BARRIER, LEAVE frames, solo fallback when the leader vanishes
- [x] Title → CO-OP MULTIPLAYER lobby: nickname, class, create / join, ready-up, leader START, lobby chat
- [x] N-seat sim: per-seat movement / skills / inventory, seat-aware combat + projectiles, enemy AI hunts the nearest hero
- [x] Shared town stash as lockstep commands; leader-only stairs / gates / portals / teleporters / WARP
- [x] Nameplates + hp bars, party HUD, minimap dots, HUD chat (sanitised, hotkey-safe), waiting veil, 10 s revive
- [x] Hidden-tab worker clock; cheat menu and hit-stop off in co-op; `npm run build` with PeerJS bundled
- [x] Two-tab live QA: identical determinism hashes at ticks 14000 and 21000, gate warp, drop / host-loss / late-join refusal

## Iteration 60 - Cross-Network Relay, Grace & Rejoin, Lobby Rebuild, Hover SFX (2026-09-03)

- [x] Google + Cloudflare STUN (verified); player-supplied TURN (UDP/TCP/TLS), stored locally, never in code; 8 s relay-only fallback; TEST NETWORK
- [x] 2 s ping-pong heartbeat with latency on cards and HUD; 10 s RECONNECTING grace (seat kept), 25 s drop; leader plays on without a late seat
- [x] Auto re-dial + RESYNC after a channel cut; lobby rejoin mid-run with full history replay + JOIN frame; save on pagehide
- [x] Leader lost: gothic modal → save → solo → town; hidden-tab timers moved onto the loop; re-entrant link drop fixed
- [x] Lobby rebuilt: code badge + copy feedback, four player cards (animated portraits, badges, ready, ping, crown), cross-fading selector
- [x] Hover SFX replaced by a dry stone tick; `npm run build` clean; zero console errors

## Iteration 61 - Title Rebuild: Animated Atmosphere, Gothic Logo, Menu Categories (2026-09-04)

- [x] Pixi title scene: drifting fog sheets, flickering corner braziers + floor wash + pulsing vignette, rising embers / falling ash, spark bursts on click
- [x] Embossed metallic Cinzel Decorative logo with a breathing gold edge and a 4 px float
- [x] Stack reorganised: CONTINUE (class/level/depth pill) · SINGLE PLAYER · CO-OP · HALL OF RECORDS · SETTINGS · CREDITS · EXIT GAME; load moved to the class screen
- [x] Tabbed settings (Audio / Visuals / Controls) with persistent shake, gore, flash and particle toggles read at the effect sites
- [x] Carved panels, bronze-to-gold button states with stud accents, struck flash; scrolling credits reel; exit prompt
- [x] 200 ms rise-in transitions with the scene dimmed; ESC closes any sub-menu and returns focus to the stack
- [x] 1.39 ms/frame at full particle load; no clipping at 1280x800 / 1920x1080 / 2560x1080 / 3840x1600; zero console errors; clean build

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
