"""
THE SHARED BAKE LIBRARY (it.114).

Every bake before this one carried its own copy of the same four things: the
repo paths, the CRLF manifest writer, the projection-derived diamond mask and
the "columns are frames, rows are directions" sheet layout. The graphics-update
drop is baked by several scripts at once, and two of them writing
`manifest.json` in the same second would lose one another's entries - so the
writer here takes a LOCK, and the rest is here so a new bake is a table of
inputs rather than a fifth copy of the plumbing.

Conventions (see `docs/skills/atlas-sprite-pipeline.md`):

  * an animated sheet is `cellW * frameCount` wide and `cellH * dirCount` tall;
    row d is canonical direction d in DIRS = E, NE, N, NW, W, SW, S, SE
    (screen-space: E is towards the right of the screen, S towards the bottom);
  * `painted` is the alpha bounding box of the SOUTH row, in ORIGINAL pixels,
    because `SpriteLibrary.paintedHeight()` sets every rig's scale from it and
    `footAnchor()` puts the feet on the tile from it;
  * a single's manifest KEY has no `single_` prefix; its FILE does;
  * ground diamonds are 64x32, masked by the projection (never drawn), then
    dilated one pixel so the linear sampler has an opaque neighbour under
    every edge.

Usage from a bake:

    from bakelib import *
    frames = {d: [Image, ...] for d in range(8)}      # canonical order
    write_anim('treant_walk', frames, nearest=False)
    write_single('altar_a', img)
"""
import json
import math
import os
import sys
import time

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATLAS = os.path.join(ROOT, 'public', 'assets', 'atlas')
DROP = os.path.join(ROOT, 'public', 'assets', 'graphics update')
MANIFEST = os.path.join(ATLAS, 'manifest.json')
LOCK = MANIFEST + '.lock'

TILE_W, TILE_H = 64, 32
DIRS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE']
SOUTH = 6

#: The manifest's own line ending, as `scripts/bake-trader.py` writes it - so
#: re-running any bake does not flip it and churn the whole file.
CRLF = '\r\n'


def clamp8(x):
    return 0 if x < 0 else (255 if x > 255 else int(x))


# ---------------------------------------------------------------------------
# THE MASK (verbatim from `bake-ground.py`, which proved it at it.108/it.112)
# ---------------------------------------------------------------------------


def diamond_alpha():
    """The 64x32 tile's own mask, DERIVED FROM THE PROJECTION rather than drawn."""
    m = Image.new('L', (TILE_W, TILE_H), 0)
    px = m.load()
    for py in range(TILE_H):
        for pxi in range(TILE_W):
            sx = pxi + 0.5 - TILE_W / 2
            sy = py + 0.5
            a = sx / (TILE_W / 2)
            b = sy / (TILE_H / 2)
            if math.floor((a + b) / 2) == 0 and math.floor((b - a) / 2) == 0:
                px[pxi, py] = 255
    return m


def dilate(mask, r=1):
    """The mask grown by `r` pixels, so neighbouring tiles OVERLAP instead of meeting."""
    src = mask.load()
    out = Image.new('L', mask.size, 0)
    dst = out.load()
    w, h = mask.size
    for y in range(h):
        for x in range(w):
            if src[x, y]:
                dst[x, y] = 255
                continue
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and src[nx, ny]:
                        dst[x, y] = 255
                        break
                else:
                    continue
                break
    return out


MASK = diamond_alpha()
MASK_OUT = dilate(MASK)


def ground_diamond(src, scale=None, box=None):
    """
    A 64x32 ground diamond cut from a 2:1 source diamond image.

    `src` is a pre-rendered 2:1 tile (e.g. a 256x128 cut diamond from the
    Ancient Tiles or the Screaming Brain sheets, magenta already keyed to
    alpha). It is resized to 64x32 with LANCZOS (or cropped to `box` first),
    bled outward so the mask edge never samples transparent black, and then
    masked with `MASK_OUT`.
    """
    im = src.convert('RGBA')
    if box:
        im = im.crop(box)
    if im.size != (TILE_W, TILE_H):
        im = im.resize((TILE_W, TILE_H), Image.LANCZOS)
    im = bleed(im, 3)
    out = Image.new('RGBA', (TILE_W, TILE_H), (0, 0, 0, 0))
    out.paste(im, (0, 0), MASK_OUT)
    return out


