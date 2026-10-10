import type { Counter, CounterSkill } from '@prisma/client';
import { SUGGEST_CONFIG, SuggestInput, SuggestResult } from '../engine/suggest.js';
import { MIN } from '../engine/types.js';
import { prisma } from '../lib/db.js';
import { must } from '../lib/http.js';
import { runWorker } from '../lib/worker.js';
import { broadcast } from '../realtime.js';
import { changeCounter } from './actions.js';
import { loadWorld, logEvent, queueSignals, serial, toEngine, World } from './queue.js';

/** Service-level settings: when a computed set goes stale, and when to recompute by itself. */
export const SUGGESTIONS = {
  maxAgeMs: 3 * MIN,
  waitingDrift: 5,      // more customers joining/leaving than this → stale
  atRiskTrigger: 3,     // recompute when promises at risk cross this number, either way
  debounceMs: 300,
  workerTimeoutMs: 15_000,
};
export const STALE_MESSAGE = 'The queue changed since this suggestion was made. Refresh suggestions and try again.';

interface Computed extends SuggestResult {
  computedAt: number;
  counters: string;  // counter fingerprint: status and skills of every counter
  waiting: string[]; // waiting token ids
  totalMs: number;
}

/* ---------- inputs (read-only) ---------- */

const counterKey = (cs: (Counter & { skills: CounterSkill[] })[]) =>
  cs.map((c) => `${c.id}:${c.status}:${c.skills.map((k) => k.serviceId).sort().join(',')}`).join('|');
const waitingIds = (w: World) => w.active.filter((t) => t.state === 'WAITING').map((t) => t.id);

/** When staff last changed each counter's status, within the reopen cooldown. */
async function statusChanges(now: number) {
  const events = await prisma.event.findMany({
    where: { type: 'COUNTER_CHANGED', ts: { gte: new Date(now - SUGGEST_CONFIG.reopenCooldownMs) } },
    orderBy: { seq: 'asc' }, select: { counterId: true, ts: true, payload: true },
  });
  const changed = events.filter((e) => e.counterId && (e.payload as { status?: string } | null)?.status);
  return Object.fromEntries(changed.map((e) => [e.counterId!, e.ts.getTime()]));
}

async function inputFor(w: World): Promise<SuggestInput> {
  return {
    state: toEngine(w),
    counters: w.counters.map((c) => ({ id: c.id, name: c.name, status: c.status, skills: c.skills.map((k) => k.serviceId) })),
    serviceNames: Object.fromEntries(w.services.map((s) => [s.id, s.name])),
    promises: Object.fromEntries(w.active.filter((t) => t.promiseP90).map((t) => [t.id, t.promiseP90!.getTime()])),
    statusChangedAt: await statusChanges(w.at),
    now: w.at,
  };
}

/* ---------- compute (off the main thread, one at a time) ---------- */

let latest: Computed | null = null;
let inflight: Promise<Computed> | null = null;

async function compute(): Promise<Computed> {
  const started = performance.now();
  const w = await loadWorld();
  const result = await runWorker<SuggestResult>('services/suggestWorker', await inputFor(w), { timeoutMs: SUGGESTIONS.workerTimeoutMs });
  return { ...result, computedAt: w.at, counters: counterKey(w.counters), waiting: waitingIds(w), totalMs: Math.round(performance.now() - started) };
}

/** Concurrent callers share one computation. */
const recompute = () => (inflight ??= compute().then((c) => (latest = c)).finally(() => { inflight = null; }));

/**
 * A computation already running may have loaded the queue before the latest change, so wait for it first.
 * Then reuse the result if it still fits the queue, unless `force` (a trigger that must recompute).
 */
async function upToDate(force = false): Promise<Computed> {
  await inflight?.catch(() => undefined);
  const cached = latest;
  return !force && cached && fresh(cached, await loadWorld()) ? cached : recompute();
}

/** Still describes the queue: same counters, few customers in or out, not too old. */
function fresh(c: Computed, w: World) {
  const now = new Set(waitingIds(w));
  const drift = c.waiting.filter((id) => !now.has(id)).length + [...now].filter((id) => !c.waiting.includes(id)).length;
  return c.counters === counterKey(w.counters) && drift <= SUGGESTIONS.waitingDrift && w.at - c.computedAt <= SUGGESTIONS.maxAgeMs;
}

const view = (c: Computed) => ({
  computedAt: new Date(c.computedAt).toISOString(),
  timing: { ...c.timing, totalMs: c.totalMs },
  suggestions: c.suggestions,
});

/** Staff only. Never writes to the database. */
export const getSuggestions = async () => view(await upToDate());

/** Apply through the normal counter-update path, after checking the suggestion still fits the queue. */
export const applySuggestion = (id: string, actor: string) => serial(async () => {
  const cached = latest;
  const s = cached && fresh(cached, await loadWorld()) ? cached.suggestions.find((x) => x.id === id) : undefined;
  must(s, 409, STALE_MESSAGE);
  const { change, explanation, numbers } = s!;
  await logEvent('SUGGESTION_APPLIED', {
    counterId: change.counterId, actor, payload: { suggestionId: id, explanation, predicted: { ...numbers } },
  });
  await changeCounter(change.counterId, change.patch, actor);
  return { ok: true, applied: id };
});

/* ---------- automatic recompute ---------- */

/**
 * Recompute after counter changes and when promises at risk cross the trigger. Only a bare ping is broadcast:
 * the WebSocket is public, so the details stay behind a supervisor session. Returns a stop function.
 */
export function startSuggestions() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastAtRisk = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      upToDate(true).then(() => broadcast('suggestions-updated', {})).catch((e) => console.error('[suggestions]', e));
    }, SUGGESTIONS.debounceMs);
  };
  const onReplanned = ({ atRisk }: { atRisk: number }) => {
    const crossed = (lastAtRisk >= SUGGESTIONS.atRiskTrigger) !== (atRisk >= SUGGESTIONS.atRiskTrigger);
    lastAtRisk = atRisk;
    crossed && schedule();
  };
  queueSignals.on('counters-changed', schedule);
  queueSignals.on('replanned', onReplanned);
  return async () => {
    clearTimeout(timer);
    queueSignals.off('counters-changed', schedule);
    queueSignals.off('replanned', onReplanned);
    await inflight?.catch(() => undefined);
  };
}
