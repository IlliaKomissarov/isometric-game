"""
FEET CALIBRATION (it.115): where the ground is, per animation sheet.

The owner: "the orc knight and other mobs fly up into the air when attacking,
they are floating above the floor; even when they die they stay floating".

Why: every rig anchored its body by the PAINTED bounds of the sheet - the
union alpha box of the south row over ALL frames - so the lowest painted
pixel of the whole clip sat on the tile. A brute's club swung down in front
of him paints 64 px below his boots, a falling body paints below them too, a
baked shadow's soft rim paints below them: the body floated by that much for
the whole clip. The pre-rendered 3D packs are not even consistent between
their own clips (the drake's idle stands 16 px higher on its canvas than its
walk), so one number per creature is not enough either.

The FEET ROW of a clip, in original frame pixels, measured on the south-facing
row: a frame's SOLID BOTTOM is the lowest row with at least a few pixels of
alpha >= 128 (a baked shadow is translucent and drops out; a single weapon tip
is thin and drops out of the median), and then per clip role:

  * loops (idle, walk, run, crawl, fly, sit, talk...): the MEDIAN over every
    frame - a stride's lifted foot and a swung weapon are outvoted;
  * a body that falls (death, die): FRAME 0, where it still stands, is
    `feetY`; and because the packs throw their dead every which way (the
    creeper lands 36 px up its canvas, the brute 80 px down it, the
    halberdier's pole lies far in front of him) one number cannot hold a
    corpse on its tile. So a fall also gets `feetFrames`, one anchor row per
    frame: a LYING row (the frame's solid centroid, a quarter of the way down
    to its solid bottom - the middle of a body flat on the floor) blended in
    by how far the body has come down (its solid height against frame 0's,
    never going back up). A standing frame keeps `feetY`, a fallen frame
    centres the body on its tile, and the corpse left behind uses the last
    frame's row - no corpse hovers behind or in front of where it died;
  * a body that rises (awake): the LAST frame, where it stands;
  * every other one-shot (attack, hit, cast, shout...): frame 0 or the last
    frame, whichever agrees better with the creature's idle - a clip starts
    and ends in its stance, and one end may be mid-lunge.

The number is written into the manifest entry as `feetY` (and a fall's
`feetFrames`) through bakelib's locked writer, in place: nothing else in the
entry is touched. `SpriteLibrary.feetY()`,
`footAnchor()` and `bodyHeight()` prefer it over the painted bottom, so the
enemies, the puppets and every `footAnchor()` caller stand on it.

A re-bake rewrites its entries without `feetY`: re-run this script after any
creature bake.

    python scripts/calibrate-feet.py                 # calibrate + write
    python scripts/calibrate-feet.py --dry --out D   # print + composites, write nothing
    python scripts/calibrate-feet.py --only brute treant   # a subset (still writes)

Composites (one strip per creature: frames of idle/walk/attack/death on a
64x32 diamond at the rig scale, next to a hero-sized reference) are drawn
only with `--out DIR`, so the result can be LOOKED AT.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakelib import ATLAS, _update, read_manifest  # noqa: E402

# ---------------------------------------------------------------------------
# WHAT GETS CALIBRATED
# ---------------------------------------------------------------------------

#: Every eight-direction body in the manifest except the siege machines.
#: prefix -> heightMult, for the composite's rig scale only (mirrors
#: `ENEMY_TYPES` / `costumes.ts`).
MULTS = {
    'widow2': 0.8, 'widow3': 0.8, 'widow4': 0.8, 'brute': 1.35, 'frostwolf': 1.1,
    'treant': 1.25, 'drake': 1.2, 'wyrm': 1.0, 'ghoul2': 1.0, 'spearman': 1.05,
    'orcess': 1.0, 'moth': 0.7, 'zomb2': 1.0, 'halberd': 1.05, 'reaper': 1.0,
    'duelist': 0.95, 'apex': 1.1, 'apex2': 1.1, 'krampus': 1.25, 'gargoyle': 1.4,
    'spider2': 0.9, 'flesh': 1.05, 'creeper': 1.05, 'hdknight': 1.0, 'gsknight': 1.0,
    'pixgirl': 1.0, 'orc': 0.95, 'spider': 0.45, 'wolf': 1.1, 'zombie': 1.08,
    'hydra': 1.25, 'naga': 0.8,
}
NOT_BODIES = ('catapult', 'ballista', 'siege')

#: Clip suffixes by role (see the docstring).
LOOPS = ('idle', 'walk', 'run', 'crawl', 'fly', 'sit', 'talk', 'slow')
FALLS = ('death', 'die')
RISES = ('awake',)

#: Which clips stand in for idle/walk/attack/death in the composite.
ROLE_NAMES = {
    'idle': ('idle',),
    'walk': ('walk', 'run'),
    'attack': ('attack', 'melee2', 'cast'),
    'death': ('death', 'die'),
}

#: Hand corrections (anim -> feet row in ORIGINAL px), where the rule is off.
#: Filled in from the composites (none needed after the it.115 pass).
FEET_OVERRIDE = {
}

#: CLIPS CUT SHORT (it.115): the pack's own render is broken past this frame,
#: written as `useFrames` and honoured by `SpriteLibrary.slice`. The zombie
#: pack's body falls OFF the bottom of its 512 px canvas from frame 9 (only
#: the legs are left in frame); the brute lies on his side at frame 9 and then
#: pops to a spread-eagle pose 80 px further down the canvas.
#: Per-frame fall rows by hand (ORIGINAL px): the teal spider fades to half
#: alpha while it curls, so nothing solid is left to measure; its curled body
#: settles to the row its last (opaque) frame measures.
FRAMES_OVERRIDE = {
    'spider2_death': [163, 159, 150, 140, 126, 116, 112, 110, 109, 108, 108, 107, 107, 107],
}

CLIP_FRAMES = {
    'zombie_death': 9,
    'brute_death': 10,
}

# `rowForDir(anim, 6)` in Python: which FILE row faces south for the packs
# whose rows are not in canonical order (`DIR_ROW_FIX` in SpriteLibrary.ts -
# keep the two in step; the it.115 facing audit rewrote both).
S = 6
BEHIND_ONE = (S + 7) % 8
DIR_ROW_FIX = {
    'ranger_': (4 - S + 8) % 8,
    'guard_': (6 - S + 8) % 8,
    'wolf_': (4 - S + 8) % 8,
    'lizard_': (6 - S + 8) % 8,
    'hydra_': (6 - S + 8) % 8,
    'naga_': (6 - S + 8) % 8,
    'shambler_': (6 - S + 8) % 8,
    'folk_': (S + 2) % 8,
    'poacher_': (S + 2) % 8,
    'captain_': (S + 2) % 8,
    'villager_': (S + 3) % 8,
    'merchant_': (S + 3) % 8,
    'ahoul_': BEHIND_ONE, 'skelw_': BEHIND_ONE, 'skelm_': BEHIND_ONE, 'frost_': BEHIND_ONE,
    'shaman_': BEHIND_ONE, 'mage_': BEHIND_ONE, 'rogue_': BEHIND_ONE, 'mithras_': BEHIND_ONE,
    'hollow2_': BEHIND_ONE, 'grave_': BEHIND_ONE,
    'spider2_': (S + 4) % 8,
    'hdknight_': (S + 5) % 8,
    'pixgirl_': (5 - S + 8) % 8,
}


def south_row(name, dir_count):
    if dir_count != 8:
        return 0
    for prefix, row in DIR_ROW_FIX.items():
        if name.startswith(prefix):
            return row
    return S


def creatures(man):
    """prefix -> [anim names] for every eight-direction body in the manifest."""
    out = {}
    for n, e in man['anims'].items():
        if e.get('dirCount') != 8 or '_' not in n:
            continue
        prefix = n.split('_', 1)[0]
        if prefix == 'cit':
            prefix = '_'.join(n.split('_')[:2])
        if prefix in NOT_BODIES:
            continue
        out.setdefault(prefix, []).append(n)
    return {k: sorted(v) for k, v in sorted(out.items())}


def suffix(prefix, name):
    return name[len(prefix) + 1:].split('_')[-1]


# ---------------------------------------------------------------------------
# THE MEASUREMENT
# ---------------------------------------------------------------------------

_sheets = {}


def sheet(e):
    f = e['file']
    if f not in _sheets:
        _sheets[f] = Image.open(os.path.join(ATLAS, f)).convert('RGBA')
    return _sheets[f]


def cell(e, row, frame):
    """One atlas cell as an RGBA uint8 array (atlas pixels)."""
    im = sheet(e)
    cw, ch = e['cellW'], e['cellH']
    return np.asarray(im.crop((frame * cw, row * ch, (frame + 1) * cw, (row + 1) * ch)), dtype=np.uint8)


def to_orig_y(e, cy):
    """Atlas cell row -> ORIGINAL frame row."""
    return e['trimY'] + cy / e['scale']


def solid_bottom(e, px):
    """The frame's solid bottom (ORIGINAL px, one past the lowest solid row) or None."""
    need = max(2, int(round(4 * e['scale'])))
    rows = (px[..., 3] >= 128).sum(axis=1)
    ys = np.nonzero(rows >= need)[0]
    if ys.size == 0:
        return None
    return float(to_orig_y(e, ys.max() + 1))


