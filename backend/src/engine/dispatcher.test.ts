import { describe, it, expect } from 'vitest';
import { pickNext } from './dispatcher.js';
import { EngineState } from './types.js';

const MIN = 60_000;
const base = (): EngineState => ({
  services: { D: { id: 'D', targetWaitMs: 15 * MIN, mu: 1.2, sigma: 0.6 } },
  counters: { C1: { id: 'C1', open: true, skills: new Set(['D']), busyUntil: 0 } },
  waiting: [],
});

describe('pickNext', () => {
  it('calls the earliest deadline first', () => {
    const s = base();
    s.waiting.push(
      { id: 'n', seq: 1, serviceId: 'D', cls: 'NORMAL', creditedArrival: 0, deadline: 15 * MIN, notBefore: 0 },
      { id: 'p', seq: 2, serviceId: 'D', cls: 'PRIORITY', creditedArrival: 5 * MIN, deadline: 9.5 * MIN, notBefore: 0 },
    );
    expect(pickNext(s, 'C1', 6 * MIN)?.id).toBe('p');
  });
  it('serves anyone past the hard ceiling before everyone else', () => {
    const s = base();
    s.waiting.push(
      { id: 'old', seq: 1, serviceId: 'D', cls: 'NORMAL', creditedArrival: 0, deadline: 15 * MIN, notBefore: 0 },
      { id: 'p', seq: 2, serviceId: 'D', cls: 'PRIORITY', creditedArrival: 30 * MIN, deadline: 34.5 * MIN, notBefore: 0 },
    );
    expect(pickNext(s, 'C1', 31 * MIN)?.id).toBe('old');
  });
  it('skips tokens still in their missed-turn grace period', () => {
    const s = base();
    s.waiting.push({ id: 'm', seq: 1, serviceId: 'D', cls: 'NORMAL', creditedArrival: 0, deadline: 1, notBefore: 10 * MIN });
    expect(pickNext(s, 'C1', 5 * MIN)).toBeNull();
  });
});
