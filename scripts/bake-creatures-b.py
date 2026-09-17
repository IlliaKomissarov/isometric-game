"""
BAKE B (it.114): seven pre-rendered 3D creature packs from the graphics-update
drop, cut into the 8-direction sheets `SpriteLibrary` mounts.

    spearman_  <- mob6            (orc spearman; FRAME form, 8 angles)
    orcess_    <- mob8/1          (green orc warrior woman)
    moth_      <- "mob 11"        (moth; 320 px tier, baked at half)
    zomb2_     <- mob12/1         (zombie; space-separated sheet names)
    halberd_   <- halbard         (human halberdier; 320 px tier, half)
    reaper_    <- npc/1           (caped assassin)
    duelist_   <- npc1            (female duellist)

THE PACK FORMAT. Sheet form is one PNG per angle holding every frame packed
left->right, top->bottom in `cell` px squares (the frame count is the number
of opaque cells, so a partial last row is fine). Frame form (mob6) is one PNG
per frame under `<Anim>/Body/<angle>/`. Angles are 22.5 deg apart (or 45 for
mob6, or 30-and-45 for npc/1); we take the eight multiples of 45.

WHICH ANGLE FACES WHERE is per pack and was determined BY LOOKING at the walk
angle sheets (`--preview` writes them): `angles` below lists, in canonical
DIRS order (E, NE, N, NW, W, SW, S, SE - screen space, S faces the viewer),
the source angle that shows that facing.

    python scripts/bake-creatures-b.py --preview            # contact sheets only
    python scripts/bake-creatures-b.py                      # bake + register all
    python scripts/bake-creatures-b.py --only reaper_       # one creature
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakelib import ATLAS, DROP, alpha_bbox, contact_sheet, decimate, write_anim  # noqa: E402

SCRATCH = os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'Temp', 'claude',
                       'C--Users-user-Desktop-isometric-game',
                       '9b751797-5b62-470f-a302-7c92b37a98e4', 'scratchpad', 'bake-b')

# Decimation caps per role (a 60 fps capture is not an animation).
CAPS = {'idle': 10, 'walk': 10, 'attack': 12, 'death': 14, 'hit': 5}

ANGLES8 = [0, 45, 90, 135, 180, 225, 270, 315]

# Angle -> facing, READ OFF THE SHEETS (see the docstring). Every humanoid pack
# renders 000 as the back (N) and turns clockwise: 090 walks right (E), 180
# faces the viewer (S), 270 walks left (W). The orcess' battle stance is
# twisted ~45 deg from her hips (her two deaths land at 135 and 225), but her
# run-lunge at 180 goes straight down the screen, so she uses the same table.
# The moth is the odd one: 000 has the antennae toward the viewer (S) and 090
# points them left (W).
STD = [90, 45, 0, 315, 270, 225, 180, 135]     # E, NE, N, NW, W, SW, S, SE
MOTH = [270, 225, 180, 135, 90, 45, 0, 315]

# One row per creature. `anims`: our suffix -> (source anim, cap). `angles`:
# the source angle per canonical direction (E, NE, N, NW, W, SW, S, SE).
# `zero`: how the pack spells the 0 deg angle ('000' or '0'). `sep`: the
# separator in sheet file names ('_' or ' '). `strip_shadow`: mob6 is the one
# pack whose Body frames carry the drop shadow (near-black, alpha < 128); it
# is keyed out so `painted.bottom` is the feet, not the shadow's edge.
CREATURES = [
    dict(prefix='spearman_', form='frames', base='mob6/Frames_180x180', cell=180, half=False,
         zero='000', sep='_', strip_shadow=True,
         anims={'idle': ('Idle_Stand', 10), 'walk': ('Walk_Forward', 10), 'attack': ('Attack_01', 12),
                'death': ('Death_01', 14), 'hit': ('Hit_01', 5), 'shout': ('Shout', 10)},
         angles=STD),
    dict(prefix='orcess_', form='sheet', base='mob8/1/x180p_Spritesheets', cell=180, half=False,
         zero='000', sep='_',
         anims={'idle': ('Idle_BattlePose', 10), 'walk': ('Walk_Forward', 10), 'attack': ('Attack_01', 12),
                'death': ('Death_FallBack', 14), 'hit': ('Hit_Stomach', 5), 'levelup': ('LevelUp', 12)},
         angles=STD),
    dict(prefix='moth_', form='sheet', base='mob 11/x320_Spritesheets', cell=320, half=True,
         zero='000', sep='_',
         anims={'idle': ('Idle', 10), 'walk': ('Fly', 10), 'attack': ('Attack', 12),
                'death': ('Death', 14), 'hit': ('Hit', 5)},
         angles=MOTH),
    dict(prefix='zomb2_', form='sheet', base='mob12/1/x256_Spritesheets', cell=256, half=False,
         zero='0', sep=' ',
         anims={'idle': ('Idle', 10), 'walk': ('Walk', 10), 'attack': ('Attack1', 12),
                'death': ('Death1', 14), 'hit': ('Hit1', 5), 'roar': ('Roar', 10)},
         angles=STD),
    dict(prefix='halberd_', form='sheet', base='halbard/x320p_Spritesheets', cell=320, half=True,
         zero='000', sep='_',
         anims={'idle': ('Idle', 10), 'walk': ('Walk', 10), 'attack': ('Attack1', 12),
                'death': ('Death', 14), 'hit': ('Hit', 5)},
         angles=STD),
    dict(prefix='reaper_', form='sheet', base='npc/1/x256_Spritesheets', cell=256, half=False,
         zero='0', sep='_',
         anims={'idle': ('Idle', 10), 'walk': ('Walk', 10), 'attack': ('Attack1', 12),
                'death': ('Death', 14), 'hit': ('Hit', 5), 'dash': ('Dash', 8), 'talk': ('Talk', 10)},
         angles=STD),
    dict(prefix='duelist_', form='sheet', base='npc1/x180p_Spritesheets', cell=180, half=False,
         zero='000', sep='_',
         anims={'idle': ('Idle', 10), 'walk': ('Run', 10), 'attack': ('Slash_1', 12),
                'death': ('Death_Forward', 14), 'hit': ('Hit_Stomach', 5), 'cast': ('Cast_Fast', 10),
                'block': ('Block_Idle', 6)},
         angles=STD),
]


def angle_str(a, zero):
    return zero if a == 0 else '%03d' % a


def strip_shadow(im):
    """Drop the baked drop shadow: pixels that are both translucent and near-black."""
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if 0 < a < 140 and max(r, g, b) < 40:
                px[x, y] = (0, 0, 0, 0)
    return im


def load_frames(c, anim, angle):
    """Every frame of `anim` at source `angle`, in order, as RGBA images of the pack's cell size."""
    base = os.path.join(DROP, c['base'], anim)
    astr = angle_str(angle, c['zero'])
    if c['form'] == 'frames':
        d = os.path.join(base, 'Body', astr)
        names = sorted(n for n in os.listdir(d) if n.lower().endswith('.png'))
        frames = [Image.open(os.path.join(d, n)).convert('RGBA') for n in names]
        if c.get('strip_shadow'):
            frames = [strip_shadow(f) for f in frames]
        return frames
    sep = c['sep']
    path = os.path.join(base, sep.join([anim, 'Body', astr]) + '.png')
    sheet = Image.open(path).convert('RGBA')
    cell = c['cell']
    w, h = sheet.size
    cols, rows = w // cell, h // cell
    out = []
    for r in range(rows):
        for col in range(cols):
            f = sheet.crop((col * cell, r * cell, (col + 1) * cell, (r + 1) * cell))
            if alpha_bbox(f) is None:
                continue
            out.append(f)
    return out


