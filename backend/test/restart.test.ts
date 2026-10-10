import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALL_WINDOW_MS } from '../src/engine/types.js';
import { prisma } from '../src/lib/db.js';
import { addCounter, as, resetDb } from './helpers.js';

/** Queue time shared by every server instance in this file, moved by hand. */
let t = Date.now();

/**
 * Start the server the way src/index.ts does, from a fresh module registry: nothing in memory
 * survives from an earlier instance (quote cache, serial chain, rate limiters, sweeper timers, Prisma client).
 */
async function boot() {
  vi.resetModules();
  const [{ createApp }, { startSweeper }, queue, dispatcher, clock, db, notifier] = await Promise.all([
    import('../src/app.js'), import('../src/services/sweeper.js'), import('../src/services/queue.js'),
    import('../src/engine/dispatcher.js'), import('../src/lib/clock.js'), import('../src/lib/db.js'),
    import('../src/services/notifier.js'),
  ]);
  clock.setNow(() => t);
  const server = createServer(createApp()).listen(0);
  const stopSweeper = startSweeper();
  await queue.serial(async () => undefined); // the boot replan has run
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    api: () => request(url),
    /** Sweeper ticks happen on its own restarted timers; wait for the work they queued. */
    tick: async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); await queue.serial(async () => undefined); },
    /** What call-next on this counter would pick right now, without calling anyone. */
    wouldPick: async (counterId: string) =>
      dispatcher.pickNext(queue.toEngine(await queue.loadWorld()), counterId, t)?.id ?? null,
    /** Process dies: timers stop and the connection drops. Nothing is flushed or saved on the way out. */
    crash: async () => {
      stopSweeper();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await notifier.flushNotifications(); // test isolation only: this instance's notifications must not land in the next test's database
      await db.prisma.$disconnect();
    },
  };
}
type Instance = Awaited<ReturnType<typeof boot>>;

/** Only real-time fields are dropped; with the clock held still they would match anyway. */
const TIME_FIELDS = new Set(['now', 'etaMin', 'waitMin']);
const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !TIME_FIELDS.has(k)).map(([k, x]) => [k, stable(x)]))
    : v);

let world: Awaited<ReturnType<typeof resetDb>>;
let server: Instance | undefined;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); // only the sweeper's loops; real I/O timers stay real
  t = Date.now();
  world = await resetDb();
});
afterEach(async () => { await server?.crash(); server = undefined; vi.useRealTimers(); });
afterAll(() => prisma.$disconnect());

const staff = (s: Instance) => ({
  post: (url: string, body: object = {}) => s.api().post(url).set(as()).send(body),
  get: (url: string) => s.api().get(url).set(as()),
});

describe('server restart', () => {
  it('rebuilds the same queue, picks the same next token, and keeps enforcing call windows', async () => {
    const c2 = await addCounter('Counter 2', [world.deposits.id, world.loans.id]);
    const c1 = world.counter.id;
    server = await boot();
    const before = staff(server);
    for (const serviceId of [world.deposits.id, world.loans.id, world.deposits.id, world.deposits.id]) {
      await server.api().post('/api/tokens').send({ serviceId }).expect(201);
    }
    await before.post('/api/tokens', { serviceId: world.loans.id, class: 'PRIORITY' }).expect(201);
    await before.post(`/api/counters/${c1}/call-next`).expect(200);
    await before.post(`/api/counters/${c1}/ack`).expect(200);
    t += 4 * 60_000;
    await before.post(`/api/counters/${c1}/complete`).expect(200);
    const called = (await before.post(`/api/counters/${c1}/call-next`).expect(200)).body.token.id; // left CALLED

    const snapBefore = (await before.get('/api/snapshot').expect(200)).body;
    const expectedNext = await server.wouldPick(c2.id);
    expect(expectedNext).not.toBeNull();

    await server.crash();
    server = await boot();
    const after = staff(server);

    // same queue: states, ETAs, promises, quotes, counters, recent calls, event log, metrics
    expect(stable((await after.get('/api/snapshot').expect(200)).body)).toEqual(stable(snapBefore));
    // same dispatch decision
    expect((await after.post(`/api/counters/${c2.id}/call-next`).expect(200)).body.token.id).toBe(expectedNext);

    // the CALLED token's window keeps counting from its pre-crash lastCallAt: restarted timers recall it
    t += CALL_WINDOW_MS + 1;
    await server.tick(5_000);
    expect(await prisma.token.findUniqueOrThrow({ where: { id: called } })).toMatchObject({ state: 'CALLED', recallCount: 1 });

    // crash again and stay down past the window: the next instance misses it on its first tick
    await server.crash();
    t += CALL_WINDOW_MS + 1;
    server = await boot();
    await server.tick(5_000);
    expect(await prisma.token.findUniqueOrThrow({ where: { id: called } }))
      .toMatchObject({ state: 'WAITING', missCount: 1, counterId: null });
    const types = (await prisma.event.findMany({ where: { tokenId: called }, orderBy: { seq: 'asc' } })).map((e) => e.type);
    expect(types).toEqual(['TOKEN_ISSUED', 'CALLED', 'RECALLED', 'MISSED']);
  });

  it('a token CALLED before a long outage is recalled once after boot, then missed a window later', async () => {
    server = await boot();
    await server.api().post('/api/tokens').send({ serviceId: world.deposits.id }).expect(201);
    const id = (await staff(server).post(`/api/counters/${world.counter.id}/call-next`).expect(200)).body.token.id;
    await server.crash();

    t += 10 * 60_000; // a long outage
    server = await boot();
    await server.tick(5_000); // first expiry → recall (customers hear their code again)
    await server.tick(5_000); // still expired: recalled at boot time, so wait out a fresh window
    expect(await prisma.token.findUniqueOrThrow({ where: { id } })).toMatchObject({ state: 'CALLED', recallCount: 1 });
    t += CALL_WINDOW_MS + 1;
    await server.tick(5_000);
    expect(await prisma.token.findUniqueOrThrow({ where: { id } })).toMatchObject({ state: 'WAITING', missCount: 1 });
  });

});
