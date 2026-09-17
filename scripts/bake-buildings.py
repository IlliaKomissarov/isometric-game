"""
BUILDINGS AND OUTDOOR PROPS from the graphics-update drop (it.114).

A table-driven bake: every group below is a list of inputs, and the plumbing
(keying, bleeding, premultiplied LANCZOS scaling, the manifest lock) is shared
with the other it.114 bakes through `bakelib`. Nothing here touches an existing
atlas entry - every name is under a prefix this script owns:

    bld_   polyy "City Builder: Village Buildings" (CC0), one rotation per
           building with the door on the camera-left (south-west) face like
           `house_a`, and a `_b` second rotation where one reads well
    tav_   Bleed's medieval tavern, two rotations, shadow composited at 60 %
    cot_   the three small cottages in `house/`
    bld_manor_  two rotations of the big blue-roofed house in `house/rem_*`
    cart_  eight 45-degree rotations of the barrel cart, shadow at 60 %
    tuft_  twelve grass tufts from the Grass Pack sheets, shadow at 60 %
    ow_    four ground kinds (forest litter, moss, gravel, mud) cut from the
           Overworld sheets, four gain-matched 64x32 diamonds each
    anc_prop_  the loose Ancient Tiles props (boxes, carriages, chests,
           coffins, gates, mushrooms, rocks, towers), trimmed, at x1
    crate_ six crates from the Screaming Brain 64x64 crate sheets
    stair_ two stair cells each from the Brick / Stone / Wood 128x128 sheets

Footprints and scale. A standing prop is one sprite anchored at the SOUTH
corner of its w x h tile footprint (`TownProps.standing()`), so a building is
scaled so that its base diamond spans `w` tiles: 3 tiles = 192 px for houses,
2 tiles = 128 px for wells / shrines / stalls, 4 tiles = 256 px for the chapel,
village hall, longhouse and mills. The polyy sheets' biggest size is the 128
grid (the base fills one 128 px diamond), so a 3-tile house is a x1.5 upscale
and a 4-tile building a x2 upscale - LANCZOS on premultiplied alpha, which is
soft but not fringed. The report prints, for every single, the footprint it
was scaled for and the measured anchor (the lowest opaque row of the BASE,
not a shadow, as a fraction of the image height).

Run:
    python scripts/bake-buildings.py                # bake everything + previews
    python scripts/bake-buildings.py --only village # one group
    python scripts/bake-buildings.py --preview      # previews only, atlas untouched
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakelib import (ATLAS, DROP, MASK_OUT, TILE_H, TILE_W, ground_diamond, key_magenta,  # noqa: E402
                     write_single, read_manifest)

PREVIEW = os.path.join(os.environ.get('CLAUDE_SCRATCHPAD',
                       r'C:\Users\user\AppData\Local\Temp\claude\C--Users-user-Desktop-isometric-game'
                       r'\9b751797-5b62-470f-a302-7c92b37a98e4\scratchpad'), 'bake-buildings')

REPORT = []          # (name, w, h, footprint, anchorX, anchorY, note)
DRY = False          # --preview: never write to the atlas


# ---------------------------------------------------------------------------
# helpers (numpy where bakelib's per-pixel loops would take minutes)
# ---------------------------------------------------------------------------


def np_bleed(im, passes=4):
    """Like bakelib.bleed, vectorised: transparent pixels take the mean colour of opaque neighbours."""
    a = np.array(im.convert('RGBA')).astype(np.float32)
    for _ in range(passes):
        rgb, al = a[:, :, :3], a[:, :, 3]
        opaque = (al >= 8).astype(np.float32)
        acc = np.zeros_like(rgb)
        cnt = np.zeros_like(al)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                sh_rgb = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
                sh_op = np.roll(np.roll(opaque, dy, axis=0), dx, axis=1)
                acc += sh_rgb * sh_op[:, :, None]
                cnt += sh_op
        fill = (al < 8) & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill][:, None]
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def scale_rgba(im, k):
    """Premultiplied LANCZOS resize (no dark fringe from transparent black)."""
    if k == 1.0:
        return im.convert('RGBA')
    w, h = im.size
    nw, nh = max(1, int(round(w * k))), max(1, int(round(h * k)))
    return im.convert('RGBa').resize((nw, nh), Image.LANCZOS).convert('RGBA')


def crop_alpha(im, thresh=8):
    a = np.array(im.convert('RGBA'))[:, :, 3]
    ys, xs = np.where(a > thresh)
    if len(ys) == 0:
        return im, (0, 0)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    return im.crop(box), (box[0], box[1])


def flood_key(im, thresh=28):
    """Turn the black (or any) background connected to the cell corners transparent."""
    im = im.convert('RGBA')
    w, h = im.size
    for xy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)):
        r, g, b, a = im.getpixel(xy)
        if a and max(r, g, b) < thresh:
            ImageDraw.floodfill(im, xy, (0, 0, 0, 0), thresh=thresh)
    return im


def base_anchor(im, band=0.12, thresh=128):
    """
    The south corner of the base: the lowest row with alpha >= thresh inside the
    central column band, and the mean column of that row's opaque pixels.
    Returns (anchorX, anchorY) as fractions of the image size.
    """
    a = np.array(im.convert('RGBA'))[:, :, 3]
    h, w = a.shape
    lo, hi = int(w * (0.5 - band)), int(w * (0.5 + band)) + 1
    rows = np.where((a[:, lo:hi] >= thresh).any(axis=1))[0]
    if len(rows) == 0:
        return 0.5, 1.0
    y = rows.max()
    xs = np.where(a[y, :] >= thresh)[0]
    xs = xs[(xs >= lo) & (xs < hi)] if len(xs[(xs >= lo) & (xs < hi)]) else xs
    return round(float(xs.mean() + 0.5) / w, 3), round(float(y + 1) / h, 3)


def composite_shadow(body, shadow, alpha=0.6):
    """`shadow` (same canvas as `body`) under the body at `alpha` of its own alpha."""
    sh = np.array(shadow.convert('RGBA')).astype(np.float32)
    sh[:, :, 3] *= alpha
    out = Image.fromarray(sh.astype(np.uint8), 'RGBA')
    out.alpha_composite(body.convert('RGBA'))
    return out


def emit(name, im, footprint, note='', anchor=None):
    """Register a single (unless --preview) and record it for the report."""
    im = im.convert('RGBA')
    ax, ay = anchor or base_anchor(im)
    if not DRY:
        write_single(name, im)
    ZOOM[name] = im
    REPORT.append((name, im.size[0], im.size[1], footprint, ax, ay, note))
    return im


def grid_preview(items, path, cols, cell=None, scale=1.0, bg=(52, 56, 66, 255), marks=True):
    """A labelled grid; each item is (label, image, (anchorX, anchorY) or None)."""
    ims = [scale_rgba(im, scale) if scale != 1.0 else im.convert('RGBA') for _, im, _ in items]
    w = cell[0] if cell else max(i.size[0] for i in ims)
    h = cell[1] if cell else max(i.size[1] for i in ims)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGBA', (w * cols, (h + 14) * rows), bg)
    d = ImageDraw.Draw(sheet)
    for i, ((label, _, anc), im) in enumerate(zip(items, ims)):
        x = (i % cols) * w + (w - im.size[0]) // 2
        y = (i // cols) * (h + 14) + 14 + (h - im.size[1])
        sheet.paste(im, (x, y), im)
        d.text(((i % cols) * w + 2, (i // cols) * (h + 14) + 1), label, fill=(255, 225, 120, 255))
        if marks and anc:
            mx, my = x + anc[0] * im.size[0], y + anc[1] * im.size[1]
            d.line((mx - 6, my, mx + 6, my), fill=(255, 40, 40, 255))
            d.line((mx, my - 6, mx, my + 6), fill=(255, 40, 40, 255))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path)
    return path


ZOOM = {}            # name -> image, for the fringe check


def zoom_preview(names, path, k=4):
    """A few singles at x4 NEAREST on a light checkerboard: any pink or black fringe shows here."""
    ims = [(n, ZOOM[n]) for n in names if n in ZOOM]
    if not ims:
        return
    w = sum(im.size[0] * k + 8 for _, im in ims)
    h = max(im.size[1] * k for _, im in ims) + 14
    sheet = Image.new('RGBA', (w, h), (235, 235, 235, 255))
    d = ImageDraw.Draw(sheet)
    for y in range(0, h, 8):
        for x in range(0, w, 8):
            if (x // 8 + y // 8) % 2:
                d.rectangle((x, y, x + 7, y + 7), fill=(200, 200, 200, 255))
    x = 0
    for n, im in ims:
        big = im.resize((im.size[0] * k, im.size[1] * k), Image.NEAREST)
        sheet.alpha_composite(big, (x, 14))
        d.text((x + 2, 1), n, fill=(180, 30, 30, 255))
        x += big.size[0] + 8
    sheet.save(path)


def last(name):
    """(anchorX, anchorY) of the most recently emitted `name`, for the previews."""
    for r in reversed(REPORT):
        if r[0] == name:
            return (r[4], r[5])
    return None


# ---------------------------------------------------------------------------
# (a) polyy village buildings
# ---------------------------------------------------------------------------

VILLAGE_DIR = os.path.join(DROP, 'castles and houses')

#: name -> (footprint tiles, frame for `_a` (door on the camera-left face), frame for `_b` or None)
#: Frames are the 11.25-degree rotation index in the 8x4 sheet; 4/12/20/28 are
#: the four true diagonals. Chosen by eye from a contact sheet of every
#: building's four diagonals.
VILLAGE = [
    ('thatched_cottage',   3, 12, 28),
    ('timber_frame_house', 3, 12, 28),
    ('blacksmith_forge',   3, 4,  12),
    ('tavern_inn',         3, 12, 4),
    ('watermill',          4, 12, 4),
    ('windmill',           4, 4,  12),
    ('stone_chapel',       4, 4,  28),
    ('stone_well',         2, 4,  12),
    ('bakery',             3, 12, 4),
    ('stable',             3, 12, 4),
    ('granary_staddle',    3, 12, 4),
    ('gatehouse',          3, 12, 28),
    ('watchtower',         3, 4,  12),
    ('apothecary',         3, 12, 28),
    ('fisherman_hut',      3, 4,  12),
    ('round_cottage',      3, 12, 28),
    ('wizard_tower',       3, 12, 28),
    ('witch_hut',          3, 12, 4),
    ('dovecote',           2, 28, 12),
    ('lumber_shed',        3, 12, 4),
    ('village_hall',       4, 12, 28),
    ('longhouse',          4, 12, 4),
    ('wayside_shrine',     2, 4,  28),
    ('farmhouse_barn',     3, 12, 4),
    ('market_stall',       2, 4,  28),
]


def village_sheet(name, size='128sun', coloring='nopalette'):
    for part in ('5', '8'):
        p = os.path.join(VILLAGE_DIR, part, 'sprite', size, '1x1_%s_%s.png' % (name, coloring))
        if os.path.exists(p):
            return Image.open(p).convert('RGBA')
    raise FileNotFoundError(name)


def village_cell(sheet, frame):
    cw, ch = sheet.size[0] // 8, sheet.size[1] // 4
    r, c = divmod(frame, 8)
    return sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))


def village_anchor(sheet, im, k, ox, oy):
    """
    polyy centres every base diamond on the cell's vertical axis (README:
    "anchor the sprite at the bottom center of its cell"), and the alpha crop
    is what makes the sprite asymmetric - so anchorX is the cell centre carried
    through the scale and the crop, and anchorY is the lowest opaque row in a
    narrow column band around it (an annex hanging below the base off to one
    side, or a rotation that reaches lower, must not pull it down).
    """
    cw = sheet.size[0] // 8
    cx = cw / 2.0 * k - ox
    a = np.array(im)[:, :, 3]
    h, w = a.shape
    lo, hi = max(0, int(cx - 6 * k)), min(w, int(cx + 6 * k) + 1)
    rows = np.where((a[:, lo:hi] >= 128).any(axis=1))[0]
    y = rows.max() + 1 if len(rows) else h
    return round(cx / w, 3), round(float(y) / h, 3)


def bake_village():
    items = []
    for name, tiles, fa, fb in VILLAGE:
        sheet = village_sheet(name)
        k = tiles * TILE_W / 128.0          # the base fills one 128 px diamond
        for suffix, frame in (('a', fa), ('b', fb)):
            if frame is None:
                continue
            cell = np_bleed(village_cell(sheet, frame), 3)
            im, (ox, oy) = crop_alpha(scale_rgba(cell, k))
            anchor = village_anchor(sheet, im, k, ox, oy)
            key = 'bld_%s_%s' % (name, suffix)
            emit(key, im, '%dx%d' % (tiles, tiles), 'polyy frame %d, x%.2f from 128sun' % (frame, k), anchor)
            items.append((key, im, last(key)))
    grid_preview(items[0::2], os.path.join(PREVIEW, 'village_a.png'), cols=5)
    grid_preview(items[1::2], os.path.join(PREVIEW, 'village_b.png'), cols=5)


# ---------------------------------------------------------------------------
# (b) Bleed's tavern
# ---------------------------------------------------------------------------

TAVERN = [('tav_a', 1), ('tav_b', 7)]      # rotation file index (0..7)
TAVERN_SCALE = 0.5                          # 622 px render -> a 4x4 base (~256 px)


def bake_tavern():
    items = []
    for key, rot in TAVERN:
        body = Image.open(os.path.join(DROP, 'tavern', 'medieval-tavern_%d0000.png' % rot)).convert('RGBA')
        shadow = Image.open(os.path.join(DROP, 'tavern', '_shadow', 'shadow_medieval-tavern_%d0000.png' % rot)).convert('RGBA')
        both = composite_shadow(np_bleed(body, 3), shadow, 0.6)
        both, (ox, oy) = crop_alpha(both)
        body_c = body.crop((ox, oy, ox + both.size[0], oy + both.size[1]))
        im = scale_rgba(both, TAVERN_SCALE)
        anchor = base_anchor(scale_rgba(body_c, TAVERN_SCALE), band=0.25)
        emit(key, im, '4x4', 'Bleed rotation %d, x%.2f, shadow 60%%' % (rot, TAVERN_SCALE), anchor)
        items.append((key, im, anchor))
    grid_preview(items, os.path.join(PREVIEW, 'tavern.png'), cols=2)


# ---------------------------------------------------------------------------
# (c) cottages and the manor
# ---------------------------------------------------------------------------

COTTAGES = [('cot_a', 'house1.png'), ('cot_b', 'house1b.png'), ('cot_c', 'house1c.png')]
COTTAGE_SCALE = 0.75                        # the 178 px fenced yard -> a 2x2 base (~128 px)
MANOR = [('bld_manor_a', 14), ('bld_manor_b', 2)]
MANOR_SCALE = 0.38                          # the stone base spans ~565 px in the render; 4 tiles = 256 px


def manor_anchor(im):
    """The manor's grass patch hangs below the stone base: the base's south corner is the lowest NON-GREEN opaque row."""
    a = np.array(im.convert('RGBA')).astype(int)
    r, g, b, al = a[:, :, 0], a[:, :, 1], a[:, :, 2], a[:, :, 3]
    solid = (al >= 200) & ~((g > r + 6) & (g > b + 20))       # drop the yellow-green grass
    h, w = al.shape
    lo, hi = int(w * 0.3), int(w * 0.7)
    rows = np.where(solid[:, lo:hi].any(axis=1))[0]
    y = rows.max()
    xs = np.where(solid[y, lo:hi])[0] + lo
    return round(float(xs.mean() + 0.5) / w, 3), round(float(y + 1) / h, 3)


def bake_cottages():
    items = []
    for key, fn in COTTAGES:
        src = np_bleed(Image.open(os.path.join(DROP, 'house', fn)).convert('RGBA'), 3)
        im, _ = crop_alpha(scale_rgba(src, COTTAGE_SCALE))
        emit(key, im, '2x2', '%s x%.2f' % (fn, COTTAGE_SCALE))
        items.append((key, im, last(key)))
    for key, frame in MANOR:
        src = np_bleed(Image.open(os.path.join(DROP, 'house', 'rem_%04d.png' % frame)).convert('RGBA'), 3)
        im, _ = crop_alpha(scale_rgba(src, MANOR_SCALE))
        anchor = manor_anchor(im)
        emit(key, im, '4x4', 'rem_%04d x%.3f' % (frame, MANOR_SCALE), anchor)
        items.append((key, im, anchor))
    grid_preview(items, os.path.join(PREVIEW, 'cottages.png'), cols=5)


# ---------------------------------------------------------------------------
# (d) the cart, 8 rotations
# ---------------------------------------------------------------------------

CART_SCALE = 0.2                            # 551 px render -> ~96 px side-on


def bake_cart():
    items = []
    for i in range(8):
        rot = i * 2                          # every second 22.5-degree file = 45 degrees
        body = Image.open(os.path.join(DROP, 'cart', 'cart_%d0000.png' % rot)).convert('RGBA')
        shadow = Image.open(os.path.join(DROP, 'cart', '_shadow', 'shadow_cart_%d0000.png' % rot)).convert('RGBA')
        both = composite_shadow(np_bleed(body, 3), shadow, 0.6)
        both, (ox, oy) = crop_alpha(both)
        body_c = body.crop((ox, oy, ox + both.size[0], oy + both.size[1]))
        im = scale_rgba(both, CART_SCALE)
        anchor = base_anchor(scale_rgba(body_c, CART_SCALE), band=0.5, thresh=100)
        key = 'cart_%d' % i
        emit(key, im, '2x1', 'cart_%d0000 x%.2f, shadow 60%%' % (rot, CART_SCALE), anchor)
        items.append((key, im, anchor))
    grid_preview(items, os.path.join(PREVIEW, 'cart.png'), cols=4, scale=2.0)


# ---------------------------------------------------------------------------
# (e) grass tufts
# ---------------------------------------------------------------------------

TUFT_SHEETS = [1, 3, 8, 12]                 # four sheets, three tufts each
TUFT_SCALE = 0.5


def bake_tufts():
    items = []
    letters = 'abcdefghijkl'
    n = 0
    for sheetno in TUFT_SHEETS:
        sh = Image.open(os.path.join(DROP, 'Grass Pack', 'Grass%d.png' % sheetno)).convert('RGBA')
        shd = Image.open(os.path.join(DROP, 'Grass Pack', 'Grass Shadow%d.png' % sheetno)).convert('RGBA')
        cw, ch = sh.size[0] / 9.0, sh.size[1] / 9.0
        cells = []
        for r in range(9):
            for c in range(9):
                box = (int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch))
                cov = int((np.array(sh.crop(box))[:, :, 3] > 8).sum())
                cells.append((cov, r, c, box))
        # the three fullest tufts, spread across the sheet (one per third of the rows)
        picks = []
        for third in range(3):
            cand = [x for x in cells if third * 3 <= x[1] < third * 3 + 3]
            picks.append(max(cand))
        for cov, r, c, box in picks:
            both = composite_shadow(np_bleed(sh.crop(box), 2), shd.crop(box), 0.6)
            both, _ = crop_alpha(both)
            im = scale_rgba(both, TUFT_SCALE)
            key = 'tuft_%s' % letters[n]
            emit(key, im, '1x1', 'Grass%d cell r%d c%d x%.1f, shadow 60%%' % (sheetno, r, c, TUFT_SCALE), (0.5, 1.0))
            items.append((key, im, (0.5, 1.0)))
            n += 1
    grid_preview(items, os.path.join(PREVIEW, 'tufts.png'), cols=6, scale=3.0)


# ---------------------------------------------------------------------------
# (f) overworld ground kinds, and the blend that lays them INTO the grass (it.115)
# ---------------------------------------------------------------------------

OW_DIR = os.path.join(DROP, 'Overworld - Large', 'Flat')
#: kind -> (target mean RGB, target luminance spread, [(sheet, row, col), ...] four cells)
#:
#: TONED, NOT GAINED (it.115). it.114 matched each cell's mean LUMINANCE to a
#: target and left the hue alone, so the moss came out olive-yellow at L 84 on a
#: floor whose grass is a dark green at L 54 - every patch read as a lit tile.
#: Each cell is now moved onto a target COLOUR, and its texture contrast onto a
#: target spread, both picked against `town_grass` / `town_dirt` (the floors
#: these lie on), so a patch is a different material in the same light.
GROUND = {
    'ow_forest': ((58, 54, 38), 10.0, [('Forest', 5, 0), ('Forest', 5, 1), ('Forest', 1, 2), ('Forest', 1, 1)]),
    'ow_moss':   ((50, 67, 34), 7.0, [('Terrain 1', 3, 0), ('Terrain 1', 3, 1), ('Terrain 1', 0, 2), ('Terrain 1', 2, 2)]),
    'ow_gravel': ((80, 76, 66), 10.0, [('Terrain 2', 0, 0), ('Terrain 2', 0, 1), ('Terrain 2', 4, 1), ('Terrain 2', 2, 0)]),
    'ow_mud':    ((58, 47, 36), 7.0, [('Terrain 1', 1, 1), ('Terrain 1', 2, 1), ('Terrain 1', 0, 0), ('Terrain 1', 1, 0)]),
    'ow_meadow': ((46, 64, 36), 8.0, [('Forest', 0, 0), ('Forest', 2, 2), ('Forest', 3, 0), ('Forest', 0, 2)]),
}
#: THE FLOWER BEDS (it.115): Screaming Brain's `Large 256x128` Flora sheets (CC0,
#: the same studio as the Overworld set). Their colour IS the point, so they are
#: not moved onto a target colour - only darkened onto a target luminance and
#: taken a little way toward grey, into the same night as the grass. Each kind
#: is two cells and their mirror images, so a bed is one kind of flower.
#: kind -> (tone, [(sheet, row, col, mirrored), ...]); tone is ('dim', luminance,
#: saturation kept) for a bed whose colour is its flowers, or ('tone', rgb, spread)
#: for a bed of pale flowers on green, whose GREEN is moved onto the grass and
#: whose flowers stay the bright spots on it.
FLORA_DIR = os.path.join(DROP, 'Large 256x128', 'Exterior', 'Flora')
FLORA = {
    'ow_flowers': (('tone', (46, 60, 34), 26.0), [('Floor_Flora_02', 0, 2, False), ('Floor_Flora_02', 2, 0, False), ('Floor_Flora_02', 0, 2, True), ('Floor_Flora_02', 2, 0, True)]),
    'ow_poppies': (('dim', 66, 0.95), [('Floor_Flora_02', 1, 0, False), ('Floor_Flora_01', 4, 2, False), ('Floor_Flora_02', 1, 0, True), ('Floor_Flora_01', 4, 2, True)]),
}
#: THE LILY PADS (it.115): three soft-edged clusters cut from the Flora sheet's
#: pad bed, laid over the river's shallows as ground paint.
LILY_CELL = ('Floor_Flora_01', 5, 0)
MAGENTA_SHEETS = ('Terrain 3', 'Water')
#: How much of a source cell's edge is the pack's outline, in source pixels (it.115).
RIM_PX = 10

#: THE BLEND SOURCES, in the order `SceneManager` indexes the atlas rows by
#: (it.115): the two town kinds the outdoor floors carry (their road and their
#: shore) and the five overworld kinds. Row = source * 4 + variant.
BLEND_SOURCES = ['town_dirt', 'town_sand', 'ow_mud', 'ow_gravel', 'ow_forest', 'ow_moss', 'ow_meadow', 'ow_flowers', 'ow_poppies']
#: The eight neighbour directions, as WORLD tile offsets from the tile the
#: overlay is drawn on: four edges, then four corners.
BLEND_DIRS = [(1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (-1, 1), (-1, -1), (1, -1)]
#: One 64x32 diamond per cell, padded a pixel all round so the sampler never bleeds.
BLEND_CELL_W, BLEND_CELL_H = TILE_W + 2, TILE_H + 2


def big_diamond_mask(w, h):
    m = np.zeros((h, w), dtype=bool)
    yy, xx = np.mgrid[0:h, 0:w]
    a = (xx + 0.5 - w / 2) / (w / 2)
    b = (yy + 0.5) / (h / 2)
    m[(np.floor((a + b) / 2) == 0) & (np.floor((b - a) / 2) == 0)] = True
    return m


_ow_cache = {}


def ow_cell(sheet, r, c, path=None):
    if sheet not in _ow_cache:
        im = Image.open(path or os.path.join(OW_DIR, 'Overworld - %s - Flat 256x128.png' % sheet)).convert('RGBA')
        if sheet in MAGENTA_SHEETS:
            im = key_magenta(im, tol=60)
        _ow_cache[sheet] = im
    cell = _ow_cache[sheet].crop((c * 256, r * 128, (c + 1) * 256, (r + 1) * 128))
    a = np.array(cell)
    # THE RIM (it.115): the pack draws a dark line round every diamond, which
    # laid edge to edge is a grid over the whole patch. The outer RIM_PX of the
    # cell is dropped and refilled from the inside before the cut.
    yy, xx = np.mgrid[0:128, 0:256]
    inner = np.abs((xx + 0.5 - 128) / 128) + np.abs((yy + 0.5 - 64) / 64) <= 1 - RIM_PX / 128
    a[~inner] = 0
    return grow_fill(a, inner, RIM_PX + 12)


def grow_fill(a, known, passes):
    """
    Refill every pixel outside `known` from its known neighbours, one ring per
    pass, marking each ring known as it goes (`np_bleed` keeps its fills at
    alpha 0 and so only ever reaches one pixel). Returns an opaque image.
    """
    rgb = a[:, :, :3].astype(np.float32)
    known = known.copy()
    for _ in range(passes):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(known.shape, dtype=np.float32)
        k = known.astype(np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx or dy:
                    acc += np.roll(np.roll(rgb * k[:, :, None], dy, axis=0), dx, axis=1)
                    cnt += np.roll(np.roll(k, dy, axis=0), dx, axis=1)
        ring = (~known) & (cnt > 0)
        rgb[ring] = acc[ring] / cnt[ring][:, None]
        known = known | ring
    out = np.dstack([np.clip(rgb, 0, 255), np.full(known.shape, 255, np.float32)]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def luminance_mean(im):
    a = np.array(im.convert('RGBA')).astype(np.float32)
    m = a[:, :, 3] >= 128
    lum = a[:, :, 0] * .30 + a[:, :, 1] * .59 + a[:, :, 2] * .11
    return float(lum[m].mean())


def tone(im, rgb, spread):
    """The cell moved onto a target mean colour and a target luminance spread."""
    a = np.array(im.convert('RGBA')).astype(np.float32)
    m = a[:, :, 3] >= 128
    col = a[:, :, :3]
    mean = col[m].mean(axis=0)
    lum = col @ np.array([.30, .59, .11], dtype=np.float32)
    k = spread / max(1.0, float(lum[m].std()))
    a[:, :, :3] = np.clip((col - mean) * k + np.array(rgb, dtype=np.float32), 0, 255)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def value_noise(size, cells, rng):
    """Smooth noise in [-1, 1]: a random `cells` grid, bicubic-upscaled to `size`."""
    g = rng.rand(cells, cells).astype(np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8), 'L').resize((size, size), Image.BICUBIC)
    return np.array(im).astype(np.float32) / 127.5 - 1.0


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def blend_alpha(d, variant):
    """
    THE FEATHER (it.115): the alpha of the overlay a tile wears on its side
    facing neighbour `d`, in the tile's own WORLD coordinates (a along x, b
    along y, both -0.5..0.5 from its centre). An edge overlay is opaque on the
    shared edge and gone about half a tile in, along a ragged line; a corner
    overlay is a small ragged fan about the shared corner. The raggedness is
    two octaves of value noise sampled in world units, a different window of it
    per direction and variant, so no two tile edges on screen match.
    """
    dx, dy = BLEND_DIRS[d]
    rng = np.random.RandomState(1000 + d * 17 + variant * 131)
    big = value_noise(256, 12, rng) * 0.7 + value_noise(256, 40, rng) * 0.3
    yy, xx = np.mgrid[0:TILE_H, 0:TILE_W].astype(np.float32)
    u = (xx + 0.5 - TILE_W / 2) / (TILE_W / 2)
    v = (yy + 0.5 - TILE_H / 2) / (TILE_H / 2)
    a = (u + v) / 2
    b = (v - u) / 2
    # the noise lives on the tile's world plane: 1 tile = 64 noise px
    ox, oy = rng.randint(32, 160), rng.randint(32, 160)
    nx = np.clip(((a + 0.5) * 64 + ox).astype(np.int32), 0, 255)
    ny = np.clip(((b + 0.5) * 64 + oy).astype(np.int32), 0, 255)
    n = big[ny, nx]
    if dx == 0 or dy == 0:
        t = a * dx + b * dy + 0.5                       # 1 on the shared edge
        al = smoothstep(0.34, 0.92, t + 0.30 * n)
        al = np.maximum(al, smoothstep(0.90, 1.0, t))    # always opaque right on the edge
    else:
        dist = np.hypot(a - 0.5 * dx, b - 0.5 * dy)     # 0 at the shared corner
        al = 1.0 - smoothstep(0.12, 0.58, dist + 0.18 * n)
    return al


def bake_ground():
    tiles_by_kind = {}
    for kind, (rgb, spread, cells) in GROUND.items():
        outs = []
        for i, (sheet, r, c) in enumerate(cells):
            raw = ground_diamond(ow_cell(sheet, r, c))
            d = tone(raw, rgb, spread)
            key = '%s_%d' % (kind, i)
            emit(key, d, '1x1', '%s r%d c%d, mean L %.0f -> %.0f' % (sheet, r, c, luminance_mean(raw), luminance_mean(d)), (0.5, 1.0))
            outs.append(d)
        tiles_by_kind[kind] = outs
    for kind, (how, cells) in FLORA.items():
        outs = []
        for i, (sheet, r, c, mirrored) in enumerate(cells):
            raw = ow_cell(sheet, r, c, os.path.join(FLORA_DIR, sheet + '-256x128.png'))
            if mirrored:
                raw = raw.transpose(Image.FLIP_LEFT_RIGHT)
            raw = ground_diamond(raw)
            d = dim(raw, how[1], how[2]) if how[0] == 'dim' else tone(raw, how[1], how[2])
            key = '%s_%d' % (kind, i)
            emit(key, d, '1x1', '%s r%d c%d%s, mean L %.0f -> %.0f' % (sheet, r, c, ' mirrored' if mirrored else '', luminance_mean(raw), luminance_mean(d)), (0.5, 1.0))
            outs.append(d)
        tiles_by_kind[kind] = outs
    bake_lilies()
    bake_blend(tiles_by_kind)


def dim(im, lum, sat):
    """Keep the hue: a gain onto `lum`, then `sat` of the chroma kept."""
    a = np.array(im.convert('RGBA')).astype(np.float32)
    m = a[:, :, 3] >= 128
    col = a[:, :, :3] * (lum / max(1.0, luminance_mean(im)))
    grey = (col @ np.array([.30, .59, .11], dtype=np.float32))[:, :, None]
    a[:, :, :3] = np.clip(grey + (col - grey) * sat, 0, 255)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def bake_lilies():
    """Three pad clusters: the bed at x0.3, cut to a ragged, feathered ellipse, darkened into the water's light."""
    sheet, r, c = LILY_CELL
    bed = ow_cell(sheet, r, c, os.path.join(FLORA_DIR, sheet + '-256x128.png'))
    bed = scale_rgba(bed, 0.3)
    bw, bh = bed.size
    for i, (cx, cy, w, h) in enumerate(((0.38, 0.5, 46, 22), (0.62, 0.45, 36, 18), (0.5, 0.55, 28, 14))):
        box = (int(cx * bw - w / 2), int(cy * bh - h / 2))
        cut = np.array(bed.crop((box[0], box[1], box[0] + w, box[1] + h))).astype(np.float32)
        rng = np.random.RandomState(40 + i)
        n = value_noise(64, 6, rng)[:h, :w]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        d = np.hypot((xx + 0.5 - w / 2) / (w / 2), (yy + 0.5 - h / 2) / (h / 2))
        cut[:, :, 3] = 255.0 * (1.0 - smoothstep(0.55, 0.95, d + 0.18 * n))
        im = dim(Image.fromarray(cut.astype(np.uint8), 'RGBA'), 62, 0.8)
        emit('lily_%s' % 'abc'[i], im, '1x1', '%s r%d c%d x0.3 blob %d' % (sheet, r, c, i), (0.5, 0.5))


