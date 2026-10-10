import type { CounterStatus, Token, TokenClass } from '@prisma/client';
import { restoreDemoDataset } from '../demo/dataset.js';
import { explainPick, pickNext } from '../engine/dispatcher.js';
import { observe } from '../engine/duration.js';
import { forecast } from '../engine/forecast.js';
import { Action, afterMiss, canTransition } from '../engine/stateMachine.js';
import { toPromise } from '../engine/ledger.js';
import {
  CLASS_FACTOR, MAX_REDIRECTS, MIN, MISS_GRACE_MS, PROMISE_MIN_LEAD_MS, REENTRY_FACTOR,
} from '../engine/types.js';
import * as clock from '../lib/clock.js';
import { prisma } from '../lib/db.js';
import { fail, must } from '../lib/http.js';
import { newTokenSecret, safeEqual } from '../lib/secret.js';
import { broadcast } from '../realtime.js';
import {
  CounterOverride, FORECAST_RUNS, loadWorld, logEvent, publicToken, queueSignals, replan, serial, toEngine,
} from './queue.js';

const JOIN_REASON: Record<TokenClass, string> = {
  EMERGENCY: 'Emergency customer added',
  PRIORITY: 'Priority customer added',
  APPOINTMENT: 'Appointment holder checked in',
  NORMAL: 'New customer in a shared queue',
};
const STATUS_REASON: Record<CounterStatus, (name: string) => string> = {
  OPEN: (n) => `${n} opened`,
  PAUSED: (n) => `${n} paused`,
  CLOSED: (n) => `${n} closed`,
};

const getCounter = async (id: string) =>
  (await prisma.counter.findUnique({ where: { id }, include: { skills: true } })) ?? fail(404, 'Unknown counter');

const getToken = async (id: string) =>
  (await prisma.token.findUnique({ where: { id }, include: { service: true } })) ?? fail(404, 'Token not found');

/** The customer currently at a counter (CALLED or SERVING). */
const atCounter = async (counterId: string) =>
  (await prisma.token.findFirst({ where: { counterId, state: { in: ['CALLED', 'SERVING'] } }, include: { service: true } }))
  ?? fail(409, 'No customer at this counter');

const guard = (t: Token, action: Action) =>
  must(canTransition(t.state, action), 409, `Cannot ${action} a token that is ${t.state.toLowerCase()}`);

/* ---------- customers ---------- */

export const issueToken = (serviceId: string, cls: TokenClass, actor = 'kiosk') => serial(async () => {
  const service = (await prisma.service.findUnique({ where: { id: serviceId } })) ?? fail(404, 'Unknown service');
  const count = await prisma.token.count({ where: { serviceId } });
  const now = clock.now();
  const token = await prisma.token.create({
    data: {
      code: `${service.prefix}-${String(count + 1).padStart(3, '0')}`,
      serviceId, class: cls, secret: newTokenSecret(),
      // same clock as the deadline (not the database default), so arrival credit and deadline agree
      arrivedAt: new Date(now), creditedArrival: new Date(now), notBefore: new Date(now),
      deadline: new Date(now + service.targetWaitS * 1000 * CLASS_FACTOR[cls]),
    },
  });
  const seq = await logEvent('TOKEN_ISSUED', { tokenId: token.id, payload: { class: cls, service: service.name, serviceId }, actor });
  const bands = await replan(JOIN_REASON[cls], seq);
  const p90 = bands[token.id]?.p90;
  // the P90 at issue time is frozen as this customer's promise (none when no counter can serve)
  const saved = await prisma.token.update({
    where: { id: token.id },
    data: { promiseP90: p90 == null ? null : new Date(toPromise(p90, now, PROMISE_MIN_LEAD_MS)) },
  });
  // the only response that carries the secret: it becomes the customer's QR link
  return { ...publicToken(saved, now, {}), serviceName: service.name, secret: saved.secret };
});

/** True only for the holder of this token's QR link. A missing token answers the same as a wrong key. */
export async function holdsToken(id: string, key: string | undefined) {
  const token = await prisma.token.findUnique({ where: { id }, select: { secret: true } });
  return safeEqual(token?.secret, key);
}

