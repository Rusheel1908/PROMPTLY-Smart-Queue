import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { MIN } from '../src/engine/types.js';
import { prisma } from '../src/lib/db.js';
import { addCounter, counter, fakeClock, issue, resetDb, staff, tokenRow } from './helpers.js';

const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;
let clock: ReturnType<typeof fakeClock>;

beforeEach(async () => { world = await resetDb(); clock = fakeClock(); });
afterEach(() => clock.restore());
afterAll(() => prisma.$disconnect());

const both = () => [world.deposits.id, world.loans.id];

describe('counter outage', () => {
  it('closing a counter hands its CALLED token back with the original deadline, and explains the ETA shift', async () => {
    await addCounter('Counter 2', both());
    const [a, b] = [await issue(app, world.deposits.id), await issue(app, world.deposits.id)];
    await issue(app, world.deposits.id);
    await issue(app, world.deposits.id);
    expect((await counter(app, world.counter.id, 'call-next').expect(200)).body.token.id).toBe(a.id);
    const deadline = (await tokenRow(a.id)).deadline;

    await staff(app).patch(`/api/counters/${world.counter.id}`, { status: 'CLOSED' }).expect(200);

    expect(await tokenRow(a.id)).toMatchObject({ state: 'WAITING', counterId: null, calledAt: null, lastCallAt: null, deadline });
    const closedEvent = await prisma.event.findFirstOrThrow({ where: { type: 'COUNTER_CHANGED' } });
    const shift = await prisma.etaChange.findFirstOrThrow({ where: { tokenId: b.id } });
    expect(shift).toMatchObject({ reason: 'Counter 1 closed', causeEvent: closedEvent.seq });
    expect(shift.deltaS).toBeGreaterThan(0);

    // the customer sees it on their status page
    const detail = await staff(app).get(`/api/tokens/${b.id}`).expect(200);
    expect(detail.body.changes[0]).toMatchObject({ reason: 'Counter 1 closed', deltaS: shift.deltaS });
  });

  it('pausing keeps a SERVING token at the counter', async () => {
    const a = await issue(app, world.deposits.id);
    await counter(app, world.counter.id, 'call-next').expect(200);
    await counter(app, world.counter.id, 'ack').expect(200);
    await staff(app).patch(`/api/counters/${world.counter.id}`, { status: 'PAUSED' }).expect(200);
    expect(await tokenRow(a.id)).toMatchObject({ state: 'SERVING', counterId: world.counter.id });
  });
});

describe('redirect', () => {
  async function callAndAck() {
    const { body } = await counter(app, world.counter.id, 'call-next').expect(200);
    await counter(app, world.counter.id, 'ack').expect(200);
    return body.token.id as string;
  }

  it('the child keeps the arrival credit; the parent is REDIRECTED', async () => {
    const parent = await issue(app, world.deposits.id);
    clock.advance(3 * MIN);
    await callAndAck();
    const { body } = await counter(app, world.counter.id, 'redirect', { serviceId: world.loans.id }).expect(200);

    const [p, c] = [await tokenRow(parent.id), await tokenRow(body.child.id)];
    expect(p).toMatchObject({ state: 'REDIRECTED' });
    expect(c).toMatchObject({
      state: 'WAITING', serviceId: world.loans.id, parentTokenId: parent.id, redirectDepth: 1, class: 'NORMAL',
      creditedArrival: p.creditedArrival, arrivedAt: p.arrivedAt, promiseP90: p.promiseP90,
    });
    expect(c.code).toBe('L-001');
    expect(c.deadline.getTime()).toBe(p.creditedArrival.getTime() + world.loans.targetWaitS * 1000);
  });

  it('enforces the redirect limit and refuses the same service', async () => {
    await issue(app, world.deposits.id);
    await callAndAck();
    await counter(app, world.counter.id, 'redirect', { serviceId: world.deposits.id })
      .expect(400, { error: 'Choose a different service to redirect to' });
    await counter(app, world.counter.id, 'redirect', { serviceId: world.loans.id }).expect(200);
    await callAndAck();
    await counter(app, world.counter.id, 'redirect', { serviceId: world.deposits.id }).expect(200);
    const third = await callAndAck();
    expect((await tokenRow(third)).redirectDepth).toBe(2);

    await counter(app, world.counter.id, 'redirect', { serviceId: world.loans.id })
      .expect(409, { error: 'Redirect limit reached for this customer' });
    expect(await tokenRow(third)).toMatchObject({ state: 'SERVING' });
  });
});

