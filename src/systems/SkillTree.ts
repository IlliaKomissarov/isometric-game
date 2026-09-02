/**
 * @module systems/SkillTree
 * The progression DATA (it.41): every active skill with its class path and
 * tier, the passives, unlock rules and the class-synergy contract.
 *
 *   - Heroes start with basic attacks and ONE skill point; each level-up
 *     grants one more. Actives sit on four tiers per class path (level
 *     1 / 3 / 5 / 7) and each tier needs the one before it in the same
 *     path. Passives (two per class) need level 4 and one active of that
 *     class already learned.
 *   - CROSS-CLASS: any path may be walked, at DOUBLE the point cost.
 *   - SYNERGY: a skill matching the hero's own class is cast with +30%
 *     power, 20% shorter cooldown, and its class status on every hit
 *     (warrior STAGGER, mage BURN, ranger HOBBLE, rogue POISON).
 *
 * Pure data + rules: no Player import at runtime (Player imports this).
 */

import type { ClassArchetype } from '@/network/Serialization';

export interface SkillDef {
  id: string;
  /** Class path the skill belongs to (synergy + tree column). */
  cls: ClassArchetype;
  /** 1–4 down the path; gates level + prerequisite. */
  tier: number;
  name: string;
  /** HUD glyph (a rune-like character on the action bar). */
  glyph: string;
  /** Cooldown in simulation ticks (60/s). */
  cd: number;
  /** Resource cost (mana or stamina by class). */
  cost: number;
  /** One-line HUD tooltip. */
  hint: string;
  /** Baked 64 px glyph under assets/ui/skills (it.40); the rune `glyph` is the fallback. */
  icon?: string;
}

export interface PassiveDef {
  id: string;
  cls: ClassArchetype;
  name: string;
  glyph: string;
  hint: string;
  /** Additive fractions / flat bonuses read by the Player getters. */
  effect: { armor?: number; dmg?: number; regen?: number; speed?: number; dodge?: number; hp?: number };
}

/** The 16 skills — 4 per class path, tiers 1–4. */
export const CLASS_SKILLS: Record<ClassArchetype, SkillDef[]> = {
  warrior: [
    { id: 'whirlwind', cls: 'warrior', tier: 1, icon: 'whirlwind', name: 'Whirlwind', glyph: '⚔', cd: 300, cost: 25, hint: '360° steel — strikes everything around you' },
    { id: 'charge', cls: 'warrior', tier: 2, icon: 'charge', name: 'Charge', glyph: '➤', cd: 420, cost: 20, hint: 'Dash forward, scattering and wounding foes' },
    { id: 'warcry', cls: 'warrior', tier: 3, icon: 'warcry', name: 'War Cry', glyph: '♜', cd: 900, cost: 15, hint: '+35% damage for 10 s' },
    { id: 'stoneskin', cls: 'warrior', tier: 4, icon: 'stoneskin', name: 'Stone Skin', glyph: '⛨', cd: 900, cost: 20, hint: 'Absorb 55% of damage for 7 s' },
  ],
  mage: [
    { id: 'fireball', cls: 'mage', tier: 1, icon: 'fireball', name: 'Fireball', glyph: '✸', cd: 200, cost: 18, hint: 'A blazing comet that bursts on the first foe it meets' },
    { id: 'firewall', cls: 'mage', tier: 2, icon: 'firewall', name: 'Firewall', glyph: '♒', cd: 600, cost: 30, hint: 'A line of flame that burns for 6 s' },
    { id: 'frostnova', cls: 'mage', tier: 3, icon: 'frostnova', name: 'Frost Nova', glyph: '❄', cd: 540, cost: 25, hint: 'Freeze everything near you' },
    { id: 'intellect', cls: 'mage', tier: 4, icon: 'intellect', name: 'Arcane Intellect', glyph: '✦', cd: 1200, cost: 0, hint: '+45% spell damage for 15 s' },
  ],
  ranger: [
    { id: 'multishot', cls: 'ranger', tier: 1, icon: 'multishot', name: 'Multishot', glyph: '⋔', cd: 200, cost: 18, hint: 'A fan of five arrows' },
    { id: 'shadowstep', cls: 'ranger', tier: 2, icon: 'shadowstep', name: 'Shadow Step', glyph: '➟', cd: 300, cost: 15, hint: 'Quick dash + 4 s of haste' },
    { id: 'trap', cls: 'ranger', tier: 3, icon: 'trap', name: 'Explosive Trap', glyph: '☒', cd: 480, cost: 20, hint: 'Plant a mine at your feet' },
    { id: 'rain', cls: 'ranger', tier: 4, icon: 'rain', name: 'Rain of Arrows', glyph: '⇊', cd: 800, cost: 35, hint: 'Arrow storm on the nearest pack' },
  ],
  rogue: [
    { id: 'flurry', cls: 'rogue', tier: 1, icon: 'flurry', name: 'Blade Flurry', glyph: '≋', cd: 220, cost: 18, hint: 'Four lightning cuts on one victim' },
    { id: 'poison', cls: 'rogue', tier: 2, icon: 'poison', name: 'Poison Blade', glyph: '☠', cd: 700, cost: 15, hint: 'Coat your blades — hits poison for 15 s' },
    { id: 'vanish', cls: 'rogue', tier: 3, icon: 'vanish', name: 'Vanish', glyph: '◍', cd: 900, cost: 25, hint: 'Untouchable and unseen for 5 s' },
    { id: 'shadowslash', cls: 'rogue', tier: 4, icon: 'shadowslash', name: 'Shadow Slash', glyph: '⌁', cd: 420, cost: 25, hint: 'Dash through foes, cutting deep' },
  ],
};

