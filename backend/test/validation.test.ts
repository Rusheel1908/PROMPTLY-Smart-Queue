import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { counter, issue, key, PIN, resetDb, staff } from './helpers.js';

const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;

beforeEach(async () => { world = await resetDb(); });
afterAll(() => prisma.$disconnect());

const kiosk = (body: object) => request(app).post('/api/tokens').send(body);

describe('issuing', () => {
  it('unknown serviceId → 404, nothing created', async () => {
    await kiosk({ serviceId: 'no-such-service' }).expect(404, { error: 'Unknown service' });
    expect(await prisma.token.count()).toBe(0);
  });

  it.each([
    ['missing serviceId', {}],
    ['empty serviceId', { serviceId: '' }],
    ['non-string serviceId', { serviceId: 42 }],
  ])('%s → 400', async (_name, body) => {
    const r = await kiosk(body).expect(400);
    expect(r.body).toMatchObject({ error: 'Invalid request', issues: [expect.objectContaining({ path: ['serviceId'] })] });
  });

  it('unknown class → 400', async () => {
    const r = await kiosk({ serviceId: world.deposits.id, class: 'VIP' }).expect(400);
    expect(r.body.issues[0].path).toEqual(['class']);
  });

  it.each(['PRIORITY', 'EMERGENCY', 'APPOINTMENT'])('%s from the kiosk without a PIN → 403', async (cls) => {
    await kiosk({ serviceId: world.deposits.id, class: cls })
      .expect(403, { error: 'Priority classes must be verified by staff' });
    await kiosk({ serviceId: world.deposits.id, class: cls }).set({ 'x-staff-pin': '0000' }).expect(403);
    expect(await prisma.token.count()).toBe(0);
  });

  it('staff may issue a priority token, logged with actor "staff"', async () => {
    const t = await issue(app, world.deposits.id, 'PRIORITY');
    expect(t).toMatchObject({ class: 'PRIORITY', state: 'WAITING' });
    const ev = await prisma.event.findFirstOrThrow({ where: { tokenId: t.id, type: 'TOKEN_ISSUED' } });
    expect(ev.actor).toBe('staff');
  });
});

describe('counters', () => {
  it('counter actions need the staff PIN', async () => {
    await request(app).post(`/api/counters/${world.counter.id}/call-next`).expect(401);
    await request(app).post(`/api/counters/${world.counter.id}/call-next`).set({ 'x-staff-pin': '0000' }).expect(401);
  });

  it('unknown counter → 404', async () => {
    await counter(app, 'no-such-counter', 'call-next').expect(404, { error: 'Unknown counter' });
    await staff(app).patch('/api/counters/no-such-counter', { status: 'OPEN' }).expect(404, { error: 'Unknown counter' });
  });

  it('bad bodies → 400', async () => {
    await staff(app).patch(`/api/counters/${world.counter.id}`, { status: 'ON_FIRE' }).expect(400);
    await staff(app).patch(`/api/counters/${world.counter.id}`, { skills: 'everything' }).expect(400);
    await counter(app, world.counter.id, 'redirect', {}).expect(400);
  });

  it('redirect to an unknown service → 404', async () => {
    await issue(app, world.deposits.id);
    await counter(app, world.counter.id, 'call-next').expect(200);
    await counter(app, world.counter.id, 'ack').expect(200);
    await counter(app, world.counter.id, 'redirect', { serviceId: 'no-such-service' }).expect(404, { error: 'Unknown service' });
  });
});

describe('customer routes', () => {
  it('step-away minutes out of range → 400', async () => {
    const t = await issue(app, world.deposits.id);
    for (const minutes of [0, 31, 2.5, '5']) {
      await request(app).post(`/api/tokens/${t.id}/away`).set(key(t.secret)).send({ minutes }).expect(400);
    }
  });

  it('reactivate of an unknown token → 404', async () => {
    await request(app).post('/api/tokens/no-such-token/reactivate').set(PIN).expect(404, { error: 'Token not found' });
  });
});
