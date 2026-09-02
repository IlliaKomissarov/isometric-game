/**
 * ASSET PURGE (it.36).
 *
 * The game now loads sprites ONLY from public/assets/atlas/ (pre-baked
 * grid atlases, see src/render/SpriteLibrary.ts) and audio ONLY from the
 * explicit file list in src/engine/AudioManager.ts. Everything else under
 * public/assets — the raw sprite packs (~2.5 GB, 300k+ files), unused
 * audio packs, dummy folders — is dead weight that bloats builds/clones.
 *
 * Two modes:
 *   node scripts/purge-assets.mjs --quarantine <dir>   move unreferenced
 *        files/dirs into <dir> (reversible; used for the QA pass)
 *   node scripts/purge-assets.mjs --delete              delete permanently
 *   node scripts/purge-assets.mjs                       dry run (report)
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve('public/assets');
const mode = process.argv.includes('--delete') ? 'delete' : process.argv.includes('--quarantine') ? 'quarantine' : 'dry';
const quarantineDir = mode === 'quarantine' ? resolve(process.argv[process.argv.indexOf('--quarantine') + 1]) : null;

/** Top-level entries kept whole. */
const KEEP_DIRS = new Set(['atlas', 'ui']);
const KEEP_FILES = new Set(['README.md']);

/** Audio keep list — mirrors AudioManager.ts exactly (relative to audio/). */
const T = 'Free Fantasy SFX Pack By TomMusic';
const SFX = `${T}/OGG Files/SFX`;
const SW = `${SFX}/Attacks/Sword Attacks Hits and Blocks`;
const BW = `${SFX}/Attacks/Bow Attacks Hits and Blocks`;
const H = 'Horror SFX Free';
const HG = `${H}/Monsters & Ghosts`;
const HA = `${H}/Ambient`;
const HS = `${H}/Stingers and Spooky Triggers`;
const seq = (dir, stem, n) => Array.from({ length: n }, (_, i) => `${dir}/${stem} ${i + 1}.ogg`);
const AUDIO_KEEP = new Set([
  '.gitkeep',
  'universfield-mystic-reveal-567294.mp3',
  'universfield-dark-mystery-cinematic-485921.mp3',
  'alesiadavina-dark-demonic-atmosphere-gloomy-horror-drone-sfx-541953.mp3',
  'kave_msri-war-horn-sfx-319881.mp3',
  'yodguard-dark-magic-6-378652.mp3',
  'yodguard-dark-spell-chant-3-533018.mp3',
  'alesiadavina-demonic-presence-detected-dark-beast-breathing-sfx-543185.mp3',
  'alesiadavina-unleashed-demon-ambience-dark-cinematic-horror-drone-543191.mp3',
  'boss fight/1. Whispers of the Abyss.mp3',
  'boss fight/2. Shadowforge Convergence.mp3',
  'boss fight/3. Eclipsed Desolation.mp3',
  'boss fight/4. Cursed Citadel .mp3',
  'boss fight/5. Dread March .mp3',
  'boss fight/6. Veil of Eternal Nightfall.mp3',
  `${T}/ReadMe.txt`,
  ...seq(SW, 'Sword Attack', 3),
  ...seq(SW, 'Sword Impact Hit', 3),
  ...seq(SW, 'Sword Blocked', 3),
  ...seq(SW, 'Sword Parry', 3),
  ...seq(SW, 'Sword Sheath', 2),
  ...seq(SW, 'Sword Unsheath', 2),
  ...seq(BW, 'Bow Attack', 2),
  ...seq(BW, 'Bow Impact Hit', 3),
  ...seq(BW, 'Bow Blocked', 3),
  ...seq(`${SFX}/Chopping and Mining`, 'chop', 4),
  ...seq(`${SFX}/Spells`, 'Fireball', 3),
  ...seq(`${SFX}/Spells`, 'Spell Impact', 3),
  ...seq(`${SFX}/Spells`, 'Ice Freeze', 2),
  ...seq(`${SFX}/Spells`, 'Firebuff', 2),
  ...seq(`${SFX}/Spells`, 'Firespray', 2),
  ...seq(`${SFX}/Doors Gates and Chests`, 'Chest Open', 2),
  `${SFX}/Doors Gates and Chests/Lock Unlock.ogg`,
  `${SFX}/Doors Gates and Chests/Gate Open.ogg`,
  ...seq(`${SFX}/Doors Gates and Chests`, 'Door Open', 2),
  `${SFX}/Doors Gates and Chests/Door Close 1.ogg`,
  ...seq(`${SFX}/Footsteps/Stone`, 'Stone Run', 5),
  `${T}/OGG Files/BGS Loops/Cave/Cave.ogg`,
  ...['pop_1', 'pop_2', 'pop_3', 'select_1', 'select_2', 'select_3', 'click_double_on', 'click_double_on_2', 'cancel', 'toggle_on', 'toggle_off'].map((n) => `${T}/UI/${n}.wav`),
  ...['book_open', 'book_close', 'map_open', 'map_close', 'item_equip', 'coin_collect', 'coins_gather_small', 'coins_gather_quick', 'gem_collect', 'heart_collect'].map((n) => `${T}/Items/${n}.wav`),
  `${HA}/Scream.wav`,
  `${HG}/Ghost_scream_3.wav`,
  `${HA}/Distant Yell_Echo and Reverb_2.wav`,
  `${HG}/Zombie.wav`,
  `${HG}/Zombie_6.wav`,
  `${HG}/Zombie_8.wav`,
  `${HG}/Monster_growl_1.wav`,
  `${HG}/Monster_growl_5.wav`,
  `${HG}/Monster_breath.wav`,
  `${HG}/Monster_grunt x2 (ghmmm).wav`,
  `${HG}/Monster_grunt_long.wav`,
  `${HG}/Hiss.wav`,
  `${HG}/Monster_Roar_2.wav`,
  `${HG}/Monster_Roar_4.wav`,
  `${HG}/Gore_Wet_4.wav`,
  `${HG}/Gore_Wet_7.wav`,
  `${HG}/Gore_Ripping_4.wav`,
  `${HG}/Gore_Ripping_5.wav`,
  `${HG}/Bite.wav`,
  `${HG}/Injured.wav`,
  `${H}/Character/Gasp.wav`,
  `${H}/Character/Gasp_3.wav`,
  `${HG}/Ghost_moan_2.wav`,
  `${HG}/Tone_Moaning.wav`,
  `${HS}/Piano_stinger_dissonent.wav`,
  `${HS}/Piano_stinger_dissonent_2.wav`,
  `${HS}/Stinger.wav`,
  `${HS}/Metal_resonance.wav`,
  `${HA}/Bell_low.wav`,
  `${HA}/Creepy_ambience_3.wav`,
  `${HA}/Creepy_ambience_5.wav`,
  `${HS}/Spooky Ambience.wav`,
  `${HA}/Drone_doom.wav`,
  `${HG}/Ghost chior.wav`,
  `${HA}/Old House_creeky metal and wood_ambiance_7.wav`,
]);

