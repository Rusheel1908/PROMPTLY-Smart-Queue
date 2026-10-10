import { Band, forecast } from './forecast.js';
import { EngineState, EngineToken, MIN } from './types.js';

/** Every limit and weight of the supervisor suggestions in one place. */
export const SUGGEST_CONFIG = {
  maxSkillsPerCounter: 3,
  maxCandidates: 24,
  top: 3,
  screenRuns: 60,            // cheap forecast used to screen every candidate
  fullRuns: 300,             // normal forecast used to re-score the shortlist
  seed: 42,                  // before and after always share it, so the comparison is like for like
  minBenefit: 1,             // final score a suggestion must reach to be shown
  worseMarginMin: 2,         // a customer counts as "made worse" only if called at least this much later (absorbs noise)
  reopenCooldownMs: 10 * MIN, // never suggest reopening a counter whose status staff changed this recently
  // their lost minutes already count in minutesSaved; the per-head penalty only tips close calls toward fewer people delayed
  weights: { minutesSaved: 1, promise: 2, newlyServable: 3, madeWorse: 0.25 }, // promise: per promise rescued, minus per promise broken
};
export type SuggestConfig = typeof SUGGEST_CONFIG;

export type CounterStatus = 'OPEN' | 'PAUSED' | 'CLOSED';
export interface SuggestCounter { id: string; name: string; status: CounterStatus; skills: string[] }

export interface SuggestInput {
  state: EngineState;                      // the live queue, as the forecaster sees it
  counters: SuggestCounter[];              // names and the PAUSED/CLOSED distinction the engine state drops
  serviceNames: Record<string, string>;
  promises: Record<string, number>;        // tokenId → frozen promise (P90 at issue time), ms epoch
  statusChangedAt: Record<string, number>; // counterId → when staff last changed its status, ms epoch
  now: number;
}

export type CandidateKind = 'add-skill' | 'reopen';
export interface Candidate {
  id: string; kind: CandidateKind; counterId: string; counterName: string;
  serviceId: string | null; serviceName: string | null;
  patch: { status?: 'OPEN'; skills?: string[] };
}

export interface Numbers {
  avgMinutesSaved: number; promisesRescued: number; promisesBroken: number; newlyServable: number;
  madeWorse: number; madeWorseMin: number; // how many are called later, and by how much on average
}
export interface Suggestion {
  id: string; score: number; change: Candidate; explanation: string; numbers: Numbers;
  bar: { serviceName: string; beforeMin: number | null; afterMin: number | null };
}
export interface SuggestResult {
  suggestions: Suggestion[];
  timing: { screenMs: number; rescoreMs: number; candidates: number; waiting: number };
}

/* ---------- candidates ---------- */

const servicesWaiting = (x: SuggestInput) => [...new Set(x.state.waiting.map((t) => t.serviceId))];
const recentlyChanged = (x: SuggestInput, counterId: string, cfg: SuggestConfig) =>
  x.now - (x.statusChangedAt[counterId] ?? -Infinity) < cfg.reopenCooldownMs;

/** One generator per kind of change. */
const CANDIDATE_KINDS: Record<CandidateKind, (x: SuggestInput, cfg: SuggestConfig) => Candidate[]> = {
  'add-skill': (x, cfg) => x.counters
    .filter((c) => c.status === 'OPEN' && c.skills.length < cfg.maxSkillsPerCounter)
    .flatMap((c) => servicesWaiting(x).filter((s) => !c.skills.includes(s)).map((s) => ({
      id: `add-skill:${c.id}:${s}`, kind: 'add-skill' as const, counterId: c.id, counterName: c.name,
      serviceId: s, serviceName: x.serviceNames[s], patch: { skills: [...c.skills, s] },
    }))),
  reopen: (x, cfg) => x.counters
    .filter((c) => c.status !== 'OPEN' && !recentlyChanged(x, c.id, cfg))
    .map((c) => ({
      id: `reopen:${c.id}`, kind: 'reopen' as const, counterId: c.id, counterName: c.name,
      serviceId: null, serviceName: null, patch: { status: 'OPEN' as const },
    })),
};

const KIND_ORDER = Object.keys(CANDIDATE_KINDS) as CandidateKind[];
const candidateKey = (c: Candidate) => [KIND_ORDER.indexOf(c.kind), c.counterName, c.serviceName ?? ''] as const;
const byCandidateKey = (a: Candidate, b: Candidate) => {
  const [ka, kb] = [candidateKey(a), candidateKey(b)];
  return ka[0] - kb[0] || ka[1].localeCompare(kb[1]) || ka[2].localeCompare(kb[2]);
};

