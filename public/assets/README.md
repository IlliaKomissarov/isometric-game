# Runtime asset store (it.36 — purged & atlased)

Everything the game loads at runtime lives here, and ONLY what it loads:

| Folder | Contents | Loaded by |
| --- | --- | --- |
| `atlas/` | Pre-baked sprite atlases (`<anim>.png`, columns = frames, rows = the 8 canonical directions) + singles (`single_<name>.png`) + `manifest.json` (cell/orig/trim/scale + painted bounds per animation) | `src/render/SpriteLibrary.ts` — lazily, per floor |
| `atlas/vfx_*.png` | Single-direction spell effect strips (it.41: fireball comet, explosion, burst, firewall loop, ring, vortex, splash, whirl, slash, aura, orb, strike) | `render/Vfx.ts` via `SkillDeps.vfx`; projectile heads in `systems/Projectiles.ts` |
| `ui/skills/*.png`, `ui/items/*.png` | DOM-only art (it.40): 64 px skill glyphs (one per active skill) and painted item icons, referenced by `<img>` via `uiAssetUrl()` | `ui/itemIcons.ts`, the skill bar in `main.ts` |
| `ui/fonts/Darinia.ttf` | Darinia display face (it.45 `--font-display`: headers, titles, tooltips, buttons) | `index.html` @font-face |
| `ui/hud/*.png` | health_globe (gargoyle orb) + enemy_health_bars_2.0 frames/fills (it.45 HUD) | `index.html` CSS |
| `audio/gore/*.wav` | Gore vol 1: bone cracks / snaps / rattle, guts (it.43 `goreKill` / `goreHit`) | `AudioManager` gore banks |
| `audio/*.mp3` | Intro sting, dungeon beds, war horn, spell/boss stings | `src/engine/AudioManager.ts` |
| `audio/boss fight/` | Title theme (1), arena tracks (2, 3, 5, 6), epilogue (4) | `AudioManager` music state machine |
| `audio/Free Fantasy SFX Pack By TomMusic/` | The mapped OGG combat/door/footstep/spell takes, the cave BGS loop, the UI/Items WAV voice | `AudioManager` variant banks |
| `audio/Horror SFX Free/` | The mapped monster voices, gore, stingers, ambient dread | `AudioManager` horror banks |

## Rules

- **Nothing else belongs here.** The raw sprite packs (2.5 GB, 300k+
  files) were baked into `atlas/` on 2026-09-02 and deleted. Commit
  `07c386cd` keeps the raw-pack loaders + the in-browser baker
  (`src/dev/AtlasBaker.ts`, `/__bake` Vite endpoint) for reference: to
  re-bake, check that commit out with the packs restored.
- The raw `test-models` folder is gitignored and never deleted by the
  agent (it.43 rule); bakes read from it, the repo keeps only the outputs.
- The town kit (it.39: cottages, tileset ground/props, campfire, torch,
  well, peasant walk sheets) was baked the same way by
  `src/dev/TownBaker.ts` from the raw `test-models` uploads, which were
  then deleted; the baker lives in the it.39 commit history.
- To add a creature/hero: bake a grid atlas (cells alpha-cropped; record
  `origW/origH/trimX/trimY/scale/painted` in the manifest — see
  `docs/skills/external-sprite-pipeline.md`), then register its
  `AnimName`s and an `ENEMY_TYPES`/`CLASS_RIGS` entry. Heights are
  normalized from `painted` automatically (`MOB_HEIGHT` / `HERO_HEIGHT` /
  `BOSS_HEIGHT`).
- To add a sound: put the file under `audio/`, map it in `AudioManager`,
  and add it to the keep list in `scripts/purge-assets.mjs` (the purge
  script is the single source of truth for what audio may exist).
- Procedural art (floors, walls, glows, chests, icons) is generated at boot
  by `src/core/AssetManager.ts` and `src/ui/itemIcons.ts` — no files.
