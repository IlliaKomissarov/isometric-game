"""
THE VFX BAKE (it.114): the graphics-update effect strips -> `fx_*` one-direction anims.

Every effect here is a ONE-direction strip (`dirCount: 1`) that `src/render/Vfx.ts`
plays at a caller-chosen fps, usually additive, exactly like the twenty older
`vfx_*` strips. This bake is a TABLE of (name, source) rows over six vendors:

  * unTied Games "Super Pixel Effects Gigapack (Free)" - per-frame PNGs, the
    LARGE size variant of each effect (the free version ships one colour each);
  * unTied Games "Will's Pixel Explosions" sample - 100x100, 60 fps captures
    (64-82 frames) decimated to 24;
  * PIXELCORE free sampler - 64x64 per-frame;
  * GameFX export - single-row transparent strip sheets, cell size in the name;
  * Frostwindz class VFX packs 1..5 and the root lightning set VFX1..6 -
    per-frame PNGs (`*_frameN.png`, N from 1), painted, 128x128 / 256x128 / 128x256;
  * Pipoya light pillar - 5-column grid of 192x192, back/front halves.

Rules: bake at SOURCE resolution (never upscale), cap at 24 frames with
`bakelib.decimate`, keep the true alpha as-is, drop fully-transparent frames at
either end of a clip (dead air). Pixel-art vendors -> `nearest=True`; the
painted ones (Frostwindz, Pipoya) -> `nearest=False`.

    python scripts/bake-vfx.py                 # bake everything
    python scripts/bake-vfx.py --only fx_heal  # one entry (repeatable, prefix ok)
    python scripts/bake-vfx.py --preview       # contact sheets, no atlas writes
    python scripts/bake-vfx.py --list          # print the table and exit
"""
import argparse
import glob
import os
import re
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakelib import ATLAS, DROP, contact_sheet, decimate, register_anims, union_bbox, write_anim  # noqa: E402

VFX = os.path.join(DROP, 'vfx animations')
GIGA = os.path.join(VFX, 'Super Pixel Effects Gigapack (Free Version)', 'PNG')
WILLS = os.path.join(VFX, 'wills_pixel_explosions_sample')
PIXELCORE = os.path.join(VFX, 'PIXELCORE_FreeSampler', 'frames')
GAMEFX = os.path.join(VFX, 'GameFXexport', 'SPRITESHEET_Files')
PIPOYA = os.path.join(VFX, 'Pipoya VFX LightPillar', '192x192')

MAX_FRAMES = 24
PREVIEW_DIR = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
    'Temp', 'claude', 'C--Users-user-Desktop-isometric-game',
    '9b751797-5b62-470f-a302-7c92b37a98e4', 'scratchpad', 'bake-vfx')


# ---------------------------------------------------------------------------
# SOURCE LOADERS - each returns a list of RGBA PIL frames in play order
# ---------------------------------------------------------------------------


def _num(path):
    """The LAST integer in a file name, for `frame0007.png` and `X_skill1_frame10.png` alike."""
    m = re.findall(r'(\d+)', os.path.basename(path))
    return int(m[-1]) if m else 0


def frames_in(folder, pattern='*.png'):
    files = glob.glob(os.path.join(folder, pattern))
    files = [f for f in files if f.lower().endswith('.png')]
    assert files, 'no frames in %s' % folder
    files.sort(key=_num)
    return [Image.open(f).convert('RGBA') for f in files]


def giga(family, effect, colour=None):
    """The LARGE variant of a gigapack effect (`colour` picks among colour variants when several exist)."""
    def load():
        base = os.path.join(GIGA, family, effect)
        variants = sorted(d for d in glob.glob(os.path.join(base, effect + '_large_*')) if os.path.isdir(d))
        assert variants, 'no large variant under %s' % base
        if colour:
            pick = [v for v in variants if v.endswith('_' + colour)]
            variants = pick or variants
        return frames_in(variants[0], 'frame*.png')
    load.desc = 'gigapack PNG/%s/%s (large%s)' % (family, effect, ', ' + colour if colour else '')
    return load


