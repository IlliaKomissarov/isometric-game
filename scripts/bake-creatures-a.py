"""
BAKE CREATURES A (it.114): the pre-rendered 3D packs of the graphics-update drop.

Seven creatures out of the `mob*` folders - the giant spiders (three skins),
the orc brute, the frost werewolf, the treant, the red drake, the feathered
wyrm and the blue-marked ghoul - baked into the canonical 8-direction sheets
that `bakelib.write_anim` writes (rows = DIRS = E, NE, N, NW, W, SW, S, SE in
screen space).

THE PACK FORMAT. Every animation is one PNG per rendered angle,
`<Anim>_Body_<angle>.png`, holding all frames packed left-to-right,
top-to-bottom in cells of N px (the tier: x180p, x256p, x320p). The last row
may be partial, so the frame count is the last non-empty cell across the
eight directions we use. Sixteen angles are rendered (000, 022, 045, ... or
0, 30, 45, ...); we take the eight multiples of 45. Some packs also ship
`_Shadow_` sheets - ignored, the engine draws its own blob; the spiders and
the wyrm bake a soft contact shadow into the Body itself, which stays.

WHICH ANGLE FACES WHERE was decided by LOOKING (`--probe`), once per pack
family and re-checked per creature on the final contact sheets: in every
pack here angle 000 faces AWAY from the camera (N) and the angle grows
clockwise on screen (045 = NE, 090 = E, 135 = SE, 180 = S facing the viewer,
225 = SW, 270 = W, 315 = NW). That is `ANGLE_STD`; `ANGLE_MIRROR` is the
same wheel turning the other way, for a pack that ever needs it.

Usage:
    python scripts/bake-creatures-a.py --preview            # contact sheets only, nothing registered
    python scripts/bake-creatures-a.py --probe widow2_      # the walk's 8 angles, labelled by angle
    python scripts/bake-creatures-a.py                      # the real bake
    python scripts/bake-creatures-a.py --only treant_       # one creature
"""
import argparse
import glob
import os
import re
import sys
import time

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakelib import *  # noqa: E402,F401,F403
from bakelib import DIRS, DROP, SOUTH, ATLAS, contact_sheet, decimate, write_anim, read_manifest  # noqa: E402

SCRATCH = os.path.join(os.environ.get('TEMP', os.environ.get('TMP', '.')), 'claude',
                       'C--Users-user-Desktop-isometric-game',
                       '9b751797-5b62-470f-a302-7c92b37a98e4', 'scratchpad', 'bake-a')

# Canonical direction -> rendered angle. Verified by eye (see the docstring).
ANGLE_STD = {'N': 0, 'NE': 45, 'E': 90, 'SE': 135, 'S': 180, 'SW': 225, 'W': 270, 'NW': 315}
ANGLE_MIRROR = {'N': 0, 'NW': 45, 'W': 90, 'SW': 135, 'S': 180, 'SE': 225, 'E': 270, 'NE': 315}

# Frame caps per canonical anim role.
CAPS = {'idle': 10, 'walk': 10, 'attack': 12, 'death': 14, 'hit': 5}

# Tier folder names in order of preference; the third one is stored at 0.5.
TIERS = [('x180p_Spritesheets', 180, False), ('x180p Spritesheets', 180, False), ('x180_Spritesheets', 180, False),
         ('x256p_Spritesheets', 256, False), ('x256 Spritesheets', 256, False), ('x256_Spritesheets', 256, False),
         ('x320p_Spritesheets', 320, True), ('x320 Spritesheets', 320, True), ('x320_Spritesheets', 320, True)]