def frame_count(e, name):
    return min(e['frameCount'], CLIP_FRAMES.get(name, e['frameCount']))


def bottoms(e, name):
    row = south_row(name, e['dirCount'])
    return [solid_bottom(e, cell(e, row, f)) for f in range(frame_count(e, name))]


def erode(m, r):
    """Binary erosion by a (2r+1) square: a pole, a blade or a bow string is gone."""
    for _ in range(r):
        p = np.pad(m, 1, constant_values=False)
        m = (p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
             & p[:-2, :-2] & p[:-2, 2:] & p[2:, :-2] & p[2:, 2:])
    return m


def solid_stats(e, px):
    """(top, bottom, centroid row) of the THICK solid pixels, ORIGINAL px, or None.

    Eroded first, so the halberdier's pole lying in front of him does not
    count as his body (his height would never drop, and his corpse would hang
    over the pole)."""
    r = max(1, int(round(2 * e['scale'])))
    m = erode(px[..., 3] >= 128, r)
    if not m.any():
        # A body fading out (the teal spider) is translucent: count what is left of it.
        m = erode(px[..., 3] >= 48, r)
    rows = m.sum(axis=1)
    ys = np.nonzero(rows > 0)[0]
    if ys.size == 0:
        return None
    cy = float((np.arange(rows.size) * rows).sum() / rows.sum())
    return float(to_orig_y(e, ys.min())), float(to_orig_y(e, ys.max() + 1)), float(to_orig_y(e, cy + 0.5))


