import { POLICIES } from '../engine/dispatcher.js';
import { DurationStats, observe, posterior } from '../engine/duration.js';
import { forecast, naiveEta } from '../engine/forecast.js';
import { toPromise } from '../engine/ledger.js';
import { quantile } from '../engine/rng.js';
import {
  CALL_WINDOW_MS, CLASS_FACTOR, EngineCounter, EngineState, EngineToken, HARD_CEILING_FACTOR,
  MAX_MISSES, MIN, MISS_GRACE_MS, Policy, PROMISE_MIN_LEAD_MS, REENTRY_FACTOR, TokenClass,
} from '../engine/types.js';
import { Arrival, DAY_MS, generateDay, MISS_PROBABILITY, OUTAGE, SIM_COUNTERS, SIM_SERVICES } from './workload.js';

export interface PolicySpec {
  label: string;
  group: 'baseline' | 'fairline' | 'ablation';
  pick: Policy;
  eta: 'sim' | 'naive';
  miss: 'reenter' | 'back';
}

export const SPECS: Record<string, PolicySpec> = {
  B1: { label: 'B1 · FIFO + strict priority', group: 'baseline', pick: POLICIES.strictPriority, eta: 'naive', miss: 'back' },
  B2: { label: 'B2 · Weighted aging', group: 'baseline', pick: POLICIES.aging, eta: 'naive', miss: 'back' },
  F: { label: 'Fairline', group: 'fairline', pick: POLICIES.fairline, eta: 'sim', miss: 'reenter' },
  'F-noScarcity': { label: 'F − scarcity tie-break', group: 'ablation', pick: POLICIES.fairlineNoScarcity, eta: 'sim', miss: 'reenter' },
  'F-strictPriority': { label: 'F + strict priority', group: 'ablation', pick: POLICIES.fairlineStrictPriority, eta: 'sim', miss: 'reenter' },
  'F-naiveEta': { label: 'F + naive ETA', group: 'ablation', pick: POLICIES.fairline, eta: 'naive', miss: 'reenter' },
  'F-missBack': { label: 'F + miss → back', group: 'ablation', pick: POLICIES.fairline, eta: 'sim', miss: 'back' },
};

interface Rec { a: Arrival; tok: EngineToken; predicted: number; promise: number; missCount: number; firstMissAt: number }
interface ServedRow {
  cls: TokenClass; waitMin: number; predicted: number; promise: number; calledAt: number;
  recoveryMin: number; breachedCeiling: boolean;
}
interface DayResult { served: ServedRow[]; noShows: number; busyMs: number; openMs: number }

const TARGET = Object.fromEntries(SIM_SERVICES.map((s) => [s.id, s.targetWaitMs]));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);

