"""
BAKE THE RIVER BRIDGE (it.111).

it.110 built the span out of a plank and a fence. it.110b rebuilt it out of the
Ancient Isometric Tileset's raised paving and its white balustrade, and it STILL
read as a ladder lying flat on the water, for three reasons that are all the same
reason: the roadway sat ON the surface with nothing under it, the parapet was a
PALE piece on a DARK deck laid one per tile with a gap at every joint, and the
two ends did not meet the arches.

A STONE BRIDGE IS A ROW OF PIERS WITH A ROAD ON TOP. This bakes it that way, out
of the pack's own pieces, composited HERE against the exact isometric geometry
the game draws with - so alignment is a property of the bake, not a set of magic
offsets scattered through the renderer.

WHAT IT PRODUCES, into `public/assets/atlas/`:

  single_span_bay.png     ONE BAY OF ROADWAY: the raised paving, a band of stone
                          under it so the road has an underside over the water,
                          and both parapets - already lapped, so a run of them is
                          one continuous road with one continuous rail each side.
  single_span_bay2.png    the same bay, patched and worn, for variety down the run.
  single_span_pier.png    WHAT HOLDS IT UP: the pack's 128-cube with a segmental
                          arch cut through the face that points at the camera,
                          which is the only face of a bridge pier anyone can see.
                          One every third bay, drawn behind the roadway, so the
                          span stands on arches with open water between them
                          instead of being a wall with holes in it.
  single_span_abut.png    the abutment: a solid cube where the road leaves the
                          bank, so the span does not begin in mid-air.
  single_span_post.png    the corner post that closes each parapet run.

THE GEOMETRY, ONCE.

The pack draws one cell on a 256-wide canvas whose ground diamond sits at the
BOTTOM of it, corners W(0, h-64) N(128, h-128) E(256, h-64) S(128, h). The game
draws one tile as a 64x32 sprite placed at `worldToScreen(x, y) - (32, 0)`, whose
diamond has corners left(0,16) top(32,0) right(64,16) bottom(32,32). So

    game_x = pack_x * 0.25          game_y = pack_y * 0.25 - (canvas_h * 0.25 - 32)

and every piece lands on the tile it was drawn for with nothing to fit by hand.
The 128-cubes are 256x256 canvases: 64 game pixels tall, which is why the deck
rides exactly `LIFT = 64 - TILE_H = 32` pixels above the water.

WHICH EDGE IS WHICH. The span runs along +x at constant y, and +x is (+32, +16)
on screen. So the two edges parallel to the road are top->right (the FAR side,
away from the camera - the pack's `wall_e`) and left->bottom (the NEAR side -
its `wall_n`). Those are the two parapets. The remaining two edges are the ends
of the bay and are covered by its neighbours.

Run:  python scripts/bake-bridge.py
      BRIDGE_PREVIEW_DIR=<dir> python scripts/bake-bridge.py   # preview elsewhere
"""

import io
import json
import math
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILES = os.path.join(
    ROOT, 'public', 'assets', 'test-models', '3rd town part', 'new',
    'Isometric tileset', 'tile_images')
ATLAS = os.path.join(ROOT, 'public', 'assets', 'atlas')
PREVIEW_DIR = os.environ.get('BRIDGE_PREVIEW_DIR', ATLAS)

TILE_W, TILE_H = 64, 32
PACK_SCALE = 0.25
#: The pier is one pack cube tall, so the roadway rides this far over the water.
LIFT = 32
#: The stone under the roadway: what gives the road an underside over the water.
FASCIA = 8

#: The bay canvas, and where the tile's own 64x32 sprite box sits inside it.
BAY_W, BAY_H = 72, 96
ORIGIN_X, ORIGIN_Y = 4, 58
#: The pier canvas, and the same offsets for it.
PIER_W, PIER_H = 104, 108
PIER_OX, PIER_OY = 20, 62
#: How much wider than the roadway a pier stands. A pier the exact width of the
#: deck is INVISIBLE: the deck's own fascia and the next bay's leading edge cover
#: every pixel of it, which is why it.111's first span looked like a wall with
#: notches. A real pier is thicker than the road it carries, and it has to be
#: drawn thicker here or the arches never see daylight.
PIER_FLARE = 1.34


def load(rel):
    p = os.path.join(TILES, rel)
    if not os.path.exists(p):
        raise SystemExit('missing tileset piece: ' + p)
    return Image.open(p).convert('RGBA')


