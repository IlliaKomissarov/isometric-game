"""
BAKE THE SIEGE ENGINES (it.112).

SOURCE. `public/assets/use now/catapulte/` - Remus Turcuman's "Medieval
Catapult" (free tier: one animation of four). It is a 3D model rendered to
sprites, eight facings x thirty-one frames, plus a matching shadow pass.

THE PROBLEM. Those renders are ORTHOGRAPHIC TOP-DOWN - the camera is directly
above the machine - and this game is 2:1 dimetric with the camera at thirty
degrees. Dropped in as they are, the engines read as floor plans: all deck, no
elevation, no side of anything. There is no Blender in this environment, so the
model cannot simply be re-rendered at our angle.

WHAT THIS DOES INSTEAD - SPRITE STACKING.

  Our projection is  M = diag(32*sqrt2, 16*sqrt2) . R(45 degrees)

  which is exactly "rotate the ground plan by 45 degrees, then squash it to
  2:1". The pack already supplies the plan pre-rotated in 45-degree steps, so
  ONE of its eight facings IS our 45 degrees for any facing we want: squashing
  frame D vertically by a half yields a geometrically correct isometric view of
  the machine turned to a particular world direction. The projection is right;
  only the HEIGHT is missing.

  The height is put back by stacking: the squashed plan is composited N times,
  each copy one step further up the screen and a little brighter than the one
  below. Every column of the plan becomes a prism of its own height, so the
  wheels come out as cylinders, the uprights as posts and the bed as a slab -
  which is what they are. It is the standard trick for turning top-down art
  into 2.5D, and on a machine that is mostly straight timber it is convincing.

WHAT IT PRODUCES, into `public/assets/atlas/`:
  siege_engine.png        8 rows (canonical direction) x 3 frames: cocked,
                          recoiling, settling
  siege_wreck.png         8 rows x 1: the same engine collapsed and burnt
  single_siege_arm.png    the throwing arm, drawn along +x with its pivot at
                          the left end, so `TownProps` can swing it
  single_siege_sling.png  the sling cup on the end of it
  single_siege_stone.png  the shot

DIRECTIONS. The pack turns CLOCKWISE on screen from "pointing up the plan";
the game's canonical order [E, NE, N, NW, W, SW, S, SE] turns anticlockwise
from East. So canonical d takes pack frame (2 - d) mod 8 - written out in
`PACK_FOR_DIR` so it can be corrected in one place if the arm ever points the
wrong way down the field.

ATTRIBUTION. The licence requires it, and `index.html`'s credits carry it:
  "Bleed - http://remusprites.carbonmade.com/", (c) 2017 Remos Turcuman.

Run:  python scripts/bake-catapult.py
"""

import json
import math
import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATLAS = os.path.join(ROOT, 'public', 'assets', 'atlas')
PACK = os.path.join(ROOT, 'public', 'assets', 'use now', 'catapulte', '_moving')
WOOD = os.path.join(ROOT, 'public', 'assets', 'use now', 'catapult', 'catapult_uv.jpg')

#: Our ground plane is drawn 2:1, so a plan squashes to half its height.
#: The manifest's own line ending, as `scripts/bake-trader.py` writes it - so
#: re-running any bake does not flip it and churn the whole file.
CRLF = '\r\n'

SQUASH = 0.5
#: How far the machine rises on screen, in SOURCE pixels, before the final
#: downscale. The catapult is about two thirds as tall as it is long; a full
#: two thirds reads as a tower, and this is the height that reads as a machine.
RISE = 44
#: One composite per screen pixel of rise: any coarser and the prisms band.
LAYERS = RISE
#: Source -> atlas. The engine stands on a 2x2 footprint (128 px of diamond).
OUT_SCALE = 0.52
#: Canonical direction d is drawn from this pack frame.
PACK_FOR_DIR = [(2 - d) % 8 for d in range(8)]
#: The three frames: at rest, thrown, coming back to rest.
RECOIL = [0, 12, 22]


def src_frame(pack_dir, frame):
    return Image.open(os.path.join(PACK, 'catapult_move_%d%04d.png' % (pack_dir, frame))).convert('RGBA')


