"""
ITEM ART (it.114): inventory icons, turntable spins, the Arsenal and the gold.

Sources (all under `public/assets/graphics update/items inventory and drop/`,
gitignored):

  * polyy.ai turntable packs - food (50), fantasy weapons (25), potions
    (170), scrolls and tomes (115). Each PNG is an 8x4 grid of 30 rotation
    frames (12 degree steps, reading order, the last two cells empty) at
    `<pack>/sprite/<size>px_<lighting>/<item>_<coloring>.png`. CC0.
  * The Adventurer's Arsenal v1.0.1 (RastalR standard asset licence): 80
    static 64x64 pixel icons with `metadata/items.csv`.
  * Flare loot coins (Clint Bellanger / Flare, CC-BY-SA 3.0) and the Gold
    Treasure Icons (Clint Bellanger, OpenGameArt, CC-BY-SA 3.0) - the drop
    has no coin art, so these are downloaded into the scratchpad by
    `--fetch-coins` (or by hand, see COIN_DIR) and baked from there.

What is written (all registered through `bakelib`):

  item_food_<slug>      64x64 single, frame 0 of the 64px studio turntable
  spin_food_<slug>      one-direction 30-frame anim from the 96px turntable
  item_potion_<key>     14 picked draughts, same shape as the food
  spin_potion_<key>
  item_scroll_a..c      3 rolled scrolls, 3 tomes (+ spin_)
  item_tome_a..c
  item_weapon_<slug>    all 25 polyy weapons (+ spin_)
  arsenal_<id>          80 singles from the 64x64 masters (nearest)
  coin_small/medium/large   Flare 'drop' bounce anims (nearest)
  item_coin_small/medium/large  the rested last frame of each
  coin_pile_a/b         32x32 OGA coin piles (nearest)

Icons get a one-pixel dark outline (the inventory is dark obsidian glass and
the polyy renders have hard, unoutlined edges); the spins are left as
rendered.

Usage:
    python scripts/bake-items.py [--only food|potions|scrolls|weapons|arsenal|coins] [--preview] [--fetch-coins]
"""
import argparse
import csv
import glob
import os
import re
import shutil
import sys
import time
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bakelib  # noqa: E402
from bakelib import ATLAS, DROP, ROOT, contact_sheet, read_manifest  # noqa: E402


def _retry(fn):
    """Other bakes read the manifest while this one replaces it; on Windows that
    is a transient PermissionError on `os.replace`, so try again rather than die."""
    def wrapped(*a, **kw):
        for attempt in range(20):
            try:
                return fn(*a, **kw)
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.25 * (attempt + 1))
    return wrapped


write_anim = _retry(bakelib.write_anim)
write_single = _retry(bakelib.write_single)

ITEMS = os.path.join(DROP, 'items inventory and drop')
FOOD = os.path.join(ITEMS, 'food', 'food_inventory_sprites_50_pack')
WEAPONS = os.path.join(ITEMS, 'fantasy_weapon_sprites_25_pack')
POTION_PACKS = [os.path.join(ITEMS, '2'), os.path.join(ITEMS, '2', '1'), os.path.join(ITEMS, '2', '2')]
SCROLL_PACKS = [os.path.join(ITEMS, 'scrolls'), os.path.join(ITEMS, 'scrolls', 'part2')]
ARSENAL = os.path.join(ITEMS, 'The-Adventurers-Arsenal-v1.0.1')

SCRATCH = os.environ.get('BAKE_ITEMS_SCRATCH') or os.path.join(
    os.environ.get('TEMP', os.path.join(ROOT, 'tmp')), 'claude',
    'C--Users-user-Desktop-isometric-game', '9b751797-5b62-470f-a302-7c92b37a98e4', 'scratchpad', 'bake-items')
PREVIEW_DIR = SCRATCH
COIN_DIR = os.path.join(SCRATCH, 'flare')
OGA_DIR = os.path.join(SCRATCH, 'oga')

ICON_SIZE = 64      # the size the DOM cells draw at
SPIN_SIZE = 96      # the turntable size baked for the spins
FRAMES = 30         # rotation frames per turntable
GRID_COLS = 8

FLARE_LOOT = 'https://raw.githubusercontent.com/flareteam/flare-game/v1.14/mods/fantasycore/'
OGA_GOLD = 'https://opengameart.org/sites/default/files/gold_0.png'

