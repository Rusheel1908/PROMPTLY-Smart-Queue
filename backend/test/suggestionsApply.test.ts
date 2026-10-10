import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { attachRealtime, closeRealtime } from '../src/realtime.js';
import { STALE_MESSAGE, startSuggestions } from '../src/services/suggestions.js';
import { addCounter, issue, resetDb, staff } from './helpers.js';
import { loansStranded, SUGGESTIONS } from './suggestionHelpers.js';

// own file: the issue-token rate limit is per module
const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;
let counter2: Awaited<ReturnType<typeof addCounter>>;

beforeEach(async () => {
  world = await resetDb(); // Counter 1: Deposits + Loans
  counter2 = await addCounter('Counter 2', [world.deposits.id]);
});
afterAll(() => prisma.$disconnect());

const get = () => staff(app).get(SUGGESTIONS).expect(200).then((r) => r.body);

describe('apply', () => {
  it('applies through the counter update path, logs the predicted benefit and replans', async () => {
    await loansStranded(app, world);
    const [top] = (await get()).suggestions;
    const lastSeq = (await prisma.event.findFirstOrThrow({ orderBy: { seq: 'desc' } })).seq;

    await staff(app).post(`${SUGGESTIONS}/${top.id}/apply`).expect(200, { ok: true, applied: top.id });

    const skills = await prisma.counterSkill.findMany({ where: { counterId: counter2.id } });
    expect(skills.map((s) => s.serviceId).sort()).toEqual([world.deposits.id, world.loans.id].sort());
    const events = await prisma.event.findMany({ where: { seq: { gt: lastSeq } }, orderBy: { seq: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['SUGGESTION_APPLIED', 'COUNTER_CHANGED']);
    expect(events[0]).toMatchObject({
      actor: 'staff', counterId: counter2.id,
      payload: { suggestionId: top.id, explanation: top.explanation, predicted: top.numbers },
    });
    // replanned: the Loans customers have an ETA again
    const loans = await prisma.token.findMany({ where: { serviceId: world.loans.id } });
    expect(loans.every((t) => t.etaP50 !== null)).toBe(true);
    // the event log shows it to staff
    const snap = await staff(app).get('/api/snapshot').expect(200);
    expect(snap.body.events.some((e: { type: string }) => e.type === 'SUGGESTION_APPLIED')).toBe(true);
  });

  it('a stale suggestion → 409 asking to refresh, and nothing changes', async () => {
    await loansStranded(app, world);
    const [top] = (await get()).suggestions;
    await staff(app).patch(`/api/counters/${counter2.id}`, { status: 'PAUSED' }).expect(200); // queue changed
    await staff(app).post(`${SUGGESTIONS}/${top.id}/apply`).expect(409, { error: STALE_MESSAGE });
    expect(await prisma.event.count({ where: { type: 'SUGGESTION_APPLIED' } })).toBe(0);
    expect(await prisma.counterSkill.count({ where: { counterId: counter2.id } })).toBe(1);
  });

  it('an unknown suggestion id → 409', async () => {
    await loansStranded(app, world);
    await get();
    await staff(app).post(`${SUGGESTIONS}/reopen:nope/apply`).expect(409, { error: STALE_MESSAGE });
  });
});

describe('automatic recompute', () => {
  it('a counter change triggers a bare "suggestions-updated" ping with no details', async () => {
    const server = createServer(app);
    attachRealtime(server);
    server.listen(0);
    await once(server, 'listening');
    const stop = startSuggestions();
    const client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`);
    const raw: string[] = [];
    client.on('message', (m) => raw.push(String(m)));
    await once(client, 'open');
    try {
      for (let i = 0; i < 2; i++) await issue(app, world.loans.id);
      await staff(app).patch(`/api/counters/${world.counter.id}`, { status: 'CLOSED' }).expect(200);
      const started = Date.now();
      while (!raw.some((m) => m.includes('suggestions-updated')) && Date.now() - started < 10_000) {
        await new Promise((r) => setTimeout(r, 25));
      }
      const pings = raw.filter((m) => m.includes('suggestions-updated'));
      expect(pings).toEqual([JSON.stringify({ type: 'suggestions-updated', data: {} })]);
      // and the details are there for staff
      expect((await get()).suggestions[0].change.serviceId).toBe(world.loans.id);
    } finally {
      client.close();
      await stop();
      await closeRealtime();
      server.close();
    }
  });
});