def to_tile(img):
    """A whole pack cell scaled into game space, with the y offset that lands
    its ground diamond on the tile's own diamond."""
    w, h = img.size
    out = img.resize((max(1, round(w * PACK_SCALE)), max(1, round(h * PACK_SCALE))), Image.LANCZOS)
    return out, -(h * PACK_SCALE - TILE_H)


def diamond_mask(w=TILE_W, h=TILE_H, ss=4):
    """The tile's own mask, taken from the projection - the rule bake-water uses.
    A pixel belongs to the tile its centre unprojects into, which partitions the
    plane exactly, so a run of these leaves no hairline at any joint."""
    big = Image.new('L', (w * ss, h * ss), 0)
    px = big.load()
    for y in range(h * ss):
        for x in range(w * ss):
            sx = (x + 0.5) / ss - w / 2
            sy = (y + 0.5) / ss
            a = sx / (w / 2)
            b = sy / (h / 2)
            if math.floor((a + b) / 2) == 0 and math.floor((b - a) / 2) == 0:
                px[x, y] = 255
    return big.resize((w, h), Image.LANCZOS)


def tint(img, mul):
    r, g, b, a = img.split()
    def f(c, k):
        return c.point(lambda v: max(0, min(255, int(v * k))))
    return Image.merge('RGBA', (f(r, mul[0]), f(g, mul[1]), f(b, mul[2]), a))


def paste(dst, src, x, y):
    dst.alpha_composite(src, (int(round(x)), int(round(y))))


# ---------------------------------------------------------------------------
def roadway(worn=False):
    """The deck's top surface: the pack's raised paving, clipped to the tile.

    `raised.png` is a 256x152 canvas with the paving diamond at the TOP of it -
    it is a surface, not a cell - so it is cropped and scaled directly rather
    than run through `to_tile`."""
    slab = load('pavement/raised.png').crop((0, 0, 256, 128)).resize((TILE_W, TILE_H), Image.LANCZOS)
    if worn:
        patch = load('ground/cobble_path/cobble7.png').resize((TILE_W, TILE_H), Image.LANCZOS)
        slab = Image.blend(slab, patch, 0.40)
    slab.putalpha(diamond_mask())
    # Brighter than the piers below it: a road is walked on and the rain washes it.
    return tint(slab, (1.62, 1.58, 1.46))


def parapet(side):
    """One run of low stone wall along an edge the road runs down.

    The half-height wall, not the pack's bannister: a balustrade of pale turned
    balusters against a dark deck is precisely what read as ladder rungs, and
    the parapet of a road bridge is a wall with a coping you can see."""
    src = load('half_wall/half_height/wall_e.png' if side == 'far' else 'half_wall/half_height/wall_n.png')
    img, dy = to_tile(src)
    return tint(img, (1.20, 1.18, 1.12)), dy


def fascia(deck):
    """
    THE ROAD'S UNDERSIDE. A deck drawn as a flat diamond has no thickness, and
    thirty-two pixels above the water that reads as a sheet of paper laid on the
    river. This extrudes the deck's lower silhouette straight down and shades the
    two faces apart, which is the whole of how an isometric solid reads as solid.

    The band is filled from the pack's own wall texture rather than by smearing
    the deck's edge pixel downward - a smear draws a vertical stripe per column,
    and eleven pixels of that is a comb.
    """
    stone = load('castle/wall_n.png').crop((0, 277, 152, 512)).resize((TILE_W, FASCIA * 3), Image.LANCZOS)
    band = Image.new('RGBA', (TILE_W, TILE_H + FASCIA), (0, 0, 0, 0))
    px = band.load()
    spx = stone.load()
    for x in range(TILE_W):
        bottom = -1
        for y in range(TILE_H - 1, -1, -1):
            if deck.getpixel((x, y))[3] > 40:
                bottom = y
                break
        if bottom < 0:
            continue
        # Left face darker than the right, and both darker toward the water.
        k0 = 0.40 if x < TILE_W / 2 else 0.56
        for d in range(1, FASCIA + 1):
            r, g, b, _ = spx[x, (d * 2) % stone.height]
            f = k0 * (1.0 - 0.34 * (d / FASCIA))
            px[x, bottom + d] = (int(r * f), int(g * f), int(b * f), 255)
    return band