def union_box():
    """
    ONE CROP FOR EVERY FACING.

    The renders are not centred the same way in their frames - the machine's
    painted box wanders by a dozen pixels between facings - so cropping each to
    its own content would put the eight engines' ground centres in eight
    different places inside their cells, and every one of them would stand
    slightly off its own tile. Every plan is cropped to the UNION box instead,
    which makes the crop's centre the machine's centre for all of them, and the
    anchor below a single number.
    """
    x0 = y0 = 10 ** 6
    x1 = y1 = -1
    for d in range(8):
        for f in set(RECOIL + [(d * 3) % 31]):
            a = src_frame(d, f).getchannel('A')
            bb = a.getbbox()
            if not bb:
                continue
            x0 = min(x0, bb[0]); y0 = min(y0, bb[1]); x1 = max(x1, bb[2]); y1 = max(y1, bb[3])
    # Square it about its own centre so a facing never crops its own wheels.
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    half = max(x1 - x0, y1 - y0) / 2 + 4
    return (int(cx - half), int(cy - half), int(cx + half), int(cy + half))


BOX = None


def plan(pack_dir, frame):
    global BOX
    if BOX is None:
        BOX = union_box()
    return src_frame(pack_dir, frame).crop(BOX)


def height_map(sq):
    """
    How tall each column of the plan is, 0..1, READ OFF ITS OWN COLOUR.

    A uniform extrusion gives every column the same height, and on this machine
    that is wrong in the one way you notice: the four WHEELS come up as tall as
    the frame, so the engine reads as a rack of barrels instead of as a cart
    with a frame on it. There is no height channel in a diffuse render - but on
    this model there does not need to be one, because the tall parts are TIMBER
    and the low parts are IRON. Warm, saturated pixels are wood and get the full
    rise; grey and near-black pixels are wheels, tyres, axles and fittings and
    get a third of it.
    """
    a = np.asarray(sq).astype(np.float32)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / np.maximum(1.0, mx)
    warm = (r - b) / 255.0
    wood = np.clip((sat - 0.14) / 0.20, 0, 1) * np.clip((warm - 0.02) / 0.16, 0, 1)
    lit = np.clip((mx - 40.0) / 90.0, 0, 1)
    raw = np.clip(wood * (0.4 + 0.6 * lit), 0, 1)
    # PART BY PART, NOT PIXEL BY PIXEL. Wood grain is high-frequency: used raw,
    # every light streak in a plank became a spike of its own and the machine
    # came out as a bed of nails. Blurring the mask hard and then cutting it in
    # two gives what is actually wanted - the TIMBER stands at full height, the
    # IRON (wheels, tyres, axles, fittings) at a third of it.
    m = Image.fromarray((raw * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))
    sm = np.asarray(m).astype(np.float32) / 255.0
    return np.where(sm > 0.30, 1.0, 0.36)


def stack(plan, rise=RISE, layers=LAYERS, dark=0.52, tint=(1.0, 1.0, 1.0)):
    """
    Extrude a squashed top-down plan upward into a 2.5D body.

    Every layer carries the plan's own alpha masked by `height_map`, so each
    column stops at its own height; the brightness ramp from `dark` at the
    ground to full at the top is what makes the extrusion read as lit sides
    rather than as a smear. The lowest layer sits at the sprite's foot, which is
    where the machine touches the ground.
    """
    w, h = plan.size
    sq = plan.resize((w, max(1, int(round(h * SQUASH)))), Image.LANCZOS)
    sw, sh = sq.size
    base = np.asarray(sq).astype(np.float32)
    alpha = base[:, :, 3]
    hm = height_map(sq) * layers
    out = Image.new('RGBA', (sw, sh + rise + 2), (0, 0, 0, 0))
    for i in range(layers):
        f = i / max(1, layers - 1)
        k = dark + (1 - dark) * (f ** 0.8)
        lay = base.copy()
        lay[:, :, 0] *= k * tint[0]
        lay[:, :, 1] *= k * tint[1]
        lay[:, :, 2] *= k * tint[2]
        lay[:, :, 3] = np.where(hm >= i, alpha, 0.0)
        img = Image.fromarray(np.clip(lay, 0, 255).astype(np.uint8), 'RGBA')
        out.alpha_composite(img, (0, rise - int(round(i * rise / max(1, layers - 1)))))
    return out


