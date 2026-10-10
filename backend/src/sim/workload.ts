import { exponential, lognormal, Rng, seeded } from '../engine/rng.js';
import { MIN, TokenClass } from '../engine/types.js';

/** SYNTHETIC workload. Nothing here is real-world data. */
export interface SimService {
  id: string; name: string; targetWaitMs: number; mix: number;
  trueMu: number; trueSigma: number;   // what durations really are
  priorMu: number; priorSigma: number; // what the system is configured to believe on day one
}

export const SIM_SERVICES: SimService[] = [
  { id: 'D', name: 'Deposits', targetWaitMs: 15 * MIN, mix: 0.4, trueMu: Math.log(4), trueSigma: 0.5, priorMu: Math.log(5), priorSigma: 0.5 },
  { id: 'L', name: 'Loans', targetWaitMs: 30 * MIN, mix: 0.15, trueMu: Math.log(12), trueSigma: 0.45, priorMu: Math.log(10), priorSigma: 0.5 },
  { id: 'E', name: 'Enquiry', targetWaitMs: 10 * MIN, mix: 0.3, trueMu: Math.log(3), trueSigma: 0.6, priorMu: Math.log(3), priorSigma: 0.5 },
  { id: 'C', name: 'Cards', targetWaitMs: 20 * MIN, mix: 0.15, trueMu: Math.log(6), trueSigma: 0.5, priorMu: Math.log(7), priorSigma: 0.5 },
];

export const SIM_COUNTERS = [
  { id: 'C1', skills: ['D', 'E'] },
  { id: 'C2', skills: ['D', 'E', 'C'] },
  { id: 'C3', skills: ['L', 'D'] },
  { id: 'C4', skills: ['L'] },
  { id: 'C5', skills: ['E', 'C'] },
];

export const DAY_MS = 8 * 60 * MIN;
export const OUTAGE = { counterId: 'C3', from: 180 * MIN, to: 240 * MIN };
export const MISS_PROBABILITY = 0.08;

const CLASS_MIX: [TokenClass, number][] = [
  ['EMERGENCY', 0.01], ['PRIORITY', 0.11], ['APPOINTMENT', 0.15], ['NORMAL', 1],
];

export interface Arrival {
  id: string; t: number; serviceId: string; cls: TokenClass;
  trueMinutes: number;  // pre-sampled true service duration
  missRolls: number[];  // pre-sampled per-call miss rolls
}

/** Arrivals per minute: base load with a morning and a lunch peak. */
const rate = (m: number) =>
  0.55 + 0.5 * Math.exp(-(((m - 60) / 40) ** 2)) + 0.45 * Math.exp(-(((m - 240) / 35) ** 2));
const RATE_MAX = 1.6;

const pickCumulative = <T>(table: [T, number][], u: number): T =>
  (table.find(([, cum]) => u < cum) ?? table[table.length - 1])[0];

const SERVICE_CUM: [SimService, number][] = SIM_SERVICES.map((s, i) => [
  s, SIM_SERVICES.slice(0, i + 1).reduce((a, x) => a + x.mix, 0),
]);

function arrivalAt(t: number, i: number, rng: Rng): Arrival {
  const svc = pickCumulative(SERVICE_CUM, rng());
  return {
    id: `a${i}`, t, serviceId: svc.id, cls: pickCumulative(CLASS_MIX, rng()),
    trueMinutes: lognormal(svc.trueMu, svc.trueSigma, rng),
    missRolls: [rng(), rng(), rng()],
  };
}

/** Non-homogeneous Poisson arrivals over one day via thinning. */
export function generateDay(seed: number): Arrival[] {
  const rng = seeded(seed);
  const out: Arrival[] = [];
  for (let m = exponential(RATE_MAX, rng); m < DAY_MS / MIN; m += exponential(RATE_MAX, rng)) {
    const accept = rng() < rate(m) / RATE_MAX;
    accept && out.push(arrivalAt(m * MIN, out.length, rng));
  }
  return out;
}
