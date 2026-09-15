/**
 * Deterministic hashing and a small seeded PRNG. The roll must be reproducible
 * from the character name alone, so nothing here may touch Math.random.
 */

/** FNV-1a, 32-bit. Good enough to spread names across seeds. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Rng = () => number;

/** mulberry32. Returns floats in [0, 1). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, values: readonly T[]): T {
  if (values.length === 0) throw new Error('pick() from an empty list');
  return values[Math.min(values.length - 1, Math.floor(rng() * values.length))] as T;
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}
