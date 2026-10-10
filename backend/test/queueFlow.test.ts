import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { CALL_WINDOW_MS, MIN, MISS_GRACE_MS } from '../src/engine/types.js';
import { prisma } from '../src/lib/db.js';
import { sweepCalls } from '../src/services/sweeper.js';
import { counter, fakeClock, issue, resetDb, staff, tokenRow } from './helpers.js';

const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;
let clock: ReturnType<typeof fakeClock>;

beforeEach(async () => { world = await resetDb(); clock = fakeClock(); });
afterEach(() => clock.restore());
afterAll(() => prisma.$disconnect());

describe('happy path', () => {
  it('issue → call-next → ack → complete: token DONE, service learns, events in order', async () => {
    const t = await issue(app, world.deposits.id);
    const called = await counter(app, world.counter.id, 'call-next').expect(200);
    expect(called.body.token).toMatchObject({ id: t.id, state: 'CALLED', counterId: world.counter.id });

    await counter(app, world.counter.id, 'ack').expect(200);
    clock.advance(5 * MIN);
    const done = await counter(app, world.counter.id, 'complete').expect(200);
    expect(done.body.minutes).toBeCloseTo(5, 6);

    const row = await tokenRow(t.id);
    expect(row.state).toBe('DONE');
    expect(row.doneAt?.getTime()).toBe(clock.now());
    const svc = await prisma.service.findUniqueOrThrow({ where: { id: world.deposits.id } });
    expect(svc.obsN).toBe(1);
    expect(svc.obsMean).toBeCloseTo(Math.log(5), 6);

    const events = await prisma.event.findMany({ where: { tokenId: t.id }, orderBy: { seq: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['TOKEN_ISSUED', 'CALLED', 'SERVING', 'COMPLETED']);
    expect(events.slice(1).every((e) => e.counterId === world.counter.id)).toBe(true);

    const detail = await staff(app).get(`/api/tokens/${t.id}`).expect(200);
    expect(detail.body).toMatchObject({ state: 'DONE', counterName: 'Counter 1' });
  });
});

describe('priority joins', () => {
  it('a priority token joining behind three normals is called next', async () => {
    for (let i = 0; i < 3; i++) await issue(app, world.deposits.id);
    clock.advance(MIN);
    const p = await issue(app, world.deposits.id, 'PRIORITY');

    const { body } = await counter(app, world.counter.id, 'call-next').expect(200);
    expect(body.token.id).toBe(p.id);
    expect(body.reason).toMatch(/earliest deadline.*priority/i);
  });

  it('a normal token past the hard ceiling goes before a fresh priority, even with a later deadline', async () => {
    // only a re-entered token can be past the ceiling with a deadline still ahead: miss it after a long wait
    const n = await issue(app, world.loans.id);
    clock.advance(61 * MIN); // Loans target 30 min → ceiling 60 min
    await counter(app, world.counter.id, 'call-next').expect(200);
    clock.advance(CALL_WINDOW_MS + 1); await sweepCalls();
    clock.advance(CALL_WINDOW_MS + 1); await sweepCalls();
    expect(await tokenRow(n.id)).toMatchObject({ state: 'WAITING', missCount: 1 });
    clock.advance(MISS_GRACE_MS + 1000);

    const p = await issue(app, world.deposits.id, 'PRIORITY');
    const [nRow, pRow] = [await tokenRow(n.id), await tokenRow(p.id)];
    expect(pRow.deadline.getTime()).toBeLessThan(nRow.deadline.getTime()); // deadline order alone would pick P

    const { body } = await counter(app, world.counter.id, 'call-next').expect(200);
    expect(body.token.id).toBe(n.id);
    expect(body.reason).toMatch(/past the hard ceiling/);
  });
});

describe('skills', () => {
  it('a counter only calls services it is skilled for; an unservable token is unavailable, with no ETA', async () => {
    await staff(app).patch(`/api/counters/${world.counter.id}`, { skills: [world.loans.id] }).expect(200);
    const d = await issue(app, world.deposits.id); // earlier, and a tighter target, but nobody can serve it
    const l = await issue(app, world.loans.id);
    expect(d.unavailable).toBe(true);

    const { body } = await counter(app, world.counter.id, 'call-next').expect(200);
    expect(body.token.id).toBe(l.id);

    const detail = await staff(app).get(`/api/tokens/${d.id}`).expect(200);
    expect(detail.body).toMatchObject({ state: 'WAITING', unavailable: true, etaP50: null, etaP90: null, etaMin: null, position: null });
    const snap = await staff(app).get('/api/snapshot').expect(200);
    const deposits = snap.body.services.find((s: { id: string }) => s.id === world.deposits.id);
    expect(deposits).toMatchObject({ capable: 0, quote: null, waiting: 1 });

    await counter(app, world.counter.id, 'ack').expect(200);
    await counter(app, world.counter.id, 'complete').expect(200);
    const empty = await counter(app, world.counter.id, 'call-next').expect(200);
    expect(empty.body).toEqual({ token: null, reason: 'No eligible customers for this counter right now' });
  });
});

describe('promise', () => {
  it('a token gets a whole-minute promiseP90 when a counter can serve it', async () => {
    const t = await issue(app, world.deposits.id);
    expect(t.promiseP90).not.toBeNull();
    const promise = new Date(t.promiseP90!).getTime();
    expect(promise % MIN).toBe(0);
    expect(promise).toBeGreaterThanOrEqual(clock.now() + 2 * MIN);
    expect((await tokenRow(t.id)).promiseP90?.getTime()).toBe(promise);
  });

  it('no promise when no open counter can serve it', async () => {
    await staff(app).patch(`/api/counters/${world.counter.id}`, { status: 'CLOSED' }).expect(200);
    const t = await issue(app, world.deposits.id);
    expect(t).toMatchObject({ promiseP90: null, unavailable: true });
    expect((await tokenRow(t.id)).promiseP90).toBeNull();
  });
});
