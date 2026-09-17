"""
BAKE C - THE ODD-FORMAT CREATURES (it.114).

Nine sources, nine layouts, one table. Everything that is not "a folder of
`<dir>/<frame>.png`" or a PixelOver export with a tidy sidecar lives here:

  apex_      PVGames Apex Predator (4096x4096 sheets of 512 cells, 8x8, the
             facing order S,W,E,N then SW,NW,SE,NE from `Reference - Monster
             Sheets.docx`)                                       credit: PVGames
  apex2_     PVGames Apex Stalker, same layout (a visibly different beast)
  krampus_   PVGames Krampus Original, Sprite_1 only (4000x4000 of 500 cells)
  gargoyle_  the loose `demon_statue.png` (16 frames x 8 directions of 256)
             + `gargyle.png` as the `gargoyle_statue` single
  hdknight_  "2D HD Character Knight" (1920x1024 = 15 frames x 8 rows of 128)
  gsknight_  "Slash" PixelOver export (512 cells, `_dir1..8`, json sidecars)
  pixgirl_   "npc2/StylOo_Redo" PixelOver export (256 cells, `_dir1..8`)
  spider2_   mob2 teal spider FRAMES, 16 angles of which we take the 45s
  flesh_     mob15, `<ANIM>/<compass>/0001.png`
  creeper_   mob16, `<ANIM>/<compass>/untitled.png0001.png`

Every direction table below was VERIFIED by writing a contact sheet to the
scratchpad (`--preview`) and looking at it: the row labelled S faces the
camera. Where a pack's own labels disagreed with the screen the table says so.

    python scripts/bake-creatures-c.py --preview            # contact sheets only
    python scripts/bake-creatures-c.py --only apex --preview
    python scripts/bake-creatures-c.py                      # bake everything
    python scripts/bake-creatures-c.py --only spider2       # one prefix
    python scripts/bake-creatures-c.py --verify             # check what is on disk

The PVGames sheets carry an `iCCP` chunk with a bad CRC, which Pillow refuses
outright ("cannot identify image file"); `open_png` drops any ancillary chunk
whose CRC does not check and reopens from memory.
"""
import argparse
import glob
import io
import json
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakelib import *  # noqa: E402,F401,F403
from bakelib import ATLAS, DIRS, DROP, SOUTH, contact_sheet, decimate, read_manifest, write_anim, write_single  # noqa: E402

from PIL import Image  # noqa: E402

SCRATCH = os.path.join(os.environ.get('LOCALAPPDATA', r'C:\Users\user\AppData\Local'),
                       'Temp', 'claude', 'C--Users-user-Desktop-isometric-game',
                       '9b751797-5b62-470f-a302-7c92b37a98e4', 'scratchpad', 'bake-c')


def P(*parts):
    return os.path.join(DROP, *parts)


# ---------------------------------------------------------------------------
# LOADERS
# ---------------------------------------------------------------------------


def open_png(path):
    """Image.open that survives an ancillary chunk with a bad CRC (PVGames' iCCP)."""
    try:
        im = Image.open(path)
        im.load()
        return im
    except Exception:
        pass
    with open(path, 'rb') as f:
        data = f.read()
    out = bytearray(data[:8])
    pos = 8
    while pos + 8 <= len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + ln]
        crc = data[pos + 8 + ln:pos + 12 + ln]
        ok = struct.pack('>I', zlib.crc32(typ + body) & 0xffffffff) == crc
        if ok or typ in (b'IHDR', b'PLTE', b'IDAT', b'IEND'):
            out += data[pos:pos + 12 + ln]
        pos += 12 + ln
        if typ == b'IEND':
            break
    im = Image.open(io.BytesIO(bytes(out)))
    im.load()
    return im


def grid(im, cols, rows):
    """Row-major cells of an evenly divided sheet."""
    cw, ch = im.size[0] // cols, im.size[1] // rows
    return [im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)) for r in range(rows) for c in range(cols)]


