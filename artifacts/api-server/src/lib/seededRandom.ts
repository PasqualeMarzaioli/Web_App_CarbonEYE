/**
 * artifacts/api-server/src/lib/seededRandom.ts — Provides deterministic pseudorandom number generation from string seeds for reproducible test data generation.
 * Author: Pasquale Marzaioli
 */
function strHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function seededRandom(seed: string): () => number {
  let s = strHash(seed) >>> 0;
  return function () {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededJitter(rnd: () => number, base: number, pct: number): number {
  return Math.round((base + (rnd() * 2 - 1) * base * pct) * 100) / 100;
}
