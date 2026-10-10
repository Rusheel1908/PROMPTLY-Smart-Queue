import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { dayStart } from '../src/engine/appointments.js';
import { MIN } from '../src/engine/types.js';
import { setNow } from '../src/lib/clock.js';
import { resetRateLimits } from '../src/lib/http.js';
import { prisma } from '../src/lib/db.js';
import { flushNotifications } from '../src/services/notifier.js';
import { configurePush, setPushSender, type PushPayload } from '../src/services/push.js';
import { replan, serial } from '../src/services/queue.js';
import { sweepAppointments } from '../src/services/appointments.js';
import { as, key, resetDb, staff } from './helpers.js';

const app = createApp();
let world: Awaited<ReturnType<typeof resetDb>>;

/** Queue time: tomorrow at a given hh:mm, so slots and windows never depend on when the tests run. */
let t = 0;
const at = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return new Date(dayStart(Date.now(), 1)).setHours(h, m, 0, 0); };
const clockAt = (hhmm: string) => { t = at(hhmm); };

let sent: PushPayload[] = [];
beforeEach(async () => {
  clockAt('10:00');
  setNow(() => t); // before resetDb, so the staff sessions it opens are valid on this clock
  world = await resetDb();
  resetRateLimits(); // each case books afresh; the limits themselves are tested below
  sent = [];
  configurePush({ publicKey: 'BPublicKeyForTests', privateKey: 'privateKeyForTests', subject: 'mailto:test@example.com' });
  setPushSender(async (_t, payload) => { sent.push(JSON.parse(payload)); });
});
afterEach(async () => { await flushNotifications(); setNow(); configurePush(null); setPushSender(); });
afterAll(() => prisma.$disconnect());

type Booking = { id: string; code: string; secret: string; slotStart: string; status: string };
const book = (hhmm: string, serviceId = world.deposits.id) =>
  request(app).post('/api/appointments').send({ serviceId, slotStart: new Date(at(hhmm)).toISOString() });
const booked = async (hhmm: string) => (await book(hhmm).expect(201)).body as Booking;
const apptKey = (k: string) => ({ 'x-appointment-key': k });
const checkIn = (b: Booking) => request(app).post(`/api/appointments/${b.id}/check-in`).set(apptKey(b.secret)).send({});
const sweep = async () => { await serial(sweepAppointments); await flushNotifications(); };
const row = (id: string) => prisma.appointment.findUniqueOrThrow({ where: { id } });
const notes = async (where: { tokenId?: string; appointmentId?: string }) =>
  (await prisma.notificationLog.findMany({ where, orderBy: { id: 'asc' } })).map((n) => n.event);
