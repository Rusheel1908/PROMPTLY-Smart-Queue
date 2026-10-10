import type { Appointment, AppointmentStatus, Service, Token, TokenClass } from '@prisma/client';
import {
  APPOINTMENT_CONFIG, appointmentDeadline, bookableSlots, checkInPhase, checkInWindow, dayStart, slotMinutes, type CheckInPhase,
} from '../engine/appointments.js';
import * as clock from '../lib/clock.js';
import { prisma } from '../lib/db.js';
import { fail, must } from '../lib/http.js';
import { newBookingCode, newTokenSecret, safeEqual } from '../lib/secret.js';
import { fmtTime } from '../notify/messages.js';
import { appointmentNotice, notice } from '../notify/notices.js';
import type { TokenEvent } from '../notify/rules.js';
import { admitToken } from './actions.js';
import { moveAppointmentFollowers, notifyLater, recentNotifications, saveSubscription } from './notifier.js';
import type { PushTarget } from './push.js';
import { logEvent, publicToken, replan, serial, startOfDay } from './queue.js';

const cfg = APPOINTMENT_CONFIG;

/** Statuses that hold a place in their slot. A no-show or a cancellation gives it back. */
const HOLDS_SLOT: AppointmentStatus[] = ['BOOKED', 'CHECKED_IN', 'LATE_DOWNGRADED'];

type Full = Appointment & { service: Service; token: Token | null };

const getAppointment = async (where: { id: string } | { code: string }): Promise<Full | null> =>
  prisma.appointment.findUnique({ where, include: { service: true, token: true } });

/** True only for the holder of this booking's link. A missing booking answers the same as a wrong key. */
export async function holdsAppointment(id: string, key: string | undefined) {
  const a = await prisma.appointment.findUnique({ where: { id }, select: { secret: true } });
  return safeEqual(a?.secret, key);
}

/** What the booking page and the appointment link show. Never the secret. */
const view = (a: Appointment, service: Pick<Service, 'name'>) => {
  const { opensAt, closesAt } = checkInWindow(a.slotStart.getTime());
  return {
    id: a.id, code: a.code, serviceId: a.serviceId, serviceName: service.name, slotStart: a.slotStart, status: a.status,
    opensAt: new Date(opensAt), closesAt: new Date(closesAt),
  };
};

/* ---------- booking ---------- */

async function serviceById(serviceId: string) {
  return (await prisma.service.findUnique({ where: { id: serviceId } })) ?? fail(404, 'Unknown service');
}

const placesTaken = async (serviceId: string, starts: number[]) => {
  const groups = await prisma.appointment.groupBy({
    by: ['slotStart'], where: { serviceId, status: { in: HOLDS_SLOT }, slotStart: { in: starts.map((t) => new Date(t)) } }, _count: true,
  });
  return Object.fromEntries(groups.map((g) => [g.slotStart.getTime(), g._count])) as Record<number, number>;
};

/** Today's and tomorrow's slots that can still be booked: check-in window not closed, places left. */
export async function listSlots(serviceId: string) {
  const service = await serviceById(serviceId);
  const starts = bookableSlots(clock.now(), slotMinutes(service.prefix));
  const taken = await placesTaken(serviceId, starts);
  return {
    serviceId, serviceName: service.name, slotMin: slotMinutes(service.prefix), capacity: cfg.capacityPerSlot,
    slots: starts.map((t) => ({ start: new Date(t), left: cfg.capacityPerSlot - (taken[t] ?? 0) })).filter((s) => s.left > 0),
  };
}

