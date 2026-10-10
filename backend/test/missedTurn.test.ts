import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { CALL_WINDOW_MS, MISS_GRACE_MS } from '../src/engine/types.js';
import { prisma } from '../src/lib/db.js';
import { sweepCalls } from '../src/services/sweeper.js';
import { counter, fakeClock, issue, resetDb, staff, tokenRow } from './helpers.js';

const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;
let clock: ReturnType<typeof fakeClock>;

beforeEach(async () => { world = await resetDb(); clock = fakeClock(); });
afterEach(() => clock.restore());
afterAll(() => prisma.$disconnect());

/** Let one call window run out, then run the sweeper once. */
async function windowExpires() {
  clock.advance(CALL_WINDOW_MS + 1);
  await sweepCalls();
}

const callNext = () => counter(app, world.counter.id, 'call-next').expect(200).then((r) => r.body.token);
const serve = async () => {
  await counter(app, world.counter.id, 'ack').expect(200);
  await counter(app, world.counter.id, 'complete').expect(200);
};
const eventTypes = async (tokenId: string) =>
  (await prisma.event.findMany({ where: { tokenId }, orderBy: { seq: 'asc' } })).map((e) => e.type);

describe('missed turn', () => {
  it('auto-recall, miss, grace, re-entry ahead of later arrivals, no-show on the second miss, staff reactivate', async () => {
    const a = await issue(app, world.deposits.id);
    expect((await callNext()).id).toBe(a.id);

    // a sweep inside the window does nothing
    clock.advance(CALL_WINDOW_MS - 1000);
    await sweepCalls();
    expect(await tokenRow(a.id)).toMatchObject({ state: 'CALLED', recallCount: 0 });

    // first expiry: one automatic recall, still at the counter
    clock.advance(2000);
    await sweepCalls();
    expect(await tokenRow(a.id)).toMatchObject({ state: 'CALLED', recallCount: 1, counterId: world.counter.id });

    // second expiry: missed. Re-enters as WAITING after a grace delay (MAX_MISSES = 2 → not yet a no-show)
    await windowExpires();
    const missed = await tokenRow(a.id);
    expect(missed).toMatchObject({ state: 'WAITING', missCount: 1, counterId: null, calledAt: null });
    expect(missed.notBefore.getTime()).toBe(clock.now() + MISS_GRACE_MS);
    expect(await eventTypes(a.id)).toEqual(['TOKEN_ISSUED', 'CALLED', 'RECALLED', 'MISSED']);

    // during grace: not callable, a later arrival is called instead
    const b = await issue(app, world.deposits.id);
    clock.advance(MISS_GRACE_MS / 2);
    expect((await callNext()).id).toBe(b.id);
    await serve();
    expect(await callNext()).toBeNull();

    // after grace: called before a normal who arrived later
    const c = await issue(app, world.deposits.id);
    clock.advance(MISS_GRACE_MS / 2 + 1000);
    expect((await callNext()).id).toBe(a.id);

    // second miss → NO_SHOW, and C is next
    await windowExpires();
    await windowExpires();
    expect(await tokenRow(a.id)).toMatchObject({ state: 'NO_SHOW', missCount: 2, counterId: null });
    expect((await callNext()).id).toBe(c.id);

    // staff can bring the customer back; the public cannot
    await request(app).post(`/api/tokens/${a.id}/reactivate`).expect(401);
    const back = await staff(app).post(`/api/tokens/${a.id}/reactivate`).expect(200);
    expect(back.body).toMatchObject({ state: 'WAITING', missCount: 2 });
    expect((await tokenRow(a.id)).notBefore.getTime()).toBe(clock.now());
    expect((await eventTypes(a.id)).at(-1)).toBe('REACTIVATED');
  });

  it('reactivating a token that was not missed → 409', async () => {
    const a = await issue(app, world.deposits.id);
    const r = await staff(app).post(`/api/tokens/${a.id}/reactivate`).expect(409);
    expect(r.body.error).toBe('Cannot reactivate a token that is waiting');
  });

  it('a manual recall restarts the call window', async () => {
    const a = await issue(app, world.deposits.id);
    await callNext();
    clock.advance(CALL_WINDOW_MS - 1000);
    await counter(app, world.counter.id, 'recall').expect(200);
    clock.advance(CALL_WINDOW_MS - 1000);
    await sweepCalls();
    expect(await tokenRow(a.id)).toMatchObject({ state: 'CALLED', recallCount: 1 });
  });
});