const subscribe = (b: Booking, n = 1) => request(app).post(`/api/appointments/${b.id}/push`).set(apptKey(b.secret))
  .send({ endpoint: `https://fcm.googleapis.com/fcm/send/appt-${n}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' } });

describe('booking', () => {
  it('returns a code and the secret once; reading or acting on it needs the secret', async () => {
    const b = await booked('10:30');
    expect(b).toMatchObject({ code: expect.stringMatching(/^BK-[A-HJ-NP-Z2-9]{6}$/), status: 'BOOKED', secret: expect.any(String) });
    for (const headers of [{}, apptKey('wrong'), as()]) {
      await request(app).get(`/api/appointments/${b.id}`).set(headers).expect(404);
      await request(app).post(`/api/appointments/${b.id}/check-in`).set(headers).send({}).expect(404);
    }
    await subscribe({ ...b, secret: 'wrong' }).expect(404);
    const r = await request(app).get(`/api/appointments/${b.id}`).set(apptKey(b.secret)).expect(200);
    expect(r.body).toMatchObject({ code: b.code, serviceName: 'Deposits', opensAt: new Date(at('10:15')).toISOString() });
    expect(r.body).not.toHaveProperty('secret');
  });

  it('capacity per slot is enforced; a cancelled booking gives its place back', async () => {
    await booked('10:30');
    const second = await booked('10:30');
    await book('10:30').expect(409, { error: 'That slot is full, please pick another' });
    const slots = await request(app).get('/api/appointments/slots').query({ serviceId: world.deposits.id }).expect(200);
    expect(slots.body.slots.map((s: { start: string }) => s.start)).not.toContain(new Date(at('10:30')).toISOString());

    await staff(app).post(`/api/appointments/${second.id}/cancel`).expect(200);
    await booked('10:30');
  });

  it('only real open slots: off-grid, closed windows and unknown services are refused', async () => {
    await book('10:07').expect(400);
    await book('09:45').expect(400); // its window closed at 09:55
    await book('10:00').expect(201); // window open until 10:10
    await book('10:30', 'nope').expect(404);
  });
});

describe('check-in window', () => {
  it('too early: "Check-in opens at 10:15" with the time, and no token', async () => {
    const b = await booked('10:30');
    const r = await checkIn(b).expect(409);
    expect(r.body).toEqual({ error: 'Check-in opens at 10:15', opensAt: new Date(at('10:15')).toISOString() });
    expect(await prisma.token.count()).toBe(0);
  });

  it('on time: APPOINTMENT token with a deadline anchored to the slot; push moves to the token; repeating is safe', async () => {
    const b = await booked('10:30');
    await subscribe(b).expect(201);
    clockAt('10:20');
    const r = await checkIn(b).expect(200);
    expect(r.body.appointment.status).toBe('CHECKED_IN');
    expect(r.body.token).toMatchObject({ class: 'APPOINTMENT', state: 'WAITING', secret: expect.any(String) });
    expect(new Date(r.body.token.deadline).getTime()).toBe(at('10:30') + 3 * MIN); // 0.2 × 15 min target
    expect(await prisma.pushSubscription.findFirst()).toMatchObject({ tokenId: r.body.token.id, appointmentId: null });
    const issued = await prisma.event.findFirstOrThrow({ where: { type: 'TOKEN_ISSUED', tokenId: r.body.token.id } });
    expect(issued.payload).toMatchObject({ appointmentId: b.id, class: 'APPOINTMENT' });

    const again = await checkIn(b).expect(200);
    expect(again.body.token.id).toBe(r.body.token.id);
    expect(await prisma.token.count()).toBe(1);
  });

  it('at the kiosk by code: any case or spacing; unknown codes → 404, and many wrong guesses → 429', async () => {
    const b = await booked('10:30');
    clockAt('10:15');
    const r = await request(app).post('/api/appointments/check-in').send({ code: ` ${b.code.slice(3).toLowerCase()} ` }).expect(200);
    expect(r.body.token.class).toBe('APPOINTMENT');
    for (let i = 0; i < 10; i++) await request(app).post('/api/appointments/check-in').send({ code: 'BK-AAAAAA' }).expect(404);
    await request(app).post('/api/appointments/check-in').send({ code: b.code }).expect(429);
  });

  it('late: a NORMAL token, the reason on the status page, and one notification', async () => {
    const b = await booked('10:30');
    clockAt('10:41');
    const r = await checkIn(b).expect(200);
    expect(r.body.appointment.status).toBe('LATE_DOWNGRADED');
    expect(r.body.token.class).toBe('NORMAL');
    await flushNotifications();
    const status = await request(app).get(`/api/tokens/${r.body.token.id}`).set(key(r.body.token.secret)).expect(200);
    expect(status.body.appointment).toMatchObject({ status: 'LATE_DOWNGRADED', note: 'Arrived after your check-in window' });
    expect(status.body.notifications.find((n: { event: string }) => n.event === 'APPT_LATE'))
      .toMatchObject({ body: 'Arrived after your check-in window, so appointment priority no longer applies.' });
    expect((await notes({ tokenId: r.body.token.id })).filter((e) => e === 'APPT_LATE')).toHaveLength(1);
  });
});

describe('sweeper', () => {
  it('window closes without check-in → NO_SHOW, place released, "You missed…" once; a late arrival still gets in', async () => {
    const b = await booked('10:30');
    await booked('10:30');
    await subscribe(b).expect(201);
    clockAt('10:40');
    await sweep();
    expect((await row(b.id)).status).toBe('BOOKED'); // the window's last moment

    clockAt('10:41');
    await sweep();
    await sweep();
    expect((await row(b.id)).status).toBe('NO_SHOW');
    expect(await notes({ appointmentId: b.id })).toEqual(['APPT_MISSED']); // no sweep ran before the slot, so no reminder
    expect(sent.filter((p) => p.title === 'You missed your appointment at 10:30')).toHaveLength(1);
    expect(sent.find((p) => p.title.startsWith('You missed'))).toMatchObject({ body: 'Book again or take a normal token.', url: `/appointment/${b.id}?k=${encodeURIComponent(b.secret)}` });
    const taken = await prisma.appointment.count({ where: { slotStart: new Date(at('10:30')), status: { in: ['BOOKED', 'CHECKED_IN', 'LATE_DOWNGRADED'] } } });
    expect(taken).toBe(0); // the second one was a no-show too

    const late = await checkIn(b).expect(200);
    expect(late.body).toMatchObject({ appointment: { status: 'LATE_DOWNGRADED' }, token: { class: 'NORMAL' } });
  });

  it('reminder: once, 15 min before; not for a booking made inside that lead', async () => {
    const early = await booked('10:30');
    clockAt('10:20');
    const lastMinute = await booked('10:30');
    clockAt('10:14');
    await sweep();
    expect(await notes({ appointmentId: early.id })).toEqual([]);
    clockAt('10:20');
    await sweep();
    await sweep();
    expect(await notes({ appointmentId: early.id })).toEqual(['APPT_REMINDER']);
    expect(await notes({ appointmentId: lastMinute.id })).toEqual([]);
    const r = await request(app).get(`/api/appointments/${early.id}`).set(apptKey(early.secret)).expect(200);
    expect(r.body.notifications[0]).toMatchObject({ title: 'Your Deposits appointment is at 10:30', body: expect.stringContaining('Check in from 10:15') });
  });
});

describe('forecast', () => {
  it("bookings about to arrive make a walk-in's quote later", async () => {
    const quote = async () => {
      await replan('tick');
      const s = await request(app).get('/api/snapshot').expect(200);
      return s.body.services.find((x: { id: string }) => x.id === world.deposits.id).quote.p50Min as number;
    };
    const before = await quote();
    for (const slot of ['10:00', '10:00', '10:15', '10:15']) await booked(slot);
    expect(await quote()).toBeGreaterThan(before + 2);
  });
});

describe('staff', () => {
  it("today's list with counts; cancelling needs a session, notifies, and only applies to a booking not yet in", async () => {
    clockAt('09:00'); // the list is "today" on the queue clock
    const a = await booked('10:30');
    const b = await booked('10:45');
    await request(app).get('/api/ops/appointments').expect(401);
    await request(app).post(`/api/appointments/${a.id}/cancel`).expect(401);
    await staff(app, 'ravi').post(`/api/appointments/${a.id}/cancel`).expect(200);
    await staff(app).post(`/api/appointments/${a.id}/cancel`).expect(409);
    await flushNotifications();
    expect(await notes({ appointmentId: a.id })).toEqual(['APPT_CANCELLED']);

    const list = await staff(app, 'ravi').get('/api/ops/appointments').expect(200);
    expect(list.body.counts).toMatchObject({ BOOKED: 1, CANCELLED: 1, CHECKED_IN: 0 });
    expect(list.body.appointments.map((x: { code: string }) => x.code)).toEqual([a.code, b.code]);
  });

  it('demo reset leaves exactly one booking', async () => {
    await booked('10:30');
    await staff(app).post('/api/demo/reset').expect(200);
    expect(await prisma.appointment.count()).toBe(1);
    expect(await prisma.appointment.findFirst()).toMatchObject({ status: 'BOOKED' });
  });
});
