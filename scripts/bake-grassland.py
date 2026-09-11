"""
BAKE THE GRASSLAND KIT (it.112).

SOURCE. `public/assets/use now/grassland_tiles.png` - a 1024x1344 sheet of
ISOMETRIC props rendered at this game's own 2:1 angle (unlike the catapult pack
next to it, which is top-down and has to be stacked). It is the only thing in
the `use now` drop that can be used as drawn.

WHY A SCRIPT AND NOT A LIST OF RECTANGLES. The sheet has no atlas description
and the pieces are not on a grid - they are laid out by eye, in ragged rows, at
whatever size each needed. Hand-measured rectangles would be forty magic numbers
that nobody could check. This finds the pieces the way the sheet actually
defines them: eight-connected runs of non-transparent pixels. Two bands of the
sheet bleed into one another and come back as one component a thousand pixels
wide; those are dropped by size, which is why `PICKS` below indexes a list of
105 and not of 108.

The order is deterministic - top band first, then left to right - so the indices
are stable for as long as the source file is. Re-run it and compare the contact
sheet it writes if that ever needs checking.

WHAT IT PRODUCES, into `public/assets/atlas/`, as `single_gl_*.png`:
  the eastern road's PORTAL and its ruined twin
  eight panels of collapsed timber building, and a ruined tower  (wreckage)
  grave crosses, headstones and two mourning statues
  stumps, boundary menhirs, rubble, fences (whole and broken), planks
  crates, wood piles, a stacked cook fire
  four bare dead trees and four grass tufts

Run:  python scripts/bake-grassland.py
"""

import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATLAS = os.path.join(ROOT, 'public', 'assets', 'atlas')
SHEET = os.path.join(ROOT, 'public', 'assets', 'use now', 'grassland_tiles.png')

#: A piece smaller than this is a stray pixel; larger, and it is two bands of
#: the sheet that have run together rather than one prop.
MIN_SIDE = 12
MAX_SIDE = 230

#: name -> index into the component list. See the module docstring.
PICKS = {
    # THE EASTERN ROAD (it.112): a stone gateway with a lit way through it.
    'gl_portal': 88,
    'gl_portal_ruin': 86,
    # WRECKAGE: what is left of the buildings that stood on this ground.
    'gl_wreck_a': 77,
    'gl_wreck_b': 78,
    'gl_wreck_c': 79,
    'gl_wreck_d': 80,
    'gl_wreck_e': 81,
    'gl_wreck_f': 84,
    'gl_wreck_g': 85,
    'gl_wreck_shed': 82,
    'gl_wreck_tower': 83,
    # WHERE THEY BURIED THE ONES THEY HAD TIME FOR.
    'gl_cross_a': 50,
    'gl_cross_b': 51,
    'gl_grave_a': 54,
    'gl_grave_b': 55,
    'gl_grave_c': 56,
    'gl_grave_d': 57,
    # THE WOOD'S EDGE, where the engines' timber came from.
    'gl_stump_a': 53,
    'gl_stump_b': 62,
    # BOUNDARY STONES.
    'gl_menhir_a': 46,
    'gl_menhir_b': 47,
    'gl_menhir_c': 48,
    'gl_menhir_d': 49,
    # RUBBLE.
    'gl_rubble_a': 52,
    'gl_rubble_b': 58,
    'gl_rubble_c': 59,
    'gl_rubble_d': 60,
    # THE CAMP'S LINES, whole and broken.
    'gl_fence_a': 16,
    'gl_fence_b': 19,
    'gl_fence_c': 20,
    'gl_fence_broke_a': 17,
    'gl_fence_broke_b': 18,
    'gl_fence_broke_c': 21,
    'gl_plank_a': 22,
    'gl_plank_b': 23,
    # WHAT THEY PACKED AND DID NOT TAKE.
    'gl_crate_a': 24,
    'gl_crate_b': 26,
    'gl_crate_c': 28,
    'gl_woodpile_a': 27,
    'gl_woodpile_b': 29,
    'gl_logfire': 14,
    # STANDING DEAD, and ground cover for the border.
    'gl_deadtree_a': 91,
    'gl_deadtree_b': 92,
    'gl_deadtree_c': 93,
    'gl_deadtree_d': 96,
    'gl_tuft_a': 32,
    'gl_tuft_b': 34,
    'gl_tuft_c': 40,
    'gl_tuft_d': 42,
}


