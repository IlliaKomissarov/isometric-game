"""
BAKE THE BATTLEFIELD'S GROUND (it.112), AND SEAL EVERY GROUND DIAMOND IN THE GAME.

Two jobs, one script, because they are the same geometry problem.

------------------------------------------------------------------------------
1. THE FIELD IS NOT PAVED, AND IT IS NOT BLACK
------------------------------------------------------------------------------
it.110 dressed the battlefield out of the town's cobble/grass/dirt set plus
`farm_ash`, which is a NEAR-BLACK diamond: 29,24,18 with a range of seventeen
levels across the whole tile. On a floor lit at `exploredLight: 0.10` a tile
like that is not "burnt ground", it is a HOLE - and the field was full of
black jagged patches where the ash bands and the two burn scars fell.

This bakes the ground a week-old battlefield actually has, from the raw pack's
own photographic soil (`3rd town part/ground_textures/dirt_ground*.png`), the
grassland pack's wet broken rock (`use now/grassland/rock_diffuse_wet.png`) and
trampled straw (`straw.jpg`), and the bloody-wall plates the pools were cut
from at it.111:

  field_mud_<0..3>    churned wet earth - what two armies manoeuvring leaves
  field_gore_<0..3>   the same earth soaked through where the press was worst
  field_churn_<0..3>  earth broken up with straw, splinters and trodden spoil

Each is a full ground KIND, so the layout paints them by tile instead of laying
another few hundred decal sprites, and the lighting tints them like any floor.

------------------------------------------------------------------------------
2. THE SEAM (and why the whole map had a grid drawn on it)
------------------------------------------------------------------------------
Every shipped ground diamond - cobble, grass, dirt, sand, the inn's boards, the
cellar's flags, the ash - is ANTIALIASED along its rim: 41% of the tile is
opaque, 18% is partial. Two antialiased rims meeting over the dark ground the
scene clears to do NOT add up to one opaque tile; they leave a half-transparent
line, so every tile boundary in the game drew as a faint dark diagonal and the
floor read as a grid of separate diamonds rather than as ground.

This is exactly the fault `scripts/bake-water.py` found in the river at it.108,
and the fix is the same and is already proven: a pixel belongs to the tile whose
grid square it UNPROJECTS into (`diamond_alpha`), which partitions the screen
plane exactly - no gaps, no overlaps, no epsilon to tune.

`seal_existing()` rewrites every shipped ground single through that mask in
place: alpha becomes 0 or 255 and nothing else, the interior is filled from the
nearest painted pixel where the source rim had none, and the RGB is untouched.
It is idempotent - running it twice produces the same bytes - so it is safe to
re-run after any future ground bake.

Run:  python scripts/bake-ground.py
"""

import json
import math
import os
import random

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATLAS = os.path.join(ROOT, 'public', 'assets', 'atlas')
RAW = os.path.join(ROOT, 'public', 'assets', 'test-models')
GRASS = os.path.join(ROOT, 'public', 'assets', 'use now', 'grassland')
DIRT_DIR = os.path.join(RAW, '3rd town part', 'ground_textures')
BLOOD_DIR = os.path.join(RAW, 'bloody-wall')

TILE_W, TILE_H = 64, 32

#: The manifest's own line ending, as `scripts/bake-trader.py` writes it - so
#: re-running any bake does not flip it and churn the whole file.
CRLF = '\r\n'
SS = 4  # supersample factor: the tile is rendered 4x and box-filtered down

#: How much of a source texture one tile covers. Small numbers repeat visibly;
#: large ones turn a photograph into noise. A third reads as ground at 64x32.
SPAN = 1.0 / 3.0

# ---------------------------------------------------------------------------
# THE MASK
# ---------------------------------------------------------------------------