def blend_source(name, v, tiles_by_kind):
    if name in tiles_by_kind:
        return tiles_by_kind[name][v]
    return Image.open(os.path.join(ATLAS, 'single_%s_%d.png' % (name, v))).convert('RGBA')


def bake_blend(tiles_by_kind):
    """
    THE BLEND ATLAS (it.115): `ow_blend`, one row per (source, variant), one
    column per BLEND_DIRS entry - the source's diamond with that direction's
    feathered alpha, cut to the tile's own (dilated) mask. `SceneManager` slices
    it and lays the cells over the lower-ranked tiles round a patch, so a patch
    has a ragged, soft outline instead of a staircase of hard diamonds.
    """
    mask = np.array(MASK_OUT).astype(np.float32) / 255.0
    rows = len(BLEND_SOURCES) * 4
    atlas = Image.new('RGBA', (BLEND_CELL_W * len(BLEND_DIRS), BLEND_CELL_H * rows), (0, 0, 0, 0))
    alphas = {(d, v): blend_alpha(d, v) for d in range(len(BLEND_DIRS)) for v in range(4)}
    for si, name in enumerate(BLEND_SOURCES):
        for v in range(4):
            src = np.array(np_bleed(blend_source(name, v, tiles_by_kind), 4)).astype(np.float32)
            for d in range(len(BLEND_DIRS)):
                cell = src.copy()
                cell[:, :, 3] = 255.0 * alphas[(d, v)] * mask
                im = Image.fromarray(np.clip(cell, 0, 255).astype(np.uint8), 'RGBA')
                atlas.paste(im, (d * BLEND_CELL_W + 1, (si * 4 + v) * BLEND_CELL_H + 1))
    ZOOM['ow_blend'] = atlas
    if not DRY:
        write_single('ow_blend', atlas)
    REPORT.append(('ow_blend', atlas.size[0], atlas.size[1], '-', 0, 0, '%d sources x 4 variants x %d dirs' % (len(BLEND_SOURCES), len(BLEND_DIRS))))
    projected_preview(tiles_by_kind, atlas)


