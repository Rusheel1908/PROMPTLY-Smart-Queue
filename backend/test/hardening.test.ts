import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { RATE_LIMITS } from '../src/config.js';
import { prisma } from '../src/lib/db.js';
import { resetDb, STAFF } from './helpers.js';

// own file: the rate limiters are per-module, so the limits used up here don't leak into other test files
const app = createApp();
afterAll(() => prisma.$disconnect());

describe('login rate limit', () => {
  it('failed logins from one IP answer 429 once the limit is used up, even for the right PIN', async () => {
    const { staff } = await resetDb();
    const { max } = RATE_LIMITS.login;
    // spread over unknown ids, so no single account locks first
    for (let i = 0; i < max; i++) await request(app).post('/api/auth/login').send({ staffId: `nobody-${i}`, pin: '000000' }).expect(401);
    const r = await request(app).post('/api/auth/login').send({ staffId: staff.ravi, pin: STAFF.ravi.pin }).expect(429);
    expect(r.body).toEqual({ error: 'Too many requests, please slow down' });
  });
});

describe('rate limits', () => {
  it('a public route answers 429 once its limit is used up', async () => {
    const { max } = RATE_LIMITS.tokenAction;
    const send = () => request(app).post('/api/tokens/does-not-exist/cancel').send({});
    for (let i = 0; i < max; i++) await send().expect(404);
    const r = await send().expect(429);
    expect(r.body).toEqual({ error: 'Too many requests, please slow down' });
  });
});

describe('hardening', () => {
  it('unknown /api route → JSON 404', async () => {
    const r = await request(app).get('/api/nope/nothing').expect(404);
    expect(r.headers['content-type']).toMatch(/json/);
    expect(r.body).toEqual({ error: 'Not found' });
  });

  it('oversized JSON body → 413', async () => {
    const r = await request(app).post('/api/tokens').send({ serviceId: 'x'.repeat(25 * 1024) }).expect(413);
    expect(r.body.error).toMatch(/too large/i);
  });

  it('malformed JSON → 400, not 500', async () => {
    await request(app).post('/api/tokens').set('content-type', 'application/json').send('{"oops"').expect(400);
  });

  it('sends security headers and CORS only for configured origins', async () => {
    const ok = await request(app).get('/api/health').set('origin', 'http://localhost:5173').expect(200);
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const other = await request(app).get('/api/health').set('origin', 'https://evil.example').expect(200);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});
