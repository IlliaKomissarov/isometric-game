# Development Log

## 2026-09-02 (iteration 41) - Skill tree + progression, cross-class synergy, animated spell VFX, draggable windows, E toggles, HUD cleanup

### Asset audit (`public/assets/test-models`, third upload: 884 PNG, 205 MB)
- KEEP -> 12 single-direction strips baked into `atlas/vfx_*.png` (union
  alpha crop, Lanczos, centred in square cells): `vfx_fireball` (the
  oriented comet, 15 f/96), `vfx_explosion` (fire_explosion every 3rd,
  25 f/96), `vfx_burst` (5 f/96), `vfx_firewall` (fire_wall every 3rd,
  24 f/80, loops), `vfx_ring` (FirePortal, 15 f/128), `vfx_vortex`
  (15 f/96), `vfx_splash` (WaterSplash, 8 f/96), `vfx_whirl` (Whirlpool,
  15 f/128), `vfx_slash` (WaterSlash, 10 f/96), `vfx_aura` (15 f/96),
  `vfx_orb` (fire Orb, 15 f/48), `vfx_strike` (fire_strike every 2nd,
  15 f/96). 1.36 MB total; every floor preloads them.
- REJECT: the `_high` 1000 px duplicates, the 30 FPS sheets (three times
  the frames for no visible gain at 60 Hz render), the pixel "explosion
  pack 1" (chunky 32-192 px style against the painterly game),
  Flamethrower / Kamehameha / lavafall / waterfall / fountain / torch /
  canalisation / circle and waterball sheets (nothing casts them), the
  GIF previews, PDFs, __MACOSX and .DS_Store junk. Folder deleted after QA.

### Progression (`systems/SkillTree.ts`, `entities/Player.ts`)
- Heroes start with basic attacks, ONE skill point, and an empty hotbar;
  every level grants one point (the cheat level jump grants the
  difference). `Player.skillPoints / unlockedSkills / loadout / passives`
  are hero state and persist (save v2; v1 slots migrate with one point
  per level).
- Four class paths x four tiers (level 1 / 3 / 5 / 7, each tier needs the
  previous one on that path) plus two passives per class (level 4 + one
  active of that class): Iron Hide +3 armor, Blood Rush +10% dmg,
  Wellspring +40% regen, Emberheart +12% dmg, Fleet Foot +8% speed, Keen
  Eye +12% dmg, Sleight +8% dodge, Second Wind +35% regen - read by the
  Player getters (`passiveBonus`).