def by_names(names, rows):
    """{canonical dir index: frames} from a list of OUR direction names in SOURCE slot order."""
    assert sorted(names) == sorted(DIRS), names
    return {DIRS.index(n): rows[i] for i, n in enumerate(names)}


def trim_empty_tail(rows):
    """Drop trailing columns that are transparent in EVERY direction (a 15-cell strip holding a 12-frame clip)."""
    n = len(rows[0])
    last = 0
    for fi in range(n):
        if any(r[fi].getbbox() for r in rows):
            last = fi
    return [r[:last + 1] for r in rows]


# --- PVGames --------------------------------------------------------------

#: The pack's facing order (docx) -> our screen direction. PVGames "S" is the
#: RPG-Maker "down" facing, i.e. towards the viewer; verified on the contact sheet.
PV_ORDER = ['S', 'W', 'E', 'N', 'SW', 'NW', 'SE', 'NE']
PV_TO_OURS = {'S': 'S', 'W': 'W', 'E': 'E', 'N': 'N', 'SW': 'SW', 'NW': 'NW', 'SE': 'SE', 'NE': 'NE'}

_pv_cache = {}


def pv_cells(path, n=8):
    """The sheet as row-major cells: 8x8 of 512 for the big monsters, 20x20 of 200 for Krampus."""
    if path not in _pv_cache:
        _pv_cache[path] = grid(open_png(path).convert('RGBA'), n, n)
    return _pv_cache[path]


def pv_anim(path, start, per, n=8):
    """`per` frames per facing starting at cell `start`, facings in PV_ORDER."""
    cells = pv_cells(path, n)
    rows = [cells[start + i * per:start + (i + 1) * per] for i in range(8)]
    return by_names([PV_TO_OURS[n] for n in PV_ORDER], rows)


def pv_pack(folder):
    s = lambda n: P(folder, 'Sprite_%d.png' % n)  # noqa: E731
    return {
        'walk': lambda: pv_anim(s(1), 0, 8),
        'idle': lambda: pv_anim(s(3), 0, 3),
        'attack': lambda: pv_anim(s(4), 0, 3),
        'attack2': lambda: pv_anim(s(4), 24, 3),
        'hit': lambda: pv_anim(s(6), 24, 3),
        'death': lambda: _pv_death(s(6), s(8)),
    }


def _pv_death(hit_sheet, dead_sheet):
    """Get Hit (3 frames) then the single Dead cell, so a kill reads as a collapse rather than a cut."""
    hit = pv_anim(hit_sheet, 24, 3)
    dead = pv_anim(dead_sheet, 24, 1)
    return {d: hit[d] + dead[d] for d in hit}


def _pv_death_cells(sheet, hit_start, dead_start, n):
    hit = pv_anim(sheet, hit_start, 3, n)
    dead = pv_anim(sheet, dead_start, 1, n)
    return {d: hit[d] + dead[d] for d in hit}


KRAMPUS = P('mob9', 'Krampus_Original', 'Sprite_1.png')


# --- the demon statue -----------------------------------------------------

#: Row r of demon_statue.png -> our direction. Verified on the zoomed frame-8
#: sheet (the step forward with the arms out): rows 1/3 show the back, 5/7 the
#: face; row 6 is the frontal statue. Clockwise from W, like the HD knight.
GARG_ROWS = ['W', 'NW', 'N', 'NE', 'E', 'SE', 'S', 'SW']


def garg_rows():
    im = Image.open(P('demon_statue.png')).convert('RGBA')
    cells = grid(im, 16, 8)
    return [cells[r * 16:(r + 1) * 16] for r in range(8)]


def garg(frames_slice):
    rows = garg_rows()
    return by_names(GARG_ROWS, [r[frames_slice] for r in rows])


# --- 2D HD Character Knight -------------------------------------------------

#: Row r of every knight sheet -> our direction. Verified on Run frame 10 at
#: 400 px: row 0 runs left, row 2 away, row 4 right, row 6 at the camera.
HDK_ROWS = ['W', 'NW', 'N', 'NE', 'E', 'SE', 'S', 'SW']
HDK = P('2D HD Character Knight', 'Spritesheets', 'With shadows')


