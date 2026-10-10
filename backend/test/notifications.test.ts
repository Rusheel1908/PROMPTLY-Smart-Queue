import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { CALL_WINDOW_MS, MISS_GRACE_MS } from '../src/engine/types.js';
import { prisma } from '../src/lib/db.js';
import { fmtTime } from '../src/notify/messages.js';
import { flushNotifications, onQueueEvent } from '../src/services/notifier.js';
import { configurePush, setPushSender, type PushPayload } from '../src/services/push.js';
import { replan } from '../src/services/queue.js';
import { sweepCalls } from '../src/services/sweeper.js';
import { addCounter, as, counter, fakeClock, issue, key, resetDb, staff, tokenRow } from './helpers.js';

const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;
let clock: ReturnType<typeof fakeClock>;

/* ---------- fake push service: records every send, answers as told; no network ---------- */

const FAKE_KEYS = { publicKey: 'BPublicKeyForTests', privateKey: 'privateKeyForTests', subject: 'mailto:test@example.com' };
type Sent = { endpoint: string; payload: PushPayload; urgency: string; TTL: number };
let sent: Sent[] = [];
let answer: (endpoint: string) => Promise<unknown> = () => Promise.resolve();

beforeEach(async () => {
  world = await resetDb();
  clock = fakeClock();
  sent = [];
  answer = () => Promise.resolve();
  configurePush(FAKE_KEYS);
  setPushSender(async (t, payload, o) => {
    sent.push({ endpoint: t.endpoint, payload: JSON.parse(payload), urgency: o.urgency, TTL: o.TTL });
    return answer(t.endpoint);
  });
});
afterEach(async () => {
  await flushNotifications();
  clock.restore();
  configurePush(null);
  setPushSender();
  vi.restoreAllMocks();
});
afterAll(() => prisma.$disconnect());

