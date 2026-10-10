import { EventEmitter } from 'node:events';
import type { CounterStatus, Prisma, Token, TokenClass } from '@prisma/client';
import { ARRIVAL_CONFIG, estimateRates, Observed } from '../engine/arrivals.js';
import { capableCounts } from '../engine/dispatcher.js';
import { meanMinutes, posterior } from '../engine/duration.js';
import { Band, forecast, quote } from '../engine/forecast.js';
import { atRisk, etaShifts, SHIFT_THRESHOLD_MS } from '../engine/ledger.js';
import { EngineState, EngineToken, MIN } from '../engine/types.js';
import * as clock from '../lib/clock.js';
import { prisma } from '../lib/db.js';
import { broadcast } from '../realtime.js';

export const FORECAST_RUNS = 300;
const ACTIVE = ['WAITING', 'CALLED', 'SERVING'] as const;

/* ---------- serialization: every mutation runs one at a time (transactional call-next) ---------- */

let chain: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
}

/**
 * In-process signals for background work that reacts to the queue (supervisor suggestions):
 * 'counters-changed' after any counter change, 'replanned' with the number of promises at risk.
 */
export const queueSignals = new EventEmitter();

/* ---------- event log ---------- */

export async function logEvent(
  type: string,
  data: { tokenId?: string; counterId?: string; payload?: Prisma.InputJsonValue; actor?: string } = {},
): Promise<number> {
  return (await prisma.event.create({ data: { type, ...data } })).seq;
}

/* ---------- world → engine ---------- */

const startOfDay = () => new Date(new Date(clock.now()).setHours(0, 0, 0, 0));

export async function loadWorld() {
  const at = clock.now();
  const [services, counters, active, issued, firstToday] = await Promise.all([
    prisma.service.findMany({ orderBy: { prefix: 'asc' } }),
    prisma.counter.findMany({ include: { skills: true }, orderBy: { name: 'asc' } }),
    prisma.token.findMany({ where: { state: { in: [...ACTIVE] } }, orderBy: { seq: 'asc' } }),
    // arrival-rate inputs, read once per load (never per forecast replay)
    prisma.event.findMany({
      where: { type: 'TOKEN_ISSUED', ts: { gte: new Date(at - ARRIVAL_CONFIG.windowMs) } }, select: { ts: true, payload: true },
    }),
    prisma.event.findFirst({ where: { ts: { gte: startOfDay() } }, orderBy: { seq: 'asc' }, select: { ts: true } }),
  ]);
  return { at, services, counters, active, issued, openedAt: firstToday?.ts.getTime() ?? at };
}
export type World = Awaited<ReturnType<typeof loadWorld>>;

/** TOKEN_ISSUED events as observed arrivals. Older events name the service instead of its id. */
function observedArrivals(w: World): Observed[] {
  const idByName = Object.fromEntries(w.services.map((s) => [s.name, s.id]));
  return w.issued.flatMap((e) => {
    const p = (e.payload ?? {}) as { class?: TokenClass; serviceId?: string; service?: string };
    const serviceId = p.serviceId ?? idByName[p.service ?? ''];
    return serviceId && p.class ? [{ t: e.ts.getTime(), serviceId, cls: p.class }] : [];
  });
}

export interface CounterOverride { id: string; status?: CounterStatus; skills?: string[] }

export const serviceModel = (s: World['services'][number]) =>
  posterior({ priorMu: s.priorMu, priorSigma: s.priorSigma, n: s.obsN, mean: s.obsMean, m2: s.obsM2 });

export const toEngineToken = (t: Token): EngineToken => ({
  id: t.id, seq: t.seq, serviceId: t.serviceId, cls: t.class,
  creditedArrival: t.creditedArrival.getTime(), deadline: t.deadline.getTime(), notBefore: t.notBefore.getTime(),
});

