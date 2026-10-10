import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { counter, issue, key, as, resetDb, staff } from './helpers.js';

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

  it('APPOINTMENT is never issued directly, not even by staff: only a booking check-in gives it → 400', async () => {
    const msg = { error: 'Appointments check in with their booking code' };
    await kiosk({ serviceId: world.deposits.id, class: 'APPOINTMENT' }).expect(400, msg);
    await kiosk({ serviceId: world.deposits.id, class: 'APPOINTMENT' }).set(as()).expect(400, msg);
    expect(await prisma.token.count()).toBe(0);
  });

  it.each(['PRIORITY', 'EMERGENCY'])('%s from the kiosk without a staff session → 403', async (cls) => {
    await kiosk({ serviceId: world.deposits.id, class: cls })
      .expect(403, { error: 'Priority classes must be verified by staff' });
    await kiosk({ serviceId: world.deposits.id, class: cls }).set({ 'x-staff-pin': '1234' }).expect(403);
    expect(await prisma.token.count()).toBe(0);
  });

  it('staff may issue a priority token, logged with the staff member id', async () => {
    const t = await issue(app, world.deposits.id, 'PRIORITY');
    expect(t).toMatchObject({ class: 'PRIORITY', state: 'WAITING' });
    const ev = await prisma.event.findFirstOrThrow({ where: { tokenId: t.id, type: 'TOKEN_ISSUED' } });
    expect(ev.actor).toBe(world.staff.asha);
  });
});

describe('counters', () => {
  it('counter actions need a staff session', async () => {
    await request(app).post(`/api/counters/${world.counter.id}/call-next`).expect(401);
    await request(app).post(`/api/counters/${world.counter.id}/call-next`).set({ 'x-staff-pin': '1234' }).expect(401);
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

  it('skills naming an unknown service → 404, skills unchanged', async () => {
    await staff(app).patch(`/api/counters/${world.counter.id}`, { skills: [world.loans.id, 'no-such-service'] })
      .expect(404, { error: 'Unknown service' });
    expect(await prisma.counterSkill.count({ where: { counterId: world.counter.id } })).toBe(2);
  });

  it('a service listed twice in skills is stored once', async () => {
    await staff(app).patch(`/api/counters/${world.counter.id}`, { skills: [world.loans.id, world.loans.id] }).expect(200);
    const skills = await prisma.counterSkill.findMany({ where: { counterId: world.counter.id } });
    expect(skills.map((s) => s.serviceId)).toEqual([world.loans.id]);
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
    await request(app).post('/api/tokens/no-such-token/reactivate').set(as()).expect(404, { error: 'Token not found' });
  });
});