let n = 0;
const endpoint = () => `https://fcm.googleapis.com/fcm/send/test-${++n}`;
const subscription = (url = endpoint()) => ({ endpoint: url, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' } });
const subscribe = (id: string, secret: string, body: object = subscription()) =>
  request(app).post(`/api/tokens/${id}/push`).set(key(secret)).send(body);

/** Run the request, then wait for the background notifications it started. */
const settled = async <T>(p: PromiseLike<T>) => { const r = await p; await flushNotifications(); return r; };
const callNext = () => settled(counter(app, world.counter.id, 'call-next').expect(200));
const windowExpires = () => { clock.advance(CALL_WINDOW_MS + 1); return settled(sweepCalls()); };

const logged = async (tokenId: string) =>
  (await prisma.notificationLog.findMany({ where: { tokenId }, orderBy: { id: 'asc' } })).map((r) => r.event);
const pushed = (event: string) => sent.filter((s) => s.payload.title.includes(event));
const subsOf = (tokenId: string) => prisma.pushSubscription.count({ where: { tokenId } });

describe('each event notifies once, with the right message', () => {
  it('called: in-page log + one push with counter, status link and high urgency; replays are deduplicated', async () => {
    const a = await issue(app, world.deposits.id);
    await subscribe(a.id, a.secret).expect(201);
    await callNext();

    expect(await logged(a.id)).toEqual(['NEXT_UP', 'CALLED']); // NEXT_UP: issued into an empty queue
    const called = pushed('please go to');
    expect(called).toHaveLength(1);
    expect(called[0].payload).toMatchObject({
      title: `Token ${a.code}: please go to Counter 1 now`,
      url: `/status/${a.id}?k=${encodeURIComponent(a.secret)}`,
      urgency: 'high',
    });
    expect(called[0].TTL).toBe(600);

    // the pipeline sees the same event again, and the queue replans many times: still one of each
    onQueueEvent('CALLED', { tokenId: a.id });
    for (let i = 0; i < 3; i++) await replan('tick');
    await flushNotifications();
    expect(await logged(a.id)).toEqual(['NEXT_UP', 'CALLED']);
    expect(sent).toHaveLength(1); // NEXT_UP was logged at issue, before this phone subscribed
  });

  it('auto-recall, missed turn (with the re-entry time), called again after re-entry, then no-show', async () => {
    const a = await issue(app, world.deposits.id);
    await subscribe(a.id, a.secret).expect(201);
    await callNext();
    await windowExpires(); // auto-recall
    expect(pushed('Last call')[0].payload.title).toBe(`Last call for ${a.code} at Counter 1`);

    await windowExpires(); // missed → re-enters after the grace delay
    const reentry = (await tokenRow(a.id)).notBefore.getTime();
    const missed = pushed('missed your turn');
    expect(missed).toHaveLength(1);
    expect(missed[0].payload.body).toBe(`Come back by ${fmtTime(reentry)}; you'll be called near the front.`);

    clock.advance(MISS_GRACE_MS + 1000);
    await callNext(); // a new round: called again, so told again
    expect(pushed('please go to')).toHaveLength(2);

    await windowExpires();
    await windowExpires(); // second miss → NO_SHOW
    expect(pushed('was cancelled')[0].payload.body).toBe('Your token was cancelled after 2 missed calls. Please ask at the desk.');
    expect(await logged(a.id)).toEqual(['NEXT_UP', 'CALLED', 'RECALLED', 'MISSED', 'NEXT_UP', 'CALLED', 'RECALLED', 'NO_SHOW']);
    expect(await subsOf(a.id)).toBe(0); // the no-show push went out first, then the subscription was dropped
  });

  it('big delay: a counter closing pushes later tokens back by more than 5 min, and says why', async () => {
    const second = await addCounter('Counter 2', [world.loans.id]);
    const tokens = [];
    for (let i = 0; i < 4; i++) tokens.push(await issue(app, world.loans.id));
    await flushNotifications();
    await settled(staff(app).patch(`/api/counters/${second.id}`, { status: 'CLOSED' }).expect(200));

    const delays = await prisma.notificationLog.findMany({ where: { event: 'BIG_DELAY' } });
    const big = await prisma.etaChange.findMany({ where: { deltaS: { gt: 300 } } });
    expect(big.length).toBeGreaterThan(0);
    expect(delays.map((d) => d.tokenId).sort()).toEqual(big.map((c) => c.tokenId).sort()); // one per large shift, none for small ones
    const r = await request(app).get(`/api/tokens/${delays[0].tokenId}`).set(key(tokens.find((t) => t.id === delays[0].tokenId)!.secret));
    expect(r.body.notifications[0]).toMatchObject({ event: 'BIG_DELAY', body: expect.stringContaining('Why: Counter 2 closed') });
  });

  it('the status page lists rendered notifications; the public snapshot carries none', async () => {
    const a = await issue(app, world.deposits.id);
    await callNext();
    const r = await request(app).get(`/api/tokens/${a.id}`).set(key(a.secret)).expect(200);
    expect(r.body.notifications.map((x: { event: string }) => x.event)).toEqual(['CALLED', 'NEXT_UP']);
    expect(r.body.notifications[0]).toMatchObject({ title: `Token ${a.code}: please go to Counter 1 now`, urgency: 'high' });
    const pub = await request(app).get('/api/snapshot').expect(200);
    expect(JSON.stringify(pub.body)).not.toMatch(/please go to|notifications/);
  });
});

describe('push subscriptions', () => {
  it('need the token key: none, a wrong one, or a staff session without it → 404', async () => {
    const a = await issue(app, world.deposits.id);
    await request(app).post(`/api/tokens/${a.id}/push`).send(subscription()).expect(404);
    await subscribe(a.id, 'wrong-key').expect(404);
    await request(app).post(`/api/tokens/${a.id}/push`).set(as()).send(subscription()).expect(404);
    await subscribe('no-such-token', a.secret).expect(404);
    expect(await subsOf(a.id)).toBe(0);
  });

  it('validates the subscription, and only accepts known push services', async () => {
    const a = await issue(app, world.deposits.id);
    await subscribe(a.id, a.secret, { endpoint: 'https://fcm.googleapis.com/x' }).expect(400);
    await subscribe(a.id, a.secret, subscription('http://fcm.googleapis.com/fcm/send/x')).expect(400);
    await subscribe(a.id, a.secret, subscription('https://169.254.169.254/latest/meta-data')).expect(400);
    await subscribe(a.id, a.secret, subscription('https://fcm.googleapis.com.evil.example/x')).expect(400);
    await subscribe(a.id, a.secret, subscription('https://web.push.apple.com/abc')).expect(201);
  });

  it('one browser follows one token: subscribing again moves it; unsubscribing needs the key too', async () => {
    const a = await issue(app, world.deposits.id);
    const b = await issue(app, world.deposits.id);
    const sub = subscription();
    await subscribe(a.id, a.secret, sub).expect(201);
    await subscribe(b.id, b.secret, sub).expect(201);
    expect([await subsOf(a.id), await subsOf(b.id)]).toEqual([0, 1]);
    await request(app).delete(`/api/tokens/${b.id}/push`).send({ endpoint: sub.endpoint }).expect(404);
    await request(app).delete(`/api/tokens/${b.id}/push`).set(key(b.secret)).send({ endpoint: sub.endpoint }).expect(200);
    expect(await subsOf(b.id)).toBe(0);
  });

  it('dead subscriptions (404/410) are removed; other failures are logged, kept, and never fail the request', async () => {
    const a = await issue(app, world.deposits.id);
    const [gone, expired, flaky] = [endpoint(), endpoint(), endpoint()];
    for (const url of [gone, expired, flaky]) await subscribe(a.id, a.secret, subscription(url)).expect(201);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fail = (statusCode: number) => Promise.reject(Object.assign(new Error(`push ${statusCode}`), { statusCode }));
    answer = (url) => (url === gone ? fail(410) : url === expired ? fail(404) : fail(500));

    await callNext();
    expect((await prisma.pushSubscription.findMany({ where: { tokenId: a.id } })).map((s) => s.endpoint)).toEqual([flaky]);
    expect(errors).toHaveBeenCalledWith('[notify] push to fcm.googleapis.com failed:', 500);
    expect((await prisma.notificationLog.findFirst({ where: { tokenId: a.id, event: 'CALLED' } }))?.pushed).toBe(0);
  });

  it('are dropped when the token is done or cancelled, and follow a redirect to the new token', async () => {
    const done = await issue(app, world.deposits.id);
    await subscribe(done.id, done.secret).expect(201);
    await callNext();
    await counter(app, world.counter.id, 'ack').expect(200);
    await settled(counter(app, world.counter.id, 'complete').expect(200));
    expect(await subsOf(done.id)).toBe(0);

    const cancelled = await issue(app, world.deposits.id);
    await subscribe(cancelled.id, cancelled.secret).expect(201);
    await settled(request(app).post(`/api/tokens/${cancelled.id}/cancel`).set(key(cancelled.secret)).send({}).expect(200));
    expect(await subsOf(cancelled.id)).toBe(0);
    await subscribe(cancelled.id, cancelled.secret).expect(409); // nothing left to notify

    const moved = await issue(app, world.deposits.id);
    await subscribe(moved.id, moved.secret).expect(201);
    await callNext();
    await counter(app, world.counter.id, 'ack').expect(200);
    const r = await settled(counter(app, world.counter.id, 'redirect', { serviceId: world.loans.id }).expect(200));
    expect([await subsOf(moved.id), await subsOf(r.body.child.id)]).toEqual([0, 1]);
  });

  it('sending never blocks the request: call-next answers while the push service is still busy', async () => {
    const a = await issue(app, world.deposits.id);
    await subscribe(a.id, a.secret).expect(201);
    await flushNotifications();
    let release = () => undefined as void;
    answer = () => new Promise((resolve) => { release = () => resolve(undefined); });

    await counter(app, world.counter.id, 'call-next').expect(200);
    await vi.waitFor(() => expect(pushed('please go to')).toHaveLength(1)); // started, still unanswered
    release();
    await flushNotifications();
    expect((await prisma.notificationLog.findFirst({ where: { tokenId: a.id, event: 'CALLED' } }))?.pushed).toBe(1);
  });
});

describe('without VAPID keys', () => {
  it('push is off: no key published, subscribing → 409, nothing sent, in-page notifications still logged', async () => {
    configurePush(null);
    expect((await request(app).get('/api/push/key').expect(200)).body).toEqual({ publicKey: null });
    const a = await issue(app, world.deposits.id);
    await subscribe(a.id, a.secret).expect(409);
    await prisma.pushSubscription.create({ data: { tokenId: a.id, ...subscription().keys, endpoint: endpoint() } }); // left from when push was on
    await callNext();
    expect(sent).toEqual([]);
    expect(await logged(a.id)).toEqual(['NEXT_UP', 'CALLED']);
  });

  it('with keys, the public key is published for browsers to subscribe with', async () => {
    expect((await request(app).get('/api/push/key').expect(200)).body).toEqual({ publicKey: FAKE_KEYS.publicKey });
  });
});
