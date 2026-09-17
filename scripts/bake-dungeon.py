"""
BAKE THE DUNGEON TILESET (it.114): floors, walls, stairs, lights and props for
the crypt depths, in the four depth-band themes the game already names.

------------------------------------------------------------------------------
WHAT THE CRYPT DRAWS TODAY, AND WHAT THIS REPLACES
------------------------------------------------------------------------------
Depths 1-20 draw PROCEDURAL stone cubes and floor diamonds
(`AssetManager.buildStoneEnvironment`) in four themes by depth band: stone
(1-2), temple (3-9), frost (10-14), ember (15-20). The inn (it.96) and the
cellar (it.97) were instead built from the Ancient Isometric Tileset, and they
look like places. This bakes the same kind of kit for the crypt, from the same
tileset plus the Screaming Brain floors, the Infernus props and two loose
plates, so every depth can be dressed the way the inn was.

------------------------------------------------------------------------------
THE CONVENTIONS THIS MATCHES (measured on the shipped inn / cellar pieces)
------------------------------------------------------------------------------
* GROUND: 64x32 diamonds, four variants per kind, `single_<stem>_<0..3>`,
  masked by the projection via `bakelib.ground_diamond`. All four variants of a
  kind are LEVELLED onto one mean luminance so the scatter never reads as a
  chequerboard, and that mean is kept low (50-80 of 255) because the crypt's
  lighting multiplies on top.
* WALLS: the Ancient 256x512 tile scaled 0.5 onto a 128x256 canvas, exactly as
  `inn_wall_n` (bbox 0,138,73,256) and `cellar_wall_n` were. `TownProps`
  `case 'innwall'` seats it with the image's bottom-left on the 2x2 block's
  bounding-box bottom-left. Measured on screen (scratchpad `seat_one.png`): the
  `_n` piece stands on the block's BOTTOM-LEFT edge, which is the line
  y = by+2 running along +x, and the `_w` piece on the bottom-right edge, the
  line x = bx+2 along +y. A `_w` is the horizontal mirror of its `_n`
  (`inn_door_w_shut` is exactly the mirror of `inn_door_shut`), so the pieces
  that have no `_w` file in the set are mirrored here.
* PROPS: Infernus is pixel art authored on a 64-wide iso grid, one tile = one
  game tile, so it is baked at x1.0 and trimmed to its alpha box. Ancient
  clutter is baked at 0.5 like the inn's furniture.

Every keyed sheet is keyed (`key_magenta`) and bled (`bleed`) before any mask,
so no pink fringe survives; the previews in the scratchpad are zoomed x3 to
check that.

------------------------------------------------------------------------------
THEMES (recolour parameters, see GRADES)
------------------------------------------------------------------------------
  stone   as is, a touch warm and 5% darker             (Ancient wall_3, grey blocks)
  temple  desaturated, purple-grey, purple in recesses  (Ancient castle ashlar)
  frost   cooler, 12% brighter, blue in the highlights  (Ancient wall_5, weathered blocks)
  ember   darker, red-orange pushed into the recesses   (Ancient wall_6, red-brown brick with grey quoins)

------------------------------------------------------------------------------
WHAT THE REVIEW MEASURED (it.114, on the baked pieces)
------------------------------------------------------------------------------
* Every wall/arch/door/corner is 128x256 with its painted bottom-left at
  (0, 256), so `innwall` seats all of them. The stone/temple/frost families
  (wall_3, castle, wall_5, doorway_3, arch/big) have the CELLAR piece's alpha
  box (0,135..136 .. 79,256); the ember family (wall_6, doorway_4) has the INN
  piece's (0,138 .. 73,256). `_w` boxes mirror those (49|55 .. 128).
* The Ancient renders keep RGB = 0 under transparent pixels; Pillow's `resize`
  resamples RGBA premultiplied, so the plain LANCZOS in `scaled` gives a clean
  edge (the stairs' dark rim is their own shadowed underside, not a bleed).
* castle/arch2 has only the CAP as `wall_w`; the temple's `_w` arch comes from
  castle/arch (see WALL_SETS).

Run:   python scripts/bake-dungeon.py
       (previews land in DUNGEON_PREVIEW or the it.114 scratchpad folder;
        there is no partial run - the manifest writer is idempotent, so a
        full re-run only rewrites this script's own keys)
"""
import io
import math
import os
import struct
import sys
import zlib

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakelib import *  # noqa: E402,F401

ANC = os.path.join(DROP, 'Isometric tileset1', 'tile_images')
SB = os.path.join(DROP, 'Large 256x128')
INF = os.path.join(DROP, 'Infernus_Tiles')
LOP = os.path.join(DROP, '(DEMO) Lords Of Pain - Old School Isometric Assets', 'environment')
PREVIEW = os.environ.get('DUNGEON_PREVIEW') or os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'Temp', 'claude',
    'C--Users-user-Desktop-isometric-game', '9b751797-5b62-470f-a302-7c92b37a98e4', 'scratchpad', 'bake-dungeon')

THEMES = ['stone', 'temple', 'frost', 'ember']
MADE = []  # (name, w, h, kind) for the report


# ---------------------------------------------------------------------------
# LOADING
# ---------------------------------------------------------------------------


