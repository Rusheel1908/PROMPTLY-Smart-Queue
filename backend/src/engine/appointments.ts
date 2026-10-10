import { CLASS_FACTOR, MIN } from './types.js';

/** Appointment booking: every number in one place. Times of day are in the server's time zone (TZ). */
export const APPOINTMENT_CONFIG = {
  slotMin: { D: 15, L: 30, E: 10, C: 20 } as Record<string, number>, // slot length per service prefix
  defaultSlotMin: 15,
  capacityPerSlot: 2,
  hours: { open: 9, close: 17 }, // slots offered today and tomorrow between these hours
  bookingDays: 2, // today and tomorrow
  checkIn: { opensBeforeMs: 15 * MIN, closesAfterMs: 10 * MIN },
  reminderLeadMs: 15 * MIN,
  showUpRate: 0.85, // forecast weight of a booked, not-yet-arrived slot
};
export type AppointmentConfig = typeof APPOINTMENT_CONFIG;

export type CheckInPhase = 'EARLY' | 'ON_TIME' | 'LATE';

/** What a checked-in token's status page says about its booking (Prisma's AppointmentStatus values). */
export const APPOINTMENT_NOTE: Record<string, string | null> = {
  BOOKED: null,
  CHECKED_IN: 'Checked in for your appointment',
  LATE_DOWNGRADED: 'Arrived after your check-in window',
  NO_SHOW: null,
  CANCELLED: null,
};

export const checkInWindow = (slotStart: number, cfg = APPOINTMENT_CONFIG) => ({
  opensAt: slotStart - cfg.checkIn.opensBeforeMs,
  closesAt: slotStart + cfg.checkIn.closesAfterMs,
});

/** Before the window, inside it (both ends included), or after it. */
export function checkInPhase(slotStart: number, now: number, cfg = APPOINTMENT_CONFIG): CheckInPhase {
  const { opensAt, closesAt } = checkInWindow(slotStart, cfg);
  return now < opensAt ? 'EARLY' : now <= closesAt ? 'ON_TIME' : 'LATE';
}

export const slotMinutes = (prefix: string, cfg = APPOINTMENT_CONFIG) => cfg.slotMin[prefix] ?? cfg.defaultSlotMin;

/** Local midnight of the day containing `ms`, `plusDays` later. */
export const dayStart = (ms: number, plusDays = 0) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + plusDays);
  return d.getTime();
};

export const sameDay = (a: number, b: number) => dayStart(a) === dayStart(b);

/** Slot starts of one day: from opening, every slot length, ending no later than closing. */
export function daySlots(day: number, slotMin: number, cfg = APPOINTMENT_CONFIG): number[] {
  const open = new Date(day).setHours(cfg.hours.open, 0, 0, 0);
  const close = new Date(day).setHours(cfg.hours.close, 0, 0, 0);
  const count = Math.floor((close - open) / (slotMin * MIN));
  return Array.from({ length: count }, (_, i) => open + i * slotMin * MIN);
}

/** Slots a customer can still book (today and tomorrow): any whose check-in window has not closed. */
export function bookableSlots(now: number, slotMin: number, cfg = APPOINTMENT_CONFIG): number[] {
  return Array.from({ length: cfg.bookingDays }, (_, d) => daySlots(dayStart(now, d), slotMin, cfg))
    .flat()
    .filter((t) => checkInWindow(t, cfg).closesAt >= now); // the window's last moment still counts
}

/** An on-time appointment's deadline is anchored to its slot, not to when the customer walked in. */
export const appointmentDeadline = (slotStart: number, targetWaitMs: number) => slotStart + targetWaitMs * CLASS_FACTOR.APPOINTMENT;
