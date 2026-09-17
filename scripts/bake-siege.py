"""
BAKE THE SIEGE ENGINES FROM REAL RENDERS (it.114).

`scripts/bake-catapult.py` (it.112) had only a TOP-DOWN catapult and stood it
up by sprite stacking; the owner says the result looks bad, and the graphics
drop now carries proper 2:1 renders of two machines, so this bake replaces
the stacked engine with them. It writes NEW names (`catapult_*`, `ballista_*`)
and leaves `siege_engine`, `siege_wreck` and the `siege_arm/sling/stone`
singles where they are, so the game keeps drawing until `TownProps` is moved
over.

SOURCES (both gitignored, under `public/assets/graphics update/`):

  catapulta/isometric/{break,load,move,throw}/catapult_<anim>_DFFFF.png
      309x282, D = pack direction 0-7, FFFF = frame; 31 frames each except
      throw (16). A parallel `_shadow/shadow-catapult_<anim>_DFFFF.png` per
      frame. `_projectile/projectile_N0000.png` (16 x 400x400, a tumbling
      rock) and `_pile-rocks/rocks_D0000.png` (8 x 79x67, with shadows).
      Bleed / Remus Turcuman, "Medieval Catapult" (full set). The licence
      (catapulta/License.txt) requires the credit
          "Bleed - http://remusprites.carbonmade.com/"
      and forbids redistribution - which is why the drop is gitignored and
      only the baked atlas is committed. `index.html` already carries the
      credit for the it.112 bake.

  balista/1  Ballista_Loaded, Body + Shadow separated, 16 rotations (256 px)
  balista/8  Reload_n_Shot, Body + Shadow separated, 16 rotations x 9 frames
             (folders 3/4 are the same clip with the shadow baked into the
             body; 5/7 are the loose bolt, 7 with its shadow separated)
      No licence file in the folder; same vendor style and naming as the
      catapult, so the same credit is assumed to cover it.

DIRECTIONS - LOOKED AT, NOT ASSUMED (the contact sheets under
`--preview` are how). The catapult pack's D=0 is a dead-front elevation:
the crossbar nearest the camera and the cocked arm's cup showing over it, so
it THROWS TOWARDS THE VIEWER (screen S); D=2 is a side view with the cup at
the left and the crossbar at the right, so it throws to the right (E). The
pack therefore turns ANTICLOCKWISE on screen from S, and canonical direction
d (E, NE, N, NW, W, SW, S, SE) takes pack frame (d + 2) mod 8.

The ballista's `_000` points its bolt UP the screen (N) and `_090` points
it RIGHT (E): the pack turns CLOCKWISE from N in 22.5-degree steps. Canonical
d takes rotation (90 - 45 d) mod 360, i.e. E=090, NE=045, N=000, NW=315,
W=270, SW=225, S=180, SE=135.

GROUND CENTRE. Both packs are turntable renders about the machine's own
axis, so the ground centre sits at the same screen point in every facing of
a machine (the contact sheets show the frames' horizontal centre lines
running through it). For the catapult it is derived from the rail and wheel
rows of the S and E views (`catapult_centre` has the arithmetic: the rails
ride at axle height, the wheels touch the ground, the camera is a little
steeper than 2:1). For the ballista it is the pedestal's foot, visible
directly under the post in the E/W facings. Every sheet of a machine is cut with the SAME crop box (the
whole scaled frame), so ONE anchor serves all of that machine's animations -
the numbers are printed at the end of a run and belong in `TownProps`.

Run:  python scripts/bake-siege.py                  # bake + register all
      python scripts/bake-siege.py --only catapult_throw,ballista_idle
      python scripts/bake-siege.py --preview        # contact sheets only, no
                                                    # atlas or manifest writes
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw  # noqa: E402

from bakelib import ATLAS, DIRS, DROP, contact_sheet, decimate, read_manifest, write_anim, write_single  # noqa: E402

CAT = os.path.join(DROP, 'catapulta', 'isometric')
BAL = os.path.join(DROP, 'balista')
#: Where `--preview` writes its contact sheets (outside `public/`).
PREVIEW = os.path.join(os.environ.get(
    'CLAUDE_SCRATCHPAD',
    r'C:\Users\user\AppData\Local\Temp\claude\C--Users-user-Desktop-isometric-game\9b751797-5b62-470f-a302-7c92b37a98e4\scratchpad'),
    'bake-siege')

#: Canonical direction d -> catapult pack direction (see the header).
CAT_PACK_FOR_DIR = [(d + 2) % 8 for d in range(8)]
#: Canonical direction d -> ballista rotation suffix.
BAL_ROT_FOR_DIR = ['%03d' % ((90 - 45 * d) % 360) for d in range(8)]

#: Source -> atlas. The catapult's widest facing (E/W, 265 px painted of the
#: 309 frame) comes out ~127 px, two tiles of diamond; the ballista's
#: (247 px of 256) ~110 px.
CAT_SCALE = 0.48
BAL_SCALE = 0.45
#: The cast shadows, under the body, where our lighting draws none for props.
SHADOW_ALPHA = 0.55
#: Frames per baked clip: the packs are 30 fps captures, not animations.
CLIP = 8


# ---------------------------------------------------------------------------
# LOADERS
# ---------------------------------------------------------------------------


def under_shadow(body, shadow, alpha=SHADOW_ALPHA):
    """The body composited over its shadow, the shadow faded to `alpha`."""
    body = body.convert('RGBA')
    if shadow is None:
        return body
    sh = shadow.convert('RGBA')
    sh.putalpha(sh.getchannel('A').point(lambda v: int(v * alpha)))
    sh.alpha_composite(body)
    return sh


def cat_frame(anim, pack_dir, frame, shadow=True):
    body = Image.open(os.path.join(CAT, anim, 'catapult_%s_%d%04d.png' % (anim, pack_dir, frame)))
    sh = Image.open(os.path.join(CAT, anim, '_shadow', 'shadow-catapult_%s_%d%04d.png' % (anim, pack_dir, frame))) if shadow else None
    return under_shadow(body, sh)


def cat_body(anim, pack_dir, frame):
    return Image.open(os.path.join(CAT, anim, 'catapult_%s_%d%04d.png' % (anim, pack_dir, frame))).convert('RGBA')


def cat_count(anim):
    return len([f for f in os.listdir(os.path.join(CAT, anim)) if f.startswith('catapult_%s_0' % anim)])


def cat_clip(anim, frames):
    """{canonical d: [frames]} for the listed pack frame indices."""
    return {d: [cat_frame(anim, CAT_PACK_FOR_DIR[d], f) for f in frames] for d in range(8)}


def bal_loaded(rot, shadow=True):
    base = os.path.join(BAL, '1', 'Frames_256x256', 'Ballista_Loaded_Separated_Shadow')
    body = Image.open(os.path.join(base, 'Body', 'Ballista_Loaded_Body_%s.png' % rot))
    sh = Image.open(os.path.join(base, 'Shadow', 'Ballista_Loaded_Shadow_%s.png' % rot)) if shadow else None
    return under_shadow(body, sh)


def bal_shot(rot, frame, shadow=True):
    base = os.path.join(BAL, '8', 'Separated_Shadow', 'Frames_256x256', 'Reload_n_Shot')
    body = Image.open(os.path.join(base, 'Body', rot, 'Reload_n_Shot_Body_%s_%04d.png' % (rot, frame)))
    sh = Image.open(os.path.join(base, 'Shadow', rot, 'Reload_n_Shot_Shadow_%s_%04d.png' % (rot, frame))) if shadow else None
    return under_shadow(body, sh)


def bal_bolt():
    """The loose bolt, pointing right (rotation 090), no shadow."""
    return Image.open(os.path.join(BAL, '7', 'Frames_256x256', 'Bolt_For_Shots', 'Body', 'Bolt_For_Shots_Body_090.png')).convert('RGBA')


def stone_frames():
    return [Image.open(os.path.join(CAT, '_projectile', 'projectile_%d0000.png' % i)).convert('RGBA') for i in range(16)]


def rocks(pack_dir=0):
    body = Image.open(os.path.join(CAT, '_pile-rocks', 'rocks_%d0000.png' % pack_dir))
    sh = Image.open(os.path.join(CAT, '_pile-rocks', '_shadow', 'shadow-rocks_%d0000.png' % pack_dir))
    return under_shadow(body, sh)


# ---------------------------------------------------------------------------
# GROUND CENTRE
# ---------------------------------------------------------------------------


def catapult_centre(scale):
    """
    The catapult's ground centre, MEASURED off the source rows (`--preview`
    writes the zooms this was read from):

      * the pack is a turntable about the frame's centre: the E and W views'
        wheel pairs sit at x 125/232 and 68/175, whose mid-points average to
        x = 150.25 - the same axis the S/N views are symmetric about;
      * the frame rails run THROUGH the wheel centres (axle height), so the
        rail's underside is not the ground. Its row in the E view (222) and
        the rail end faces' bottom row in the S view (254) differ by the
        depth of (half-length 113 - half-width 54.5) of frame, which gives
        the camera's depth factor k = 32 / 58.5 = 0.55 (a little steeper
        than 2:1);
      * the wheels DO touch the ground: the E view's wheel contacts (row 246)
        are 65.75 px out from the axis, so the ground centre is
        246 - 0.55 * 65.75 = 210. Check: the N view's rear wheels (25.5 px
        behind the axis) then contact at 224; they are seen at 227.

    Returns ({d: (x, y)} for the four views it was read from, (w, h)) in the
    scaled frame, in the shape `report_centre` prints.
    """
    k = (254 - 222) / (113 - 54.5)
    ox, oy = 150.25, 246 - k * 65.75
    w, h = int(round(CAT_SIZE[0] * scale)), int(round(CAT_SIZE[1] * scale))
    c = (ox * scale, oy * scale)
    return {d: c for d in (0, 2, 4, 6)}, (w, h)


def ballista_centre(scale):
    """
    The pedestal's foot: in the E/W facings the centre post stands clear of
    the base's arms, so the lowest opaque pixel in the middle columns is the
    foot of the axis the whole machine turns about.
    """
    out = {}
    size = None
    for d, rot in ((0, '090'), (4, '270')):
        body = bal_loaded(rot, shadow=False)
        body = body.resize((int(round(body.size[0] * scale)), int(round(body.size[1] * scale))), Image.LANCZOS)
        size = body.size
        a = body.getchannel('A').point(lambda v: 255 if v > 40 else 0)
        w, h = a.size
        mid = a.crop((int(w * 0.44), 0, int(w * 0.56), h))
        _, _, _, mb = mid.getbbox()
        row = mid.crop((0, mb - 1, mid.size[0], mb)).getbbox()
        out[d] = (int(w * 0.44) + (row[0] + row[2] - 1) / 2.0, mb - 1)
    return out, size


def report_centre(label, centres, size):
    xs = [c[0] for c in centres.values()]
    ys = [c[1] for c in centres.values()]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    w, h = size
    print('%s ground centre, scaled frame %dx%d:' % (label, w, h))
    for d, (x, y) in sorted(centres.items()):
        print('   %-2s  (%.1f, %.1f)  -> (%.3f, %.3f)' % (DIRS[d], x, y, x / w, y / h))
    print('   mean (%.1f, %.1f) -> ANCHOR (%.3f, %.3f); spread x %.1f px, y %.1f px'
          % (mx, my, mx / w, my / h, max(xs) - min(xs), max(ys) - min(ys)))
    return mx / w, my / h


# ---------------------------------------------------------------------------
# THE TABLE
# ---------------------------------------------------------------------------


def full_box(scale, size):
    """`keep` = the whole scaled frame, so every sheet of a machine shares one cell and one anchor."""
    w, h = size
    return (0, 0, int(round(w * scale)) - 1, int(round(h * scale)) - 1)


CAT_SIZE = (309, 282)
BAL_SIZE = (256, 256)


def job_catapult_idle():
    return cat_clip('throw', [0])


def job_catapult_throw():
    return cat_clip('throw', decimate(list(range(cat_count('throw'))), CLIP))


def job_catapult_load():
    return cat_clip('load', decimate(list(range(cat_count('load'))), CLIP))


def job_catapult_move():
    return cat_clip('move', decimate(list(range(cat_count('move'))), CLIP))


def job_catapult_break():
    return cat_clip('break', decimate(list(range(cat_count('break'))), CLIP))


def job_catapult_wreck():
    return cat_clip('break', [cat_count('break') - 1])


def job_catapult_stone():
    # The rock is ~30 px in the middle of a 400 px frame; cut it to a window
    # first so the sheet is 16 small cells, not a strip of 400 px squares.
    frames = stone_frames()
    return {0: [f.crop((176, 228, 224, 276)) for f in frames]}


def job_ballista_idle():
    return {d: [bal_loaded(BAL_ROT_FOR_DIR[d])] for d in range(8)}


def job_ballista_shoot():
    # Source order: frame 1 is the string just released (the shot), 2..9 the
    # winch drawing it back. Played once from idle it IS the shot; idle
    # (loaded, with the bolt) is what it returns to.
    return {d: [bal_shot(BAL_ROT_FOR_DIR[d], f) for f in range(1, 10)] for d in range(8)}


#: name -> (frames fn, write_anim kwargs). `keep` is the whole scaled frame
#: for the machines (one cell per machine, see the header).
JOBS = {
    'catapult_idle': (job_catapult_idle, dict(out_scale=CAT_SCALE, keep=full_box(CAT_SCALE, CAT_SIZE))),
    'catapult_throw': (job_catapult_throw, dict(out_scale=CAT_SCALE, keep=full_box(CAT_SCALE, CAT_SIZE))),
    'catapult_load': (job_catapult_load, dict(out_scale=CAT_SCALE, keep=full_box(CAT_SCALE, CAT_SIZE))),
    'catapult_move': (job_catapult_move, dict(out_scale=CAT_SCALE, keep=full_box(CAT_SCALE, CAT_SIZE))),
    'catapult_break': (job_catapult_break, dict(out_scale=CAT_SCALE, keep=full_box(CAT_SCALE, CAT_SIZE))),
    'catapult_wreck': (job_catapult_wreck, dict(out_scale=CAT_SCALE, keep=full_box(CAT_SCALE, CAT_SIZE))),
    'catapult_stone': (job_catapult_stone, dict(out_scale=0.9)),
    'ballista_idle': (job_ballista_idle, dict(out_scale=BAL_SCALE, keep=full_box(BAL_SCALE, BAL_SIZE))),
    'ballista_shoot': (job_ballista_shoot, dict(out_scale=BAL_SCALE, keep=full_box(BAL_SCALE, BAL_SIZE))),
}

SINGLES = {
    # One pile of the eight (they are the same pile from eight sides), x1.
    'catapult_rocks': lambda: rocks(0),
    # The loose bolt along +x: 184 px of shaft and head -> ~26 px.
    'ballista_bolt': lambda: bolt_single(40),  # it.115: long enough to read crossing the field
}


def bolt_single(length=26):
    im = bal_bolt()
    l, t, r, b = im.getbbox()
    im = im.crop((l, t, r, b))
    k = length / float(im.size[0])
    return im.resize((max(1, int(round(im.size[0] * k))), max(1, int(round(im.size[1] * k)))), Image.LANCZOS)


# ---------------------------------------------------------------------------
# PREVIEW
# ---------------------------------------------------------------------------


def preview(names):
    os.makedirs(PREVIEW, exist_ok=True)
    cat_c, cat_sz = catapult_centre(CAT_SCALE)
    cat_anchor = report_centre('catapult', cat_c, cat_sz)
    bal_c, bal_sz = ballista_centre(BAL_SCALE)
    bal_anchor = report_centre('ballista', bal_c, bal_sz)
    for name in names:
        if name in SINGLES:
            im = SINGLES[name]()
            path = os.path.join(PREVIEW, 'preview_%s.png' % name)
            big = im.resize((im.size[0] * 4, im.size[1] * 4), Image.NEAREST)
            bg = Image.new('RGBA', big.size, (90, 90, 100, 255))
            bg.alpha_composite(big)
            bg.save(path)
            print('preview', name, im.size, '->', path)
            continue
        fn, kw = JOBS[name]
        frames = fn()
        scale = kw.get('out_scale', 1.0)
        anchor = cat_anchor if name.startswith('catapult_') and 'keep' in kw else (bal_anchor if name.startswith('ballista_') else None)
        rows = {}
        for d, fr in frames.items():
            row = []
            for f in fr:
                f2 = f.resize((int(round(f.size[0] * scale)), int(round(f.size[1] * scale))), Image.LANCZOS) if scale != 1.0 else f.copy()
                bg = Image.new('RGBA', f2.size, (90, 90, 100, 255))
                bg.alpha_composite(f2)
                if anchor:
                    dr = ImageDraw.Draw(bg)
                    ax, ay = anchor[0] * f2.size[0], anchor[1] * f2.size[1]
                    dr.line((ax - 8, ay, ax + 8, ay), fill=(255, 40, 40, 255))
                    dr.line((ax, ay - 8, ax, ay + 8), fill=(255, 40, 40, 255))
                    # The 2x2 footprint diamond (128x64) about the anchor.
                    dr.polygon([(ax - 64, ay), (ax, ay - 32), (ax + 64, ay), (ax, ay + 32)], outline=(80, 220, 120, 200))
                row.append(bg)
            rows[d] = row
        path = os.path.join(PREVIEW, 'preview_%s.png' % name)
        contact_sheet(rows, path)
        print('preview', name, '%d dirs x %d frames, cell %s ->' % (len(rows), len(rows[0]), rows[0][0].size), path)


# ---------------------------------------------------------------------------
# BAKE
# ---------------------------------------------------------------------------


def bake(names):
    done = {}
    for name in names:
        if name in SINGLES:
            e = write_single(name, SINGLES[name]())
            done[name] = e
            print('%-16s single %dx%d' % (name, e['w'], e['h']))
            continue
        fn, kw = JOBS[name]
        e = write_anim(name, fn(), **kw)
        done[name] = e
        p = e['painted']
        print('%-16s %d dirs x %d frames, cell %dx%d, orig %dx%d, scale x%.2f, painted (%d,%d)-(%d,%d)'
              % (name, e['dirCount'], e['frameCount'], e['cellW'], e['cellH'], e['origW'], e['origH'],
                 kw.get('out_scale', 1.0), p['left'], p['top'], p['right'], p['bottom']))
    return done


def verify(names):
    man = read_manifest()
    ok = True
    for name in names:
        if name in SINGLES:
            e = man['singles'].get(name)
            want = (e['w'], e['h']) if e else None
        else:
            e = man['anims'].get(name)
            want = (e['cellW'] * e['frameCount'], e['cellH'] * e['dirCount']) if e else None
        path = os.path.join(ATLAS, e['file']) if e else None
        got = Image.open(path).size if path and os.path.exists(path) else None
        state = 'OK' if e and got == want else 'MISSING' if not e or got is None else 'SIZE MISMATCH %s != %s' % (got, want)
        if state != 'OK':
            ok = False
        print('verify %-16s %-28s %s %s' % (name, e['file'] if e else '-', got, state))
    return ok


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='comma-separated names to bake (default: all)')
    ap.add_argument('--preview', action='store_true', help='write contact sheets to the scratchpad, touch nothing else')
    args = ap.parse_args()
    all_names = list(JOBS) + list(SINGLES)
    names = [n.strip() for n in args.only.split(',')] if args.only else all_names
    for n in names:
        assert n in all_names, 'unknown job %s (have %s)' % (n, ', '.join(all_names))
    if args.preview:
        preview(names)
        sys.exit(0)
    bake(names)
    print()
    cat_c, cat_sz = catapult_centre(CAT_SCALE)
    report_centre('catapult', cat_c, cat_sz)
    bal_c, bal_sz = ballista_centre(BAL_SCALE)
    report_centre('ballista', bal_c, bal_sz)
    print()
    sys.exit(0 if verify(names) else 1)