def bleed(im, passes=3):
    """Push opaque colour outward into transparent pixels so a mask edge never samples black."""
    im = im.convert('RGBA')
    w, h = im.size
    for _ in range(passes):
        px = im.load()
        src = im.copy().load()
        for y in range(h):
            for x in range(w):
                if src[x, y][3] >= 8:
                    continue
                acc = [0, 0, 0]
                n = 0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h:
                            r, g, b, a = src[nx, ny]
                            if a >= 8:
                                acc[0] += r
                                acc[1] += g
                                acc[2] += b
                                n += 1
                if n:
                    px[x, y] = (acc[0] // n, acc[1] // n, acc[2] // n, 0)
    return im


def key_magenta(im, key=(255, 0, 255), tol=40):
    """Colour-keyed sheets (Screaming Brain, town pack) -> alpha."""
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    kr, kg, kb = key
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if abs(r - kr) <= tol and abs(g - kg) <= tol and abs(b - kb) <= tol:
                px[x, y] = (0, 0, 0, 0)
    return im


# ---------------------------------------------------------------------------
# SHEETS
# ---------------------------------------------------------------------------


def alpha_bbox(im, thresh=8):
    """(left, top, right, bottom) inclusive of every pixel with alpha > thresh, or None."""
    a = im.convert('RGBA').split()[3]
    if thresh != 0:
        a = a.point(lambda v: 255 if v > thresh else 0)
    box = a.getbbox()
    if not box:
        return None
    return (box[0], box[1], box[2] - 1, box[3] - 1)


def union_bbox(images, thresh=8):
    box = None
    for im in images:
        b = alpha_bbox(im, thresh)
        if b is None:
            continue
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box


def decimate(frames, n):
    """Pick `n` frames evenly from a longer clip (a 60 fps capture is not an animation)."""
    if len(frames) <= n:
        return list(frames)
    return [frames[int(i * len(frames) / n)] for i in range(n)]


def write_anim(name, frames_by_dir, nearest=False, half=False, keep=None, painted_dir=SOUTH, out_scale=1.0):
    """
    Bake an 8-direction (or 1-direction) sheet and register it.

    `frames_by_dir`: dict or list, canonical direction index -> list of PIL
    frames of ONE common original size. Every direction must have the same
    frame count. Pass a single-entry dict `{0: [...]}` for a one-direction strip.

    `half`: bake the sheet at 0.5 and mount it with `scale: 0.5` (for rigs that
    render small - guard/wolf/zombie do this). `out_scale`: any other uniform
    pre-scale applied to the original frames BEFORE cropping (e.g. 0.25 for a
    512 px render that should be a 128 px original) - it changes the ORIGINAL
    size the manifest records, so anchors are computed on the scaled frame.

    `keep`: optional (left, top, right, bottom) crop box in original pixels to
    use instead of the union alpha box (to drop a baked-in shadow, say).

    Returns the manifest entry.
    """
    dirs = sorted(frames_by_dir.keys()) if isinstance(frames_by_dir, dict) else list(range(len(frames_by_dir)))
    rows = [frames_by_dir[d] for d in dirs]
    n = len(rows[0])
    for r in rows:
        assert len(r) == n, '%s: every direction must have %d frames' % (name, n)
    if out_scale != 1.0:
        rows = [[f.resize((max(1, int(round(f.size[0] * out_scale))), max(1, int(round(f.size[1] * out_scale)))), Image.LANCZOS)
                 for f in r] for r in rows]
    ow, oh = rows[0][0].size
    box = keep or union_bbox([f for r in rows for f in r])
    assert box, '%s: nothing painted' % name
    l, t, r_, b = box
    cw, ch = r_ - l + 1, b - t + 1
    k = 0.5 if half else 1
    scw, sch = max(1, int(round(cw * k))), max(1, int(round(ch * k)))
    dir_count = len(rows)
    sheet = Image.new('RGBA', (scw * n, sch * dir_count), (0, 0, 0, 0))
    for d, r in enumerate(rows):
        for fi, f in enumerate(r):
            cell = f.convert('RGBA').crop((l, t, r_ + 1, b + 1))
            if half:
                cell = cell.resize((scw, sch), Image.LANCZOS)
            sheet.paste(cell, (fi * scw, d * sch), cell)
    sheet.save(os.path.join(ATLAS, name + '.png'))
    prow = rows[painted_dir] if painted_dir < dir_count else rows[0]
    pb = union_bbox(prow) or box
    entry = {
        'file': name + '.png',
        'cellW': scw, 'cellH': sch,
        'frameCount': n, 'dirCount': dir_count, 'nearest': bool(nearest),
        'origW': ow, 'origH': oh, 'trimX': l, 'trimY': t, 'scale': k,
        'painted': {'top': pb[1], 'bottom': pb[3], 'left': pb[0], 'right': pb[2]},
    }
    register_anims({name: entry})
    return entry


def write_single(name, im, nearest=False):
    im = im.convert('RGBA')
    im.save(os.path.join(ATLAS, 'single_%s.png' % name))
    entry = {'file': 'single_%s.png' % name, 'w': im.size[0], 'h': im.size[1], 'nearest': bool(nearest)}
    register_singles({name: entry})
    return entry


def contact_sheet(frames_by_dir, path, cell=None, label=True):
    """
    A preview grid (rows = directions in canonical order, columns = frames) so a
    bake can be LOOKED AT before it is trusted. Written outside `public/`.
    """
    from PIL import ImageDraw
    dirs = sorted(frames_by_dir.keys()) if isinstance(frames_by_dir, dict) else list(range(len(frames_by_dir)))
    rows = [frames_by_dir[d] for d in dirs]
    n = max(len(r) for r in rows)
    w, h = cell or rows[0][0].size
    sheet = Image.new('RGBA', (w * n + 40, h * len(rows)), (40, 40, 48, 255))
    draw = ImageDraw.Draw(sheet)
    for d, r in enumerate(rows):
        if label:
            draw.text((4, d * h + 4), DIRS[dirs[d]] if len(rows) == 8 else str(dirs[d]), fill=(255, 220, 120, 255))
        for fi, f in enumerate(r):
            f2 = f.convert('RGBA')
            if f2.size != (w, h):
                f2 = f2.resize((w, h), Image.LANCZOS)
            sheet.paste(f2, (40 + fi * w, d * h), f2)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path)
    return path