describe('concurrency', () => {
  it('two counters calling at the same moment never get the same token', async () => {
    const c2 = await addCounter('Counter 2', both());
    const issued = [await issue(app, world.deposits.id), await issue(app, world.deposits.id)];
    const [r1, r2] = await Promise.all([
      counter(app, world.counter.id, 'call-next'), counter(app, c2.id, 'call-next'),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect([r1.body.token.id, r2.body.token.id].sort()).toEqual(issued.map((t) => t.id).sort());
  });

  it('with one token waiting, exactly one of the two counters gets it', async () => {
    const c2 = await addCounter('Counter 2', both());
    const t = await issue(app, world.deposits.id);
    const results = await Promise.all([counter(app, world.counter.id, 'call-next'), counter(app, c2.id, 'call-next')]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.token?.id ?? null).filter(Boolean)).toEqual([t.id]);
    expect(await prisma.token.count({ where: { state: 'CALLED' } })).toBe(1);
  });
});

describe('invalid moves → 409 with a clear message', () => {
  const NOBODY = { error: 'No customer at this counter' };

  it('complete or ack with nobody at the counter (a WAITING token is not touched)', async () => {
    const t = await issue(app, world.deposits.id);
    await counter(app, world.counter.id, 'complete').expect(409, NOBODY);
    await counter(app, world.counter.id, 'ack').expect(409, NOBODY);
    await counter(app, world.counter.id, 'recall').expect(409, NOBODY);
    await counter(app, world.counter.id, 'miss').expect(409, NOBODY);
    expect(await tokenRow(t.id)).toMatchObject({ state: 'WAITING', counterId: null });
  });

  it('out-of-order steps on the token at the counter', async () => {
    await issue(app, world.deposits.id);
    await issue(app, world.deposits.id);
    await counter(app, world.counter.id, 'call-next').expect(200);
    await counter(app, world.counter.id, 'complete').expect(409, { error: 'Cannot complete a token that is called' });
    await counter(app, world.counter.id, 'redirect', { serviceId: world.loans.id })
      .expect(409, { error: 'Cannot redirect a token that is called' });
    await counter(app, world.counter.id, 'call-next').expect(409, { error: 'Counter 1 already has D-001 at the desk' });
    await counter(app, world.counter.id, 'ack').expect(200);
    await counter(app, world.counter.id, 'ack').expect(409, { error: 'Cannot ack a token that is serving' });
    await counter(app, world.counter.id, 'miss').expect(409, { error: 'Cannot miss a token that is serving' });
  });

  it('call-next on a closed or paused counter', async () => {
    await issue(app, world.deposits.id);
    await staff(app).patch(`/api/counters/${world.counter.id}`, { status: 'CLOSED' }).expect(200);
    await counter(app, world.counter.id, 'call-next').expect(409, { error: 'Counter 1 is closed' });
    await staff(app).patch(`/api/counters/${world.counter.id}`, { status: 'PAUSED' }).expect(200);
    await counter(app, world.counter.id, 'call-next').expect(409, { error: 'Counter 1 is paused' });
  });

  it('cancelling a finished token', async () => {
    const t = await issue(app, world.deposits.id);
    await counter(app, world.counter.id, 'call-next').expect(200);
    await counter(app, world.counter.id, 'ack').expect(200);
    await counter(app, world.counter.id, 'complete').expect(200);
    await staff(app).post(`/api/tokens/${t.id}/cancel`).expect(409, { error: 'Cannot cancel a token that is done' });
  });
});