def ground_shadow(size, plan):
    """A soft pool under the machine, from the plan's own footprint."""
    w, h = size
    a = plan.getchannel('A').resize((w, max(1, int(round(plan.size[1] * SQUASH)))), Image.LANCZOS)
    sh = Image.new('RGBA', size, (0, 0, 0, 0))
    mask = Image.new('L', size, 0)
    mask.paste(a.point(lambda v: int(v * 0.42)), (0, size[1] - a.size[1] - 1))
    sh.putalpha(mask.filter(ImageFilter.GaussianBlur(3)))
    return sh


def build_engine():
    """The working engine: eight directions, three frames of recoil."""
    cells = {}
    cw = ch = 0
    for d in range(8):
        for fi, f in enumerate(RECOIL):
            p = plan(PACK_FOR_DIR[d], f)
            body = stack(p)
            sh = ground_shadow(body.size, p)
            sh.alpha_composite(body)
            img = sh.resize((int(body.size[0] * OUT_SCALE), int(body.size[1] * OUT_SCALE)), Image.LANCZOS)
            cells[(d, fi)] = img
            cw = max(cw, img.size[0])
            ch = max(ch, img.size[1])
    sheet = Image.new('RGBA', (cw * len(RECOIL), ch * 8), (0, 0, 0, 0))
    for (d, fi), img in cells.items():
        sheet.paste(img, (fi * cw, d * ch), img)
    sheet.save(os.path.join(ATLAS, 'siege_engine.png'))
    # Where the machine's GROUND CENTRE sits inside the cell: the crop's own
    # centre, which the union box made the same for every facing.
    rise = int(round(RISE * OUT_SCALE))
    plan_h = ch - rise - 1
    return cw, ch, cw / 2, rise + plan_h / 2


def build_wreck():
    """
    The same machine, down.

    A wreck is not a catapult rotated - it is a catapult that has stopped being
    one. The plan is extruded to a third of its height (the frame has come apart
    and what is left is lying on the ground), burnt through, and sheared a
    little so it does not sit square on its own footprint.
    """
    cells = {}
    cw = ch = 0
    for d in range(8):
        p = plan(PACK_FOR_DIR[d], (d * 3) % 31)
        body = stack(p, rise=int(RISE * 0.30), layers=int(RISE * 0.30), dark=0.40, tint=(0.74, 0.68, 0.62))
        w, h = body.size
        # A lean: the bed has gone out from under one side of it.
        shear = 0.10 if d % 2 == 0 else -0.10
        body = body.transform((w, h), Image.AFFINE, (1, shear, -shear * h * 0.5, 0, 1, 0), Image.BICUBIC)
        sh = ground_shadow(body.size, p)
        sh.alpha_composite(body)
        img = sh.resize((int(w * OUT_SCALE), int(h * OUT_SCALE)), Image.LANCZOS)
        cells[d] = img
        cw = max(cw, img.size[0])
        ch = max(ch, img.size[1])
    sheet = Image.new('RGBA', (cw, ch * 8), (0, 0, 0, 0))
    for d, img in cells.items():
        sheet.paste(img, (0, d * ch), img)
    sheet.save(os.path.join(ATLAS, 'siege_wreck.png'))
    rise = int(round(RISE * 0.30 * OUT_SCALE))
    plan_h = ch - rise - 1
    return cw, ch, cw / 2, rise + plan_h / 2


