# Milestone 6 Roadmap — Codebase & Asset Audit (2026-09-02, after it.38)

## 1. Inspection summary

| Area | State |
| --- | --- |
| Source | 13,238 lines TypeScript (strict), 46 modules under `src/`, `tsc --noEmit` clean |
| Largest modules | `main.ts` 2,135 · `entities/Enemy.ts` 1,490 · `engine/AudioManager.ts` 952 · `entities/Player.ts` 808 |
| Assets | `public/assets` = 96 MB / 235 files: `atlas/` (89 anims + 19 singles, 49 MB), `audio/` (125 mapped files, 48 MB) — nothing unreferenced |
| Boot (prod) | title at ~0.8 s / 206 KB; run start ~1 s; floors stream in 20–700 ms with next-floor prefetch |
| Tests | none automated in-repo; QA is browser-driven via `window.__game` / `__menu` dev hooks |
| Content | 4 classes × 4 skills, 19 enemy kinds (4 bosses, one 3-phase), 23 items / 7 weapon families, 20 floors / 4 arenas |

### Architecture invariants that any new work must keep
1. **Determinism**: all intent flows DOM → `InputBindings` → `InputCommand` → `InputQueue`, drained once per 60 Hz tick. Sim code uses `mulberry32` only.
2. **Single hp mutator**: `CombatSystem.dealDamage` — skills, projectiles, cheats all route through it.
3. **Render/sim split**: entities own `pos/prevPos` (sim) and `container` (render); render reads via `syncRender(alpha)`; fog/light is a render-side tint.
4. **Run lifecycle**: `boot()` once, `startRun()` → `RunHandle.destroy()`; per-floor `preloadFloor()` → `buildWorld()` (sync) → `swapWorld()`.
5. **Atlas-only art**: `SpriteLibrary.ensure()` before any `anim()`; heights derived from manifest painted bounds (`HERO_HEIGHT`/`MOB_HEIGHT`/`BOSS_HEIGHT`).

## 2. System-by-system state

### 2.1 Player & classes — `entities/Player.ts`, `systems/Skills.ts`
- **Have**: `ARCHETYPES` table (hp, speed, armor, crit, attack speed, dodge, resource, base weapon), `CLASS_RIGS` (per-class atlas rig, data-driven scale), XP/levels (+4 hp, +0.25/0.35 dmg per level), resource + timed buffs (`dmgBuff`, `dr`, `haste`, `stealth`, `poisonBlade`), 16 skills with cooldown/cost/zones/DoT.
- **Gaps**: no attributes (STR/DEX/MAG/VIT) or stat points; level-up is a fixed formula; buffs are ad-hoc fields, not a status-effect list; skills are fixed per class (no skill points / ranks / passives); no consumables; `Player.serialize` is partial (no level/xp/gold/resource).

### 2.2 Combat, projectiles — `systems/Combat.ts`, `systems/Projectiles.ts`
- **Have**: classic ARPG action model (windup → strike frame → recover), to-hit / crit / max-roll display, poise + stunlock, knockback, weapon families with reach/timing, AoE cleave arc, faction-generalized projectiles with fog-gated targeting, god mode.
- **Gaps**: no damage TYPES (physical/fire/cold/poison/arcane) or resistances; no armor class vs to-hit scaling (flat `toHit` constants); no block/parry with shields (offHand is armor-only); no elemental on-hit procs; enemies never lead shots; no threat/aggro table for multiple players.

### 2.3 Enemies — `entities/Enemy.ts`, `EnemyPool.ts`
- **Have**: 19 kinds via `ENEMY_TYPES` (data), idle/chase/flee/desperation, kiting, LOS give-up, A*+direct steering, phased boss chain, summons, per-kind voices, level matrix.
- **Gaps**: no elite/champion affixes (Extra Fast, Fire Enchanted, …); no unique named mobs outside bosses; no group behaviors (packs with a leader, flankers); no spawner/ambush/scripted encounters; corpses are decorative only (no necromancy/looting).

### 2.4 Dungeon, floors, arenas — `scenes/DungeonGenerator.ts`, `main.ts`
- **Have**: seeded BSP rooms + L corridors, pillar colonnades, `TILE_BLOCKED` prop planning, theme bands (stone/temple/frost/ember = tint sets), boss threshold rooms → sealed arena maps, stairs proximity trigger, level select, cheat travel.
- **Gaps**: one layout grammar for 20 floors (no caves/catacomb/hell variants); no doors, traps, destructibles, shrines, secret rooms; no quest levels or scripted floors; no hub/town; floor state is not persisted (leaving a floor forgets it).