# prefix -> creature. `anims` maps the canonical role (the atlas suffix) to
# the pack's animation folder and an optional frame cap override.
CREATURES = {
    'widow2_': dict(src='mob10/1', angles=ANGLE_STD,
                    anims={'idle': 'Idle_01', 'walk': 'Walk_Forward', 'attack': 'Attack_01', 'death': 'Death_01', 'hit': 'Hit_01'}),
    'widow3_': dict(src='mob10/3', angles=ANGLE_STD,
                    anims={'idle': 'Idle_01', 'walk': 'Walk_Forward', 'attack': 'Attack_01', 'death': 'Death_01', 'hit': 'Hit_01'}),
    'widow4_': dict(src='mob10/11', angles=ANGLE_STD,
                    anims={'idle': 'Idle_01', 'walk': 'Walk_Forward', 'attack': 'Attack_01', 'death': 'Death_01', 'hit': 'Hit_01'}),
    'brute_': dict(src='mob', angles=ANGLE_STD,
                   anims={'idle': 'Idle_Armed', 'walk': 'Walk_Armed', 'attack': 'Attack_01', 'death': 'Death_Armed', 'hit': 'Hit_Armed'}),
    'frostwolf_': dict(src='mob3/1', angles=ANGLE_STD,
                       anims={'idle': 'Idle', 'walk': 'Walk_Forward', 'attack': 'Attack_01', 'death': 'Death', 'hit': 'Hit'}),
    # mob3/2 and mob3/3 are the same ice-blue werewolf (alternate anim sets, not
    # skins), so there is no `frostwolf2_`; mob3/4 and /5 are other creatures.
    'treant_': dict(src='mob13', angles=ANGLE_STD,
                    anims={'idle': 'Idle', 'walk': 'Walk (Loop)', 'attack': 'Attack_01', 'death': 'Death', 'hit': 'Hit',
                           'awake': ('Awake', 12)}),
    'drake_': dict(src='mob1', angles=ANGLE_STD,
                   anims={'idle': 'Idle1', 'walk': 'Walk', 'attack': 'Attack1', 'death': 'Death', 'hit': 'Hit',
                          'breath': ('FireBreath', 14)}),
    'wyrm_': dict(src='mob7', angles=ANGLE_STD,
                  # mob7 has no death, and its only hit (Fly_Hit) is an airborne flip - both skipped.
                  anims={'idle': 'Ground_Idle', 'walk': 'Ground_Run', 'attack': 'Ground_Attack_Bite',
                         'fly': ('Fly_Cycle', 10)}),
    'ghoul2_': dict(src='mob4/1', angles=ANGLE_STD,
                    anims={'idle': 'Idle', 'walk': 'Walk', 'attack': 'Attack_Bite', 'death': 'Death_Forward',
                           'crawl': ('Crawl', 10)}),
}


# ---------------------------------------------------------------------------
# LOADING
# ---------------------------------------------------------------------------


def find_tier(src_dir):
    """(tier folder, cell px, half) - the first tier of TIERS that exists under `src_dir`."""
    for name, px, half in TIERS:
        d = os.path.join(src_dir, name)
        if os.path.isdir(d):
            return d, px, half
    raise FileNotFoundError('no spritesheet tier under %s' % src_dir)


_ANGLE_RE = re.compile(r'_Body_0*(\d+)\.png$', re.I)


def sheet_files(anim_dir):
    """angle (int) -> Body sheet path, tolerant of `000`, `0`, spaces in the anim name."""
    out = {}
    for p in glob.glob(os.path.join(glob.escape(anim_dir), '*.png')):
        m = _ANGLE_RE.search(os.path.basename(p))
        if m:
            out[int(m.group(1))] = p
    return out


def cells_of(sheet, n):
    """All cells of an N px grid sheet, row-major."""
    w, h = sheet.size
    cols, rows = w // n, h // n
    return [sheet.crop((c * n, r * n, c * n + n, r * n + n)) for r in range(rows) for c in range(cols)]


def last_opaque(cells):
    last = -1
    for i, c in enumerate(cells):
        if c.getchannel('A').getbbox():
            last = i
    return last + 1


def load_anim(src_dir, anim, angles):
    """dict canonical dir index -> [frames] for the eight angles in `angles`, plus (tier, half)."""
    tier, px, half = find_tier(src_dir)
    files = sheet_files(os.path.join(tier, anim))
    if not files:
        raise FileNotFoundError('no Body sheets in %s' % os.path.join(tier, anim))
    per_angle = {}
    for d, name in enumerate(DIRS):
        a = angles[name]
        if a not in files:
            raise FileNotFoundError('%s/%s: no sheet for angle %d (have %s)' % (src_dir, anim, a, sorted(files)))
        per_angle[d] = cells_of(Image.open(files[a]).convert('RGBA'), px)
    n = max(last_opaque(c) for c in per_angle.values())
    assert n > 0, '%s/%s: empty' % (src_dir, anim)
    return {d: c[:n] for d, c in per_angle.items()}, half


# ---------------------------------------------------------------------------
# THE BAKE
# ---------------------------------------------------------------------------


def anim_spec(role, val):
    if isinstance(val, tuple):
        return val[0], val[1]
    return val, CAPS[role]