/** Every change worth simulating, in a stable order, capped. */
export const candidates = (x: SuggestInput, cfg: SuggestConfig = SUGGEST_CONFIG): Candidate[] =>
  KIND_ORDER.flatMap((k) => CANDIDATE_KINDS[k](x, cfg)).sort(byCandidateKey).slice(0, cfg.maxCandidates);

/** The engine state as it would be after the change. New counters object, so cached capability counts stay correct. */
export function applyCandidate(s: EngineState, c: Candidate): EngineState {
  const counter = s.counters[c.counterId];
  return {
    ...s,
    counters: {
      ...s.counters,
      [c.counterId]: {
        ...counter,
        open: c.patch.status ? true : counter.open,
        skills: c.patch.skills ? new Set(c.patch.skills) : counter.skills,
      },
    },
  };
}

/* ---------- scoring ---------- */

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x: number, digits = 1) => Math.round(x * 10 ** digits) / 10 ** digits;
const waitMin = (b: Band | undefined, now: number) => (b ? (b.p50 - now) / MIN : null);

interface Assessed { candidate: Candidate; score: number; numbers: Numbers; focus: Focus }
interface Focus { serviceId: string; saved: number; beforeMin: number | null; afterMin: number | null }

const helpsMore = (a: { newly: number; total: number }, b: { newly: number; total: number }) =>
  a.newly - b.newly || a.total - b.total;

/** The service the change helps most: the one it adds, else the one with most customers made servable, then most time saved. */
function focusOf(c: Candidate, waiting: EngineToken[], before: Record<string, Band>, after: Record<string, Band>, now: number): Focus {
  const services = [...new Set(waiting.map((t) => t.serviceId))];
  const of = (serviceId: string) => {
    const tokens = waiting.filter((t) => t.serviceId === serviceId);
    const both = tokens.filter((t) => before[t.id] && after[t.id]);
    const avgWait = (bands: Record<string, Band>) => {
      const present = tokens.filter((t) => bands[t.id]);
      return present.length ? mean(present.map((t) => waitMin(bands[t.id], now)!)) : null;
    };
    const total = both.reduce((a, t) => a + (before[t.id].p50 - after[t.id].p50) / MIN, 0);
    const newly = tokens.filter((t) => !before[t.id] && after[t.id]).length;
    return { serviceId, total, newly, saved: both.length ? total / both.length : 0, beforeMin: avgWait(before), afterMin: avgWait(after) };
  };
  const all = services.map(of);
  const best = all.find((f) => f.serviceId === c.serviceId)
    ?? all.reduce<(typeof all)[number] | undefined>((a, f) => (!a || helpsMore(f, a) > 0 ? f : a), undefined);
  return best ?? { serviceId: c.serviceId ?? '', saved: 0, beforeMin: null, afterMin: null };
}

export function assess(c: Candidate, before: Record<string, Band>, after: Record<string, Band>, x: SuggestInput, cfg: SuggestConfig): Assessed {
  const waiting = x.state.waiting;
  const delta = (t: EngineToken) => (before[t.id].p50 - after[t.id].p50) / MIN;
  const servedBoth = waiting.filter((t) => before[t.id] && after[t.id]);
  const delayed = servedBoth.filter((t) => -delta(t) >= cfg.worseMarginMin);
  const promise = (t: EngineToken) => x.promises[t.id];
  /** Promise held (P90 within it) in the first forecast but not in the second. */
  const lost = (from: Record<string, Band>, to: Record<string, Band>) => (t: EngineToken) =>
    promise(t) != null && !!from[t.id] && from[t.id].p90 <= promise(t) && (!to[t.id] || to[t.id].p90 > promise(t));
  const numbers: Numbers = {
    avgMinutesSaved: mean(servedBoth.map(delta)),
    promisesRescued: waiting.filter((t) => !!before[t.id] && lost(after, before)(t)).length,
    promisesBroken: waiting.filter(lost(before, after)).length,
    newlyServable: waiting.filter((t) => !before[t.id] && after[t.id]).length,
    madeWorse: delayed.length + waiting.filter((t) => before[t.id] && !after[t.id]).length,
    madeWorseMin: mean(delayed.map((t) => -delta(t))),
  };
  const w = cfg.weights;
  const score = w.minutesSaved * numbers.avgMinutesSaved + w.promise * (numbers.promisesRescued - numbers.promisesBroken)
    + w.newlyServable * numbers.newlyServable - w.madeWorse * numbers.madeWorse;
  return { candidate: c, score, numbers, focus: focusOf(c, waiting, before, after, x.now) };
}