def diamond_alpha():
    """
    The tile's own mask, DERIVED FROM THE PROJECTION rather than drawn.

    A pixel of the tile-(0,0) sprite belongs to that tile exactly when
    unprojecting its centre lands inside tile (0,0) - `screenToWorld` in
    `utils/iso.ts`, with the `- TILE_W / 2` offset `SceneManager.addFloorSprite`
    applies to the sprite's position. That PARTITIONS the plane: every screen
    pixel is claimed by exactly one tile, so a field of these is gapless and
    non-overlapping by construction.

    Drawing the diamond instead (`|u| + |v| <= 1`, supersampled and thresholded)
    leaves a one-pixel hairline along every shared edge at every cutoff. Over
    the dark ground the scene clears to, that hairline IS the grid.
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


def dilate(mask, r=1):
    """
    The mask grown by `r` pixels, so neighbouring tiles OVERLAP instead of
    meeting.

    An exact partition is exact in the TEXTURE and not on the screen. The ground
    singles are drawn with linear filtering at whatever fractional scale the
    camera happens to be at, so every edge texel is blended with the fully
    transparent pixel outside the diamond - which is black with zero alpha - and
    the result is a dark, half-transparent fringe on all four sides of every
    tile. That fringe is the grid the floor still had after the partition was
    fixed, and no amount of getting the mask righter removes it, because the
    fault is in the sampler and not in the mask.

    One pixel of overlap puts an OPAQUE neighbour under the fringe, so there is
    nothing for it to show against. It costs a one-pixel halo at the very edge
    of a map, where there is nothing to see anyway.
    """
    src = mask.load()
    out = Image.new('L', mask.size, 0)
    dst = out.load()
    w, h = mask.size
    for y in range(h):
        for x in range(w):
            if src[x, y]:
                dst[x, y] = 255
                continue
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and src[nx, ny]:
                        dst[x, y] = 255
                        break
                else:
                    continue
                break
    return out


MASK = diamond_alpha()
#: What is actually written: the partition, plus one pixel of bleed. See `dilate`.
MASK_OUT = dilate(MASK)

#: Per-variant gain solved by `bake` so every variant of a kind weighs the same.
CAL = {'gain': 1.0}


def unproject(pxi, py, ss):
    """Screen pixel (in the tile sprite's own box, supersampled) -> ground (u, v)."""
    sx = (pxi + 0.5) / ss - TILE_W / 2
    sy = (py + 0.5) / ss
    a = sx / (TILE_W / 2)
    b = sy / (TILE_H / 2)
    return (a + b) / 2, (b - a) / 2


# ---------------------------------------------------------------------------
# SOURCES
# ---------------------------------------------------------------------------


def load(path, size=None):
    im = Image.open(path).convert('RGB')
    if size:
        im = im.resize(size, Image.LANCZOS)
    return im


def pixels(im):
    return im.load(), im.size[0], im.size[1]


def wrap_sample(px, w, h, u, v):
    return px[int(u) % w, int(v) % h]


def _h(ix, iy):
    n = (ix * 374761393 + iy * 668265263) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def noise(u, v):
    """
    Smooth value noise on the GROUND PLANE, two octaves, 0..1.

    Grain with NO SHAPE IN IT. Any photographic plate sampled small enough to
    read as grain still carries blotches, and a blotch is a shape: it repeats
    with the texture and stamps the same mark in tile after tile - which is
    what the first three passes at `field_gore` all did. Noise cannot repeat
    recognisably because there is nothing in it to recognise.
    """
    total = 0.0
    amp = 1.0
    norm = 0.0
    for freq in (14.0, 31.0):
        x = u * freq
        y = v * freq
        ix = math.floor(x)
        iy = math.floor(y)
        fx = x - ix
        fy = y - iy
        sx = fx * fx * (3 - 2 * fx)
        sy = fy * fy * (3 - 2 * fy)
        a = _h(ix, iy)
        b = _h(ix + 1, iy)
        c = _h(ix, iy + 1)
        d = _h(ix + 1, iy + 1)
        total += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy)
        norm += amp
        amp *= 0.5
    return total / norm


# ---------------------------------------------------------------------------
# THE BAKE
# ---------------------------------------------------------------------------


def bake(name, shade, variants=4, seed=0, weight=None, target=0.0):
    """
    Render `variants` diamonds of one ground kind.

    `shade(u, v)` is handed the GROUND-PLANE position of the pixel, in tiles,
    and returns an (r, g, b) triple. Because it is sampled in world space the
    texture lies flat on the ground instead of being a square picture squashed
    into a diamond, and the per-variant offsets keep neighbouring tiles from
    repeating.

    EVERY VARIANT MUST WEIGH THE SAME (it.112). The game picks a ground tile's
    variant by `(gx * 5 + gy * 11) % 4`, which scatters the four across the map
    - so if one variant is heavily soaked and another is barely marked, the
    result is not detail, it is a four-tile MOSAIC, and a mosaic is a grid. Hand
    in `weight(u, v)` - the quantity that varies, in 0..1 - and each variant is
    pre-measured over its own diamond and given the gain that lands its mean on
    `target`. The variants then differ in their pattern and not in their weight.
    """
    out = []
    for v in range(variants):
        rnd = random.Random(seed * 977 + v)
        ox = rnd.uniform(0, 40)
        oy = rnd.uniform(0, 40)
        if weight is not None:
            tot = 0.0
            n = 0
            for py in range(0, TILE_H * SS, 2):
                for pxi in range(0, TILE_W * SS, 2):
                    u, vv = unproject(pxi, py, SS)
                    tot += weight(u + ox, vv + oy)
                    n += 1
            mean = tot / max(1, n)
            CAL['gain'] = min(4.0, target / mean) if mean > 1e-4 else 1.0
        else:
            CAL['gain'] = 1.0
        big = Image.new('RGB', (TILE_W * SS, TILE_H * SS), (0, 0, 0))
        bp = big.load()
        for py in range(TILE_H * SS):
            for pxi in range(TILE_W * SS):
                u, vv = unproject(pxi, py, SS)
                bp[pxi, py] = shade(u + ox, vv + oy)
        small = big.resize((TILE_W, TILE_H), Image.BOX).convert('RGBA')
        small.putalpha(MASK_OUT)
        path = os.path.join(ATLAS, 'single_%s_%d.png' % (name, v))
        small.save(path)
        out.append(('%s_%d' % (name, v), path))
    return out