def bake_bay(worn, out_path):
    canvas = Image.new('RGBA', (BAY_W, BAY_H), (0, 0, 0, 0))
    far, fdy = parapet('far')
    near, ndy = parapet('near')
    deck = roadway(worn)
    top = ORIGIN_Y - LIFT

    paste(canvas, far, ORIGIN_X, top + fdy)
    paste(canvas, fascia(deck), ORIGIN_X, top)
    paste(canvas, deck, ORIGIN_X, top)
    paste(canvas, near, ORIGIN_X, top + ndy)
    canvas.save(out_path)
    return canvas


def bake_pier(kind, out_path):
    """
    The cube the roadway stands on: `arch` has the opening cut through the face
    that points at the camera, `solid` is the same block whole.

    It is scaled up by `PIER_FLARE` about the centre of its TOP face, so the top
    still meets the underside of the deck exactly while the body flares out below
    and to either side - which is both what a pier does and the only way the arch
    is visible under a road one tile wide.
    """
    src = load('arch/small/128x128 arch.png' if kind == 'arch' else 'arch/small/128x128 arch 4.png')
    img, _ = to_tile(src)
    s = PIER_FLARE
    big = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    # In the unscaled cube the top face's centre sits at (w/2, TILE_H/2); scaling
    # keeps it proportionally in the same place.
    top_cx, top_cy = big.width / 2, (TILE_H / 2) * s
    # Where that centre has to land: the tile's own centre, raised by the lift.
    want_x, want_y = TILE_W / 2, TILE_H / 2 - LIFT
    canvas = Image.new('RGBA', (PIER_W, PIER_H), (0, 0, 0, 0))
    paste(canvas, tint(big, (0.60, 0.62, 0.62)), PIER_OX + want_x - top_cx, PIER_OY + want_y - top_cy)
    canvas.save(out_path)
    return canvas


#: The gate canvas origin, filled in by `bake_gate` and printed for the renderer.
GATE_ORIGIN = [0, 0]
#: How much bigger than one pack cell the gate arch is built.
GATE_SCALE = 1.7


def bake_gate(out_path):
    """
    THE GATE OVER THE ROAD, WHOLE (it.111).

    The pack ships its great arch as TWO HALVES on one canvas - `wall_s` is one
    leg and the curve springing from it, `wall_s2` the other leg and its own
    springing - drawn to be laid on ADJACENT cells. it.110b baked one half by
    itself, which is why both ends of the span carried what looked like a broken
    flying buttress rather than a gate.

    The `s` run is the one that crosses a road running along +x, so the two
    halves go one tile apart in -y and the hero walks UNDER the opening rather
    than past the side of it.
    """
    a, ady = to_tile(load('arch/big/wall_s.png'))
    b, bdy = to_tile(load('arch/big/wall_s2.png'))
    # A GATE IS BIGGER THAN A DOOR. At the pack's own tile scale the arch stands
    # 79 pixels: lower than the knights posted under it, which reads as a garden
    # folly. It is built up about the point where its feet meet the ground, so
    # the opening clears a man and the whole thing is the landmark the crossing
    # is supposed to be found by.
    a = a.resize((round(a.width * GATE_SCALE), round(a.height * GATE_SCALE)), Image.LANCZOS)
    b = b.resize((round(b.width * GATE_SCALE), round(b.height * GATE_SCALE)), Image.LANCZOS)
    ady = TILE_H - (TILE_H - ady) * GATE_SCALE
    bdy = TILE_H - (TILE_H - bdy) * GATE_SCALE
    # A canvas big enough for both, with tile (0,0)'s sprite box at (PAD, PAD).
    PAD = 120
    canvas = Image.new('RGBA', (PAD * 2 + TILE_W, PAD * 2 + TILE_H), (0, 0, 0, 0))
    # tile (0,-1) is (+32, -16) from tile (0,0) on screen.
    paste(canvas, tint(b, (0.94, 0.94, 0.93)), PAD + 32 * GATE_SCALE, PAD - 16 * GATE_SCALE + bdy)
    paste(canvas, tint(a, (1.06, 1.05, 1.02)), PAD, PAD + ady)
    bb = canvas.getbbox()
    out = canvas.crop(bb)
    # Where the tile's own sprite box now sits inside the cropped piece: this is
    # what the renderer subtracts, so the arch always lands over its own tile.
    GATE_ORIGIN[0] = PAD - bb[0]
    GATE_ORIGIN[1] = PAD - bb[1]
    out.save(out_path)
    return out


