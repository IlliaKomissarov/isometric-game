# Skill: Atlas sprite pipeline (it.36)

Supersedes `external-sprite-pipeline.md` for everything that renders a
character. The raw packs are gone; the game reads ONLY `public/assets/atlas/`.

## Layout

- One PNG per animation: `<anim>.png`, **columns = frames, rows = the 8
  canonical directions** `[E, NE, N, NW, W, SW, S, SE]` (single-direction
  anims such as `gold_drop`/`glint` have one row).
- `manifest.json` → `anims[<anim>]`:

  | field | meaning |
  | --- | --- |
  | `cellW/cellH` | atlas cell size in atlas pixels (cropped, possibly half-res) |
  | `origW/origH` | the ORIGINAL uncropped frame size — every anchor is relative to it |
  | `trimX/trimY` | where the cell sits inside the original frame (original px) |
  | `scale` | atlas px per original px (`0.5` = half-res bake) |
  | `nearest` | pixel-art packs use nearest filtering |
  | `painted` | alpha bounds of the SOUTH-facing frames (union), original px |

- Singles (`single_<name>.png`): tile highlight, loot indicator, the stone
  ground texture, weapon icons, the stairwell, the candelabra.

## How the loader keeps old anchors valid

`SpriteLibrary.slice()` builds each frame as
`new Texture({ source, frame, orig: (0,0,origW,origH), trim: (trimX,trimY,w,h) })`,
so `texture.width/height` still report the original cell and
`anchor.set(0.5, anchorY)` lands exactly where it did on the raw frames.
Half-res atlases mount with `source.resolution = 0.5`, which makes every
rectangle above read in ORIGINAL pixels. Never scale rig code for atlas
resolution — the source resolution already does it.

## Height normalization (data, not guesswork)

Rigs no longer carry hand-calibrated scales: `Player.enableKnightRig` and
`Enemy.applyRig` compute `scale = TARGET / paintedHeight(idle)` with
`HERO_HEIGHT = MOB_HEIGHT = 56`, `BOSS_HEIGHT = 128`, times an optional
`heightMult` flavor (runt 0.86, elite 1.25, the wide serpent 0.8). The
legacy `scale` field is only the fallback when the manifest lacks bounds.

## Lazy loading contract

- `spriteLib.load()` — manifest + singles + the two ambient loops (<1 MB).
- `spriteLib.ensure(names)` — fetch + slice; dedupes concurrent calls; call
  it before ANY `anim()`/`frame()`. `hasAnim` is false until resident.
- main: hero rig at run start; `buildWorld` awaits `animsForFloor(floor,
  mode)` (roster kinds + phase chains + summons + the arena keeper); the
  NEXT floor prefetches in the background after each build.
- `Enemy.usesSprite()` still falls back to the procedural marker when an
  atlas is missing — never a blank body.

## Adding an animation

1. Bake a grid PNG (any tool; or restore commit `07c386cd` + the raw pack
   and run `await __bake()` in the dev console, which POSTs to `/__bake`).
2. Add the manifest entry (fields above; `painted` = alpha bounds of the
   S row; `trimX/Y` = crop offset; `scale` 1 or 0.5).
3. Add the `AnimName`, then reference it from `ENEMY_TYPES` / `CLASS_RIGS`.
4. Add the kind to `kindPoolFor` (or a boss ladder) — `animsForKind` picks
   up the atlases automatically.

## Idle pacing

`render/animUtil.idleFrame(frameCount, seconds, phase)`: ≤6-frame idles
ping-pong at 3.6 fps (the big-pack 4-frame breathers), longer idles loop at
6–8 fps. Player idle uses a render wall-clock; enemies use sim `elapsed`.
Walk cycles are `stride` CYCLES per tile × the anim's frame count.
