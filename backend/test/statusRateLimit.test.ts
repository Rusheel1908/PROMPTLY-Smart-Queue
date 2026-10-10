import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { RATE_LIMITS } from '../src/config.js';
import { prisma } from '../src/lib/db.js';
import { key, resetDb } from './helpers.js';

// own file: the rate limiters are per-module, so the limits used up here don't leak into other test files
const app = createApp();
let tokens: { id: string; secret: string }[];

beforeAll(async () => {
  const { deposits } = await resetDb();
  // straight into the table: issuing 31 tokens over HTTP would hit the issue limit, which is not under test here
  tokens = await Promise.all(Array.from({ length: 31 }, (_, i) => prisma.token.create({
    data: { code: `D-${i + 1}`, serviceId: deposits.id, secret: randomBytes(24).toString('base64url'), deadline: new Date(Date.now() + 15 * 60_000) },
    select: { id: true, secret: true },
  })));
});
afterAll(() => prisma.$disconnect());

const read = (t: { id: string }, k: string) => request(app).get(`/api/tokens/${t.id}`).set(key(k));

describe('status read rate limit', () => {
  it('30 phones behind one IP, each with its own valid key, never get 429 (more reads in total than the per-IP limit)', async () => {
    const phones = tokens.slice(0, 30);
    const perPhone = Math.ceil(RATE_LIMITS.tokenDetail.max / phones.length) + 1; // 150 reads in all vs a per-IP max of 120
    const statuses: number[] = [];
    for (let round = 0; round < perPhone; round++) {
      for (const t of phones) statuses.push((await read(t, t.secret)).status);
    }
    expect(statuses.length).toBeGreaterThan(RATE_LIMITS.tokenDetail.max);
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
  });

  it('wrong keys are still capped per IP: 404 until the limit, then 429', async () => {
    const t = tokens[30];
    const { max } = RATE_LIMITS.tokenDetail;
    for (let i = 0; i < max; i++) await read(t, 'wrong-key').expect(404);
    await read(t, 'wrong-key').expect(429);
    await read(t, t.secret).expect(200); // the IP is capped for guesses, not for the real holder
  });

  it('one key on its own is limited per token', async () => {
    const t = tokens[30];
    const { max } = RATE_LIMITS.tokenDetailPerKey;
    for (let i = 1; i < max; i++) await read(t, t.secret).expect(200); // one read already used above
    await read(t, t.secret).expect(429);
  });
});
