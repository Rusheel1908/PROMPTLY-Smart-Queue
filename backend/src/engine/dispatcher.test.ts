import { describe, it, expect } from 'vitest';
import { explainPick, pickNext, POLICIES } from './dispatcher.js';
import { EngineState, EngineToken, MIN } from './types.js';

const counter = (id: string, skills: string[], open = true) =>
  ({ id, open, skills: new Set(skills), busySince: null, busyService: null });

const base = (): EngineState => ({
  services: {
    D: { id: 'D', targetWaitMs: 15 * MIN, mu: 1.2, sigma: 0.6 },
    L: { id: 'L', targetWaitMs: 15 * MIN, mu: 2.4, sigma: 0.5 },
  },
  counters: { C1: counter('C1', ['D']) },
  waiting: [],
});

const tok = (p: Partial<EngineToken> & { id: string }): EngineToken =>
  ({ seq: 1, serviceId: 'D', cls: 'NORMAL', creditedArrival: 0, deadline: 15 * MIN, notBefore: 0, ...p });

describe('pickNext', () => {
  it('calls immediately from a one-token queue', () => {
    const s = base();
    s.waiting.push(tok({ id: 'only' }));
    expect(pickNext(s, 'C1', 0)?.id).toBe('only');
  });

  it('calls the earliest deadline first', () => {
    const s = base();
    s.waiting.push(
      tok({ id: 'n', seq: 1 }),
      tok({ id: 'p', seq: 2, cls: 'PRIORITY', creditedArrival: 5 * MIN, deadline: 9.5 * MIN }),
    );
    expect(pickNext(s, 'C1', 6 * MIN)?.id).toBe('p');
  });

  it('does not put priority ahead of a normal already past its deadline', () => {
    const s = base();
    s.waiting.push(
      tok({ id: 'n', seq: 1, deadline: 15 * MIN }),
      tok({ id: 'p', seq: 2, cls: 'PRIORITY', creditedArrival: 16 * MIN, deadline: 20.5 * MIN }),
    );
    expect(pickNext(s, 'C1', 16 * MIN)?.id).toBe('n');
  });

  it('serves anyone past the hard ceiling before everyone else', () => {
    const s = base();
    s.waiting.push(
      tok({ id: 'old', seq: 1 }),
      tok({ id: 'p', seq: 2, cls: 'PRIORITY', creditedArrival: 30 * MIN, deadline: 4.5 * MIN }),
    );
    expect(pickNext(s, 'C1', 31 * MIN)?.id).toBe('old');
  });

  it('skips tokens still in their missed-turn grace period', () => {
    const s = base();
    s.waiting.push(tok({ id: 'm', deadline: 1, notBefore: 10 * MIN }));
    expect(pickNext(s, 'C1', 5 * MIN)).toBeNull();
  });

  it('returns nothing for a closed counter', () => {
    const s = base();
    s.counters = { C1: counter('C1', ['D'], false) };
    s.waiting.push(tok({ id: 'x' }));
    expect(pickNext(s, 'C1', 0)).toBeNull();
  });

  it('breaks deadline ties toward the service fewer counters can handle', () => {
    const s = base();
    s.counters = { C1: counter('C1', ['D', 'L']), C2: counter('C2', ['D']) };
    s.waiting.push(tok({ id: 'd', seq: 1 }), tok({ id: 'l', seq: 2, serviceId: 'L' }));
    expect(pickNext(s, 'C1', 0)?.id).toBe('l');
    expect(POLICIES.fairlineNoScarcity(s, 'C1', 0)?.id).toBe('d');
  });

  it('never starves normals under a continuous priority stream', () => {
    const s = base();
    s.waiting.push(tok({ id: 'normal', seq: 0 }));
    // a fresh priority customer arrives every minute; one token is served per minute
    const servedAt = Array.from({ length: 40 }, (_, m) => {
      s.waiting.push(tok({ id: `p${m}`, seq: m + 1, cls: 'PRIORITY', creditedArrival: m * MIN, deadline: m * MIN + 4.5 * MIN }));
      const next = pickNext(s, 'C1', m * MIN)!;
      s.waiting.splice(s.waiting.indexOf(next), 1);
      return next.id;
    }).indexOf('normal');
    expect(servedAt).toBeGreaterThanOrEqual(0);
    expect(servedAt).toBeLessThanOrEqual(30); // within the 2× hard ceiling
  });

  it('strict priority (baseline B1) does starve the normal customer', () => {
    const s = base();
    s.waiting.push(tok({ id: 'normal', seq: 0 }));
    const ids = Array.from({ length: 40 }, (_, m) => {
      s.waiting.push(tok({ id: `p${m}`, seq: m + 1, cls: 'PRIORITY' }));
      const next = POLICIES.strictPriority(s, 'C1', m * MIN)!;
      s.waiting.splice(s.waiting.indexOf(next), 1);
      return next.id;
    });
    expect(ids).not.toContain('normal');
  });

  it('explains why a token was picked', () => {
    const s = base();
    const t = tok({ id: 'x' });
    s.waiting.push(t);
    expect(explainPick(s, t, 0)).toMatch(/Earliest deadline/);
    expect(explainPick(s, t, 0)).toMatch(/only open counter/);
  });
});