def load_png(path):
    """
    Open a PNG even when an ancillary chunk has a bad CRC.

    Half the Infernus files carry an `iCCP` chunk whose CRC does not match, and
    Pillow refuses the whole file for it. IHDR and IDAT are intact, so the file
    is rebuilt without the offending ancillary chunks and opened from memory.
    """
    try:
        return Image.open(path).convert('RGBA')
    except Exception:
        d = open(path, 'rb').read()
        out = bytearray(d[:8])
        p = 8
        while p + 8 <= len(d):
            ln, = struct.unpack('>I', d[p:p + 4])
            t = d[p + 4:p + 8]
            body = d[p + 8:p + 8 + ln]
            crc = d[p + 8 + ln:p + 12 + ln]
            ok = struct.pack('>I', zlib.crc32(t + body) & 0xffffffff) == crc
            if ok or t in (b'IHDR', b'IDAT', b'IEND', b'PLTE', b'tRNS'):
                out += d[p:p + 12 + ln]
            p += 12 + ln
            if t == b'IEND':
                break
        return Image.open(io.BytesIO(bytes(out))).convert('RGBA')


def anc(*parts):
    return load_png(os.path.join(ANC, *parts))


def inf(name):
    return load_png(os.path.join(INF, name))


def sb_cell(rel, idx):
    """One 256x128 diamond from a Screaming Brain 768x768 sheet (3 columns x 6 rows), keyed."""
    sheet = Image.open(os.path.join(SB, rel)).convert('RGBA')
    c, r = idx % 3, idx // 3
    return key_magenta(sheet.crop((c * 256, r * 128, c * 256 + 256, r * 128 + 128)))


def anc_ground(*parts):
    """An Ancient 256x129 ground tile: the diamond sits in rows 1..129."""
    im = anc(*parts)
    return im.crop((0, 1, 256, 129)) if im.size[1] != 128 else im


def scaled(im, k):
    """
    A uniform LANCZOS scale. The Ancient renders keep RGB = 0 under every
    transparent pixel, but Pillow's `resize` already resamples RGBA in
    premultiplied alpha (it converts to `RGBa` internally), so no black bleeds
    into the edge. Premultiplying HERE as well was tried in the it.114 review
    and applied alpha twice - a bright rim - so this stays the plain call.
    """
    return im.convert('RGBA').resize((max(1, int(round(im.size[0] * k))), max(1, int(round(im.size[1] * k)))), Image.LANCZOS)


def trimmed(im):
    box = alpha_bbox(im)
    return im.crop((box[0], box[1], box[2] + 1, box[3] + 1)) if box else im


# ---------------------------------------------------------------------------
# GRADES
# ---------------------------------------------------------------------------

#: Per-theme regrade. `desat` pulls toward luminance, `mul` tints, `gain`
#: scales, `lift` adds, `shadow` is added weighted by (1 - lum)^2 (colour in
#: the recesses), `highlight` by lum^2 (colour on the lit faces).
GRADES = {
    'stone': dict(desat=0.10, mul=(1.00, 0.97, 0.92), gain=0.95, lift=0, shadow=None, highlight=None),
    'temple': dict(desat=0.45, mul=(0.90, 0.84, 1.02), gain=0.92, lift=0, shadow=(12, 0, 26), highlight=None),
    'frost': dict(desat=0.40, mul=(0.86, 0.96, 1.16), gain=1.12, lift=6, shadow=None, highlight=(10, 18, 34)),
    'ember': dict(desat=0.30, mul=(1.00, 0.70, 0.60), gain=0.78, lift=0, shadow=(72, 14, 0), highlight=None),
    'none': dict(desat=0.0, mul=(1, 1, 1), gain=1.0, lift=0, shadow=None, highlight=None),
}


def grade(im, theme):
    p = GRADES[theme]
    a = np.asarray(im.convert('RGBA')).astype(np.float32)
    rgb = a[..., :3]
    lum = rgb[..., 0:1] * 0.30 + rgb[..., 1:2] * 0.59 + rgb[..., 2:3] * 0.11
    rgb = rgb * (1 - p['desat']) + lum * p['desat']
    rgb = rgb * np.array(p['mul'], dtype=np.float32) * p['gain'] + p['lift']
    if p['shadow']:
        rgb = rgb + ((1 - lum / 255.0) ** 2) * np.array(p['shadow'], dtype=np.float32)
    if p['highlight']:
        rgb = rgb + ((lum / 255.0) ** 2) * np.array(p['highlight'], dtype=np.float32)
    a[..., :3] = np.clip(rgb, 0, 255)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def mean_lum(im):
    a = np.asarray(im.convert('RGBA')).astype(np.float32)
    m = a[..., 3] > 128
    if not m.any():
        return 0.0
    lum = a[..., 0] * 0.30 + a[..., 1] * 0.59 + a[..., 2] * 0.11
    return float(lum[m].mean())


def level(images, target):
    """
    Gain every variant onto `target` mean luminance (over its opaque pixels),
    keeping its own texture - the `bake-ground.py` rule that no kind may be a
    four-tile mosaic. The gain is clamped so a dark plate is not blown out.
    """
    out = []
    for im in images:
        m = mean_lum(im)
        k = max(0.25, min(3.0, target / m)) if m > 1 else 1.0
        a = np.asarray(im.convert('RGBA')).astype(np.float32)
        a[..., :3] = np.clip(a[..., :3] * k, 0, 255)
        out.append(Image.fromarray(a.astype(np.uint8), 'RGBA'))
    return out


