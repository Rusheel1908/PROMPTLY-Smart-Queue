import { Arrivals, nextArrival, samplesArrivals, startArrivals, takeArrival } from './arrivals.js';
import { capableCounts, pickNext, prepare, Prepared } from './dispatcher.js';
import { meanMinutes } from './duration.js';
import { lognormal, quantile, Rng, seeded } from './rng.js';
import { CLASS_FACTOR, EngineCounter, EngineState, EngineToken, MIN, Policy } from './types.js';

export interface Band { p50: number; p90: number } // ms epoch of the expected call time
export interface ForecastOpts { runs?: number; seed?: number; policy?: Policy }

/** Arrival sampling makes each replay longer; very long queues trade some replays back (≈300 ms at 500 tokens). */
export const FORECAST_CONFIG = {
  bigQueueTokens: 300, // with arrivals, queues longer than this get proportionally fewer replays
  minRuns: 150,        // never fewer replays than this
};

interface Slot { id: string; t: number }

/** Time until a busy counter frees up, sampled conditional on how long it has already been busy. */
function remainingMs(s: EngineState, c: EngineCounter, now: number, rng: Rng): number {
  const svc = s.services[c.busyService ?? ''];
  const elapsedMin = (now - (c.busySince ?? now)) / MIN;
  const draws = Array.from({ length: 20 }, () => (svc ? lognormal(svc.mu, svc.sigma, rng) : 0));
  const total = draws.find((d) => d > elapsedMin) ?? elapsedMin + 0.5 * Number(!!svc);
  return (total - elapsedMin) * MIN;
}

/** Next moment this counter could have work: a token leaving its grace delay or a new arrival it serves; Infinity if never. */
function nextWake(s: EngineState, arrivals: Arrivals, counterId: string, t: number): number {
  const skills = s.counters[counterId].skills;
  return Math.min(
    nextArrival(arrivals, skills)?.next ?? Infinity,
    ...s.waiting.filter((x) => skills.has(x.serviceId) && x.notBefore > t).map((x) => x.notBefore),
  );
}

/** Move every hypothetical customer who has arrived by time `t` into the simulated queue. */
function admit(s: EngineState, arrivals: Arrivals, t: number, insert: Prepared['insert']) {
  for (let x = nextArrival(arrivals); x && x.next <= t; x = nextArrival(arrivals)) {
    insert(s.waiting, takeArrival(arrivals, x));
  }
}

const earliest = (free: Slot[]): Slot =>
  free.reduce((a, b) => (b.t < a.t ? b : a), { id: '', t: Infinity });

/** Call `tok` at `t`; returns when the counter frees up. Only real tokens are recorded. */
function serve(s: EngineState, tok: EngineToken, t: number, calls: Record<string, number[]>, rng: Rng) {
  calls[tok.id]?.push(t);
  s.waiting.splice(s.waiting.indexOf(tok), 1);
  const svc = s.services[tok.serviceId];
  return t + lognormal(svc.mu, svc.sigma, rng) * MIN;
}

/** Fewer replays for very long queues when sampling arrivals; the no-arrivals path keeps every run. */
export function runsFor(runs: number, s: EngineState): number {
  const scale = samplesArrivals(s) ? Math.min(1, FORECAST_CONFIG.bigQueueTokens / Math.max(s.waiting.length, 1)) : 1;
  return Math.max(Math.min(runs, FORECAST_CONFIG.minRuns), Math.round(runs * scale));
}

/**
 * Policy-faithful forecast: replay the actual dispatcher `runs` times with sampled
 * service durations, and report P50/P90 call times per token. Tokens no open counter
 * can serve are absent from the result (their ETA is "unavailable", never faked).
 * With `s.arrivals`, each replay also samples customers who have not arrived yet; they
 * compete for counters but never appear in the result.
 */
export function forecast(s: EngineState, now: number, opts: ForecastOpts = {}): Record<string, Band> {
  const { runs = 300, seed = 42, policy = pickNext } = opts;
  const rng = seeded(seed);
  const arrivalRng = seeded(seed ^ 0x9e3779b9); // own stream: durations replay identically with or without arrivals
  const calls: Record<string, number[]> = Object.fromEntries(s.waiting.map((t) => [t.id, []]));
  const open = Object.values(s.counters).filter((c) => c.open);
  const capable = capableCounts(s);
  const { waiting, pick, insert } = prepare(policy, s, now);
  const firstSeq = Math.max(0, ...s.waiting.map((t) => t.seq)) + 1; // hypothetical customers arrive after everyone real

  for (let r = 0, n = runsFor(runs, s); r < n; r++) {
    const sim: EngineState = { ...s, waiting: [...waiting] };
    const arrivals = startArrivals(s, capable, now, firstSeq, arrivalRng);
    const free = open.map((c) => ({ id: c.id, t: now + remainingMs(s, c, now, rng) }));
    let realLeft = waiting.length;
    for (let slot = earliest(free); realLeft > 0 && slot.t < Infinity; slot = earliest(free)) {
      admit(sim, arrivals, slot.t, insert);
      const tok = pick(sim, slot.id, slot.t);
      realLeft -= Number(!!tok && tok.id in calls);
      slot.t = tok ? serve(sim, tok, slot.t, calls, rng) : nextWake(sim, arrivals, slot.id, slot.t);
    }
  }
  return Object.fromEntries(
    Object.entries(calls).filter(([, xs]) => xs.length).map(([id, xs]) => [id, { p50: quantile(xs, 0.5), p90: quantile(xs, 0.9) }]),
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