export function toEngine(w: World, overrides: CounterOverride[] = []): EngineState {
  const patch = Object.fromEntries(overrides.map((o) => [o.id, o]));
  const atCounter = Object.fromEntries(
    w.active.filter((t) => t.counterId && t.state !== 'WAITING').map((t) => [t.counterId, t]),
  );
  return {
    services: Object.fromEntries(w.services.map((s) => [s.id, { id: s.id, targetWaitMs: s.targetWaitS * 1000, ...serviceModel(s) }])),
    counters: Object.fromEntries(w.counters.map((c) => {
      const busy = atCounter[c.id];
      const status = patch[c.id]?.status ?? c.status;
      const skills = patch[c.id]?.skills ?? c.skills.map((k) => k.serviceId);
      return [c.id, {
        id: c.id, open: status === 'OPEN', skills: new Set(skills),
        busySince: (busy?.servedAt ?? busy?.calledAt)?.getTime() ?? null,
        busyService: busy?.serviceId ?? null,
      }];
    })),
    waiting: w.active.filter((t) => t.state === 'WAITING').map(toEngineToken),
    arrivals: estimateRates(observedArrivals(w), w.services.map((s) => s.id), w.at, w.openedAt),
  };
}

/* ---------- re-planning + promise ledger ---------- */

/** Wait a new normal customer would be quoted per service, in minutes (null = no counter can serve). */
let quotes: Record<string, { p50Min: number; p90Min: number } | null> = {};
const toQuote = (b: Band | null, now: number) => b && { p50Min: (b.p50 - now) / MIN, p90Min: (b.p90 - now) / MIN };

/**
 * Re-forecast the whole queue after an event. Tokens whose expected call moved by more than
 * the threshold get an EtaChange row carrying the cause, shown on their status page.
 */
export async function replan(reason: string, causeEvent?: number, thresholdMs = SHIFT_THRESHOLD_MS) {
  const now = clock.now();
  const w = await loadWorld();
  const s = toEngine(w);
  const bands = forecast(s, now, { runs: FORECAST_RUNS });
  const waiting = w.active.filter((t) => t.state === 'WAITING');
  const prev = Object.fromEntries(waiting.map((t) => [t.id, t.etaP50?.getTime() ?? null]));
  const shifts = etaShifts(prev, bands, thresholdMs);
  const asDate = (ms?: number) => (ms == null ? null : new Date(ms));

  await prisma.$transaction([
    ...waiting.map((t) => prisma.token.update({
      where: { id: t.id },
      data: { etaP50: asDate(bands[t.id]?.p50), etaP90: asDate(bands[t.id]?.p90) },
    })),
    prisma.etaChange.createMany({
      data: shifts.map((x) => ({ tokenId: x.tokenId, deltaS: x.deltaS, reason, causeEvent })),
    }),
  ]);
  quotes = Object.fromEntries(w.services.map((svc) => [svc.id, toQuote(quote(s, svc.id, now), now)]));
  broadcast('queue', { reason, shifts: shifts.length });
  queueSignals.emit('replanned', { atRisk: waiting.filter((t) => atRisk(t.promiseP90?.getTime() ?? null, bands[t.id])).length });
  return bands;
}

/* ---------- read models ---------- */

const minutesFrom = (now: number, d: Date | null) => (d ? Math.max(0, (d.getTime() - now) / MIN) : null);

/** Rank of each waiting token by expected call time (0 = next). Unavailable tokens have no position. */
function positions(waiting: Token[]): Record<string, number> {
  const ranked = waiting.filter((t) => t.etaP50).sort((a, b) => a.etaP50!.getTime() - b.etaP50!.getTime());
  return Object.fromEntries(ranked.map((t, i) => [t.id, i]));
}

export function publicToken(t: Token, now: number, pos: Record<string, number>) {
  return {
    id: t.id, code: t.code, serviceId: t.serviceId, class: t.class, state: t.state, counterId: t.counterId,
    arrivedAt: t.arrivedAt, deadline: t.deadline, notBefore: t.notBefore, calledAt: t.calledAt, servedAt: t.servedAt,
    etaP50: t.etaP50, etaP90: t.etaP90, promiseP90: t.promiseP90, missCount: t.missCount, pickReason: t.pickReason,
    waitMin: (now - t.arrivedAt.getTime()) / MIN,
    etaMin: minutesFrom(now, t.etaP50),
    position: pos[t.id] ?? null,
    unavailable: t.state === 'WAITING' && !t.etaP50,
    atRisk: atRisk(t.promiseP90?.getTime() ?? null, t.etaP90 ? { p50: 0, p90: t.etaP90.getTime() } : undefined),
  };
}