/* ---------- explanation ---------- */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const ACTION_TEXT: Record<CandidateKind, (c: Candidate) => string> = {
  'add-skill': (c) => `Add ${c.serviceName} to ${c.counterName}`,
  reopen: (c) => `Reopen ${c.counterName}`,
};

interface Benefit extends Numbers { focusName: string; focusSaved: number }

/** Benefit phrases, each shown only when it applies; joined with commas. */
const BENEFIT_TEXT: [(b: Benefit) => boolean, (b: Benefit) => string][] = [
  [(b) => b.focusSaved >= 0.5, (b) => `${b.focusName} customers called ~${Math.round(b.focusSaved)} min sooner`],
  [(b) => b.focusSaved < 0.5 && b.avgMinutesSaved >= 0.5, (b) => `customers called ~${Math.round(b.avgMinutesSaved)} min sooner on average`],
  [(b) => b.promisesRescued > 0, (b) => `${plural(b.promisesRescued, 'promise', 'promises')} back on track`],
  [(b) => b.newlyServable > 0, (b) => `${plural(b.newlyServable, 'customer', 'customers')} can be served again`],
];

function explain(a: Assessed, x: SuggestInput): string {
  const b: Benefit = { ...a.numbers, focusName: x.serviceNames[a.focus.serviceId] ?? 'Waiting', focusSaved: a.focus.saved };
  const gains = BENEFIT_TEXT.filter(([applies]) => applies(b)).map(([, text]) => text(b));
  const later = b.madeWorseMin >= 1 ? `~${Math.round(b.madeWorseMin)} min later` : 'later';
  const costs = [
    b.madeWorse > 0 && `${plural(b.madeWorse, 'other', 'others')} ${later}`,
    b.promisesBroken > 0 && `${plural(b.promisesBroken, 'promise', 'promises')} at risk`,
  ].filter(Boolean);
  const cost = costs.length ? ` (${costs.join(', ')})` : '';
  return `${ACTION_TEXT[a.candidate.kind](a.candidate)} → ${gains.join(', ') || 'small improvement'}${cost}`;
}

const toSuggestion = (a: Assessed, x: SuggestInput): Suggestion => ({
  id: a.candidate.id,
  score: round(a.score, 2),
  change: a.candidate,
  explanation: explain(a, x),
  numbers: { ...a.numbers, avgMinutesSaved: round(a.numbers.avgMinutesSaved), madeWorseMin: round(a.numbers.madeWorseMin) },
  bar: {
    serviceName: x.serviceNames[a.focus.serviceId] ?? '',
    beforeMin: a.focus.beforeMin == null ? null : round(a.focus.beforeMin),
    afterMin: a.focus.afterMin == null ? null : round(a.focus.afterMin),
  },
});

/* ---------- two-stage search ---------- */

const byScore = (a: Assessed, b: Assessed) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id);

/** Score candidates against one shared baseline forecast at the given number of runs. */
function scorer(x: SuggestInput, cfg: SuggestConfig, runs: number) {
  const opts = { runs, seed: cfg.seed };
  const before = forecast(x.state, x.now, opts);
  return (c: Candidate) => assess(c, before, forecast(applyCandidate(x.state, c), x.now, opts), x, cfg);
}

/**
 * Best counter changes for the current queue. Screens every candidate with a cheap forecast, then re-scores only
 * the shortlist with the normal run count. Pure apart from the timing it reports: same input, same suggestions.
 */
export function suggest(x: SuggestInput, cfg: SuggestConfig = SUGGEST_CONFIG): SuggestResult {
  const t0 = performance.now();
  const pool = candidates(x, cfg);
  const screened = pool.length ? pool.map(scorer(x, cfg, cfg.screenRuns)) : [];
  const shortlist = screened.filter((a) => a.score >= cfg.minBenefit / 2).sort(byScore).slice(0, cfg.top);
  const t1 = performance.now();
  const rescored = shortlist.length ? shortlist.map((a) => a.candidate).map(scorer(x, cfg, cfg.fullRuns)) : [];
  const best = rescored.filter((a) => a.score >= cfg.minBenefit).sort(byScore);
  return {
    suggestions: best.map((a) => toSuggestion(a, x)),
    timing: {
      screenMs: Math.round(t1 - t0), rescoreMs: Math.round(performance.now() - t1),
      candidates: pool.length, waiting: x.state.waiting.length,
    },
  };
}
