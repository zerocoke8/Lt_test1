/** Seeded PRNG (mulberry32). All sim randomness must go through this so runs are replayable. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Weighted pick by weight function. */
  weighted<T>(arr: readonly T[], weight: (x: T) => number): T {
    const total = arr.reduce((s, x) => s + weight(x), 0);
    let r = this.next() * total;
    for (const x of arr) {
      r -= weight(x);
      if (r <= 0) return x;
    }
    return arr[arr.length - 1];
  }
}

/**
 * Mix numbers into one 32-bit seed for a derived stream (기획 10차: 괴담 rooms roll on seed + floor + player and never
 * touch the run rng, so leaving every room keeps a run bit-identical).
 */
export function mixSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}