def projected_preview(tiles_by_kind, atlas):
    """
    A 20x20 field laid the way `SceneManager` lays it - grass, a dirt road, a
    sand shore, and a patch of every kind - once hard and once blended, so the
    effect of the atlas can be judged before the game ever sees it.
    """
    n = 20
    rank = {'town_grass': 0, 'town_dirt': 1, 'town_sand': 2, 'ow_mud': 3, 'ow_gravel': 4, 'ow_forest': 5, 'ow_moss': 6, 'ow_meadow': 7, 'ow_flowers': 8, 'ow_poppies': 9}
    kinds = [['town_grass'] * n for _ in range(n)]
    for y in range(n):
        for x in range(n):
            if abs(x - y) <= 1:
                kinds[y][x] = 'town_dirt'
            if y >= 17:
                kinds[y][x] = 'town_sand'
            for kind, cx, cy, r in (('ow_moss', 5, 12, 2.6), ('ow_gravel', 14, 5, 2.2), ('ow_forest', 4, 3, 3.0),
                                    ('ow_mud', 11, 10, 1.8), ('ow_meadow', 15, 14, 2.8), ('ow_flowers', 9, 16, 1.8), ('ow_poppies', 17, 9, 1.6)):
                wob = 0.5 * np.sin(x * 1.3 + y * 0.7)
                if np.hypot(x - cx, y - cy) <= r + wob and kinds[y][x] == 'town_grass':
                    kinds[y][x] = kind
    base = dict(tiles_by_kind)
    for k in ('town_grass', 'town_dirt', 'town_sand'):
        base[k] = [Image.open(os.path.join(ATLAS, 'single_%s_%d.png' % (k, v))).convert('RGBA') for v in range(4)]
    W = n * TILE_W + TILE_W
    H = n * TILE_H + TILE_H
    out = Image.new('RGBA', (W * 2, H), (10, 10, 14, 255))
    for pane, blend in ((0, False), (1, True)):
        ox = pane * W + W // 2 - TILE_W // 2
        for y in range(n):
            for x in range(n):
                v = (x * 5 + y * 11) % 4
                out.alpha_composite(base[kinds[y][x]][v], (ox + (x - y) * TILE_W // 2, (x + y) * TILE_H // 2))
        if not blend:
            continue
        for y in range(n):
            for x in range(n):
                layers = []
                for d, (dx, dy) in enumerate(BLEND_DIRS):
                    xx, yy = x + dx, y + dy
                    if not (0 <= xx < n and 0 <= yy < n):
                        continue
                    k = kinds[yy][xx]
                    if rank[k] > rank[kinds[y][x]] and k in BLEND_SOURCES:
                        layers.append((rank[k], BLEND_SOURCES.index(k), (xx * 5 + yy * 11) % 4, d))
                for _, si, v, d in sorted(layers):
                    cell = atlas.crop((d * BLEND_CELL_W + 1, (si * 4 + v) * BLEND_CELL_H + 1,
                                       d * BLEND_CELL_W + 1 + TILE_W, (si * 4 + v) * BLEND_CELL_H + 1 + TILE_H))
                    out.alpha_composite(cell, (ox + (x - y) * TILE_W // 2, (x + y) * TILE_H // 2))
    os.makedirs(PREVIEW, exist_ok=True)
    out.save(os.path.join(PREVIEW, 'ground_blend.png'))
    out.crop((W, 0, W + W // 2, H // 2)).resize((W, H), Image.NEAREST).save(os.path.join(PREVIEW, 'ground_blend_zoom.png'))


# ---------------------------------------------------------------------------
# (g) Ancient Tiles loose props
# ---------------------------------------------------------------------------

ANC_DIR = os.path.join(DROP, 'Isometric tileset1', 'isometric tiles')
ANC_PROPS = (['boxes%02d' % i for i in range(1, 9)] + ['carriage%02d' % i for i in range(1, 9)] +
             ['chest%02d' % i for i in range(1, 13)] + ['coffin%02d' % i for i in range(1, 5)] +
             ['gate-closed%02d' % i for i in range(1, 5)] + ['gate-opened%02d' % i for i in range(1, 5)] +
             ['gate-no-metal-%02d' % i for i in range(1, 3)] +
             ['mushroom%02d' % i for i in range(1, 6)] + ['rocks%02d' % i for i in range(1, 6)] +
             ['tower%02d' % i for i in range(1, 9)])
#: These files were already sized for a 64x32 grid (a box ~30 px, a tower ~110 px
#: tall, a gate 3 tiles wide), so they bake at x1 - the "x0.25 for 256-wide"
#: rule would leave a 28 px tower.
ANC_SCALE = 1.0


def bake_props():
    items = []
    for stem in ANC_PROPS:
        src = Image.open(os.path.join(ANC_DIR, stem + '.png')).convert('RGBA')
        im, _ = crop_alpha(src)
        key = 'anc_prop_' + stem.replace('-', '_')
        emit(key, im, '1x1' if im.size[0] <= 80 else ('2x2' if im.size[0] <= 160 else '3x3'), '%s x1' % stem, base_anchor(im, band=0.5, thresh=100))
        items.append((key, im, last(key)))
    grid_preview(items, os.path.join(PREVIEW, 'props.png'), cols=8)


# ---------------------------------------------------------------------------
# (h) Screaming Brain crates and stairs
# ---------------------------------------------------------------------------

BOX_DIR = os.path.join(DROP, 'objects', 'Boxes')
#: crate -> (sheet file, row, col) in the 6x4 grid of 64x64 cells
CRATES = [
    ('crate_a', 'Crates - Wood 64x64.png', 0, 0),
    ('crate_b', 'Crates - Wood 64x64.png', 0, 2),
    ('crate_c', 'Crates - Wood 64x64.png', 0, 4),
    ('crate_d', 'Crates - Wood 64x64.png', 1, 4),
    ('crate_e', 'Crates - Wood 64x64.png', 2, 2),
    ('crate_f', 'Crates - Metal 64x64.png', 0, 2),
]
STAIR_DIR = os.path.join(DROP, 'objects', 'Stairs')
STAIRS = [('brick', 'Brick'), ('stone', 'Stone'), ('wood', 'Wood')]
STAIR_SCALE = 0.5


def bake_crates():
    items = []
    for key, fn, r, c in CRATES:
        sh = Image.open(os.path.join(BOX_DIR, fn)).convert('RGBA')
        cell = flood_key(sh.crop((c * 64, r * 64, (c + 1) * 64, (r + 1) * 64)))
        im, _ = crop_alpha(np_bleed(cell, 3))
        emit(key, im, '1x1', '%s r%d c%d x1' % (fn, r, c), base_anchor(im, band=0.5, thresh=100))
        items.append((key, im, last(key)))
    for stem, folder in STAIRS:
        sh = Image.open(os.path.join(STAIR_DIR, folder, '%s A - Stairs 128x128.png' % folder)).convert('RGBA')
        for suffix, col in (('a', 0), ('b', 1)):
            cell = flood_key(sh.crop((col * 128, 0, (col + 1) * 128, 128)))
            im, _ = crop_alpha(scale_rgba(np_bleed(cell, 3), STAIR_SCALE))
            key = 'stair_%s_%s' % (stem, suffix)
            emit(key, im, '1x1', '%s A cell r0 c%d x%.1f' % (folder, col, STAIR_SCALE), base_anchor(im, band=0.5, thresh=100))
            items.append((key, im, last(key)))
    grid_preview(items, os.path.join(PREVIEW, 'crates_stairs.png'), cols=6, scale=2.0)


# ---------------------------------------------------------------------------

GROUPS = {
    'village': bake_village,
    'tavern': bake_tavern,
    'cottages': bake_cottages,
    'cart': bake_cart,
    'tufts': bake_tufts,
    'ground': bake_ground,
    'props': bake_props,
    'crates': bake_crates,
}


def main():
    global DRY
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', choices=sorted(GROUPS), action='append')
    ap.add_argument('--preview', action='store_true', help='write previews only; atlas and manifest untouched')
    args = ap.parse_args()
    DRY = args.preview
    os.makedirs(PREVIEW, exist_ok=True)
    for g in (args.only or list(GROUPS)):
        print('== %s' % g)
        GROUPS[g]()
    zoom_preview(['bld_stone_well_a', 'crate_a', 'stair_stone_a', 'ow_gravel_0', 'ow_forest_0', 'tuft_a', 'cart_2', 'anc_prop_chest01'],
                 os.path.join(PREVIEW, 'zoom.png'))
    zoom_preview(['bld_thatched_cottage_a', 'cot_a'], os.path.join(PREVIEW, 'zoom2.png'), k=3)
    # the report
    print('%-32s %5s %5s %-5s %-6s %-6s  %s' % ('name', 'w', 'h', 'fp', 'ax', 'ay', 'source'))
    for name, w, h, fp, ax, ay, note in REPORT:
        print('%-32s %5d %5d %-5s %-6.3f %-6.3f  %s' % (name, w, h, fp, ax, ay, note))
    with open(os.path.join(PREVIEW, 'report.json'), 'w') as f:
        json.dump([dict(name=n, w=w, h=h, footprint=fp, anchorX=ax, anchorY=ay, note=note) for n, w, h, fp, ax, ay, note in REPORT], f, indent=1)
    if not DRY:
        man = read_manifest()
        missing = [n for n, *_ in REPORT if n not in man['singles'] or not os.path.exists(os.path.join(ATLAS, man['singles'][n]['file']))]
        print('registered %d singles, %d missing' % (len(REPORT), len(missing)))
        if missing:
            print('MISSING:', missing)
            sys.exit(1)
    print('previews in', PREVIEW)


if __name__ == '__main__':
    main()
