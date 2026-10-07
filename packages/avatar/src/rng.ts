/** Small seedable PRNG (mulberry32) so animation is reproducible in tests. */
export function createRng(seed = Date.now()): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise built from layered sines with irrational ratios. */
export function drift(t: number, seed: number): number {
  return (
    Math.sin(t * 0.00037 + seed) * 0.5 +
    Math.sin(t * 0.00091 + seed * 1.7) * 0.3 +
    Math.sin(t * 0.0021 + seed * 2.3) * 0.2
  );
}
