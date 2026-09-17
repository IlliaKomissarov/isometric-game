/**
 * @module render/costumes
 * THE WARDROBE (it.114). Every body the game can draw as a set of sheets, with
 * the label the owner will use to talk about it and where it came from.
 *
 * Two consumers:
 *   - THE MENAGERIE (the try-out arena): it.115 - the hero stays the hero; a
 *     picked body is SUMMONED as a display model on its own marked spot
 *     (`render/Puppet`), and plays its clips on demand. The owner names what
 *     he sees in a bug report ("the treant's attack") from the label here.
 *   - THE BESTIARY: the same labels and sources under each page.
 *
 * Enemy kinds that already exist in `ENEMY_TYPES` are added at runtime from
 * their own sprite blocks (see `costumesForKinds` in main); this table holds
 * the sheets baked from the graphics-update drop that are not yet an
 * `EnemyKind`, and the townsfolk, who never were.
 */

export type CostumeShelf = 'host' | 'warden' | 'man' | 'folk' | 'watch' | 'drop';

/** The shelves in picker order, with their labels. */
export const SHELVES: ReadonlyArray<{ id: CostumeShelf; label: string }> = [
  { id: 'host', label: 'THE HOST' },
  { id: 'man', label: 'MEN UNDER ARMS' },
  { id: 'warden', label: 'WARDENS AND BEASTS' },
  { id: 'watch', label: 'HEROES AND THE WATCH' },
  { id: 'folk', label: 'TOWNSFOLK AND CAST' },
  { id: 'drop', label: 'THE DROP (NOT YET A KIND)' },
];

export interface Costume {
  /** A stable id used in the picker and in bug reports. */
  id: string;
  /** What the picker shows. */
  label: string;
  /** Where the sheets came from: the drop folder and the skin, for the owner. */
  source: string;
  group: 'foe' | 'boss' | 'npc' | 'hero';
  /**
   * THE PICKER'S SHELF (it.115): the host (enemy kinds), the wardens (bosses),
   * men (human enemy kinds), townsfolk and cast, heroes and the watch, and the
   * drop's sheets that are not yet a kind.
   */
  shelf?: CostumeShelf;
  /** The enemy kind this costume IS, when it is one. */
  kind?: string;
  /** The standard this body is normalised to (56 = the hero; 128 = a warden). */
  baseHeight?: number;
  /** The kind's identity colour (bandits and poachers share a sheet). */
  tint?: number;
  idle: string;
  walk: string;
  attack?: string;
  death?: string;
  hit?: string;
  /** Named one-shots the picker can fire (shout, roar, breath, cast...). */
  extras?: Record<string, string>;
  /** Height flavour × the hero standard (1.0 = human-sized). */
  heightMult?: number;
  /** The sheets bake their own contact shadow. */
  ownShadow?: boolean;
  /** Walk cycles per tile of ground covered. */
  stride?: number;
  /** Lift above the ground in px for things that fly. */
  hover?: number;
}

const c = (
  id: string,
  label: string,
  source: string,
  group: Costume['group'],
  prefix: string,
  opts: Partial<Costume> & { anims?: Partial<Record<'idle' | 'walk' | 'attack' | 'death' | 'hit', string>> } = {},
): Costume => {
  const a = opts.anims ?? {};
  return {
    id,
    label,
    source,
    group,
    idle: a.idle ?? `${prefix}_idle`,
    walk: a.walk ?? `${prefix}_walk`,
    attack: a.attack ?? `${prefix}_attack`,
    death: a.death ?? `${prefix}_death`,
    hit: a.hit ?? `${prefix}_hit`,
    extras: opts.extras,
    shelf: opts.shelf ?? (group === 'npc' ? 'folk' : group === 'hero' ? 'watch' : 'drop'),
    heightMult: opts.heightMult,
    ownShadow: opts.ownShadow,
    stride: opts.stride,
    hover: opts.hover,
  };
};