def hdk(sheet):
    im = Image.open(os.path.join(HDK, sheet + '.png')).convert('RGBA')
    cells = grid(im, 15, 8)
    rows = trim_empty_tail([cells[r * 15:(r + 1) * 15] for r in range(8)])
    return by_names(HDK_ROWS, rows)


# --- PixelOver exports (Slash, npc2) ----------------------------------------


def pixelover(png):
    """Frames of one `_dirN.png` from its json sidecar (rects in `frames`, `meta.direction`)."""
    with open(os.path.splitext(png)[0] + '.json', 'r', encoding='utf-8') as f:
        j = json.load(f)
    im = Image.open(png).convert('RGBA')
    out = []
    for fr in j['frames']:
        r = fr['frame']
        x, y, w, h = int(r['x']), int(r['y']), int(r['w']), int(r['h'])
        out.append(im.crop((x, y, x + w, y + h)))
    return j['meta'].get('direction'), out


def pixelover_dirs(pattern, names, n=None):
    """8 `_dir1..8` files -> {canonical: frames}; `names[i]` is OUR direction for meta.direction i."""
    rows = [None] * 8
    for path in sorted(glob.glob(pattern)):
        d, frames = pixelover(path)
        rows[d] = decimate(frames, n) if n else frames
    assert all(rows), pattern
    return by_names(names, rows)


#: PixelOver `meta.direction` 0..7 -> our direction, per export. Both rotate
#: counter-clockwise on screen with the index, but from different starts: the
#: greatsword knight's dir 3 is the straight back view (N) and dir 7 faces the
#: camera; the girl's dir 0 faces the camera and dir 2 is her back.
GSK_DIRS = ['SW', 'W', 'NW', 'N', 'NE', 'E', 'SE', 'S']
PIX_DIRS = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']


def gsk(sub, stem, n=None):
    return pixelover_dirs(P('Slash', sub, 'GreatSwordKnight_%s_dir*.png' % stem) if sub else
                          P('Slash', 'GreatSwordKnight_%s_dir*.png' % stem), GSK_DIRS, n)


def pix(stem, n=None):
    return pixelover_dirs(P('npc2', 'StylOo_Redo', stem, 'Styl0o_Redo_%s_dir*.png' % stem), PIX_DIRS, n)


# --- mob2 spider (angles) ---------------------------------------------------

#: Render angle folder -> our direction (verified by eye).
SPI_ANGLES = {'000': 'S', '045': 'SW', '090': 'W', '135': 'NW', '180': 'N', '225': 'NE', '270': 'E', '315': 'SE'}


def spider(anim, n):
    rows = {}
    for ang, name in SPI_ANGLES.items():
        files = sorted(glob.glob(P('mob2', '512x512', anim, 'Body', ang, '*.png')))
        assert files, (anim, ang)
        rows[DIRS.index(name)] = [Image.open(f).convert('RGBA') for f in decimate(files, n)]
    return rows


# --- mob15 / mob16 compass folders --------------------------------------------

#: Folder compass name -> our direction (verified by eye; identity unless noted).
COMPASS_TO_OURS = {'E': 'E', 'NE': 'NE', 'N': 'N', 'NW': 'NW', 'W': 'W', 'SW': 'SW', 'S': 'S', 'SE': 'SE'}


def compass(mob, anim, n, table=COMPASS_TO_OURS):
    rows = {}
    base = P(mob, anim)
    folders = {f.upper(): f for f in os.listdir(base)}
    for src, ours in table.items():
        files = sorted(glob.glob(os.path.join(base, folders[src], '*.png')))
        assert files, (mob, anim, src)
        rows[DIRS.index(ours)] = [Image.open(f).convert('RGBA') for f in decimate(files, n)]
    return rows


# ---------------------------------------------------------------------------
# THE TABLE
# ---------------------------------------------------------------------------

