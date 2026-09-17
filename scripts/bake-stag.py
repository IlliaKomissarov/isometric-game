"""
THE GILDED STAG, OUTSIDE (it.115).

Bleed's medieval tavern (credit: "Bleed - http://remusprites.carbonmade.com/",
Remus Turcuman), rotation 1 - the one view of the model whose ENTRANCE faces the
street: the stair from the porch comes down the south-west face towards the
camera, and the cellar door sits at ground level in the gable wing beside it.

The base was fitted by hand on the 622 px render (see the it.115 notes in
`src/town/TownProps.ts`, `STAG_BASE`): the gabled mass's south corner stands at
render pixel (179.5, 477) and its south-west face is 118 px across - three
tiles - so one tile is 39.3 render px and the single is baked at 32 / 39.3 of
the render (a landmark, the size of the inn it replaces). The shadow
render is laid under the body at 60 %, as for `tav_a` / `tav_b`.

    python scripts/bake-stag.py            # write single_tav_stag.png + manifest (locked writer)
    python scripts/bake-stag.py --preview  # print the numbers only
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakelib import DROP, write_single  # noqa: E402
import importlib.util  # noqa: E402

from PIL import Image  # noqa: E402

_spec = importlib.util.spec_from_file_location('bb', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bake-buildings.py'))
bb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bb)

ROT = 1
U = 118.0 / 3            # render px per tile, screen dx: the gabled face is three tiles
SCALE = 32.0 / U
G = (179.5, 477.0)       # render px of the gabled mass's south corner (the fit's world origin)


def main():
    body = Image.open(os.path.join(DROP, 'tavern', 'medieval-tavern_%d0000.png' % ROT)).convert('RGBA')
    shadow = Image.open(os.path.join(DROP, 'tavern', '_shadow', 'shadow_medieval-tavern_%d0000.png' % ROT)).convert('RGBA')
    both = bb.composite_shadow(bb.np_bleed(body, 3), shadow, 0.6)
    both, (ox, oy) = bb.crop_alpha(both)
    im = bb.scale_rgba(both, SCALE)
    ax = (G[0] - ox) * SCALE / im.size[0]
    ay = (G[1] - oy) * SCALE / im.size[1]
    print('tav_stag %dx%d  crop (%d, %d)  scale %.4f  anchor (%.4f, %.4f)' % (im.size[0], im.size[1], ox, oy, SCALE, ax, ay))
    if '--preview' not in sys.argv:
        write_single('tav_stag', im)
        print('written')


if __name__ == '__main__':
    main()
