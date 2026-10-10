import { describe, expect, it } from 'vitest';
import { candidates, SUGGEST_CONFIG, SuggestCounter, SuggestInput, suggest } from './suggest.js';
import { EngineToken, MIN } from './types.js';

const NOW = 1_000_000_000;
const SERVICES = { D: 'Deposits', L: 'Loans', E: 'Enquiry', C: 'Cards' } as const;
type Svc = keyof typeof SERVICES;

const TARGET_MIN: Record<Svc, number> = { D: 15, L: 30, E: 10, C: 20 };
/** Deadlines follow each service's target, as issueToken sets them. */
const tok = (id: string, seq: number, serviceId: Svc): EngineToken => ({
  id, seq, serviceId, cls: 'NORMAL', creditedArrival: NOW, notBefore: NOW, deadline: NOW + TARGET_MIN[serviceId] * MIN,
});

/** A world from counter specs and a queue like "LLLLDDDDDD"; engine state and counter list always agree. */
function world(counters: SuggestCounter[], queue: string, p: Partial<SuggestInput> = {}): SuggestInput {
  const svc = (id: Svc, minutes: number, target: number) => ({ id, targetWaitMs: target * MIN, mu: Math.log(minutes), sigma: 0.5 });
  return {
    state: {
      services: { D: svc('D', 4, TARGET_MIN.D), L: svc('L', 12, TARGET_MIN.L), E: svc('E', 3, TARGET_MIN.E), C: svc('C', 6, TARGET_MIN.C) },
      counters: Object.fromEntries(counters.map((c) => [c.id, {
        id: c.id, open: c.status === 'OPEN', skills: new Set(c.skills), busySince: null, busyService: null,
      }])),
      waiting: [...queue].map((s, i) => tok(`t${i}`, i, s as Svc)),
    },
    counters,
    serviceNames: { ...SERVICES },
    promises: {},
    statusChangedAt: {},
    now: NOW,
    ...p,
  };
}
const c = (id: string, skills: Svc[], status: SuggestCounter['status'] = 'OPEN'): SuggestCounter =>
  ({ id, name: `Counter ${id.slice(1)}`, status, skills });

/** The only Loans counter (C3) has just been closed. */
const loansClosed = (closedAgoMs: number) => world(
  [c('C1', ['D', 'E']), c('C2', ['D']), c('C3', ['L'], 'CLOSED')],
  'LLLLDDDDDD',
  { statusChangedAt: { C3: NOW - closedAgoMs } },
);
const restoresLoans = (s: { change: { kind: string; counterId: string; serviceId: string | null } }) =>
  (s.change.kind === 'reopen' && s.change.counterId === 'C3') || s.change.serviceId === 'L';

describe('candidates', () => {
  it('adds only waiting services to open counters under the skill cap, in a stable order', () => {
    const x = world([c('C2', ['D', 'E', 'C']), c('C1', ['D']), c('C9', ['L'], 'PAUSED')], 'DLE', {
      statusChangedAt: { C9: NOW - 11 * MIN },
    });
    expect(candidates(x).map((k) => k.id)).toEqual([
      'add-skill:C1:E', 'add-skill:C1:L', // C2 is at the cap, C9 is not open; Cards has nobody waiting
      'reopen:C9',
    ]);
    expect(candidates(x)[1].patch).toEqual({ skills: ['D', 'L'] });
  });

  it('does not suggest reopening a counter staff changed within the cooldown', () => {
    expect(candidates(loansClosed(2 * MIN)).some((k) => k.kind === 'reopen')).toBe(false);
    expect(candidates(loansClosed(11 * MIN)).some((k) => k.id === 'reopen:C3')).toBe(true);
  });

  it('caps the number of candidates', () => {
    expect(candidates(loansClosed(11 * MIN), { ...SUGGEST_CONFIG, maxCandidates: 2 })).toHaveLength(2);
  });
});