def components(img):
    """Every prop on the sheet, as a box, top band first and left to right."""
    a = np.array(img)[:, :, 3] > 12
    h, w = a.shape
    seen = np.zeros((h, w), np.bool_)
    boxes = []
    for y in range(h):
        for x in range(w):
            if not a[y, x] or seen[y, x]:
                continue
            q = deque([(y, x)])
            seen[y, x] = True
            x0 = x1 = x
            y0 = y1 = y
            while q:
                cy, cx = q.popleft()
                if cx < x0:
                    x0 = cx
                if cx > x1:
                    x1 = cx
                if cy < y0:
                    y0 = cy
                if cy > y1:
                    y1 = cy
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and a[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
            bw = x1 - x0 + 1
            bh = y1 - y0 + 1
            if MIN_SIDE <= bw <= MAX_SIDE and MIN_SIDE <= bh <= MAX_SIDE:
                boxes.append((x0, y0, x1 + 1, y1 + 1))
    # The sheet's rows are about forty pixels apart; banding by that and then
    # sorting by x reproduces the reading order a person sees.
    boxes.sort(key=lambda b: (b[1] // 40, b[0]))
    return boxes


def contact_sheet(img, boxes, path):
    """A numbered plate of every piece, so `PICKS` can be checked by eye."""
    cell = 118
    cols = 10
    rows = (len(boxes) + cols - 1) // cols
    out = Image.new('RGBA', (cell * cols, (cell + 18) * rows), (46, 50, 44, 255))
    dr = ImageDraw.Draw(out)
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        c = img.crop((x0, y0, x1, y1))
        c.thumbnail((cell - 8, cell - 8))
        cx = (i % cols) * cell
        cy = (i // cols) * (cell + 18) + 18
        out.alpha_composite(c, (cx + (cell - c.size[0]) // 2, cy + (cell - 8 - c.size[1])))
        dr.rectangle([cx, cy - 16, cx + cell - 1, cy + cell - 1], outline=(80, 86, 78))
        dr.text((cx + 3, cy - 15), str(i), fill=(255, 240, 110))
    out.convert('RGB').save(path)


def main():
    img = Image.open(SHEET).convert('RGBA')
    boxes = components(img)
    # `python scripts/bake-grassland.py --plate out.png` writes the numbered
    # plate the indices in `PICKS` were read off. It is a diagnostic, never a
    # runtime file: nothing but what the game loads may live under public/.
    if '--plate' in sys.argv:
        contact_sheet(img, boxes, sys.argv[sys.argv.index('--plate') + 1])
    mpath = os.path.join(ATLAS, 'manifest.json')
    with open(mpath, 'r', encoding='utf-8') as f:
        man = json.load(f)
    made = 0
    for name, i in sorted(PICKS.items(), key=lambda kv: kv[1]):
        if i >= len(boxes):
            raise SystemExit('component %d of %s is past the end of a %d-piece sheet' % (i, name, len(boxes)))
        cut = img.crop(boxes[i])
        cut.save(os.path.join(ATLAS, 'single_%s.png' % name))
        man['singles'][name] = {'file': 'single_%s.png' % name, 'w': cut.size[0], 'h': cut.size[1], 'nearest': False}
        made += 1
    with open(mpath, 'w', encoding='utf-8', newline='\r\n') as f:
        f.write(json.dumps(man, indent=1, ensure_ascii=False))
    print('%d components found; %d baked' % (len(boxes), made))


if __name__ == '__main__':
    main()
