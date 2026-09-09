"""
BAKE THE RIVER (it.107, made seamless it.108).

The raw pack under `public/assets/test-models/` is gitignored - the repo's rule
since it.36 is "drop a raw pack elsewhere, bake it, commit only the atlas". This
is that bake for the water.

SOURCE. `3rd town part/water_extras/water_part_18..27.png` is a ten-frame
seamless CAUSTIC loop at 1024x1024 (greyscale, mostly black, white light
filaments). Frames 07-17 and 38-42 are a wave-height set and 28-37/43-45 another
- classified by mean brightness, the caustics are the only run that is a true
animation loop, and they are what moving water actually looks like from above.

`ground_textures/transitions_02.png` supplies the soft-edged alpha ramps the
bank is blended with; `sand.png` is what it is blended to.

WHAT IT PRODUCES, into `public/assets/atlas/`:
  single_water_p<0..9>_<0..8>.png   the river: ten phases x a 3x3 spatial block
  single_shorefade_<0..3>.png       the bank washing into the water, four ways

------------------------------------------------------------------------------
TWO THINGS IT.107 GOT WRONG, AND WHY THE RIVER READ AS A GRID OF BOXES
------------------------------------------------------------------------------

1. THE SEAM. it.107 took the diamond's alpha from `single_town_grass_0.png`, on
   the reasoning that borrowing a shipped tile's mask would match its neighbours
   exactly. But that mask is only 122-188 opaque along its rim - it is authored
   to be laid on GRASS, where a soft edge blends into more grass. Over the dark
   background the scene clears to, two adjacent soft rims do not add up to one
   opaque tile: they leave a half-transparent line, and every tile boundary in
   the river drew as a dark diagonal. That was the "grid boxes".

   The mask is DERIVED FROM THE PROJECTION now (see `diamond_alpha`): a pixel
   belongs to the tile whose grid square it unprojects into, which partitions
   the plane exactly. Drawing the diamond and thresholding it - at any cutoff -
   still left 512 uncovered interior pixels; owning it leaves none.

   A third fault went with them: the base colour was ramped ACROSS each tile,
   and a ramp that restarts at every tile edge is a grid too. It is flat now.

2. THE REPEAT. Every water tile sampled the SAME window of the source, so the
   same caustic knot appeared in every diamond on the map. One tile spans a
   third of the source, so the pattern's true period is THREE tiles - and baking
   the 3x3 block of offsets makes the caustics a single continuous field across
   the whole river, wrapping seamlessly because the source does.

------------------------------------------------------------------------------

HOW. Each output is a 64x32 isometric ground diamond. For each output pixel the
script inverts the isometric projection to a point on the GROUND PLANE and
samples the source there with wrapping - so the pattern lies flat in the world
instead of being a square picture squashed into a diamond. Rendered at 4x and
box-filtered down.

Run:  python scripts/bake-water.py
"""

import io
import json
import math
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'public', 'assets', 'test-models', '3rd town part')
ATLAS = os.path.join(ROOT, 'public', 'assets', 'atlas')

TILE_W, TILE_H = 64, 32
SS = 4  # supersample factor

CAUSTIC = [os.path.join(RAW, 'water_extras', f'water_part_{n}.png') for n in range(18, 28)]
SAND = os.path.join(RAW, 'ground_textures', 'sand.png')

# How much of the source one tile covers, and therefore the spatial period.
# A third: the filaments stay readable at tile scale, and three tiles wrap.
SPAN = 3
CAUSTIC_SPAN = 1.0 / SPAN

# The river's own colour, under the light. It is tinted again per-tile by the
# scene's lighting, so this is the unlit body of the water.
DEEP = (26, 52, 62)
SHALLOW = (44, 84, 92)


def sample(src, px, py, w, h):
    """Nearest sample with wrapping (the sources tile seamlessly)."""
    return src[(py % h) * w + (px % w)]