/** The graphics-update creatures (it.114), in the order they were baked. */
export const DROP_COSTUMES: Costume[] = [
  // ---- batch A -----------------------------------------------------------
  c('widow2', 'Red Widow', 'mob10 · skin 1', 'foe', 'widow2', { heightMult: 0.8, ownShadow: false }),
  c('widow3', 'Bone Widow', 'mob10 · skin 3', 'foe', 'widow3', { heightMult: 0.8, ownShadow: false }),
  c('widow4', 'Venom Widow', 'mob10 · skin 11', 'foe', 'widow4', { heightMult: 0.8, ownShadow: false }),
  c('brute', 'Orc Brute', 'mob · armed set', 'foe', 'brute', { heightMult: 1.35, ownShadow: true }),
  c('frostwolf', 'Frost Werewolf', 'mob3 · skin 1', 'foe', 'frostwolf', { heightMult: 1.1, ownShadow: false }),
  c('treant', 'Treant', 'mob13', 'foe', 'treant', { heightMult: 1.25, ownShadow: true, extras: { awake: 'treant_awake' } }),
  c('drake', 'Red Drake', 'mob1', 'boss', 'drake', { heightMult: 1.2, ownShadow: true, extras: { breath: 'drake_breath' } }),
  c('wyrm', 'Feathered Wyrm', 'mob7', 'foe', 'wyrm', { heightMult: 1.0, ownShadow: true, anims: { death: undefined, hit: undefined }, extras: { fly: 'wyrm_fly' } }),
  c('ghoul2', 'Marked Ghoul', 'mob4 · skin 1', 'foe', 'ghoul2', { heightMult: 1.0, ownShadow: false, anims: { hit: undefined }, extras: { crawl: 'ghoul2_crawl' } }),
  // ---- batch B -----------------------------------------------------------
  c('spearman', 'Orc Spearman', 'mob6', 'foe', 'spearman', { heightMult: 1.05, ownShadow: true, extras: { shout: 'spearman_shout' } }),
  c('orcess', 'Orc Warrior', 'mob8 · skin 1', 'foe', 'orcess', { heightMult: 1.0, ownShadow: true, extras: { taunt: 'orcess_levelup' } }),
  c('moth', 'Giant Moth', 'mob 11', 'foe', 'moth', { heightMult: 0.7, ownShadow: true, hover: 22 }),
  c('zomb2', 'Shambling Corpse', 'mob12 · skin 1', 'foe', 'zomb2', { heightMult: 1.0, ownShadow: true, extras: { roar: 'zomb2_roar' } }),
  c('halberd', 'Halberdier', 'halbard', 'npc', 'halberd', { heightMult: 1.05, ownShadow: true }),
  c('reaper', 'Caped Reaper', 'npc · skin 1', 'foe', 'reaper', { heightMult: 1.0, ownShadow: true, extras: { dash: 'reaper_dash', talk: 'reaper_talk' } }),
  c('duelist', 'Duelist', 'npc1', 'npc', 'duelist', { heightMult: 0.95, ownShadow: true, extras: { cast: 'duelist_cast', block: 'duelist_block' } }),
  // ---- batch C -----------------------------------------------------------
  c('apex', 'Apex Predator', 'mob14 · PVGames', 'boss', 'apex', { heightMult: 1.1, ownShadow: true, extras: { lunge: 'apex_attack2' } }),
  c('apex2', 'Apex Stalker', 'mob14 · PVGames', 'boss', 'apex2', { heightMult: 1.1, ownShadow: true, extras: { lunge: 'apex2_attack2' } }),
  c('krampus', 'Krampus', 'mob9 · PVGames', 'boss', 'krampus', { heightMult: 1.25, ownShadow: true }),
  c('gargoyle', 'Stone Gargoyle', 'demon_statue.png', 'foe', 'gargoyle', { heightMult: 1.4, ownShadow: true, anims: { attack: undefined, death: undefined, hit: undefined }, extras: { awake: 'gargoyle_awake' } }),
  c('hdknight', 'HD Knight', '2D HD Character Knight', 'hero', 'hdknight', { heightMult: 1.0, ownShadow: false, extras: { attack2: 'hdknight_attack2', spin: 'hdknight_spin', cast: 'hdknight_cast', block: 'hdknight_block', kick: 'hdknight_kick', stroll: 'hdknight_walk_slow' } }),
  c('gsknight', 'Greatsword Knight', 'Slash (PixelOver)', 'hero', 'gsknight', { heightMult: 1.0, ownShadow: true, anims: { death: undefined, hit: undefined } }),
  c('pixgirl', 'Girl in Black', 'npc2 (PixelOver)', 'npc', 'pixgirl', { heightMult: 1.0, ownShadow: true, anims: { attack: undefined, death: undefined, hit: undefined }, extras: { sit: 'pixgirl_sit' } }),
  c('spider2', 'Teal Spider', 'mob2', 'foe', 'spider2', { heightMult: 0.9, ownShadow: true }),
  c('flesh', 'Flesh Golem', 'mob15', 'foe', 'flesh', { heightMult: 1.05, ownShadow: true, anims: { hit: undefined } }),
  c('creeper', 'Hooded Creeper', 'mob16', 'foe', 'creeper', { heightMult: 1.05, ownShadow: true, anims: { hit: undefined } }),
];

