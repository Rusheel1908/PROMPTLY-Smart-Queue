export type Rng = () => number;

/** Mulberry32: tiny, fast, deterministic. Same seed → same replay. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
export function normal(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Lognormal sample in minutes. */
export function lognormal(mu: number, sigma: number, rng: Rng): number {
  return Math.exp(mu + sigma * normal(rng));
}

/** Exponential sample (inter-arrival times). */
export function exponential(rate: number, rng: Rng): number {
  return -Math.log(Math.max(1 - rng(), 1e-12)) / rate;
}

export function quantile(xs: number[], q: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}