def single(name, im, kind='prop', nearest=False):
    e = write_single(name, im, nearest=nearest)
    MADE.append((name, e['w'], e['h'], kind))
    return im


# ---------------------------------------------------------------------------
# 1. FLOORS
# ---------------------------------------------------------------------------

#: Mean luminance each kind is levelled to (of 255). The lighting multiplies on top.
FLOOR_TARGET = {'stone': 64, 'temple': 58, 'frost': 78, 'ember': 52, 'blood': 58}


def floor_sources():
    """
    Four 256x128 diamonds per kind. ONE TEXTURE FAMILY PER KIND: the first
    pass mixed brick pavement with smooth stone for `stone`, and cracked rock
    with the plain Infernus plate for `ember`, and each read as a two-kind
    patchwork the moment it was scattered. A diamond mirrored or flipped is
    still a valid 2:1 diamond, so a family of two plates gives four variants
    that differ in layout and not in character.
    """
    flip, mirror = ImageOps.flip, ImageOps.mirror
    sidewalk = anc_ground('pavement', 'sidewalk.png')
    raised = anc_ground('pavement', 'raised.png')
    inlay = sb_cell('Interior/Tile/Floor_Tile_02-256x128.png', 8)
    rock_a = sb_cell('Exterior/Rocky/Floor_Rocky_02-256x128.png', 5)
    rock_b = sb_cell('Exterior/Rocky/Floor_Rocky_02-256x128.png', 8)
    ice_a = sb_cell('Exterior/Ice/Floor_Ice_01-256x128.png', 10)
    ice_b = sb_cell('Exterior/Ice/Floor_Ice_01-256x128.png', 17)
    return {
        # worn flagstone, grey-brown: the Ancient pavement, two plates and their mirrors
        'stone': [sidewalk, mirror(sidewalk), raised, mirror(raised)],
        # inlaid tile: one laid pattern in its four orientations (a laid floor IS regular)
        'temple': [inlay, mirror(inlay), flip(inlay), mirror(flip(inlay))],
        # icy / pale stone: two speckled Screaming Brain ice plates and their mirrors
        # (cells 7 and Ice_02/4 were tried: the veined plate read as a different
        # floor every fourth tile - the chequerboard again)
        'frost': [ice_a, mirror(ice_a), ice_b, mirror(ice_b)],
        # dark basalt with ember-lit cracks (the Infernus rock plate was tried and dropped: plain, no veins)
        'ember': [rock_a, rock_b, mirror(rock_a), mirror(rock_b)],
    }


def unproject_grid():
    """(u, v) ground-plane coordinates, in tiles, of every pixel centre of a 64x32 tile sprite."""
    py, px = np.mgrid[0:TILE_H, 0:TILE_W].astype(np.float32)
    sx = px + 0.5 - TILE_W / 2
    sy = py + 0.5
    a = sx / (TILE_W / 2)
    b = sy / (TILE_H / 2)
    return (a + b) / 2, (b - a) / 2


def bake_floors():
    src = floor_sources()
    floors = {}
    for theme in THEMES:
        tiles = [grade(ground_diamond(s), theme) for s in src[theme]]
        tiles = level(tiles, FLOOR_TARGET[theme])
        for i, t in enumerate(tiles):
            single('dun_%s_%d' % (theme, i), t, 'floor')
        floors[theme] = tiles
    bake_blood(floors['stone'])
    bake_pent(floors['stone'])
    return floors


def bake_blood(stone):
    """
    A stone floor with dried blood on it. The Infernus `Decal` plate is used as
    a STAIN MAP - its alpha says how soaked a patch is, never its own colour -
    and the mix goes to a near-black arterial brown (the it.111/it.112 lesson:
    keep the plate's colour and the floor goes pink). Each variant places the
    splat elsewhere and is gained onto one mean coverage, so the four differ in
    shape and not in weight.
    """
    decal = np.asarray(inf('Infernus_Decal.png'))[..., 3].astype(np.float32) / 255.0
    dh, dw = decal.shape
    u, v = unproject_grid()
    S = dw / 2.6  # the splat spans about two and a half tiles
    offsets = [(0.55, 0.45), (0.15, 0.80), (0.85, 0.20), (0.40, 0.95)]
    out = []
    for i, base in enumerate(stone):
        ox, oy = offsets[i]
        sx = np.clip((u - ox) * S + dw / 2, 0, dw - 1).astype(np.int32)
        sy = np.clip((v - oy) * S + dh / 2, 0, dh - 1).astype(np.int32)
        w = decal[sy, sx]
        a = np.asarray(base).astype(np.float32)
        m = a[..., 3] > 0
        mean = float(w[m].mean()) if m.any() else 0.0
        gain = min(4.0, 0.42 / mean) if mean > 1e-4 else 1.0
        lum = a[..., 0] * 0.30 + a[..., 1] * 0.59 + a[..., 2] * 0.11
        t = np.clip(w * gain * (0.75 + 0.25 * lum / 255.0), 0, 0.92)[..., None]
        blood = np.array([54, 13, 11], dtype=np.float32) + (1 - t) * np.array([14, 6, 4], dtype=np.float32)
        a[..., :3] = a[..., :3] * (1 - t) + blood * t
        a[..., :3] = np.clip(a[..., :3], 0, 255)
        out.append(Image.fromarray(a.astype(np.uint8), 'RGBA'))
    out = level(out, FLOOR_TARGET['blood'])
    for i, t in enumerate(out):
        single('dun_blood_%d' % i, t, 'floor')