def clamp8(x):
    return 0 if x < 0 else (255 if x > 255 else int(x))


def build_field_kinds():
    """The three ground kinds the battlefield is made of."""
    # The soil: three photographic dirt plates, averaged into one deep,
    # slightly mottled body so no single plate's lighting shows through.
    soils = [load(os.path.join(DIRT_DIR, n), (512, 512)) for n in ('dirt_ground.png', 'dirt_ground_v2.png', 'dirt_ground_v3.png')]
    soil_px = [pixels(s) for s in soils]
    # The clods: wet broken rock, blurred just enough to stop reading as rock.
    clod = load(os.path.join(GRASS, 'rock_diffuse_wet.png'), (512, 512)).filter(ImageFilter.GaussianBlur(1.4))
    clod_px = pixels(clod)
    # The spoil: trodden straw and stalks.
    straw = load(os.path.join(GRASS, 'straw.jpg'), (512, 512))
    straw_px = pixels(straw)
    # The blood: the thickest of the bloody-wall plates, used as a STAIN MAP -
    # its red excess says how soaked the earth is, never its own colour (the
    # it.111 lesson: keep the photograph's colour and the field goes pink).
    stain = load(os.path.join(BLOOD_DIR, '14.png'), (512, 512)).filter(ImageFilter.GaussianBlur(9))
    stain_px = pixels(stain)
    stain2 = load(os.path.join(BLOOD_DIR, '13.png'), (512, 512)).filter(ImageFilter.GaussianBlur(9))
    stain2_px = pixels(stain2)

    SC = 512 * SPAN  # source pixels per tile

    def soil_at(u, v, which):
        p, w, h = soil_px[which]
        return wrap_sample(p, w, h, u * SC, v * SC)

    def mud_body(u, v):
        """
        Wet churned earth.

        The photographic plates are a DRY ORANGE lane - bake them straight and
        the field comes out terracotta. The body is pulled 55% of the way to its
        own luminance (wet soil at night has almost no hue left in it), taken
        down to about two thirds, and only then given back a little warmth, so
        it lands near the town dirt's weight without any of its brightness.
        """
        a = soil_at(u, v, 1)
        b = soil_at(u * 0.37 + 11, v * 0.37 - 7, 2)
        # The swell: where the ground is standing water and where it has dried.
        t = 0.5 + 0.5 * math.sin(u * 0.55) * math.cos(v * 0.47 + 1.1)
        r = a[0] * (1 - t) + b[0] * t
        g = a[1] * (1 - t) + b[1] * t
        bl = a[2] * (1 - t) + b[2] * t
        # Clods and hoof-broken ground on top.
        c, cw, ch = clod_px
        cl = wrap_sample(c, cw, ch, u * SC * 1.9 + 63, v * SC * 1.9 + 17)
        k = (cl[0] + cl[1] + cl[2]) / 765.0
        r = r * (0.74 + 0.42 * k)
        g = g * (0.74 + 0.42 * k)
        bl = bl * (0.74 + 0.42 * k)
        lum = r * 0.30 + g * 0.59 + bl * 0.11
        DESAT = 0.55
        r = (r * (1 - DESAT) + lum * DESAT) * 0.66 + 6
        g = (g * (1 - DESAT) + lum * DESAT) * 0.66 + 3
        bl = (bl * (1 - DESAT) + lum * DESAT) * 0.66 + 1
        return r, g, bl

    def straw_w(u, v):
        """How much trodden spoil is on this patch, 0..1."""
        s, sw, sh = straw_px
        st = wrap_sample(s, sw, sh, u * SC * 1.15 + 200, v * SC * 1.15 + 91)
        k = (st[0] + st[1] + st[2]) / 765.0
        return max(0.0, (k - 0.34) / 0.40) ** 1.5

    def blood_w(u, v):
        """
        How soaked this patch of earth is, 0..1.

        THE SHAPE OF THE STAIN IS THE SOIL'S, NOT THE PLATE'S. Sampling the
        bloody-wall plate directly gives blood the plate's own blotches, and a
        blotch of any size is a SHAPE - which repeats with the texture and
        stamps the same mark in tile after tile. The plate is blurred to nothing
        but a slow swell (how much blood is in this part of the field at all)
        and the grain that actually draws the stain is the SOIL'S OWN clods, the
        same field that keeps `field_mud` from repeating.
        """
        p, w, h = stain_px
        q, w2, h2 = stain2_px
        s1 = wrap_sample(p, w, h, u * SC * 0.07 + 37, v * SC * 0.07 + 128)
        s2 = wrap_sample(q, w2, h2, u * SC * 0.04 - 60, v * SC * 0.04 + 24)
        e1 = max(0.0, (s1[0] - (s1[1] + s1[2]) * 0.5 - 10) / 48.0)
        e2 = max(0.0, (s2[0] - (s2[1] + s2[2]) * 0.5 - 10) / 52.0)
        swell = min(1.0, e1 * 0.8 + e2 * 0.5)
        return min(1.0, swell * (0.80 + 0.36 * noise(u, v)))

    def mud(u, v):
        r, g, b = mud_body(u, v)
        return clamp8(r), clamp8(g), clamp8(b)

    def churn(u, v):
        """
        The same mud with the field's spoil trodden into it: straw, stalks and
        splinters. The straw is sampled over a WIDE span (five tiles, so nothing
        repeats at tile scale) and only its brightest stalks show at all - at
        full contrast the litter became a pattern, and a pattern on the ground
        is a grid by another name.
        """
        r, g, b = mud_body(u, v)
        m = min(0.85, straw_w(u, v) * CAL['gain'])
        return (
            clamp8(r * (1 - m) + (r + 34) * m),
            clamp8(g * (1 - m) + (g + 27) * m),
            clamp8(b * (1 - m) + (b + 16) * m),
        )

    def gore(u, v):
        """
        SOAKED, NOT PAINTED.

        The stain plate's RED EXCESS over its own grey says how much blood is in
        this patch of earth; the colour is then mixed toward a dark arterial
        brown. The threshold matters more than anything else here: the first
        pass used the excess raw and every tile came out at t = 1, which is a
        red CARPET - the exact fault it.111 took out of the decals. Only the top
        of the plate's range counts as soaked, the mix never reaches 1, and
        earth shows through everywhere.
        """
        r, g, b = mud_body(u, v)
        t = min(0.92, blood_w(u, v) * CAL['gain'])
        # Blood that has been in the ground a week: nearly black in the thick,
        # rust at the edges. There is no light on this field to make it bright.
        br = 50 + 14 * (1 - t)
        bg = 19 + 16 * (1 - t)
        bb = 17 + 15 * (1 - t)
        return (
            clamp8(r * (1 - t) + br * t),
            clamp8(g * (1 - t) + bg * t),
            clamp8(b * (1 - t) + bb * t),
        )

    made = []
    made += bake('field_mud', mud, seed=1)
    made += bake('field_churn', churn, seed=2, weight=straw_w, target=0.16)
    made += bake('field_gore', gore, seed=3, weight=blood_w, target=0.70)
    return made


