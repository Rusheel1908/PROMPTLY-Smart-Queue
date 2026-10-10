import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { issue, key, PIN, resetDb } from './helpers.js';

const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;

beforeEach(async () => { world = await resetDb(); });
afterAll(() => prisma.$disconnect());

const BOARD_FIELDS = ['code', 'counterId', 'etaMin', 'position', 'serviceId', 'state', 'unavailable'];
const keysOf = (o: object) => Object.keys(o).sort();

describe('issuing', () => {
  it('returns a unique base64url secret once, at issue time', async () => {
    const a = await issue(app, world.deposits.id);
    const b = await issue(app, world.deposits.id);
    expect(a.secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a.secret).not.toBe(b.secret);
    const detail = await request(app).get(`/api/tokens/${a.id}`).set(key(a.secret)).expect(200);
    expect(JSON.stringify(detail.body)).not.toContain(a.secret);
  });
});

describe('snapshot', () => {
  it('public view contains no token ids or secrets anywhere', async () => {
    const issued = [
      await issue(app, world.deposits.id), await issue(app, world.deposits.id), await issue(app, world.loans.id),
    ];
    await request(app).post(`/api/counters/${world.counter.id}/call-next`).set(PIN).expect(200);

    const { body } = await request(app).get('/api/snapshot').expect(200);
    const raw = JSON.stringify(body);
    for (const t of issued) {
      expect(raw).not.toContain(t.id);
      expect(raw).not.toContain(t.secret);
    }
    expect(body.tokens).toHaveLength(3);
    for (const t of body.tokens) expect(keysOf(t)).toEqual(BOARD_FIELDS);
    const current = body.counters.find((c: { current: unknown }) => c.current).current;
    expect(keysOf(current)).toEqual(BOARD_FIELDS);
    expect(body.recentCalls[0]).not.toHaveProperty('id');
    expect(body.recentCalls[0].code).toBe(current.code);
    expect(body.events).toEqual([]);
  });

  it('staff view (PIN) keeps token ids for Counter and Ops, but still no secrets', async () => {
    const t = await issue(app, world.deposits.id);
    const { body } = await request(app).get('/api/snapshot').set(PIN).expect(200);
    expect(body.tokens.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect(body.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain(t.secret);
  });

  it('a wrong PIN gets the public view', async () => {
    const t = await issue(app, world.deposits.id);
    const { body } = await request(app).get('/api/snapshot').set({ 'x-staff-pin': '0000' }).expect(200);
    expect(JSON.stringify(body)).not.toContain(t.id);
  });
});

/** Every customer route behaves the same: only the key holder or staff gets past a 404. */
const ROUTES = [
  { name: 'detail', send: (id: string) => request(app).get(`/api/tokens/${id}`) },
  { name: 'away', send: (id: string) => request(app).post(`/api/tokens/${id}/away`).send({ minutes: 5 }) },
  { name: 'cancel', send: (id: string) => request(app).post(`/api/tokens/${id}/cancel`).send({}) },
];

describe.each(ROUTES)('$name access', ({ send }) => {
  it('404s without a key, with a wrong key, and for an unknown id, all with the same body', async () => {
    const t = await issue(app, world.deposits.id);
    const other = await issue(app, world.deposits.id);
    const responses = [
      await send(t.id),
      await send(t.id).set(key('not-the-key')),
      await send(t.id).set(key(other.secret)), // another customer's valid key
      await send(t.id).set(key('')),
      await send('does-not-exist').set(key(t.secret)),
    ];
    for (const r of responses) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'Token not found' });
    }
    const after = await prisma.token.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.state).toBe('WAITING');
    expect(after.notBefore.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('works with the right key', async () => {
    const t = await issue(app, world.deposits.id);
    const r = await send(t.id).set(key(t.secret)).expect(200);
    expect(r.body.id).toBe(t.id);
  });

  it('works with the staff PIN', async () => {
    const t = await issue(app, world.deposits.id);
    const r = await send(t.id).set(PIN).expect(200);
    expect(r.body.id).toBe(t.id);
  });
});

describe('effects', () => {
  it('the key holder can actually cancel', async () => {
    const t = await issue(app, world.deposits.id);
    const r = await request(app).post(`/api/tokens/${t.id}/cancel`).set(key(t.secret)).send({}).expect(200);
    expect(r.body.state).toBe('CANCELLED');
  });

  it('the key holder can actually step away', async () => {
    const t = await issue(app, world.deposits.id);
    const r = await request(app).post(`/api/tokens/${t.id}/away`).set(key(t.secret)).send({ minutes: 10 }).expect(200);
    expect(new Date(r.body.notBefore).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
  });
});

describe('redirect', () => {
  it('the child token gets its own secret, reachable from the parent link only', async () => {
    const t = await issue(app, world.deposits.id);
    const counter = `/api/counters/${world.counter.id}`;
    await request(app).post(`${counter}/call-next`).set(PIN).expect(200);
    await request(app).post(`${counter}/ack`).set(PIN).expect(200);
    const { body } = await request(app).post(`${counter}/redirect`).set(PIN).send({ serviceId: world.loans.id }).expect(200);

    const child = await prisma.token.findUniqueOrThrow({ where: { id: body.child.id } });
    expect(child.secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(child.secret).not.toBe(t.secret);

    const parent = await request(app).get(`/api/tokens/${t.id}`).set(key(t.secret)).expect(200);
    expect(parent.body.child).toEqual({ id: child.id, code: child.code, key: child.secret });
    await request(app).get(`/api/tokens/${child.id}`).set(key(parent.body.child.key)).expect(200);
    await request(app).get(`/api/tokens/${child.id}`).set(key(t.secret)).expect(404);
  });
});
