/**
 * @module render/effects
 * COMPOSED EFFECTS (it.115): one call, one rich beat. Every function here
 * layers two to four `fx_*` strips with offsets and timing on top of
 * `VfxSystem` — a death is a ground splat under a rising skull of smoke
 * behind a directional spray and a flash, not one sprite. Pure render
 * layer: nothing here is read back by the simulation.
 *
 * Conventions: (x, y) is the WORLD ground point of the body; `lift` is in
 * screen pixels; a tile is 64×32 px so a 128 px strip at scale 0.5 spans
 * one tile. Directional strips are drawn pointing SCREEN-EAST at rotation
 * 0; pass the blow's world direction and `screenAngle` turns it.
 */

import type { VfxHandle, VfxSystem } from '@/render/Vfx';

/** Screen-space rotation of a world direction (the 2:1 projection skews it). */
export function screenAngle(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2((dx + dy) / 2, dx - dy);
}

/** Seedless jitter for render-only scatter (never touches the sim RNG). */
const jitter = (r: number): number => (Math.random() - 0.5) * 2 * r;

// ---- deaths ------------------------------------------------------------

/**
 * A body comes apart: a blood splat on the ground, an upright spray, a
 * skull of smoke rising off the corpse, and an impact flash.
 */
export function fxDeathBurst(vfx: VfxSystem, x: number, y: number, big = false): void {
  const k = big ? 1.6 : 1;
  vfx.play('fx_splat_a', x, y, { scale: 1.3 * k, depthBias: -30, alpha: 0.9, tint: 0xb01818 });
  vfx.play('fx_splat_dir_b', x, y, { scale: 1.2 * k, lift: 14, rotation: -Math.PI / 2 + jitter(0.5), tint: 0xd02020 });
  vfx.play('fx_impact_b', x, y, { scale: 0.7 * k, lift: 16, alpha: 0.85, tint: 0xffe0d0 });
  vfx.later(0.12, () => vfx.play('fx_skull_smoke', x, y, { scale: 0.9 * k, lift: 30, alpha: 0.8, depthBias: 4 }));
}

/**
 * A warden falls: the big death strip on the body, the large explosion
 * over it, then a ring of eight staggered explosions walking round the
 * corpse over a second.
 */
