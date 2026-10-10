import request from 'supertest';
import { prisma } from '../src/lib/db.js';

type App = Parameters<typeof request>[0];

export const PIN = { 'x-staff-pin': '1234' };
export const key = (k: string) => ({ 'x-token-key': k });

/** Empty queue with two services and one counter that handles both. */
export async function resetDb() {
  await prisma.$executeRawUnsafe('TRUNCATE "EtaChange", "Event", "Token", "CounterSkill", "Counter", "Service" RESTART IDENTITY CASCADE');
  const [deposits, loans] = await Promise.all([
    prisma.service.create({ data: { prefix: 'D', name: 'Deposits', targetWaitS: 900, priorMu: Math.log(4), priorSigma: 0.5 } }),
    prisma.service.create({ data: { prefix: 'L', name: 'Loans', targetWaitS: 1800, priorMu: Math.log(12), priorSigma: 0.5 } }),
  ]);
  const counter = await prisma.counter.create({
    data: { name: 'Counter 1', skills: { create: [{ serviceId: deposits.id }, { serviceId: loans.id }] } },
  });
  return { deposits, loans, counter };
}

export async function issue(app: App, serviceId: string) {
  const res = await request(app).post('/api/tokens').send({ serviceId }).expect(201);
  return res.body as { id: string; code: string; secret: string };
}
