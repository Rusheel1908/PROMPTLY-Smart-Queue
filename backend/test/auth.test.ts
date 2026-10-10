import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AUTH } from '../src/config.js';
import { prisma } from '../src/lib/db.js';
import { allowedActions } from '../src/lib/permissions.js';
import { as, counter, fakeClock, issue, resetDb, STAFF, staff, type Who } from './helpers.js';

const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;

beforeEach(async () => { world = await resetDb(); });
afterAll(() => prisma.$disconnect());

const login = (staffId: string, pin: string) => request(app).post('/api/auth/login').send({ staffId, pin });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('login', () => {
  it('returns a session token, the staff member and a ~12 h expiry; /auth/me answers with it', async () => {
    const { body } = await login(world.staff.asha, STAFF.asha.pin).expect(200);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.staff).toEqual({ id: world.staff.asha, name: 'Asha', role: 'SUPERVISOR' });
    expect(Math.abs(new Date(body.expiresAt).getTime() - Date.now() - AUTH.sessionTtlMs)).toBeLessThan(60_000);

    const me = await request(app).get('/api/auth/me').set(bearer(body.token)).expect(200);
    expect(me.body.staff.name).toBe('Asha');
    expect(me.body.permissions).toEqual(allowedActions('SUPERVISOR'));
  });

  it('stores only a hash of the session token', async () => {
    const { body } = await login(world.staff.ravi, STAFF.ravi.pin).expect(200);
    const rows = await prisma.session.findMany({ where: { staffId: world.staff.ravi } });
    expect(rows.some((r) => r.tokenHash === body.token)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(true);
  });

  it('a wrong PIN and an unknown staff member get the same 401', async () => {
    const wrong = await login(world.staff.ravi, '000000').expect(401);
    const unknown = await login('nobody', STAFF.ravi.pin).expect(401);
    expect(wrong.body).toEqual({ error: 'Invalid name or PIN' });
    expect(unknown.body).toEqual(wrong.body);
  });

  it('an inactive account cannot log in, and its open sessions stop working', async () => {
    await prisma.staff.update({ where: { id: world.staff.meera }, data: { active: false } });
    await login(world.staff.meera, STAFF.meera.pin).expect(401, { error: 'Invalid name or PIN' });
    await request(app).get('/api/auth/me').set(as('meera')).expect(401);
  });
});

describe('lockout', () => {
  let clock: ReturnType<typeof fakeClock>;
  beforeEach(() => { clock = fakeClock(); });
  afterEach(() => clock.restore());

  it(`locks the account after ${AUTH.maxFailedLogins} wrong PINs, even for the right PIN, until the lockout ends`, async () => {
    for (let i = 0; i < AUTH.maxFailedLogins; i++) await login(world.staff.ravi, '000000').expect(401);
    const locked = await login(world.staff.ravi, STAFF.ravi.pin).expect(429);
    expect(locked.body.error).toMatch(/Too many wrong PINs\. Try again in \d+ min/);
    await login(world.staff.asha, STAFF.asha.pin).expect(200); // other accounts are unaffected

    clock.advance(AUTH.lockoutMs + 1000);
    await login(world.staff.ravi, STAFF.ravi.pin).expect(200);
  });

  it('a successful login resets the count of wrong PINs', async () => {
    for (let i = 0; i < AUTH.maxFailedLogins - 1; i++) await login(world.staff.ravi, '000000').expect(401);
    await login(world.staff.ravi, STAFF.ravi.pin).expect(200);
    await login(world.staff.ravi, '000000').expect(401);
    await login(world.staff.ravi, STAFF.ravi.pin).expect(200);
  });
});

describe('sessions', () => {
  it('an expired session gets 401', async () => {
    const clock = fakeClock();
    try {
      const { body } = await login(world.staff.ravi, STAFF.ravi.pin).expect(200);
      await request(app).get('/api/auth/me').set(bearer(body.token)).expect(200);
      clock.advance(AUTH.sessionTtlMs + 60_000);
      await request(app).get('/api/auth/me').set(bearer(body.token)).expect(401);
      await request(app).post(`/api/counters/${world.counter.id}/call-next`).set(bearer(body.token)).expect(401);
    } finally {
      clock.restore();
    }
  });

  it('logout ends the session', async () => {
    const { body } = await login(world.staff.ravi, STAFF.ravi.pin).expect(200);
    await request(app).post('/api/auth/logout').set(bearer(body.token)).expect(200);
    await request(app).get('/api/auth/me').set(bearer(body.token)).expect(401);
  });

  it('missing or made-up tokens get 401', async () => {
    await request(app).get('/api/auth/me').expect(401, { error: 'Log in required' });
    await request(app).get('/api/auth/me').set(bearer('made-up')).expect(401);
  });

  it('the old shared x-staff-pin header no longer works anywhere', async () => {
    const pin = { 'x-staff-pin': '1234' };
    await request(app).post(`/api/counters/${world.counter.id}/call-next`).set(pin).expect(401);
    await request(app).get('/api/ops/suggestions').set(pin).expect(401);
    await request(app).post('/api/tokens').set(pin).send({ serviceId: world.deposits.id, class: 'PRIORITY' }).expect(403);
    const snap = await request(app).get('/api/snapshot').set(pin).expect(200);
    expect(snap.body.events).toEqual([]); // the public view
    await request(app).get('/api/auth/check').set(pin).expect(404);
  });
});