export async function tokenDetail(id: string) {
  const now = clock.now();
  const token = (await prisma.token.findUnique({
    where: { id },
    include: { service: true, counter: true, etaChanges: { orderBy: { ts: 'desc' }, take: 20 } },
  })) ?? fail(404, 'Token not found');
  const [waiting, child] = await Promise.all([
    prisma.token.findMany({ where: { state: 'WAITING', etaP50: { not: null } }, select: { id: true, etaP50: true } }),
    prisma.token.findFirst({ where: { parentTokenId: id }, select: { id: true, code: true, secret: true } }),
  ]);
  const ahead = waiting.filter((t) => token.etaP50 && t.etaP50! < token.etaP50).length;
  const pos = Object.fromEntries(waiting.filter((t) => t.id === token.id).map((t) => [t.id, ahead]));
  return {
    ...publicToken(token, now, pos),
    serviceName: token.service.name,
    counterName: token.counter?.name ?? null,
    ahead, queueSize: waiting.length,
    changes: token.etaChanges.map((c) => ({ ts: c.ts, deltaS: c.deltaS, reason: c.reason })),
    // the caller proved access to the parent, so they may follow the redirect
    child: child && { id: child.id, code: child.code, key: child.secret },
  };
}

export const stepAway = (id: string, minutes: number) => serial(async () => {
  const t = await getToken(id);
  guard(t, 'away');
  const until = Math.max(t.notBefore.getTime(), clock.now() + minutes * MIN);
  await prisma.token.update({ where: { id }, data: { notBefore: new Date(until) } });
  const seq = await logEvent('STEPPED_AWAY', { tokenId: id, payload: { minutes } });
  await replan('A customer ahead stepped away', seq);
  return tokenDetail(id);
});

export const cancelToken = (id: string) => serial(async () => {
  const t = await getToken(id);
  guard(t, 'cancel');
  await prisma.token.update({ where: { id }, data: { state: 'CANCELLED', counterId: null } });
  const seq = await logEvent('CANCELLED', { tokenId: id });
  await replan('A customer ahead cancelled', seq);
  return tokenDetail(id);
});

export const reactivate = (id: string, actor: string) => serial(async () => {
  const t = await getToken(id);
  guard(t, 'reactivate');
  const now = clock.now();
  await prisma.token.update({
    where: { id },
    data: {
      state: 'WAITING', counterId: null, notBefore: new Date(now),
      deadline: new Date(now + t.service.targetWaitS * 1000 * REENTRY_FACTOR), // keeps arrival credit
    },
  });
  const seq = await logEvent('REACTIVATED', { tokenId: id, actor });
  await replan(`${t.code} reactivated at the desk`, seq);
  return tokenDetail(id);
});

/* ---------- counters ---------- */

/** Public "now calling" message for boards and status pages: the code only, never the token id. */
export const announce = (t: Pick<Token, 'code'>, counterName: string, recall: boolean) =>
  broadcast('announce', { code: t.code, counter: counterName, recall });

export const callNext = (counterId: string, actor: string) => serial(async () => {
  const counter = await getCounter(counterId);
  must(counter.status === 'OPEN', 409, `${counter.name} is ${counter.status.toLowerCase()}`);
  const busy = await prisma.token.findFirst({ where: { counterId, state: { in: ['CALLED', 'SERVING'] } } });
  must(!busy, 409, `${counter.name} already has ${busy?.code} at the desk`);

  const now = clock.now();
  const s = toEngine(await loadWorld());
  const pick = pickNext(s, counterId, now);
  return pick ? claim(pick.id, explainPick(s, pick, now), counter, now, actor) : nothingToCall(counterId, actor);
});

async function nothingToCall(counterId: string, actor: string) {
  await logEvent('CALL_EMPTY', { counterId, actor });
  return { token: null, reason: 'No eligible customers for this counter right now' };
}

async function claim(tokenId: string, reason: string, counter: { id: string; name: string }, now: number, actor: string) {
  // conditional update: only succeeds if nobody else called this token first
  const { count } = await prisma.token.updateMany({
    where: { id: tokenId, state: 'WAITING' },
    data: {
      state: 'CALLED', counterId: counter.id, calledAt: new Date(now), lastCallAt: new Date(now),
      recallCount: 0, pickReason: reason,
    },
  });
  must(count === 1, 409, 'That token was just called by another counter, try again');
  const token = await prisma.token.findUniqueOrThrow({ where: { id: tokenId } });
  const seq = await logEvent('CALLED', { tokenId, counterId: counter.id, payload: { reason }, actor });
  announce(token, counter.name, false);
  await replan(`${token.code} called to ${counter.name}`, seq);
  return { token: publicToken(token, now, {}), reason };
}

