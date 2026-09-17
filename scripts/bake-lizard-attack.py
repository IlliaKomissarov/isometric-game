"""
THE ASHSCALE DUELIST'S BLOW (it.115).

`lizard_attack.png` (baked in it.36 from a pack the purge deleted) is not the
lizard at all: every row holds a purple-and-yellow wasp. The it.115 facing
audit matched the lizard's idle, frame for frame, to the graphics-update drop's
`mob8` skin 1 at 320 px, source angle 180 (the orc warrior woman - the same
model the orcess_ sheets are baked from at 180 px). So the lizard's real
attack is that skin's `Attack_01` at 320 px, and this script bakes it over the
broken sheet.

The lizard's rows are REFLECTED across the NW-SE diagonal (`DIR_ROW_FIX` in
SpriteLibrary.ts: row = (6 - d) mod 8), so file row r is written with the
canonical facing (6 - r) mod 8. Source angles per canonical facing are the
bake-b `STD` table (000 = back, turning clockwise, 180 = faces the viewer).
Half resolution, like every other lizard sheet.

    python scripts/bake-lizard-attack.py
    python scripts/calibrate-feet.py --only lizard      # re-measure its feet afterwards
"""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakelib import DROP, alpha_bbox, decimate, write_anim  # noqa: E402

BASE = os.path.join(DROP, 'mob8', '1', 'x320p_Spritesheets', 'Attack_01')
CELL = 320
STD = [90, 45, 0, 315, 270, 225, 180, 135]  # E, NE, N, NW, W, SW, S, SE
FRAMES = 12


def frames_at(angle):
    sheet = Image.open(os.path.join(BASE, 'Attack_01_Body_%03d.png' % angle)).convert('RGBA')
    w, h = sheet.size
    out = []
    for r in range(h // CELL):
        for c in range(w // CELL):
            f = sheet.crop((c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL))
            if alpha_bbox(f) is not None:
                out.append(f)
    return out


def main():
    rows = {}
    n = None
    for r in range(8):
        d = (6 - r) % 8
        fr = frames_at(STD[d])
        n = n or len(fr)
        assert len(fr) == n, 'angle %d: %d frames, expected %d' % (STD[d], len(fr), n)
        rows[r] = decimate(fr, FRAMES)
    # The painted bounds are taken on the row that faces south: file row 0.
    e = write_anim('lizard_attack', rows, half=True, painted_dir=0)
    print('lizard_attack', {k: e[k] for k in ('cellW', 'cellH', 'frameCount', 'trimX', 'trimY', 'painted')})


if __name__ == '__main__':
    main()
