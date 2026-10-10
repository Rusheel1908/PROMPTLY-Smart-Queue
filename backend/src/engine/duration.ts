/**
 * Online lognormal service-time model. We keep Welford mean/M2 of log(minutes)
 * and shrink toward the configured prior until ~PRIOR_WEIGHT observations exist.
 */
export const PRIOR_WEIGHT = 20;

export interface DurationStats {
  priorMu: number;
  priorSigma: number;
  n: number;
  mean: number; // mean of log(minutes)
  m2: number;   // sum of squared deviations of log(minutes)
}

export function observe(s: DurationStats, minutes: number): DurationStats {
  const x = Math.log(Math.max(minutes, 0.1));
  const n = s.n + 1;
  const delta = x - s.mean;
  const mean = s.mean + delta / n;
  return { ...s, n, mean, m2: s.m2 + delta * (x - mean) };
}

/** Posterior (mu, sigma) blending observed stats with the prior. */
export function posterior(s: DurationStats): { mu: number; sigma: number } {
  const w = s.n / (s.n + PRIOR_WEIGHT);
  const observedVar = s.m2 / Math.max(s.n - 1, 1);
  const variance = w * observedVar + (1 - w) * s.priorSigma ** 2;
  return { mu: w * s.mean + (1 - w) * s.priorMu, sigma: Math.sqrt(Math.max(variance, 0.01)) };
}

/** Expected value of a lognormal in minutes. */
export function meanMinutes(mu: number, sigma: number): number {
  return Math.exp(mu + sigma ** 2 / 2);
}