#: Where tile (a, b) of a 2x2 block sits inside the block's 128x64 bounding box.
QUADRANT = {(0, 0): (32, 0), (1, 0): (64, 16), (0, 1): (0, 16), (1, 1): (32, 32)}


def bake_pent(stone):
    """
    The pentagram floor spread over a 2x2 block. Variant v = (gx & 1) + 2 * (gy & 1)
    picks the quadrant, as the inn's boards do. The Infernus plate is drawn
    round; on the ground it is an ellipse, so it is squashed 2:1 first.
    """
    block = Image.new('RGBA', (128, 64), (0, 0, 0, 0))
    for (a, b), (x, y) in QUADRANT.items():
        block.alpha_composite(stone[a + 2 * b], (x, y))
    pent = trimmed(inf('Infernus_PentagramFloor.png')).resize((116, 58), Image.LANCZOS)
    block.alpha_composite(pent, (64 - 58, 32 - 29))
    for (a, b), (x, y) in QUADRANT.items():
        q = block.crop((x, y, x + 64, y + 32))
        out = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
        out.paste(q, (0, 0), MASK_OUT)
        single('dun_pent_%d' % (a + 2 * b), out, 'floor')


# ---------------------------------------------------------------------------
# 2. WALLS
# ---------------------------------------------------------------------------

#: Per theme: the Ancient set each piece comes from. Sets that share a bounding
#: box (wall_6/doorway_4 at x 0..140, wall_4/doorway_2 at 0..136,
#: wall_3/wall_5/castle/doorway_3/arch-big at 0..152) seat identically, so each
#: theme's wall, arch and door are drawn from one family.
#: (`wall_4` and `wall_2` are TIMBER sets, `wall_1` is plaster - none of them
#: is a crypt wall, whatever the thumbnails suggest.)
WALL_SETS = {
    'stone': dict(wall=('wall', 'wall_3'), arch=('arch', 'big'), door=('wall', 'doorway_3'), corner=('wall', 'wall_3'),
                  pillar=('blocks', 'pillar6.png'), leaf=(4, 0)),
    # castle/arch2 holds the full arch as `wall_n` and only the floating CAP as
    # `wall_w` (bbox bottom 438 of 512); castle/arch is the other way round. So
    # the temple's two arch faces come from the two folders.
    'temple': dict(wall=('castle',), arch=('castle', 'arch2'), arch_w=('castle', 'arch'), door=('wall', 'doorway_3'), corner=('castle',),
                   pillar=('blocks', 'pillar3.png'), leaf=(4, 0)),
    'frost': dict(wall=('wall', 'wall_5'), arch=('arch', 'big'), door=('wall', 'doorway_3'), corner=('wall', 'wall_5'),
                  pillar=('blocks', 'pillar3.png'), leaf=(4, 0)),
    'ember': dict(wall=('wall', 'wall_6'), arch=('wall', 'doorway_4'), door=('wall', 'doorway_4', 'door'), corner=('wall', 'wall_6'),
                  pillar=('blocks', 'pillar6.png'), leaf=None),
}


def wall_piece(parts, face, theme, leaf=None):
    """
    An Ancient 256x512 wall tile -> the 128x256 game canvas, graded.
    `face` is 'wall_n' / 'wall_w' / 'corner_n'. `leaf` = (dx, dy) draws the
    set's `door_1` leaf - an OPEN leaf, swung out from the left jamb of the
    doorway_1 opening - shifted onto this doorway's jamb, so the piece reads as
    a doorway with its door standing open. Only the `_n` face takes it; a `_w`
    with a leaf is made by mirroring the `_n` (see `bake_walls`).
    """
    path = os.path.join(ANC, *parts, face + '.png')
    if not os.path.exists(path):
        return None
    im = anc(*parts, face + '.png')
    if leaf and face == 'wall_n':
        lf = anc('doors', 'door_1', 'door_n.png')
        im = im.copy()
        im.alpha_composite(lf, leaf)
    return grade(scaled(im, 0.5), theme)


def bake_walls():
    pieces = {}
    for theme in THEMES:
        s = WALL_SETS[theme]
        got = {}
        got['wall_n'] = wall_piece(s['wall'], 'wall_n', theme)
        got['wall_w'] = wall_piece(s['wall'], 'wall_w', theme)
        got['arch_n'] = wall_piece(s['arch'], 'wall_n', theme)
        got['arch_w'] = wall_piece(s.get('arch_w', s['arch']), 'wall_w', theme)
        got['door_n'] = wall_piece(s['door'], 'wall_n', theme, leaf=s['leaf'])
        got['door_w'] = None if s['leaf'] else wall_piece(s['door'], 'wall_w', theme)
        got['corner'] = wall_piece(s['corner'], 'corner_n', theme)
        for k in list(got):
            if got[k] is None and k.endswith('_w'):
                # No `_w` in the set: the mirror of the `_n` seats on the bottom-right edge.
                got[k] = ImageOps.mirror(got[k[:-2] + '_n'])
        for k, im in got.items():
            assert im is not None, (theme, k)
            single('dun_%s_%s' % (theme, k), im, 'wall')
        pil = grade(trimmed(scaled(anc(*s['pillar']), 0.5)), theme)
        single('dun_%s_pillar' % theme, pil, 'standing')
        got['pillar'] = pil
        pieces[theme] = got
    return pieces