def build_arm():
    """
    THE THROWING ARM, and what is on the end of it.

    The pack's plan shows the machine COCKED - its arm is raised and pointing
    away from the camera, so in a top-down render it is foreshortened to almost
    nothing and the stack has essentially no arm in it. That is the useful
    accident: the arm can be a separate piece, pivoted and swung by the dresser,
    which is the only way a stack of flat layers can move at all.

    It is drawn along +x with the PIVOT AT THE LEFT EDGE and cut out of the
    model's own plank texture, so it is the same timber as the machine.
    """
    L, T = 132, 20
    wood = Image.open(WOOD).convert('RGB').resize((L * 2, T * 6), Image.LANCZOS)
    beam = Image.new('RGBA', (L, T), (0, 0, 0, 0))
    bp = beam.load()
    wp = wood.load()
    for x in range(L):
        # Tapered: heavy at the pivot, light at the sling.
        half = (T * 0.5) * (1.0 - 0.42 * (x / L))
        for y in range(T):
            dy = y - T / 2
            if abs(dy) > half:
                continue
            r, g, b = wp[(x * 2) % wood.size[0], (y * 3 + 7) % wood.size[1]]
            # Round it: the top edge catches the light, the bottom is in shade.
            k = 0.58 + 0.62 * (1.0 - abs(dy) / max(0.5, half)) ** 0.7 - 0.3 * max(0.0, dy) / max(0.5, half)
            bp[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), 255)
    beam.save(os.path.join(ATLAS, 'single_siege_arm.png'))

    # The sling cup: a leather bowl on the end of the beam.
    S = 26
    cup = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    cp = cup.load()
    for y in range(S):
        for x in range(S):
            dx = (x - S / 2) / (S / 2)
            dy = (y - S / 2) / (S / 2)
            r2 = dx * dx + dy * dy
            if r2 > 1:
                continue
            k = 0.5 + 0.5 * (1 - r2) ** 0.6 - 0.35 * dy
            cp[x, y] = (min(255, int(74 * k)), min(255, int(52 * k)), min(255, int(36 * k)), 255)
    cup.save(os.path.join(ATLAS, 'single_siege_sling.png'))

    # The stone: a rough ball, dark, with one lit shoulder.
    R = 30
    stone = Image.new('RGBA', (R, R), (0, 0, 0, 0))
    sp = stone.load()
    for y in range(R):
        for x in range(R):
            dx = (x - R / 2) / (R / 2)
            dy = (y - R / 2) / (R / 2)
            r2 = dx * dx + dy * dy
            if r2 > 1:
                continue
            nz = math.sqrt(max(0.0, 1 - r2))
            lam = max(0.12, (-dx * 0.5 - dy * 0.6 + nz * 0.62))
            grain = 0.88 + 0.24 * (((x * 7 + y * 13) % 5) / 5.0)
            k = lam * grain
            sp[x, y] = (min(255, int(126 * k)), min(255, int(120 * k)), min(255, int(112 * k)), 255)
    stone.save(os.path.join(ATLAS, 'single_siege_stone.png'))
    return [('siege_arm', L, T), ('siege_sling', S, S), ('siege_stone', R, R)]


def register(engine, wreck, singles):
    mpath = os.path.join(ATLAS, 'manifest.json')
    with open(mpath, 'r', encoding='utf-8') as f:
        man = json.load(f)
    ecw, ech = engine[0], engine[1]
    wcw, wch = wreck[0], wreck[1]
    man['anims']['siege_engine'] = {
        'file': 'siege_engine.png',
        'cellW': ecw, 'cellH': ech,
        'frameCount': len(RECOIL), 'dirCount': 8, 'nearest': False,
        'origW': ecw, 'origH': ech, 'trimX': 0, 'trimY': 0, 'scale': 1,
        'painted': {'top': 0, 'bottom': ech, 'left': 0, 'right': ecw},
    }
    man['anims']['siege_wreck'] = {
        'file': 'siege_wreck.png',
        'cellW': wcw, 'cellH': wch,
        'frameCount': 1, 'dirCount': 8, 'nearest': False,
        'origW': wcw, 'origH': wch, 'trimX': 0, 'trimY': 0, 'scale': 1,
        'painted': {'top': 0, 'bottom': wch, 'left': 0, 'right': wcw},
    }
    for name, w, h in singles:
        man['singles'][name] = {'file': 'single_%s.png' % name, 'w': w, 'h': h, 'nearest': False}
    # The same writer `scripts/bake-trader.py` uses, so re-running any bake
    # does not flip the manifest's line endings and churn the whole file.
    with open(mpath, 'w', encoding='utf-8', newline=CRLF) as f:
        f.write(json.dumps(man, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    e = build_engine()
    print('siege_engine  cell %dx%d, 8 dirs x %d frames, ground centre (%.1f, %.1f) -> anchor (%.3f, %.3f)'
          % (e[0], e[1], len(RECOIL), e[2], e[3], e[2] / e[0], e[3] / e[1]))
    w = build_wreck()
    print('siege_wreck   cell %dx%d, 8 dirs, ground centre (%.1f, %.1f) -> anchor (%.3f, %.3f)'
          % (w[0], w[1], w[2], w[3], w[2] / w[0], w[3] / w[1]))
    s = build_arm()
    print('singles: %s' % ', '.join(n for n, _, _ in s))
    register(e, w, s)
    print('registered in manifest.json')