async function uniqueCode() {
  for (let i = 0; i < 5; i++) {
    const code = newBookingCode();
    if (!(await prisma.appointment.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  return fail(503, 'Could not create a booking code, try again');
}

export const book = (serviceId: string, slotStart: number) => serial(async () => {
  const service = await serviceById(serviceId);
  must(bookableSlots(clock.now(), slotMinutes(service.prefix)).includes(slotStart), 400, 'That is not an open slot for this service');
  const taken = (await placesTaken(serviceId, [slotStart]))[slotStart] ?? 0;
  must(taken < cfg.capacityPerSlot, 409, 'That slot is full, please pick another');
  const a = await prisma.appointment.create({
    // createdAt on the queue clock (like token arrival), so "booked inside the reminder lead" uses one notion of now
    data: { code: await uniqueCode(), secret: newTokenSecret(), serviceId, slotStart: new Date(slotStart), createdAt: new Date(clock.now()) },
  });
  const seq = await logEvent('APPOINTMENT_BOOKED', { payload: { appointmentId: a.id, serviceId, slotStart: a.slotStart.toISOString() }, actor: 'booking' });
  await replan(`A ${service.name} appointment was booked`, seq); // walk-in promises now count this expected arrival
  // the only response that carries the secret: it becomes the booking link
  return { ...view(a, service), secret: a.secret };
});

export async function appointmentDetail(id: string) {
  const a = (await getAppointment({ id })) ?? fail(404, 'Booking not found');
  return {
    ...view(a, a.service),
    token: a.token && { id: a.token.id, code: a.token.code, key: a.token.secret, state: a.token.state }, // the holder may follow it
    notifications: await recentNotifications({ appointmentId: id }),
  };
}

/* ---------- check-in: the window decides ---------- */

interface Admit { cls: TokenClass; status: AppointmentStatus; deadline: (a: Full) => number | undefined; reason: string; notify?: TokenEvent }

/** Check-in window table: which statuses may check in during each phase, and what they get. EARLY gets no token. */
const CHECK_IN: Record<CheckInPhase, { from: AppointmentStatus[]; admit?: Admit }> = {
  EARLY: { from: ['BOOKED'] },
  ON_TIME: {
    from: ['BOOKED'],
    admit: {
      cls: 'APPOINTMENT', status: 'CHECKED_IN', reason: 'Appointment holder checked in',
      deadline: (a) => appointmentDeadline(a.slotStart.getTime(), a.service.targetWaitS * 1000),
    },
  },
  LATE: {
    from: ['BOOKED', 'NO_SHOW'], // late, even after the sweeper marked it a no-show: still welcome, as a normal customer
    admit: { cls: 'NORMAL', status: 'LATE_DOWNGRADED', reason: 'New customer in a shared queue', deadline: () => undefined, notify: 'APPT_LATE' },
  },
};

const ticketOf = (a: Full, t: Token) => ({ ...publicToken(t, clock.now(), {}), serviceName: a.service.name, secret: t.secret });

async function checkIn(a: Full, actor: string) {
  if (a.token) return { appointment: view(a, a.service), token: ticketOf(a, a.token) }; // already in: the same ticket again
  must(a.status !== 'CANCELLED', 409, 'This booking was cancelled');
  const now = clock.now();
  const slot = a.slotStart.getTime();
  must(dayStart(slot) >= dayStart(now), 410, 'This booking has expired. Please book again or take a normal token');
  const phase = checkInPhase(slot, now);
  const rule = CHECK_IN[phase];
  const { opensAt } = checkInWindow(slot);
  const admit = rule.admit ?? fail(409, `Check-in opens at ${fmtTime(opensAt)}`, { opensAt: new Date(opensAt) });
  must(rule.from.includes(a.status), 409, `This booking is ${a.status.toLowerCase().replace('_', ' ')}`);

  const ticket = await admitToken(a.service, admit.cls, {
    actor, appointmentId: a.id, reason: admit.reason, deadline: admit.deadline(a),
    beforeReplan: async (tokenId) => {
      await prisma.appointment.update({ where: { id: a.id }, data: { status: admit.status, tokenId } });
      await moveAppointmentFollowers(a.id, tokenId); // "Notify me" on the booking keeps working for the token
    },
  });
  await logEvent('APPOINTMENT_CHECKED_IN', { tokenId: ticket.id, payload: { appointmentId: a.id, phase }, actor });
  admit.notify && notifyLater(notice(ticket.id, admit.notify, { code: ticket.code, missCount: 0, notBefore: new Date(now) }));
  const saved = (await getAppointment({ id: a.id }))!;
  return { appointment: view(saved, saved.service), token: ticket };
}

/** From the booking link (the caller proved the key). */
export const checkInById = (id: string) => serial(async () =>
  checkIn((await getAppointment({ id })) ?? fail(404, 'Booking not found'), 'booking-link'));

/** "BK-7k3 q9p", "bk7K3Q9P" → "BK-7K3Q9P". */
export const normalizeCode = (raw: string) => {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `BK-${s.startsWith('BK') ? s.slice(2) : s}`;
};

/** At the kiosk, by booking code. Null for an unknown code (the route counts it as a failed guess). */
export const checkInByCode = (code: string) => serial(async () => {
  const a = await getAppointment({ code: normalizeCode(code) });
  return a ? checkIn(a, 'kiosk') : null;
});

/* ---------- staff ---------- */

export const cancelAppointment = (id: string, actor: string) => serial(async () => {
  const a = (await getAppointment({ id })) ?? fail(404, 'Booking not found');
  must(a.status === 'BOOKED', 409, `Only a booking that has not checked in can be cancelled (this one is ${a.status.toLowerCase().replace('_', ' ')})`);
  await prisma.appointment.update({ where: { id }, data: { status: 'CANCELLED' } });
  const seq = await logEvent('APPOINTMENT_CANCELLED', { payload: { appointmentId: id }, actor });
  notifyLater(appointmentNotice({ id, slotStart: a.slotStart, serviceName: a.service.name }, 'APPT_CANCELLED'));
  await replan('A booked appointment was cancelled', seq);
  return { ok: true };
});

const STATUSES: AppointmentStatus[] = ['BOOKED', 'CHECKED_IN', 'LATE_DOWNGRADED', 'NO_SHOW', 'CANCELLED'];

/** Today's bookings for Ops, with a count per status. Staff see the codes, to help customers at the desk. */
export async function todaysAppointments() {
  const from = startOfDay();
  const rows = await prisma.appointment.findMany({
    where: { slotStart: { gte: from, lt: new Date(dayStart(from.getTime(), 1)) } },
    include: { service: { select: { name: true } }, token: { select: { code: true, state: true } } },
    orderBy: [{ slotStart: 'asc' }, { createdAt: 'asc' }],
  });
  return {
    counts: Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<AppointmentStatus, number>,
    appointments: rows.map((r) => ({
      id: r.id, code: r.code, serviceName: r.service.name, slotStart: r.slotStart, status: r.status,
      tokenCode: r.token?.code ?? null, tokenState: r.token?.state ?? null,
    })),
  };
}

/* ---------- push for a booking ---------- */

export async function followAppointment(id: string, sub: PushTarget) {
  const a = (await prisma.appointment.findUnique({ where: { id }, select: { status: true } })) ?? fail(404, 'Booking not found');
  must(a.status === 'BOOKED', 409, 'This booking is no longer waiting for check-in');
  return saveSubscription({ appointmentId: id }, sub);
}

/* ---------- sweeper: reminders, no-shows, cleanup ---------- */

/** One pass. Exported so tests can run it after moving the clock. Call inside serial(). */
export async function sweepAppointments() {
  const now = clock.now();
  await sendReminders(now);
  const missed = await markNoShows(now);
  // phones that followed a booking which is over (cancelled, or a past day without check-in) stop following it
  await prisma.pushSubscription.deleteMany({
    where: { appointment: { OR: [{ status: 'CANCELLED' }, { slotStart: { lt: startOfDay() } }] } },
  });
  missed && await replan(missed === 1 ? 'A booked customer did not arrive' : `${missed} booked customers did not arrive`);
}

/** Once per booking, `reminderLeadMs` before the slot; not for bookings made inside that lead (they just booked). */
async function sendReminders(now: number) {
  const due = await prisma.appointment.findMany({
    where: { status: 'BOOKED', remindedAt: null, slotStart: { gt: new Date(now), lte: new Date(now + cfg.reminderLeadMs) } },
    include: { service: { select: { name: true } } },
  });
  for (const a of due.filter((x) => x.createdAt.getTime() < x.slotStart.getTime() - cfg.reminderLeadMs)) {
    const { count } = await prisma.appointment.updateMany({ where: { id: a.id, remindedAt: null }, data: { remindedAt: new Date(now) } });
    count && notifyLater(appointmentNotice({ id: a.id, slotStart: a.slotStart, serviceName: a.service.name }, 'APPT_REMINDER'));
  }
}

/** The check-in window closed without a check-in: NO_SHOW, which gives the place back. */
async function markNoShows(now: number) {
  const late = await prisma.appointment.findMany({
    where: { status: 'BOOKED', slotStart: { lt: new Date(now - cfg.checkIn.closesAfterMs) } },
    include: { service: { select: { name: true } } },
  });
  let marked = 0;
  for (const a of late) {
    const { count } = await prisma.appointment.updateMany({ where: { id: a.id, status: 'BOOKED' }, data: { status: 'NO_SHOW' } });
    if (!count) continue;
    marked++;
    await logEvent('APPOINTMENT_NO_SHOW', { payload: { appointmentId: a.id }, actor: 'system' });
    notifyLater(appointmentNotice({ id: a.id, slotStart: a.slotStart, serviceName: a.service.name }, 'APPT_MISSED'));
  }
  return marked;
}