# ---------------------------------------------------------------------------
# 3. STAIRS
# ---------------------------------------------------------------------------


def bake_stairs():
    """Ancient `stairs_2` at 0.5: a 128x128 piece whose base diamond is a 2x2 block."""
    up = grade(scaled(anc('stairs', 'stairs_2', 'stairs1.png'), 0.5), 'stone')
    down = grade(scaled(anc('stairs', 'stairs_2', 'stairs2.png'), 0.5), 'stone')
    single('dun_stairs_up', up, 'block2x2')
    single('dun_stairs_down', down, 'block2x2')
    return up, down


# ---------------------------------------------------------------------------
# 4. TORCH / LIGHT
# ---------------------------------------------------------------------------


def strip(sheet, row, cell_w, cell_h, n):
    return [sheet.crop((i * cell_w, row * cell_h, (i + 1) * cell_w, (row + 1) * cell_h)) for i in range(n)]


def bake_lights():
    torch = [scaled(anc('torch', 'torch_%d.png' % i), 0.5) for i in (1, 2, 3, 4)]
    anims = {}
    anims['dun_torch_n'] = write_anim('dun_torch_n', {0: torch})
    anims['dun_torch_w'] = write_anim('dun_torch_w', {0: [ImageOps.mirror(f) for f in torch]})
    ls5 = inf('Anim_Infernus_Lightsources_5.png')  # 3 x 64x64: torch stands (row 0), fire bowls (row 1)
    anims['dun_brazier'] = write_anim('dun_brazier', {0: strip(ls5, 1, 64, 64, 3)})
    anims['inf_torchstand'] = write_anim('inf_torchstand', {0: strip(ls5, 0, 64, 64, 3)})
    ls4 = inf('Anim_Infernus_Lightsources_4.png')  # 3 x 64x96 wall torch
    anims['inf_walltorch'] = write_anim('inf_walltorch', {0: strip(ls4, 0, 64, 96, 3)})
    ls1 = inf('Anim_Infernus_Lightsources_1.png')  # 3 x 64x96 candelabra
    anims['inf_candelabra'] = write_anim('inf_candelabra', {0: strip(ls1, 0, 64, 96, 3)})
    ls6 = inf('Anim_Infernus_Lightsources_6.png')  # 3 x 96x160 burner column
    anims['inf_burnercolumn'] = write_anim('inf_burnercolumn', {0: strip(ls6, 0, 96, 160, 3)})
    ls2 = inf('Anim_Infernus_Lightsources_2.png')  # 3 x 32x64 candles
    anims['inf_candles'] = write_anim('inf_candles', {0: strip(ls2, 0, 32, 64, 3)})
    for k, e in anims.items():
        MADE.append((k, e['cellW'] * e['frameCount'], e['cellH'], 'anim x%d' % e['frameCount']))
    return anims


# ---------------------------------------------------------------------------
# 5. PROPS
# ---------------------------------------------------------------------------

