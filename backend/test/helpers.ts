import request from 'supertest';
import type { TokenClass } from '@prisma/client';
import { setNow } from '../src/lib/clock.js';
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
  const counter = await addCounter('Counter 1', [deposits.id, loans.id]);
  return { deposits, loans, counter };
}

export const addCounter = (name: string, serviceIds: string[]) =>
  prisma.counter.create({ data: { name, skills: { create: serviceIds.map((serviceId) => ({ serviceId })) } } });

/** Issue a token over HTTP. Non-normal classes are issued by staff, as the kiosk may not self-select them. */
export async function issue(app: App, serviceId: string, cls: TokenClass = 'NORMAL') {
  const req = request(app).post('/api/tokens');
  const res = await (cls === 'NORMAL' ? req : req.set(PIN)).send({ serviceId, class: cls }).expect(201);
  return res.body as { id: string; code: string; secret: string; promiseP90: string | null; unavailable: boolean };
}

/** Requests that carry the staff PIN. */
export const staff = (app: App) => ({
  get: (url: string) => request(app).get(url).set(PIN),
  post: (url: string, body: object = {}) => request(app).post(url).set(PIN).send(body),
  patch: (url: string, body: object) => request(app).patch(url).set(PIN).send(body),
});

/** Counter console action, e.g. counter(app, id, 'call-next'). */
export const counter = (app: App, counterId: string, action: string, body: object = {}) =>
  staff(app).post(`/api/counters/${counterId}/${action}`, body);

/** Freeze queue time at the real "now" and move it forward by hand. Call restore() in afterEach. */
export function fakeClock() {
  let t = Date.now();
  setNow(() => t);
  return { advance: (ms: number) => { t += ms; }, now: () => t, restore: () => setNow() };
}

export const tokenRow = (id: string) => prisma.token.findUniqueOrThrow({ where: { id } });
