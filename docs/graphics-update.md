# The Graphics Update (it.114 →)

The owner dropped ~21 GB of new art under `public/assets/graphics update/`
(gitignored, never committed) and asked for a full visual pass: detail,
variety, dark-fantasy atmosphere, lighting, VFX, items, food, menus, a try-out
arena, and a set of long-standing bugs. This file is the tracker. Each phase
ships as its own iteration (commit + GitHub Pages deploy) and gets an entry in
`docs/development_log.md`; boxes are ticked here as they land.

Rules that hold throughout:

- Nothing procedural where the drop has art. Every new tile, prop, creature and
  effect is BAKED from the drop (or a licensed download) by a script under
  `scripts/`, through `scripts/bakelib.py`, into `public/assets/atlas/`.
- The town, inn, cellar and farm keep their earlier floor tiles (it.113, the
  owner's choice). New ground KINDS are added beside them, never over them.
- Nothing is deleted from the roster. Assets that clash in style are SEPARATED
  by location, not removed.
- `tsc --noEmit` clean, qa75 clean, 0 console errors, device matrix 74/74
  before every deploy.
- Licences: `AssetPack01_Forest_Sample` (CC BY-NC-SA) and `Rodwan_Trees`
  (permission required) are NOT used. Bleed/Remus Turcuman pieces (tavern,
  cart, catapult) need the credit line. PVGames (Apex, Krampus): credit.
  Flare art: CC-BY-SA 3.0, credit. unTied/Frostwindz/PIXELCORE VFX: credit
  where asked. Kenney / Screaming Brain / polyy: CC0.

## Survey (done, it.114)

- [x] Asset drop inventoried: 25 character folders, 30 environment folders,
      VFX (~140 effect families), items (~600 turntables + 80 icons).
- [x] Codebase mapped: render/lighting/collision, items/UI/quests, the bake
      pipeline, docs conventions, the three reference repos.
- [x] `scripts/bakelib.py`: shared mask, sheet layout, LOCKED manifest writer.
- [x] Python 3.12 + Pillow + numpy installed on this machine.

## Phase 1 — Bakes (parallel; no TypeScript)

- [x] Creatures A (`scripts/bake-creatures-a.py`, 46 sheets): red/bone/venom
      widows (mob10), orc brute (mob), frost werewolf (mob3), treant (mob13),
      drake (mob1), winged wyrm (mob7), marked ghoul (mob4).
- [x] Creatures B (`scripts/bake-creatures-b.py`, 41 sheets): orc spearman
      (mob6), orc warrior woman (mob8), giant moth (mob 11), shambling corpse
      (mob12), halberdier (halbard), reaper (npc), duelist (npc1).
- [x] Creatures C (`scripts/bake-creatures-c.py`, 50 sheets + 1 single): Apex
      predator/stalker (mob14, PVGames), the gargoyle statue atlas, the HD
      knight (11 clips), the greatsword knight + the girl in black (PixelOver),
      teal spider (mob2), flesh golem + creeper (mob15/16), Krampus.
- [x] Dungeon tileset (`scripts/bake-dungeon.py`, 183 pieces): stone / temple
      / frost / ember floors (4 gain-matched variants each) + blood and
      pentagram accents, N/W wall runs, arches, doors, corners, pillars,
      stairs, torches and a brazier, 88 Infernus props, 28 Ancient pieces,
      the temple entrance. Walls seat exactly like the inn/cellar pieces.
- [x] VFX (`scripts/bake-vfx.py`, 111 strips).
- [x] Items (`scripts/bake-items.py`, 278 entries): 50 foods, 14 potions,
      6 scrolls/tomes, 25 weapons (icon + 30-frame turntable each), 80
      Arsenal icons, Flare coins + OGA gold piles.
- [x] Buildings & props (`scripts/bake-buildings.py`, 165 singles): 25 polyy
      village buildings ×2 rotations, the Bleed tavern, cottages, the manor,
      8 cart facings, 12 grass tufts, four Overworld ground kinds, 60 Ancient
      props, crates and stairs.
- [x] Siege (`scripts/bake-siege.py`): catapult idle/throw/load/move/break/
      wreck (8 dirs), the tumbling stone, the rock pile; ballista idle/shoot
      (8 dirs) and the bolt.

## Phase 2 — Engine & feel

- [x] Lighting: the visible set follows the hero sub-tile (allocation-free
      LOS, a lit ring round the sub-tile position); a dynamic light list;
      `setPlayerLight`.
- [x] Enemy readability: `render/Outline.ts` rim filter on foes, driven by
      the dark (faint blood/gold rim in shadow, none in torchlight), a flash
      rim on hit, a breathing gold rim on the target; `minLight` floors.
- [x] Camera: shake scaled by zoom (14 px max, two-sine noise, ≤0.6° roll),
      `zoomPunch`, retuned hits/crits/kills/boss/level-up/catapult beats.
- [x] Screen effects: `#vignette.dead` bloody screen on death, cleared on the
      rising; the level-up pillar of light.
- [x] Collision: `PROP_FOOTPRINT` table, `claims()`/`footprintOf()`, posts
      moved off roads, clutter swept from streets, house door columns closed,
      building sprites scaled to their painted base, `assertFootprints` audit.
- [x] Cutaway: canopy tiles count as "under the tree"; occluder rects from
      the scaled sprites.
- [x] Ground-click marker: a smaller ring that bursts in and breathes.

## Phase 3 — Content integration

- [ ] Dungeon depths draw the baked tileset (walls, floors, doors, stairs,
      props) by theme; variety rules per depth band. (in progress)
- [x] 23 new creature kinds in `ENEMY_TYPES` with stats, lore, voices and
      pools: the widows share the cellar and the vault with the old spider,
      the orc host holds the mines, the treant and the moth the woods, the
      reaper / flesh golem / drake / apex the deep.
- [ ] Catapults/ballistae on the battlefield from the real bakes (sheets
      baked; the dresser still draws the it.112 engine).
- [x] Buildings and props placed for variety (it.115): the riverside's nine
      farmsteads, the eastern quarter's houses, handcarts, the Stag re-baked
      with its south stair; overworld ground kinds 15-21 laid and feathered.
- [x] NPC segregation: `STREET_FOLK` (pixel) keeps the old quarter and the
      east; `MARKET_FOLK` (the smooth bodies, the duelist, the halberdier)
      walks the Market Ward, the taproom and the open country.
- [x] VFX everywhere: `render/effects.ts` catalogue; every skill has a cast
      and an impact beat; statuses ride the foe for their whole life; death,
      boss death, crit, hit, level-up, pickups, warps, catapult impact, the
      foe's alert, the draught auras.
- [x] Items: FOOD (25 dishes, snack/meal/feast, eaten over 3 s, hotkeys, the
      alchemist sells it, chests hold it), HUNGER (decays on the depths only;
      STARVING stops regen and softens blows) with a gauge on the plate and a
      label by the hero, coin drops from foes and chests scooped like piles,
      rarer gear, the INSPECT view with the turntables.

## Phase 4 — UI, systems, QA

- [x] Main menu / class / difficulty: one shared button language (hover,
      focus, active, disabled), the difficulty pick lifted and framed, class
      cards, vellum sheets, mobile targets ≥44 px.
- [x] Touch skill arc: circular icon crops with a dark socket.
- [x] COMMANDS sheet closed by default; `v0.2.0 · it.114` on the title foot
      and the settings head.
- [x] Notifications: `ui/Toast` stack (read-time durations, click to
      dismiss), the ledger watcher announcing quests and roads, longer
      level-up / reward / death / descend / damage / bubble times, gateway
      plates that name where the road goes and notes that follow the quest,
      the training ground reachable while the errand is open.
- [x] Cheat menu: every place and depth, FOES (any kind, ×1–10, at any
      level), QUESTS (every ledger key, rebuild the floor), DRAUGHTS, noclip,
      the purse.
- [x] THE MENAGERIE: from the title or the bestiary; `render/Puppet` draws
      any of 88 costumes over the hero; the picker labels every body with its
      kind and source folder; SUMMON THREE; the bestiary's reference line.
- [x] Tutorial: the arrival scene at the training ground (Sir Ham, two
      lines), 100 gold once on completion.
- [x] qa75: the arrival, the graphics-update section (new kinds' sheets,
      engine switches, the notice stack, gateway notes, the footprint audit,
      the yard's purse, the menagerie round trip).
- [x] Docs; deploy (it.115).

## Iteration 115 — the owner's list

- [x] Hunger removed; food heals and buffs. Every item cell turns; the whole
      item folder baked (758 items). Uniform drops, the E-to-loot line, GOLD.
- [x] Feet calibrated per clip (`calibrate-feet.py`); sizes; facing rows;
      the menagerie as a showroom with its own picker; human voices.
- [x] The crypt's walls stay drawn once seen; low south/east walls; arena
      stairs vs rift; placement audit.
- [x] Lord Milk; strict smooth/pixel separation; walkers yield; the Stag's
      door and interior; entry mats.
- [x] Ballistae; the battlefield's eastern wall and arch.
- [ ] Still open: armour and rings have no art in the drop (they sway only);
      the curios are not in the Journal; the ballista's loaded-bolt sheets,
      the Ancient towers and the carts are unused; the stair art is sandstone.