CREDITS = [
    'Flare loot coins (coins5/25/100.png): Clint Bellanger / Flare, CC-BY-SA 3.0, '
    'https://github.com/flareteam/flare-game/tree/v1.14/mods/fantasycore/images/loot',
    'Gold Treasure Icons (gold_0.png): Clint Bellanger, CC-BY-SA 3.0, '
    'https://opengameart.org/content/gold-treasure-icons',
    'Food / weapon / potion / scroll turntables: polyy.ai, CC0',
    "The Adventurer's Arsenal: RastalR standard asset licence v1.1 (no credit required, no redistribution of sources)",
]

# ---------------------------------------------------------------------------
# TABLES
# ---------------------------------------------------------------------------

#: Suggested nutrition tier per dish: snack / meal / feast (by what the dish is).
FOOD_TIER = {
    'apple_pie_slice': 'snack', 'baked_mussels_plate': 'meal', 'berry_tart': 'snack',
    'blueberry_muffin': 'snack', 'caramel_flan': 'snack', 'chocolate_eclair': 'snack',
    'chocolate_lava_cake': 'snack', 'cinnamon_roll_stack': 'snack', 'clam_chowder_bread_bowl': 'meal',
    'croissant_sandwich': 'meal', 'crusty_bread_loaf': 'snack', 'falafel_pita_pocket': 'meal',
    'fish_and_chips_plate': 'meal', 'fish_taco_board': 'meal', 'fried_chicken_plate': 'meal',
    'fried_eggs_and_toast': 'meal', 'frosted_cupcake': 'snack', 'glazed_holiday_ham': 'feast',
    'golden_meat_pie': 'meal', 'grilled_fish_plate': 'meal', 'grilled_sausage_pair': 'snack',
    'grilled_steak_board': 'feast', 'hearty_stew_bowl': 'meal', 'layer_cake_slice': 'snack',
    'loaded_baked_potato': 'meal', 'loaded_burrito': 'meal', 'loaded_nachos': 'meal',
    'lobster_roll': 'meal', 'meat_skewer': 'snack', 'meatball_sub': 'meal',
    'noodle_soup_bowl': 'meal', 'pancake_stack': 'meal', 'pepperoni_pizza_slice': 'snack',
    'pot_roast_board': 'feast', 'pumpkin_soup_bowl': 'meal', 'red_curry_rice_bowl': 'meal',
    'roast_turkey_leg': 'meal', 'roasted_quail_board': 'feast', 'salted_pretzel': 'snack',
    'seafood_paella_bowl': 'feast', 'shepherds_pie': 'meal', 'shrimp_po_boy': 'meal',
    'stacked_cheeseburger': 'meal', 'steamed_bao_buns': 'snack', 'steamer_dumplings': 'snack',
    'stuffed_bell_pepper': 'meal', 'stuffed_cabbage_rolls': 'meal', 'sushi_roll_plate': 'meal',
    'waffle_stack': 'meal', 'whole_roast_chicken': 'feast',
}

#: game draught key -> polyy potion number (see `survey_potions.png` in the scratchpad)
POTIONS = {
    'health': 16,          # ruby_heart - round red flask with a heart
    'greater_health': 158,  # crimson_vine - taller red bottle, gold filigree
    'mana': 43,            # raindrop_rain - bright blue drop
    'greater_mana': 102,   # cobalt_moon - deep blue with a gold moon
    'elixir': 122,         # amethyst_rune - violet
    'rejuvenation': 20,    # frostfire_dual - red + blue halves
    'haste': 29,           # clockwork_haste - gold with a clock face
    'stone': 138,          # marble_white - white marble bottle
    'might': 22,           # berserker_jug - orange-brown horned jug
    'antidote': 39,        # hunter_antidote - green
    'frost': 152,          # frost_snowflake - ice blue
    'void': 21,            # void_pawn - black with a violet core
    'focus': 55,           # capsule_focus - white capsule bottle
    'poison': 53,          # grenade_acid - dark grenade, green windows
}

#: name -> polyy scroll number (rolled scrolls and tomes, see `survey_scroll_cand.png`)
SCROLLS = {
    'scroll_a': 27,  # amber-memory: plain parchment, red ribbon (recipes)
    'scroll_b': 82,  # arcane-script: blue scroll (the town portal)
    'scroll_c': 69,  # royal-oath: violet and gold
    'tome_a': 63,    # rust-decay: brown leather book (recipes)
    'tome_b': 73,    # sapphire-arcane: blue arcane tome
    'tome_c': 46,    # dusty-secret: grey, old
}

#: Flare loot strips: key -> (png, animation txt)
COINS = {
    'small': 'coins5',
    'medium': 'coins25',
    'large': 'coins100',
}

#: OGA gold sheet cells (32x32 grid; row 0 is the palette strip)
COIN_PILES = {
    'coin_pile_a': (0, 2),  # sixteen-coin pile
    'coin_pile_b': (3, 1),  # stack of eight
}


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------