# (name, loader, dict(out_scale, half, nearest, n))  - `n` = decimate to at most n frames.
JOBS = [
    # 1. Apex Predator (PVGames)
    ('apex_idle', lambda: pv_pack('mob14/Apex_Predator')['idle'](), dict(out_scale=0.5, half=True)),
    ('apex_walk', lambda: pv_pack('mob14/Apex_Predator')['walk'](), dict(out_scale=0.5, half=True)),
    ('apex_attack', lambda: pv_pack('mob14/Apex_Predator')['attack'](), dict(out_scale=0.5, half=True)),
    ('apex_attack2', lambda: pv_pack('mob14/Apex_Predator')['attack2'](), dict(out_scale=0.5, half=True)),
    ('apex_hit', lambda: pv_pack('mob14/Apex_Predator')['hit'](), dict(out_scale=0.5, half=True)),
    ('apex_death', lambda: pv_pack('mob14/Apex_Predator')['death'](), dict(out_scale=0.5, half=True)),
    # 1b. Apex Stalker (PVGames) - a different beast, same layout
    ('apex2_idle', lambda: pv_pack('mob14/Apex_Stalker')['idle'](), dict(out_scale=0.5, half=True)),
    ('apex2_walk', lambda: pv_pack('mob14/Apex_Stalker')['walk'](), dict(out_scale=0.5, half=True)),
    ('apex2_attack', lambda: pv_pack('mob14/Apex_Stalker')['attack'](), dict(out_scale=0.5, half=True)),
    ('apex2_attack2', lambda: pv_pack('mob14/Apex_Stalker')['attack2'](), dict(out_scale=0.5, half=True)),
    ('apex2_hit', lambda: pv_pack('mob14/Apex_Stalker')['hit'](), dict(out_scale=0.5, half=True)),
    ('apex2_death', lambda: pv_pack('mob14/Apex_Stalker')['death'](), dict(out_scale=0.5, half=True)),
    # 2. the demon statue
    #    frames 12-15 of the awakening are the leap OFF the plinth onto the
    #    ground (looked at on the S strip), so they do not loop as a walk:
    #    `gargoyle_walk` is the statue frame, like the idle.
    ('gargoyle_idle', lambda: garg(slice(0, 1)), dict()),
    ('gargoyle_awake', lambda: garg(slice(0, 16)), dict()),
    ('gargoyle_walk', lambda: garg(slice(0, 1)), dict()),
    # 3. 2D HD Character Knight
    ('hdknight_idle', lambda: hdk('Idle'), dict()),
    ('hdknight_walk', lambda: hdk('Run'), dict()),
    ('hdknight_walk_slow', lambda: hdk('Walk'), dict()),
    ('hdknight_attack', lambda: hdk('Melee'), dict()),
    ('hdknight_attack2', lambda: hdk('Melee2'), dict()),
    ('hdknight_spin', lambda: hdk('MeleeSpin'), dict()),
    ('hdknight_cast', lambda: hdk('CastSpell'), dict()),
    ('hdknight_hit', lambda: hdk('TakeDamage'), dict()),
    ('hdknight_death', lambda: hdk('Die'), dict()),
    ('hdknight_block', lambda: hdk('ShieldBlockMid'), dict()),
    ('hdknight_kick', lambda: hdk('Kick'), dict()),
    # 4. Great Sword Knight (PixelOver)
    ('gsknight_idle', lambda: gsk('2hIdle5', '2hIdle5', 8), dict(out_scale=0.375, nearest=True)),
    ('gsknight_walk', lambda: gsk('2hWalk', '2hWalk', 10), dict(out_scale=0.375, nearest=True)),
    ('gsknight_attack', lambda: gsk(None, 'Slash', 12), dict(out_scale=0.375, nearest=True)),
    # 5. pixel girl (PixelOver)
    ('pixgirl_idle', lambda: pix('iddle_001', 8), dict(nearest=True)),
    ('pixgirl_walk', lambda: pix('anim_walkwHD', 8), dict(nearest=True)),
    ('pixgirl_sit', lambda: pix('sitheart_001', 6), dict(nearest=True)),
    # 6. teal spider (mob2)
    ('spider2_idle', lambda: spider('Idle_Nervous', 10), dict(out_scale=0.5, half=True)),
    ('spider2_walk', lambda: spider('Walk', 10), dict(out_scale=0.5, half=True)),
    ('spider2_attack', lambda: spider('Attack1', 12), dict(out_scale=0.5, half=True)),
    ('spider2_death', lambda: spider('Die1', 14), dict(out_scale=0.5, half=True)),
    ('spider2_hit', lambda: spider('Hit', 5), dict(out_scale=0.5, half=True)),
    # 7. flesh thing (mob15)
    ('flesh_idle', lambda: compass('mob15', 'IDLE', 10), dict(out_scale=0.5, half=True)),
    ('flesh_walk', lambda: compass('mob15', 'WALK', 10), dict(out_scale=0.5, half=True)),
    ('flesh_attack', lambda: compass('mob15', 'ATTACK', 12), dict(out_scale=0.5, half=True)),
    ('flesh_death', lambda: compass('mob15', 'DYING', 14), dict(out_scale=0.5, half=True)),
    # 8. creeper (mob16)
    ('creeper_idle', lambda: compass('mob16', 'IDLEING', 10), dict(out_scale=0.5, half=True)),
    ('creeper_walk', lambda: compass('mob16', 'WALK', 10), dict(out_scale=0.5, half=True)),
    ('creeper_attack', lambda: compass('mob16', 'ATTACK', 12), dict(out_scale=0.5, half=True)),
    ('creeper_death', lambda: compass('mob16', 'FALL', 14), dict(out_scale=0.5, half=True)),
    # 9. Krampus (PVGames). Sprite_1 is 4000x4000 of 200 px cells - the docx's
    #    "smaller sheets" table: Walking 0-63, Idle 128-151, Attack 1 176-199,
    #    Get Hit 296-319, Dead 392-399 - so the whole kit is on the one sheet.
    ('krampus_walk', lambda: pv_anim(KRAMPUS, 0, 8, 20), dict(half=True)),
    ('krampus_idle', lambda: pv_anim(KRAMPUS, 128, 3, 20), dict(half=True)),
    ('krampus_attack', lambda: pv_anim(KRAMPUS, 176, 3, 20), dict(half=True)),
    ('krampus_hit', lambda: pv_anim(KRAMPUS, 296, 3, 20), dict(half=True)),
    ('krampus_death', lambda: _pv_death_cells(KRAMPUS, 296, 392, 20), dict(half=True)),
]


