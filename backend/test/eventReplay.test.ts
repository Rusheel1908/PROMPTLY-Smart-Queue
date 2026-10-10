import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { replayTokens } from '../src/engine/replay.js';
import { CALL_WINDOW_MS, MISS_GRACE_MS } from '../src/engine/types.js';
import { prisma } from '../src/lib/db.js';
import { sweepCalls } from '../src/services/sweeper.js';
import { addCounter, counter, fakeClock, issue, resetDb, staff } from './helpers.js';

const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;
let clock: ReturnType<typeof fakeClock>;

beforeEach(async () => { world = await resetDb(); clock = fakeClock(); });
afterEach(() => clock.restore());
afterAll(() => prisma.$disconnect());

/** What the token table says, in the replay's shape. */
async function tableState() {
  const rows = await prisma.token.findMany({ select: { id: true, state: true, missCount: true, counterId: true } });
  return Object.fromEntries(rows.map(({ id, ...t }) => [id, t]));
}

const replayLog = async () => replayTokens(await prisma.event.findMany({ orderBy: { seq: 'asc' } }));

/** Run one action, then check the log against the table, so a later action cannot paper over a state the log missed. */
async function step<T>(action: Promise<T>): Promise<T> {
  const result = await action;
  expect(await replayLog()).toEqual(await tableState());
  return result;
}

describe('event log replay', () => {
  it('rebuilds every token state, miss count and counter from the log, after every step of a mixed scenario', async () => {
    const c2 = await addCounter('Counter 2', [world.deposits.id, world.loans.id]);
    const c1 = world.counter.id;
    for (let i = 0; i < 4; i++) await step(issue(app, world.deposits.id));
    await step(issue(app, world.loans.id));
    await step(issue(app, world.deposits.id, 'PRIORITY'));

    // staff miss at the desk → re-enters after grace
    await step(counter(app, c1, 'call-next').expect(200));
    await step(counter(app, c1, 'miss').expect(200));
    // redirect into Loans
    await step(counter(app, c1, 'call-next').expect(200));
    await step(counter(app, c1, 'ack').expect(200));
    await step(counter(app, c1, 'redirect', { serviceId: world.loans.id }).expect(200));
    // a full service
    await step(counter(app, c1, 'call-next').expect(200));
    await step(counter(app, c1, 'ack').expect(200));
    await step(counter(app, c1, 'complete').expect(200));
    // counter 2 closes while calling someone: the token goes back to the queue
    const handedBack = (await step(counter(app, c2.id, 'call-next').expect(200))).body.token.id;
    await step(staff(app).patch(`/api/counters/${c2.id}`, { status: 'CLOSED' }).expect(200));
    // a customer cancels
    const waiting = await prisma.token.findFirstOrThrow({ where: { state: 'WAITING', id: { not: handedBack } } });
    await step(staff(app).post(`/api/tokens/${waiting.id}/cancel`).expect(200));
    // auto-recall then auto-miss by the sweeper, until one customer misses twice → NO_SHOW, then reactivated
    clock.advance(MISS_GRACE_MS + 1000);
    for (let round = 0; round < 3; round++) {
      const called = (await step(counter(app, c1, 'call-next').expect(200))).body.token.id;
      clock.advance(CALL_WINDOW_MS + 1); await step(sweepCalls());
      clock.advance(CALL_WINDOW_MS + 1); await step(sweepCalls());
      if ((await prisma.token.findUniqueOrThrow({ where: { id: called } })).state === 'NO_SHOW') {
        await step(staff(app).post(`/api/tokens/${called}/reactivate`).expect(200));
        break;
      }
      clock.advance(MISS_GRACE_MS + 1000);
    }
    // leave one token CALLED and one SERVING at the end
    await step(counter(app, c1, 'call-next').expect(200));
    await step(counter(app, c1, 'ack').expect(200));
    await step(staff(app).patch(`/api/counters/${c2.id}`, { status: 'OPEN' }).expect(200));
    await step(counter(app, c2.id, 'call-next').expect(200));

    // the scenario really did reach the interesting states
    const table = await tableState();
    const states = new Set(Object.values(table).map((t) => t.state));
    for (const s of ['WAITING', 'CALLED', 'SERVING', 'DONE', 'REDIRECTED', 'CANCELLED']) expect(states).toContain(s);
    expect(Object.values(table).some((t) => t.missCount >= 2)).toBe(true);
  });

  it('a demo reset clears the replayed queue', async () => {
    await issue(app, world.deposits.id);
    await staff(app).post('/api/demo/reset').expect(200);
    expect(await replayLog()).toEqual({});
    expect(await tableState()).toEqual({});
  });
});