export const recall = (counterId: string, actor: string) => serial(async () => {
  const t = await atCounter(counterId);
  guard(t, 'recall');
  const counter = await getCounter(counterId);
  await prisma.token.update({ where: { id: t.id }, data: { recallCount: { increment: 1 }, lastCallAt: new Date(clock.now()) } });
  await logEvent('RECALLED', { tokenId: t.id, counterId, actor });
  announce(t, counter.name, true);
  broadcast('queue', { reason: 'recall' });
  return { ok: true };
});

export const startService = (counterId: string, actor: string) => serial(async () => {
  const t = await atCounter(counterId);
  guard(t, 'ack');
  await prisma.token.update({ where: { id: t.id }, data: { state: 'SERVING', servedAt: new Date(clock.now()) } });
  const seq = await logEvent('SERVING', { tokenId: t.id, counterId, actor });
  await replan('Queue progress', seq);
  return { ok: true };
});

export const complete = (counterId: string, actor: string) => serial(async () => {
  const t = await atCounter(counterId);
  guard(t, 'complete');
  const now = clock.now();
  const minutes = (now - (t.servedAt ?? t.calledAt ?? new Date(now)).getTime()) / MIN;
  const stats = observe(
    { priorMu: t.service.priorMu, priorSigma: t.service.priorSigma, n: t.service.obsN, mean: t.service.obsMean, m2: t.service.obsM2 },
    minutes,
  );
  await prisma.$transaction([
    prisma.token.update({ where: { id: t.id }, data: { state: 'DONE', doneAt: new Date(now) } }),
    prisma.service.update({ where: { id: t.serviceId }, data: { obsN: stats.n, obsMean: stats.mean, obsM2: stats.m2 } }),
  ]);
  const counter = await getCounter(counterId);
  const seq = await logEvent('COMPLETED', { tokenId: t.id, counterId, payload: { minutes }, actor });
  await replan(`${counter.name} finished a ${t.service.name} service`, seq);
  return { ok: true, minutes };
});

/** Missed turn: re-enter after a grace delay with a short deadline (not the back), or NO_SHOW on the last miss. */
export async function missToken(t: Token & { service: { targetWaitS: number } }, actor: string) {
  guard(t, 'miss');
  const now = clock.now();
  const next = afterMiss(t.missCount);
  const reentry = now + MISS_GRACE_MS;
  await prisma.token.update({
    where: { id: t.id },
    data: {
      state: next, counterId: null, missCount: { increment: 1 }, calledAt: null, lastCallAt: null,
      notBefore: new Date(reentry),
      deadline: new Date(reentry + t.service.targetWaitS * 1000 * REENTRY_FACTOR),
    },
  });
  const seq = await logEvent('MISSED', { tokenId: t.id, counterId: t.counterId ?? undefined, payload: { outcome: next }, actor });
  await replan(`${t.code} missed their turn`, seq);
  return { ok: true, outcome: next };
}

export const miss = (counterId: string, actor: string) => serial(async () => missToken(await atCounter(counterId), actor));

export const redirect = (counterId: string, serviceId: string, actor: string) => serial(async () => {
  const t = await atCounter(counterId);
  guard(t, 'redirect');
  must(t.serviceId !== serviceId, 400, 'Choose a different service to redirect to');
  must(t.redirectDepth < MAX_REDIRECTS, 409, 'Redirect limit reached for this customer');
  const target = (await prisma.service.findUnique({ where: { id: serviceId } })) ?? fail(404, 'Unknown service');
  const count = await prisma.token.count({ where: { serviceId } });
  const [, child] = await prisma.$transaction([
    prisma.token.update({ where: { id: t.id }, data: { state: 'REDIRECTED', doneAt: new Date(clock.now()) } }),
    prisma.token.create({
      data: {
        code: `${target.prefix}-${String(count + 1).padStart(3, '0')}`,
        serviceId, class: t.class, parentTokenId: t.id, redirectDepth: t.redirectDepth + 1, secret: newTokenSecret(),
        arrivedAt: t.arrivedAt, notBefore: new Date(clock.now()),
        creditedArrival: t.creditedArrival, // not penalized for the system's routing
        deadline: new Date(t.creditedArrival.getTime() + target.targetWaitS * 1000 * CLASS_FACTOR[t.class]),
        promiseP90: t.promiseP90,
      },
    }),
  ]);
  const seq = await logEvent('REDIRECTED', { tokenId: child.id, counterId, payload: { parentId: t.id, from: t.code, to: child.code }, actor });
  await replan(`A customer was redirected into ${target.name}`, seq);
  return { ok: true, child: { id: child.id, code: child.code } };
});