def gargoyle_statue():
    """`gargyle.png` (600x480, a crouched gargoyle on a plinth) cropped to its alpha and scaled to 120 wide."""
    im = Image.open(P('gargyle.png')).convert('RGBA')
    box = im.getbbox()
    if box:
        im = im.crop(box)
    w = 120
    h = max(1, int(round(im.size[1] * w / im.size[0])))
    return im.resize((w, h), Image.LANCZOS)


SINGLES = [
    ('gargoyle_statue', gargoyle_statue, dict()),
]


# ---------------------------------------------------------------------------
# RUN
# ---------------------------------------------------------------------------


def prefix_of(name):
    return name.split('_', 1)[0]


def facing_sheet(frames, path, cell=256, fi=0):
    """Frame `fi` of every direction, big and labelled, laid out 4x2 - the sheet that settles a facing."""
    from PIL import ImageDraw
    sheet = Image.new('RGBA', (cell * 4, (cell + 20) * 2), (40, 40, 48, 255))
    draw = ImageDraw.Draw(sheet)
    for d in range(8):
        f = frames[d][min(fi, len(frames[d]) - 1)].convert('RGBA')
        b = f.getbbox()
        if b:
            f = f.crop(b)
        s = min(cell / f.size[0], cell / f.size[1])
        if s != 1.0:
            f = f.resize((max(1, int(f.size[0] * s)), max(1, int(f.size[1] * s))), Image.LANCZOS)
        x, y = (d % 4) * cell, (d // 4) * (cell + 20)
        sheet.paste(f, (x + (cell - f.size[0]) // 2, y + 20 + (cell - f.size[1]) // 2), f)
        draw.text((x + 4, y + 4), '%d %s' % (d, DIRS[d]), fill=(255, 220, 120, 255))
    sheet.save(path)
    return path


def preview(jobs, singles, facing=False, fi=0):
    os.makedirs(SCRATCH, exist_ok=True)
    if facing:
        for name, load, opt in jobs:
            frames = load()
            print('facing', name, '->', facing_sheet(frames, os.path.join(SCRATCH, '%s_facing%d.png' % (name, fi)), fi=fi))
        return
    for name, load, opt in jobs:
        frames = load()
        n = max(len(v) for v in frames.values())
        cell = 112 if n <= 16 else 80
        path = contact_sheet(frames, os.path.join(SCRATCH, name + '.png'), cell=(cell, cell))
        print('preview', name, '%d frames' % n, '->', path)
    for name, load, opt in singles:
        im = load()
        path = os.path.join(SCRATCH, 'single_' + name + '.png')
        im.save(path)
        print('preview single', name, im.size, '->', path)


def bake(jobs, singles):
    for name, load, opt in jobs:
        frames = load()
        e = write_anim(name, frames, **opt)
        ph = e['painted']['bottom'] - e['painted']['top'] + 1
        print('baked %-20s %2d frames  cell %3dx%-3d scale %.3g  painted h=%d' % (
            name, e['frameCount'], e['cellW'], e['cellH'], e['scale'], ph))
    for name, load, opt in singles:
        e = write_single(name, load(), **opt)
        print('baked single %-13s %dx%d' % (name, e['w'], e['h']))


def verify(jobs, singles):
    man = read_manifest()
    bad = 0
    for name, _, _ in jobs:
        e = man['anims'].get(name)
        if not e:
            print('MISSING manifest entry', name)
            bad += 1
            continue
        path = os.path.join(ATLAS, e['file'])
        if not os.path.exists(path):
            print('MISSING file', path)
            bad += 1
            continue
        im = Image.open(path)
        want = (e['cellW'] * e['frameCount'], e['cellH'] * e['dirCount'])
        ph = e['painted']['bottom'] - e['painted']['top'] + 1
        ok = im.size == want and ph > 20
        print('%s %-20s %s want %s painted h=%d' % ('ok ' if ok else 'BAD', name, im.size, want, ph))
        bad += 0 if ok else 1
    for name, _, _ in singles:
        e = man['singles'].get(name)
        path = e and os.path.join(ATLAS, e['file'])
        ok = bool(e) and os.path.exists(path) and Image.open(path).size == (e['w'], e['h'])
        print('%s single %s' % ('ok ' if ok else 'BAD', name))
        bad += 0 if ok else 1
    print('verify:', 'all good' if not bad else '%d problem(s)' % bad)
    return bad


def main():
    global SCRATCH
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', action='append', default=[], help='prefix (apex, gargoyle, ...) or full anim name; repeatable')
    ap.add_argument('--preview', action='store_true', help='contact sheets to the scratchpad, no bake')
    ap.add_argument('--facing', action='store_true', help='with --preview: one frame of each direction, big')
    ap.add_argument('--frame', type=int, default=0, help='with --facing: which frame')
    ap.add_argument('--verify', action='store_true', help='check the baked files against the manifest')
    ap.add_argument('--scratch', default=SCRATCH)
    a = ap.parse_args()
    SCRATCH = a.scratch
    sel = lambda name: not a.only or any(o == name or o == prefix_of(name) for o in a.only)  # noqa: E731
    jobs = [j for j in JOBS if sel(j[0])]
    singles = [s for s in SINGLES if sel(s[0])]
    if a.preview:
        preview(jobs, singles, facing=a.facing, fi=a.frame)
        return 0
    if a.verify:
        return verify(jobs, singles)
    bake(jobs, singles)
    return verify(jobs, singles)


if __name__ == '__main__':
    sys.exit(main())
