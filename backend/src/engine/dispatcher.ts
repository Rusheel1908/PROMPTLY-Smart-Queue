import {
  CLASS_RANK, DEADLINE_BUCKET_MS, EngineState, EngineToken, HARD_CEILING_FACTOR, MIN, Policy, TokenClass,
} from './types.js';

interface Ctx { s: EngineState; now: number; capable: Record<string, number> }
type KeyFn = (t: EngineToken, ctx: Ctx) => number[];

/** Weighted-aging weights for baseline B2 (a common commercial pattern). */
const AGING_WEIGHT: Record<TokenClass, number> = { EMERGENCY: 20, PRIORITY: 4, APPOINTMENT: 5, NORMAL: 1 };

/** Counters are treated immutably (replace the object to change them), so counts are cached per object. */
const capableCache = new WeakMap<object, Record<string, number>>();

/** How many open counters can serve each service right now. */
export function capableCounts(s: EngineState): Record<string, number> {
  const counts = capableCache.get(s.counters) ?? countCapable(s);
  capableCache.set(s.counters, counts);
  return counts;
}

function countCapable(s: EngineState): Record<string, number> {
  const open = Object.values(s.counters).filter((c) => c.open);
  return Object.fromEntries(
    Object.keys(s.services).map((id) => [id, open.filter((c) => c.skills.has(id)).length]),
  );
}

export const isBreached = (t: EngineToken, s: EngineState, now: number) =>
  now - t.creditedArrival > HARD_CEILING_FACTOR * s.services[t.serviceId].targetWaitMs;

/** Tokens this counter may call now: open counter, matching skill, past any grace delay. */
export function eligible(s: EngineState, counterId: string, now: number): EngineToken[] {
  const c = s.counters[counterId];
  return s.waiting.filter((t) => !!c?.open && c.skills.has(t.serviceId) && t.notBefore <= now);
}

function lexCompare(a: number[], b: number[]): number {
  const i = a.findIndex((x, k) => x !== b[k]);
  return i < 0 ? 0 : a[i] - b[i];
}

function minBy<T>(xs: T[], key: (x: T) => number[]): T | null {
  const keyed = xs.map((x) => ({ x, k: key(x) }));
  return keyed.reduce<{ x: T; k: number[] } | null>(
    (best, cur) => (best && lexCompare(best.k, cur.k) <= 0 ? best : cur), null,
  )?.x ?? null;
}

const breachedFirst = (t: EngineToken, { s, now }: Ctx) => Number(!isBreached(t, s, now));
const deadlineBucket = (t: EngineToken) => Math.floor(t.deadline / DEADLINE_BUCKET_MS);

interface StaticOrder { ceiling: boolean; order: KeyFn }

/**
 * Policies whose ranking is a time-independent order, optionally preceded by the
 * hard-ceiling check. Fairline, its ablations and baseline B1 all have this shape.
 */
const ORDERS = {
  /** Fairline: hard ceiling → earliest deadline → scarcity → arrival order. */
  fairline: { ceiling: true, order: (t, ctx) => [deadlineBucket(t), ctx.capable[t.serviceId], t.deadline, t.seq] },
  fairlineNoScarcity: { ceiling: true, order: (t) => [t.deadline, t.seq] },
  fairlineStrictPriority: { ceiling: true, order: (t) => [CLASS_RANK[t.cls], t.seq] },
  /** B1: strict priority preemption, FIFO within class. */
  strictPriority: { ceiling: false, order: (t) => [CLASS_RANK[t.cls], t.seq] },
} satisfies Record<string, StaticOrder>;

const withCeiling = ({ ceiling, order }: StaticOrder): KeyFn =>
  (t, ctx) => [...(ceiling ? [breachedFirst(t, ctx)] : []), ...order(t, ctx)];

/** Ranking keys, compared lexicographically (smallest wins). */
export const KEYS = {
  ...(Object.fromEntries(Object.entries(ORDERS).map(([n, o]) => [n, withCeiling(o)])) as Record<keyof typeof ORDERS, KeyFn>),
  /** B2: weighted aging score (time-dependent, so no fast path). */
  aging: ((t, { now }) => [-(now - t.creditedArrival) * AGING_WEIGHT[t.cls], t.seq]) as KeyFn,
};

export type PolicyName = keyof typeof KEYS;

function makePolicy(key: KeyFn): Policy {
  return (s, counterId, now) => {
    const ctx = { s, now, capable: capableCounts(s) };
    return minBy(eligible(s, counterId, now), (t) => key(t, ctx));
  };
}

export const POLICIES = Object.fromEntries(
  Object.entries(KEYS).map(([name, key]) => [name, makePolicy(key)]),
) as Record<PolicyName, Policy>;

/** Pick from a queue already sorted by static order: first breached-and-eligible, else first eligible. */
const orderedPick = (ceiling: boolean): Policy => (s, counterId, now) => {
  const c = s.counters[counterId];
  const ok = (t: EngineToken) => !!c?.open && c.skills.has(t.serviceId) && t.notBefore <= now;
  return (ceiling && s.waiting.find((t) => ok(t) && isBreached(t, s, now))) || s.waiting.find(ok) || null;
};

const FAST = new Map<Policy, { order: KeyFn; pick: Policy }>(
  Object.entries(ORDERS).map(([name, o]) => [POLICIES[name as PolicyName], { order: o.order, pick: orderedPick(o.ceiling) }]),
);

/**
 * Prepare a state for many repeated picks with fixed counters (forecast replays).
 * Static-order policies sort once and pick in O(first match); others fall back to full ranking.
 */
export function prepare(policy: Policy, s: EngineState, now: number): { waiting: EngineToken[]; pick: Policy } {
  const { order, pick } = FAST.get(policy) ?? { order: () => [], pick: policy };
  const ctx = { s, now, capable: capableCounts(s) };
  const keyed = s.waiting.map((t) => ({ t, k: order(t, ctx) }));
  return { waiting: keyed.sort((a, b) => lexCompare(a.k, b.k)).map((x) => x.t), pick };
}

/** Earliest-deadline-first with hard ceiling and scarcity tie-break. Pure: same input, same output. */
export const pickNext: Policy = POLICIES.fairline;

/** Human-readable "why this token" shown on the counter console. */
export function explainPick(s: EngineState, t: EngineToken, now: number): string {
  const waited = Math.round((now - t.creditedArrival) / MIN);
  const due = Math.round((t.deadline - now) / MIN);
  const breached = isBreached(t, s, now);
  const dueText = due >= 0 ? `due in ${due} min` : `${-due} min past target`;
  return [
    breached && `Waited ${waited} min, past the hard ceiling: served before everyone`,
    !breached && `Earliest deadline among eligible tokens (${t.cls.toLowerCase()}, ${dueText})`,
    capableCounts(s)[t.serviceId] === 1 && 'this is the only open counter for its service',
  ].filter(Boolean).join('; ');
}
