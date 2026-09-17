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
  vfx.play(heavy ? 'fx_impact_dir_b' : 'fx_impact_dir_a', x, y, { scale: heavy ? 0.8 : 0.9, lift: 20, rotation: rot, overlay: true, tint: 0xfff4e0 });
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
  vfx.play('fx_heal', x, y, { scale: 0.85, lift: 22, overlay: true });
  vfx.later(0.3, () => vfx.play('fx_sparkle_c', x, y, { scale: 1.0, lift: 30, overlay: true, tint: 0xc0ffd0 }));
}

export type BuffKind = 'haste' | 'stone' | 'might' | 'ward';
const BUFF_STRIP: Record<BuffKind, 'fx_haste' | 'fx_defense_up' | 'fx_attack_up' | 'fx_magic_barrier'> = {
  haste: 'fx_haste',
  stone: 'fx_defense_up',
  might: 'fx_attack_up',
  ward: 'fx_magic_barrier',
};

/**
 * A timed buff on the hero: a flash of the buff strip, then a looping aura
 * that follows the body until the returned handle is stopped. Stop it when
 * the buff's ticks run out.
 */
export function fxBuff(vfx: VfxSystem, kind: BuffKind, getPos: () => { x: number; y: number }): VfxHandle {
  const strip = BUFF_STRIP[kind];
  const p = getPos();
  vfx.play(strip, p.x, p.y, { scale: kind === 'ward' ? 1.6 : 0.8, lift: 20, overlay: true });
  return vfx.playFollowing(strip, getPos, { scale: kind === 'ward' ? 1.3 : 0.6, lift: 20, loop: true, alpha: 0.55, overlay: true, fps: kind === 'ward' ? 24 : 12 });
}

// ---- pickups -----------------------------------------------------------

/** Gold scooped: coins fly. */
export function fxPickupGold(vfx: VfxSystem, x: number, y: number): void {
  vfx.play('fx_coin_burst', x, y, { scale: 0.7, lift: 12, overlay: true });
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

/** The "!" over a foe's head when it notices the hero. */
export function fxAlert(vfx: VfxSystem, x: number, y: number, lift = 54): void {
  vfx.play('fx_alert', x, y, { scale: 0.38, lift: lift - 10, overlay: true }); // Half the it.114 size: a mark over the head, not a banner (it.115).
}
