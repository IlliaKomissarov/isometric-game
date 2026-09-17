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
  item_drink_<nnn>_<name>  the 105 polyy drinks (cans, bottles, soda bottles), keyed
  spin_drink_<nnn>_<name>  by their pack number so a repeated name never collides;
                        every one turns since it.115 (all 105 are poured)
  item_potion_p<nnn>    THE CURIOS (it.115): every other polyy potion (156), icon +
  spin_potion_p<nnn>    palette-quantized spin; its brew read from its colour
  item_scroll_s<nnn>    every other scroll and tome (109), the same
  spin_scroll_s<nnn>
  item_ore_o<nn>        every other ore of `ores/Style1` (54) + flat spin
  src/items/curios.gen.ts  the generated table `items/curios` turns into items
  arsenal_<id>          80 singles from the 64x64 masters (nearest)
  spin_arsenal_<id>     a 16-frame flat turntable of each (nearest, it.115)
  item_ore_<key>        the crafting materials from `ores/Style1` (64 px)
  spin_ore_<key>        and their 16-frame flat turntables (it.115)
  coin_small/medium/large   Flare 'drop' bounce anims (nearest)
  item_coin_small/medium/large  the rested last frame of each
  coin_pile_a/b         32x32 OGA coin piles (nearest)

Icons get a one-pixel dark outline (the inventory is dark obsidian glass and
the polyy renders have hard, unoutlined edges); the spins are left as
rendered.

Usage:
    python scripts/bake-items.py [--only food|potions|scrolls|weapons|drinks|arsenal|ores|coins|curios] [--preview] [--fetch-coins]