/** One synthetic day under one policy, as a discrete-event simulation. Events are thunks. */
function simulateDay(spec: PolicySpec, arrivals: Arrival[], runs: number, sampleEvery: number, seed: number): DayResult {
  const stats: Record<string, DurationStats> = Object.fromEntries(
    SIM_SERVICES.map((s) => [s.id, { priorMu: s.priorMu, priorSigma: s.priorSigma, n: 0, mean: 0, m2: 0 }]),
  );
  const services = () => Object.fromEntries(
    SIM_SERVICES.map((s) => [s.id, { id: s.id, targetWaitMs: s.targetWaitMs, ...posterior(stats[s.id]) }]),
  );
  const engine: EngineState = {
    services: services(),
    counters: Object.fromEntries(SIM_COUNTERS.map((c) => [c.id, {
      id: c.id, open: true, skills: new Set(c.skills), busySince: null, busyService: null,
    }])),
    waiting: [],
  };
  const setCounter = (id: string, patch: Partial<EngineCounter>) => {
    engine.counters = { ...engine.counters, [id]: { ...engine.counters[id], ...patch } };
  };

  const events: { t: number; seq: number; run: () => void }[] = [];
  let evSeq = 0;
  const at = (t: number, run: () => void) => events.push({ t, seq: evSeq++, run });
  const popNext = () => {
    const i = events.reduce((best, e, k) => {
      const b = events[best];
      return e.t < b.t || (e.t === b.t && e.seq < b.seq) ? k : best;
    }, 0);
    return events.splice(i, 1)[0];
  };

  const idle = new Set(SIM_COUNTERS.map((c) => c.id));
  const recs = new Map<string, Rec>();
  const wakes = new Set<number>();
  const served: ServedRow[] = [];
  let noShows = 0;
  let busyMs = 0;
  let seq = 0;
  let forecastSeed = seed;

  const PREDICTORS = {
    sim: (tok: EngineToken, t: number) => {
      const band = forecast(engine, t, { runs, seed: forecastSeed++, policy: spec.pick })[tok.id];
      return [band?.p50 ?? Infinity, band?.p90 ?? Infinity];
    },
    naive: (tok: EngineToken, t: number) => [naiveEta(engine, tok, t), naiveEta(engine, tok, t)],
    skip: () => [NaN, NaN],
  };

  const wakeAt = (t: number) => {
    const fresh = t < Infinity && !wakes.has(t);
    fresh && wakes.add(t) && at(t, () => dispatchIdle(t));
  };

  const dispatchIdle = (t: number) => {
    [...idle].forEach((cid) => {
      const tok = spec.pick(engine, cid, t);
      tok && call(tok, cid, t);
    });
    wakeAt(Math.min(Infinity, ...engine.waiting.map((x) => x.notBefore).filter((nb) => nb > t)));
  };

  const free = (cid: string, t: number) => {
    setCounter(cid, { busySince: null, busyService: null });
    idle.add(cid);
    dispatchIdle(t);
  };

  const serve = (rec: Rec, cid: string, t: number) => {
    const dur = rec.a.trueMinutes * MIN;
    busyMs += dur;
    served.push({
      cls: rec.a.cls, waitMin: (t - rec.a.t) / MIN, predicted: rec.predicted, promise: rec.promise,
      calledAt: t, recoveryMin: (t - rec.firstMissAt) / MIN,
      breachedCeiling: t - rec.a.t > HARD_CEILING_FACTOR * TARGET[rec.a.serviceId],
    });
    at(t + dur, () => {
      stats[rec.a.serviceId] = observe(stats[rec.a.serviceId], rec.a.trueMinutes);
      engine.services = services();
      free(cid, t + dur);
    });
  };

  const requeue = (rec: Rec, tok: EngineToken) => { rec.tok = tok; engine.waiting.push(tok); };
  const MISS_ROUTES = {
    /** Fairline: re-enter after a grace delay with a short deadline, keeping arrival credit. */
    reenter: (rec: Rec, t: number) => requeue(rec, {
      ...rec.tok, notBefore: t + MISS_GRACE_MS,
      deadline: t + MISS_GRACE_MS + TARGET[rec.a.serviceId] * REENTRY_FACTOR,
    }),
    /** Conventional: go to the back of the queue as a fresh arrival. */
    back: (rec: Rec, t: number) => requeue(rec, {
      ...rec.tok, seq: seq++, creditedArrival: t, notBefore: t,
      deadline: t + TARGET[rec.a.serviceId] * CLASS_FACTOR[rec.a.cls],
    }),
    noShow: () => { noShows += 1; },
  };

  const miss = (rec: Rec, cid: string, t: number) => {
    const end = t + 2 * CALL_WINDOW_MS; // call + one auto-recall
    at(end, () => {
      rec.missCount += 1;
      rec.firstMissAt = Math.min(rec.firstMissAt, end);
      const route = (['policy', 'noShow'] as const)[Number(rec.missCount >= MAX_MISSES)];
      ({ policy: MISS_ROUTES[spec.miss], noShow: MISS_ROUTES.noShow })[route](rec, end);
      free(cid, end);
    });
  };

  const call = (tok: EngineToken, cid: string, t: number) => {
    engine.waiting.splice(engine.waiting.indexOf(tok), 1);
    idle.delete(cid);
    setCounter(cid, { busySince: t, busyService: tok.serviceId });
    const rec = recs.get(tok.id)!;
    const missed = rec.a.missRolls[rec.missCount] < MISS_PROBABILITY;
    [serve, miss][Number(missed)](rec, cid, t);
  };

  const arrive = (i: number) => {
    const a = arrivals[i];
    const tok: EngineToken = {
      id: a.id, seq: seq++, serviceId: a.serviceId, cls: a.cls, creditedArrival: a.t, notBefore: a.t,
      deadline: a.t + TARGET[a.serviceId] * CLASS_FACTOR[a.cls],
    };
    engine.waiting.push(tok);
    const sampled = i % sampleEvery === 0;
    const [predicted, p90] = PREDICTORS[sampled ? spec.eta : 'skip'](tok, a.t);
    const promise = toPromise(p90, a.t, PROMISE_MIN_LEAD_MS); // same promise rule for every policy
    recs.set(a.id, { a, tok, predicted, promise, missCount: 0, firstMissAt: Infinity });
    arrivals[i + 1] && at(arrivals[i + 1].t, () => arrive(i + 1));
    dispatchIdle(a.t);
  };

  at(OUTAGE.from, () => setCounter(OUTAGE.counterId, { open: false }));
  at(OUTAGE.to, () => { setCounter(OUTAGE.counterId, { open: true }); dispatchIdle(OUTAGE.to); });
  arrivals.length && at(arrivals[0].t, () => arrive(0));

  let lastT = 0;
  while (events.length) {
    const e = popNext();
    lastT = e.t;
    e.run();
  }
  const openMs = SIM_COUNTERS.length * Math.max(DAY_MS, lastT) - (OUTAGE.to - OUTAGE.from);
  return { served, noShows, busyMs, openMs };
}