def anim_by_dir(c, anim, cap):
    """{canonical dir: [frames]} for one anim, decimated to `cap`, with the pack's angle map applied."""
    out = {}
    n = None
    for d, angle in enumerate(c['angles']):
        frames = load_frames(c, anim, angle)
        if n is None:
            n = len(frames)
        assert len(frames) == n, '%s %s: angle %d has %d frames, expected %d' % (c['prefix'], anim, angle, len(frames), n)
        out[d] = decimate(frames, cap)
    return out


def angle_sheet(c, path):
    """The walk anim at every 45 deg source angle, rows labelled by ANGLE, so the facing can be read off."""
    anim = c['anims']['walk'][0]
    rows = [decimate(load_frames(c, anim, a), 6) for a in ANGLES8]
    cell = 160
    sheet = Image.new('RGBA', (cell * 6 + 60, cell * 8), (40, 40, 48, 255))
    draw = ImageDraw.Draw(sheet)
    for r, frames in enumerate(rows):
        draw.text((4, r * cell + 4), '%03d' % ANGLES8[r], fill=(255, 220, 120, 255))
        for fi, f in enumerate(frames):
            f2 = f.resize((cell, cell), Image.LANCZOS)
            sheet.paste(f2, (60 + fi * cell, r * cell), f2)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path)


def baked_sheet_rows(entry):
    """The baked atlas PNG cut back into {dir: [cells]}, so the final look is checked on what ships."""
    im = Image.open(os.path.join(ATLAS, entry['file'])).convert('RGBA')
    cw, ch = entry['cellW'], entry['cellH']
    return {d: [im.crop((f * cw, d * ch, (f + 1) * cw, (d + 1) * ch)) for f in range(entry['frameCount'])]
            for d in range(entry['dirCount'])}


def bake(c, preview):
    prefix = c['prefix']
    if preview:
        angle_sheet(c, os.path.join(SCRATCH, prefix + 'walk_angles.png'))
    for suffix, (src, cap) in c['anims'].items():
        name = prefix + suffix
        frames = anim_by_dir(c, src, cap)
        if preview:
            contact_sheet(frames, os.path.join(SCRATCH, name + '.png'), cell=(120, 120))
            continue
        entry = write_anim(name, frames, nearest=False, half=c['half'])
        print('  %-18s frames=%2d cell=%dx%d scale=%s painted=%d..%d' % (
            name, entry['frameCount'], entry['cellW'], entry['cellH'], entry['scale'],
            entry['painted']['top'], entry['painted']['bottom']))
        rows = baked_sheet_rows(entry)
        k = 120 / max(entry['cellW'], entry['cellH'])
        contact_sheet(rows, os.path.join(SCRATCH, 'final', name + '.png'),
                      cell=(max(1, int(entry['cellW'] * k)), max(1, int(entry['cellH'] * k))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='bake only the creature with this prefix (e.g. reaper_)')
    ap.add_argument('--preview', action='store_true', help='write contact sheets to the scratchpad, register nothing')
    args = ap.parse_args()
    for c in CREATURES:
        if args.only and c['prefix'] != args.only:
            continue
        print('==', c['prefix'], c['base'], '(preview)' if args.preview else '')
        bake(c, args.preview)
    print('contact sheets in', SCRATCH)


if __name__ == '__main__':
    main()
