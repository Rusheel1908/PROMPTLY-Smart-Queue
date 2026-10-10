import request from 'supertest';
import type { StaffRole, TokenClass } from '@prisma/client';
import { setNow } from '../src/lib/clock.js';
import { prisma } from '../src/lib/db.js';
import { hashPin } from '../src/lib/secret.js';
import { createSession } from '../src/services/auth.js';
import { flushNotifications } from '../src/services/notifier.js';

type App = Parameters<typeof request>[0];

export const key = (k: string) => ({ 'x-token-key': k });

/** Test accounts, recreated by every resetDb. The PINs exist only in tests. */
export const STAFF = {
  asha: { name: 'Asha', role: 'SUPERVISOR', pin: '246810' },
  ravi: { name: 'Ravi', role: 'STAFF', pin: '135791' },
  meera: { name: 'Meera', role: 'STAFF', pin: '112233' },
} as const satisfies Record<string, { name: string; role: StaffRole; pin: string }>;
export type Who = keyof typeof STAFF;

/** scrypt is slow on purpose; hash each test PIN once per run. */
const hashes = new Map<string, Promise<string>>();
const hashOnce = (pin: string) => hashes.get(pin) ?? hashes.set(pin, hashPin(pin)).get(pin)!;

/** Bearer tokens of the sessions opened by the last resetDb. */
const tokens: Partial<Record<Who, string>> = {};

/** The Authorization header of a logged-in staff member (Asha, the supervisor, by default). */
export const as = (who: Who = 'asha') => ({ Authorization: `Bearer ${tokens[who] ?? 'no-session'}` });

/** Create the three staff accounts and log each in (the same session the login route opens after the PIN check). */
async function seedStaff() {
  const ids = {} as Record<Who, string>;
  for (const [who, s] of Object.entries(STAFF) as [Who, (typeof STAFF)[Who]][]) {
    const row = await prisma.staff.create({ data: { name: s.name, role: s.role, pinHash: await hashOnce(s.pin) } });
    ids[who] = row.id;
    tokens[who] = (await createSession(row.id)).token;
  }
  return ids;
}

/** Empty queue with two services and one counter that handles both, plus logged-in staff. */
export async function resetDb() {
  await flushNotifications(); // the last test's background notifications must not land in this one's database
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Appointment", "NotificationLog", "PushSubscription", "EtaChange", "Event", "Token", "CounterSkill", "Counter", "Service", "Session", "Staff" RESTART IDENTITY CASCADE',
  );
  const [deposits, loans] = await Promise.all([
    prisma.service.create({ data: { prefix: 'D', name: 'Deposits', targetWaitS: 900, priorMu: Math.log(4), priorSigma: 0.5 } }),
    prisma.service.create({ data: { prefix: 'L', name: 'Loans', targetWaitS: 1800, priorMu: Math.log(12), priorSigma: 0.5 } }),
  ]);
  const counter = await addCounter('Counter 1', [deposits.id, loans.id]);
  const staff = await seedStaff();
  return { deposits, loans, counter, staff };
}

export const addCounter = (name: string, serviceIds: string[]) =>
  prisma.counter.create({ data: { name, skills: { create: serviceIds.map((serviceId) => ({ serviceId })) } } });

/** Issue a token over HTTP. Non-normal classes are issued by staff, as the kiosk may not self-select them. */
export async function issue(app: App, serviceId: string, cls: TokenClass = 'NORMAL') {
  const req = request(app).post('/api/tokens');
  const res = await (cls === 'NORMAL' ? req : req.set(as())).send({ serviceId, class: cls }).expect(201);
  return res.body as { id: string; code: string; secret: string; promiseP90: string | null; unavailable: boolean };
}

/** Requests made by a logged-in staff member (Asha, the supervisor, by default). */
export const staff = (app: App, who: Who = 'asha') => ({
  get: (url: string) => request(app).get(url).set(as(who)),
  post: (url: string, body: object = {}) => request(app).post(url).set(as(who)).send(body),
  patch: (url: string, body: object) => request(app).patch(url).set(as(who)).send(body),
});

/** Counter console action, e.g. counter(app, id, 'call-next') or counter(app, id, 'miss', {}, 'ravi'). */
export const counter = (app: App, counterId: string, action: string, body: object = {}, who: Who = 'asha') =>
  staff(app, who).post(`/api/counters/${counterId}/${action}`, body);

/** Freeze queue time at the real "now" and move it forward by hand. Call restore() in afterEach. */
export function fakeClock() {
  let t = Date.now();
  setNow(() => t);
  return { advance: (ms: number) => { t += ms; }, now: () => t, restore: () => setNow() };
}

export const tokenRow = (id: string) => prisma.token.findUniqueOrThrow({ where: { id } });
