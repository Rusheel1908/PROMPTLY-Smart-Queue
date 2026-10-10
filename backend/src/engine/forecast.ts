import { capableCounts, pickNext, prepare } from './dispatcher.js';
import { meanMinutes } from './duration.js';
import { lognormal, quantile, Rng, seeded } from './rng.js';
import { CLASS_FACTOR, EngineCounter, EngineState, EngineToken, MIN, Policy } from './types.js';

export interface Band { p50: number; p90: number } // ms epoch of the expected call time
export interface ForecastOpts { runs?: number; seed?: number; policy?: Policy }

interface Slot { id: string; t: number }

/** Time until a busy counter frees up, sampled conditional on how long it has already been busy. */
function remainingMs(s: EngineState, c: EngineCounter, now: number, rng: Rng): number {
  const svc = s.services[c.busyService ?? ''];
  const elapsedMin = (now - (c.busySince ?? now)) / MIN;
  const draws = Array.from({ length: 20 }, () => (svc ? lognormal(svc.mu, svc.sigma, rng) : 0));
  const total = draws.find((d) => d > elapsedMin) ?? elapsedMin + 0.5 * Number(!!svc);
  return (total - elapsedMin) * MIN;
}

/** Next moment a token this counter could serve leaves its grace delay; Infinity if never. */
function nextEligibleTime(s: EngineState, counterId: string, t: number): number {
  const skills = s.counters[counterId].skills;
  return Math.min(
    Infinity,
    ...s.waiting.filter((x) => skills.has(x.serviceId) && x.notBefore > t).map((x) => x.notBefore),
  );
}

const earliest = (free: Slot[]): Slot =>
  free.reduce((a, b) => (b.t < a.t ? b : a), { id: '', t: Infinity });

function serve(s: EngineState, tok: EngineToken, t: number, calls: Record<string, number[]>, rng: Rng) {
  (calls[tok.id] ??= []).push(t);
  s.waiting.splice(s.waiting.indexOf(tok), 1);
  const svc = s.services[tok.serviceId];
  return t + lognormal(svc.mu, svc.sigma, rng) * MIN;
}

/**
 * Policy-faithful forecast: replay the actual dispatcher `runs` times with sampled
 * service durations, and report P50/P90 call times per token. Tokens no open counter
 * can serve are absent from the result (their ETA is "unavailable", never faked).
 */
export function forecast(s: EngineState, now: number, opts: ForecastOpts = {}): Record<string, Band> {
  const { runs = 300, seed = 42, policy = pickNext } = opts;
  const rng = seeded(seed);
  const calls: Record<string, number[]> = {};
  const open = Object.values(s.counters).filter((c) => c.open);
  const { waiting, pick } = prepare(policy, s, now);

  for (let r = 0; r < runs; r++) {
    const sim: EngineState = { ...s, waiting: [...waiting] };
    const free = open.map((c) => ({ id: c.id, t: now + remainingMs(s, c, now, rng) }));
    for (let slot = earliest(free); sim.waiting.length && slot.t < Infinity; slot = earliest(free)) {
      const tok = pick(sim, slot.id, slot.t);
      slot.t = tok ? serve(sim, tok, slot.t, calls, rng) : nextEligibleTime(sim, slot.id, slot.t);
    }
  }
  return Object.fromEntries(
    Object.entries(calls).map(([id, xs]) => [id, { p50: quantile(xs, 0.5), p90: quantile(xs, 0.9) }]),
  );
}

/** What a customer would be quoted if they joined `serviceId` right now as a normal customer. */
export function quote(s: EngineState, serviceId: string, now: number, runs = 120): Band | null {
  const phantom: EngineToken = {
    id: '__quote__', seq: Number.MAX_SAFE_INTEGER, serviceId, cls: 'NORMAL',
    creditedArrival: now, notBefore: now,
    deadline: now + s.services[serviceId].targetWaitMs * CLASS_FACTOR.NORMAL,
  };
  return forecast({ ...s, waiting: [...s.waiting, phantom] }, now, { runs })[phantom.id] ?? null;
}

/** Baseline ETA: position × mean service time / capable counters (Infinity when none). */
export function naiveEta(s: EngineState, tok: EngineToken, now: number): number {
  const svc = s.services[tok.serviceId];
  const ahead = s.waiting.filter((x) => x.serviceId === tok.serviceId && x.seq < tok.seq).length;
  const capable = capableCounts(s)[tok.serviceId];
  return now + ((ahead + 1) * meanMinutes(svc.mu, svc.sigma) * MIN) / capable;
}
