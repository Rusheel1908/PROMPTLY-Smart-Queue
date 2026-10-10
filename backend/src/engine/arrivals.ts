import { exponential, Rng } from './rng.js';
import { CLASS_FACTOR, EngineState, EngineToken, MIN, TokenClass } from './types.js';

/**
 * Arrival-rate model: customers per minute for each (service, class), learned from recent
 * arrivals and shrunk toward a configured prior while there is little to learn from.
 */
export type ArrivalRates = Record<string, Record<TokenClass, number>>;
export interface Observed { t: number; serviceId: string; cls: TokenClass }

export const CLASSES: TokenClass[] = ['EMERGENCY', 'PRIORITY', 'APPOINTMENT', 'NORMAL'];

export const ARRIVAL_CONFIG = {
  windowMs: 60 * MIN,         // sliding window of observed arrivals
  priorPerServiceMin: 0.15,   // configured belief: customers/min per service, before anything is observed
  priorClassShare: { EMERGENCY: 0.01, PRIORITY: 0.1, APPOINTMENT: 0.14, NORMAL: 0.75 } as Record<TokenClass, number>,
  priorWeightMin: 20,         // the prior counts as this many minutes of observation
  horizonMs: 3 * 60 * MIN,    // replays sample no arrivals beyond now + horizon
};
export type ArrivalConfig = typeof ARRIVAL_CONFIG;

const priorRate = (cls: TokenClass, cfg: ArrivalConfig) => cfg.priorPerServiceMin * cfg.priorClassShare[cls];

/**
 * Gamma–Poisson blend per cell: (n + prior·W) / (T + W), where T is how long we have been
 * watching (at most the window, never before `since`, e.g. opening time) and W the prior weight.
 */
export function estimateRates(
  observed: Observed[], serviceIds: string[], now: number, since: number, cfg: ArrivalConfig = ARRIVAL_CONFIG,
): ArrivalRates {
  const from = Math.min(now, Math.max(since, now - cfg.windowMs));
  const watchedMin = (now - from) / MIN;
  const counts: Record<string, number> = {};
  observed.filter((o) => o.t >= from && o.t <= now).forEach((o) => {
    counts[`${o.serviceId}|${o.cls}`] = (counts[`${o.serviceId}|${o.cls}`] ?? 0) + 1;
  });
  const blend = (svc: string, cls: TokenClass) =>
    ((counts[`${svc}|${cls}`] ?? 0) + priorRate(cls, cfg) * cfg.priorWeightMin) / (watchedMin + cfg.priorWeightMin);
  return Object.fromEntries(serviceIds.map((svc) => [
    svc, Object.fromEntries(CLASSES.map((cls) => [cls, blend(svc, cls)])) as Record<TokenClass, number>,
  ]));
}

/** True when replays will sample at least one stream of future customers. */
export const samplesArrivals = (s: EngineState) =>
  Object.values(s.arrivals ?? {}).some((byClass) => Object.values(byClass).some((r) => r > 0));

/** One Poisson stream per (service, class); `next` is its next arrival time (ms). */
interface Stream { svc: string; cls: TokenClass; rate: number; next: number }

/** Hypothetical future customers of one replay, drawn lazily so a short replay draws only a few. */
export interface Arrivals { streams: Stream[]; end: number; seq: number; rng: Rng; s: EngineState }

/**
 * Start one replay's arrival streams. Zero-rate streams draw nothing, and services no open
 * counter can serve are skipped: their customers could not affect anyone's call time.
 */
export function startArrivals(
  s: EngineState, capable: Record<string, number>, now: number, firstSeq: number, rng: Rng, cfg: ArrivalConfig = ARRIVAL_CONFIG,
): Arrivals {
  const streams = Object.entries(s.arrivals ?? {})
    .filter(([svc]) => s.services[svc] && capable[svc] > 0)
    .flatMap(([svc, byClass]) => CLASSES.map((cls) => ({ svc, cls, rate: byClass[cls] ?? 0 })))
    .filter((x) => x.rate > 0)
    .map((x) => ({ ...x, next: now + exponential(x.rate, rng) * MIN }));
  return { streams, end: now + cfg.horizonMs, seq: firstSeq, rng, s };
}

/** The stream whose next arrival comes first (optionally only for some services); undefined past the horizon. */
export function nextArrival(a: Arrivals, services?: Set<string>): Stream | undefined {
  return a.streams.reduce<Stream | undefined>(
    (best, x) => (x.next < a.end && (!services || services.has(x.svc)) && (!best || x.next < best.next) ? x : best),
    undefined,
  );
}

/** Turn a stream's next arrival into a token and draw the one after it. */
export function takeArrival(a: Arrivals, x: Stream): EngineToken {
  const t = x.next;
  const seq = a.seq++;
  x.next += exponential(x.rate, a.rng) * MIN;
  return {
    id: `~arr${seq}`, seq, serviceId: x.svc, cls: x.cls,
    creditedArrival: t, notBefore: t, deadline: t + a.s.services[x.svc].targetWaitMs * CLASS_FACTOR[x.cls],
  };
}
