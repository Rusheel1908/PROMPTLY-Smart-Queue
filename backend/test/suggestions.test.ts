import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { addCounter, issue, resetDb, staff } from './helpers.js';
import { dbState, loansStranded, SUGGESTIONS } from './suggestionHelpers.js';

const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;
let counter2: Awaited<ReturnType<typeof addCounter>>;

beforeEach(async () => {
  world = await resetDb(); // Counter 1: Deposits + Loans
  counter2 = await addCounter('Counter 2', [world.deposits.id]);
});
afterAll(() => prisma.$disconnect());

const get = () => staff(app).get(SUGGESTIONS).expect(200).then((r) => r.body);

describe('access', () => {
  it('both routes need the staff PIN', async () => {
    await request(app).get(SUGGESTIONS).expect(401);
    await request(app).post(`${SUGGESTIONS}/anything/apply`).expect(401);
  });
});

describe('suggestions', () => {
  it('when the only Loans counter closes, the top suggestion restores Loans capacity', async () => {
    await loansStranded(app, world);
    const body = await get();
    const [top] = body.suggestions;
    // closed just now, so no "reopen Counter 1" (cooldown): Loans goes to Counter 2
    expect(top.change).toMatchObject({ kind: 'add-skill', counterId: counter2.id, serviceId: world.loans.id });
    expect(top.id).toBe(`add-skill:${counter2.id}:${world.loans.id}`);
    expect(top.explanation).toMatch(/^Add Loans to Counter 2 → .*3 customers can be served again/);
    expect(top.numbers.newlyServable).toBe(3);
    expect(top.bar).toMatchObject({ serviceName: 'Loans', beforeMin: null });
    expect(body.suggestions.length).toBeLessThanOrEqual(3);
    expect(body.timing).toMatchObject({ waiting: 6, candidates: expect.any(Number), totalMs: expect.any(Number) });
  });

  it('nothing helps → no suggestions', async () => {
    await issue(app, world.deposits.id);
    expect((await get()).suggestions).toEqual([]);
  });

  it('computing suggestions writes nothing to the database', async () => {
    await loansStranded(app, world);
    const before = await dbState();
    expect((await get()).suggestions.length).toBeGreaterThan(0);
    expect(await dbState()).toEqual(before);
  });
});