let moved = 0;
let bytes = 0;
const missing = [];

function sizeOf(p) {
  try {
    const st = statSync(p);
    if (st.isFile()) return st.size;
    let total = 0;
    for (const e of readdirSync(p)) total += sizeOf(join(p, e));
    return total;
  } catch {
    return 0;
  }
}

function purge(abs) {
  const rel = relative(ROOT, abs).split('\\').join('/');
  bytes += sizeOf(abs);
  moved++;
  if (mode === 'dry') return;
  if (mode === 'delete') {
    rmSync(abs, { recursive: true, force: true });
    return;
  }
  const dest = join(quarantineDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(abs, dest);
}

// 1. Top level: everything but atlas/ + audio/ + README.md goes.
for (const e of readdirSync(ROOT)) {
  if (KEEP_DIRS.has(e) || KEEP_FILES.has(e) || e === 'audio') continue;
  purge(join(ROOT, e));
}

// 2. Audio: walk, keep only the list.
const AUDIO = join(ROOT, 'audio');
for (const f of AUDIO_KEEP) if (!existsSync(join(AUDIO, f))) missing.push(f);
function walkAudio(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    const rel = relative(AUDIO, abs).split('\\').join('/');
    if (e.isDirectory()) {
      // Keep the directory only if some kept file lives inside it.
      const keepsInside = [...AUDIO_KEEP].some((k) => k.startsWith(rel + '/'));
      if (!keepsInside) purge(abs);
      else walkAudio(abs);
    } else if (!AUDIO_KEEP.has(rel)) {
      purge(abs);
    }
  }
}
walkAudio(AUDIO);

console.log(`[purge:${mode}] ${moved} entries, ${(bytes / 1048576).toFixed(1)} MB`);
if (missing.length) console.warn('[purge] KEEP-LIST FILES MISSING ON DISK:\n  ' + missing.join('\n  '));
console.log(`[purge] remaining: ${(sizeOf(ROOT) / 1048576).toFixed(1)} MB under public/assets`);
