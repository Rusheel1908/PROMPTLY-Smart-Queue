import type { NotificationLog, Prisma, TokenState } from '@prisma/client';
import { fail, must } from '../lib/http.js';
import { prisma } from '../lib/db.js';
import { render, type Vars } from '../notify/messages.js';
import { notice, replanNotices, type Notice, type ReplanOutcome } from '../notify/notices.js';
import { EVENT_NOTICE, NOTIFY_CONFIG, NOTIFY_RULES, type NotifyEvent } from '../notify/rules.js';
import { broadcast } from '../realtime.js';
import { isGone, pushEnabled, sendPush, type PushPayload, type PushTarget } from './push.js';

/**
 * Customer notifications. The queue calls onQueueEvent / onReplan after its writes are committed; the work runs
 * in the background (never awaited by the request) and failures are logged, never thrown.
 */

/* ---------- background work, trackable so tests and shutdown can wait for it ---------- */

const pending = new Set<Promise<void>>();

function track(work: () => Promise<unknown>) {
  const p: Promise<void> = Promise.resolve()
    .then(work) // starts on a later tick, so even the first query never delays the caller
    .then(() => undefined, (e) => console.error('[notify]', e))
    .finally(() => { pending.delete(p); });
  pending.add(p);
}

/** Resolve once every notification started so far (and any it started) has finished. */
export async function flushNotifications() {
  while (pending.size) await Promise.all(pending);
}

export const renderNotice = (row: Pick<NotificationLog, 'event' | 'vars'>, lang = 'en') => {
  const rule = NOTIFY_RULES[row.event as NotifyEvent];
  const vars = row.vars as unknown as Vars;
  return { title: render(rule.titleKey, vars, lang), body: render(rule.bodyKey, vars, lang), urgency: rule.urgency };
};

/* ---------- pipeline hooks ---------- */

export interface EventData { tokenId?: string; counterId?: string; payload?: Prisma.InputJsonValue }
type Payload = { outcome?: string; parentId?: string } | null;
const payloadOf = (d: EventData) => (d.payload ?? null) as Payload;

const dropFollowers = (tokenId?: string) => (tokenId ? prisma.pushSubscription.deleteMany({ where: { tokenId } }) : null);

/** After an event is notified: tokens that are finished stop being followed; a redirect takes its followers along. */
const FOLLOWERS: Record<string, (d: EventData) => unknown> = {
  COMPLETED: (d) => dropFollowers(d.tokenId),
  CANCELLED: (d) => dropFollowers(d.tokenId),
  MISSED: (d) => payloadOf(d)?.outcome === 'NO_SHOW' && dropFollowers(d.tokenId),
  REDIRECTED: (d) => payloadOf(d)?.parentId && d.tokenId
    && prisma.pushSubscription.updateMany({ where: { tokenId: payloadOf(d)!.parentId }, data: { tokenId: d.tokenId } }),
};

/** Called by logEvent once the event row is committed. */
export function onQueueEvent(type: string, d: EventData) {
  const event = d.tokenId ? EVENT_NOTICE[type]?.(payloadOf(d)) : undefined;
  const followers = FOLLOWERS[type];
  if (!event && !followers) return;
  track(async () => {
    if (event) await notifyToken(d.tokenId!, event); // first, so a NO_SHOW still reaches the phone
    await followers?.(d);
  });
}

async function notifyToken(tokenId: string, event: NotifyEvent) {
  const t = await prisma.token.findUnique({ where: { id: tokenId }, include: { counter: { select: { name: true } } } });
  if (t) await deliver([notice(tokenId, event, { ...t, counterName: t.counter?.name })]);
}

/** Called by replan once its writes are committed. */
export function onReplan(outcome: ReplanOutcome) {
  const notices = replanNotices(outcome);
  notices.length && track(() => deliver(notices));
}

/* ---------- log once, then tell the page and the phone ---------- */

/** The unique (token, dedupeKey) index decides what is new: duplicates are skipped by the insert itself. */
async function deliver(notices: Notice[]) {
  const fresh = await prisma.notificationLog.createManyAndReturn({
    data: notices.map((n) => ({ tokenId: n.tokenId, event: n.event, dedupeKey: n.key, vars: n.vars as unknown as Prisma.InputJsonObject })),
    skipDuplicates: true,
  });
  await Promise.all(fresh.map(announce));
}

async function announce(row: NotificationLog) {
  const token = await prisma.token.findUnique({ where: { id: row.tokenId }, select: { code: true, secret: true, pushSubs: true } });
  if (!token) return;
  broadcast('notify', { code: token.code }); // the public code only: the matching status page refetches its own detail
  const { title, body, urgency } = renderNotice(row);
  if (!NOTIFY_RULES[row.event as NotifyEvent].sendPush || !pushEnabled() || token.pushSubs.length === 0) return;

  const payload: PushPayload = {
    title, body, urgency,
    tag: `promptly-${row.tokenId}`, // one notification per token on the phone: the newest replaces the last
    url: `/status/${row.tokenId}?k=${encodeURIComponent(token.secret)}`, // inside the encrypted payload, opened on click
  };
  const results = await Promise.allSettled(token.pushSubs.map((s) => sendPush(s, payload)));
  const failed = token.pushSubs.flatMap((s, i) => {
    const r = results[i];
    return r.status === 'rejected' ? [{ s, reason: r.reason }] : [];
  });
  failed.filter((f) => !isGone(f.reason)).forEach((f) =>
    console.error(`[notify] push to ${new URL(f.s.endpoint).host} failed:`, f.reason?.statusCode ?? f.reason?.message ?? f.reason));
  const gone = failed.filter((f) => isGone(f.reason)).map((f) => f.s.id);
  gone.length && await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
  await prisma.notificationLog.update({ where: { id: row.id }, data: { pushed: token.pushSubs.length - failed.length } });
}

/* ---------- read model + subscriptions ---------- */

export async function recentNotifications(tokenId: string) {
  const rows = await prisma.notificationLog.findMany({ where: { tokenId }, orderBy: { id: 'desc' }, take: NOTIFY_CONFIG.recentInDetail });
  return rows.map((r) => ({ id: r.id, event: r.event, ts: r.ts, ...renderNotice(r) }));
}

/** States in which a token can still be called, so following it makes sense. */
const FOLLOWABLE: readonly TokenState[] = ['WAITING', 'CALLED', 'SERVING', 'MISSED'];

/** Start pushing this token's notifications to a browser. Subscribing again from the same browser moves it here. */
export async function followToken(tokenId: string, sub: PushTarget) {
  must(pushEnabled(), 409, 'Push notifications are not set up on this server');
  const t = (await prisma.token.findUnique({ where: { id: tokenId }, select: { state: true } })) ?? fail(404, 'Token not found');
  must(FOLLOWABLE.includes(t.state), 409, 'This token is finished, so there is nothing to notify');
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { tokenId, ...sub },
    update: { tokenId, p256dh: sub.p256dh, auth: sub.auth },
  });
  return { ok: true };
}

export async function unfollowToken(tokenId: string, endpoint: string) {
  const { count } = await prisma.pushSubscription.deleteMany({ where: { tokenId, endpoint } });
  return { ok: true, removed: count };
}
