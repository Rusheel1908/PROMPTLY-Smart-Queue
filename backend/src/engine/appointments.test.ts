import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_CONFIG, appointmentDeadline, bookableSlots, checkInPhase, checkInWindow, dayStart, daySlots, slotMinutes,
} from './appointments.js';
import { forecast } from './forecast.js';
import { EngineState, EngineToken, ExpectedArrival, MIN } from './types.js';

const at = (hhmm: string, plusDays = 0) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(dayStart(new Date('2026-10-12T12:00:00').getTime(), plusDays)).setHours(h, m, 0, 0);
};

describe('check-in window', () => {
  const slot = at('10:30');
  it('opens 15 min before the slot and closes 10 min after, both ends inside', () => {
    expect(checkInWindow(slot)).toEqual({ opensAt: at('10:15'), closesAt: at('10:40') });
    expect(checkInPhase(slot, at('10:15') - 1)).toBe('EARLY');
    expect(checkInPhase(slot, at('10:15'))).toBe('ON_TIME');
    expect(checkInPhase(slot, at('10:40'))).toBe('ON_TIME');
    expect(checkInPhase(slot, at('10:40') + 1)).toBe('LATE');
  });

  it('an on-time deadline is anchored to the slot', () => {
    expect(appointmentDeadline(slot, 15 * MIN)).toBe(slot + 3 * MIN); // 0.2 × 15 min
  });
});

describe('slots', () => {
  it('per service length, inside opening hours', () => {
    expect(slotMinutes('L')).toBe(30);
    expect(slotMinutes('Z')).toBe(APPOINTMENT_CONFIG.defaultSlotMin);
    const loans = daySlots(dayStart(at('12:00')), 30);
    expect(loans[0]).toBe(at('09:00'));
    expect(loans.at(-1)).toBe(at('16:30')); // the last one ends at closing
    expect(loans).toHaveLength(16);
  });

  it('today and tomorrow, only slots whose check-in window is still open', () => {
    const slots = bookableSlots(at('10:41'), 30);
    expect(slots[0]).toBe(at('11:00')); // 10:30 closed at 10:40
    expect(bookableSlots(at('10:40'), 30)[0]).toBe(at('10:30'));
    expect(slots.at(-1)).toBe(at('16:30', 1));
    expect(bookableSlots(at('18:00'), 30)[0]).toBe(at('09:00', 1));
  });
});

describe('forecast with booked appointments', () => {
  const NOW = at('10:00');
  const svc = { id: 'D', targetWaitMs: 15 * MIN, mu: Math.log(4), sigma: 0.3 };
  const walkIn: EngineToken = { id: 'w', seq: 1, serviceId: 'D', cls: 'NORMAL', creditedArrival: NOW, notBefore: NOW, deadline: NOW + 15 * MIN };
  const ahead: EngineToken[] = [0, 1, 2].map((i) => ({ ...walkIn, id: `a${i}`, seq: i - 3 }));
  const s = (expected?: ExpectedArrival[]): EngineState => ({
    services: { D: svc },
    counters: { C1: { id: 'C1', open: true, skills: new Set(['D']), busySince: null, busyService: null } },
    waiting: [...ahead, walkIn],
    expected,
  });
  const booking = (p: number): ExpectedArrival => ({ id: 'b', serviceId: 'D', t: NOW + 5 * MIN, p, deadline: NOW + 8 * MIN });

  it('a booking that will show up pushes a walk-in later', () => {
    const without = forecast(s(), NOW, { runs: 200 }).w;
    const withBooking = forecast(s([booking(1)]), NOW, { runs: 200 }).w;
    expect(withBooking.p50).toBeGreaterThan(without.p50 + 2 * MIN);
    expect(forecast(s([booking(1)]), NOW).b).toBeUndefined(); // hypothetical customers never get a result
  });

  it('show-up probability scales the effect; 0 changes nothing', () => {
    const p50 = (p: number) => forecast(s([booking(p)]), NOW, { runs: 400 }).w.p50;
    expect(forecast(s([booking(0)]), NOW, { runs: 200 })).toEqual(forecast(s(), NOW, { runs: 200 }));
    expect(p50(0.5)).toBeGreaterThan(p50(0));
    expect(p50(0.5)).toBeLessThan(p50(1));
  });
});