describe('login picker', () => {
  it('lists active staff by id and name only', async () => {
    await prisma.staff.update({ where: { id: world.staff.meera }, data: { active: false } });
    const { body } = await request(app).get('/api/auth/staff').expect(200);
    expect(body).toEqual([{ id: world.staff.asha, name: 'Asha' }, { id: world.staff.ravi, name: 'Ravi' }]);
  });
});

describe('roles', () => {
  it('STAFF can work the counter but not change it (403); SUPERVISOR can', async () => {
    await issue(app, world.deposits.id);
    await counter(app, world.counter.id, 'call-next', {}, 'ravi').expect(200);
    const r = await staff(app, 'ravi').patch(`/api/counters/${world.counter.id}`, { status: 'CLOSED' }).expect(403);
    expect(r.body.error).toMatch(/Staff.*Ask a supervisor/);
    await staff(app, 'asha').patch(`/api/counters/${world.counter.id}`, { status: 'PAUSED' }).expect(200);
  });

  it.each([
    ['get', '/api/ops/suggestions'],
    ['get', '/api/ops/staff-stats'],
    ['post', '/api/demo/reset'],
    ['post', '/api/demo/spawn'],
    ['post', '/api/lab/run'],
    ['post', '/api/whatif'],
  ] as const)('STAFF gets 403 on supervisor route %s %s', async (method, url) => {
    await request(app)[method](url).set(as('ravi')).send({}).expect(403);
  });

  it('STAFF can issue a priority token at the kiosk', async () => {
    await request(app).post('/api/tokens').set(as('ravi')).send({ serviceId: world.deposits.id, class: 'PRIORITY' }).expect(201);
  });
});

describe('attribution', () => {
  it('events record the staff id of whoever acted; the read model shows the name', async () => {
    const t = await issue(app, world.deposits.id);
    await counter(app, world.counter.id, 'call-next', {}, 'ravi').expect(200);
    await counter(app, world.counter.id, 'ack', {}, 'meera').expect(200);
    await counter(app, world.counter.id, 'complete', {}, 'asha').expect(200);

    const events = await prisma.event.findMany({ where: { tokenId: t.id }, orderBy: { seq: 'asc' } });
    expect(events.map((e) => [e.type, e.actor])).toEqual([
      ['TOKEN_ISSUED', 'kiosk'],
      ['CALLED', world.staff.ravi],
      ['SERVING', world.staff.meera],
      ['COMPLETED', world.staff.asha],
    ]);
    const { body } = await staff(app).get('/api/snapshot').expect(200);
    const names = Object.fromEntries(body.events.map((e: { type: string; actorName: string }) => [e.type, e.actorName]));
    expect(names).toMatchObject({ CALLED: 'Ravi', SERVING: 'Meera', COMPLETED: 'Asha', TOKEN_ISSUED: 'Kiosk' });
  });
});

describe('miss audit', () => {
  /** One customer through the counter: called by `who`, then missed or served and completed by them. */
  async function serve(who: Who, outcome: 'miss' | 'complete') {
    await issue(app, world.deposits.id);
    await counter(app, world.counter.id, 'call-next', {}, who).expect(200);
    outcome === 'complete' && (await counter(app, world.counter.id, 'ack', {}, who).expect(200));
    await counter(app, world.counter.id, outcome, {}, who).expect(200);
  }

  it('flags a staff member whose miss rate is well above the team average', async () => {
    for (let i = 0; i < 4; i++) await serve('asha', 'complete');
    for (let i = 0; i < 4; i++) await serve('meera', i === 0 ? 'miss' : 'complete');
    for (let i = 0; i < 4; i++) await serve('ravi', i === 0 ? 'complete' : 'miss');

    const { body } = await staff(app).get('/api/ops/staff-stats').expect(200);
    const byName = Object.fromEntries(body.staff.map((s: { name: string }) => [s.name, s]));
    expect(body.teamRate).toBeCloseTo(4 / 12);
    expect(byName.Ravi).toMatchObject({ calls: 4, completes: 1, misses: 3, missRate: 0.75, flagged: true });
    expect(byName.Meera).toMatchObject({ calls: 4, misses: 1, flagged: false });
    expect(byName.Asha).toMatchObject({ calls: 4, completes: 4, misses: 0, flagged: false });
  });
});