def diamond_alpha():
    """
    The tile's own mask, DERIVED FROM THE PROJECTION rather than drawn.

    A pixel of the tile-(0,0) sprite belongs to that tile exactly when
    unprojecting its centre lands inside tile (0,0) - which is `screenToWorld`
    in `utils/iso.ts`, with the sprite's own `- TILE_W / 2` offset from
    `SceneManager.addFloorSprite`. That PARTITIONS the plane: every screen pixel
    is claimed by exactly one tile, so a field of these is gapless and
    non-overlapping by construction, with no epsilon to tune.

    Drawing the diamond instead (`|u| + |v| <= 1`, supersampled and thresholded,
    which is what it.107 did after borrowing the grass tile's soft rim) leaves a
    one-pixel hairline along every shared edge no matter what cutoff is used -
    measured: 512 uncovered interior pixels at every threshold tried. Over the
    dark ground the scene clears to, that hairline is the grid the river drew.
    """
    m = Image.new('L', (TILE_W, TILE_H), 0)
    px = m.load()
    for py in range(TILE_H):
        for pxi in range(TILE_W):
            sx = pxi + 0.5 - TILE_W / 2
            sy = py + 0.5
            a = sx / (TILE_W / 2)
            b = sy / (TILE_H / 2)
            if math.floor((a + b) / 2) == 0 and math.floor((b - a) / 2) == 0:
                px[pxi, py] = 255
    return m


def bake_diamond(src_img, shade, out_path, alpha_mask, off_x=0.0, off_y=0.0, normalize=False):
    """
    Project `src_img` onto the ground plane of one isometric tile.

    `shade(v, gx, gy) -> (r, g, b)` turns a sampled luminance into a colour.
    `off_x` / `off_y` shift the sampled window by whole tiles, which is what
    makes a block of these read as one continuous surface.
    """
    sw, sh = src_img.size
    src = list(src_img.convert('L').getdata())
    lo, hi = (min(src), max(src)) if normalize else (0, 255)
    if hi - lo < 1:
        lo, hi = 0, 255
    W, H = TILE_W * SS, TILE_H * SS
    out = Image.new('RGB', (W, H), (0, 0, 0))
    px = out.load()
    win = min(sw, sh) * CAUSTIC_SPAN
    for y in range(H):
        v = (y + 0.5) / (H / 2) - 1
        for x in range(W):
            u = (x + 0.5) / (W / 2) - 1
            if abs(u) + abs(v) > 1.08:
                continue  # generous: the mask does the clipping (it.108)
            # Invert the isometric projection: screen (u,v) -> ground (gx,gy).
            gx = (u + v) * 0.5
            gy = (v - u) * 0.5
            sx = int((gx + 0.5 + off_x) * win)
            sy = int((gy + 0.5 + off_y) * win)
            lum = (sample(src, sx, sy, sw, sh) - lo) / (hi - lo)
            px[x, y] = shade(min(1.0, max(0.0, lum)), gx, gy)
    small = out.resize((TILE_W, TILE_H), Image.LANCZOS).convert('RGBA')
    small.putalpha(alpha_mask)
    small.save(out_path)


def water_shade(lum, gx, gy):
    """
    Deep water, with the caustic filaments as cold light on top of it.

    THE BASE IS FLAT (it.108). it.107 ramped it across the tile from DEEP to
    SHALLOW to keep a still river from reading as a solid colour - but `gy` is a
    position WITHIN the tile, so the ramp restarted at every tile edge and drew
    a diagonal band across the whole surface. Anything that varies per-tile is
    a grid by definition; the only thing allowed to vary here is the caustic,
    which is sampled continuously in world space. The water gets its variation
    from the light instead, which is per-tile but smooth.
    """
    k = lum ** 1.5
    return (
        min(255, int(DEEP[0] + k * 128)),
        min(255, int(DEEP[1] + k * 172)),
        min(255, int(DEEP[2] + k * 182)),
    )