THE SPINS ARE STRIPS (it.115): `write_anim` lays a one-direction turntable
as a single ROW of 30 trimmed cells, so the DOM steps it with one
`background-position-x` animation (`.inv-spin`, steps(30)) - no separate
`strip_*` bake is needed; the world reads the same sheet through spriteLib.
"""
import argparse
import csv
import glob
import json
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


def _swap_manifest():
    """
    THE HELD MANIFEST (it.115). A long-lived reader (the dev server, a browser
    tab polling it) can hold `manifest.json` open without share-delete: then
    REPLACING it (`os.replace`, what bakelib does) is refused for as long as
    the handle lives, while RENAMING it away is allowed. bakelib wrote and
    closed a complete `manifest.json.tmp` before it raised, so the swap is two
    renames: the old file steps aside (the reader keeps its handle on it), the
    new one takes the name. Returns False when there is no complete tmp.
    """
    man = bakelib.MANIFEST
    tmp = man + '.tmp'
    if not os.path.exists(tmp):
        return False
    try:
        with open(tmp, 'r', encoding='utf-8') as f:
            json.load(f)
    except ValueError:
        return False
    old = man + '.old'
    try:
        if os.path.exists(old):
            os.remove(old)
    except OSError:
        pass
    os.rename(man, old)
    os.rename(tmp, man)
    try:
        os.remove(old)
    except OSError:
        pass  # Still held; the next swap removes it.
    return True


def _retry(fn):
    """Other bakes read the manifest while this one replaces it; on Windows that
    is a transient PermissionError on `os.replace`, so try again rather than die -
    and when the file is HELD rather than busy, swap it in by rename (it.115)."""
    def wrapped(*a, **kw):
        for attempt in range(20):
            try:
                return fn(*a, **kw)
            except PermissionError:
                if _swap_manifest():
                    return None
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
DRINK_PACKS = [os.path.join(ITEMS, '1'), os.path.join(ITEMS, '1', 'part2')]
ORES = os.path.join(ITEMS, 'ores', 'Style1')
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
FLAT_FRAMES = 16    # frames of a generated flat turntable (Arsenal, ores; it.115)
GRID_COLS = 8

FLARE_LOOT = 'https://raw.githubusercontent.com/flareteam/flare-game/v1.14/mods/fantasycore/'
OGA_GOLD = 'https://opengameart.org/sites/default/files/gold_0.png'

CREDITS = [
    'Flare loot coins (coins5/25/100.png): Clint Bellanger / Flare, CC-BY-SA 3.0, '
    'https://github.com/flareteam/flare-game/tree/v1.14/mods/fantasycore/images/loot',
    'Gold Treasure Icons (gold_0.png): Clint Bellanger, CC-BY-SA 3.0, '
    'https://opengameart.org/content/gold-treasure-icons',
    'Food / weapon / potion / scroll / drink turntables: polyy.ai, CC0',
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

#: THE ALES (it.115): the drinks the registry pours (`ALES`) - only these carry a
#: spin; the other 95 drinks keep their 64 px single (a 96 px strip is ~170 KB).
DRINK_SPINS = {
    '016_griffin', '017_dragon', '019_wolfsun', '021_starforge', '047_ambercrown',
    '048_knightshield', '050_bloodorange', '055_emeraldforest', '061_bronzerune', '063_druidwoodland',
}

#: THE MATERIALS (it.115): game material id -> ore number in `ores/Style1` (the
#: painted style; styles 2-9 are pixelations of the same rocks).
ORE_ART = {
    'iron_scrap': 10,   # silver-grey metal lump
    'arcane_dust': 11,  # bright blue crystal
    'essence': 28,      # teal crystal prism
    'alloy_shard': 21,  # violet amethyst
    'catalyst': 48,     # the golden geode
}

#: THE CURIOS (it.115): a new strip is saved with a 256-colour palette (a 96 px
#: polyy strip drops from ~270 KB to ~65 KB with no visible banding).
QUANTIZE_NEW = True
CURIO_TS = os.path.join(ROOT, 'src', 'items', 'curios.gen.ts')

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


def flat_turntable(im, n=FLAT_FRAMES, nearest=True, swing=55.0):
    """
    A TURNTABLE FOR FLAT ART (it.115). The Arsenal masters and the ores are
    single drawings; the cell still has to turn. A full flip showed the
    drawing edge-on (a sliver) two frames in sixteen, so the drawing ROCKS
    instead: it turns `swing` degrees each way on a sine, its width follows
    cos (never under 57%), the far half of the turn darkens a little and a
    faint sheen crosses it as it comes face-on. It loops without a seam.
    """
    im = im.convert('RGBA')
    w, h = im.size
    resample = Image.NEAREST if nearest else Image.LANCZOS
    frames = []
    for i in range(n):
        ang = np.radians(swing) * np.sin(2 * np.pi * i / n)
        c = float(np.cos(ang))
        nw = max(2, int(round(w * c)))
        f = np.array(im.resize((nw, h), resample)).astype(np.float32)
        shade = 0.78 + 0.22 * c
        sheen = c ** 12 * 0.14
        f[:, :, :3] = np.clip(f[:, :, :3] * shade + 255 * sheen, 0, 255)
        cell = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        fi = Image.fromarray(f.astype(np.uint8), 'RGBA')
        # The drawing hinges at its centre; a turn toward the viewer's right shifts the narrow face that way.
        off = (w - nw) // 2 + int(round(np.sin(ang) * (w - nw) * 0.35))
        cell.paste(fi, (max(0, min(w - nw, off)), 0), fi)
        frames.append(cell)
    return frames


def quantize_file(name):
    """Re-save an anim sheet with a 256-colour palette (alpha kept) - it.115."""
    if not QUANTIZE_NEW:
        return
    path = os.path.join(ATLAS, name + '.png')
    im = Image.open(path).convert('RGBA')
    im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)


def brew_of(im):
    """
    WHAT A BOTTLE POURS, BY ITS COLOUR (it.115). The saturation-weighted mean
    hue of the painted pixels: red heals, blue restores, violet does both,
    green hastens, orange and gold pour might, and a pale or grey vessel
    turns blows (stone).
    """
    a = np.array(im.convert('RGBA')).astype(np.float32) / 255.0
    m = a[:, :, 3] > 0.5
    rgb = a[:, :, :3][m]
    if not len(rgb):
        return 'stone'
    mx, mn = rgb.max(1), rgb.min(1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    w = sat * mx
    if sat.mean() < 0.2 or w.sum() < 1e-3:
        return 'stone'
    ang = np.radians(h)
    hue = (np.degrees(np.arctan2((np.sin(ang) * w).sum(), (np.cos(ang) * w).sum())) + 360) % 360
    if hue < 18 or hue >= 335:
        return 'heal'
    if hue < 58:
        return 'might'
    if hue < 165:
        return 'haste'
    if hue < 255:
        return 'mana'
    return 'elixir'


def title_of(words):
    """`sea-witch` / `herbal_healer` -> `Sea-Witch` / `Herbal Healer`."""
    return ' '.join('-'.join(p[:1].upper() + p[1:] for p in w.split('-')) for w in words.replace('_', ' ').split())


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


def drink_key(item):
    """`drinks-016-bottle-griffin` -> `016_griffin` (the number keeps repeated names apart)."""
    m = re.match(r'drinks-(\d{3})-(?:soda-bottle|bottle|can)-(.+)$', item)
    assert m, 'unexpected drink name %s' % item
    return '%s_%s' % (m.group(1), slug(m.group(2)))


def bake_drinks(preview):
    """THE DRINKS (it.115): every turntable in `1/` and `1/part2/`, icon and spin, like the food."""
    names, icons, spins = [], [], []
    DRINK_ROWS.clear()
    files = []
    for p in DRINK_PACKS:
        files += sorted(glob.glob(os.path.join(p, 'sprite', '%dpx_studio' % ICON_SIZE, 'drinks-*_nopalette.png')))
    assert len(files) == 105, 'expected 105 drinks, found %d' % len(files)
    for f in files:
        item = os.path.basename(f)[:-len('_nopalette.png')]
        pack = os.path.dirname(os.path.dirname(os.path.dirname(f)))
        key = drink_key(item)
        # EVERY DRINK TURNS (it.115): the ten ales keep their full-colour strips, the rest are quantized.
        icon, spin = bake_turntable('item_drink_' + key, 'spin_drink_' + key,
                                    turntable(pack, item, ICON_SIZE), turntable(pack, item, SPIN_SIZE), preview)
        if key not in DRINK_SPINS:
            quantize_file('spin_drink_' + key)
        names += ['item_drink_' + key, 'spin_drink_' + key]
        spins.append(spin)
        m = re.match(r'drinks-\d{3}-(soda-bottle|bottle|can)-(.+)$', item)
        DRINK_ROWS.append((key, title_of(m.group(2)), m.group(1).replace('soda-bottle', 'soda'), brew_of(icon)))
        icons.append((key, icon))
        print('  drink %-22s <- %s%s' % (key, item, ' (spin)' if key in DRINK_SPINS else ''))
    assert len(files) == len(spins), 'a drink went unspun'
    if preview:
        icon_grid(icons, os.path.join(PREVIEW_DIR, 'preview_drink_icons.png'), cols=15)
        spin_sheet(spins[:40], os.path.join(PREVIEW_DIR, 'preview_drink_spin.png'))
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
        write_anim('spin_arsenal_' + r['id'], {0: flat_turntable(im)}, nearest=True)
        names += ['arsenal_' + r['id'], 'spin_arsenal_' + r['id']]
        icons.append((r['id'], im))
    dst = os.path.join(ROOT, 'docs', 'arsenal-items.csv')
    shutil.copyfile(src_csv, dst)
    print('  %d arsenal icons; csv -> %s' % (len(rows), dst))
    if preview:
        icon_grid(icons, os.path.join(PREVIEW_DIR, 'preview_arsenal_icons.png'), cols=10)
        spin_sheet([flat_turntable(im) for _, im in icons[:24]], os.path.join(PREVIEW_DIR, 'preview_arsenal_spin.png'))
    return names


def ore_icon(n):
    """A Style1 rock, cropped to its paint, squared with a margin, at 64 px."""
    src = Image.open(os.path.join(ORES, '%d_256_style1.png' % n)).convert('RGBA')
    box = src.getbbox()
    bw, bh = box[2] - box[0], box[3] - box[1]
    side = max(bw, bh) + 8
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(src.crop(box), ((side - bw) // 2, (side - bh) // 2))
    return sq.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)


def bake_ores(preview):
    """THE MATERIALS (it.115): five painted ores at 64 px, each with a flat turntable."""
    names, icons, spins = [], [], []
    for key, n in ORE_ART.items():
        icon = ore_icon(n)
        write_single('item_ore_' + key, icon, nearest=False)
        spin = flat_turntable(icon, nearest=False)
        write_anim('spin_ore_' + key, {0: spin}, nearest=False)
        names += ['item_ore_' + key, 'spin_ore_' + key]
        icons.append((key, icon))
        spins.append(spin)
        print('  ore %-12s <- %d_256_style1.png' % (key, n))
    # The curio ores' turntables too (their rows are written by `curios`).
    for n in ORE_NUMBERS:
        key = 'o%02d' % n
        icon = ore_icon(n)
        write_single('item_ore_' + key, icon, nearest=False)
        write_anim('spin_ore_' + key, {0: flat_turntable(icon, nearest=False)}, nearest=False)
        quantize_file('spin_ore_' + key)
        names += ['item_ore_' + key, 'spin_ore_' + key]
    if preview:
        icon_grid(icons, os.path.join(PREVIEW_DIR, 'preview_ore_icons.png'), cols=5)
        spin_sheet(spins, os.path.join(PREVIEW_DIR, 'preview_ore_spin.png'))
    return names


#: Rows the curio group writes to `curios.gen.ts` (drinks fill theirs in `bake_drinks`).
DRINK_ROWS = []

#: THE OTHER ORES (it.115): every Style1 rock not in ORE_ART.
ORE_NUMBERS = [n for n in range(1, 60) if n not in ORE_ART.values()]


def bake_curios(preview):
    """
    THE CURIOS (it.115). Everything else the drop holds: 156 potions, 109
    scrolls and tomes, 54 ores - each an icon and a palette-quantized spin -
    and `src/items/curios.gen.ts`, the table `items/curios` turns into items
    (the brew of each bottle and scroll read from its colour by `brew_of`).
    The drinks' rows come from `bake_drinks`, which this group runs first.
    """
    names = bake_drinks(preview)
    potion_rows, scroll_rows, ore_rows = [], [], []
    picked = set(POTIONS.values())
    files = []
    for p in POTION_PACKS:
        files += glob.glob(os.path.join(p, 'sprite', '%dpx_studio' % ICON_SIZE, 'potion_*_nopalette.png'))
    icons = []
    for f in sorted(files, key=lambda f: int(os.path.basename(f).split('_')[1])):
        item = os.path.basename(f)[:-len('_nopalette.png')]
        m = re.match(r'potion_(\d+)_(.+)$', item)
        n = int(m.group(1))
        if n in picked:
            continue
        pack = os.path.dirname(os.path.dirname(os.path.dirname(f)))
        key = 'p%03d' % n
        icon, _ = bake_turntable('item_potion_' + key, 'spin_potion_' + key, f, turntable(pack, item, SPIN_SIZE), preview)
        quantize_file('spin_potion_' + key)
        names += ['item_potion_' + key, 'spin_potion_' + key]
        potion_rows.append((key, title_of(m.group(2)), brew_of(icon)))
        icons.append((key, icon))
        print('  potion %s %-26s %s' % (key, m.group(2), potion_rows[-1][2]))
    assert len(potion_rows) == 170 - len(picked), 'expected %d curio potions, found %d' % (170 - len(picked), len(potion_rows))
    picked = set(SCROLLS.values())
    files = []
    for p in SCROLL_PACKS:
        files += glob.glob(os.path.join(p, 'sprite', '%dpx_studio' % ICON_SIZE, '*_nopalette.png'))
    for f in sorted(files, key=lambda f: int(os.path.basename(f).split('_')[0])):
        item = os.path.basename(f)[:-len('_nopalette.png')]
        m = re.match(r'(\d+)_(unrolled-scroll|rolled-scroll|tome)_(.+)$', item)
        assert m, item
        n = int(m.group(1))
        if n in picked:
            continue
        pack = os.path.dirname(os.path.dirname(os.path.dirname(f)))
        key = 's%03d' % n
        icon, _ = bake_turntable('item_scroll_' + key, 'spin_scroll_' + key, f, turntable(pack, item, SPIN_SIZE), preview)
        quantize_file('spin_scroll_' + key)
        names += ['item_scroll_' + key, 'spin_scroll_' + key]
        scroll_rows.append((key, title_of(m.group(3)), 'tome' if m.group(2) == 'tome' else 'scroll', brew_of(icon)))
        icons.append((key, icon))
        print('  scroll %s %-26s %s' % (key, m.group(3), scroll_rows[-1][3]))
    assert len(scroll_rows) == 115 - len(picked), 'expected %d curio scrolls, found %d' % (115 - len(picked), len(scroll_rows))
    for n in ORE_NUMBERS:
        key = 'o%02d' % n
        icon = ore_icon(n)
        write_single('item_ore_' + key, icon, nearest=False)
        write_anim('spin_ore_' + key, {0: flat_turntable(icon, nearest=False)}, nearest=False)
        quantize_file('spin_ore_' + key)
        names += ['item_ore_' + key, 'spin_ore_' + key]
        ore_rows.append((key, n))
        icons.append((key, icon))
    print('  %d potions, %d scrolls, %d ores' % (len(potion_rows), len(scroll_rows), len(ore_rows)))
    write_curio_table(potion_rows, scroll_rows, ore_rows)
    if preview:
        icon_grid(icons, os.path.join(PREVIEW_DIR, 'preview_curio_icons.png'), cols=20)
    return names


def write_curio_table(potions, scrolls, ores):
    def q(v):
        return json.dumps(v, ensure_ascii=False).replace('"', "'")
    out = [
        '/**',
        ' * @module items/curios.gen',
        ' * GENERATED by `scripts/bake-items.py --only curios` (it.115) - do not edit by hand.',
        ' * Every drink, potion, scroll and ore of the item drop the bake turned into an',
        ' * icon (`item_*`) and a spin (`spin_*`); `brew` is read from the colour of the art.',
        ' * `items/curios` turns these rows into items.',
        ' */',
        '',
        "export type CurioBrew = 'heal' | 'mana' | 'elixir' | 'haste' | 'might' | 'stone';",
        '',
        '/** [key, title, vessel, brew] - `item_drink_<key>` / `spin_drink_<key>`. */',
        "export const GEN_DRINKS: ReadonlyArray<readonly [string, string, 'can' | 'bottle' | 'soda', CurioBrew]> = [",
    ]
    out += ['  [%s, %s, %s, %s],' % (q(k), q(t), q(v), q(b)) for k, t, v, b in DRINK_ROWS]
    out += ['];', '', '/** [key, title, brew] - `item_potion_<key>` / `spin_potion_<key>`. */',
            'export const GEN_POTIONS: ReadonlyArray<readonly [string, string, CurioBrew]> = [']
    out += ['  [%s, %s, %s],' % (q(k), q(t), q(b)) for k, t, b in potions]
    out += ['];', '', '/** [key, title, form, brew] - `item_scroll_<key>` / `spin_scroll_<key>`. */',
            "export const GEN_SCROLLS: ReadonlyArray<readonly [string, string, 'scroll' | 'tome', CurioBrew]> = ["]
    out += ['  [%s, %s, %s, %s],' % (q(k), q(t), q(f), q(b)) for k, t, f, b in scrolls]
    out += ['];', '', '/** [key, rock number in ores/Style1] - `item_ore_<key>` / `spin_ore_<key>`. */',
            'export const GEN_ORES: ReadonlyArray<readonly [string, number]> = [']
    out += ['  [%s, %d],' % (q(k), n) for k, n in ores]
    out += ['];', '']
    with open(CURIO_TS, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(out))
    print('  table ->', CURIO_TS)


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
    'drinks': bake_drinks,
    'arsenal': bake_arsenal,
    'ores': bake_ores,
    'coins': bake_coins,
    'curios': bake_curios,
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
    groups = args.only or ['food', 'potions', 'scrolls', 'weapons', 'curios', 'arsenal', 'ores', 'coins']  # curios bakes the drinks first
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