def bake(prefix, spec, preview=False):
    src_dir = os.path.join(DROP, spec['src'])
    done = []
    for role, val in spec['anims'].items():
        anim, cap = anim_spec(role, val)
        frames, half = load_anim(src_dir, anim, spec['angles'])
        raw = len(frames[0])
        frames = {d: decimate(f, cap) for d, f in frames.items()}
        name = prefix + role
        contact_sheet(frames, os.path.join(SCRATCH, name + '.png'))
        if not preview:
            # Other bakes run alongside this one; on Windows the manifest rename
            # can be refused while a reader holds the file. The write is idempotent.
            for attempt in range(5):
                try:
                    e = write_anim(name, frames, nearest=False, half=half)
                    break
                except PermissionError:
                    if attempt == 4:
                        raise
                    time.sleep(0.5 * (attempt + 1))
            done.append((name, raw, e))
            print('  %-20s %2d/%2d frames  cell %dx%d  scale %s  painted h=%d  (%s)' % (
                name, e['frameCount'], raw, e['cellW'], e['cellH'], e['scale'],
                e['painted']['bottom'] - e['painted']['top'] + 1, anim))
        else:
            print('  %-20s %2d/%2d frames  %dx%d  half=%s  (%s)' % (name, len(frames[0]), raw, *frames[0][0].size, half, anim))
    return done


def probe(prefix, spec):
    """The walk's first frame at every rendered multiple of 45, labelled by ANGLE, to decide the mapping by eye."""
    src_dir = os.path.join(DROP, spec['src'])
    tier, px, half = find_tier(src_dir)
    walk, _ = anim_spec('walk', spec['anims']['walk'])
    files = sheet_files(os.path.join(tier, walk))
    from PIL import ImageDraw
    rows = []
    for a in sorted(files):
        if a % 45:
            continue
        cells = cells_of(Image.open(files[a]).convert('RGBA'), px)
        n = last_opaque(cells)
        rows.append((a, decimate(cells[:n], 4)))
    # Zoom: crop every cell to the anim's union box and blow it up to 256 px so the face reads.
    box = union_bbox([c for _, cells in rows for c in cells])
    l, t, r_, b = box
    bw, bh = r_ - l + 1, b - t + 1
    k = 256.0 / max(bw, bh)
    w, h = int(bw * k), int(bh * k)
    rows = [(a, [c.crop((l, t, r_ + 1, b + 1)).resize((w, h), Image.LANCZOS) for c in cells]) for a, cells in rows]
    # bakelib.contact_sheet labels an 8-row dict by DIRS, so the angle grid is drawn here.
    sheet = Image.new('RGBA', (w * 4 + 48, h * len(rows)), (40, 40, 48, 255))
    draw = ImageDraw.Draw(sheet)
    for r, (a, cells) in enumerate(rows):
        draw.text((4, r * h + 4), '%03d' % a, fill=(255, 220, 120, 255))
        for i, c in enumerate(cells):
            sheet.paste(c, (48 + i * w, r * h), c)
    path = os.path.join(SCRATCH, 'probe_' + prefix + '.png')
    sheet.save(path)
    print('probe:', path)


def verify(names):
    man = read_manifest()
    ok = True
    for name in names:
        e = man['anims'].get(name)
        if not e:
            print('MISSING manifest entry', name)
            ok = False
            continue
        p = os.path.join(ATLAS, e['file'])
        if not os.path.exists(p):
            print('MISSING file', p)
            ok = False
            continue
        w, h = Image.open(p).size
        want = (e['cellW'] * e['frameCount'], e['cellH'] * e['dirCount'])
        ph = e['painted']['bottom'] - e['painted']['top'] + 1
        good = (w, h) == want and ph > 20
        ok = ok and good
        print('%s %-20s %dx%d %s painted h=%d' % ('ok ' if good else 'BAD', name, w, h, 'want %dx%d' % want if (w, h) != want else '', ph))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='bake one creature by prefix (e.g. treant_)')
    ap.add_argument('--preview', action='store_true', help='contact sheets to the scratchpad only; register nothing')
    ap.add_argument('--probe', help='write the walk anim of one prefix labelled by angle, to decide the mapping')
    args = ap.parse_args()
    os.makedirs(SCRATCH, exist_ok=True)
    if args.probe:
        probe(args.probe, CREATURES[args.probe])
        return
    names = []
    for prefix, spec in CREATURES.items():
        if args.only and prefix != args.only:
            continue
        print('%s <- %s' % (prefix, spec['src']))
        for name, raw, e in bake(prefix, spec, preview=args.preview):
            names.append(name)
    if not args.preview:
        print('verify:')
        sys.exit(0 if verify(names) else 1)


if __name__ == '__main__':
    main()