# ---------------------------------------------------------------------------
# THE MANIFEST, UNDER A LOCK
# ---------------------------------------------------------------------------


def _acquire(timeout=120.0):
    t0 = time.time()
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return
        except FileExistsError:
            # A lock older than the timeout is a crashed bake, not a busy one.
            try:
                if time.time() - os.path.getmtime(LOCK) > timeout:
                    os.remove(LOCK)
                    continue
            except OSError:
                pass
            if time.time() - t0 > timeout:
                raise RuntimeError('manifest lock held too long: %s' % LOCK)
            time.sleep(0.05)


def _release():
    try:
        os.remove(LOCK)
    except OSError:
        pass


def _update(fn):
    _acquire()
    try:
        with open(MANIFEST, 'r', encoding='utf-8') as f:
            man = json.load(f)
        fn(man)
        tmp = MANIFEST + '.tmp'
        with open(tmp, 'w', encoding='utf-8', newline=CRLF) as f:
            f.write(json.dumps(man, indent=1, ensure_ascii=False))
        # Windows refuses the rename while another process (a concurrent bake's
        # `read_manifest`, the dev server) holds the file open for reading.
        # Those reads are short; wait them out rather than fail the bake.
        for attempt in range(40):
            try:
                os.replace(tmp, MANIFEST)
                break
            except PermissionError:
                if attempt == 39:
                    raise
                time.sleep(0.1)
    finally:
        _release()


def register_anims(entries):
    _update(lambda man: man['anims'].update(entries))


def register_singles(entries):
    _update(lambda man: man['singles'].update(entries))


def unregister(names):
    """Drop stale keys (a bake that supersedes a kit deletes the old KEYS as well as the old files)."""
    def fn(man):
        for n in names:
            man['anims'].pop(n, None)
            man['singles'].pop(n, None)
    _update(fn)


def read_manifest():
    with open(MANIFEST, 'r', encoding='utf-8') as f:
        return json.load(f)


if __name__ == '__main__':
    man = read_manifest()
    print('manifest: %d anims, %d singles' % (len(man['anims']), len(man['singles'])))
    print('drop:', DROP, 'exists' if os.path.isdir(DROP) else 'MISSING')
    sys.exit(0)