def fall_frames(e, name, stand):
    """One anchor row per frame of a falling clip (see the docstring)."""
    row = south_row(name, e['dirCount'])
    stats = [solid_stats(e, cell(e, row, f)) for f in range(frame_count(e, name))]
    known = [st for st in stats if st is not None]
    if not known:
        return None
    h0 = known[0][1] - known[0][0]
    h_min = min(st[1] - st[0] for st in known)
    out = []
    fallen = 0.0
    for st in stats:
        if st is None:
            out.append(out[-1] if out else stand)
            continue
        top, bottom, cy = st
        lying = cy + (bottom - cy) * 0.25
        if h0 - h_min > 4:
            fallen = max(fallen, min(1.0, max(0.0, (h0 - (bottom - top)) / (h0 - h_min))))
        out.append(round(stand + (lying - stand) * fallen, 1))
    # The last frame is the corpse: always fully down.
    top, bottom, cy = known[-1]
    out[-1] = round(cy + (bottom - cy) * 0.25, 1)
    return out


def measure(prefix, name, e, idle_y):
    """Feet row in ORIGINAL px for one clip, plus how it was found."""
    bs = bottoms(e, name)
    ok = [b for b in bs if b is not None]
    if not ok:
        return float(e['painted']['bottom'] + 1), 'painted'
    first = bs[0] if bs[0] is not None else ok[0]
    last = bs[-1] if bs[-1] is not None else ok[-1]
    role = suffix(prefix, name)
    if role in LOOPS:
        return float(np.median(ok)), 'median'
    if role in FALLS:
        frames = FRAMES_OVERRIDE.get(name) or fall_frames(e, name, first)
        if frames:
            return first, 'frame0', frames
        return first, 'frame0'
    if role in RISES:
        return last, 'last'
    if idle_y is not None and abs(last - idle_y) < abs(first - idle_y):
        return last, 'last'
    return first, 'frame0'