def slug(name):
    s = re.sub(r'[^a-z0-9]+', '_', name.lower())
    return s.strip('_')


def display(name):
    return name.replace('_', ' ')


def turntable(pack, item, size, lighting='studio', coloring='nopalette'):
    return os.path.join(pack, 'sprite', '%dpx_%s' % (size, lighting), '%s_%s.png' % (item, coloring))


def grid_frames(path, size):
    """The 30 rotation frames of a polyy turntable PNG, reading order."""
    im = Image.open(path).convert('RGBA')
    assert im.size == (size * GRID_COLS, size * 4), '%s: expected %dx%d grid, got %s' % (path, size * 8, size * 4, im.size)
    cells = []
    for i in range(GRID_COLS * 4):
        c, r = i % GRID_COLS, i // GRID_COLS
        cells.append(im.crop((c * size, r * size, (c + 1) * size, (r + 1) * size)))
    frames = cells[:FRAMES]
    for i, f in enumerate(frames):
        assert f.getbbox(), '%s: frame %d is empty' % (path, i)
    for i, f in enumerate(cells[FRAMES:]):
        if f.split()[3].getbbox():
            print('  WARN %s: spare cell %d is painted' % (os.path.basename(path), FRAMES + i))
    return frames


def outline(im, color=(12, 9, 14, 190)):
    """A one-pixel dark rim under a hard-edged icon so it reads on dark glass."""
    im = im.convert('RGBA')
    a = np.array(im)[:, :, 3] > 8
    grown = a.copy()
    grown[1:, :] |= a[:-1, :]
    grown[:-1, :] |= a[1:, :]
    grown[:, 1:] |= a[:, :-1]
    grown[:, :-1] |= a[:, 1:]
    rim = grown & ~a
    out = np.zeros((im.size[1], im.size[0], 4), dtype=np.uint8)
    out[rim] = color
    base = Image.fromarray(out, 'RGBA')
    base.alpha_composite(im)
    return base


def find_in_packs(packs, size, pattern):
    for p in packs:
        g = glob.glob(os.path.join(p, 'sprite', '%dpx_studio' % size, pattern))
        if g:
            return g[0]
    raise FileNotFoundError('%s at %dpx in %s' % (pattern, size, packs))


def bake_turntable(icon_name, spin_name, icon_path, spin_path, preview):
    icon = outline(grid_frames(icon_path, ICON_SIZE)[0])
    write_single(icon_name, icon, nearest=False)
    spin = grid_frames(spin_path, SPIN_SIZE)
    write_anim(spin_name, {0: spin}, nearest=False)
    return icon, spin