export function fxBossDeath(vfx: VfxSystem, x: number, y: number): void {
  vfx.play('fx_boss_death', x, y, { scale: 2.2, lift: 18, overlay: true });
  vfx.play('fx_splat_a', x, y, { scale: 2.4, depthBias: -30, alpha: 0.9, tint: 0xb01818 });
  vfx.later(0.15, () => vfx.play('fx_explosion_big', x, y, { scale: 2.0, lift: 22, overlay: true }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    const r = 1.5 + (i % 2) * 0.5;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    vfx.later(0.25 + i * 0.11, () => {
      vfx.play(i % 2 ? 'fx_explosion_a' : 'fx_explosion_b', px, py, { scale: i % 2 ? 0.9 : 1.1, lift: 16, overlay: true });
      vfx.play('fx_smoke_burst', px, py, { scale: 1.0, lift: 12, alpha: 0.7 });
    });
  }
  vfx.later(0.5, () => vfx.play('fx_skull_smoke', x, y, { scale: 1.6, lift: 40, alpha: 0.85, overlay: true }));
}

// ---- blows -------------------------------------------------------------

/** A critical: the star burst with a hard impact flash under it. */
export function fxCrit(vfx: VfxSystem, x: number, y: number): void {
  vfx.play('fx_impact_b', x, y, { scale: 0.85, lift: 20, overlay: true, tint: 0xfff0b0 });
  vfx.play('fx_crit_star', x, y, { scale: 1.3, lift: 26, overlay: true, fps: 18 });
}

/**
 * A landed blow: a directional impact turned along the strike and a
 * spray of blood off the far side. `heavy` picks the wider strip.
 */
export function fxHit(vfx: VfxSystem, x: number, y: number, dx: number, dy: number, heavy = false): void {
  const rot = screenAngle(dx, dy);
  // it.117: `fx_impact_dir_b` is a 134 px streak — at 0.8 it was twice the
  // width of the body it lands on. 0.62 still reads as force, and you can see
  // who took it.
  vfx.play(heavy ? 'fx_impact_dir_b' : 'fx_impact_dir_a', x, y, { scale: heavy ? 0.62 : 0.9, lift: 20, rotation: rot, overlay: true, tint: 0xfff4e0 });
  vfx.play('fx_splat_dir_a', x, y, { scale: 1.1, lift: 18, rotation: rot, tint: 0xd02020 });
  if (heavy) vfx.play('fx_impact_c', x, y, { scale: 0.55, lift: 20, overlay: true, alpha: 0.8 });
}

// ---- the hero ----------------------------------------------------------

/**
 * Level up: a column of light behind the body and a second in front, the
 * level-up flare climbing off the head, sparkles around the feet.
 */
export function fxLevelUp(vfx: VfxSystem, x: number, y: number): void {
  vfx.play('fx_pillar_back', x, y, { scale: 0.9, lift: 60, loop: false, depthBias: -40, alpha: 0.9 });
  vfx.play('fx_pillar_front', x, y, { scale: 0.9, lift: 60, loop: false, overlay: true, alpha: 0.9 });
  vfx.play('fx_levelup', x, y, { scale: 1.2, lift: 42, overlay: true });
  vfx.later(0.2, () => vfx.play('fx_sparkle_b', x, y, { scale: 1.4, lift: 12, overlay: true, tint: 0xffe090 }));
  vfx.later(0.45, () => vfx.play('fx_sparkle_b', x + 0.4, y - 0.3, { scale: 1.1, lift: 34, overlay: true, tint: 0xffe090 }));
}

/** Healing: the green-white swirl climbing the body with a sparkle after it. */
export function fxHeal(vfx: VfxSystem, x: number, y: number): void {
  vfx.play('fx_heal', x, y, { scale: 0.62, lift: 22, overlay: true }); // it.117: a 96 px sheet on a 53 px body.
  vfx.later(0.3, () => vfx.play('fx_sparkle_c', x, y, { scale: 1.0, lift: 30, overlay: true, tint: 0xc0ffd0 }));
}

export type BuffKind = 'haste' | 'stone' | 'might' | 'ward';

/**
 * WHAT A BUFF LOOKS LIKE, AND HOW BIG (it.117).
 *
 * The strips are not the same size and were all being drawn at one scale, so
 * the biggest of them swallowed the hero. A painted hero stands ≈53 px at
 * zoom 1 (a tile is 64×32), and the rule that comes out of that is:
 *
 *   A SYMBOL — a clock, a mark, anything you read rather than feel — belongs
 *   ABOVE the head, ~26 px tall. `fx_haste` is a clock face 126×119 px; at
 *   the old 0.6 it painted 76 px across the archer's chest, which is the
 *   "gigantic clock face" on a speed buff. It is a good animation, so it is
 *   kept — at 0.22 (28 px) and lifted clear of the head, where a clock over
 *   someone's head means what it always has.
 *
 *   AN AURA — light gathering on the body — belongs ON the body, ~50 px,
 *   which for the 128 px `fx_attack_up` / `fx_defense_up` sheets is ~0.40.
 *
 * `size` is the aura; the opening flash is drawn a quarter larger.
 */
const BUFF_FX: Record<BuffKind, { strip: 'fx_haste' | 'fx_defense_up' | 'fx_attack_up' | 'fx_magic_barrier'; scale: number; lift: number; fps: number; symbol: boolean }> = {
  haste: { strip: 'fx_haste', scale: 0.22, lift: 58, fps: 14, symbol: true },
  stone: { strip: 'fx_defense_up', scale: 0.4, lift: 22, fps: 12, symbol: false },
  might: { strip: 'fx_attack_up', scale: 0.4, lift: 22, fps: 12, symbol: false },
  ward: { strip: 'fx_magic_barrier', scale: 1.15, lift: 22, fps: 24, symbol: false },
};

/**
 * A timed buff on the hero: a flash of the buff strip, then a looping aura
 * that follows the body until the returned handle is stopped. Stop it when
 * the buff's ticks run out.
 */
export function fxBuff(vfx: VfxSystem, kind: BuffKind, getPos: () => { x: number; y: number }): VfxHandle {
  const fx = BUFF_FX[kind];
  const p = getPos();
  vfx.play(fx.strip, p.x, p.y, { scale: fx.scale * 1.25, lift: fx.lift, overlay: true });
  // A symbol stays legible (it is read); an aura sits back under the body.
  return vfx.playFollowing(fx.strip, getPos, { scale: fx.scale, lift: fx.lift, loop: true, alpha: fx.symbol ? 0.8 : 0.55, overlay: true, fps: fx.fps });
}

// ---- pickups -----------------------------------------------------------

/** Gold scooped: coins fly. */
export function fxPickupGold(vfx: VfxSystem, x: number, y: number): void {
  // it.117: a 123 px sheet at 0.7 threw an 86 px shower of coins off a purse
  // the size of a fist. Half that is a handful of gold, which is what it is.
  vfx.play('fx_coin_burst', x, y, { scale: 0.42, lift: 12, overlay: true });
}

/** A rare find: the treasure burst with a sparkle on top. */
export function fxPickupRare(vfx: VfxSystem, x: number, y: number): void {
  vfx.play('fx_treasure_burst', x, y, { scale: 1.3, lift: 16, overlay: true });
  vfx.later(0.15, () => vfx.play('fx_sparkle_a', x, y, { scale: 1.3, lift: 24, overlay: true, tint: 0xffe8a0 }));
}

// ---- world beats -------------------------------------------------------

/** A portal used or a hero warped: the rift over a ground vortex. */
export function fxWarp(vfx: VfxSystem, x: number, y: number): void {
  vfx.play('fx_vortex', x, y, { scale: 1.0, depthBias: -30, tint: 0x9fc8ff, alpha: 0.9 });
  vfx.play('fx_warp_a', x, y, { scale: 0.8, lift: 22, overlay: true, tint: 0xb8d8ff });
}

/** A catapult stone comes down: the big blast, a smoke burst, three fire pillars around. */
export function fxCatapultImpact(vfx: VfxSystem, x: number, y: number): void {
  vfx.play('fx_explosion_big', x, y, { scale: 2.4, lift: 18, overlay: true });
  vfx.later(0.08, () => vfx.play('fx_smoke_burst', x, y, { scale: 2.2, lift: 10, alpha: 0.8 }));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.7;
    const px = x + Math.cos(a) * 0.9;
    const py = y + Math.sin(a) * 0.9;
    vfx.later(0.12 + i * 0.07, () => vfx.play('fx_fire_pillar', px, py, { scale: 1.4, lift: 20 }));
  }
}

/** A foe rises out of the dark: smoke bursting and a warp closing over it. */
export function fxSpawnShadow(vfx: VfxSystem, x: number, y: number): void {
  vfx.play('fx_smoke_burst', x, y, { scale: 1.3, lift: 10, alpha: 0.85, tint: 0x9088a8 });
  vfx.play('fx_warp_c', x, y, { scale: 0.7, lift: 18, tint: 0xb090e0, alpha: 0.9 });
}

/**
 * The "!" over a foe's head when it notices the hero.
 *
 * The strip is 39×74 px. it.114 drew it at full size — a banner as tall as the
 * foe; it.115 halved it to 0.38 (15×28 px). Smaller still in it.117 at 0.26
 * (10×19 px): a punctuation mark above the head, the size the "!" would be if
 * the foe had said it. It is a cue, and a cue that reads at a glance without
 * covering the body it belongs to is doing its whole job.
 */
export function fxAlert(vfx: VfxSystem, x: number, y: number, lift = 66): void {
  vfx.play('fx_alert', x, y, { scale: 0.26, lift, overlay: true });
}