def calibrate(groups, man):
    """{anim: (feetY, how)} for every clip of the given creatures."""
    out = {}
    for prefix, names in groups.items():
        idle = next((n for n in names if suffix(prefix, n) == 'idle'), None)
        idle_y = measure(prefix, idle, man['anims'][idle], None)[0] if idle else None
        for name in names:
            e = man['anims'][name]
            if name in FEET_OVERRIDE:
                out[name] = (float(FEET_OVERRIDE[name]), 'override')
            else:
                out[name] = measure(prefix, name, e, idle_y)
    return out


# ---------------------------------------------------------------------------
# THE COMPOSITE
# ---------------------------------------------------------------------------

ZOOM = 2
CELL_W, CELL_H = 150, 260
MOB = 56


def role_of(prefix, name):
    suf = name[len(prefix) + 1:]
    for role, names in ROLE_NAMES.items():
        if suf in names:
            return role
    return None


def body_height(e, feet):
    return feet - e['painted']['top']


def rig_scale(prefix, man, feet, mult):
    """MOB * mult over ref = max(body(idle), body(walk), body(attack) / 1.45) - as `SpriteLibrary.rigHeight`."""
    hs = {}
    for name, fv in feet.items():
        v = fv[0]
        if not name.startswith(prefix + '_'):
            continue
        r = role_of(prefix, name)
        if r in ('idle', 'walk', 'attack') and r not in hs:
            hs[r] = body_height(man['anims'][name], v)
    if not hs:
        return 1.0
    ref = max(hs.get('idle', 0), hs.get('walk', 0), hs.get('attack', 0) / 1.45)
    return MOB * mult / ref if ref > 0 else 1.0


def diamond(draw, cx, cy):
    hw, hh = 32 * ZOOM, 16 * ZOOM
    draw.polygon([(cx, cy - hh), (cx + hw, cy), (cx, cy + hh), (cx - hw, cy)], fill=(70, 96, 60, 255), outline=(150, 190, 120, 255))


def paste_frame(canvas, e, row, frame, feet_y, scale, at):
    """Draw one atlas cell with the feet row on `at` and the frame's centre column over it (as the enemy rig)."""
    px = cell(e, row, frame)
    im = Image.fromarray(px, 'RGBA')
    k = scale * ZOOM / e['scale']  # atlas px -> canvas px
    w, h = max(1, int(round(im.size[0] * k))), max(1, int(round(im.size[1] * k)))
    im = im.resize((w, h), Image.LANCZOS)
    cx_atlas = (e['origW'] / 2 - e['trimX']) * e['scale']
    cy_atlas = (feet_y - e['trimY']) * e['scale']
    x = int(round(at[0] - cx_atlas * k))
    y = int(round(at[1] - cy_atlas * k))
    canvas.alpha_composite(im, (x, y))