def wills(effect):
    def load():
        return frames_in(os.path.join(WILLS, effect, 'PNG'), 'frame*.png')
    load.desc = 'wills_pixel_explosions_sample/%s/PNG' % effect
    return load


def pixelcore(effect):
    def load():
        return frames_in(os.path.join(PIXELCORE, effect), 'frame_*.png')
    load.desc = 'PIXELCORE_FreeSampler/frames/%s' % effect
    return load


def strip(path, cell=None):
    """A one-row strip sheet; the cell is square and named in the file (`_96x96`, `_96`) unless given."""
    def load():
        im = Image.open(path).convert('RGBA')
        w, h = im.size
        c = cell
        if c is None:
            m = re.search(r'_(\d+)(?:x(\d+))?\.png$', os.path.basename(path))
            c = (int(m.group(1)), int(m.group(2) or m.group(1))) if m else (h, h)
        cw, ch = c
        assert h == ch and w % cw == 0, '%s: %dx%d is not a row of %dx%d cells' % (path, w, h, cw, ch)
        return [im.crop((i * cw, 0, (i + 1) * cw, ch)) for i in range(w // cw)]
    load.desc = os.path.relpath(path, VFX)
    return load


def gamefx(fname):
    return strip(os.path.join(GAMEFX, fname))


def frost(*parts):
    """A Frostwindz per-frame folder, e.g. frost('1', 'VFX1', 'frames')."""
    def load():
        return frames_in(os.path.join(VFX, *parts), '*frame*.png')
    load.desc = '/'.join(parts)
    return load


def grid(path, cols, cell):
    """A row-major grid sheet (Pipoya: 5 columns of 192x192)."""
    def load():
        im = Image.open(path).convert('RGBA')
        w, h = im.size
        cw, ch = cell
        rows = h // ch
        out = []
        for r in range(rows):
            for c in range(cols):
                out.append(im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)))
        return out
    load.desc = os.path.relpath(path, VFX)
    return load


# ---------------------------------------------------------------------------
# THE TABLE: name -> (loader, nearest, fps, blend, pose)
#   fps/blend/pose are RECOMMENDATIONS for the call site (not stored in the manifest):
#   blend 'add' | 'normal'; pose 'flat' (rings, circles, splats) | 'upright'.
# ---------------------------------------------------------------------------