- CROSS-CLASS: any path may be learned at double point cost.
- SYNERGY: a skill on the hero's own path casts at +30% power, 20% shorter
  cooldown, and every hit lays the class status - warrior STAGGER (18-tick
  hit stun), mage BURN (2 dmg / 20 ticks for 3 s), ranger HOBBLE (10-tick
  stun), rogue POISON (existing DoT). Delayed effects (zones, flurry cuts,
  the fireball's impact) carry the synergy they were cast with.
- Commands (determinism rule intact): `UNLOCK_SKILL`, `UNLOCK_PASSIVE`,
  `EQUIP_SKILL {slot, id|null}` applied by SkillSystem inside the tick;
  `skills:changed` re-renders the tree, the sheet and the hotbar.
  The first learned skill auto-fills the first empty slot.

### Skill tree window (`ui/SkillTree.ts`, K) + character sheet (`ui/CharacterSheet.ts`, C)
- Own path first and flagged; nodes read LEARNED / READY / LOCKED (with the
  reason: level, prerequisite, points), show cost, and learned actives
  carry a 1-2-3-4 picker; the footer hotbar accepts a selected skill or
  clears a slot. Empty hotbar slots show "+" and point at K.
- Character sheet: progress, vitals, offense (damage with every
  multiplier), defense, hotbar, passives, running buffs; refreshed each
  second while open.

### Spell VFX (`render/Vfx.ts`)
- `VfxSystem.play(anim, x, y, {fps, scale, tint, loop, lift, rotation,
  flat, overlay, depthBias})`: strips in the depth-sorted object layer
  (or the ambience overlay), additive, one-shots fade over their last
  third, loops run until stopped. `SkillDeps.vfx` is the only way in.
- FIREBALL is now a real projectile (`kind: 'fireball'`, animated comet
  head, ember trail) that detonates on the first foe or at the aim point
  through `ProjectileSpawn.onImpact` (area damage inside the tick) with
  the explosion strip + ground ring. Wand bolts fly the animated orb and
  burst on impact. Firewall cells loop the fire_wall strip; frost nova =
  splash + whirl ring; whirlwind = vortex; charge / rain / shadow slash
  = strike streaks; buffs = aura; flurry / slash = oriented cut arcs;
  trap detonation = explosion + ring; learning a skill rings the hero.

### Draggable windows (`ui/draggable.ts`)
- Any panel header with `.drag-handle` drags its window (pointer capture
  on the panel so re-rendered headers keep working; buttons in the header
  still click), clamped to the viewport, position remembered per window
  in `iso-arpg-ui-pos`. Wired: inventory, merchant, stash, skill tree,
  character sheet, cheat menu.

### E key symmetry + HUD cleanup
- E with the merchant / stash window open closes it; E beside the portal
  stone returns through it and E at the gate descends (no need to step in).
- Boss phase notes and the depth banner are top-anchored under the boss
  bar (`#boss-note` 96 px, `#descend-note` 60 px, sub-line 98 px).
- Overhead enemy HP bars are slimmer (26x4) and, with the level plaque and
  floating damage numbers, scale by 1/zoom (clamped) so a deep zoom never
  fills the view with bars and text (`Enemy.hudScale`, `DamageText.setZoom`).

### Live QA (Chrome, stepped sim)
Fresh mage -> K: only Fireball READY, all else LOCKED with reasons ->
learn (1 pt -> 0, auto slot 1, synergy frame) -> drag the tree 161x44 px,
off-screen drag clamped, position stored -> level 7 (6 pts) -> Whirlwind
cross-class 2 pts + Firewall 1 pt -> 3 left; Whirlwind moved to slot 4 ->
E at the stall opens, E again closes -> fireball in town: comet + ring,
cooldown 148 (200 x 0.8 synergy) -> floor 1: fireball on a foe, burn ticks
after impact -> zoom 2.2: bars/numbers hold size -> zero console errors.

## 2026-09-02 (iteration 40) - Town redesign, market square, camp heroes, buyback, skill art, level cheat

### Asset re-audit (`public/assets/test-models`, second upload: 499 files, 44 MB)
- KEEP -> baked to `public/assets/ui/` (DOM-only art; the atlas stays for
  world sprites): 16 of the 220 elemental 16 px glyphs as `skills/<id>.png`
  (x4 nearest, one per active skill), and 16 of the 62 painted 1024 px
  "Ultimate Fantasy RPG Icons" (CC0) as `items/<id>.png` (alpha-cropped,
  60 px inside 64, Lanczos): potions (red / blue / green / purple), the
  portal scroll, wooden + iron shields, bows, the ember staff, swords,
  axes, a chest.
- REJECT: the pixel "Free Medieval Fantasy UI Pack" (word buttons and 32 px
  frames in a chunky pixel style that fights the Cinzel / parchment UI;
  its icon sheets are duplicates of the singles), the pack's promo card,
  the remaining 204 glyphs and 46 icons (no matching skill / item yet -
  re-bake from the pack when one is added). No NPC sprites, houses,
  stalls or trees were in this upload; the town uses the it.39 bake.
- The raw folder was deleted after the bake; `scripts/purge-assets.mjs`
  now keeps `ui/` alongside `atlas/`.

### Town redesign (`town/TownMap.ts`, 46x40)
- A cliff ring (the map's only walls, tinted mossy rock by SceneManager)
  behind a two-deep staggered FOREST BELT; every belt tile that is not a
  tree is undergrowth (blocked) so the edge never traps anyone.
- MARKET SQUARE (N): 16x10 cobbled plaza, four canopied stalls, the
  shopkeeper behind stall A, crates / barrels / pots / hanging signs /
  signpost, torch posts at the corners; six villagers wander it.
- Streets: the cobbled main street south to the gate, an east-west high
  street, dirt lanes to every cottage, the vault and the camp.
- Two RESIDENTIAL quarters (3 cottages each) with fenced yards; the
  fence rows leave the door column open. Each cottage keeps its room
  and doorstep walkable: step in and the roof + front wall drop to 20%
  (behind stays 38%).
- STASH VAULT (NW), CAMPSITE (SW: fire, seats, the three resting heroes,
  the portal stone east of the street), the ugly animated well removed.
- DUNGEON GATE (S): a stone archway drawn in Pixi Graphics across the
  main street (piers on the two blocked tiles, voussoir ring, keystone,
  translucent throat so the hero fades into the dark), two BRAZIERS
  (pillar + scaled campfire flame + warm light), cold blue light and five
  drifting fog sprites (`TownDressing.update`). The stairwell sits under
  the arch; walking in descends.
- COLLISION AUDIT: `auditTownLayout()` flood-fills from the spawn and
  warns about any unreachable walkable tile or unreachable point of
  interest (gate, stash, stall, portal, fire, every door). Found and fixed
  in QA: two north cottages fenced shut; 80 forest pockets (now brush).

### Camp heroes (`town/CampHeroes.ts`)
- The three classes NOT chosen rest around the fire as real `Player` rigs
  (same atlases, HERO_HEIGHT scale, idle breathing) that are RENDER-ONLY:
  never in GameState, never ticked, never targetable. They face the fire
  and take the scene tint. The camp chip names them.

### Merchant fix + buyback (`systems/Town.ts`, `ui/Shop.ts`)
- Selling now moves the item to a BUYBACK counter (newest first, 8 deep,
  cleared on every restock) shown under FOR SALE; `BUYBACK` is a new
  InputCommand priced at exactly what the merchant paid. Gold math
  verified live: 300 -> sell sword +19 -> 319 -> buy back -19 -> 300.
- The Violet Elixir (+35% hp, +50% resource, 65 g) joins the staples.

### Skill art + cast FX
- `SkillDef.icon` -> `<img class="skill-icon">` in the slot (rune glyph
  is the fallback); slots wear iron plate + gold hairline + corner rivets;
  when a cooldown starts from zero the slot pops (`.cast`: scale 1.12 +
  radial gold bloom, 0.45 s).
- `ui/itemIcons.itemIconHtml()` is the one resolver for every panel
  (inventory, shop, stash, cheat arsenal): painted `art` > pack `icon` >
  generated pixel icon.

### UI overhaul (index.html, appended block)
- Double frames (iron outside, gold hairline inside) on every panel and
  tooltip, parchment ink (#eadfc8) on near-black, gold price text, gear
  cells rimmed gold, dashed rows for buyback, `button:active` at 0.72.

### Cheat menu HERO tab
- LEVEL 1-30 grid plus -5 / -1 / +1 / +5 steps -> `Player.setLevel()`
  (max HP = class base + 4/level, HP refilled, XP zeroed), sheet readout
  (xp, hp, base damage), level-up sting + burst.

### Live QA (Chrome, stepped sim)
Fresh save -> town spawn (audit clean, no console errors) -> stepped into
the west cottage: roof alpha 0.20 -> stall: sell Rusty Sword (+19),
buyback (-19), painted icons in every row -> skill 1: `.cast` flash,
cooldown 298 -> F1 HERO: level 10 (186 hp), +5 -> 15 (206 hp) -> gate
approach and arch inspected in screenshots. Camp shows Mage, Ranger,
Rogue for a Warrior run.

## 2026-09-02 (iteration 39) - Town hub (floor 0), vendors, save/load, stash, town assets

### New assets (baked from `public/assets/test-models`, then pruned)
- Audit verdict: KEEP the cottage renders (`house/rem_0002/0006/0010/0014`),
  the Ancient Isometric Tileset (ground diamonds, stalls, fence, pillar,
  trees, crates, signs, grass), Dungeon Pry placeables (barrels, chest
  open/closed), the campfire + torch sheets, the animated well, and the
  coc_chars peasant / peasantGold walk sheets. REJECT: the hob sheets (a
  goblin, not townsfolk), PSD/PNG junk exports, re-uploads of packs that
  were already atlased in it.36, and the "Alpha" edge-mask sheets (faint
  masks that only speckle a bake).
- Baked into `atlas/` by the one-shot `src/dev/TownBaker.ts`
  (`await __bakeTown()` in the browser; kept in this commit's history,
  deleted afterwards): singles `town_cobble/grass/dirt` (64x32),
  `house_a..d` (276x253 @0.28), `stall_a..d`, `fence`, `pillar`,
  `barrel_a/b`, `crates`, `stash_closed/open`, `tree_a/b`, `signpost`,
  `hanging_sign`, `grassclump`, `pots`; anims `campfire` (6 f), `torch`
  (4 f), `well` (12 f), `villager_walk` + `merchant_walk` (8 dirs x 8 f,
  96 px cells, nearest).
- Direction audit of the peasant sheets: rows run counter-clockwise from
  SW ([SW, S, SE, E, NE, N, NW, W]) -> `ROTATE_SW` row fix
  (`(d + 3) mod 8`) registered for `villager_` / `merchant_` in
  `SpriteLibrary.DIR_ROW_FIX`. Villager body height 62/57 painted
  (~44-52 px on screen; the union bounds overstate the 40 px walking body).
- The raw `test-models` folder (929 MB) was deleted after the bake.

### Floor 0 - the town (`src/town/`)
- `TownMap.buildTownLayout()`: hand-authored 34x30 square - walled
  border, cobble plaza, dirt lanes, four corner cottages (3x3
  footprints), merchant stall + shopkeeper NE, stash chest + barrels NW,
  central campfire, well, six torches, gate pillars, fences, trees,
  decals. The map is a `DungeonMap` subclass with a per-tile `tileKind`
  (cobble/grass/dirt) so the scene builder, pathfinder, lighting and
  minimap work untouched; theme `'town'` maps to `floor_town_<kind>`.
- `TownProps.placeTownProps()`: dresses the layout; standing props anchor
  at the footprint's south corner with `depthKey(x+w-.5, y+h-.5)`; the
  campfire (9 fps), torches (8 fps) and well (6 fps) loop through
  `Ambience.addLoopingAnim`; the fire and torches are `Lighting` sources
  + ember hotspots. Returns OCCLUDERS (cottages, trees) and INTERACTABLES
  (merchant, stash).
- `Villagers`: render-only townsfolk (never sim entities) that stroll a
  wander room with hysteresis facing (`stableDir`), pause, breathe; the
  shopkeeper stands behind the stall. Lit by `getTintAt(x, y, 0.8)`.
- ROOF CUTAWAY: each frame an occluder the hero stands behind (screen
  point inside the sprite's inner 76% x 90% box and hero depth < prop
  depth) lerps to alpha 0.38 (k = 1 - e^(-12 dt)), back to 1 otherwise.
- Lighting builds with `{ sightRadius: 40, fullRadius: 14 }` in town;
  music state `'town'` (the title theme, Tristram rule); gate = the
  regular stairs prop placed at `layout.gate` -> descend to floor 1.
  `updateDepth` shows THE TOWN; the first descent reads "The gate seals
  behind you".

### Economy, consumables, stash (`systems/Town.ts`, `ui/Shop.ts`, `ui/Stash.ts`)
- Items gained `value`, `use` (heal / resource / portal) and the
  `'consumable'` slot; `health_potion` (30 g, +50% hp), `mana_potion`
  (30 g, +60% resource), `scroll_town_portal` (80 g). Q / R quaff the
  first health / mana potion; clicking a consumable in the inventory uses
  it. `CombatSystem.heal()` is the second (and only other) hp mutator.
- `TownSystem`: merchant stock restocked per visit from the run seed +
  deepest floor (staples: 3 health, 2 mana, 2 scrolls; 3 gear rolls; a
  magic/rare piece past floor 3/6); buy = `itemValue`, sell = 25%.
  Commands BUY / SELL / STASH_PUT / STASH_TAKE / STASH_GOLD flow through
  the InputQueue like everything else (determinism rule intact); events
  `town:changed / traded / refused`.
- Shop and Stash panels (`.town-panel`): FOR SALE <-> YOUR PACK, gold
  purse, deposit/withdraw 100/all, shared `#item-tip` hover tooltip with
  the gold line, ESC closes (capture), click sfx. Stash = 24 slots + gold,
  owned by the SAVE SLOT (restart / change class keep it).
- Interaction: E near the stall / chest opens it (`PICKUP_NEAREST` in
  town); clicking the stall / chest walks up (`pendingInteract`) and
  opens on arrival; non-blocking chips: E TRADE / E STASH / THE DUNGEON
  GATE / PORTAL back to depth N.

### Town portal + floor memory
- Reading a scroll (outside town, not while transitioning) sets
  `pendingPortal`; the tick fades to a freshly built town, warps the hero
  to the portal stone, drops a blue rift (glow + ring + light source) and
  remembers `{floor, arena, x, y}`. Stepping off the stone arms it; stepping
  back fades to the remembered floor and spot.
- `FloorMemory` per floor key (`floor`, arena = `1000 + floor`): opened
  chest indexes, taken gold pile indexes, killed roster indexes, packed
  explored bits (base64), `arenaCleared`. `captureFloor()` runs before
  every departure (descend, arena, portal, cheat travel, save);
  `buildWorld` re-applies it: `chests.applyMemory`, taken piles destroyed,
  `spawnFloorEnemies(..., skip)` rolls the identical roster (the RNG
  stream is consumed for skipped entries) and tags `Enemy.spawnIndex`,
  `lighting.unpackExplored`; a cleared arena rebuilds empty with the
  stair open.
- Double-descend guard: `swapWorld` clears `pendingDescend` /
  `pendingArena` so a stale "on the stairs" flag from the old floor can
  never fire on the new one (found in stepped QA).

### Save / load (`persist/SaveGame.ts`, `ui/SavePanel.ts`)
- 3 LocalStorage slots (`iso-arpg-save-<n>`, version 1, ~0.8 KB each):
  seed, floor, deepest floor, playtime ticks, the sheet (archetype,
  level, xp, gold, hp/hpMax, resource, backpack, equipped), the stash,
  the floor memories. `saves.read/write/remove/list/firstFree/latest`.
- Autosave on arriving in town (spawn, portal, cheat), on opening the
  pause menu, and SAVE & EXIT; "PROGRESS SAVED" floats over the hero.
- Main menu: CONTINUE (latest slot, shown only when one exists), START
  GAME (class select -> first free slot; all full -> OVERWRITE picker),
  LOAD GAME (slot list with LOAD / DELETE). Loading restores the hero and
  starts in town; the gate leads back down, remembered floors intact.
- `?class=` test entry still drops straight onto floor 1.

### UI polish
- Panels share the Diablo frame (double gold rule, dark violet ground),
  `:active` opacity 0.75 on every button, high-contrast serif labels,
  hover tooltips with gold values on shop / stash / inventory cells,
  Q - R row in the command reference, SAVE & EXIT in the pause menu.

### Live QA (Chrome, stepped sim)
Start -> town spawn (autosave) -> E at the stall: buy Healing Potion
(500 -> 470 g), sell Rusty Sword (+19 g) -> E at the chest: potion + scroll
stashed, 100 g deposited, taken back -> gate -> floor 1 (roster 11 + kill
one, `killed = {10}`) -> scroll -> town (portal chip, floors memory `{1}`)
-> back through the rift -> floor 1 rebuilt with index 10 dead ->
SAVE & EXIT (panels torn down, no run left) -> CONTINUE -> town with 777 g,
pack, floor memory -> gate -> floor 1 still remembers. Roof cutaway 0.38
behind the NW cottage. Zero console errors; the Pixi addChild deprecation
(shadow root was a Sprite) fixed.

## 2026-09-02 (iteration 38) - Chest chip leak, menu streamlining, aim/firewall alignment

- STUCK "E OPEN": the interact chip set an INLINE opacity (0.25) during
  combat and only removed the `show` class when hiding, so a faint chip
  floated forever near the player after a chest was opened. Now a `dim`
  class carries the combat fade, the chip is cleared on `chest:opened`
  and on every floor swap. All floating text already auto-fades
  (damage numbers 0.85 s, crits 1.1 s, banners 2.6 s).
- Main menu = START GAME / SETTINGS / CREDITS. START opens the character
  selection (select card -> CONFIRM -> floor 1); the delver button is gone.
- Skills: `SkillDeps.aimPoint()` (cursor world point) + `aimTarget()` -
  aimed ground skills (Fireball, Firewall, Rain of Arrows) land on the
  foe in the aim cone, else EXACTLY on the cursor (range-clamped), never a
  fixed distance ahead. Firewall is laid across a SCREEN-perpendicular of
  the aim (world-space perpendiculars skew under the 2:1 projection),
  centered on the target, 1.15-tile cell spacing.
- Live QA: menu -> select -> confirm -> floor 1; chest E-open (chip hidden,
  no inline opacity, 2 drops); firewall perpendicular on screen (90.0 deg)
  and centered on the foe (0.00 tiles); fireball 7 dmg, frost nova 4 dmg +
  freeze. Zero console errors.

## 2026-09-02 (iteration 37) — Stability: transition freeze, direction
## remaps, slow idles, select→confirm flow, gold visibility, impact FX

### Level-transition freeze (root cause + fix)
- CAUSE: `buildWorld` awaited the atlas fetch AFTER `destroyWorld(old)`.
  With rAF live, the game loop kept ticking a destroyed world during that
  async gap → Pixi threw inside `update()` → the rAF chain died silently
  (the it.36 hidden-tab QA never saw it because rAF was paused there).
- FIX: `preloadFloor()` streams atlases while the old floor still runs;
  `buildWorld` is synchronous; `swapWorld()` builds the NEXT floor first,
  then destroys the old one (`destroyWorld` only detaches the hero if it
  still owns them). A build error keeps the player on the current floor.
- Error boundaries: the loop's update/render are wrapped (first 5 errors
  logged, loop survives); atlas preload failures fall back to procedural
  markers; a 20 s watchdog releases a stuck fade.
- Verified: stepping the loop while a preload is pending leaves the old
  floor intact (no errors); real stair descent 16→17; arena travel.

### Direction audit (ground truth, every unit)
- Rendered all 8 rows of every idle/walk atlas to a labeled grid and read
  them against the knight reference (E = right profile, N = back, W =
  left profile, S = face). Big pack (skeletons, shaman, ghast, wardens,
  Hollow King forms, mage, rogue) and the knight: correct.
- MIRRORED (E/W swapped): ranger, zombie, halberdier, werewolf, lizardman
  → `rowForDir = (4 - d) mod 8`. REFLECTED across NW–SE (E showed the face,
  W the back, S the right profile): hydra, naga, villager → `(6 - d) mod 8`.
  Fix lives in `SpriteLibrary.rowForDir` (applied at slice time); the
  post-fix grid shows all 64 cells of the 8 packs facing correctly.

### Idle pacing
- 4-frame big-pack idles (mage, rogue, skeletons): ping-pong at 2.2 fps
  (≈2.7 s breath, was 3.6 fps); long idles 5–7 fps.

### Menu flow
- START (DESCEND) always opens the character selection; a card click
  SELECTS (gold highlight), CONFIRM / Enter starts, BACK / ESC returns.
  The remembered delver comes pre-selected.
- Pause menu and death overlay gained CHANGE CLASS (tears the run down,
  reopens selection — no refresh). Credits rewritten: developer, engine
  (Pixi.js 8 · TypeScript · Vite), art, icons/type, SFX, music.

### Loot & gold
- Ground icons compact: pack icons 1.0× (≤33 px), pixel icons 0.7× (28 px);
  pick box adjusted.
- Gold piles: TREASURE mode — saturated gold tint floor with a slow
  shimmer (never sinks into the shadow ramp), stronger pulsing glow
  (alpha 1.0 × 1.35), twinkle sparks every ~0.4 s.

### Combat FX
- `Ambience.impactFlash` (additive bloom at the victim) + `slashArc`
  (crescent flashed at the victim along the blow axis, melee only) on
  every landed player hit, on top of the it.36 sparks/blood/trails.

### QA
- Menu → select → confirm → floor 1 → stairs 16→17 → cheat/arena travel
  → change class from pause and death → restart → credits. Zero console
  errors, no loop-boundary reports, no 404s.

## 2026-09-02 (iteration 36) — Studio overhaul: atlas purge, main menu, run
## lifecycle, unit scale standard, UI visibility, audio map, VFX

### Asset audit → bake → purge (the load-time fix)
- Baseline: boot fetched ~6,000 raw frame files (2.5 GB store on disk,
  330,558 files); the loading screen cleared at **~50 s** in dev.
- Every animation the game renders was baked FROM THE RUNNING GAME into
  grid atlases (`src/dev/AtlasBaker.ts` + a dev-only `/__bake` Vite
  endpoint, commit 07c386cd): renderer-extracted textures (rebakes,
  paperdoll composites, the tone-baked stairwell all preserved), alpha-
  cropped per anim with Pixi `trim/orig` keeping every anchor valid, and
  the ≤0.42-scale packs (zombie/hydra/wolf/lizard/guard/shambler) baked at
  half resolution. 89 anims + 19 singles, 49 MB. Denser frame picks for the
  packs that had the frames on disk (zombie 12/16/16/12, ranger 12/12/16/8/15,
  naga/guard/hydra/shambler/wolf/lizard likewise).
- `SpriteLibrary` rewritten as an atlas registry with `ensure()` lazy
  loading; `manifest.json` carries painted bounds per anim.
- PURGE: `scripts/purge-assets.mjs` moved 217 entries / 2,921 MB out
  (all raw sprite packs, the unused Foozle/Copings/Temple/Large-Wall/vfx/
  effects packs, dummy `tiles/sprites/paperdoll/ui` folders, the 0-byte
  voice-actor stubs, every unmapped TomMusic/Horror file, the unused
  dark-magic-4 track and stray wav). `public/assets` is now 96 MB / 235
  files: `atlas/` + the mapped audio + README. `.gitignore` whitelist and
  the PAGES publicDir hack retired (public/ copies normally).
- RESULT (production build, `vite preview`): DOMContentLoaded 0.2 s, menu
  shown at **0.81 s** with **206 KB** transferred (9 requests); a run
  starts ~1.0 s after PLAY (hero rig + floor-1 roster); later floors
  stream under the fade in 20–700 ms and the next floor prefetches.

### Main menu, character re-selection, restart flow
- `main.ts` split into BOOT (once) and `startRun()` → `RunHandle.destroy()`:
  every EventBus subscription, timer (`later()`), UI panel, DOM listener
  (AbortController), world, player and `state` are torn down; HUD resets.
  RESTART RUN / RETURN TO MAIN MENU / a different hero never reload the tab.
- Title screen (`ui/MainMenu.ts`, ember canvas): DESCEND (remembers the
  last delver in localStorage) · CHOOSE YOUR DELVER (cancellable class
  select with BACK/ESC) · SETTINGS & CONTROLS (settings panel now carries
  the full control table + CLOSE) · CREDITS.
- `ui/RunMenus.ts`: ESC pause (loop stopped, music ducked; RESUME / SETTINGS
  / RESTART / MAIN MENU) and the DEATH overlay after the death animation
  (RISE AGAIN at the entrance / RESTART / MAIN MENU). Epilogue gained MAIN
  MENU; DELVE AGAIN restarts in place.
- Verified: pause→resume, death→rise, restart (1.9 s), exit→menu leaves 0
  panels / 0 skill slots / `__game` null, warrior→mage→ranger→rogue swaps.

### Idle repair + unit height standard
- `render/animUtil.idleFrame`: time-based; 4-frame big-pack idles (mage,
  rogue, every skeleton) PING-PONG at 3.6 fps — no more snap from the last
  frame to the first; long idles loop at 6–8 fps. Player idle clock is a
  render wall-clock (was per-render-frame, so frame-rate dependent).
- Scale is DATA now: `HERO_HEIGHT = MOB_HEIGHT = 56`, `BOSS_HEIGHT = 128`
  (× `heightMult` flavor) over the manifest's painted idle height. Measured
  in-game: warrior/mage/ranger/rogue all 56 px (mage/rogue were 43, knight
  56 before); skeleton 56, fallen 48, zombie 60, hydra 70; Tomb/Frost
  Wardens and all three Hollow King forms 128; Ember Maw 102.
- Walk `stride` is now CYCLES per tile (frame-count independent).

### UI visibility pass
- Inventory/cheat slot tiles lit (radial highlight + 2 px border), rarity
  glows (magic blue / rare gold box-shadows), icon drop-shadows, dashed
  empty slots; `ui/itemIcons.ts` redrawn as 20×20 shaded pixel icons
  (bow, wand, helm, shield, mail, greaves, cloak) from a 5-step ramp of the
  item color with metal/wood/gold accents.
- Hint banner slightly transparent; tooltip opaque; all overlays remain
  `pointer-events: none` except real buttons.

### Audio + procedural VFX
- `AudioManager` music state machine (`setMusic`: menu / dungeon / boss /
  victory, 1.4 s element crossfades, ambience only with the dungeon bed,
  `duck()` for modals). Title theme = "Whispers of the Abyss", epilogue =
  "Cursed Citadel". Combat/horror banks decode when a run starts (`preloadRunBanks`),
  not on the title screen. New SFX: uiHover/uiClick/uiConfirm/uiBack, pause/
  unpause, inventory book open/close, map open/close, hero select, rare
  pickup (gem), gold gather takes, equip clack, level-up heart.
- `Ambience.sparks()` (additive impact flecks on every landed blow, bolt
  impacts, gold) and `Ambience.trail()` (ember smear behind bolts, dust
  behind arrows, emitted from `Projectiles.updateRender`). Dynamic floor
  shadows: `Lighting.lightDirAt` + `setShadowLight` stretch each unit's
  grounded ellipse away from the dominant light.

### QA (hidden-tab automation; `__game.travel` dev hook = timer-free floors)
- Warrior/mage/ranger/rogue runs; floors 1–20 all spawn fully-sprited
  rosters (no marker fallbacks); arenas 5/10/15/20: Tomb Warden kill → stair
  reveal → descent to 6; Frost + Ember arenas build with boss music per
  floor; Hollow King all three phases (summons at P2) → arena clear → stair
  → THE CRYPT IS CONQUERED with victory music → MAIN MENU → new run.
- Zero console errors/warnings across the whole pass; no 404s after the purge.
- Hidden-tab caveat: Chrome throttles timers to ~1/min after 5 min hidden,
  which is why the dev hook bypasses the fade timers for automation.

## 2026-09-01 (iteration 35) — Full troubleshooting session (no code changes)

End-to-end real-play QA on a fresh seed (1234): class select by real card
click → click-to-move (2.2 tiles) → click-on-enemy hitbox → auto-approach
→ kill (+8 xp, level-up to 2 mid-boss-fight) → gold pickup (+22) → chest
E-open + E-loot + equip → stairs descent 4→5 → arena threshold teleport →
REAL Tomb Warden fight (gravecleaver + Whirlwind, held-Space swings) →
seal correctly HELD with one fleeing archer alive (touching the hidden
stair did nothing) → click-chase killed the kiter → clear → reveal →
descent to 6 → UI toggles (I/L/O/M) → cheat TRAVEL to Arena XX → phase-1
pool burst → knight form P2 with fresh full pool. Zero console errors.

Two apparent failures were test artifacts, both correct behavior:
(1) clicking an enemy behind a wall does nothing — fog gates targeting
(and a debug warp had put the player INSIDE a wall); (2) held-button
attacks don't pursue a kiting archer — click-to-attack is the pursuit
command by design.

## 2026-09-01 (iteration 34) — Ranger vector remap, hero scale normalization,
## idle pacing, dynamic portraits

### Ranger 8-dir GROUND-TRUTH remap
- Rendered every stored ranger_run row to a labeled on-screen grid and
  read the true facings: the it.23 half-turn list was still 90° off
  (slot E showed S, N showed E, S showed W — consistent (d+6)%8 error).
- R_ANGLES fixed at the SOURCE to ['270','315','000','045','090','135',
  '180','225'] — hero AND archer mob corrected together. Re-rendered the
  grid post-fix: all 8 canonical dirs now face their movement vectors.

### Hero scale normalization (measured painted heights)
- Alpha-scanned idle frames: knight 58u@0.92≈53u (baseline; big-pack mobs
  ≈55u; bosses 128–134u = 2.4–2.5× — preserved). Mage was 111u@1.1≈122u
  and rogue 112u@1.1≈123u (the "too tall" bug), ranger 167u@0.42≈70u.
- New rig scales: mage 0.48, rogue 0.48, ranger 0.32 → every hero ≈53u,
  verified on-screen beside skeleton mobs.

### Idle jitter fix
- Sheet-hero idle clock 0.12→0.05/render (~3 fps): the 4 unevenly-sampled
  big-pack idle frames now read as slow breathing; stepping is monotone
  0→N with modulo wrap (frame() already wraps — no clamp/bounce).

### Dynamic hero portraits
- Cheat menu portrait = classPreviewFrames(archetype) (alpha-cropped,
  animated); CheatMenu draw simplified to contain-fit.
- Inventory paperdoll body = the chosen class's idle anim at per-class
  PORTRAIT_SCALE (≈78px painted for all four); armor tint warrior-only.
- Skill-bar always-on name plaques hidden (they overlapped; tooltips
  carry the names).

### Audit: ranger dir grid pre/post, all four in-game heights vs mobs,
### mage/rogue idle pacing, ranger+rogue portraits in both menus.
### Zero console errors.

## 2026-09-01 (iteration 33) — Select previews, distinct rogue, aim casting,
## dash lock, trap object, tooltips, cheat travel

### Character select
- LIVE ANIMATED previews per card: S-facing idle frames extracted, ALPHA-
  CROPPED to painted bounds and drawn at one fixed height — automatic
  scale unification across all four heroes on the select screen.
- ROGUE REPLACED (user: too close to the warrior): hero1 dropped for a
  big-pack paperdoll composite — BaseHumanMale + DrkPant + DrkStudLeth +
  DrkBoot + DrkHood + Dagger + LeftKuhkri: a hooded DUAL-WIELD shadow.
  compositeCamAnim generalized to take a layer list.
- In-game scale parity: mage/rogue 1.1 (148px composites) ≈ knight 0.92.

### Ranger direction audit
- Frame-by-frame walk tests (A/W/D): facings CORRECT in this build — the
  it.32 3x-scale bug made directions unreadable; scale fix resolved it.
- Real fix shipped: untargeted swings/shots now aim at the MOUSE CURSOR
  (Combat.aimDir, wired in buildWorld) — the draw no longer plays toward
  stale facing when firing at air.

### Skills
- Rich hover tooltips on the action bar (name · cost · cooldown · effect;
  .skill-slot pointer-events restored for hover only).
- TARGETED CASTING: SkillDeps.aim() (cursor world vector); takeAim() turns
  the hero and drives charge/firewall/shadowstep/shadowslash/multishot and
  the fireball/rain target cones.
- EXPLOSIVE TRAP: visible gold rune + glow (zoneVisual dep) that detonates
  with ring bursts + glint and cleanly despawns; firewall cells now carry
  persistent flame glows; rain shows a target sigil. Zones own dispose().
- Cleave widened: reach +0.4, arc 55°→70° per side — verified one swing
  hitting a 3-enemy cluster.
- FX pass: double steel rings (whirlwind), double nova ring, impact ring
  on fireball, shadow puffs on vanish/shadowstep.

### Dash wall-collision lock
- dash() now steps 0.1 with corner-aware canStandAt and snaps to tile
  center if ever embedded — verified 6 consecutive dashes INTO a wall all
  ending on legal ground.

### Chest label & cheat menu
- #interact-hint dims to 0.25 opacity while anything is chasing (already
  pointer-events: none).
- Cheat menu: TRAVEL tab (20 floor buttons + 4 arena buttons, closes over
  the fade; verified instant jump into the Ember Maw's arena), smooth
  scrolling; arsenal already lists the full ITEMS catalog.

### Zero console errors across every pass.

## 2026-09-01 (iteration 32) — 4 playable classes, skill system, asset audit

### Asset audit (public/assets deep-scan)
- NEW packs parsed: "Frames_320x320 hero1" (leather swordsman, 21 anims —
  the ROGUE hero, half-turn angle rotation like the lizard pack);
  512x512 (three-headed CRIMSON HYDRA, naga-style 0-based angle folders,
  16 angles); x256_Spritesheets (RISEN VILLAGER shambler, 16 grid sheets
  per anim, zero empty cells audited). effects/ + vfx/ noted for future.
- MAGE hero is a big-pack PAPERDOLL COMPOSITE: BaseHumanMale + RobesMage1
  + MageHood2 + MageStaff1 stacked per cam/frame and baked at load
  (compositeCamAnim). Layer health size-audited (tiny hood/staff frames
  are legit accessories, not blanks).
- CALIBRATION TRUTH (finally measured): rebake helpers KEEP original
  texture dims — def/rig scales multiply RAW frame size. Reference table:
  archer 320@0.36, wolf 320@0.42, big pack 148@0.62. New: shambler
  256@0.4, hydra 512@0.36, ranger hero 320@0.42, mage 148@1.1.

### 4 playable classes (Player refactor)
- CLASS_RIGS per archetype (idle/run/attacks[]/hit/death + scale/anchor/
  shadow): warrior=HD knight (unchanged), mage=composite, ranger=bow pack,
  rogue=hero1 (3 cycled attack anims). enableKnightRig picks by class with
  knight fallback; syncKnight generalized to per-anim frameCounts.
- ARCHETYPES extended: armorBase, critBonus, attackSpeedMult (rogue 0.75),
  dodgeChance (rogue 0.12/ranger 0.05, rolled in enemyStrike), resource
  pool (mage MANA 120 else STAMINA) + per-tick regen, class default
  weapon (mage wand/ranger bow/rogue katana) + base damage.
- Class select overlay (#class-select) before the run; `?class=` bypass.

### Active skills (src/systems/Skills.ts): 16 skills, hotkeys 1–4
- SKILL InputCommand + Digit1–4 bindings; per-slot cooldowns; resource
  costs; HUD action bar (#skill-bar: glyph, key, cost, cooldown sweep +
  seconds, insufficient-resource graying) + resource bar by the orb.
- Warrior: Whirlwind (r2.2 AoE 1.4x) · Charge (4-tile dash, path damage
  + knockback) · War Cry (+35% dmg 10 s) · Stone Skin (55% DR 7 s).
- Mage: Fireball (r1.8 burst at nearest foe) · Firewall (5-cell line DoT
  6 s) · Frost Nova (freeze r3, bosses immune) · Arcane Intellect (+45%).
- Ranger: Multishot (5-arrow fan) · Shadow Step (dash + haste) ·
  Explosive Trap (armed mine, r1.9 detonation) · Rain of Arrows (5 waves).
- Rogue: Blade Flurry (4 staged cuts) · Poison Blade (hits envenom, DoT
  via combat:swing hook) · Vanish (untouchable+unseen 5 s; enemies lose
  LOS via EnemyAIDeps.isPlayerHidden) · Shadow Slash (dash-through 1.8x).
- All rolls go through the floor's seeded combat rng (Combat.rng getter);
  dealDamage gained damageMult (source=player) + damageReduction hooks.
  New sfx cases (skillWhirl/Dash/Shout/Buff/Fire/Arrows/Trap/TrapSet/
  Poison/Vanish) from the TomMusic + Horror banks.

### Verified live: all 16 skills fired with costs/cooldowns/FX per class;
### rogue flurry staged 4 cuts; mage soak (fireball 77 crit, firewall
### kills, nova freeze); ranger 5 arrows in flight + trap/rain kill;
### warrior whirl/charge/buffs; class-select screen + card start; shambler
### (d7) + hydra (d16) in rosters, sized and facing right; F20 3-phase
### boss regression intact. Zero console errors on all passes.

## 2026-09-01 (iteration 31) — GitHub private repo + Pages deployment

### Asset curation (the blocker)
- Raw public/ is ~2.5 GB / 303,517 files; one 142 MB WAV exceeds GitHub's
  hard 100 MB limit — a raw push is impossible. `.gitignore` whitelists
  EXACTLY what the game loads (mirrors SpriteLibrary/AudioManager, down to
  zombie `picks()` frame numbers): 15,334 files ≈ 347 MB, none >90 MB.
  Untracked on purpose: paperdoll layers, BMP twins, macOS `._*` stubs,
  empty voice-pack folders, unused ambient WAVs, `se_ku…wav`.

### Pages plumbing
- vite.config: `PAGES=1` → base `/isometric-game/` + `publicDir: false`
  (never copy 2.5 GB into dist). Runtime asset roots now derive from
  `import.meta.env.BASE_URL` (AudioManager AUDIO_BASE, SpriteLibrary ROOT).
- `npm run deploy` → scripts/deploy-pages.mjs: PAGES build, copy the
  git-tracked public/ subset into dist/, `.nojekyll` (folders with spaces/
  parens would break under Jekyll), publish via gh-pages branch.

### Repo
- gh CLI installed via winget; device-flow login (keyring token unreadable
  cross-process on this Windows → re-login `--insecure-storage`;
  `gh auth setup-git` for pushes). Repo:
  https://github.com/IlliaKomissarov/isometric-game (main).
- Windows gotchas fixed in deploy: `core.longpaths true` (LOP pack paths
  overflow MAX_PATH in gh-pages' internal clone); the gh-pages npm package
  replaced with native git plumbing (15k paths on one command line →
  spawn ENAMETOOLONG).
- Pages on a PRIVATE repo → HTTP 422 on the Free plan; user chose to make
  the repo PUBLIC. Pages enabled from gh-pages branch, LIVE and verified
  in-browser (game boots and plays):
  https://illiakomissarov.github.io/isometric-game/
  Note: a cold-CDN 503 on first-ever load skipped the big pack for that
  one session (graceful guard); warm reload was clean.

## 2026-09-01 (iteration 30) — Final boss: 3 forms, 3 hp pools, death/rebirth

### The Hollow King fight rebuilt as a def CHAIN (`nextPhase` on EnemyTypeDef)
- bossHollow (P1, pool 300) → bossHollowKnight (P2, 260) → bossHollowLich
  (P3, 220). Threshold-fraction phases and attackHaste REMOVED.
- NEW MODEL registered: SkeletonWarrior10 as hollow2_* (horned-helm armored
  war-knight; heaviest unused skeleton in the big pack — size-audited, ALL
  anims healthy incl. 2_Attack). Three fully distinct bodies:
  P1 zombie colossus (melee) · P2 war-knight (melee, grave-gold 1.5) ·
  P3 lich (ranged kiting, scale 1.05→1.5 — uniform LARGE presence).

### Death-and-rebirth transitions (`action: 'transition'`, new Entity state)
- Pool empties → entity:died is INTERCEPTED by beginPhaseTransition():
  no xp/loot/clear. PHASE_DIE_TICKS(150): full death anim of the fallen
  form; def swap + applyRig at the boundary; PHASE_RISE_TICKS(120): the
  NEW form's death anim in REVERSE (rises from the grave) under the ember
  pulse. hp stays 0 throughout — dealDamage's guard = invincibility (and
  untargetable). Rebirth: fresh 100% pool, minion wave, boss:phase.
- Arena-clear counter treats a transitioning boss as alive
  (`hp > 0 || action === 'transition'`).

### Per-phase boss bar
- Notches (segmented pool look) hidden for the phased boss; fill recolored
  per form (default green-rot / grave-gold / pale sorcery); label
  "· PHASE n/3". Transition: bar drains to 0 through the death, then
  visibly refills with the rising body.

### Verified live (F20): pool 1164→0 → transition (damage ignored), swap at
### tick 150, rise, P2 fresh 1009 @100%, P2→P3 same, lich kites (3.6) with
### 6 volleys/400t, final death → clear → victory. F5 regression: Tomb
### Warden dies normally (no intercept). Zero console errors.

## 2026-09-01 (iteration 29) — Hitbox recalibration, lich model swap, instant teleport

### Entity hitbox / targeting recalibration
- pickEnemy's fixed 22×68 family box made tall bosses clickable only near
  the feet ("targets below the model"). New `Enemy.clickBox()` derives the
  box from the LIVE body: texture size × rig scale × anchor (width narrowed
  to 30% for pack padding, min halfW 16). Verified: Tomb Warden box spans
  −138..+37 px vs old −68..+8 — head AND torso clicks target him; small
  mobs scale down correctly (fallen −67..+19); empty air above misses.
- Test-driver gotcha: synthetic PointerEvents at 125% page zoom scale
  clientX→offsetX by 0.8 — multiply dispatched coords by 1.25.

### Floor 20 phase overhaul — REAL MODEL SWAP (tint phases removed)
- phaseTint/phaseScale/AoE slam deleted (boss:slam event removed).
- P1–2: heavy melee colossus (P2 "QUICKENS": haste 0.72 + wave).
- P3 ≤33%: `this.def = ENEMY_TYPES.bossHollowLich` + `applyRig()` — the
  boss physically swaps to SkeletonMage1 (skelm_*, scale 1.05, bone-white
  0xe8e2d0) and AI flips to ranged kiting (range 7, kiteMin 3.6, bolt
  projectiles, windup 38/recover 30, speedMult 0.66). Bar → "TRUE FORM",
  banner "THE HOLLOW KING SHEDS HIS FLESH!". applyRig extracted from spawn.
- Verified live: def/texture/scale swap at 30%, kited 2.2→3.6 tiles, 6 bolt
  volleys in 400 ticks, lich death → clear → victory overlay.

### Instant arena teleportation (no stair interaction)
- Boss floors have NO stairs: the farthest room IS the chamber; a crimson
  seal glow + red light burns at its center (world.stairs carries the seal
  sprite). `world.arenaThreshold` = the room rect; the tick loop teleports
  the player the moment their tile enters it. Verified on 5/10/15/20.

### Zero console errors across all four boss floors.

## 2026-09-01 (iteration 28) — Boss arenas, multi-phase Hollow King, boss music

### Sealed Boss Arena system (floors 5/10/15/20)
- Boss-floor stairs are now a PORTAL: touching them teleports (withFade)
  into a dedicated arena world — `generateArenaMap` (30×22, one vast open
  hall, zero internal clutter), candelabra hearth ring (8, TILE_BLOCKED),
  same theme band. Bosses NO LONGER spawn on the base floor.
- Arena spawns the keeper (BOSS_LADDER/BOSS_LEVELS, now module consts) at
  the east end plus a 5-mob honor guard from `kindPoolFor(floor)`.
- Exit stairs are HIDDEN (`renderable=false`, fog-unregistered; placeStairs
  gained `{hidden, at}` opts and returns its sprite) until EVERY combatant
  — keeper, guard, summons — is dead. Clear beat: reveal + burst + glint +
  gateOpen + "THE WAY OPENS" (gateOpen moved out of the boss loot beat).
- Floor-20 victory now requires the FULL arena clear (stairs gate).

### Multi-phase Hollow King (def flag `phases`, replaces old `summons`)
- P2 ≤66%: sickly-green recolor (phaseTint over scene light), 1.09× scale,
  attackHaste 0.72 (effective windup/recover getters), minion wave.
- P3 ≤33%: enrage — red recolor, 1.18×, haste 0.52, +6 damage, wave, and a
  260-tick AoE ground slam (reach 3.4) with `boss:slam` ring-burst FX.
- `boss:phase` FX: horn + roar, quake, gore, banner, bar → "· PHASE II" /
  "· ENRAGED". New events in EventBus.

### Boss fight music (public/assets/audio/boss fight — 6 tracks scanned)
- Per-floor map: 5→Shadowforge Convergence · 10→Veil of Eternal Nightfall
  · 15→Eclipsed Desolation · 20→Dread March (filenames keep their spaces).
- `audio.setBossMusic(on, floor)`: ~1.4 s element-volume crossfade against
  bgm+ambience, play-retry vs autoplay policy, routed through the BGM bus.
  In on entering the arena; out on full clear (and on any normal build).

### Verified live (seed 42, floors 5/10/15/20): portal teleport, sealed
### open arenas, per-floor tracks, hidden→revealed stairs, arena descend
### (5→6), P2/P3 stats+bar+waves, slam cadence, F20 victory overlay only
### after full clear. Zero console errors.

## 2026-09-01 (iteration 27) — Warden attack-frame fix, audio density boost

### Tomb Warden idle/attack invisibility — ROOT CAUSE FOUND
- Mithras's `2_Attack` (and `3_Bow`) PNGs are BLANK 0.7 KB exports across
  all 8 cameras (the .bmp twins hold the pixels but lack alpha) — the boss
  had literally no attack pixels, vanishing for the entire windup ("stands
  still, then invisible"). His `4_Cast` PNG set is intact and reads as a
  poleaxe lunge → mithras_attack now loads 4_Cast. Verified live: 400-tick
  probe (392 attack ticks) + two mid-attack captures, fully visible,
  alpha 1.0 throughout. LESSON: size-audit a pack's PNGs per-anim (blank
  exports hide inside healthy folders).

### Audio density boost (it.27)
- Stinger scheduler: check 6s→4s, skip-roll 0.45→0.25, quiet window
  16–36s→9–20s — ambient triggers land roughly twice as often.
- Enemy voices: anti-chorus 90→70 ms, volumes +0.05.
- NEW combat voice heartbeat: every ~2.5 s one nearby chasing enemy speaks
  (species growl/hiss/moan) — combat never falls silent. Render-only.

### Verified live — zero console errors (floor 5 engagement).

## 2026-09-01 (iteration 26) — Warden stability, Frost wight, gold glow, SFX round 2

### Tomb Warden "flicker/invisible" — diagnosed & fixed
- 480-tick live probe of the ALIVE boss showed zero anomalies (alpha 1.0,
  texture always set, smooth light tints) — the reported glitch was the
  DEATH sequence: the hard tint strobe read as flicker, and the fade to
  alpha 0 before corpse-spawn left an invisible body. Fix: continuous
  sine-mixed ember PULSE (verified: 71 distinct smooth tints, no flips)
  and an alpha floor of 0.55 — the corpse replaces the body seamlessly.

### Boss roster & mobs (big pack round 2)
- Floor 10: the Frost Warden now wears its OWN body — the robed WIGHT
  (SkeletonWarrior4, hoarfrost tint, 1.35×). Mithras is exclusively the
  Tomb Warden (floor 5). Verified distinct at L13.
- NEW mob 'Grave Guard' (shield-bearing SkeletonWarrior7), depths 6+ —
  verified 5 on floor 12 alongside the full existing roster (nothing
  removed). Both use the proven CAM_FOR_DIR mapping (no reversed walks).

### Gold visibility & pickup
- Piles now carry a pulsing additive GOLD GLOW + scale 1.8 (visible on
  dark floors). PICKUP BUG FIX: the fog-gated loop anim used to resurrect
  hidden piles — collected piles are now DESTROYED (sprite + glow), with
  destroyed-guards in Ambience loops/glows. Verified: instant despawn.

### TomMusic deep-scan round 2 (all banks verified decoded)
- gateOpen → the barred stair grinds open at the boss loot-beat ·
  firespray → the Ember Maw's bossCast · bowBlocked → arrows clattering
  off stone (non-flesh impacts) · unsheath → equipping a weapon (UI tick
  on unequip). Previously mapped banks unchanged.

### Verified live — zero app console errors (floors 5/10/12 + probes)

## 2026-09-01 (iteration 25) — The Big Pack, Horror SFX hard-map, cursor-at-boot

### /assets/big pack 8 moves — indexed & integrated
- A full layered character system: base bodies + ~400 equipment overlays +
  complete models. Naming {seq}_{Anim}_CAM{0-7}_{frame}.png, 148×130,
  frames idle[20..40]/attack[60..78]/cast[140..158]/walk[180..200]/
  run[220..238]/death[261..280] (shared across models, verified). CAM0
  faces WEST → CAM_FOR_DIR=[4,3,2,1,0,7,6,5]. Loaded directly (no rebake).
- INTEGRATED: SkeletonWarrior1 = the Risen Blade's real bones · BaseAhoul
  = NEW "Ahoul Ghast" (fast melee, depths 2+) · Shaman7 = NEW "Blood
  Shaman" (bolt caster, 4+) · SkeletonMage1 = NEW "Marrow Warlock" (bolt
  caster, 10+) · MITHRAS the minotaur = the Tomb AND Frost Wardens' new
  non-knight body (bronze / hoarfrost tints, scale 1.35 after live calib).
- Spawn pools rebalanced across 1–20 with the new species (verified:
  floor 3 = 9 ahouls; floor 11 = 7 shamans + 5 warlocks casting).
- Skipped: Panther (one unsegmented 78-frame blob — no attack/death
  mapping possible), Rot (24 flat files, not a character).

### /assets/audio/Horror SFX Free — hard-mapped (36 buffers verified)
- 11 banks: hScream/hZombie/hGrowl/hGrunt/hHiss/hRoar/hGore/hHurt/hMoan/
  hStinger/hAmbience. enemyVoice(state,pitch,bank): species → bank
  (zombie=hZombie, ahoul+wolf=hGrowl, lizard+Ember=hHiss, warlock=hMoan,
  humanoids=hGrunt with hScream deaths, wardens=hRoar). Crits + ≥12-dmg
  hits tear with hGore; hero sometimes gasps (hHurt); bossSeen/bossDie
  ROAR; stinger scheduler now rotates piano stingers, long creepy
  ambiences, creaks, and moans on the amb bus (non-overlap kept).

### Cursor freeze fix + resize
- Root cause: the pointer style was injected AFTER the ~1-min asset load,
  so a post-victory reload showed the system pointer on a dead-looking
  loading screen ("cursor stops working past the boss floor").
  `installCursor()` now runs FIRST, before any loading. Pixels 2→1.7×.

### Gotcha repeated & fixed
- A PowerShell -replace pipe mojibake'd Enemy.ts AGAIN (the it.17 gotcha).
  Reversed via cp1251 round-trip. RULE: never edit source with PS text
  pipes — Edit tool only.

### Playtest (floors 3/5/11, zero app console errors)
Ahouls flank correctly; Mithras towers at L7 facing the player; shamans
visibly cast glowing bolts; horror buffers 36/36; global cursor live.

## 2026-09-01 (iteration 24) — Direction audit (ALL packs), voice-pool probe, orb/cursor

### Full direction audit — the vendor-wide half-turn
- Frame-by-frame audit of every pack's angle convention proved ALL FOUR
  angle-tree packs (guard 320x320, wolf x320p1234, lizard Frames_320x320,
  naga 256x256) share the ranger's 180° inversion: their angle-0 frames
  face WEST (triangulated: guard 090=S, 270=N). Every angle list now
  carries the half-turn rotation ['180','225','270','315','000','045',
  '090','135']. Knight, LoP, and zombie (E=E, verified) were correct.
- Live proof: guards square up chest-to-chest with the player; the wolf,
  lizard, and naga all orient AT their targets mid-combat.

### Voice-pack auto-discovery (the numbered folders)
- TRIPLE-VERIFIED: all 10 numbered folders hold 555 macOS ._AppleDouble
  stubs and ZERO files >1KB — no audio data was ever copied in.
- Built `probeVoicePack()`: at unlock it probes damage/death/grunting/
  shouting/miscellaneous ({stem}_{n}_{actor}.wav, 5 actors × 10 takes),
  decodes whatever exists into randomized pools that TAKE PRIORITY over
  the beast-slice voices (hurt/die/idle/attack) and feed ambient stingers.
  The instant real files land, they map with zero code changes.
- New 'attack' voice state: species grunt on every enemy strike frame.

### UI
- Orb segment stripes REMOVED (user reversal) — clean smooth fill again.
- Cursor enforced GLOBALLY: injected `* { cursor: url(...) !important }`
  — the gothic pointer covers canvas, panels, buttons, sliders; no system
  pointer anywhere. (No cursor art exists in assets — searched again.)

### Pre-flight pass (bands via 12/15, prior iterations cover 1/5/16/20)
Zero console errors; facings verified in combat; orb clean; global cursor
style tag present; boss level plaque L18 at depth 15.

## 2026-09-01 (iteration 23) — Level matrix, archer facing, segmented bars, voices

### Strict level scaling matrix
- Enemy.spawn now takes a LEVEL; hp = base×(1+0.12(L−1)), damage bonus
  = round(1.0(L−1)), xpValue = (baseHp/6+3)×(1+0.08(L−1)) — everything
  derives from level, nothing else.
- Floor-N mobs are level N; ~15% spawn as rares at N+1 (verified floor 3:
  29×L3 + 6×L4). Boss milestones: 5→7 · 10→13 · 15→18 · 20→25 (verified:
  Tomb Warden L7, 722 hp). Hollow King base hp 800→650 for the L25 mult.
- Player curve: xpToNext = 140+8L (full floor clear = 3 levels, retested
  live: 35 kills → +3); per level +4 maxHP, 25% heal, +0.25/+0.35 dmg.

### Archer sprite direction FIX
- The x320p bow pack's angles run 180° OPPOSITE the other sheets — she
  walked/shot backwards. R_ANGLES rotated half a turn
  (['180','225','270','315','000','045','090','135'] for [E..SE]).
  Verified: she now draws toward the player.

### Enemy voice density (species-pitched)
- New `audio.enemyVoice(state, pitch)`: idle-growl / hurt-bark / death-cry
  as FRESH random beast-recording slices at a per-species pitch (zombie
  0.62 … lizard 1.35, bosses 0.55) with ±12% jitter — non-repetitive.
  90 ms anti-chorus throttle. NOTE: the uploaded voice-actor pack is STILL
  0-byte ._stubs (rescanned) — real files will slot in 1:1.

### Segmented HP UI
- Enemy bars: 32×5 notched quarters with top sheen + "Lv N" plaque
  (Pixi Text, shows with the bar). Hero orb gained quarter-notch divider
  overlay. Boss bar: taller, ornamental ◆ caps, 10% notches, glow, and
  "NAME · LVL N". Gold reads "◆ GOLD: n" on the HUD and "Gold: n" in the
  inventory.

### Cursor v3
- Obsidian blade-arrow, full gold edging, crimson gem inset (2× nearest).

### Verified live — zero console errors
Level histogram, boss L7 bar + plaque, 3-level floor clear, archer facing,
segmented orb/bars on screen, cursor style applied.

## 2026-09-01 (iteration 22) — XP levels, gold, enemy vocals, UI scroll, balance

### XP / leveling (Player.ts)
- XP strictly from kills: xpGain = round(enemy.hpMax/6)+2, granted
  SYNCHRONOUSLY in the entity:died handler (deterministic — damage grows
  from levels, so this is sim-relevant).
- Curve: xpToNext = 30 + 20L + 3L² (fast early, ~L18 by depth 20).
- Per level: +8 max HP, heal 30% of max, +0.5/+0.7 min/max damage folded
  into weaponProfile (levelDamageMin/Max).
- LEVEL-UP FX: gold burst + glint + shake + "LEVEL UP!" floater + the
  Firebuff shimmer & rising chime ('levelUp'). Verified live at L2.
- HUD: LVL plaque + gold-gradient XP bar + gold counter on the bar
  (#progress-hud); orb reflects grown max HP.

### Gold
- Props gold piles are now COLLECTIBLE (returned as GoldPile[] with
  seeded 8–25 amounts). Walking within 0.75 scoops: sprite hides, coins
  clink ('gold' = Lock-Unlock sped bright ×2), "+Ng" floater, HUD +
  inventory counters update. Verified: 17g pile → gold 17 everywhere.

### Enemy vocals (and the empty voice pack)
- NOTE: the uploaded "1–10" voice-actor pack contains ONLY 0-byte macOS
  ._metadata files — no audio data survived the copy. Slots are ready
  ('enemyHit'/'enemyGrowl'); re-copy the real WAVs to upgrade.
- Meanwhile: 'enemyHit' pain-bark + 'enemyGrowl' aggro-growl are sliced
  from the beast recording; new `enemy:aggro` event fires when an idle
  enemy first notices the player.

### UI scrolling
- Level select: rows wrapped in .lvl-scroll (56vh, thin scrollbar) —
  verified 744px of floors scrolling in a 358px viewport.
- Cheat menu items now show DETAILED STATS under each name (statLine:
  damage/armor/range) in the existing scroll region. Inventory backpack
  scroll retained; gold shown in the panel header.

### Balance pass
- Enemy hp curve 0.35/floor → 0.22/floor (depth 20 ≈ 5.2× vs old 7.7×);
  enemy damage bonus 2.0/floor → 1.2/floor. Pairs with level damage so
  late floors stay dangerous without sponging (trash ~4 s, tank-zombies
  ~12 s at depth 20 for an on-curve hero).

### Verified live — zero console errors
XP floaters + bar %, L2 level-up burst/banner/HP-growth, gold pickup end
to end, level-select scroll metrics, cheat stats render, enemy growl/
grunt paths executing.

## 2026-09-01 (iteration 21) — Enemy audio, layered ambience, full-system audit

### Enemy combat audio
- 'enemySwing': every enemy melee strike frame whooshes (Sword Attack bank
  at 0.38 vol / 0.85 rate — slower and heavier than the player's, so the
  ear tells who is swinging). Ranged foes already sound bow/bolt at launch;
  landed hits ring the armor clang + freeze crackle. Verified live: a
  floor-12 brawl fired enemySwing×8, hit×4, bow×2, arrowHit×2.

### Dynamic layered ambience (own channel)
- New AMBIENT bus (masterGain → ambGain) beside music and SFX, with its own
  Settings slider ("Ambience", persisted).
- Bed: the Fantasy pack's Cave.ogg loops quietly under everything.
- STINGERS: every 6 s a scheduler MAY fire one distant atmosphere — a door/
  gate groan (creak bank at 0.7–0.95 rate) or a far-off beast breath slice.
  NON-OVERLAP: a quiet window (16–36 s) after each stinger guarantees they
  never stack; a 20 s hold after unlock lets the intro land first.

### Full-system audit (seed 77, fresh run) — ALL PASS, zero console errors
- Combat AoE: grouped pair (d=1.0) both damaged by one swing sequence.
- Ranged AI kiting: point-blank archer retreated to exactly 3.11 tiles
  (kiteMin 3.2), stayed visible, stood and fired.
- Layouts 3–20 = 1–2 generator: verified XII (frozen) + XVI (ember) —
  identical rooms, band tints only; level-select hints name every band.
- Auto-stairs + boss lock: proven it.20 (on-stairs unlock the tick hp=0).
- Light radius: full warm pool around the hero on deep floors.
- Inventory grid + animated paperdoll canvas: present and cycling.
- Cheat menu: 15-item weapons bank in a live scroll region.
- Floor-12 roster: wolf5/archer9/guard4/zombie4/lizard5 — full band mix.

## 2026-09-01 (iteration 20) — Fantasy SFX pack, stair/boss-lock proof, hit-box audit

### 1. Stairs & boss lock (verified, no code gap found)
- Live proof on depth 5: standing ON the stairs with the boss alive holds
  the floor; the tick its hp hits 0 the descent fires AUTOMATICALLY (the
  proximity check runs every tick, so the unlock is immediate — no click,
  no re-touch). Standard floor 6→7 auto-descended on touch likewise.

### 2. Fantasy SFX pack fully mapped (TomMusic upload)
- New VARIANT-BANK engine: 13 banks × 2–5 takes (36 oggs), random take +
  ±7% pitch jitter per play — the one-sample-many-pitches ARPG standard.
  All banks verified decoded live. Synth blips demoted to decode-failure
  fail-safes only.
- MAP: swing/whiff=Sword Attack 1-3 · hit=Sword Impact 1-3 ·
  crit=chop 1-4 + impact layer · hurt=Sword Blocked (armor clang) ·
  bow=Bow Attack · arrowHit=Bow Impact · bolt=Fireball 1-3 ·
  boltImpact=Spell Impact · freeze=Ice Freeze (Frost Warden slow, fires
  when slowTicks refreshes) · pickup=Sword Sheath stow · chest=Chest Open
  1-2 · stairs=three descending Stone Run footfalls · ui=Sword Parry tick
  (quiet, 1.85×) · NEW player FOOTSTEPS=Stone Run 1-5 on the onStep hook.
- Kept from the drone set: beast groans (enemyDie slices), doom+magic6
  (bossDie), war-horn (bossSeen), chant (summon), reveal/bgm/bgmDeep.
- Volume balance: steps 0.2, ui 0.14, whiffs 0.35, hits 0.85, crits 0.95.

### 3. Math & collision audit
- FIXED: enemy click hit-box assumed 48px bodies — bosses render ~150px,
  so upper-body clicks fell through. Now 22×68 (×zoom), feet-anchored.
- Audited clean: stairs touch radius 0.8; STRIKE_REACH ≥ selection range
  (livelock rule); AoE arc dot ≥ 0.57 at same reach; canStandAt 4-corner
  collider (r=0.28) + radius-aware separation + per-tick bounds clamp;
  chest interact 2.2; armor math max(1, dmg−armor); enemy strike-frame
  range re-check (+0.15 grace). No lag paths found; all triggers tick-driven.

### Verified live — zero console errors; all 20 sfx triggers execute clean.

## 2026-09-01 (iteration 19) — Proximity stairs, tone-matched staircase, sampled combat audio

### 1. Stairs = proximity trigger
- The descent now fires the moment the player TOUCHES the staircase
  (distance < 0.8 to the tile center) — no exact tile-center landing, no
  clicking. Verified live: warping into touch range auto-descended 1→2
  through the fade. The ONLY transition gate anywhere remains a living
  warden on its own boss floor (by design).

### 2. Staircase tone-baked into the floor grid
- Full asset audit re-confirmed: no pack carries a floor-matching
  descending staircase (Temple Kit has none; the deleted Stairs pack only
  ascended). The REAL Infernus Stairs_Inverted stays, but its cool grey
  stone is now TONE-BAKED per-pixel (×0.62/0.53/0.40 warm multiply) into
  the stone-floor palette at load — it sits in the grid seamlessly
  instead of popping bright.

### 3. Sampled combat audio (synths demoted to fail-safes)
- MEASURED every provided file in-browser (duration + peak envelope) and
  discovered the truth of the library: dark-magic-4/-6 are sharp ONE-SHOT
  IMPACTS (transient in the first ~1.5 s, then silence), se_ku*.wav is a
  3 s front-loaded slash body, beast-breathing yields organic groans,
  unleashed-demon is a doom swell.
- New `playSlice(key, offset, dur, rate, vol, jitter)`: carves punchy
  one-shots from the recordings with ±rate jitter (one sample, many
  pitches — the classic 16-bit trick) and a 40 ms declick tail.
- COMBAT MAP (all real audio): swing/miss = slash slices at 1.8×/2.1×;
  hit = magic-6 transient at 1.6×; crit = full magic-6 + slash layer;
  bow = fast slash chirp; bolt = magic-4 cast; arrowHit = micro magic-6;
  hurt = magic-4 transient (distinct timbre from dealing damage);
  enemyDie = RANDOM beast-groan slice pitched low; bossDie = doom swell +
  magic-6 boom; chest = full slash body slow. Pickup/UI/stairs/victory
  keep chip-blips (idiomatic for menus/loot). Synth paths now run ONLY if
  a buffer failed to decode.
- Depth-band BGM: floors 10+ swap the mystery theme for the gloomy
  demonic drone (`setBgmDeep`); both real tracks.
- Verified: all SEVEN buffers decode live (beast/chant/doom/horn/magic4/
  magic6/slash); slice playback paths run clean; zero console errors.

## 2026-09-01 (iteration 18) — The Audio Phase + the real staircase

### Audio system (engine/AudioManager.ts)
- Web Audio graph: master → bgm/sfx gain buses; volumes + mute persist in
  localStorage ('iso-arpg-audio'). Unlocks on the FIRST user gesture
  (autoplay policy); a rejected first play re-arms on the next real
  gesture (`retryOnNextGesture`). Render-side only.
- REAL TRACKS wired (public/assets/audio): mystic-reveal = intro sting →
  dark-mystery-cinematic = looping BGM; war-horn = boss sighted;
  dark-magic-4 = fire-bolt cast; dark-magic-6 = boss-death undertone;
  dark-spell-chant = Hollow King summon. All four SFX buffers verified
  decoded in-browser. (Unused, untested: se_ku*.wav — unknown content;
  the three alesiadavina drones are future ambience candidates.)
- SYNTH VOICES (Web Audio oscillators + filtered noise, retro fidelity)
  for every essential effect: swing/miss whooshes, hit thump+crack, crit,
  bow pluck, arrow impact, player hurt, enemy death, pickup/chest/stairs
  blips, UI click, 4-note victory fanfare. 60 ms per-name throttle stops
  AoE/pack spam from clipping.
- Triggers: combat:swing (whiff/crit), entity:damaged (hit/hurt),
  entity:died (enemyDie/bossDie), fireProjectile + enemy shootArrow
  (bow/bolt), projectile:impact (flesh), pickup, chest, floor fades
  (stairs motif), bossSeen (horn), summonMinions (chant), endgame
  (fanfare), UI toggles (Inventory/CheatMenu/LevelSelect/Settings).

### Settings UI (ui/Settings.ts, O key)
- Master / Music / Effects sliders + Mute checkbox, gold-accented panel,
  persisted; audible tick feedback while sliding. COMMANDS row added.

### The REAL staircase
- Found it: `Infernus_Tiles/Building_Infernus_1/Stairs_Inverted_1.png` —
  a pre-rendered DESCENDING stairwell carved into a tile diamond, 64 px
  wide = exactly TILE_W. placeStairs uses it (procedural pit = fallback).
  Verified in-scene: carved steps sinking below floor level.

### Verified live (fresh tab, seed 42) — zero console errors
Settings panel renders + persists; audio graph builds, all file buffers
decode, sfx() calls clean; staircase sprite placed at the stairs tile.
HARNESS NOTE: extension canvas clicks do NOT deliver pointerdown to the
page in an occluded tab — audio unlock was verified with a synthetic
dispatch (ctx builds, stays 'suspended' until a real gesture, by design).

## 2026-09-01 (iteration 17) — Presentation revert: one pipeline, real stairs, boss beats

### 1. Depths 3–20 = the floors-1-2 pipeline, tint only
- The Temple Kit material path is RETIRED (load + builders removed). ALL
  depths render through `buildStoneEnvironment`, which now bakes the base
  set plus three banded sets differing ONLY by a subtle multiply tint:
  `_deep` 0xb2acc0 · `_frost` 0x9cb2dc · `_ember` 0xd2a488. Identical
  geometry, shading, seams, variants — palette is the only variable.
- Crack-decal overlays REMOVED (read as "broken tile placement"); the
  stone variants' baked hairline cracks are all the wear the ground needs.
- ENCODING GOTCHA: a PowerShell line-splice (`Get-Content`/`Set-Content`)
  mojibake'd the file's UTF-8 (— → вЂ”); fixed by reversing through
  cp1251. Use the Edit tool for TS surgery, not PS text pipes.

### 2. A real descending staircase
- `stairs_down` rebuilt as a classic-ARPG sunken stairwell: five lit stone
  treads with dark risers stepping toward the far corner, converging false
  perspective, masonry side flanks, black passage threshold, stone rim
  aligned to the tile diamond. Tread tones match the floor material so it
  connects seamlessly.

### 3. Extended boss death (a victory beat)
- Boss deathTicksTotal 110 → 240 (~4 s). Render: collapse anim across the
  first ~55%, then the body HOLDS its final frame strobing hot (slower
  strobe), turns pale 0xfff1d8, and fades over the last 18%.
- main: EIGHT growing explosion pulses across the collapse (200 ms + i*340,
  spread and count scale up), then the LOOT BEAT at 3.3 s: 3 rares + glint
  + a 20-particle gold burst + kick/shake — the reward lands only after
  the body burns down.

### Verified live (fresh tab, seed 42) — zero console errors
Depth VI and XVI render exactly like floor 1 with cool/ember casts; the
staircase reads as recessed descending steps beside live combat; the Tomb
Warden's death ran the full strobe → hold → pale → fade arc with the loot
glyph appearing at the delayed beat.

## 2026-09-01 (iteration 16) — Designer corrections: collision rule, purges, UI bar

Reference: d07RiV/diabloweb (Devilution WASM port) — D1 conventions applied:
bottom control-panel HUD, collision-bearing clutter, descending stairwells.

### The Diablo collision rule + clutter purge
- NEW INVARIANT: every standing prop HAS COLLISION or does not exist. Flat
  ground paint (cracks, gold, corpses, blood) stays walkable by design.
- `TILE_BLOCKED` tile type: blocks movement/pathing, passes sight/light,
  renders floor under the prop. `planHearths(map)` marks hearth corners in
  the grid BEFORE scene/pathfinder build (main), so collision, rendering
  and prop placement agree. SceneManager.isOpaque = walls only.
- Candelabras stand on blocked tiles — verified walkable:false/opaque:false.
- PURGED walk-through standing clutter: rubble piles, broken-column stumps,
  grave shards, bone/gore heaps, the boss-stairs altar, the dragon-skeleton
  centerpiece ("screen-blocking"). Props.ts rewritten around the rule.
- SPINNING-PROP FIX: the candelabra sheet's 3×4 cells are ROTATION POSES,
  not flame frames — cycling them spun the prop ("spinning llamas"). It now
  uses ONE static cell.
- STAIRS DESCEND: procedural `stairs_down` — banded stairwell pit sinking
  into pure black with lit tread lips + stone rim. The ascending Stairs
  pack contradicted the descent and was deleted.
- Depth 3+ layout confirmed identical to 1–2 (bands + hearths only).

### AI & bosses
- Flee logic: cowards STOP at a safe distance (idle-stand) instead of
  marathoning into corners; a CORNERED flee-er latches `desperation` and
  fights to the death. Archers already stop-and-shoot (it.13 kite fix).
- FINAL BOSS REBODIED (user: no knight): The Hollow King is now a MASSIVE
  rotting colossus — the zombie cinematic pack at 0.58 (512px frames →
  ~150px on screen, 3× the knight), grave-pale tint, full anim set.
  The orc loads were benched (pack intact, unused).

### UI / cursor / text
- Bottom HUD BAR (#hud-bar): full-width stone strip; orb seated on it,
  DMG/ARM plaque beside, condensed two-column COMMANDS docked right.
- Cursor: hand-pixeled gothic pointer (obsidian outline, row-shaded steel,
  gold trim edge, 2× nearest) injected as a data-URL; SVG dagger removed.
- Text pass: endgame prose tightened ("The wardens have fallen, their
  crowns are ash… The dark will remember your name."), stats line
  capitalized, boss-gate line reworded, level-select hints now name the
  frost/ember bands.

### DELETED ASSETS (per the it.16 deletion protocol)
- 256x256/FireBreath (960 files) — WRONG CREATURE in the naga pack (the
  morph glitch source).
- Stairs (36) — every variant ascends; contradicts the descent.
- coc_chars (25) — RTS cartoon style, palette mismatch.
- Angle (144) + Isometric (144) — duplicate library furniture with baked
  grey drop shadows that clash with the lighting model.
- Boxes (8) — diamond-packed sheet, glitchy crops (purged from the game in
  it.11; files now removed).
- 8 Directional Greatsword Knight Character (48) — no death animation
  (violates the full-anim mandate).

### Verified live (fresh tab, seed 42) — zero console errors
HUD bar + orb + condensed commands; stairs-down pit reads as a hole;
static candelabra; hearth tile blocks movement, passes sight; Hollow King
colossus towers ~3× the knight at depth XX; clean rooms, no floating
clutter. Boot is faster (orc + Infernus prop loads gone).

## 2026-09-01 (iteration 15) — Game-feel overhaul: FX, endings, Infernus kit

### Environment & rendering
- STRUCTURAL REVERT (user-directed): depth 3+ layout generation matches
  floors 1–2 again (the it.14 pillar/minRoom flavor is off; `DungeonFlavor`
  kept for the future). Depth identity = theme bands + prop dressing.
- THEME BAKE FIX: the translucent retint overlay occasionally failed to
  bake during a busy boot → raw bright sandstone floors. Retints are now
  MULTIPLIED into the texture fills (`fill({texture, color})`) — atomic,
  race-proof. New band tones: deep 0x7e7890 / frost 0x5c74ac / ember 0x96604a.
- WALL FLICKER FIX: cutaway fade now has HYSTERESIS — held walls release
  only past looser depth/overlap thresholds (depthMargin −2 enter / +10
  hold, 14px rect padding), so boundary walls stop strobing.
- FOG CULLING FIX: creatures on NEVER-SEEN (black) tiles are strictly
  invisible; the 8-neighbor fallback now applies only on EXPLORED tiles
  (kills the halberdier-floating-over-void bug, keeps the cornered-archer fix).

### Combat feel
- MELEE AoE CLEAVE: the swing rolls against every other enemy within reach
  and ~55° of the strike direction (independent to-hit + damage, no crit
  double, standard knockback). Verified: one swing damaged 3 grouped mobs.
- SCREEN SHAKE: trauma-based (`Camera.addShake`, displacement ∝ trauma²,
  max ~5px) on ≥10-damage hits, player crits, boss deaths. Subtle by design.
- Particles: steel sparks on every landed player hit; crit spark burst;
  all prior systems (motes, mist, blood, glint) intact.
- DRAMATIC BOSS DEATH: 110-tick collapse with hot strobing tint, 5 staged
  blood/fire explosions + shakes over ~1.3 s, then a loot explosion (3
  rares + glint + kick). Guarded against floor changes mid-sequence.

### UI & endings
- ANIMATED PAPERDOLL: the inventory character cycles real idle frames
  (armor tint + slot gems baked per frame; interval-driven canvas).
- NEW CURSOR: built at boot from the REAL oubliette steel-falcon blade
  sprite — 2× nearest-neighbor, rotated tip-up-left, dark halo. (No cursor
  pack exists in assets; this uses genuine pack art.)
- FLOOR FADES: descend/jump wrapped in `withFade` (fade to black 300 ms →
  rebuild → fade in). Re-entry guarded.
- ENDGAME: real epilogue — screen sinks to black over 2 s, gold title,
  prose, run stats (depths/time/king), DELVE AGAIN button (fresh seed).

### Infernus kit integration (new upload)
- `inf_altar` looms behind boss-floor stairs; `inf_grave1/3` haunt depths
  3–14; `inf_bones` (6+) and `inf_gore` (15+) litter rooms; the CANDELABRA
  (3×4 flame-flicker sheet) stands at every hearth (elegant light bodies —
  the crude bonfire stays banned); ONE great DRAGON SKELETON (rebaked 0.35)
  lies across the largest hall of every ember-depth floor.
- Skipped with reasons: Greatsword Knight atlas (no death anim — zero
  tolerance), Angle/Isometric library furniture (baked grey drop shadows
  clash), remaining Infernus building tiles (future full-tileset swap).

### Verified live (fresh tab, seed 42) — zero console errors
Depth V boss arena: altar + rune grave + candelabra + Tomb Warden; full
death sequence (strobe, staged bursts, banner, loot). Inventory knight
animates (two poses captured). Depth XVI: ember halls + dragon-skeleton
centerpiece + gore. AoE cleave: 3 mobs hit in one swing (loop.step-driven).
Endgame overlay complete with stats + button. Cursor style applied.

### Testing gotcha (reaffirmed)
Chrome fully throttles rAF in occluded automation tabs — the game loop can
FREEZE mid-test (tick stuck). Drive verification with `__game.loop.step(n)`
instead of real-time waits; keyboard-dispatch tests silently no-op while
frozen.

## 2026-09-01 (iteration 14) — Deep-level rescue, roster completion, collision & gore

### 1. Deep dungeon redesign (no more identical floors)
- THEME BANDS: 1–2 stone crypts · 3–9 buried temple (`_deep`) · 10–14
  frozen halls (`_frost`, blue-steeped) · 15–20 ember depths (`_ember`,
  heat-scorched). One shared material, three baked looks
  (`AssetManager.buildThemedSet`); `SceneManager.FloorTheme` extended.
- ARCHITECTURE: `generateDungeon` gained `DungeonFlavor` — depths 3+ carve
  PILLAR COLONNADES inside ≥7×7 rooms (spacing 3, inset 2, centers kept
  clear, 25% crumbled away; carved AFTER corridors so connectivity holds);
  depths 10+ get grander rooms (minRoom 5). Enemy/chest spawns skip pillar
  tiles.
- RUIN DRESSING (Props): per-room cracked-tile decals (3 variants), rubble
  piles, and broken-column stumps with fallen drums — all fog-registered.

### 2. Roster completion + broken-anim extermination
- MORPH GLITCH PURGED: the 256x256 pack's FireBreath folder is a DIFFERENT
  creature (a dragon) than its Idle/Walk/Attack/Hit/Death (naga). Vyrissa
  now uses her spear `Attack1` as the bolt-launch anim; FireBreath is
  banned from loading. She is a consistent serpent-maiden at every angle.
- NEW MOB **Moon-Cursed Ravager** ('wolf'): armored werewolf axe-berserker
  (x320p_Spritesheets1234 grid sheets — idle/run/attack/hit/death), fast
  melee elite, depths 6+.
- NEW MOB **Ashscale Duelist** ('lizard'): crested lizardman scimitar
  raider (Frames_320x320 per-frame tree — BattlePose/Run/GroundAttack/
  HitStomach/DeathFallBack), depths 10+. Its AERIAL set (Air_Fly etc.)
  remains unloaded — a future flying elite.
- SIZE NORMALIZATION: guard 0.3→0.42 (the "tiny spearman"), archer
  0.3→0.36, naga 1.15→1.0, wolf 0.42, lizard 0.4.
- Depth-banded spawn pools: each band introduces new flesh (1 / 2–3 / 4–5 /
  6–9 / 10+ rosters — 7 regular kinds + 4 distinct bosses).

### 3. Corner collision / wall-clipping fix
- `EnemyPool.separate` now uses radius-aware `canStandAt` (tile-center
  checks let shoves wedge collider EDGES into wall corners).
- Enemy.update starts with a TIGHT BOUNDS CLAMP: any body that ends up in
  an illegal collider position snaps to its tile center, or the nearest
  walkable neighbor center — nothing can remain inside a wall mesh.

### 4. Visceral blood + combat infographics
- `entity:damaged` now carries the blow's direction; `Ambience.bloodSpray`
  flings 7–18 dark arterial droplets along that axis (30% splash back),
  4 mixed reds, gravity; deaths add a 22–34 droplet radial blowout on top.
- Existing: floating damage numbers, gold CRIT! banner, hit-flash, corpse +
  stain permanence — all confirmed still firing.

### Verified live (fresh tab, seed 42)
Zero console errors. Depth V: pillared halls + cracks. Depth XII: FROST
band + broken column + rubble + Ashscale/Ravager fighting. Depth XV: EMBER
band + consistent naga (no morph) + normalized guard. Directional blood
visible against walls. All packs loaded without warnings.

## 2026-09-01 (iteration 13) — Final polish: light, fire purge, asset audit, menu overhaul

### 1. Level 3+ darkness fixed
- FOG_RADIUS 8→9, LIGHT_FULL_RADIUS 3.4→4.5, LIGHT_SHADOW_RGB lifted
  [24,26,38]→[36,38,54] (explored/edge tiles readable, still cold).
- Temple retint overlay alpha 0.46→0.30 — deep floors clearly legible now.

### 2. Fire purge → crypt mist
- The bonfire anim + orange glow blob REMOVED everywhere (user: "ugly fire").
  Braziers are now invisible warm hearths: `lighting.addSource` + hotspot
  ember motes only. SpriteLibrary no longer loads the Bonfire vfx.
- NEW atmosphere: 12 ground-hugging "crypt mist" patches (`fogPatch` soft
  ellipse texture, cool tint 0x8f96b4, drift + breathe, light-gated alpha)
  in Ambience — subtle, never clutters.

### 3. Ranged AI corner bug + CRIT
- Kiting archers only retreat while `moveDirect` actually moves them; a
  cornered archer now stands and fires point-blank instead of pressing
  invisibly into the wall. Render fog-gate fallback extended to all 8
  neighbor tiles (diagonal corners).
- Max-damage weapon rolls now read as crits (`combat:swing` result 'crit';
  only true crit rolls still double). A gold "CRIT!" banner floats above
  the damage number ((x-0.4,y-0.4) world offset = straight up on screen).

### 4. Comprehensive asset audit → 3 NEW fully-animated creatures
- `256x256` pack = a CRIMSON DRAGON (16 angles × 20-24 frames, FireBreath!)
  → **Vyrissa, the Ember Maw**, the Depth XV boss (FireBreath = her ranged
  attack anim). Frames 0-based, rebake 0.5, def scale 1.15, anchorY 0.62.
- `320x320p_Frames` pack = armored ORC BERSERKER (Armed/Unarmed/Roar/Block
  sets) → **The Hollow King's** unique body (Depth XX). 1-based frames,
  rebake 0.4, def scale 0.55 (bakes stay 320px!), anchorY 0.7.
- `320x320` pack = armored HALBERDIER → **Crypt Sentinel**, new regular mob
  on depths 4+ (reach 1.7 polearm). def scale 0.3.
- Loader: generic `rebakeAnglePack` for `<Anim>/<Body>/<angle>/` per-frame
  trees; angle order [0..315] ⇒ dirs [E,NE,N,NW,W,SW,S,SE] (ranger rule).
- Still unexplored & usable later: Frames_320x320 (FLYING creature — Air_Fly/
  Air_Death/Combos), x320p_Spritesheets1234 (block-capable knight),
  coc_chars (RTS-style sheets, palette mismatch), effects/*.png spell
  sheets, vfx/Effect_* (BloodImpact, SmallHit/BigHit 30/60fps trees).
- Library decision: NO new deps — Pixi v8 + the existing depthKey/rebake
  pipeline already covers sorting/movement/frames; an isometric lib would
  duplicate engine code.

### 5. Cheat menu overhaul
- Redesigned as the "Forbidden Arts" panel: ANIMATED idle knight portrait
  (pre-extracted canvases, 180 ms cadence, cropped feet-down), 2×2 powers
  grid, categorized arsenal browser (WEAPONS/ARMOR/RELICS tabs) with its
  own scroll region, per-item give buttons with real icons + rarity edges,
  "TAKE ALL <category>" — nothing clips or overflows at any item count.
- Hooks now: giveItem(id) + items() metadata + portraitFrames().

### Verified live (fresh tab, seed 42)
Zero console errors across all scenarios. Floor 1 + XX visibly brighter;
no fire objects anywhere; mist subtle; CRIT! banner fired (gold, above the
doubled 6); Sentinel fights on floor 4; dragon looses bolts at XV; orc king
at XX attacks, dies, and leaves his sprawled corpse + rare drops; archer
kites visibly and stops retreating at walls; cheat tabs/give-all verified.

### Gotchas
- The 320-px packs bake at ~source size regardless of rebake scale — ALWAYS
  measure `body.texture.width` live and calibrate the def scale to it.
- After an HMR reload of SpriteLibrary-heavy modules the canvas can boot
  as a WHITE screen (texture bakes race the reload in an occluded tab).
  It is transient: hard-reload the tab. Production builds don't HMR.

## 2026-08-31 (iteration 12) — Light, mob variety, combat text, cheats, 20-floor arc

### 1. Warm hero light (user: "harsh darkness")
- `config`: FOG_RADIUS 7→8, LIGHT_FULL_RADIUS 2.6→3.4.
- Additive warm halo sprite (`playerHalo`, tint 0xffa050) rides the hero's
  interpolated position in the ambience layer, breathing gently.
- Scene-tint floors raised: enemies minBase 0.35→0.5 (dim-neutral fallback
  0x6b6472), player 0.55→0.7. Entities are readable in every corner now.

### 2. New mob packs (user: "stop showing only knights!")
- **Rotting Ghoul** (zombie kind): dedicated `/assets/zombie` pack — real
  WALK/IDLE/ATTACK/DYING cinematics, 8 directions, rebaked 0.28. NOTE: the
  rebaked frames are 512×512 canvases; sprite scale 0.26 (NOT ~0.8) puts the
  ghoul just above knight height. anchorY 0.78.
- **Dread Archer** (archer kind): `/assets/x320p_Spritesheets` ranger pack —
  Idle/Run/Attack(draw-and-loose)/Hit/Death bow sheets, 320px cells,
  `ownShadow: true` (no baked shadow). Cells stayed 320px → scale 0.3.
- Fallen/skeleton remain palette-tinted knight variants (full anims).
- Animated **bonfire** (16-frame vfx pack loop, 12 fps) replaces the
  procedural brazier pedestal; brick **stairs** sprite from the Stairs pack
  (black background chroma-keyed to alpha on a canvas at load — the sheet
  ground is OPAQUE black).

### 3. Floating combat text + weapon math
- `render/DamageText.ts`: pooled Pixi Text; enemy dmg bone-white, player dmg
  blood-red, crits large gold, misses small grey. Crit styling rides a
  `lastCritTarget` remembered from `combat:swing` (emitted just before
  `entity:damaged`).
- Damage already flows through per-weapon min/max, family crit chance,
  armor-flat-reduction (min 1) — numbers shown are post-armor.

### 4. Cheat menu (F1 / backquote)
- `ui/CheatMenu.ts` + hooks in main: God Mode (enforced inside
  `CombatSystem.dealDamage`, survives floor transitions via `cheatState`),
  Full Heal, Give All Items, Slay Visible Enemies (fog-gated 99999 through
  the legal damage path), Reveal Floor (`lighting.revealAll()` + minimap).

### 5. Exact game arc: 20 depths, unique boss every 5
- `MAX_DEPTH = 20`. Depth V: **The Tomb Warden** (unstaggerable spin).
  Depth X: **The Frost Warden** (hits apply 3 s slow — `player.applySlow`,
  speedMult ×0.55, icy tint). Depth XV: **The Ember Warden** (ranged
  fire-bolt caster, `projectile: 'bolt'`). Depth XX: **The Hollow King**
  (1.5×, summons 2 Ember Wretches at half hp via `summonMinions` dep).
- Boss bar shows the specific boss's name on first sighting. Level select
  caps at XX and names each keeper. Standing on the depth-XX stairs after
  the Hollow King falls shows the "THE CRYPT IS CONQUERED" victory banner.

### 6. Speed, blood, corpses, vector purge
- PLAYER_SPEED 3.9→4.3.
- `leaveCorpse` rework: the death animation's LAST frame (per renderDir)
  stays as a permanent ground-layer corpse + 2 randomized dark-red splat
  stains, both `lighting.registerProp`-managed.
- Ground drops of non-pack gear now use `itemIconTexture` (generated pixel
  icons) — the vector diamond glyphs are gone. Loot light-tint is now
  light-only (icons are pre-colored).

### Verified live (fresh tab, seed 42)
Zero console errors on boot and after every scenario. Damage numbers (hit/
miss/99999), cheat menu buttons all functional, ghoul/archer scale + facing
correct, bonfire animating, keyed stairs clean, corpse + stains persist
after despawn, Frost slow measured (slowTicks 155, speedMult 0.52), Ember
Warden verified at XV, Hollow King summons verified (2 Wretches at half hp),
victory banner fired on the depth-XX stairs.

### Gotchas for future agents
- `player.warpTo` does NOT refresh fog — call `lighting.updateVisibility`
  after a scripted teleport.
- Rebake results differ per pack: measure `body.texture.width` in the live
  game before trusting a sprite `scale` (zombie 512px, ranger 320px cells).

## 2026-08-31 (iteration 11b) — Boss floors (user-directed) + temple lift

- Temple floor darkening overlay 0.62→0.46 (user: floors were too dark).
- BOSS FLOORS: every 5th depth is "the warden's crypt" (level-select hint
  included). Thinner regular packs; **The Tomb Warden** spawns before the
  stairs: 1.35× blood-crimson knight, 420 hp (scaling per 5 floors),
  16–26 damage, 54-tick telegraphs into the MeleeSpin arena sweep,
  hitRecoveryTicks 0 = unstaggerable.
- The stairs are BARRED while the Warden lives (tutorial hint on attempt);
  its death drops 3 guaranteed rares in a circle, fires the glint, an
  8-strength camera kick, and the gold "THE WARDEN FALLS" banner.
- Boss health bar (#boss-bar) reveals on first sighting, tracks hp, hides
  on death. World carries `boss`/`bossSeen`.
- Verified at ?depth=5: gate held, fight engaged (bar shown, player bled
  85→71), scripted kill dropped falcon_edge + gravecleaver + dawnhammer,
  banner fired, stairs descended to DEPTH VI. Zero console errors.

## 2026-08-31 (iteration 11) — Map purge, mob validation, QoL, level select

### Purges (zero-tolerance quality rules)
- Crate props REMOVED: the Boxes sheet is diamond-packed; my grid-guess
  crops produced the "glitchy boxes". Dropped until frames are mapped.
- Temple material re-sampled from a clean, fully-opaque region of the DEMO
  render (the raw kit tiles have transparent diamond corners → the streak
  artifacts on depth-3 floors). Depth III now reads clean obsidian halls
  with gold-brick walls.
- LoP skeleton mobs PURGED (static attacks violated the animation mandate):
  ALL four enemies are knight-sheet variants with full attack/hit/death
  animations — Ember Wretch (0.68×, ember), Risen Blade (0.78×, bone),
  Hollow Knight (0.88×, dusk), Dread Archer (0.76×, frost — the CastSpell
  sheet IS its draw-and-loose, synced to the arrow's strike frame).
  Idle enemies play live idle frames (no frozen statues anywhere).

### Animation smoothness
- Direction HYSTERESIS (`stableDir`, 32° threshold) for the player and all
  sprite mobs — kills the sprite-flip jitter when running along diagonal
  sector boundaries (the main source of "jittery running").
- Weapon slash arcs now scale by family (katana whisper → halberd sweep)
  and blend the weapon's identity color on hits.

### Interaction & UI QoL
- E is now INTERACT: nearest of ground loot / unopened chest gets the
  walk-up-and-use. Chests glow with a pulsing gold halo and show an
  "E — OPEN" chip when the player is within 2.2 tiles.
- Inventory stacks duplicates (quantity badge, first-instance equip) and
  every icon is now real art or a generated pixel icon (`ui/itemIcons.ts` —
  canvas-drawn 14×14 pixel shapes: bow/helm/shield/chest/legs/cloak). The
  diamond-gem placeholders are gone.
- LEVEL SELECT (L): jump between unlocked depths; best depth persists via
  localStorage (guarded). Unlocks on every real descend.

### Bug fixes
- Invisible-when-cornered enemies: fog gating now falls back to 4-neighbor
  visibility when an entity's center drifts onto an unseen wall tile
  (knockback/separation corner case), with a dim-neutral tint fallback.

### Verified (seed 777)
Depth III clean; stacking badge + pixel bow icon + katana icon in the grid;
L-menu with three themed rows; instant jump to Depth I; E-interact opened a
chest from the prompt (2× Doombringer!); zero console errors; typecheck clean.

## 2026-08-31 (iteration 10b) — Full arsenal + temple depths (user-directed)

User decisions: full weapon arsenal; Temple Kit as the DEEP-floor tileset;
pacing untouched pending their playtest.

### The arsenal (items/catalog.ts)
Five weapon families with distinct combat character (WEAPON_FAMILY):
- katana: fast (12/14 ticks), 18% crit, short reach.
- axe: heavy chop (22/26), high damage.
- mace: 18/24, EVERY hit staggers (forceStagger bypasses the threshold).
- polearm: reach 1.9–2.0 — strike before they close; swings the spin anim.
- blades/bows/wands unchanged.
Nine new items (War Axe → Dawnhammer → Warden Halberd → Falcon Edge…), every
one with its REAL oubliette pixel icon in the grid AND on the ground
(icon glyphs light-tinted only — their own colors stay true).
Combat honors per-weapon crit, stun, and reach; strike reach auto-extends
past selection range (livelock rule); approach range = weapon reach.

### Temple depths (floors 3+)
The Temple Kit's brickwork (sampled from the kit sheet, re-baked into a
repeatable texture) fills floors/walls under a heavy cool retint —
obsidian-and-gold-vein temple halls, unmistakably deeper than the stone
crypts of floors 1–2. `?depth=N` debug param starts on any floor.
Verified live at DEPTH III: distinct theme, zero console errors.

## 2026-08-31 (iteration 10) — Critical overhaul: anims, environment, grid UI

New packs discovered on rescan: Boxes (crates), Copings, Temple Kit,
oubliette_weapons (172 pixel weapon icons).

### Animation enforcement (no half-baked mobs)
- The warrior-zombie was DISCARDED (no attack frames) → the tank is now the
  **Hollow Knight**: knight sheets tinted corrupted dusk (0x77606a, ×0.88) —
  full Run/Idle/Melee/TakeDamage/Die animations, verified mid-swing live.
- Demo skeletons (fallen/skeleton/archer) got an ANIMATED attack: slow
  walk-cycle steps through the rear-back, then a violent forward surge —
  no more frozen-statue strikes. Death/hit frames generalized to any
  frame count via `lib.anim(name).frameCount`.
- Pacing: PLAYER_SPEED 4.5→4.0 t/s; run stride 7.5→5 frames/tile (~1
  cycle per 3 tiles — grounded cadence); enemy strides −25%.

### Environment from packs
- Walls now TEXTURE-FILL the pack's stone with per-face directional shading
  (`AssetManager.buildStoneWall`) — architecture and floors share one
  material. Procedural flat walls retired (fallback only).
- Blue arcane floor runes DROPPED (palette discipline — they fought the warm
  tone); waystone glow shifted violet→warm gold; rooms gain dark-variant
  wooden crates from the Boxes pack (edge-hugging clutter, fog/lit).
- Crisp SVG data-URI cursor (dark steel blade, gold edge) replaces the
  default arrow on the canvas.

### Inventory: icon grid + extracted stats
- Equipment = labeled 3×2 slot cells; backpack = scrollable icon grid.
  Weapons show REAL oubliette pixel icons (nearest-rendered <img>); armor
  shows crisp item-colored gems; rarity colors the cell border.
- Stats moved OUT of the panel entirely: an always-visible "DMG x–y · ARM z"
  readout beside the health orb (`#char-stats`, owned by InventoryUI).

### Combat finalization
Hybrid controls + weapon-timing + hit feedback declared LOCKED. All four
mobs verified with working attack presentation; Hollow Knight caught
mid-Melee-frame at tick 23/44 in the live build. Zero console errors.

## 2026-08-31 (iteration 9) — Palette discipline, pacing, inventory, full replacement

Directive: strict palette cohesion (drop assets rather than break harmony),
slower deliberate animation, inventory overflow fix, replace ALL placeholder
characters with disciplined pack variants.

### Palette & cohesion
- Lords-of-Pain textures now load with NEAREST scaling — upscaled pixel art
  is crisp and chunky (GBA-style) instead of blurry linear smears. The stone
  floor texture stays linear (it downsamples).
- The knight is SCENE-LIT (tint = armor tint × Lighting.getTintAt, floor
  0.55): the hero no longer glows white in darkness; he sits in the same
  light language as the world.
- ALL enemies are now pack sprites with palette-disciplined identity tints
  (multiplied under scene light): Ember Fallen (warm 0xffa070 skeleton,
  ×1.9), Rotting Soldier (the armed LoP warrior at 0x94b072 rot-green,
  ×2.5, real idle frames), Risen Skeleton (bone, ×2.2), Bone Archer
  (frost 0xbcd4ff, ×2.05). Crystal markers remain only as load-failure
  fallbacks. Zombie deaths reuse the skeleton collapse (tinted) — reads as
  flesh sloughing off; no static despawns anywhere.

### Animation pacing
- Walk/run cycles advance BY DISTANCE COVERED (stride frames-per-tile), not
  per frame — foot-sliding eliminated for knight and all sprite enemies.
- Slower everything: knight idle 12→7 fps, hit 30→24; blade timing 16/22
  (0.63 s swings), bow 24/18, wand 26/20; enemy windups +4–6 ticks; death
  collapse 45→52 ticks; glint 14→10 fps; gold loop 8→5 fps. Idle sprites
  breathe (±1.5% scale) so nothing reads as a frozen prop.
- PLAYER DEATH uses the knight's Die sheet: 80 ticks of collapse where he
  fell, then respawn at the entrance. Verified frame-by-frame in-browser.

### Inventory overhaul
- Backpack lives in a dedicated SCROLLABLE compartment (max-height, styled
  thin scrollbar, item count in the header); preview + equipment + stats
  stay fixed — a full pack can no longer push content off-screen.
- Paperdoll preview now renders the ACTUAL knight (facing camera, live
  armor tint) with item-colored gems marking worn slots.

### Asset utilization
- Pack tile highlight (gold-tinted) replaced the procedural path marker.
- Rare drops fire the treasure glint at their landing spot.

### Verification (seed 1234, dedicated tab)
Crisp skeletons in combat; scene-lit knight; knight preview in the panel;
death → sprawled Die frames under "YOU HAVE FALLEN" → clean respawn (idle,
full hp, at spawn); zero console errors; strict typecheck clean.

## 2026-08-31 (iteration 8) — External asset packs, chests, run timer

### Asset packs integrated (skills/external-sprite-pipeline.md)
- **The player is now the HD Knight** ("2D HD Character Knight"): 8-direction
  15-frame sheets for idle/run/two melee swings/spin/cast/hit — sliced from
  1920×1024 grids into shared-source textures. Direction rows calibrated
  in-game (they were the exact reverse of our canonical order). Weapon
  variety is visible: blades alternate two swing anims, Doombringer does the
  spin attack, bows/wands play the cast; worn armor tints the model.
- **Skeleton enemy** ("Lords of Pain"): real 8-dir walk + a true death
  animation (collapse frames, then fade → corpse stain). No attack frames in
  the demo pack, so the procedural rear-back telegraph plays on the sprite.
  Scale 2.3 — at 1.7 the thin dark bones vanished against the stone.
- **Real stone floors**: the pack's seamless square stone texture fills our
  tile diamonds through per-variant offset matrices (crack pass kept).
- **Glint VFX, gold-pile decor (animated loop), loot indicator** wired into
  Ambience/Props; everything falls back to procedural art on load failure.
- Loading gate: "FORGING THE DEPTHS" overlay while ~150 files fetch.

### Lootable chests (`systems/Chests.ts`)
Seeded placement (~45% of rooms), bobbing loot indicator, click → walk-up →
OPEN_CHEST through the command queue → `chest:reached`/`chest:opened`
events → 2–3 guaranteed rarity-weighted drops + glint + camera kick.
Verified: chest opened, spilled plank_shield + rusty_sword, glow art swap.

### Floor run timer
`#timer` (top center) counts sim ticks since floor entry (deterministic);
resets on descend; the descend banner gains "Depth N delved in M:SS".

### Enemy roster is now 4 distinct behaviors
fallen (fast coward) / zombie (tank) / bone archer (kiting shooter) /
skeleton (sprite-animated mid-speed melee) — mixed per floor.

### Verification (seed 1234, dedicated tab)
Pack load clean (zero 404s/errors); knight runs with correct facings after
row calibration; skeleton fight: chase → telegraph → hit-flash → death
animation caught mid-collapse; chest loop end-to-end; timer at 0:29 on the
HUD; typecheck strict clean. Test-harness note: holding SPACE roots the
player through chained swings — release it in scripted tests before pathing.

## 2026-08-31 (iteration 7) — Ranged combat, minimap, live paperdoll, polish

### Player ranged combat
Weapon families (`WeaponKind`: blade/bow/wand) with per-family attack timing
(WEAPON_TIMING — shared by simulation AND animation), firing range, and
paperdoll art. ProjectileSystem generalized to factions: player arrows and
wand bolts collide with enemies (pure-sim `findEnemyAt`, NOT fog-gated),
enemy arrows with the player; rolls stay in CombatSystem
(`projectileHitEnemy`). Ranged strike frames loose toward the target's
position at release (dodgeable); air shots go along the facing. Click-attack
with a bow approaches only to firing range WITH line of sight; held SPACE
auto-targets at weapon range (fog-visibility = player LOS). New items:
Short Bow (starter), Hunter's Bow, Emberwand (magic bolt, additive glow).
`projectile:impact` event drives sparks (bolts) / dust (arrows off stone).

### Minimap (`ui/Minimap.ts`, closes the minimap sub-task)
Top-right canvas, M to toggle: renders ONLY fog-revealed tiles (explored
shadow vs currently-visible brighter), stairs in gold once discovered,
pulsing player dot. Base layer redraws only on `player:tileChanged`
(markDirty); per-frame work is one drawImage + one dot.

### Live paperdoll preview
The inventory panel renders the actual character rig (body + equipped,
tinted overlays) via `renderer.extract.canvas` on every inventory change —
equipment changes appear simultaneously in the panel preview and on the
in-world sprite. Verified with the Short Bow: both updated in one click.

### Animation polish round 2
Bow/wand DRAW animation (fast pull to full draw, tension hold, 2-tick snap
release) distinct from melee swings; footstep dust puffs on each hop
landing (`Ambience.puff`, `player.onStep`); idle breathing when standing;
crit spark bursts at the victim. Burst particles gained per-particle base
alpha (low-energy dust vs full blood).

### Verified (seed 1234, dedicated tab, deterministic steps)
Bow equip → panel preview + world sprite update together; arrows seen in
flight; a zombie shot 85→26 at range; a fallen shot to 1 hp FLED (flee AI
under arrow fire); wall-hidden enemies correctly untargetable; minimap grew
with exploration; zero console errors; strict typecheck clean.

### Sub-agent docs
sub_tasks/README gained a system-blueprint table mapping every pillar to
its owner modules + skill doc; minimap marked done; three new scoped specs:
health-potions, gamepad-support, floor-themes.

## 2026-08-31 (iteration 6) — Controls, weight, lighting math, onboarding

User directive: reject endless-click combat (hybrid BG:DA-style buttons),
fix floating/sliding animation with real weight, fix lighting that darkens
lit objects, add tutorial objects, lock the pillars down for sub-agents.

### Hybrid action controls (skills/hybrid-action-controls.md)
SPACE/F = auto-targeted swing (held = keep swinging; whiffs the air when
nothing is near), E = grab nearest loot, WASD+buttons = full keyboard play;
mouse targeting unchanged. A pulsing red target ring shows exactly which foe
is being struck at all times. New commands ride the deterministic queue.

### Animation weight (skills/animation-weight-and-impact.md)
Grounded shadows split from bodies (the root cause of "floating"); hop-cycle
walk with squash & stretch and movement lean; anticipation→whip→follow-through
swing curves; IMPACT FRAMES (5-frame pose hold on landed hits); camera kick
on every contact; blood bursts with gravity. Waystone/marker art detailed up.

### Lighting correction
Walls are now lit by the brightest ADJACENT VISIBLE FLOOR they face (south/
east neighbors), not by their own tile center — the own-tile model sat walls
~1 tile deeper in the falloff and made them read wrongly dark beside bright
floor. Enemy minimum readability light raised 0.25→0.35.

### Tutorial layer
Floor-1 waystone (glowing prop + light source) anchors proximity hints;
banner UI (ui/Tutorial.ts) shows once-per-session hints: movement, striking,
stairs, loot drop, inventory, first-wound telegraph tip.

### Combat livelocks found & fixed by deterministic testing
1. **Player perma-stunlock:** 3-damage Fallen taps chain-interrupted every
   14-tick windup — the player literally could not swing against a pack.
   Fix: player poise (stagger only from post-armor hits ≥ 8, recovery 10).
2. **Whiff-forever:** button auto-target range (1.55) exceeded strike reach
   (1.35) — a foe at 1.5 was selectable but unhittable, forever. Fix:
   STRIKE_REACH 1.7 ≥ selection range. Rule documented.
3. **Doorway deadlock:** A*'s no-corner-cut refuses the final diagonal, and
   pure straight steering wall-blocks — either alone stalls the enemy just
   out of reach. Fix: straight steering first, A* fallback on zero movement.

Verified (seed 1234, deterministic steps): full keyboard run — WASD approach,
held-SPACE engagement with target ring, poise-enabled trades, zombie killed
at ~13.5 s, player winning at 116/140; hint banner, waystone, wall lighting
and shadows confirmed on screenshots; zero console errors; typecheck clean.

## 2026-08-31 (iteration 5) — Milestone 4: Diablo-grade combat + dungeon depth

User feedback (verbatim): "it doesn't look like a combat system at all, need
much more improvements" + "dungeon depth and enemies AND finally add animated
fight system, make it as complex as in the original Diablo game."

### Combat rewritten around the D1 action model
See skills/diablo-combat-model.md for the full write-up. Headlines:
- Attacks are animated WINDUP → strike-frame → RECOVERY actions on a shared
  `Entity.action` state machine; range re-checked at the strike frame makes
  telegraphed attacks dodgeable; move orders cancel windups.
- To-hit rolls, weapon min–max damage ranges, 10% ×2 crits, knockback,
  hit-recovery stunlock (per-type recovery ticks), all from a seeded stream.
- Visible language: weapon-arc swing animation on the paperdoll main hand,
  outcome-tinted slash arcs (warm/fiery/grey), rear-back enemy telegraphs,
  flinch jitter, blood particle bursts, topple-and-fade deaths leaving
  corpse stains, left/right facing via rig mirroring.

### Enemy roster (ENEMY_TYPES)
fallen (fast, weak, flees below 30% hp) / zombie (slow, 8–15 dmg, nearly
unstaggerable) / bone archer (kites to 3.2–6.5 range, real arrows via the
new pooled ProjectileSystem — dodgeable in flight). Packs of 2–4 per room;
floor scaling: hp ×(1+0.35·(floor−1)), damage +2/floor.

### Dungeon depth
Stairs (in the room farthest from spawn) descend to a fresh seeded floor.
main.ts was restructured into buildWorld/destroyWorld: the Player, HUD,
InputQueue, and GameLoop persist; everything else is per-floor and torn
down cleanly (event unsubscribes, input aborts, pool destroyAll, viewport
destroy with the player's container re-parented first). DEPTH roman-numeral
label + gold "YOU DESCEND DEEPER" banner.

### Cleanups
- utils/rng.ts is now the ONLY mulberry32 (deduped from 4 copies).
- Lighting.registerProp safe at runtime (adopts the tile's current fog
  state) — needed for corpse stains on visible tiles.
- Enemy–enemy pairwise separation (EnemyPool.separate) — no more stacking.

### Verification (dedicated second browser tab; the user kept playing in theirs)
Deterministic loop.step run-through on seed 1234: pack aggro → telegraphs →
mutual stunlock exchanges (player 85→49, zombie 85→52→22) → player death →
respawn; blood bursts and corpse stains on screen; descend → DEPTH II with
25 scaled enemies incl. archers; archer LOS-gated aggro, draw, arrow seen in
flight, arrow damage landed. Zero console errors; strict typecheck clean.

### Testing-infrastructure gotchas (for future agents)
- Synthetic PointerEvents get `offsetX = clientX / devicePixelRatio` in
  Chrome (trusted events are unaffected) — measure the scale with a probe
  event and pre-multiply, or tests silently click the wrong tile.
- A "failed" click may just be an unwalkable target: check
  `scene.isWalkable` before blaming the input path (cost 20 minutes here).

## 2026-08-31 (iteration 4) — Dramatic lighting effects + Milestone 3: Items & Paperdoll

User decisions: M3 items/paperdoll next; death stays free for now; atmosphere
should get MORE dramatic (colored sources, stronger flicker, more particles).

### Colored static light sources (`Lighting.addSource`)
Per-tile RGB contribution maps (Float32Array ×3) baked at scene build with
quadratic falloff; composed additively over the torch ramp each frame with an
independent source-flicker rhythm. `getTintAt(x,y)` now returns the fully
composed colored tint for dynamic objects (enemies, loot). Torch flicker
amplitude was also increased (~2×).

### Props (`scenes/Props.ts`)
Seeded placement: braziers (70% of rooms, corner, warm 235/110/24 source,
pulsing additive glow, ember hotspot) and arcane floor runes (35% of rooms,
cold 80/60/235 source, additive glyph + halo). Props register with Lighting
for fog gating/tinting (`registerProp`) and never block movement or sight.
Ambience motes went 40→64 with 35% biased to spawn off brazier coals.

### Milestone 3 — items, loot, inventory, paperdoll
- `items/catalog.ts`: 11 items across all 6 slots, 3 rarities (60/30/10 roll,
  60% drop chance), damage/armor stats, per-item colors. Pure data.
- `systems/Loot.ts`: ground items from a dungeonSeed-derived RNG stream
  (kill-order deterministic), rendered as rarity glow + item-colored glyph,
  bobbing, fog-gated, scene-lit. Screen-space click picking.
- Flow: click loot → PICKUP command → MovementSystem approaches →
  `item:pickupArrived` → backpack. Click priority: enemy > loot > ground.
- `systems/Inventory.ts` + `ui/Inventory.ts`: the DOM panel (I key) enqueues
  EQUIP/UNEQUIP commands — equipment changes ride the deterministic queue
  like every other intent. Includes the item stat tooltip (closes the
  item-tooltip sub-task in spirit; spec's standalone module folded here).
- Paperdoll: equipping instantly mounts a tinted overlay sprite (blade,
  shield, helm, chest band, greaves, mantle) on the body. KEY TRICK: Pixi's
  generateTexture trims to drawn bounds, so overlay canvases are pinned with
  two ~invisible corner dots to keep 1:1 alignment with the body sprite.
- Combat integration: swing damage = base + weapon; armor is flat reduction
  applied inside `dealDamage` (min 1). Player starts with a Rusty Sword.

### Verification & incidents
- Verified in-browser (seed 42): equip via panel → Damage +4 + visible blade;
  enemy killed; a magic-rarity Soldier Blade dropped with correct glow.
- Mid-verification the USER started playing the live build — enemy kills,
  deaths, and drops all happened organically with zero console errors, which
  is the best kind of test. Automation was stopped immediately to not fight
  the player for input.
- Chrome automation note: the extension's `key` action didn't trigger the
  I-key toggle (likely missing `KeyboardEvent.code`); real keyboards work.
- Known polish gap discovered in live play: enemies separate from the player
  but not from EACH OTHER (two corpses-to-be stacked on one tile). Logged in
  the checklist backlog.

## 2026-08-31 (iteration 3) — Lighting overhaul, cutaway walls, AAA HUD pass

User feedback driving this iteration: lighting incorrectly darkened lit
objects; walls must never hide the player; raise the art direction to a
handcrafted dark-fantasy standard (fonts, particles, animation); show
controls on screen; keep closing checklist items.

### Lighting rewritten: overlay → tile lightmap (`engine/Lighting.ts`)
Root cause of the "wrongly darkened" bug: the fog OVERLAY model. A black
diamond only covers its own tile's ground footprint, so any sprite taller
than one tile (every wall, every unit) was darkened by the NEIGHBOR tile's
fog diamond — lit walls rendered with black tops. Replaced with Diablo 1's
model: per-tile light values applied as sprite tints (see
skills/tile-lightmap-and-cutaway.md). Wins:
- Objects are lit exactly once, regardless of height — bug class eliminated.
- Warm→cool color ramp + torch flicker + falloff from the CONTINUOUS player
  position: light glides instead of stepping. Atmospheric by construction.
- The whole fog sprite layer (1,936 sprites + pad ring) is gone.

Follow-up fixes found by browser verification:
- HIDDEN tiles must be `visible=false`, not black-tinted — black silhouettes
  against the #07070a background leaked the dungeon layout.
- The lightmap exposed a latent pool bug: EnemyPool's priming loop did
  acquire→release on the SAME instance 8 times (LIFO pool), so preallocated
  enemies kept construction-default visibility at world (0,0). The old fog
  overlay had been hiding them since M1. Fix: Enemy constructs despawned;
  priming loop deleted.

### Cutaway vision
Walls whose depth sorts in front of the player AND whose screen rect overlaps
the player's body ease to WALL_FADE_ALPHA (and back) with exponential
damping. Scan window: 9×9 tiles around the player per frame. Verified: player
fully visible standing behind south walls.

### Combat loop completion (M2 leftovers)
- Enemies strike back: 8 dmg every 1.2 s at melee range, routed through the
  same `CombatSystem.dealDamage` via an injected `attackPlayer` dep.
- Player death → "YOU HAVE FALLEN" epitaph → respawn at the dungeon entrance
  with full hp (explored map retained). Verified in-browser.
- Entity separation: enemies push out to 0.55 tiles so bodies never stack.
- Feedback: player hit-flash, attack lunge toward the target on each swing
  (`combat:swing` event), walk-bob while moving.

### Art direction & HUD
- Fonts: Cinzel (headers/labels) + IM Fell English (body) via Google Fonts,
  with serif fallbacks. Chosen as the closest quality webfonts to Diablo's
  Exocet spirit.
- Diablo-style health orb (CSS sphere with liquid fill + gloss + low-hp
  pulse), COMMANDS panel listing every control with kbd chips and
  active-mode highlighting, blood-red death title, cinematic vignette.
- Ambient ember motes: 40 additive-blend particles drifting up through the
  torchlight, brightness = life envelope × local light (never visible in
  darkness). Render-side only.

### Verification (seed 42, deterministic loop.step driving)
Torch gradient + flicker correct; no silhouette leaks; cutaway fade shows
the player through south walls; enemy chased, engaged, damaged the player
(orb drained live); death/respawn cycle clean; zero console errors; strict
typecheck clean.

## 2026-08-31 (later) — Milestone 2: melee combat + chase AI

User decisions (via clarification round): Diablo 1 deliberate combat pacing;
art will arrive as sprite sheets + JSON atlases; combat/AI prioritized next.

### What shipped
- `ATTACK` command flow: screen-space enemy picking in InputBindings →
  MovementSystem approach (throttled re-path, stop at ATTACK_RANGE 1.2) →
  CombatSystem auto-swing (12 dmg / 48-tick cooldown) → `entity:damaged` /
  `entity:died` → EnemyPool release. `dealDamage` remains the sole hp mutator.
- Enemy AI: idle/chase state machine, aggro = radius 6 + Bresenham LOS,
  re-path at most every 30 ticks and only on goal-tile change, 3 s LOS-loss
  give-up, 60% player speed. Health bar + hit-flash visuals.
- Dev tooling: `?seed=N` pins the dungeon; `window.__game` (DEV only) exposes
  state/loop/camera; `GameLoop.step(n)` advances the sim deterministically —
  used for automated browser verification and ready for replay tests.

### Bugs caught by deterministic browser testing
1. **AI frozen by a render flag (severe).** `Enemy.update` early-returned on
   `container.visible`, which fog gating toggles at render time — hidden
   enemies never thought, and with rAF paused (occluded window) even visible
   ones froze. Exactly the sim/render coupling the architecture forbids.
   Fix: simulation-owned `spawned` flag. Rule reinforced in Enemy docblock.
2. **Ground-plane enemy picking felt broken.** First implementation measured
   click-to-feet distance in world units, so clicking the visible BODY (46 px
   tall) missed. Fix: screen-space pick against the sprite's body box via
   `Camera.worldToCanvas` — clicking any part of the enemy targets it.
3. Environment note: Chrome pauses rAF entirely for occluded windows — the
   sim halting during automation waits was NOT a game bug; `loop.step()` now
   makes tests independent of rAF.

### Verified in-browser (seed 42)
Enemy aggroed on room entry, chased to melee, click-attacked: hp 60→36 after
1 s (two swings — correct first-swing + 0.8 s cadence), despawned at 0 hp,
active pool count 5→4, zero console errors, typecheck clean.

## 2026-08-31 — Milestone 1: Core framework built from empty directory

### Architectural decisions

1. **Deterministic lockstep-ready simulation.** All player intent flows
   DOM event → `InputBindings` → serializable `InputCommand` → `InputQueue` →
   drained once per fixed tick. Simulation state is a pure function of
   (dungeon seed + ordered command stream). This is the cheapest possible road
   to 4-player co-op: the future network layer ships commands, not positions.
   Consequence: **no system may mutate entity state from a DOM handler.**

2. **Fixed timestep (60 Hz) with render interpolation** (Fiedler pattern).
   Pixi's own ticker loop is stopped; `GameLoop` drives `renderer.render()`
   manually so there is exactly one frame authority. Entities store
   `prevPos`/`pos` and render at `lerp(prev, pos, alpha)`.

3. **Single source of truth for spatial queries.** `SceneManager.isWalkable`
   / `isOpaque` are injected into Pathfinding, Collision, FogOfWar, and
   InputBindings. No module re-reads the tile grid directly.

4. **Projection math is centralized** in `src/utils/iso.ts` (4 functions).
   An early bug source in isometric projects is re-derived projection with
   sign errors; the module doc forbids re-derivation.

5. **Fog of war is event-driven, not per-frame.** Recomputes only on
   `player:tileChanged`; delta-updates only tiles entering/leaving the visible
   set. 44×44 map → worst case ~150 LOS rays per tile crossing, negligible.

6. **Walls render only when bordering floor** (~60% wall-sprite reduction).
   Interior rock is invisible by definition under fog anyway.

7. **Depth sorting** via `zIndex = (wx + wy) · TILE_H/2` in one sortable
   layer shared by walls and entities. Walls are nudged −4 so an entity
   standing on the tile just south of a wall (numerically equal depth) always
   draws in front. Documented in `utils/iso.depthKey`.

### Debugging retrospectives / error prevention

- **TS6133 unused `height` in Pathfinder** — bounds checking is fully
  delegated to `isWalkable`, so the field was dead. Removed. Lesson: strict
  `noUnusedLocals` is kept ON to catch drift between plan and implementation.
- **Corner-cutting risk:** A* forbids diagonal steps unless both orthogonal
  neighbors are walkable; collision uses a square collider sampled at 4
  corners with axis-separated resolve. Together these guarantee the path
  follower cannot wedge into a wall corner.
- **Stuck-key hazard:** `window` blur clears all held movement keys and
  enqueues STOP — alt-tabbing while holding W no longer walks you into a wall
  forever.
- **Heap overflow guard:** the A* duplicate-push strategy can exceed the
  map-sized heap only on pathological maps; pushes past capacity are dropped
  (fresher entries already ordered). No dynamic allocation on hot path.
- **NaN propagation:** `Vec2.normalize` returns zero vector for near-zero
  input instead of dividing by ~0.

### Live browser verification findings (fixed same-day)

Runtime testing in Chrome (automated: screenshots + console monitoring)
surfaced two bugs the type checker could never catch:

1. **Fog plane too small for tall sprites.** Wall blocks and unit markers
   near the map's north/west edges project up-screen past the last in-map fog
   diamond, so they rendered against the bare background while "hidden."
   Fix: `FOG_PAD = 3` ring of permanently-opaque fog sprites beyond the map
   bounds (`engine/FogOfWar.ts`).
2. **Enemies visible through shroud.** Fog diamonds alpha-occlude tiles, but
   creatures must follow the classic ARPG rule (shroud hides creatures, not
   architecture). Fix: render loop gates `enemy.container.visible` on
   `fog.isVisible(tile)`.

Verified working end-to-end in the browser: boot with zero console errors,
click-to-move pathing with destination marker + camera follow, WASD direct
mode with HUD indicator, wheel zoom (clamped), fog reveal/shroud transitions.
Note for future agents: the Chrome automation `scroll` action does not reach
canvas `wheel` listeners — test zoom by dispatching a `WheelEvent` via JS.

### Performance notes

- All textures generated once at boot via `renderer.generateTexture`; sprites
  share GPU textures (implicit batching). No Graphics objects survive boot.
- Pathfinder uses typed-array node storage + search stamps (no per-search
  clearing, no allocations except the returned waypoint array).
- Static layers have `eventMode = 'none'` — Pixi skips hit-testing ~4k nodes.
- Fog sprites: 1,936 static sprites, alpha-only mutation. If this ever shows
  in profiles, the documented upgrade path is a single Mesh with per-vertex
  alpha (see skills/fog-of-war-los.md).

### Open questions for the user (asked in status report)

- Default class archetype for solo testing (currently Warrior).
- Asset format expectations (sprite sheets? per-frame PNGs? aseprite?).
- Combat feel target: Diablo 1 deliberate pace vs. faster hack-and-slash.