def bake_shorefade(sand_img, side, out_path, mask):
    """
    THE BANK WASHING INTO THE WATER (it.108).

    An overlay laid on a WATER tile that touches land: the pack's sand, fading
    out across the diamond toward the river, so the boundary is a wet margin
    instead of a drawn line. `side` is which of the tile's four diamond edges
    the land is on (0 = -x, 1 = -y, 2 = +x, 3 = +y in ground coordinates).

    The ramp itself is the pack's own `transitions_02` gradient, sampled along
    the ground axis the land lies on - so the edge is soft and slightly ragged
    the way a real waterline is, not a linear wipe.
    """
    ramp = Image.open(os.path.join(RAW, 'ground_textures', 'transitions_02.png')).convert('L')
    rw, rh = ramp.size
    rpx = list(ramp.getdata())
    sw, sh = sand_img.size
    sand = list(sand_img.convert('L').getdata())
    slo, shi = min(sand), max(sand)
    if shi - slo < 1:
        slo, shi = 0, 255
    W, H = TILE_W * SS, TILE_H * SS
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    px = out.load()
    win = min(sw, sh) / 16.0
    for y in range(H):
        v = (y + 0.5) / (H / 2) - 1
        for x in range(W):
            u = (x + 0.5) / (W / 2) - 1
            if abs(u) + abs(v) > 1.0001:
                continue
            gx = (u + v) * 0.5
            gy = (v - u) * 0.5
            # How far into the tile we are, from the land edge (0) to the far side (1).
            d = {0: gx + 0.5, 1: gy + 0.5, 2: 0.5 - gx, 3: 0.5 - gy}[side]
            d = min(1.0, max(0.0, d))
            # The pack's ramp gives the margin its ragged edge: read a band of it
            # across the tile, so the waterline wobbles instead of ruling straight.
            wob = rpx[(int((gy + 0.5) * rh * 0.12) % rh) * rw + (int(rw * 0.30) % rw)] / 255.0
            edge = d * 1.55 + (wob - 0.5) * 0.30
            a = 1.0 - min(1.0, max(0.0, edge))
            if a <= 0.004:
                continue
            lum = (sample(sand, int((gx + 0.5) * win), int((gy + 0.5) * win), sw, sh) - slo) / (shi - slo)
            k = 0.62 + min(1.0, max(0.0, lum)) * 0.55
            px[x, y] = (min(255, int(150 * k)), min(255, int(136 * k)), min(255, int(106 * k)), int(255 * (a ** 1.25)))
    small = out.resize((TILE_W, TILE_H), Image.LANCZOS)
    # Clip to the diamond: an overlay that spills past the tile draws over its
    # neighbour and puts the seam back.
    a = small.split()[3].point(lambda p: p)
    clipped = Image.new('L', (TILE_W, TILE_H), 0)
    clipped.paste(a, (0, 0), mask)
    small.putalpha(clipped)
    small.save(out_path)


def main():
    mask = diamond_alpha()
    made = {}

    for pi, f in enumerate(CAUSTIC):
        if not os.path.exists(f):
            raise SystemExit(f'missing source frame: {f}')
        img = Image.open(f)
        for j in range(SPAN):
            for i in range(SPAN):
                name = f'water_p{pi}_{j * SPAN + i}'
                bake_diamond(img, water_shade, os.path.join(ATLAS, f'single_{name}.png'), mask, off_x=i, off_y=j)
                made[name] = {'file': f'single_{name}.png', 'w': TILE_W, 'h': TILE_H, 'nearest': False}
        print(f'  baked phase {pi} ({SPAN}x{SPAN} block) <- {os.path.basename(f)}')

    sand = Image.open(SAND)
    for side in range(4):
        name = f'shorefade_{side}'
        bake_shorefade(sand, side, os.path.join(ATLAS, f'single_{name}.png'), mask)
        made[name] = {'file': f'single_{name}.png', 'w': TILE_W, 'h': TILE_H, 'nearest': False}
    print(f'  baked 4 shoreline fades <- transitions_02.png + sand.png')

    # The it.107 flat tiles are superseded by the 3x3 block; take them out of the
    # atlas rather than leaving ten orphans behind.
    mpath = os.path.join(ATLAS, 'manifest.json')
    manifest = json.load(open(mpath, encoding='utf-8'))
    for i in range(10):
        old = f'water_{i:02d}'
        manifest['singles'].pop(old, None)
        p = os.path.join(ATLAS, f'single_{old}.png')
        if os.path.exists(p):
            os.remove(p)
    manifest['singles'].update(made)
    # Written back in the manifest's OWN shape: one-space indent, and CRLF line
    # endings, because that is what is already on disk. Get either wrong and a
    # ten-line addition lands in the diff as a 6,300-line reformat.
    with io.open(mpath, 'w', encoding='utf-8', newline='\r\n') as fh:
        fh.write(json.dumps(manifest, indent=1, ensure_ascii=False))
    print(f'manifest: {len(made)} singles written, {len(manifest["singles"])} total')


if __name__ == '__main__':
    main()