const avg =(xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function metrics() {
  const today = await prisma.token.findMany({ where: { arrivedAt: { gte: startOfDay() } } });
  const called = today.filter((t) => t.calledAt && ['SERVING', 'DONE', 'REDIRECTED'].includes(t.state));
  const promised = called.filter((t) => t.promiseP90);
  const classes = ['EMERGENCY', 'PRIORITY', 'APPOINTMENT', 'NORMAL'] as const;
  return {
    issued: today.length,
    served: today.filter((t) => t.state === 'DONE').length,
    noShows: today.filter((t) => t.state === 'NO_SHOW').length,
    missed: today.reduce((a, t) => a + t.missCount, 0),
    promiseKept: avg(promised.map((t) => Number(t.calledAt! <= t.promiseP90!))),
    waitByClass: Object.fromEntries(classes.map((c) => [c, avg(
      called.filter((t) => t.class === c).map((t) => (t.calledAt!.getTime() - t.arrivedAt.getTime()) / MIN),
    )])),
  };
}

/** Everything the screens need in one payload. Pushed via WebSocket "queue" pings, pulled here. */
export async function snapshot() {
  const now = clock.now();
  const w = await loadWorld();
  const s = toEngine(w);
  const capable = capableCounts(s);
  const waiting = w.active.filter((t) => t.state === 'WAITING');
  const pos = positions(waiting);
  const [recent, events, m] = await Promise.all([
    prisma.token.findMany({ where: { calledAt: { not: null } }, orderBy: { calledAt: 'desc' }, take: 10 }),
    prisma.event.findMany({ orderBy: { seq: 'desc' }, take: 40 }),
    metrics(),
  ]);
  const codeById = Object.fromEntries([...w.active, ...recent].map((t) => [t.id, t.code]));
  const counterName = Object.fromEntries(w.counters.map((c) => [c.id, c.name]));

  return {
    now,
    services: w.services.map((svc) => {
      const model = serviceModel(svc);
      return {
        id: svc.id, name: svc.name, prefix: svc.prefix, icon: svc.icon, targetWaitMin: svc.targetWaitS / 60,
        meanServiceMin: meanMinutes(model.mu, model.sigma), learnedFrom: svc.obsN,
        waiting: waiting.filter((t) => t.serviceId === svc.id).length,
        capable: capable[svc.id] ?? 0,
        quote: quotes[svc.id] ?? null,
      };
    }),
    counters: w.counters.map((c) => ({
      id: c.id, name: c.name, status: c.status, skills: c.skills.map((k) => k.serviceId),
      current: publicTokenOrNull(w.active.find((t) => t.counterId === c.id && t.state !== 'WAITING'), now, pos),
    })),
    tokens: w.active.map((t) => publicToken(t, now, pos)),
    recentCalls: recent.map((t) => ({ id: t.id, code: t.code, counter: counterName[t.counterId ?? ''] ?? null, calledAt: t.calledAt, state: t.state })),
    events: events.map((e) => ({
      seq: e.seq, ts: e.ts, type: e.type, payload: e.payload,
      code: codeById[e.tokenId ?? ''] ?? null, counter: counterName[e.counterId ?? ''] ?? null,
    })),
    metrics: { ...m, waiting: waiting.length, atRisk: w.active.filter((t) => publicToken(t, now, pos).atRisk).length },
  };
}

const publicTokenOrNull = (t: Token | undefined, now: number, pos: Record<string, number>) =>
  (t ? publicToken(t, now, pos) : null);

/* ---------- snapshot views: staff see everything, the public sees only what the board shows ---------- */

type Snapshot = Awaited<ReturnType<typeof snapshot>>;
type PublicToken = ReturnType<typeof publicToken>;

/** Allowlist, not a denylist: a field added to publicToken later stays private until listed here. */
const boardToken = (t: PublicToken) => ({
  code: t.code, serviceId: t.serviceId, state: t.state, counterId: t.counterId,
  etaMin: t.etaMin, position: t.position, unavailable: t.unavailable,
});

export const SNAPSHOT_VIEWS: Record<'staff' | 'public', (s: Snapshot) => object> = {
  staff: (s: Snapshot) => s,
  public: (s: Snapshot) => ({
    ...s,
    counters: s.counters.map((c) => ({ id: c.id, name: c.name, status: c.status, current: c.current && boardToken(c.current) })),
    tokens: s.tokens.map(boardToken),
    recentCalls: s.recentCalls.map(({ id: _id, ...call }) => call),
    events: [], // the event log is an Ops feature
  }),
};