export type CounterChange = { status?: CounterStatus; skills?: string[] };

export const updateCounter = (id: string, change: CounterChange, actor: string) => serial(() => changeCounter(id, change, actor));

/** The one counter-update path (also used by applied suggestions). Call inside serial(). */
export async function changeCounter(id: string, change: CounterChange, actor: string) {
  const counter = await getCounter(id);
  const skills = change.skills && [...new Set(change.skills)];
  skills && must(await prisma.service.count({ where: { id: { in: skills } } }) === skills.length, 404, 'Unknown service');
  // a counter that is no longer open hands back the customer it was calling, original deadline intact
  const released = (change.status ?? counter.status) === 'OPEN' ? [] : (await prisma.token.findMany({
    where: { counterId: id, state: 'CALLED' }, select: { id: true },
  })).map((t) => t.id);
  await prisma.$transaction([
    prisma.counter.update({ where: { id }, data: { status: change.status ?? counter.status } }),
    ...(skills
      ? [
        prisma.counterSkill.deleteMany({ where: { counterId: id } }),
        prisma.counterSkill.createMany({ data: skills.map((serviceId) => ({ counterId: id, serviceId })) }),
      ]
      : []),
    prisma.token.updateMany({
      where: { id: { in: released } },
      data: { state: 'WAITING', counterId: null, calledAt: null, lastCallAt: null },
    }),
  ]);
  const reason = change.status && change.status !== counter.status
    ? STATUS_REASON[change.status](counter.name)
    : `${counter.name} changed which services it handles`;
  const seq = await logEvent('COUNTER_CHANGED', { counterId: id, payload: { ...change, released }, actor });
  await replan(reason, seq);
  queueSignals.emit('counters-changed');
  return { ok: true };
}

/* ---------- supervisor what-if ---------- */

/** Projected impact of counter changes, compared on the same random seed. Nothing is committed. */
export async function whatIf(overrides: CounterOverride[]) {
  const now = clock.now();
  const w = await loadWorld();
  const before = forecast(toEngine(w), now, { runs: FORECAST_RUNS });
  const after = forecast(toEngine(w, overrides), now, { runs: FORECAST_RUNS });
  const waiting = w.active.filter((t) => t.state === 'WAITING');
  const p90Min = (b: typeof before, id: string) => (b[id] ? (b[id].p90 - now) / MIN : null);
  const avgOf = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return {
    services: w.services.map((svc) => {
      const ids = waiting.filter((t) => t.serviceId === svc.id).map((t) => t.id);
      return {
        id: svc.id, name: svc.name, waiting: ids.length,
        beforeP90: avgOf(ids.map((id) => p90Min(before, id))),
        afterP90: avgOf(ids.map((id) => p90Min(after, id))),
        unavailableBefore: ids.filter((id) => !before[id]).length,
        unavailableAfter: ids.filter((id) => !after[id]).length,
      };
    }),
    tokens: waiting.map((t) => ({ id: t.id, code: t.code, beforeP90: p90Min(before, t.id), afterP90: p90Min(after, t.id) })),
  };
}

/* ---------- demo helpers (labeled demo data) ---------- */

const DEMO_CLASSES: TokenClass[] = ['NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'APPOINTMENT', 'PRIORITY'];

export async function spawnDemo(count: number) {
  const services = await prisma.service.findMany();
  must(services.length > 0, 409, 'No services configured. Run the seed first');
  const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  const issued = [];
  for (let i = 0; i < count; i++) issued.push(await issueToken(pick(services).id, pick(DEMO_CLASSES), 'demo'));
  return { issued: issued.map((t) => t.code) };
}

export const resetDemo = (actor: string) => serial(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.etaChange.deleteMany();
    await tx.token.deleteMany();
    await tx.event.deleteMany();
    await tx.counter.updateMany({ data: { status: 'OPEN' } });
    await restoreDemoDataset(tx); // skills changed during a demo (e.g. an applied suggestion) go back to the seeded layout
  });
  await logEvent('DEMO_RESET', { actor });
  await replan('Demo reset');
  queueSignals.emit('counters-changed'); // every counter reopened
  return { ok: true };
});
