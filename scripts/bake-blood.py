"""
BAKE THE BLOOD (it.111).

it.110 laid the pack's `blood_*` singles on the battlefield: 100-pixel animation
frames of bright red dots, which read as bright red dots. it.110b cut pools out
of the `bloody-wall` photographs instead, which was the right source and the
wrong extraction - the alpha ramp kept every pale, desaturated pixel of the wall
plaster along with the blood, so the field came out covered in PINK SMOKE with a
red bruise in the middle of each patch.

WHAT BLOOD LOOKS LIKE ON EARTH. It is dark - nearly black at the centre of a
pool, going brown-red at the rim where it has dried and soaked in. It is not
pink and it is not translucent. So:

  1. The alpha is taken from how far a pixel's RED runs ahead of its other two
     channels, with a hard floor: plaster, dust and pale spatter all have red
     within a few points of green and blue, and they are simply not blood.
  2. The COLOUR is thrown away and replaced. Whatever the photograph's lighting
     was, the pool is re-shaded from its own thickness: opaque middles go to the
     near-black `DEEP`, thin edges to the browner `THIN`.
  3. It is squashed to the ground plane (2:1) so it lies in the world instead of
     standing up in it.

WHAT IT PRODUCES, into `public/assets/atlas/`:

  single_gore_a..f.png     pools, of falling size - `f` is a smear rather than
                           a pool, for the edges of the press.
  single_spatter_a..c.png  fine thrown spatter, from the Ancient Isometric
                           Tileset's own `overlay/` splats, which are already
                           drawn in projection and already lie flat.

Run:  python scripts/bake-blood.py
"""

import io
import json
import math
import os

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'public', 'assets', 'test-models')
WALLS = os.path.join(RAW, 'bloody-wall')
OVERLAY = os.path.join(
    RAW, '3rd town part', 'new', 'Isometric tileset', 'tile_images', 'overlay')
ATLAS = os.path.join(ROOT, 'public', 'assets', 'atlas')

#: The middle of a pool, and its dried rim.
DEEP = (44, 9, 9)
THIN = (86, 32, 22)
#: How far ahead of the other channels red has to run before a pixel is blood.
RED_FLOOR = 26
#: ...and how far ahead it has to be to count as a FULL-strength pixel.
RED_FULL = 84

#: Which wall photograph each pool is cut from, the window taken out of it, and
#: how big the finished pool is on the ground.
POOLS = [
    ('a', '3.png', (120, 60, 520, 330), 168),
    ('b', '4.png', (150, 70, 560, 340), 172),
    ('c', '7.png', (110, 90, 500, 350), 150),
    ('d', '8.png', (170, 60, 540, 320), 138),
    ('e', '15.png', (140, 40, 520, 300), 120),
    ('f', '13.png', (200, 120, 470, 280), 104),
]


def cut_pool(path, box, width):
    """Alpha from the red excess; colour thrown away and re-shaded from it."""
    src = Image.open(path).convert('RGB').crop(box)
    w, h = src.size
    px = src.load()
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    opx = out.load()
    cx, cy = w / 2, h / 2
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            excess = r - max(g, b)
            if excess <= RED_FLOOR:
                continue
            k = min(1.0, (excess - RED_FLOOR) / (RED_FULL - RED_FLOOR))
            # An elliptical falloff, so a rectangular crop out of a wall lands
            # on the ground as a POOL and not as a stained postage stamp - but
            # only just: at a tight ellipse every pool comes out the same oval,
            # and the shape wants to be the blood's own. This clips the corners
            # and leaves the middle alone.
            u = (x - cx) / cx
            v = (y - cy) / cy
            fall = max(0.0, min(1.0, 1.06 - math.hypot(u, v)))
            a = k * (fall ** 0.5)
            if a <= 0.02:
                continue
            # Thick in the middle, dried at the rim.
            t = a ** 0.7
            opx[x, y] = (
                int(THIN[0] + (DEEP[0] - THIN[0]) * t),
                int(THIN[1] + (DEEP[1] - THIN[1]) * t),
                int(THIN[2] + (DEEP[2] - THIN[2]) * t),
                int(255 * min(1.0, a * 1.5)),
            )
    out = out.filter(ImageFilter.GaussianBlur(1.2))
    # Onto the ground plane: 2:1, the projection everything else is drawn in.
    height = max(8, round(width / 2))
    return out.resize((width, height), Image.LANCZOS)


def cut_spatter(path, width):
    """The tileset's own splats: already in projection, only re-coloured."""
    src = Image.open(path).convert('RGBA')
    w, h = src.size
    px = src.load()
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    opx = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            lum = (r + g + b) / 765.0
            t = 1.0 - lum
            opx[x, y] = (
                int(THIN[0] + (DEEP[0] - THIN[0]) * t),
                int(THIN[1] + (DEEP[1] - THIN[1]) * t),
                int(THIN[2] + (DEEP[2] - THIN[2]) * t),
                int(min(255, a * 1.35)),
            )
    scale = width / w
    return out.resize((width, max(4, round(h * scale * 0.72))), Image.LANCZOS)


def main():
    made = {}
    for name, f, box, width in POOLS:
        src = os.path.join(WALLS, f)
        if not os.path.exists(src):
            raise SystemExit('missing blood source: ' + src)
        img = cut_pool(src, box, width)
        img.save(os.path.join(ATLAS, f'single_gore_{name}.png'))
        made[f'gore_{name}'] = {'file': f'single_gore_{name}.png', 'w': img.width, 'h': img.height, 'nearest': False}
        print(f'  gore_{name} {img.size} <- {f}')

    for name, f, width in (('a', 'bloodsplat.png', 46), ('b', 'splat1.png', 40), ('c', 'base_splatter1.png', 52)):
        src = os.path.join(OVERLAY, f)
        if not os.path.exists(src):
            raise SystemExit('missing splat source: ' + src)
        img = cut_spatter(src, width)
        img.save(os.path.join(ATLAS, f'single_spatter_{name}.png'))
        made[f'spatter_{name}'] = {'file': f'single_spatter_{name}.png', 'w': img.width, 'h': img.height, 'nearest': False}
        print(f'  spatter_{name} {img.size} <- {f}')

    mpath = os.path.join(ATLAS, 'manifest.json')
    manifest = json.load(open(mpath, encoding='utf-8'))
    manifest['singles'].update(made)
    with io.open(mpath, 'w', encoding='utf-8', newline='\r\n') as fh:
        fh.write(json.dumps(manifest, indent=1, ensure_ascii=False))
    print(f'manifest: {len(made)} blood singles written, {len(manifest["singles"])} total')


if __name__ == '__main__':
    main()
