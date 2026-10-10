import request from 'supertest';
import { prisma } from '../src/lib/db.js';
import { issue, resetDb, staff } from './helpers.js';

type App = Parameters<typeof request>[0];
type World = Awaited<ReturnType<typeof resetDb>>;

export const SUGGESTIONS = '/api/ops/suggestions';

/** Three Loans and three Deposits customers, then the only Loans counter (Counter 1) closes. */
export async function loansStranded(app: App, world: World) {
  for (let i = 0; i < 3; i++) await issue(app, world.loans.id);
  for (let i = 0; i < 3; i++) await issue(app, world.deposits.id);
  await staff(app).patch(`/api/counters/${world.counter.id}`, { status: 'CLOSED' }).expect(200);
}

/** Everything a suggestion could conceivably touch. */
export const dbState = async () => ({
  tokens: await prisma.token.findMany({ orderBy: { seq: 'asc' } }),
  events: await prisma.event.findMany({ orderBy: { seq: 'asc' } }),
  etaChanges: await prisma.etaChange.count(),
  counters: await prisma.counter.findMany({ include: { skills: { orderBy: { serviceId: 'asc' } } }, orderBy: { name: 'asc' } }),
  services: await prisma.service.findMany({ orderBy: { prefix: 'asc' } }),
});
