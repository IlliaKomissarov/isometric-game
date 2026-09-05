/**
 * @module utils/rng
 * Deterministic mulberry32 PRNG — THE single implementation.
 *
 * Every gameplay-affecting roll (dungeon layout, prop placement, loot,
 * combat to-hit/damage) must come from a seeded stream created here, keyed
 * off the dungeon seed, so co-op peers replay identical outcomes. Never use
 * `Math.random()` in simulation code (render-only effects are exempt).
 *
 * THE STATE IS READABLE (it.73): a stream exposes its 32-bit state so a
 * world snapshot can carry the exact point every live stream has reached —
 * a player joining a delve in progress then rolls what the leader rolls.
 */

/** A seeded sampler whose position in the stream can be read and restored. */
export interface Rng {
  (): number;
  /** The mulberry32 state word (uint32). Set it to rewind or fast-forward. */
  state: number;
}

/** Create a deterministic [0,1) sampler from a 32-bit seed. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const fn = (() => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  Object.defineProperty(fn, 'state', {
    get: () => a >>> 0,
    set: (v: number) => {
      a = v >>> 0;
    },
  });
  return fn;
}

/** Integer in [min, max] inclusive from a sampler. */
export function randInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}