### 2.5 Inventory, loot, UI — `items/catalog.ts`, `systems/Loot.ts`, `systems/Chests.ts`, `ui/*`
- **Have**: 23 static items (3 rarities as *fixed* stat tiers), 6 paperdoll slots, stacking backpack grid, tooltips, rarity glow, chest drops, boss rare drops, gold piles; DOM panels are per-run objects with `destroy()`.
- **Gaps**: no affixes (every "Soldier Blade" is identical), no item requirements/levels, no drop-to-ground, no gold sink (nothing to buy), no potions/belt, no stash, no identify/unknown items, no sockets/runes, no item comparison in tooltip.

### 2.6 Engine / render / audio / meta
- **Have**: lightmap tinting + cutaway walls, particle ambience (sparks, trails, blood, sparkles, impact FX), dynamic shadows, minimap, floating text, music state machine (menu/dungeon/boss/victory) + ~50 SFX, main menu / pause / death / victory flows, settings persistence.
- **Gaps**: no save/load (a run dies with the tab), no positional audio, no gamepad (command layer is ready), `StateSync`/`INetworkTransport` are stubs, no telemetry/replay capture (the deterministic queue makes replays cheap), no localization table (strings inline).

## 3. Missing ARPG building blocks (ranked by leverage)

| # | Block | Why it matters (D1 / BG:DA) | Readiness |
| --- | --- | --- | --- |
| 1 | **Attributes + stat points + damage types/resists** | The D1 character sheet is the RPG; every item and skill needs numbers to hang on | Player/Combat are data-driven; plumbing is small |
| 2 | **Affix item generation** (prefix/suffix, requirements, unknown items) | Loot lottery is the ARPG loop; fixed items cap replay at 23 drops | `ItemDef` is data; `Loot` already rolls from seeded RNG |
| 3 | **Consumables + belt** (potions, scrolls, town portal) | D1 belt is core survivability; the game has NO healing outside level-up/respawn | Command queue + inventory system handle it |
| 4 | **Status-effect framework** | poison/slow/freeze/buffs are 6 ad-hoc fields on Player/Enemy | Unifies existing behavior, enables elite affixes |
| 5 | **Elite/champion monsters + shrines + traps + destructibles** | Floors read identical; D1 floors are memorable through set pieces | Enemy defs are data; `TILE_BLOCKED` planning exists |
| 6 | **Town hub + vendors + stash** (gold sink) | Gold currently buys nothing | Needs a "hub" floor mode in `buildWorld` (arena mode is the precedent) |
| 7 | **Save/load + floor persistence** | Runs cannot be resumed; `GameSnapshot` exists but is not written anywhere | Seeded worlds + command log make saves tiny |
| 8 | **Gamepad** (BG:DA feel) | The hybrid action controls were designed for it | `InputBindings` is the only DOM listener |
| 9 | **Co-op** (local first, then lockstep) | The whole sim was built lockstep-ready | Transport + snapshot hashing missing |
| 10 | **Dungeon grammar variety + quest levels** | Layout identity per band | Generator is a single function; needs a strategy interface |

## 4. Milestone options (concrete structures)

### Option A — "THE CHARACTER SHEET" (recommended first)
Attributes, stat points, damage types & resistances, affix loot, potions + belt, drop-to-ground.

**Files**: `src/rpg/stats.ts` (new), `src/rpg/effects.ts` (new), `src/items/affixes.ts` (new), `src/items/generate.ts` (new), `src/systems/Belt.ts` (new), edits to `Player.ts`, `Combat.ts`, `Loot.ts`, `Inventory.ts`, `ui/Inventory.ts`, `ui/CharacterSheet.ts` (new), `InputQueue.ts`, `Serialization.ts`.

```ts
// src/rpg/stats.ts — the D1 sheet, pure data + pure functions
export type Attribute = 'str' | 'dex' | 'mag' | 'vit';
export type DamageType = 'physical' | 'fire' | 'cold' | 'lightning' | 'poison' | 'arcane';
export interface Attributes { str: number; dex: number; mag: number; vit: number }
export interface Resistances extends Record<DamageType, number> {}          // 0..0.75
export interface DerivedStats {
  hpMax: number; resourceMax: number; armorClass: number; toHit: number;
  minDamage: number; maxDamage: number; critChance: number; attackSpeedMult: number;
  moveSpeedMult: number; blockChance: number; resist: Resistances;
}
/** Deterministic, allocation-free recompute; called on level-up/equip/effect change. */
export function deriveStats(cls: ArchetypeDef, attrs: Attributes, level: number,
  equipped: ItemInstance[], effects: ReadonlyArray<ActiveEffect>): DerivedStats;
// D1-style: toHit = 50 + dex/2 + level + item bonuses; AC = dex/5 + armor sum;
// hit chance = clamp(0.05, 0.95, (toHit - targetAC + 50) / 100).
```

