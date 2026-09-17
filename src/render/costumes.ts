/**
 * @module render/costumes
 * THE WARDROBE (it.114). Every body the game can draw as a set of sheets, with
 * the label the owner will use to talk about it and where it came from.
 *
 * Two consumers:
 *   - THE MENAGERIE (the try-out arena): the hero puts a costume on and walks
 *     the sand as it, so an animation can be judged in motion and named in a
 *     bug report ("the treant's attack").
 *   - THE BESTIARY: the same labels and sources under each page.
 *
 * Enemy kinds that already exist in `ENEMY_TYPES` are added at runtime from
 * their own sprite blocks (see `costumesForKinds` in main); this table holds
 * the sheets baked from the graphics-update drop that are not yet an
 * `EnemyKind`, and the townsfolk, who never were.
 */

export interface Costume {
  /** A stable id used in the picker and in bug reports. */
  id: string;
  /** What the picker shows. */
  label: string;
  /** Where the sheets came from: the drop folder and the skin, for the owner. */
  source: string;
  group: 'foe' | 'boss' | 'npc' | 'hero';
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
  c('brute', 'Orc Brute', 'mob · armed set', 'foe', 'brute', { heightMult: 1.4, ownShadow: true }),
  c('frostwolf', 'Frost Werewolf', 'mob3 · skin 1', 'foe', 'frostwolf', { heightMult: 1.1, ownShadow: false }),
  c('treant', 'Treant', 'mob13', 'foe', 'treant', { heightMult: 1.4, ownShadow: true, extras: { awake: 'treant_awake' } }),
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
  c('krampus', 'Krampus', 'mob9 · PVGames', 'boss', 'krampus', { heightMult: 1.3, ownShadow: true }),
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

export function allCostumes(): Costume[] {
  return [...DROP_COSTUMES, ...FOLK_COSTUMES];
}

/** Every sheet a costume needs resident before it can be worn. */
export function costumeAnims(cst: Costume): string[] {
  const names = [cst.idle, cst.walk, cst.attack, cst.death, cst.hit, ...Object.values(cst.extras ?? {})];
  return [...new Set(names.filter((n): n is string => !!n))];
}