def icon_grid(icons, path, cols=10, cell=64):
    """A labelled grid of icons on the inventory's dark glass."""
    rows = (len(icons) + cols - 1) // cols
    sh = Image.new('RGBA', (cols * (cell + 4), rows * (cell + 14)), (24, 22, 30, 255))
    d = ImageDraw.Draw(sh)
    for i, (name, im) in enumerate(icons):
        x, y = (i % cols) * (cell + 4), (i // cols) * (cell + 14)
        im = im.convert('RGBA')
        if im.size != (cell, cell):
            im = im.resize((cell, cell), Image.NEAREST)
        sh.paste(im, (x, y), im)
        d.text((x + 1, y + cell), name[:13], fill=(255, 220, 120, 255))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sh.save(path)
    print('  preview', path)


def spin_sheet(spins, path, cell=48):
    contact_sheet({i: f for i, f in enumerate(spins)}, path, cell=(cell, cell))
    print('  preview', path)


# ---------------------------------------------------------------------------
# GROUPS
# ---------------------------------------------------------------------------


def bake_food(preview):
    names = []
    icons, spins = [], []
    files = sorted(glob.glob(os.path.join(FOOD, 'sprite', '%dpx_studio' % ICON_SIZE, '*_nopalette.png')))
    assert len(files) == 50, 'expected 50 dishes, found %d' % len(files)
    for f in files:
        item = os.path.basename(f)[:-len('_nopalette.png')]
        s = slug(item)
        assert s in FOOD_TIER, 'no nutrition tier for %s' % s
        icon, spin = bake_turntable('item_food_' + s, 'spin_food_' + s,
                                    turntable(FOOD, item, ICON_SIZE), turntable(FOOD, item, SPIN_SIZE), preview)
        names += ['item_food_' + s, 'spin_food_' + s]
        icons.append((s, icon))
        spins.append(spin)
        print('  food %-28s %s' % (s, FOOD_TIER[s]))
    if preview:
        icon_grid(icons, os.path.join(PREVIEW_DIR, 'preview_food_icons.png'))
        spin_sheet(spins, os.path.join(PREVIEW_DIR, 'preview_food_spin.png'))
    return names


def bake_potions(preview):
    names, icons, spins = [], [], []
    for key, n in POTIONS.items():
        ip = find_in_packs(POTION_PACKS, ICON_SIZE, 'potion_%d_*_nopalette.png' % n)
        sp = find_in_packs(POTION_PACKS, SPIN_SIZE, 'potion_%d_*_nopalette.png' % n)
        icon, spin = bake_turntable('item_potion_' + key, 'spin_potion_' + key, ip, sp, preview)
        names += ['item_potion_' + key, 'spin_potion_' + key]
        icons.append((key, icon))
        spins.append(spin)
        print('  potion %-16s <- %s' % (key, os.path.basename(ip)))
    if preview:
        icon_grid(icons, os.path.join(PREVIEW_DIR, 'preview_potion_icons.png'), cols=7)
        spin_sheet(spins, os.path.join(PREVIEW_DIR, 'preview_potion_spin.png'))
    return names


def bake_scrolls(preview):
    names, icons, spins = [], [], []
    for key, n in SCROLLS.items():
        ip = find_in_packs(SCROLL_PACKS, ICON_SIZE, '%d_*_nopalette.png' % n)
        sp = find_in_packs(SCROLL_PACKS, SPIN_SIZE, '%d_*_nopalette.png' % n)
        icon, spin = bake_turntable('item_' + key, 'spin_' + key, ip, sp, preview)
        names += ['item_' + key, 'spin_' + key]
        icons.append((key, icon))
        spins.append(spin)
        print('  %-10s <- %s' % (key, os.path.basename(ip)))
    if preview:
        icon_grid(icons, os.path.join(PREVIEW_DIR, 'preview_scroll_icons.png'), cols=6)
        spin_sheet(spins, os.path.join(PREVIEW_DIR, 'preview_scroll_spin.png'))
    return names


def bake_weapons(preview):
    names, icons, spins = [], [], []
    files = sorted(glob.glob(os.path.join(WEAPONS, 'sprite', '%dpx_studio' % ICON_SIZE, '*_nopalette.png')))
    assert len(files) == 25, 'expected 25 weapons, found %d' % len(files)
    for f in files:
        item = os.path.basename(f)[:-len('_nopalette.png')]
        s = slug(item)
        icon, spin = bake_turntable('item_weapon_' + s, 'spin_weapon_' + s,
                                    turntable(WEAPONS, item, ICON_SIZE), turntable(WEAPONS, item, SPIN_SIZE), preview)
        names += ['item_weapon_' + s, 'spin_weapon_' + s]
        icons.append((s, icon))
        spins.append(spin)
        print('  weapon %-24s <- %s' % (s, item))
    if preview:
        icon_grid(icons, os.path.join(PREVIEW_DIR, 'preview_weapon_icons.png'), cols=9)
        spin_sheet(spins, os.path.join(PREVIEW_DIR, 'preview_weapon_spin.png'))
    return names


def bake_arsenal(preview):
    names, icons = [], []
    src_csv = os.path.join(ARSENAL, 'metadata', 'items.csv')
    with open(src_csv, newline='', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 80, 'expected 80 arsenal rows, found %d' % len(rows)
    for r in rows:
        im = Image.open(os.path.join(ARSENAL, r['master_64'])).convert('RGBA')
        assert im.size == (64, 64), '%s: %s' % (r['id'], im.size)
        write_single('arsenal_' + r['id'], im, nearest=True)
        names.append('arsenal_' + r['id'])
        icons.append((r['id'], im))
    dst = os.path.join(ROOT, 'docs', 'arsenal-items.csv')
    shutil.copyfile(src_csv, dst)
    print('  %d arsenal icons; csv -> %s' % (len(rows), dst))
    if preview:
        icon_grid(icons, os.path.join(PREVIEW_DIR, 'preview_arsenal_icons.png'), cols=10)
    return names


def fetch_coins():
    os.makedirs(COIN_DIR, exist_ok=True)
    os.makedirs(OGA_DIR, exist_ok=True)
    for base in COINS.values():
        for sub, ext in (('images/loot', 'png'), ('animations/loot', 'txt')):
            dst = os.path.join(COIN_DIR, '%s.%s' % (base, ext))
            if not os.path.exists(dst):
                urllib.request.urlretrieve('%s%s/%s.%s' % (FLARE_LOOT, sub, base, ext), dst)
                print('  fetched', dst)
    dst = os.path.join(OGA_DIR, 'gold_0.png')
    if not os.path.exists(dst):
        req = urllib.request.Request(OGA_GOLD, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as r, open(dst, 'wb') as f:
            f.write(r.read())
        print('  fetched', dst)


def flare_frames(base):
    """
    The frames of a Flare loot animation composed onto one canvas.

    `animations/loot/<base>.txt` lists `frame=i,dir,x,y,w,h,ox,oy`: a packed
    rect in the PNG and the anchor (ox, oy) of that frame. All frames are
    placed so the anchors coincide, which is what the engine does.
    """
    im = Image.open(os.path.join(COIN_DIR, base + '.png')).convert('RGBA')
    rects = []
    with open(os.path.join(COIN_DIR, base + '.txt'), encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith('frame='):
                i, d, x, y, w, h, ox, oy = [int(v) for v in line[len('frame='):].split(',')]
                rects.append((i, x, y, w, h, ox, oy))
    rects.sort()
    ax = max(r[5] for r in rects)
    ay = max(r[6] for r in rects)
    cw = ax + max(r[3] - r[5] for r in rects)
    ch = ay + max(r[4] - r[6] for r in rects)
    frames, last = [], None
    for i, x, y, w, h, ox, oy in rects:
        cell = im.crop((x, y, x + w, y + h))
        canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        canvas.paste(cell, (ax - ox, ay - oy), cell)
        frames.append(canvas)
        last = cell
    return frames, last


def bake_coins(preview):
    names, icons = [], []
    fetch_coins()
    for key, base in COINS.items():
        frames, last = flare_frames(base)
        write_anim('coin_' + key, {0: frames}, nearest=True)
        write_single('item_coin_' + key, last, nearest=True)
        names += ['coin_' + key, 'item_coin_' + key]
        icons.append(('coin_' + key, last))
        print('  coin_%-7s %d frames %sx%s, rested %sx%s' % (key, len(frames), frames[0].size[0], frames[0].size[1], last.size[0], last.size[1]))
        if preview:
            spin_sheet([frames], os.path.join(PREVIEW_DIR, 'preview_coin_%s.png' % key), cell=frames[0].size[0])
    gold = Image.open(os.path.join(OGA_DIR, 'gold_0.png')).convert('RGBA')
    assert gold.size == (128, 128)
    for name, (c, r) in COIN_PILES.items():
        cell = gold.crop((c * 32, r * 32, (c + 1) * 32, (r + 1) * 32))
        assert cell.getbbox()
        write_single(name, cell, nearest=True)
        names.append(name)
        icons.append((name, cell))
        print('  %s <- gold_0.png cell (%d,%d)' % (name, c, r))
    if preview:
        icon_grid(icons, os.path.join(PREVIEW_DIR, 'preview_coin_icons.png'), cols=5)
    return names


GROUPS = {
    'food': bake_food,
    'potions': bake_potions,
    'scrolls': bake_scrolls,
    'weapons': bake_weapons,
    'arsenal': bake_arsenal,
    'coins': bake_coins,
}


# ---------------------------------------------------------------------------
# VERIFY
# ---------------------------------------------------------------------------


def verify(names):
    man = read_manifest()
    bad = 0
    for n in names:
        if n in man['singles']:
            e = man['singles'][n]
            want = (e['w'], e['h'])
        elif n in man['anims']:
            e = man['anims'][n]
            want = (e['cellW'] * e['frameCount'], e['cellH'] * e['dirCount'])
        else:
            print('  MISSING manifest entry', n)
            bad += 1
            continue
        p = os.path.join(ATLAS, e['file'])
        if not os.path.exists(p):
            print('  MISSING file', p)
            bad += 1
            continue
        got = Image.open(p).size
        if got != want:
            print('  SIZE %s: %s != %s' % (n, got, want))
            bad += 1
    print('verified %d entries, %d problems' % (len(names), bad))
    return bad == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', choices=sorted(GROUPS), action='append')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--fetch-coins', action='store_true', help='only download the coin sources')
    args = ap.parse_args()
    if args.fetch_coins:
        fetch_coins()
        return
    groups = args.only or ['food', 'potions', 'scrolls', 'weapons', 'arsenal', 'coins']
    if args.preview:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
    all_names = []
    counts = {}
    for g in groups:
        print('== %s' % g)
        names = GROUPS[g](args.preview)
        counts[g] = len(names)
        all_names += names
    ok = verify(all_names)
    print('counts:', counts)
    for c in CREDITS:
        print('credit:', c)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