```ts
// src/rpg/effects.ts — ONE status list replaces dmgBuff/dr/haste/stealth/poisonBlade/slow
export type EffectKind = 'buff' | 'debuff';
export interface EffectDef {
  id: string; kind: EffectKind; stacks: 'refresh' | 'add' | 'ignore';
  modifiers?: Partial<Record<keyof DerivedStats, number>>;   // additive
  multipliers?: Partial<Record<keyof DerivedStats, number>>; // multiplicative
  tick?: { every: number; damage: { min: number; max: number; type: DamageType } }; // DoT
  control?: 'freeze' | 'stun' | 'root';
}
export interface ActiveEffect { defId: string; ticksLeft: number; stacks: number; sourceId: number }
export class EffectSystem {  // owned per run; ticks after entity.update
  apply(target: Entity, defId: string, ticks: number, sourceId: number): void;
  update(combat: CombatSystem): void;   // DoTs route through combat.dealDamage({type})
}
// Entity gains `readonly effects: ActiveEffect[]`; Combat.dealDamage gains `type: DamageType`
// and applies resist: amount = round(rolled * (1 - resist[type])) - (type==='physical' ? armor : 0).
```

```ts
// src/items/affixes.ts — prefix/suffix tables (D1 naming), rolled by item level
export interface AffixDef {
  id: string; kind: 'prefix' | 'suffix'; name: string;        // "Jade", "of the Bear"
  minIlvl: number; slots: EquipmentSlot[] | 'weapon' | 'armor' | 'any';
  mods: Array<{ stat: keyof DerivedStats | Attribute | `resist.${DamageType}`; min: number; max: number }>;
  weight: number;
}
// src/items/generate.ts
export interface ItemInstance {
  uid: string; baseId: string; ilvl: number; rarity: Rarity;
  affixes: Array<{ id: string; rolls: number[] }>;
  identified: boolean; stackCount?: number;
}
export function rollItem(rand: () => number, ilvl: number, dropTier: 'normal' | 'chest' | 'boss'): ItemInstance;
export function itemStats(inst: ItemInstance): { name: string; mods: ResolvedMod[]; req: Partial<Attributes> };
```
- `Player.backpack: string[]` → `ItemInstance[]`; `equipped: Map<slot, ItemInstance>`. `ITEMS` stays the BASE table.
- New commands: `DROP_ITEM {uid}`, `USE_BELT {slot}`, `ASSIGN_BELT {uid, slot}`, `SPEND_STAT {attr}`, `IDENTIFY {uid}`.
- `systems/Belt.ts`: 8 slots, `USE_BELT` consumes a potion → `effects.apply('heal_potion')` (heal is the one exception to "dealDamage only"; expose `combat.heal(targetId, amount)` as the second legal hp mutator, guarded the same way).
- UI: `ui/CharacterSheet.ts` (C key): attributes with +/− stat points, derived stats, resists; belt bar under the skill bar; tooltip shows affixes, requirements (red when unmet), and compares against equipped.
- **Audio/art**: potion glug/quaff from the TomMusic Items folder; belt icons procedural in `itemIcons.ts`.
- **Effort**: ~2,500 lines. **Risk**: balance — keep `WEAPON_TIMING`/`ENEMY_TYPES` untouched and tune `deriveStats` only.

### Option B — "TRISTRAM" (hub, vendors, stash, save/load, town portal)
**Files**: `src/scenes/hub.ts` (new hand-authored map), `src/systems/Vendors.ts`, `src/ui/Shop.ts`, `src/ui/Stash.ts`, `src/persist/SaveGame.ts` (new), edits to `main.ts` (`mode: 'normal' | 'arena' | 'hub'`), `Serialization.ts`.

