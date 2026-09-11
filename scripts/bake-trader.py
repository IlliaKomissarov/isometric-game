"""
BAKE THE EASTERN TRADER (it.111).

THE PROBLEM. The man the hero cuts out of a closet in the manor is meant to be
remembered - he is the only person on that side of the river who is glad to see
you, and he is the reason the eastern road matters. it.110 drew him on
`merchant_walk`, which is the town armourer's rig, so he looked like a stall
keeper the player had already bought boots from. it.110b moved him to
`cit_porter_walk` - and every one of the seven `cit_*` sheets is already worn by
the town's own street folk (`Villagers.STREET_FOLK`), so he still looked like
somebody the player passes in the market twice a minute.

THERE IS NO MERCHANT IN ANY PACK IN THE REPOSITORY. Searched: one goblin
peddler, and nothing else. So this makes one, out of the sheet whose SILHOUETTE
is already right - `cit_monk_walk` is the only citizen carrying a bundle on his
back, which is what a trader taken off the road with two carts would still have -
by re-dyeing it into a livery nobody else in the game wears: deep wine and gold
instead of the townsfolk's olive and rust.

HOW THE RE-DYE WORKS. A hue rotation would take the whole sheet with it,
including the skin and the pack. Each pixel is instead sorted into a band by its
own hue and only the CLOTH bands are moved:

  the olive/green coat        -> deep wine red
  the rust/orange breeches    -> dark plum
  the pale straw hair band    -> old gold

Skin, leather, the bundle and the shoes are left alone, because a merchant's
hands are the same colour as everyone else's.

Run:  python scripts/bake-trader.py
"""

import colorsys
import io
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATLAS = os.path.join(ROOT, 'public', 'assets', 'atlas')

SOURCE = 'cit_monk_walk'
TARGET = 'trader_walk'

#: The sheet's whole palette lives between hue 0.00 and 0.18 - brown outline,
#: skin, rust cloth, khaki cloth - plus one purple sash, so a hue rotation of the
#: "cloth" is a question of a few hundredths either way. These bands were read off
#: the sheet's own histogram (`colorsys` hue, saturation, value), not guessed:
#:
#:   h 0.125-0.185, s >= 0.35      the khaki coat and hood -> DEEP WINE
#:   h 0.085-0.125, s >= 0.85      the rust breeches       -> DARK PLUM
#:
#: and everything else is left exactly as drawn. SKIN in particular sits at hue
#: 0.05-0.11 with saturation well under 0.8, which is why the breeches rule needs
#: that saturation floor: without it the man's face came out magenta.
#:
#: IT.112 ADDED THE THIRD BAND THE DOCSTRING ALWAYS PROMISED. The coat rule
#: above stops at value 0.74 - so every HIGHLIGHT on the coat, the top of every
#: fold and the whole of the pale band at his collar, was left in the townsfolk's
#: straw while the body of the garment went wine. He came out patched rather than
#: liveried. Those pixels are OLD GOLD now, which is what a merchant trims a coat
#: with and what nobody else in the game is wearing.
BANDS = [
    ((0.125, 0.185), (0.35, 1.01), (0.0, 0.74), (0.985, 1.15, 0.82)),
    ((0.125, 0.185), (0.35, 1.01), (0.74, 1.01), (0.108, 1.05, 0.96)),
    ((0.085, 0.125), (0.85, 1.01), (0.0, 1.01), (0.915, 0.85, 0.72)),
]


def redye(img):
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            for (hlo, hhi), (slo, shi), (vlo, vhi), (nh, sk, vk) in BANDS:
                if hlo <= hh < hhi and slo <= ss < shi and vlo <= vv < vhi:
                    nr, ng, nb = colorsys.hsv_to_rgb(nh, min(1.0, ss * sk), min(1.0, vv * vk))
                    px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
                    break
    return img


def main():
    mpath = os.path.join(ATLAS, 'manifest.json')
    manifest = json.load(open(mpath, encoding='utf-8'))
    src = manifest['anims'].get(SOURCE)
    if not src:
        raise SystemExit(f'no {SOURCE} in the manifest')
    img = Image.open(os.path.join(ATLAS, src['file'])).convert('RGBA')
    out = redye(img.copy())
    out.save(os.path.join(ATLAS, f'{TARGET}.png'))
    entry = dict(src)
    entry['file'] = f'{TARGET}.png'
    manifest['anims'][TARGET] = entry
    with io.open(mpath, 'w', encoding='utf-8', newline='\r\n') as fh:
        fh.write(json.dumps(manifest, indent=1, ensure_ascii=False))
    print(f'  {TARGET}.png {out.size} <- {src["file"]}')
    print(f'manifest: {len(manifest["anims"])} anims total')


if __name__ == '__main__':
    main()
