import { describe, it, expect } from 'vitest';
import { ARRIVAL_CONFIG, estimateRates, Observed } from './arrivals.js';
import { POLICIES } from './dispatcher.js';
import { observe, posterior, PRIOR_WEIGHT } from './duration.js';
import { forecast, naiveEta, quote } from './forecast.js';
import { atRisk, etaShifts } from './ledger.js';
import { afterMiss, canTransition } from './stateMachine.js';
import { EngineState, EngineToken, MIN } from './types.js';
import { evaluate } from '../sim/evaluate.js';

const NOW = 1_000_000_000;
const counter = (id: string, skills: string[], open = true) =>
  ({ id, open, skills: new Set(skills), busySince: null, busyService: null });
const tok = (id: string, seq: number, p: Partial<EngineToken> = {}): EngineToken => ({
  id, seq, serviceId: 'D', cls: 'NORMAL', creditedArrival: NOW, notBefore: NOW, deadline: NOW + 15 * MIN, ...p,
});
const state = (n: number): EngineState => ({
  services: {
    D: { id: 'D', targetWaitMs: 15 * MIN, mu: Math.log(4), sigma: 0.5 },
    L: { id: 'L', targetWaitMs: 30 * MIN, mu: Math.log(12), sigma: 0.5 },
  },
  counters: { C1: counter('C1', ['D']), C2: counter('C2', ['D']) },
  waiting: Array.from({ length: n }, (_, i) => tok(`t${i}`, i)),
});

describe('state machine', () => {
  it('rejects invalid transitions such as completing a WAITING token', () => {
    expect(canTransition('WAITING', 'complete')).toBe(false);
    expect(canTransition('SERVING', 'complete')).toBe(true);
  });
  it('re-enters on the first miss and becomes NO_SHOW on the second', () => {
    expect(afterMiss(0)).toBe('WAITING');
    expect(afterMiss(1)).toBe('NO_SHOW');
  });
});

describe('duration model', () => {
  it('starts at the prior and moves toward observations', () => {
    let s = { priorMu: Math.log(10), priorSigma: 0.5, n: 0, mean: 0, m2: 0 };
    expect(posterior(s).mu).toBeCloseTo(Math.log(10));
    for (let i = 0; i < PRIOR_WEIGHT; i++) s = observe(s, 4);
    const mu = posterior(s).mu;
    expect(mu).toBeLessThan(Math.log(10));
    expect(mu).toBeGreaterThan(Math.log(4));
  });
});