```ts
// src/persist/SaveGame.ts — the deterministic sim makes this cheap
export interface SaveGame {
  version: 1; seed: number; archetype: ClassArchetype; deepestFloor: number;
  player: PlayerSnapshot;               // full: level, xp, gold, attrs, items, belt, stash
  floors: Record<number, FloorMemory>;  // per visited floor: opened chests, taken gold, killed ids, explored bitset
  timestamp: number;
}
export const saves = { write(slot: number, s: SaveGame): void; read(slot: number): SaveGame | null; list(): SaveMeta[] };
// localStorage (≤ 50 KB per save); IndexedDB later for replays.
```
- Hub = floor 0: `buildWorld(0, 'hub')` uses a hand-authored `HUB_MAP` (open square, four vendor stalls as `TILE_BLOCKED` props with `Interactable` records), no enemies, town music bed.
- `Interactable` generalizes chests: `{ id, x, y, kind: 'chest' | 'vendor' | 'stash' | 'portal' | 'shrine', opened?: boolean }`; `OPEN_CHEST` becomes `INTERACT {id}`.
- Vendors: `Vendors.ts` rolls a seeded inventory per (seed, day) with `rollItem`; `BUY {vendorId, uid}` / `SELL {uid}` commands; gold sink established.
- Town portal scroll: `USE_ITEM` → `pendingPortal` → `swapWorld(buildWorld(0,'hub'))` and back to the same floor via `FloorMemory` (requires B's floor persistence).
- **Effort**: ~2,000 lines + one authored map. **Risk**: floor persistence changes `buildWorld` (replay opened chests / dead mobs from `FloorMemory` before spawning).

### Option C — "THE BESTIARY" (elites, shrines, traps, destructibles, quest floors)
**Files**: `src/entities/eliteAffixes.ts`, `src/scenes/setpieces.ts`, `src/systems/Traps.ts`, `src/systems/Destructibles.ts`, `src/quests/*.ts` (new), edits to `Enemy.ts`, `Props.ts`, `DungeonGenerator.ts`.

```ts
// src/entities/eliteAffixes.ts — D1 "Extra Fast / Fire Enchanted / Multishot / Teleporting"
export interface EliteAffix {
  id: string; label: string; tint: number;
  apply(def: EnemyTypeDef): EnemyTypeDef;     // returns a derived def (speedMult ×1.4, hp ×2.2 …)
  onStrike?: (combat: CombatSystem, self: Enemy, victim: Entity) => void;  // e.g. apply 'burning'
  onDeath?: (world: WorldFx, self: Enemy) => void;                         // e.g. fire nova
}
export interface EliteRoll { prefix: EliteAffix; suffix?: EliteAffix; name: string }  // "Gorefeast the Quick"
// Enemy gains `elite: EliteRoll | null`; spawnFloorEnemies rolls 1 champion pack per 2 rooms from floor 3.
```
```ts
// src/scenes/setpieces.ts — placed like hearths (TILE_BLOCKED planning BEFORE scene build)
export type SetPiece =
  | { kind: 'shrine'; effect: 'heal' | 'mana' | 'enchant' | 'cursed' }
  | { kind: 'trap'; trigger: 'pressure' | 'tripwire'; payload: 'spikes' | 'fire' | 'arrows' }
  | { kind: 'barrel' | 'urn'; hp: number; loot: 'gold' | 'item' | 'none' }
  | { kind: 'door'; locked: boolean }       // walls a corridor until INTERACT
  | { kind: 'sarcophagus'; spawns: EnemyKind };
export function planSetPieces(map: DungeonMap, floor: number): SetPiece[];  // seeded
```
- Quest floors (`src/quests/`): data-driven scripts keyed by floor (`{ floor: 2, id: 'butcher', room: 'farthest', spawn: 'unique:butcher', banner: 'Ahh, fresh meat' }`), reusing the arena-threshold mechanic for "quest rooms".
- **Effort**: ~2,200 lines + 4–6 unique enemies (reuse atlases with tints, as the bosses do). **Risk**: performance is fine (pooled), but unique-mob art is the constraint — every new body needs an atlas.

### Option D — "THE PARTY" (gamepad, then local co-op, then lockstep)
- Gamepad: `core/GamepadBindings.ts` polls `navigator.getGamepads()` each render frame and enqueues the same `InputCommand`s (left stick → `DIRECT_MOVE`, A → `ATTACK_DOWN/UP`, X → `PICKUP_NEAREST`, shoulders → belt, face buttons → `SKILL`). Zero sim changes; BG:DA feel arrives for free with the existing auto-target strikes.
- Local co-op: `playerId` already stamps every command; `startRun` needs `players: Player[]`, camera focus = centroid with a leash, enemy `getPlayerPos` → nearest/threat, loot ownership by pickup order.
- Online: implement `INetworkTransport` over WebRTC DataChannels (peer-to-peer, host-authoritative seed), `StateSync` already injects remote commands at `executeTick`; add `GameSnapshot` hashing every 60 ticks and `Player.serialize` completion (from Option A/B).
- **Effort**: gamepad ~300 lines; local co-op ~1,200; online ~2,500 + signaling server.

## 5. Recommendation & order
1. **A — The Character Sheet** (attributes, damage types, affix loot, potions/belt, drop). It unlocks every other option's numbers and fixes the biggest design hole (no healing, no loot variety).
2. **C — The Bestiary** (elites/shrines/traps/quest floors) on top of A's effect framework — floors become memorable.
3. **B — Tristram** (hub/vendors/stash/save) once there is something to buy and keep.
4. **D — The Party** (gamepad first: cheapest, largest feel gain; co-op last).

Each option keeps the five invariants above and lands in per-run objects with `destroy()`; new commands go through `InputQueue`; all RNG through the floor's seeded stream so co-op stays viable.