/** The townsfolk: walk sheets only, so idle is the walk's first frame held. */
export const FOLK_COSTUMES: Costume[] = [
  { id: 'cit_farmer', label: 'Farmer', source: 'coc_chars (pixel)', group: 'npc', idle: 'cit_farmer_walk', walk: 'cit_farmer_walk' },
  { id: 'cit_porter', label: 'Porter', source: 'coc_chars (pixel)', group: 'npc', idle: 'cit_porter_walk', walk: 'cit_porter_walk' },
  { id: 'cit_monk', label: 'Monk', source: 'coc_chars (pixel)', group: 'npc', idle: 'cit_monk_walk', walk: 'cit_monk_walk' },
  { id: 'cit_goodwife', label: 'Goodwife', source: 'coc_chars (pixel)', group: 'npc', idle: 'cit_goodwife_walk', walk: 'cit_goodwife_walk' },
  { id: 'cit_maid', label: 'Maid', source: 'coc_chars (pixel)', group: 'npc', idle: 'cit_maid_walk', walk: 'cit_maid_walk' },
  { id: 'cit_labourer', label: 'Labourer', source: 'Kenney (smooth)', group: 'npc', idle: 'cit_labourer_walk', walk: 'cit_labourer_walk' },
  { id: 'cit_carter', label: 'Carter', source: 'Kenney re-dye (smooth)', group: 'npc', idle: 'cit_carter_walk', walk: 'cit_carter_walk' },
  { id: 'folk', label: 'Villager (smooth)', source: 'Villager_01 pack', group: 'npc', idle: 'folk_walk', walk: 'folk_walk', death: 'folk_death' },
  { id: 'villager', label: 'Villager (pixel)', source: 'villager peasant sheet', group: 'npc', idle: 'villager_walk', walk: 'villager_walk' },
  { id: 'merchant', label: 'Merchant', source: 'merchant peasant sheet', group: 'npc', idle: 'merchant_walk', walk: 'merchant_walk' },
  { id: 'trader', label: 'The Trader', source: 'bake-trader (re-dyed monk)', group: 'npc', idle: 'trader_walk', walk: 'trader_walk' },
];

for (const f of FOLK_COSTUMES) f.shelf = 'folk';

/**
 * EVERY OTHER BODY IN THE ATLAS (it.115). The heroes' own rigs (the watch
 * wears them), the company's man-at-arms, the tavern's serving woman and the
 * coliseum's crowd: sheets no enemy kind and no drop costume names.
 */