PIX = True
PAINT = False
G = 'Explosions'
TABLE = [
    # explosions
    ('fx_explosion_a', giga(G, 'epic_explosion_001'), PIX, 15, 'add', 'upright'),
    ('fx_explosion_b', giga(G, 'stylized_explosion_001'), PIX, 15, 'add', 'upright'),
    ('fx_explosion_c', giga(G, 'symmetrical_explosion_002'), PIX, 15, 'add', 'upright'),
    ('fx_explosion_big', wills('round_explosion'), PIX, 20, 'add', 'upright'),
    ('fx_explosion_tall', wills('vertical_explosion'), PIX, 20, 'add', 'upright'),
    ('fx_xplosion', wills('X_plosion'), PIX, 20, 'add', 'upright'),
    ('fx_vortex', wills('round_vortex'), PIX, 20, 'add', 'flat'),
    # impacts
    ('fx_impact_dir_a', giga('Impacts', 'directional_impact_001'), PIX, 15, 'add', 'upright'),
    ('fx_impact_dir_b', giga('Impacts', 'directional_impact_002'), PIX, 15, 'add', 'upright'),
    ('fx_impact_dir_c', giga('Impacts', 'directional_impact_003'), PIX, 15, 'add', 'upright'),
    ('fx_impact_dir_d', giga('Impacts', 'directional_impact_004'), PIX, 15, 'add', 'upright'),
    ('fx_impact_a', giga('Impacts', 'symmetrical_impact_001'), PIX, 15, 'add', 'upright'),
    ('fx_impact_b', giga('Impacts', 'symmetrical_impact_002'), PIX, 15, 'add', 'upright'),
    ('fx_impact_c', giga('Impacts', 'symmetrical_impact_003'), PIX, 15, 'add', 'upright'),
    ('fx_impact_d', giga('Impacts', 'symmetrical_impact_004'), PIX, 15, 'add', 'upright'),
    ('fx_impact_e', giga('Impacts', 'symmetrical_impact_006'), PIX, 15, 'add', 'upright'),
    # blood / splatters. burst_splatter_003 only ships GREEN in the free pack, so
    # fx_splat_b IS the green splat (tint it at the call site for red).
    ('fx_splat_a', giga('Splatters', 'burst_splatter_001', 'red'), PIX, 15, 'normal', 'flat'),
    ('fx_splat_b', giga('Splatters', 'burst_splatter_003', 'green'), PIX, 15, 'normal', 'flat'),
    ('fx_splat_dir_a', giga('Splatters', 'directional_splatter_001', 'red'), PIX, 15, 'normal', 'upright'),
    ('fx_splat_dir_b', giga('Splatters', 'directional_splatter_003', 'red'), PIX, 15, 'normal', 'upright'),
    # smoke
    ('fx_smoke_dir', giga('Smoke Bursts', 'directional_smoke_burst_001'), PIX, 15, 'normal', 'upright'),
    ('fx_smoke_burst', giga('Smoke Bursts', 'symmetrical_smoke_burst_001'), PIX, 15, 'normal', 'upright'),
    ('fx_skull_smoke', giga('Smoke Bursts', 'stylized_skull_smoke_burst_001'), PIX, 15, 'normal', 'upright'),
    # fantasy spells / status
    ('fx_absorb', giga('Fantasy Spells', 'spell_absorb_001'), PIX, 15, 'add', 'upright'),
    ('fx_attack_up', giga('Fantasy Spells', 'spell_attack_up_001'), PIX, 15, 'add', 'upright'),
    ('fx_death', giga('Fantasy Spells', 'spell_death_001'), PIX, 15, 'add', 'upright'),
    ('fx_defense_up', giga('Fantasy Spells', 'spell_defense_up_001'), PIX, 15, 'add', 'upright'),
    ('fx_haste', giga('Fantasy Spells', 'spell_haste_001'), PIX, 15, 'add', 'upright'),
    ('fx_heal', giga('Fantasy Spells', 'spell_heal_001'), PIX, 15, 'add', 'upright'),
    ('fx_poison', giga('Fantasy Spells', 'spell_poison_001'), PIX, 15, 'add', 'upright'),
    ('fx_status_poison', giga('Fantasy Spells', 'status_poison_001'), PIX, 15, 'add', 'upright'),
    ('fx_status_sparkle', giga('Fantasy Spells', 'status_sparkling_001'), PIX, 15, 'add', 'upright'),
    # lightning
    ('fx_lightning_burst_a', giga('Lightning', 'lightning_burst_001'), PIX, 15, 'add', 'upright'),
    ('fx_lightning_burst_b', giga('Lightning', 'lightning_burst_002'), PIX, 15, 'add', 'upright'),
    ('fx_lightning_burst_c', giga('Lightning', 'lightning_burst_003'), PIX, 15, 'add', 'upright'),
    ('fx_lightning_strike', giga('Lightning', 'lightning_strike_001'), PIX, 15, 'add', 'upright'),
    # magic bursts
    ('fx_sparkle_a', giga('Magic Bursts', 'round_sparkle_burst_001'), PIX, 15, 'add', 'upright'),
    ('fx_sparkle_b', giga('Magic Bursts', 'round_sparkle_burst_002'), PIX, 15, 'add', 'upright'),
    ('fx_sparkle_c', giga('Magic Bursts', 'round_sparkle_burst_003'), PIX, 15, 'add', 'upright'),
    ('fx_light_burst', giga('Magic Bursts', 'round_light_burst_001'), PIX, 15, 'add', 'upright'),
    ('fx_coin_burst', giga('Magic Bursts', 'directional_coin_burst_001'), PIX, 15, 'normal', 'upright'),
    ('fx_firework_a', giga('Magic Bursts', 'round_firework_burst_001'), PIX, 15, 'add', 'upright'),
    # sci-fi reused as magic
    ('fx_warp_a', giga('Sci-fi', 'scifi_warp_001'), PIX, 15, 'add', 'upright'),
    ('fx_warp_b', giga('Sci-fi', 'scifi_warp_002'), PIX, 15, 'add', 'upright'),
    ('fx_warp_c', giga('Sci-fi', 'scifi_warp_003'), PIX, 15, 'add', 'upright'),
    ('fx_charge', giga('Sci-fi', 'scifi_charge_up_001'), PIX, 15, 'add', 'upright'),
    ('fx_spark_burst', giga('Sci-fi', 'scifi_spark_burst_001'), PIX, 15, 'add', 'upright'),
    # symbols
    ('fx_levelup_text', giga('Symbols', 'symbol_level_up_text_001'), PIX, 15, 'normal', 'upright'),
    ('fx_alert', giga('Symbols', 'symbol_alert_001'), PIX, 15, 'normal', 'upright'),
    ('fx_warning', giga('Symbols', 'symbol_warning_001'), PIX, 15, 'normal', 'upright'),
    ('fx_crown', giga('Symbols', 'symbol_crown_001'), PIX, 15, 'normal', 'upright'),
    # PIXELCORE
    ('fx_blast_big', pixelcore('blast_big'), PIX, 15, 'add', 'upright'),
    ('fx_boss_death', pixelcore('boss_death'), PIX, 15, 'add', 'upright'),
    ('fx_campfire', pixelcore('campfire'), PIX, 15, 'add', 'upright'),
    ('fx_crit_star', pixelcore('crit_star'), PIX, 15, 'add', 'upright'),
    ('fx_dash_trail', pixelcore('dash_trail'), PIX, 15, 'add', 'flat'),
    ('fx_energy_bolt', pixelcore('energy_bolt'), PIX, 15, 'add', 'upright'),
    ('fx_fire_pillar', pixelcore('fire_pillar'), PIX, 15, 'add', 'upright'),
    ('fx_levelup', pixelcore('level_up'), PIX, 15, 'add', 'upright'),
    ('fx_magic_circle', pixelcore('magic_circle'), PIX, 15, 'add', 'flat'),
    ('fx_treasure_burst', pixelcore('treasure_burst'), PIX, 15, 'add', 'upright'),
    ('fx_wide_arc', pixelcore('wide_arc'), PIX, 15, 'add', 'upright'),
    # GameFX
    ('fx_fireball_a', gamefx('FireBall_64x64.png'), PIX, 24, 'add', 'upright'),
    ('fx_fireball_b', gamefx('FireBall_2_64x64.png'), PIX, 24, 'add', 'upright'),
    ('fx_fireball_c', gamefx('FireBall_3_64x64.png'), PIX, 24, 'add', 'upright'),
    ('fx_fire_burst', gamefx('FireBurst_64x64.png'), PIX, 24, 'add', 'upright'),
    ('fx_fire_cast', gamefx('FireCast_96x96.png'), PIX, 24, 'add', 'flat'),
    ('fx_gexplosion_a', gamefx('Explosion_96x96.png'), PIX, 24, 'add', 'upright'),
    ('fx_gexplosion_b', gamefx('Explosion_2_64x64.png'), PIX, 24, 'add', 'upright'),
    ('fx_gexplosion_c', gamefx('Explosion_3_133x133.png'), PIX, 24, 'add', 'upright'),
    ('fx_ice_cast', gamefx('IceCast_96x96.png'), PIX, 24, 'add', 'flat'),
    ('fx_ice_pick', gamefx('IcePick_64x64.png'), PIX, 24, 'add', 'upright'),
    ('fx_ice_shatter_a', gamefx('IceShatter_96x96.png'), PIX, 24, 'add', 'upright'),
    ('fx_ice_shatter_b', gamefx('IceShatter_2_96x96.png'), PIX, 24, 'add', 'upright'),
    ('fx_light_cast', gamefx('LightCast_96.png'), PIX, 24, 'add', 'flat'),
    ('fx_holy_explosion', gamefx('HolyExplosion_96x96.png'), PIX, 24, 'add', 'upright'),
    ('fx_poison_cast', gamefx('PoisonCast_96x96.png'), PIX, 24, 'add', 'flat'),
    ('fx_poison_claw', gamefx('PoisonClaw_96x96.png'), PIX, 24, 'add', 'upright'),
    ('fx_magic_barrier', gamefx('MagicBarrier_64x64.png'), PIX, 24, 'add', 'upright'),
    ('fx_tornado_loop', gamefx('TornadoLoop_96x96.png'), PIX, 24, 'add', 'upright'),
    ('fx_tornado_static', gamefx('TornadoStatic_96x96.png'), PIX, 24, 'add', 'upright'),
    ('fx_star_small', gamefx('SmallStar_64x64.png'), PIX, 24, 'add', 'upright'),
    ('fx_star_medium', gamefx('MediumStar_64x64.png'), PIX, 24, 'add', 'upright'),
    # Frostwindz 1 FrostKnight
    ('fx_frost_1', frost('1', 'VFX1', 'frames'), PAINT, 18, 'add', 'upright'),
    ('fx_frost_2', frost('1', 'VFX2', 'frames'), PAINT, 18, 'add', 'upright'),
    ('fx_frost_3', frost('1', 'VFX3', 'Frames'), PAINT, 18, 'add', 'upright'),
    # Frostwindz 2 BloodMage
    ('fx_blood_1_start', frost('2', 'VFX1', 'part1(start)', 'frames'), PAINT, 18, 'normal', 'upright'),
    ('fx_blood_1_loop', frost('2', 'VFX1', 'part2(loop)', 'frames'), PAINT, 18, 'normal', 'upright'),
    ('fx_blood_1_end', frost('2', 'VFX1', 'part3(end)', 'frames'), PAINT, 18, 'normal', 'upright'),
    ('fx_blood_2', frost('2', 'VFX2', 'frames'), PAINT, 18, 'normal', 'upright'),
    ('fx_blood_3', frost('2', 'VFX3', 'frames'), PAINT, 18, 'normal', 'upright'),
    # Frostwindz 3 Necromancer
    ('fx_necro_1', frost('3', 'VFX 1', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_necro_2', frost('3', 'VFX 2', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_necro_3', frost('3', 'VFX 3', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_necro_4', frost('3', 'VFX 4', 'Frames'), PAINT, 18, 'add', 'upright'),
    # Frostwindz 4 Priest
    ('fx_priest_1', frost('4', 'VFX 1', 'frames'), PAINT, 18, 'add', 'upright'),
    ('fx_priest_2', frost('4', 'VFX 2', 'frames'), PAINT, 18, 'add', 'upright'),
    ('fx_priest_3', frost('4', 'VFX 3', 'frames'), PAINT, 18, 'add', 'upright'),
    # Frostwindz 5 Paladin
    ('fx_paladin_1', frost('5', 'VFX 1', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_paladin_2', frost('5', 'VFX 2', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_paladin_3', frost('5', 'VFX 3', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_paladin_4', frost('5', 'VFX 4', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_paladin_5', frost('5', 'VFX5', 'Frames'), PAINT, 18, 'add', 'upright'),
    # Frostwindz lightning (root VFX1..6)
    ('fx_bolt_1', frost('VFX1', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_bolt_2', frost('VFX2', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_bolt_3', frost('VFX3', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_bolt_4', frost('VFX4', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_bolt_5', frost('VFX5', 'Frames'), PAINT, 18, 'add', 'upright'),
    ('fx_bolt_6', frost('VFX6', 'Frames'), PAINT, 18, 'add', 'upright'),
    # Pipoya light pillar (back half behind the body, front half over it)
    ('fx_pillar_back', grid(os.path.join(PIPOYA, 'pipo-mapeffect013a-back.png'), 5, (192, 192)), PAINT, 18, 'add', 'upright'),
    ('fx_pillar_front', grid(os.path.join(PIPOYA, 'pipo-mapeffect013a-front.png'), 5, (192, 192)), PAINT, 18, 'add', 'upright'),
]


# ---------------------------------------------------------------------------
# THE BAKE
# ---------------------------------------------------------------------------


def trim_dead_air(frames, thresh=8):
    """Drop fully transparent frames at the START and END of a clip (never the middle)."""
    def painted(f):
        return f.getchannel('A').getextrema()[1] > thresh
    lo = 0
    hi = len(frames)
    while lo < hi and not painted(frames[lo]):
        lo += 1
    while hi > lo and not painted(frames[hi - 1]):
        hi -= 1
    assert hi > lo, 'every frame is empty'
    return frames[lo:hi], lo, len(frames) - hi


def prepare(loader):
    raw = loader()
    sizes = {f.size for f in raw}
    assert len(sizes) == 1, 'mixed frame sizes %s' % sizes
    frames, cut_lo, cut_hi = trim_dead_air(raw)
    frames = decimate(frames, MAX_FRAMES)
    return frames, len(raw), cut_lo, cut_hi


def preview_cell(size, n, max_w=1800):
    """Shrink contact-sheet cells so the sheet stays viewable (never enlarge)."""
    w, h = size
    k = min(1.0, max_w / float(w * n))
    return (max(1, int(w * k)), max(1, int(h * k)))


def verify(name, entry):
    path = os.path.join(ATLAS, entry['file'])
    assert os.path.isfile(path), '%s: missing %s' % (name, path)
    im = Image.open(path)
    want = (entry['cellW'] * entry['frameCount'], entry['cellH'] * entry['dirCount'])
    assert im.size == want, '%s: sheet is %s, manifest says %s' % (name, im.size, want)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', action='append', default=[], help='bake only this name (prefix match, repeatable)')
    ap.add_argument('--preview', action='store_true', help='write contact sheets, do not touch the atlas')
    ap.add_argument('--list', action='store_true', help='print the table and exit')
    args = ap.parse_args()

    rows = TABLE
    if args.only:
        rows = [r for r in TABLE if any(r[0] == o or r[0].startswith(o) for o in args.only)]
        assert rows, 'nothing matches --only %s' % args.only
    if args.list:
        for name, loader, nearest, fps, blend, pose in rows:
            print('%-22s %-8s fps=%-2d %-6s %-7s %s' % (name, 'nearest' if nearest else 'linear', fps, blend, pose, loader.desc))
        return

    names = [r[0] for r in TABLE]
    assert len(names) == len(set(names)), 'duplicate names in TABLE'
    assert all(n.startswith('fx_') for n in names), 'every name must start with fx_'

    report = []
    for name, loader, nearest, fps, blend, pose in rows:
        frames, n_raw, cut_lo, cut_hi = prepare(loader)
        w, h = frames[0].size
        if args.preview:
            contact_sheet({0: frames}, os.path.join(PREVIEW_DIR, name + '.png'), cell=preview_cell((w, h), len(frames)))
            box = union_bbox(frames)
            cw, ch = box[2] - box[0] + 1, box[3] - box[1] + 1
        else:
            entry = write_anim(name, {0: frames}, nearest=nearest)
            verify(name, entry)
            cw, ch = entry['cellW'], entry['cellH']
        cut = '' if not (cut_lo or cut_hi) else ' (dead air -%d/-%d)' % (cut_lo, cut_hi)
        line = '%-22s %2d frames (of %2d%s)  cell %3dx%-3d  src %3dx%-3d  %-7s fps=%-2d %-6s %-7s  %s' % (
            name, len(frames), n_raw, cut, cw, ch, w, h, 'nearest' if nearest else 'linear', fps, blend, pose, loader.desc)
        print(line)
        report.append(line)
    print('%s %d strips%s' % ('previewed' if args.preview else 'baked', len(rows), ' -> ' + PREVIEW_DIR if args.preview else ''))


if __name__ == '__main__':
    main()