#: Infernus at x1.0, trimmed to the alpha box. (name, file)
INF_PROPS = [
    ('altar', 'Infernus_Altar_1.png'), ('altar_b', 'Infernus_Altar1_1.png'), ('altar_c', 'Infernus_Altar3_1.png'),
    ('bones_a', 'Infernus_Bones1_1.png'), ('bones_b', 'Infernus_Bones1_2.png'),
    ('brasero', 'Infernus_Brasero.png'), ('burner', 'Infernus_Burner.png'), ('burnercolumn_a', 'Infernus_BurnerColumn_1.png'),
    ('cage', 'Infernus_Cage_1.png'), ('cage_b', 'Infernus_Cage_2.png'), ('cagecart', 'Infernus_CageCart_1.png'),
    ('corpse_a', 'Infernus_Corpse1_1.png'), ('corpse_b', 'Infernus_Corpse1_2.png'), ('corpse_c', 'Infernus_Corpse1_3.png'),
    ('dragonbones', 'Infernus_DragonBones1_1.png'), ('dragonbones_b', 'Infernus_DragonBones2_1.png'),
    ('gorepile_a', 'Infernus_GorePile_1.png'), ('gorepile_b', 'Infernus_GorePile_7.png'),
    ('grave_a', 'Infernus_Grave1_1.png'), ('grave_b', 'Infernus_Grave3_1.png'),
    ('hangingcorpse', 'Infernus_HangingCorpse1_0.png'), ('hangingcorpse_b', 'Infernus_HangingCorpse2_1.png'),
    ('spire', 'Infernus_Hellscape_StoneSpire_1.png'), ('spire_b', 'Infernus_Hellscape_StoneSpire_2.png'),
    ('brokengiant', 'Infernus_Hellscape_BrokenGiant_1.png'), ('brokenhead', 'Infernus_Hellscape_BrokenHead_1.png'),
    ('brokenhand', 'Infernus_Hellscape_BrokenHand1_1.png'), ('columns', 'Infernus_Hellscape_Columns_1.png'),
    ('cliff_a', 'Infernus_Hellscape_Cliff1_1.png'), ('cliff_b', 'Infernus_Hellscape_Cliff2_1.png'), ('cliff_c', 'Infernus_Hellscape_Cliff3_1.png'),
    ('rubble_a', 'Infernus_Hellscape_Rubble2_1.png'), ('rubble_b', 'Infernus_Hellscape_Rubble4_1.png'), ('rubble_c', 'Infernus_Hellscape_Rubble5_1.png'),
    ('rocks_a', 'Infernus_Hellscape_Rocks_1.png'), ('rocks_b', 'Infernus_Hellscape_Rocks_6.png'),
    ('pile_a', 'Infernus_Hellscape_Pile1_1.png'), ('pile_b', 'Infernus_Hellscape_Pile2_1.png'),
    ('pentagram_wall_a', 'Infernus_PentagramWall_1.png'), ('pentagram_wall_b', 'Infernus_PentagramWall_2.png'), ('pentagram_wall_c', 'Infernus_PentagramWall_3.png'),
    ('reliquary', 'Infernus_Reliquary_1.png'), ('reliquary_b', 'Infernus_Reliquary_2.png'),
    ('kryss', 'Infernus_RitualKryss_1.png'), ('kryss_b', 'Infernus_RitualKryss_2.png'),
    ('chalice', 'Infernus_SacrificialChalice.png'), ('chalice_b', 'Infernus_Chalice.png'), ('dagger', 'Infernus_SacrificialDagger_1.png'),
    ('skull_1', 'Infernus_Skull1_1.png'), ('skull_2', 'Infernus_Skull2_1.png'), ('skull_3', 'Infernus_Skull3_1.png'), ('skull_4', 'Infernus_Skull4_1.png'), ('skull_5', 'Infernus_Skull5_1.png'),
    ('throne', 'Infernus_Throne_1.png'), ('throne_b', 'Infernus_Throne_3.png'),
    ('wallcandles_a', 'Infernus_WallCandles_1.png'), ('wallcandles_b', 'Infernus_WallCandles_2.png'), ('wallcandles_c', 'Infernus_WallCandles_3.png'),
    ('walllantern_a', 'Infernus_WallLantern_1.png'), ('walllantern_b', 'Infernus_WallLantern_2.png'), ('walllantern_c', 'Infernus_WallLantern_3.png'),
    ('column', 'Infernus_Column.png'), ('pillar_a', 'Infernus_Pillar_1.png'), ('pillar_b', 'Infernus_Pillar_2.png'),
    ('candelabra_a', 'Infernus_Candelabra_1.png'), ('candles_a', 'Infernus_Candles_6.png'),
    ('lectern', 'Infernus_Lectern1_1.png'), ('shelf', 'Infernus_Shelf_1.png'), ('cabinet', 'Infernus_Cabinet1_1.png'),
    ('table', 'Infernus_Table_1.png'), ('stand', 'Infernus_Stand_1.png'), ('bust', 'Infernus_Bust1_1.png'), ('bustniche', 'Infernus_BustNiche_1.png'),
    ('decor_a', 'Infernus_Decor1_1.png'), ('decor_b', 'Infernus_Decor2_1.png'),
    ('book', 'Infernus_Book1_1.png'), ('bottle', 'Infernus_Bottle_1.png'), ('jar', 'Infernus_Jar.png'), ('vase', 'Infernus_Vase.png'),
    ('bowl', 'Infernus_Bowl.png'), ('cup', 'Infernus_Cup.png'), ('box_a', 'Infernus_Box1_1.png'), ('box_b', 'Infernus_Box2_1.png'),
    ('staff', 'Infernus_Staff_1.png'), ('sword', 'Infernus_Sword_1.png'), ('shield', 'Infernus_Shield.png'), ('spear', 'Infernus_Spear_1.png'), ('club', 'Infernus_Club_1.png'),
]

#: Ancient clutter at 0.5, trimmed. (name, path parts)
ANC_PROPS = [
    ('grave_a', ('clutter', 'grave1.png')), ('grave_b', ('clutter', 'grave2.png')), ('crucifix', ('clutter', 'crucifix.png')),
    ('block_a', ('clutter', 'loose_block1.png')), ('block_b', ('clutter', 'loose_block4.png')), ('stoneblock', ('blocks', 'stoneblock.png')),
    ('slab_long', ('blocks', 'slab4.png')), ('slab_smooth', ('blocks', 'smooth_slab_1.png')), ('slab_sq', ('blocks', 'sq slab.png')), ('sideblock', ('blocks', 'sideblock1.png')),
    ('pillar_thin', ('blocks', 'pillar.png')), ('pillar_brick', ('blocks', 'pillar2.png')), ('pillar_round', ('blocks', 'pillar3.png')), ('pillar_big', ('blocks', 'pillar6.png')),
    ('turret', ('castle', 'turret_wide.png')), ('turret_b', ('castle', 'turret2b.png')),
    ('splat_a', ('overlay', 'floor_splat2.png')), ('splat_b', ('overlay', 'splat1.png')), ('splat_c', ('overlay', 'base_splatter1.png')),
    ('wallsplat', ('overlay', 'wall_splat1.png')), ('bloodsplat', ('overlay', 'bloodsplat.png')), ('footprints', ('overlay', 'footprints.png')),
]

#: Ancient pieces that keep their canvas because they seat by it (wall-seated 128x256, or 2x2 floor decals 128x64).
ANC_CANVAS = [
    ('ruin_s', ('ruin', 'wall_s.png')), ('bars_n', ('wall', 'window_4', 'bars', 'wall_n.png')), ('bars_w', ('wall', 'window_4', 'bars', 'wall_w.png')),
    ('rug', ('clutter', 'rug.png')), ('manhole', ('overlay', 'manhole.png')), ('dirt_overlay', ('overlay', 'dirtoverlay1.png')),
]


