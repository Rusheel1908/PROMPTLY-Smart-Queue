import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { DEMO_COUNTERS } from '../src/demo/dataset.js';
import { prisma } from '../src/lib/db.js';
import { addCounter, issue, resetDb, staff } from './helpers.js';

const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;

beforeEach(async () => { world = await resetDb(); });
afterAll(() => prisma.$disconnect());

/** Counter name → its service prefixes, sorted, as stored. */
async function layout() {
  const counters = await prisma.counter.findMany({ include: { skills: { include: { service: true } } } });
  return Object.fromEntries(counters.map((c) => [c.name, c.skills.map((k) => k.service.prefix).sort().join('')]));
}

const seeded = Object.fromEntries(DEMO_COUNTERS.map((c) => [c.name, [...c.skills].sort().join('')]));
const idOf = async (name: string) => (await prisma.counter.findFirstOrThrow({ where: { name } })).id;
const serviceId = async (prefix: string) => (await prisma.service.findUniqueOrThrow({ where: { prefix } })).id;

describe('Reset demo', () => {
  it('puts counter skills changed during a demo back to the seeded layout, and reopens every counter', async () => {
    await staff(app).post('/api/demo/reset').expect(200);
    expect(await layout()).toEqual(seeded);

    // a demo run: an applied suggestion adds Loans to Counter 5, Counter 3 closes, Counter 1 loses Enquiry
    const [d, l, e, c] = await Promise.all(['D', 'L', 'E', 'C'].map(serviceId));
    await staff(app).patch(`/api/counters/${await idOf('Counter 5')}`, { skills: [e, c, l] }).expect(200);
    await staff(app).patch(`/api/counters/${await idOf('Counter 3')}`, { status: 'CLOSED' }).expect(200);
    await staff(app).patch(`/api/counters/${await idOf('Counter 1')}`, { skills: [d] }).expect(200);
    await issue(app, d);
    expect(await layout()).not.toEqual(seeded);

    await staff(app).post('/api/demo/reset').expect(200);
    expect(await layout()).toEqual(seeded);
    expect(await prisma.counter.count({ where: { status: { not: 'OPEN' } } })).toBe(0);
    expect(await prisma.token.count()).toBe(0);
  });

  it('leaves counters outside the demo dataset alone', async () => {
    await addCounter('Counter 9', [world.loans.id]);
    await staff(app).post('/api/demo/reset').expect(200);
    expect((await layout())['Counter 9']).toBe('L');
  });
});