describe('suggest', () => {
  it('when the only Loans counter closes, the top suggestion restores Loans capacity', () => {
    for (const ago of [2 * MIN, 11 * MIN]) {
      const [top] = suggest(loansClosed(ago)).suggestions;
      expect(restoresLoans(top)).toBe(true);
      expect(top.numbers.newlyServable).toBe(4);
      expect(top.explanation).toMatch(/4 customers can be served again/);
    }
    // inside the cooldown it is a skill change, explained in one line
    const [top] = suggest(loansClosed(2 * MIN)).suggestions;
    expect(top.explanation).toMatch(/^Add Loans to Counter \d → /);
  });

  it('counts promises brought back on track', () => {
    // the last two Loans customers: P90 ≈ 74 and 89 min with one Loans counter, well under 60 with two
    const x = world([c('C1', ['L']), c('C2', ['D'])], 'LLLLLL');
    const loose = suggest(x).suggestions.find((s) => s.id === 'add-skill:C2:L')!;
    const promises = { t4: NOW + 60 * MIN, t5: NOW + 60 * MIN };
    const tight = suggest({ ...x, promises }).suggestions.find((s) => s.id === 'add-skill:C2:L')!;
    expect(tight.numbers.promisesRescued).toBeGreaterThan(0);
    expect(tight.score).toBeGreaterThan(loose.score);
    expect(tight.explanation).toMatch(/promises? back on track/);
  });

  it('returns nothing when no change would help', () => {
    // no candidates at all: every waiting service is already covered and nothing is closed
    expect(suggest(world([c('C1', ['D', 'L'])], 'D')).suggestions).toEqual([]);
    // candidates exist, but an idle counter already serves everyone right away
    const idle = world([c('C1', ['D']), c('C2', ['E'])], 'DE');
    expect(candidates(idle).length).toBeGreaterThan(0);
    expect(suggest(idle).suggestions).toEqual([]);
  });

  it('demo branch layout: closing Counter 3 suggests adding Loans to Counter 1', () => {
    const seed = [c('C1', ['D', 'E']), c('C2', ['D', 'E', 'C']), c('C3', ['L', 'D'], 'CLOSED'), c('C4', ['L']), c('C5', ['E', 'C'])];
    const [top] = suggest(world(seed, 'CECLLDECLCLE', { statusChangedAt: { C3: NOW - MIN } })).suggestions;
    expect(top.explanation).toMatch(/^Add Loans to Counter 1 → Loans customers called ~\d+ min sooner/);
  });

  it('weighs a trade-off: shown with its cost when the gain is larger, hidden when the delays outweigh it', () => {
    const counters = [c('C1', ['D']), c('C2', ['C'])];
    const [worth] = suggest(world(counters, 'DDDDDDDDDDCC')).suggestions;
    expect(worth.id).toBe('add-skill:C2:D');
    expect(worth.numbers.madeWorse).toBe(2);
    expect(worth.explanation).toMatch(/Deposits customers called ~\d+ min sooner \(2 others ~\d+ min later\)$/);
    expect(suggest(world(counters, 'DDDDDDDDCCCC')).suggestions).toEqual([]);
  });

  it('counts promises a change would break against it', () => {
    const x = world([c('C1', ['D']), c('C2', ['C'])], 'DDDDDDDDDDCC');
    const free = suggest(x).suggestions[0];
    // the two Cards customers are on time now (served at once by Counter 2) and would be delayed by the change
    const promised = suggest({ ...x, promises: { t10: NOW + 15 * MIN, t11: NOW + 15 * MIN } }).suggestions[0];
    expect(promised.id).toBe(free.id);
    expect(promised.numbers.promisesBroken).toBe(2);
    expect(promised.score).toBeCloseTo(free.score - 2 * SUGGEST_CONFIG.weights.promise, 6);
    expect(promised.explanation).toMatch(/\(2 others ~\d+ min later, 2 promises at risk\)$/);
  });

  it('is deterministic for the same state and seed', () => {
    const run = () => suggest(loansClosed(11 * MIN)).suggestions;
    expect(run()).toEqual(run());
    expect(run().length).toBeGreaterThan(0);
  });

  it('shows at most three suggestions, best first, each with the numbers behind it', () => {
    const { suggestions, timing } = suggest(loansClosed(11 * MIN));
    expect(suggestions.length).toBeLessThanOrEqual(3);
    expect(suggestions.map((s) => s.score)).toEqual([...suggestions.map((s) => s.score)].sort((a, b) => b - a));
    expect(suggestions[0].bar.serviceName).toBe('Loans');
    expect(suggestions[0].bar.beforeMin).toBeNull(); // Loans was unavailable before
    expect(timing).toMatchObject({ candidates: candidates(loansClosed(11 * MIN)).length, waiting: 10 });
  });
});