const CLASSES: TokenClass[] = ['EMERGENCY', 'PRIORITY', 'APPOINTMENT', 'NORMAL'];

export interface PolicyResult {
  id: string; label: string; group: PolicySpec['group'];
  waitByClass: Record<TokenClass, { mean: number; p95: number; n: number }>;
  maxNormalWait: number;  // mean over days of the day's worst normal wait (min)
  promiseKept: number;    // share of sampled tokens called by their issue-time promise
  etaMae: number;         // mean |predicted − actual call| (min), sampled tokens
  utilization: number;
  starvation: number;     // tokens served beyond the hard ceiling
  missRecovery: number;   // mean minutes from first miss to final call
  noShows: number;
  served: number;
  perDay: { day: number; maxNormalWait: number; meanWait: number }[];
}

function summarize(id: string, spec: PolicySpec, days: DayResult[]): PolicyResult {
  const rows = days.flatMap((d) => d.served);
  const sampled = rows.filter((r) => Number.isFinite(r.predicted));
  const normalMax = (d: DayResult) => Math.max(0, ...d.served.filter((r) => r.cls === 'NORMAL').map((r) => r.waitMin));
  return {
    id, label: spec.label, group: spec.group,
    waitByClass: Object.fromEntries(CLASSES.map((cls) => {
      const w = rows.filter((r) => r.cls === cls).map((r) => r.waitMin);
      return [cls, { mean: mean(w), p95: w.length ? quantile(w, 0.95) : 0, n: w.length }];
    })) as PolicyResult['waitByClass'],
    maxNormalWait: mean(days.map(normalMax)),
    promiseKept: mean(sampled.map((r) => Number(r.calledAt <= r.promise))),
    etaMae: mean(sampled.map((r) => Math.abs(r.predicted - r.calledAt) / MIN)),
    utilization: mean(days.map((d) => d.busyMs / d.openMs)),
    starvation: rows.filter((r) => r.breachedCeiling).length,
    missRecovery: mean(rows.map((r) => r.recoveryMin).filter(Number.isFinite)),
    noShows: days.reduce((a, d) => a + d.noShows, 0),
    served: rows.length,
    perDay: days.map((d, i) => ({ day: i + 1, maxNormalWait: normalMax(d), meanWait: mean(d.served.map((r) => r.waitMin)) })),
  };
}

export interface EvalOptions {
  days?: number; seed?: number; runs?: number; sampleEvery?: number; policies?: string[];
  onProgress?: (done: number, total: number) => void; // called after each policy × day
}

/** Every policy runs on identical synthetic days (same seeds). */
export function evaluate(opts: EvalOptions = {}) {
  const { days = 8, seed = 1, runs = 40, sampleEvery = 3, policies = Object.keys(SPECS), onProgress } = opts;
  const started = Date.now();
  const dayList = Array.from({ length: days }, (_, d) => generateDay(seed + d));
  const ids = policies.filter((id) => SPECS[id]);
  let done = 0;
  const step = <T>(r: T) => (onProgress?.(++done, ids.length * days), r);
  const results = ids.map((id) => summarize(
    id, SPECS[id], dayList.map((arr, d) => step(simulateDay(SPECS[id], arr, runs, sampleEvery, seed * 1000 + d))),
  ));
  return {
    synthetic: true as const,
    days, seed, runs, sampleEvery,
    arrivalsPerDay: Math.round(mean(dayList.map((d) => d.length))),
    elapsedMs: Date.now() - started,
    results,
  };
}