# ---------------------------------------------------------------------------
# SEALING WHAT IS ALREADY SHIPPED
# ---------------------------------------------------------------------------

#: Kinds whose four shipped variants disagree in BRIGHTNESS rather than in
#: texture. The game scatters the four across the map by `(gx * 5 + gy * 11) % 4`,
#: so a fifty-level spread between them is not variety - it is a chequerboard,
#: and the town square has been paved in one since it.56.
LEVEL = ['town_cobble']

SEAL = [
    'town_cobble', 'town_grass', 'town_dirt', 'town_sand',
    'inn_boards', 'inn_stone', 'cellar_flag', 'cellar_dirt',
    'farm_ash', 'farm_coals',
]


def seal_one(path):
    """
    Rewrite one ground diamond through the projection mask, in place.

    Alpha comes out 0 or 255 and nothing else. Where the mask claims a pixel
    the source never painted (its antialiased rim faded to nothing before the
    tile boundary), the colour is taken from the nearest pixel that WAS
    painted, so the rim keeps the tile's own edge treatment instead of a
    guessed colour. RGB inside the tile is untouched.
    """
    im = Image.open(path).convert('RGBA')
    if im.size != (TILE_W, TILE_H):
        return False
    src = im.load()
    mp = MASK_OUT.load()
    # Nearest painted pixel, by a two-pass chamfer over the alpha>96 set.
    INF = 10 ** 6
    dist = [[0 if src[x, y][3] > 96 else INF for y in range(TILE_H)] for x in range(TILE_W)]
    src_of = [[(x, y) for y in range(TILE_H)] for x in range(TILE_W)]
    for _ in range(2):
        for y in range(TILE_H):
            for x in range(TILE_W):
                for dx, dy in ((-1, 0), (0, -1), (-1, -1), (1, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < TILE_W and 0 <= ny < TILE_H and dist[nx][ny] + 1 < dist[x][y]:
                        dist[x][y] = dist[nx][ny] + 1
                        src_of[x][y] = src_of[nx][ny]
        for y in range(TILE_H - 1, -1, -1):
            for x in range(TILE_W - 1, -1, -1):
                for dx, dy in ((1, 0), (0, 1), (1, 1), (-1, 1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < TILE_W and 0 <= ny < TILE_H and dist[nx][ny] + 1 < dist[x][y]:
                        dist[x][y] = dist[nx][ny] + 1
                        src_of[x][y] = src_of[nx][ny]
    out = Image.new('RGBA', (TILE_W, TILE_H), (0, 0, 0, 0))
    op = out.load()
    for y in range(TILE_H):
        for x in range(TILE_W):
            if not mp[x, y]:
                continue
            r, g, b, a = src[x, y]
            if a <= 96:
                sx, sy = src_of[x][y]
                r, g, b = src[sx, sy][:3]
            op[x, y] = (r, g, b, 255)
    out.save(path)
    return True


def level_variants():
    """
    Scale each variant of a kind onto the set's mean brightness, keeping its own
    texture. Only applied where the spread is more than a few levels, and only
    to the kinds listed in `LEVEL` - a genuinely two-toned floor (the inn's
    boards run over 2x2 blocks on purpose) must keep its tones.
    """
    n = 0
    for stem in LEVEL:
        paths = [os.path.join(ATLAS, 'single_%s_%d.png' % (stem, i)) for i in range(4)]
        if not all(os.path.exists(q) for q in paths):
            continue
        ims = [Image.open(q).convert('RGBA') for q in paths]
        means = []
        for im in ims:
            px = im.load()
            tot = 0.0
            cnt = 0
            for y in range(im.size[1]):
                for x in range(im.size[0]):
                    r, g, b, a = px[x, y]
                    if a < 128:
                        continue
                    tot += r * 0.30 + g * 0.59 + b * 0.11
                    cnt += 1
            means.append(tot / max(1, cnt))
        want = sum(means) / len(means)
        for im, mean, q in zip(ims, means, paths):
            k = want / mean if mean > 1 else 1.0
            px = im.load()
            for y in range(im.size[1]):
                for x in range(im.size[0]):
                    r, g, b, a = px[x, y]
                    if a < 128:
                        continue
                    px[x, y] = (clamp8(r * k), clamp8(g * k), clamp8(b * k), a)
            im.save(q)
            n += 1
    return n


def seal_existing():
    n = 0
    for stem in SEAL:
        for name in [stem] + ['%s_%d' % (stem, i) for i in range(4)]:
            p = os.path.join(ATLAS, 'single_%s.png' % name)
            if os.path.exists(p) and seal_one(p):
                n += 1
    return n


# ---------------------------------------------------------------------------


def register(made):
    """Add the new singles to the atlas manifest (the only way to load one)."""
    mpath = os.path.join(ATLAS, 'manifest.json')
    with open(mpath, 'r', encoding='utf-8') as f:
        man = json.load(f)
    for name, path in made:
        man['singles'][name] = {
            'file': 'single_%s.png' % name,
            'w': TILE_W,
            'h': TILE_H,
            'nearest': False,
        }
    # The same writer `scripts/bake-trader.py` uses, so re-running any bake
    # does not flip the manifest's line endings and churn the whole file.
    with open(mpath, 'w', encoding='utf-8', newline=CRLF) as f:
        f.write(json.dumps(man, indent=1, ensure_ascii=False))
    return len(made)


if __name__ == '__main__':
    made = build_field_kinds()
    print('baked %d field ground diamonds' % len(made))
    print('registered %d singles' % register(made))
    print('sealed %d shipped ground diamonds to the projection mask' % seal_existing())
    print('levelled %d variants onto their kind mean' % level_variants())