def bake_props():
    for name, f in INF_PROPS:
        single('inf_' + name, trimmed(inf(f)), 'standing')
    for name, parts in ANC_PROPS:
        single('anc_' + name, trimmed(scaled(anc(*parts), 0.5)), 'standing')
    for name, parts in ANC_CANVAS:
        im = anc(*parts)
        if im.size[1] == 129:
            im = im.crop((0, 1, 256, 129))
        single('anc_' + name, scaled(im, 0.5), 'canvas')
    # The temple entrance: a 256x128 2:1 doorway plate, at 0.25 one ground diamond.
    single('temple_entrance', ground_diamond(load_png(os.path.join(DROP, 'temple_entrance_vines_0.png'))), 'floor')


# ---------------------------------------------------------------------------
# PREVIEWS (looked at before anything is trusted)
# ---------------------------------------------------------------------------


def w2s(x, y):
    return (x - y) * TILE_W / 2, (x + y) * TILE_H / 2


def preview_room(theme, floors, walls, stairs, anims, path):
    """A room drawn with the game's own seating: `innwall` for walls, `standing` for props."""
    from PIL import ImageDraw
    W, H = 1100, 760
    ox, oy = 560, 120
    im = Image.new('RGBA', (W, H), (12, 12, 16, 255))
    fl = floors[theme]
    X0, X1, Y0, Y1 = 2, 11, 2, 11
    for y in range(Y0, Y1 + 1):
        for x in range(X0, X1 + 1):
            sx, sy = w2s(x, y)
            im.alpha_composite(fl[(x * 5 + y * 11) % 4], (int(ox + sx - TILE_W / 2), int(oy + sy)))
    if theme == 'stone':
        for y in (6, 7):
            for x in (8, 9):
                sx, sy = w2s(x, y)
                im.alpha_composite(floors['pent'][(x & 1) + 2 * (y & 1)], (int(ox + sx - TILE_W / 2), int(oy + sy)))
        for (x, y) in [(3, 8), (4, 8), (3, 9), (4, 9), (5, 9)]:
            sx, sy = w2s(x, y)
            im.alpha_composite(floors['blood'][(x * 5 + y * 11) % 4], (int(ox + sx - TILE_W / 2), int(oy + sy)))
    objs = []  # (zIndex, image, x, y)
    for x in range(X0, X1 + 1, 2):
        v = walls['arch_n'] if x == 4 else walls['door_n'] if x == 8 else walls['wall_n']
        bx, by = x, Y0 - 2
        sx, sy = w2s(bx, by)
        objs.append(((x + Y0 - 1 + 1) * TILE_H / 2 + 4, v, ox + sx - TILE_W, oy + sy + TILE_H * 2 - v.size[1]))
    for y in range(Y0, Y1 + 1, 2):
        v = walls['arch_w'] if y == 6 else walls['door_w'] if y == 10 else walls['wall_w']
        bx, by = X0 - 2, y
        sx, sy = w2s(bx, by)
        objs.append(((X0 - 1 + y + 1) * TILE_H / 2 + 4, v, ox + sx - TILE_W, oy + sy + TILE_H * 2 - v.size[1]))
    # The corner piece: on its own block in the room, to show what it is.
    c = walls['corner']
    sx, sy = w2s(9, 3)
    objs.append(((9 + 3 + 1) * TILE_H / 2 + 4, c, ox + sx - TILE_W, oy + sy + TILE_H * 2 - c.size[1]))

    def standing(spr, x, y, w=1, h=1, ay=1.0, ax=0.5):
        if w == 1 and h == 1:
            sx, sy = w2s(x + 0.5, y + 0.5)
            sy += 4
        else:
            sx, sy = w2s(x + w, y + h)
        objs.append(((x + w - 0.5 + y + h - 0.5) * TILE_H / 2, spr, ox + sx - spr.size[0] * ax, oy + sy - spr.size[1] * ay))

    standing(walls['pillar'], 5, 5)
    standing(stairs[0], 6, 8, 2, 2)
    standing(stairs[1], 9, 5, 2, 2)
    frame = lambda n: Image.open(os.path.join(ATLAS, n + '.png')).convert('RGBA').crop((0, 0, anims[n]['cellW'], anims[n]['cellH']))
    # Torches on the walls: on the wall's own tile row, lifted to head height.
    for x in (3, 7):
        sx, sy = w2s(x + 0.5, Y0 - 0.0)
        objs.append(((x + Y0 - 1 + 1) * TILE_H / 2 + 5, frame('dun_torch_n'), ox + sx - 32, oy + sy - 60))
    for y in (5, 9):
        sx, sy = w2s(X0 - 0.0, y + 0.5)
        objs.append(((X0 - 1 + y + 1) * TILE_H / 2 + 5, frame('dun_torch_w'), ox + sx - 32, oy + sy - 60))
    standing(frame('dun_brazier'), 4, 4)
    props = {'stone': ['inf_altar', 'inf_bones_a', 'inf_skull_1', 'anc_grave_a', 'inf_cage', 'inf_chalice'],
             'temple': ['inf_altar_b', 'inf_reliquary', 'inf_lectern', 'anc_pillar_round', 'inf_column', 'inf_candelabra_a'],
             'frost': ['inf_grave_b', 'inf_corpse_a', 'inf_bones_b', 'anc_stoneblock', 'inf_rocks_a', 'inf_skull_5'],
             'ember': ['inf_throne', 'inf_gorepile_a', 'inf_brasero', 'inf_spire_b', 'inf_rubble_c', 'inf_dagger']}[theme]
    spots = [(3, 3), (10, 9), (7, 4), (4, 10), (10, 6), (7, 10)]
    for n, (x, y) in zip(props, spots):
        spr = Image.open(os.path.join(ATLAS, 'single_%s.png' % n)).convert('RGBA')
        standing(spr, x, y)
    for z, spr, px, py in sorted(objs, key=lambda o: o[0]):
        im.alpha_composite(spr, (int(px), int(py)))
    d = ImageDraw.Draw(im)
    d.text((8, 8), theme, fill=(255, 230, 120))
    im.save(path)
    return im


