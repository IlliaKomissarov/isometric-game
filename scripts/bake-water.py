"""
BAKE THE RIVER (it.107).

The raw pack under `public/assets/test-models/` is gitignored - the repo's rule
since it.36 is "drop a raw pack elsewhere, bake it, commit only the atlas". This
is that bake for the water.

SOURCE. `3rd town part/water_extras/water_part_18..27.png` is a ten-frame
seamless CAUSTIC loop at 1024x1024 (greyscale, mostly black, white light
filaments). Frames 07-17 and 38-42 are a wave-height set and 28-37/43-45 another
- classified by mean brightness, the caustics are the only run that is a true
animation loop, and they are what moving water actually looks like from above.

WHAT IT PRODUCES, into `public/assets/atlas/`:
  single_water_00..09.png   the river, ten animation phases

The BANK is not baked: `town_sand`, already in the atlas, is a river bank, and
the pack's own ground textures are near-flat on their own (sand is mean 161 with
a standard deviation of 4 - they are authored to be lit through a normal map, and
sampled raw they bake to a plain brown diamond). Shipped art that already looks
right beats a new file that does not.

HOW. Each output is a 64x32 isometric ground diamond, the same shape and size as
every other town ground tile. For each output pixel the script inverts the
isometric projection to a point on the GROUND PLANE and samples the source there
with wrapping - so the pattern lies flat in the world instead of being a square
picture squashed into a diamond. Rendered at 4x and box-filtered down, and the
alpha is taken from `single_town_grass_0.png` so the diamond edge matches the
tiles it sits beside exactly.

Run:  python scripts/bake-water.py
"""

import io
import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'public', 'assets', 'test-models', '3rd town part')
ATLAS = os.path.join(ROOT, 'public', 'assets', 'atlas')

TILE_W, TILE_H = 64, 32
SS = 4  # supersample factor

# The caustic loop. Ten frames is a two-second cycle at the speed the river runs.
CAUSTIC = [os.path.join(RAW, 'water_extras', f'water_part_{n}.png') for n in range(18, 28)]

# How much of the source one tile covers. A whole 1024 period in one 64x32
# diamond is noise; a third of it keeps the filaments readable at tile scale.
CAUSTIC_SPAN = 1 / 3.0

# The river's own colour, under the light. Deep, cold, green-blue - it is tinted
# again per-tile by the scene's lighting, so this is the unlit body of the water.
DEEP = (26, 52, 62)
SHALLOW = (44, 84, 92)


def sample(src, px, py, w, h):
    """Nearest sample with wrapping (the sources tile seamlessly)."""
    return src[(py % h) * w + (px % w)]


def bake_diamond(src_img, span, shade, out_path, alpha_mask):
    """
    Project `src_img` onto the ground plane of one isometric tile.

    `shade(v, gx, gy) -> (r, g, b)` turns a sampled luminance into a colour.
    """
    sw, sh = src_img.size
    src = list(src_img.convert('L').getdata())
    W, H = TILE_W * SS, TILE_H * SS
    out = Image.new('RGB', (W, H), (0, 0, 0))
    px = out.load()
    win = int(min(sw, sh) * span)
    for y in range(H):
        # tile-local, -1..1 across the diamond
        v = (y + 0.5) / (H / 2) - 1
        for x in range(W):
            u = (x + 0.5) / (W / 2) - 1
            if abs(u) + abs(v) > 1.0001:
                continue
            # Invert the isometric projection: screen (u,v) -> ground (gx,gy).
            gx = (u + v) * 0.5
            gy = (v - u) * 0.5
            sx = int((gx + 0.5) * win)
            sy = int((gy + 0.5) * win)
            lum = sample(src, sx, sy, sw, sh) / 255.0
            px[x, y] = shade(lum, gx, gy)
    small = out.resize((TILE_W, TILE_H), Image.LANCZOS).convert('RGBA')
    # The diamond's own edge, taken from a tile that already has the right one.
    small.putalpha(alpha_mask)
    small.save(out_path)


def water_shade(lum, gx, gy):
    """Deep water, with the caustic filaments as cold light on top of it."""
    # A gentle depth gradient across the tile so a flat river is not flat.
    t = min(1.0, max(0.0, (gy + 0.5)))
    base = tuple(int(DEEP[i] + (SHALLOW[i] - DEEP[i]) * t * 0.5) for i in range(3))
    # The caustics are additive: white filaments become cold highlights.
    k = lum ** 1.5
    return (
        min(255, int(base[0] + k * 120)),
        min(255, int(base[1] + k * 165)),
        min(255, int(base[2] + k * 175)),
    )


def main():
    mask = Image.open(os.path.join(ATLAS, 'single_town_grass_0.png')).convert('RGBA').split()[3]
    if mask.size != (TILE_W, TILE_H):
        raise SystemExit(f'grass tile is {mask.size}, expected {(TILE_W, TILE_H)}')

    made = {}
    for i, f in enumerate(CAUSTIC):
        if not os.path.exists(f):
            raise SystemExit(f'missing source frame: {f}')
        name = f'water_{i:02d}'
        out = os.path.join(ATLAS, f'single_{name}.png')
        bake_diamond(Image.open(f), CAUSTIC_SPAN, water_shade, out, mask)
        made[name] = {'file': f'single_{name}.png', 'w': TILE_W, 'h': TILE_H, 'nearest': False}
        print(f'  baked {name} <- {os.path.basename(f)}')

    mpath = os.path.join(ATLAS, 'manifest.json')
    manifest = json.load(open(mpath, encoding='utf-8'))
    manifest['singles'].update(made)
    # Written back in the manifest's OWN shape: one-space indent, and CRLF line
    # endings, because that is what is already on disk. Get either wrong and a
    # ten-line addition lands in the diff as a 6,300-line reformat.
    with io.open(mpath, 'w', encoding='utf-8', newline='\r\n') as fh:
        fh.write(json.dumps(manifest, indent=1, ensure_ascii=False))
    print(f'manifest: {len(made)} singles added/updated, {len(manifest["singles"])} total')


if __name__ == '__main__':
    main()