describe('forecast', () => {
  it('is deterministic for a fixed seed', () => {
    expect(forecast(state(10), NOW)).toEqual(forecast(state(10), NOW));
  });

  it('fast static-order path matches the generic dispatcher exactly', () => {
    const s = state(30);
    s.counters = { ...s.counters, C3: counter('C3', ['D', 'L']) };
    s.waiting.push(
      tok('p', 40, { cls: 'PRIORITY', deadline: NOW + 4.5 * MIN }),
      tok('l', 41, { serviceId: 'L', deadline: NOW + 30 * MIN }),
      tok('old', 42, { creditedArrival: NOW - 40 * MIN, deadline: NOW - 25 * MIN }),
      tok('m', 43, { notBefore: NOW + 3 * MIN }),
    );
    const generic = (st: EngineState, id: string, t: number) => POLICIES.fairline(st, id, t);
    expect(forecast(s, NOW, { runs: 50 })).toEqual(forecast(s, NOW, { runs: 50, policy: generic }));
  });

  it('orders P50 call times by the dispatch policy and keeps P50 ≤ P90', () => {
    const f = forecast(state(10), NOW);
    expect(f.t0.p50).toBe(NOW);
    expect(f.t9.p50).toBeGreaterThan(f.t3.p50);
    Object.values(f).forEach((b) => expect(b.p50).toBeLessThanOrEqual(b.p90));
  });

  it('a priority arrival is forecast ahead of normals behind it', () => {
    const s = state(10);
    s.waiting.push(tok('p', 99, { cls: 'PRIORITY', deadline: NOW + 4.5 * MIN }));
    const f = forecast(s, NOW);
    expect(f.p.p50).toBeLessThan(f.t9.p50);
  });

  it('marks a service with no capable open counter as unavailable instead of faking a number', () => {
    const s = state(3);
    s.waiting.push(tok('loan', 50, { serviceId: 'L' }));
    expect(forecast(s, NOW).loan).toBeUndefined();
    expect(quote(s, 'L', NOW)).toBeNull();
    expect(naiveEta(s, s.waiting[3], NOW)).toBe(Infinity);
  });

  it('respects the missed-turn grace delay', () => {
    const s = state(0);
    s.waiting.push(tok('m', 1, { notBefore: NOW + 2 * MIN }));
    expect(forecast(s, NOW).m.p50).toBe(NOW + 2 * MIN);
  });

  it('stays fast with 500 waiting tokens', () => {
    const s = state(500);
    const t0 = performance.now();
    forecast(s, NOW);
    const ms = performance.now() - t0;
    console.log(`forecast(500 tokens, 300 runs): ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
  });
});

describe('arrival rates', () => {
  const prior = ARRIVAL_CONFIG.priorPerServiceMin * ARRIVAL_CONFIG.priorClassShare.NORMAL;
  const seen = (n: number, overMin: number): Observed[] =>
    Array.from({ length: n }, (_, i) => ({ t: NOW - (i * overMin * MIN) / n, serviceId: 'D', cls: 'NORMAL' }));

  it('a quiet start predicts the prior, not zero', () => {
    expect(estimateRates([], ['D'], NOW, NOW).D.NORMAL).toBeCloseTo(prior);
    expect(estimateRates([], ['D'], NOW, NOW).D.PRIORITY).toBeGreaterThan(0);
  });

  it('few observations stay near the prior, many approach the observed rate', () => {
    const few = estimateRates(seen(2, 5), ['D'], NOW, NOW - 5 * MIN).D.NORMAL;
    const many = estimateRates(seen(120, 60), ['D'], NOW, NOW - 60 * MIN).D.NORMAL;
    expect(Math.abs(few - prior)).toBeLessThan(Math.abs(few - 2 / 5)); // closer to prior than to 0.4/min
    expect(many).toBeGreaterThan(2 * 0.7);
    expect(many).toBeLessThan(2);
  });

  it('ignores arrivals outside the window and before opening', () => {
    const old = [{ t: NOW - 90 * MIN, serviceId: 'D', cls: 'NORMAL' as const }];
    expect(estimateRates(old, ['D'], NOW, 0)).toEqual(estimateRates([], ['D'], NOW, 0));
  });
});

describe('forecast with future arrivals', () => {
  const zero = { EMERGENCY: 0, PRIORITY: 0, APPOINTMENT: 0, NORMAL: 0 };
  const busy = { D: { ...zero, PRIORITY: 1.5 }, L: zero };
  const withArrivals = (n: number, arrivals: EngineState['arrivals']) => ({ ...state(n), arrivals });

  it('is deterministic for a fixed seed', () => {
    expect(forecast(withArrivals(10, busy), NOW, { seed: 7 })).toEqual(forecast(withArrivals(10, busy), NOW, { seed: 7 }));
  });

  it('later priority arrivals push an existing normal customer later', () => {
    const before = forecast(state(10), NOW).t6;
    const after = forecast(withArrivals(10, busy), NOW).t6;
    expect(after.p50).toBeGreaterThan(before.p50);
    expect(after.p90).toBeGreaterThan(before.p90);
  });

  it('zero rates give exactly the no-arrivals result', () => {
    expect(forecast(withArrivals(10, { D: zero, L: zero }), NOW)).toEqual(forecast(state(10), NOW));
  });

  it('phantom arrivals never appear in the result', () => {
    const s = withArrivals(10, busy);
    expect(Object.keys(forecast(s, NOW)).sort()).toEqual(s.waiting.map((t) => t.id).sort());
    expect(quote(s, 'D', NOW)).not.toBeNull();
    expect(quote(s, 'D', NOW)!.p50).toBeGreaterThan(quote(state(10), 'D', NOW)!.p50);
  });

  it('fast static-order path still matches the generic dispatcher when arrivals are inserted', () => {
    const s = withArrivals(30, { D: { EMERGENCY: 0.05, PRIORITY: 0.5, APPOINTMENT: 0.3, NORMAL: 0.8 }, L: { ...zero, NORMAL: 0.2 } });
    s.counters = { ...s.counters, C3: counter('C3', ['D', 'L']) };
    s.waiting.push(tok('l', 41, { serviceId: 'L', deadline: NOW + 30 * MIN }), tok('old', 42, { creditedArrival: NOW - 40 * MIN, deadline: NOW - 25 * MIN }));
    const generic = (st: EngineState, id: string, t: number) => POLICIES.fairline(st, id, t);
    expect(forecast(s, NOW, { runs: 50 })).toEqual(forecast(s, NOW, { runs: 50, policy: generic }));
  });

  it('stays fast with 500 waiting tokens and arrivals', () => {
    const s = withArrivals(500, { D: { EMERGENCY: 0.01, PRIORITY: 0.1, APPOINTMENT: 0.14, NORMAL: 0.75 }, L: zero });
    const t0 = performance.now();
    forecast(s, NOW);
    const ms = performance.now() - t0;
    console.log(`forecast(500 tokens + arrivals): ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
  });
});

describe('promise ledger', () => {
  it('records shifts above the threshold only', () => {
    const shifts = etaShifts({ a: NOW, b: NOW, c: null }, {
      a: { p50: NOW + 3 * MIN, p90: 0 }, b: { p50: NOW + 10_000, p90: 0 }, c: { p50: NOW, p90: 0 },
    });
    expect(shifts).toEqual([{ tokenId: 'a', deltaS: 180 }]);
  });
  it('flags a promise at risk when P90 slips past it', () => {
    expect(atRisk(NOW, { p50: NOW, p90: NOW + 1 })).toBe(true);
    expect(atRisk(NOW, { p50: NOW, p90: NOW })).toBe(false);
  });
});

describe('simulation lab', () => {
  it('runs every policy on identical synthetic days', () => {
    const r = evaluate({ days: 1, runs: 10, sampleEvery: 10 });
    expect(r.synthetic).toBe(true);
    expect(r.results.map((x) => x.id)).toEqual(['B1', 'B2', 'F', 'F-noScarcity', 'F-strictPriority', 'F-naiveEta', 'F-missBack', 'F-noArrivals']);
    r.results.forEach((x) => expect(x.served).toBeGreaterThan(100));
  }, 60_000);
});