export const CAST_COSTUMES: Costume[] = [
  { id: 'knight', label: 'Warrior (the hero rig)', source: "knight_* · the watch's blades", group: 'hero', shelf: 'watch', idle: 'knight_idle', walk: 'knight_run', attack: 'knight_melee', death: 'knight_die', hit: 'knight_hit', extras: { melee2: 'knight_melee2', spin: 'knight_spin', cast: 'knight_cast' }, ownShadow: true },
  { id: 'mage', label: 'Mage (the hero rig)', source: 'mage_* · 130 px crypt pack', group: 'hero', shelf: 'watch', idle: 'mage_idle', walk: 'mage_walk', attack: 'mage_cast', death: 'mage_death', ownShadow: true },
  { id: 'ranger', label: 'Ranger (the hero rig)', source: "ranger_* · the watch's bows", group: 'hero', shelf: 'watch', idle: 'ranger_idle', walk: 'ranger_run', attack: 'ranger_attack', death: 'ranger_death', hit: 'ranger_hit', ownShadow: true },
  { id: 'rogue', label: 'Rogue (the hero rig)', source: "rogue_* · the watch's scouts", group: 'hero', shelf: 'watch', idle: 'rogue_idle', walk: 'rogue_run', attack: 'rogue_attack', death: 'rogue_death', ownShadow: true },
  { id: 'captain', label: 'Man-at-Arms (the company)', source: "captain_* · the farm's general and his men", group: 'npc', shelf: 'watch', idle: 'captain_idle', walk: 'captain_walk', attack: 'captain_attack', death: 'captain_death', ownShadow: true },
  { id: 'cellar_girl', label: 'The Serving Woman', source: 'cellar_girl · the cellar', group: 'npc', shelf: 'folk', idle: 'cellar_girl', walk: 'cellar_girl' },
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): Costume => ({ id: `crowd_m${i}`, label: `Coliseum Crowd ${i + 1}`, source: `crowd_m${i} · the stands`, group: 'npc', shelf: 'folk', idle: `crowd_m${i}`, walk: `crowd_m${i}` })),
];

/** Sheets that are machines, props or effects - never a body. */
const NOT_A_BODY = /^(vfx_|fx_|spin_|inf_|dun_|inn_|coin_|catapult|ballista|siege|gold_drop|glint|campfire|torch|brazier|banner|gateway|well|farm_)/;
const CLIP = /_(idle|walk|run|attack|melee|cast|death|die|hit)$/;

/**
 * THE SAFETY NET (it.115): any eight-direction sheet in the manifest that no
 * costume above names becomes a costume of its own, labelled by its prefix -
 * so a body baked tomorrow is in the picker tomorrow.
 */
export function discoverCostumes(anims: ReadonlyArray<string>, dirs: (name: string) => number, known: ReadonlyArray<Costume>): Costume[] {
  const named = new Set<string>();
  const namedPrefixes = new Set<string>();
  for (const c of known) for (const n of costumeAnims(c)) {
    named.add(n);
    namedPrefixes.add(n.replace(CLIP, ''));
  }
  const byPrefix = new Map<string, string[]>();
  for (const n of anims) {
    if (named.has(n) || NOT_A_BODY.test(n) || dirs(n) !== 8 || !CLIP.test(n)) continue;
    if (namedPrefixes.has(n.replace(CLIP, ''))) {
      // A clip of a body already on the shelf that nothing names (the drake's
      // bite, the poacher's walk): it rides along as one of that body's extras.
      const owner = known.find((c) => c.idle.replace(CLIP, '') === n.replace(CLIP, '') || c.walk.replace(CLIP, '') === n.replace(CLIP, ''));
      if (owner) owner.extras = { ...owner.extras, [n.slice(n.lastIndexOf('_') + 1)]: n };
      continue;
    }
    const prefix = n.replace(CLIP, '');
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), n]);
  }
  const out: Costume[] = [];
  for (const [prefix, names] of byPrefix) {
    const pick = (...suffixes: string[]): string | undefined => suffixes.map((x) => `${prefix}_${x}`).find((n) => names.includes(n));
    const walk = pick('walk', 'run') ?? names[0];
    out.push({
      id: prefix,
      label: prefix.replace(/^cit_/, '').replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
      source: `${prefix}_* · found in the atlas`,
      group: 'npc',
      shelf: 'drop',
      idle: pick('idle') ?? walk,
      walk,
      attack: pick('attack', 'melee', 'cast'),
      death: pick('death', 'die'),
      hit: pick('hit'),
    });
  }
  return out;
}

export function allCostumes(): Costume[] {
  return [...DROP_COSTUMES, ...FOLK_COSTUMES, ...CAST_COSTUMES];
}

/** Every sheet a costume needs resident before it can be worn. */
export function costumeAnims(cst: Costume): string[] {
  const names = [cst.idle, cst.walk, cst.attack, cst.death, cst.hit, ...Object.values(cst.extras ?? {})];
  return [...new Set(names.filter((n): n is string => !!n))];
}
