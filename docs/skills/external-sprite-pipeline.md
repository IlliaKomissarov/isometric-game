# Skill: External Sprite-Pack Pipeline (Knight Sheets + Lords of Pain Frames)

## What & why
Real art replaced the geometric placeholders. Two pack formats, one loader
(`src/render/SpriteLibrary.ts`):

1. **Grid sheets** ("2D HD Character Knight"): 1920×1024 PNG = 15 frame
   columns × 8 DIRECTION rows of 128×128 cells. Sliced at load into
   `Texture` sub-frames via `new Texture({source, frame: Rectangle})` —
   zero re-uploads, all frames share one GPU texture.
2. **Per-frame files** ("(DEMO) Lords Of Pain"): 256×256 PNGs named
   `<anim>_<DIR>_<angle>_<frame>.png`, 16 directions of which we load the
   8 principal ones (E,NE,N,NW,W,SW,S,SE). Characters REGISTER AT THE FRAME
   CENTER (128,128 = ground point), shadows baked in.

## Hard-won calibration rules
- **Direction rows are never what you assume.** The knight's rows 0..7 face
  [SE, S, SW, W, NW, N, NE, E] — the exact REVERSE of our canonical
  [E, NE, N, NW, W, SW, S, SE]. Calibrate by rendering a strip of raw rows
  in-game and reading facings off a screenshot; fix ONLY
  `KNIGHT_ROW_FOR_DIR`.
- `dirIndexFromFacing` converts a world facing vector to our 8-dir index in
  SCREEN space (`screenX = fx−fy`, `screenY = (fx+fy)/2`). One function,
  used by every sprite-rendered entity. Never re-derive.
- **Anchors**: knight ≈ (0.5, 0.8) of the 128 cell; Lords-of-Pain ≈
  (0.5, 0.54) of the 256 frame (feet just below frame center). Measure
  non-transparent bounds before guessing.
- **Scale to world**: our tiles are 64×32. Knight cell → ×0.92; LoP 256
  frames hold tiny ~36px characters → ×2.3 for the skeleton (readability
  beats 1:1 fidelity; the thin dark skeleton was near-invisible at ×1.7).
- Sprite-rendered entities **never mirror** (`container.scale.x` stays 1)
  and hide the procedural shadow sprite (packs bake their own).

## Animation state → frames (Player.syncKnight / Enemy.syncSpriteAnim)
- Actions map ticks→frames: `frame = floor(actionTicks / totalTicks × 15)`
  so the visual stays honest about combat timing (windup = dodge window).
- Weapon variety through anims: blade alternates Melee/Melee2, Doombringer
  swings MeleeSpin, bow/wand play CastSpell. Armor shows as a subtle
  multiply tint (10% per worn piece toward its item color).
- Missing animations degrade: the demo skeleton has no attack frames, so
  the procedural rear-back telegraph plays on the sprite — dodge cues stay.
- Everything falls back to procedural art if `spriteLib.loaded` is false
  (load failures must never brick the game).

## Palette discipline (iteration 9 rules — binding for sub-agents)
- LoP pixel art loads with `scaleMode: 'nearest'` (crisp chunky upscale);
  the stone texture stays linear (it downsamples into floor tiles).
- One base sprite → many enemies via IDENTITY TINTS multiplied under scene
  light (`Enemy.setLightTint`): ember 0xffa070 fallen, rot 0x94b072
  warrior-zombie, frost 0xbcd4ff archer. Pick tints FROM the palette in
  `config.PALETTE`'s temperature range; never introduce saturated primaries.
- The player is scene-lit too (`Player.setSceneTint`, floor 0.55). Nothing
  in the world renders unlit.
- Walk cycles advance by DISTANCE (`stride` frames per tile), never by
  wall-clock — this is what kills foot-sliding. Idle sprites must breathe.
- If an asset cannot be made to sit in the palette by tint/scale, DROP it.

## Environment reuse
`ground_stone1` (a seamless SQUARE texture, not a tile) becomes floor
diamonds via Graphics texture-fill with per-variant offset matrices
(`AssetManager.buildStoneFloors`), keeping the crack/grime pass on top.
`highlight`/`loot_indicator`/`glint`/`gold_drop` feed UI + VFX + decor.