def bake_post(out_path):
    """The corner post that closes a parapet run, so a rail never stops in air."""
    src = load('half_wall/half_height/corner_n.png')
    img, _ = to_tile(src)
    img = tint(img, (1.20, 1.18, 1.12))
    bb = img.getbbox()
    out = img.crop(bb)
    out.save(out_path)
    return out


# ---------------------------------------------------------------------------
def preview(bay, bay2, pier, abut, post, gate):
    """Assemble a span over water exactly the way the renderer will - piers
    first, then the roadway over them. Looking at this is far cheaper than
    looking at the game, and it is the same arithmetic."""
    span = 11
    W, H = 1200, 520
    out = Image.new('RGBA', (W, H), (14, 20, 24, 255))
    wpath = os.path.join(ATLAS, 'single_water_p3_4.png')
    water = Image.open(wpath).convert('RGBA') if os.path.exists(wpath) else None
    ox, oy = 220, 150

    def s(x, y):
        return (ox + (x - y) * 32, oy + (x + y) * 16)

    if water:
        for y in range(-4, 9):
            for x in range(-3, 17):
                sx, sy = s(x, y)
                out.alpha_composite(water, (sx - 32, sy))
    for i in range(-1, span + 1):
        sx, sy = s(i, 0)
        if i in (-1, span):
            out.alpha_composite(abut, (sx - TILE_W // 2 - PIER_OX, sy - PIER_OY))
        elif i % 3 == 1:
            out.alpha_composite(pier, (sx - TILE_W // 2 - PIER_OX, sy - PIER_OY))
    for i in range(-1, span + 1):
        sx, sy = s(i, 0)
        img = bay2 if i % 4 == 2 else bay
        out.alpha_composite(img, (sx - TILE_W // 2 - ORIGIN_X, sy - ORIGIN_Y))
    for i in (-1, span):
        sx, sy = s(i, 0)
        out.alpha_composite(post, (sx - TILE_W // 2, sy - ORIGIN_Y + 12))
    for i in (-2, span + 1):
        sx, sy = s(i, 0)
        out.alpha_composite(gate, (sx - TILE_W // 2 - GATE_ORIGIN[0], sy - GATE_ORIGIN[1]))
    out.convert('RGB').save(os.path.join(PREVIEW_DIR, 'bridge_preview.png'))


def main():
    made = {}

    def reg(name, img):
        made[name] = {'file': f'single_{name}.png', 'w': img.width, 'h': img.height, 'nearest': False}

    bay = bake_bay(False, os.path.join(ATLAS, 'single_span_bay.png'))
    bay2 = bake_bay(True, os.path.join(ATLAS, 'single_span_bay2.png'))
    pier = bake_pier('arch', os.path.join(ATLAS, 'single_span_pier.png'))
    abut = bake_pier('solid', os.path.join(ATLAS, 'single_span_abut.png'))
    post = bake_post(os.path.join(ATLAS, 'single_span_post.png'))
    gate = bake_gate(os.path.join(ATLAS, 'single_span_gate.png'))
    for n, im in (('span_bay', bay), ('span_bay2', bay2), ('span_pier', pier),
                  ('span_abut', abut), ('span_post', post), ('span_gate', gate)):
        reg(n, im)
    print('  bay', bay.size, 'pier', pier.size, 'abut', abut.size, 'post', post.size)
    print('  gate', gate.size, 'origin', GATE_ORIGIN)

    preview(bay, bay2, pier, abut, post, gate)

    mpath = os.path.join(ATLAS, 'manifest.json')
    manifest = json.load(open(mpath, encoding='utf-8'))
    # The it.110b kit is superseded whole. Left in the manifest its entries are
    # not harmless: the loader fetches EVERY single at boot and one 404 fails the
    # whole atlas, so the game silently falls back to procedural art.
    for old in ('span_deck', 'span_deck2', 'span_rail_n', 'span_rail_s',
                'span_block', 'span_gate_e', 'span_arch'):
        manifest['singles'].pop(old, None)
        f = os.path.join(ATLAS, f'single_{old}.png')
        if os.path.exists(f):
            os.remove(f)
    manifest['singles'].update(made)
    # The manifest's OWN shape: one-space indent and CRLF, because that is what
    # is on disk - get either wrong and a four-line addition lands as a reformat.
    with io.open(mpath, 'w', encoding='utf-8', newline='\r\n') as fh:
        fh.write(json.dumps(manifest, indent=1, ensure_ascii=False))
    print(f'manifest: {len(made)} bridge singles written, {len(manifest["singles"])} total')


if __name__ == '__main__':
    main()