export const PASSIVES: Record<ClassArchetype, PassiveDef[]> = {
  warrior: [
    { id: 'ironhide', cls: 'warrior', name: 'Iron Hide', glyph: '⛨', hint: '+3 armor', effect: { armor: 3 } },
    { id: 'bloodrush', cls: 'warrior', name: 'Blood Rush', glyph: '♥', hint: '+10% damage', effect: { dmg: 0.1 } },
  ],
  mage: [
    { id: 'wellspring', cls: 'mage', name: 'Wellspring', glyph: '◈', hint: '+40% mana regeneration', effect: { regen: 0.4 } },
    { id: 'emberheart', cls: 'mage', name: 'Emberheart', glyph: '✸', hint: '+12% damage', effect: { dmg: 0.12 } },
  ],
  ranger: [
    { id: 'fleetfoot', cls: 'ranger', name: 'Fleet Foot', glyph: '➟', hint: '+8% movement speed', effect: { speed: 0.08 } },
    { id: 'keeneye', cls: 'ranger', name: 'Keen Eye', glyph: '◎', hint: '+12% damage', effect: { dmg: 0.12 } },
  ],
  rogue: [
    { id: 'sleight', cls: 'rogue', name: 'Sleight', glyph: '◍', hint: '+8% dodge', effect: { dodge: 0.08 } },
    { id: 'secondwind', cls: 'rogue', name: 'Second Wind', glyph: '≋', hint: '+35% stamina regeneration', effect: { regen: 0.35 } },
  ],
};

export const CLASS_ORDER: ReadonlyArray<ClassArchetype> = ['warrior', 'mage', 'ranger', 'rogue'];

export const SKILL_BY_ID: Readonly<Record<string, SkillDef>> = Object.fromEntries(
  CLASS_ORDER.flatMap((c) => CLASS_SKILLS[c].map((d) => [d.id, d])),
);
export const PASSIVE_BY_ID: Readonly<Record<string, PassiveDef>> = Object.fromEntries(
  CLASS_ORDER.flatMap((c) => PASSIVES[c].map((d) => [d.id, d])),
);

/** Level required for a tier (1 / 3 / 5 / 7). */
export function tierLevel(tier: number): number {
  return tier * 2 - 1;
}
export const PASSIVE_LEVEL = 4;

/** The synergy contract shown in the tree and applied by SkillSystem. */
export const SYNERGY = { power: 1.3, cooldown: 0.8 } as const;
export const SYNERGY_STATUS: Record<ClassArchetype, string> = {
  warrior: 'STAGGER',
  mage: 'BURN',
  ranger: 'HOBBLE',
  rogue: 'POISON',
};

/** The slice of the hero the rules read (Player satisfies it). */
export interface Progress {
  archetype: ClassArchetype;
  level: number;
  skillPoints: number;
  unlockedSkills: ReadonlySet<string>;
  passives: ReadonlySet<string>;
}

export function skillCost(p: Progress, def: SkillDef | PassiveDef): number {
  return def.cls === p.archetype ? 1 : 2;
}

export interface UnlockCheck {
  ok: boolean;
  /** Short reason when locked ("level 5", "needs Fireball", "2 points"). */
  reason: string;
}

export function canUnlockSkill(p: Progress, id: string): UnlockCheck {
  const def = SKILL_BY_ID[id];
  if (!def) return { ok: false, reason: 'unknown' };
  if (p.unlockedSkills.has(id)) return { ok: false, reason: 'learned' };
  const need = tierLevel(def.tier);
  if (p.level < need) return { ok: false, reason: `level ${need}` };
  if (def.tier > 1) {
    const prev = CLASS_SKILLS[def.cls][def.tier - 2];
    if (!p.unlockedSkills.has(prev.id)) return { ok: false, reason: `needs ${prev.name}` };
  }
  const cost = skillCost(p, def);
  if (p.skillPoints < cost) return { ok: false, reason: `${cost} point${cost > 1 ? 's' : ''}` };
  return { ok: true, reason: '' };
}

export function canUnlockPassive(p: Progress, id: string): UnlockCheck {
  const def = PASSIVE_BY_ID[id];
  if (!def) return { ok: false, reason: 'unknown' };
  if (p.passives.has(id)) return { ok: false, reason: 'learned' };
  if (p.level < PASSIVE_LEVEL) return { ok: false, reason: `level ${PASSIVE_LEVEL}` };
  if (!CLASS_SKILLS[def.cls].some((s) => p.unlockedSkills.has(s.id))) return { ok: false, reason: `any ${def.cls} skill` };
  const cost = skillCost(p, def);
  if (p.skillPoints < cost) return { ok: false, reason: `${cost} point${cost > 1 ? 's' : ''}` };
  return { ok: true, reason: '' };
}