def preview_floors(floors, path):
    from PIL import ImageDraw
    kinds = list(floors)
    W = 64 * 4 * 3 + 200
    im = Image.new('RGBA', (W, 32 * 3 * len(kinds) + 8 * len(kinds)), (12, 12, 16, 255))
    d = ImageDraw.Draw(im)
    y = 0
    for k in kinds:
        for i, t in enumerate(floors[k]):
            big = t.resize((192, 96), Image.NEAREST)
            im.alpha_composite(big, (200 + i * 192, y))
        d.text((4, y + 4), '%s  lum %s' % (k, ' / '.join('%.0f' % mean_lum(t) for t in floors[k])), fill=(255, 230, 120))
        y += 96 + 8
    im.save(path)


def preview_zoom(theme, floors, walls, path):
    """x3 nearest zoom of a floor seam and a wall foot, to check for fringe."""
    fl = floors[theme]
    im = Image.new('RGBA', (320, 200), (12, 12, 16, 255))
    for y in range(3):
        for x in range(3):
            sx, sy = w2s(x, y)
            im.alpha_composite(fl[(x * 5 + y * 11) % 4], (int(120 + sx - 32), int(20 + sy)))
    v = walls['door_n']
    sx, sy = w2s(0, -2)
    im.alpha_composite(v, (int(120 + sx - 64), int(20 + sy + 64 - v.size[1])))
    im.crop((40, 0, 240, 130)).resize((600, 390), Image.NEAREST).save(path)


def preview_anims(anims, path):
    rows = {}
    for n, e in anims.items():
        sheet = Image.open(os.path.join(ATLAS, n + '.png')).convert('RGBA')
        rows[n] = [sheet.crop((i * e['cellW'], 0, (i + 1) * e['cellW'], e['cellH'])) for i in range(e['frameCount'])]
    from PIL import ImageDraw
    W = 140 + max(len(r) for r in rows.values()) * 100
    im = Image.new('RGBA', (W, 170 * len(rows)), (40, 40, 48, 255))
    d = ImageDraw.Draw(im)
    for j, (n, fr) in enumerate(rows.items()):
        d.text((4, j * 170 + 4), n, fill=(255, 230, 120))
        for i, f in enumerate(fr):
            im.alpha_composite(f, (140 + i * 100, j * 170 + 4))
    im.save(path)


def preview_props(path):
    from PIL import ImageDraw
    names = [n for n, w, h, k in MADE if k in ('standing', 'canvas')]
    cols = 12
    cell = 150
    rows = (len(names) + cols - 1) // cols
    im = Image.new('RGBA', (cols * cell, rows * cell), (40, 40, 48, 255))
    d = ImageDraw.Draw(im)
    for i, n in enumerate(names):
        spr = Image.open(os.path.join(ATLAS, 'single_%s.png' % n)).convert('RGBA')
        k = min((cell - 6) / spr.size[0], (cell - 18) / spr.size[1], 1.0)
        spr = scaled(spr, k)
        x, y = (i % cols) * cell, (i // cols) * cell
        im.alpha_composite(spr, (x + 3, y + 16))
        d.text((x + 3, y + 2), n, fill=(255, 230, 120))
    im.save(path)


# ---------------------------------------------------------------------------


if __name__ == '__main__':
    os.makedirs(PREVIEW, exist_ok=True)
    floors = bake_floors()
    floors['blood'] = [Image.open(os.path.join(ATLAS, 'single_dun_blood_%d.png' % i)).convert('RGBA') for i in range(4)]
    floors['pent'] = [Image.open(os.path.join(ATLAS, 'single_dun_pent_%d.png' % i)).convert('RGBA') for i in range(4)]
    walls = bake_walls()
    stairs = bake_stairs()
    anims = bake_lights()
    bake_props()
    floors['entrance'] = [Image.open(os.path.join(ATLAS, 'single_temple_entrance.png')).convert('RGBA')]
    preview_floors(floors, os.path.join(PREVIEW, 'out_floors.png'))
    preview_anims(anims, os.path.join(PREVIEW, 'out_anims.png'))
    preview_props(os.path.join(PREVIEW, 'out_props.png'))
    for theme in THEMES:
        preview_room(theme, floors, walls[theme], stairs, anims, os.path.join(PREVIEW, 'out_room_%s.png' % theme))
        preview_zoom(theme, floors, walls[theme], os.path.join(PREVIEW, 'out_zoom_%s.png' % theme))
    print('registered %d pieces' % len(MADE))
    for name, w, h, kind in MADE:
        print('  %-28s %4dx%-4d %s' % (name, w, h, kind))