def composite(prefix, names, man, feet, mult, out_dir, ref_e):
    shots = []
    for role in ('idle', 'walk', 'attack', 'death'):
        n = next((x for x in names if role_of(prefix, x) == role), None)
        if not n:
            continue
        fc = frame_count(man['anims'][n], n)
        fr = [0] if role == 'idle' else [0, fc // 2] if role == 'walk' else [fc // 2, (2 * fc) // 3] if role == 'attack' else [fc // 2, fc - 1]
        shots += [(n, f) for f in fr]
    for n in names:
        if role_of(prefix, n) is None:
            shots.append((n, frame_count(man['anims'][n], n) // 2))
    scale = rig_scale(prefix, man, feet, mult)
    cols = len(shots) + 1
    canvas = Image.new('RGBA', (cols * CELL_W, CELL_H), (28, 26, 34, 255))
    draw = ImageDraw.Draw(canvas)
    ground_y = CELL_H - 44
    diamond(draw, CELL_W // 2, ground_y)
    ref_feet = ref_e.get('feetY', ref_e['painted']['bottom'] + 1)
    ref_scale = MOB / (ref_feet - ref_e['painted']['top'])
    paste_frame(canvas, ref_e, S, 0, ref_feet, ref_scale, (CELL_W // 2, ground_y))
    draw.text((6, 6), 'hero 56px', fill=(255, 220, 120, 255))
    draw.text((6, CELL_H - 30), '%s x%.2f  rig %.3f' % (prefix, mult, scale), fill=(255, 220, 120, 255))
    for i, (n, f) in enumerate(shots):
        e = man['anims'][n]
        cx = (i + 1) * CELL_W + CELL_W // 2
        diamond(draw, cx, ground_y)
        v, how = feet[n][0], feet[n][1]
        if len(feet[n]) > 2:
            v = feet[n][2][f]
            how += '>frames'
        paste_frame(canvas, e, south_row(n, e['dirCount']), f, v, scale, (cx, ground_y))
        # A hairline at the ground so a float reads at a glance.
        draw.line([(cx - 40, ground_y), (cx + 40, ground_y)], fill=(255, 80, 80, 160))
        draw.text(((i + 1) * CELL_W + 4, 6), '%s f%d' % (n[len(prefix) + 1:], f), fill=(230, 230, 230, 255))
        draw.text(((i + 1) * CELL_W + 4, 18), 'feet %.1f %s' % (v, how), fill=(180, 200, 255, 255))
        draw.text(((i + 1) * CELL_W + 4, 30), 'pb %d  body %.0f' % (e['painted']['bottom'] + 1, body_height(e, v)), fill=(180, 200, 255, 255))
    path = os.path.join(out_dir, 'feet_%s.png' % prefix)
    canvas.save(path)
    return path


def stack(paths, out, per=5):
    """Several creature strips in one image, so fewer files need looking at."""
    ims = [Image.open(p) for p in paths]
    w = max(i.size[0] for i in ims)
    pages = []
    for i in range(0, len(ims), per):
        chunk = ims[i:i + per]
        h = sum(c.size[1] for c in chunk)
        page = Image.new('RGBA', (w, h), (0, 0, 0, 255))
        y = 0
        for c in chunk:
            page.paste(c, (0, y))
            y += c.size[1]
        p = '%s_%d.png' % (out, i // per)
        page.save(p)
        pages.append(p)
    return pages


# ---------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true', help='measure (and draw), write nothing')
    ap.add_argument('--only', nargs='*', help='creature prefixes to calibrate')
    ap.add_argument('--out', help='draw the composites into this folder')
    args = ap.parse_args()
    man = read_manifest()
    groups = creatures(man)
    if args.only:
        groups = {k: v for k, v in groups.items() if k in args.only}
    feet = calibrate(groups, man)

    for prefix, names in groups.items():
        print(prefix)
        for n in names:
            v, how = feet[n][0], feet[n][1]
            e = man['anims'][n]
            end = ('  frames %s' % ' '.join('%.0f' % x for x in feet[n][2])) if len(feet[n]) > 2 else ''
            print('   %-22s feetY %6.1f  (%-7s painted.bottom+1 %3d  origH %3d  body %3.0f)%s' % (
                n, v, how, e['painted']['bottom'] + 1, e['origH'], body_height(e, v), end))

    if args.out:
        out_dir = os.path.abspath(args.out)
        os.makedirs(out_dir, exist_ok=True)
        ref = man['anims']['knight_idle']
        paths = [composite(p, names, man, feet, MULTS.get(p, 1.0), out_dir, ref) for p, names in groups.items()]
        pages = stack(paths, os.path.join(out_dir, 'feet_all'))
        print('composites:', *pages, sep='\n  ')

    if args.dry:
        print('dry run: manifest untouched')
        return

    def apply(m):
        for n, fv in feet.items():
            e = m['anims'].get(n)
            if e is None:
                continue
            e['feetY'] = round(fv[0], 1)
            e.pop('feetYEnd', None)
            if n in CLIP_FRAMES:
                e['useFrames'] = CLIP_FRAMES[n]
            else:
                e.pop('useFrames', None)
            if len(fv) > 2:
                e['feetFrames'] = [round(x, 1) for x in fv[2]]
            else:
                e.pop('feetFrames', None)
    _update(apply)
    print('wrote feetY for %d anims' % len(feet))


if __name__ == '__main__':
    main()
