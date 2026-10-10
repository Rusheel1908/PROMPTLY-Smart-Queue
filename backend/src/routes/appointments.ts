import { Request, Router } from 'express';
import { z } from 'zod';
import { RATE_LIMITS } from '../config.js';
import { actor, failureLimit, fail, handle, keyHolder, rateLimit, requireRole } from '../lib/http.js';
import {
  appointmentDetail, book, cancelAppointment, checkInByCode, checkInById, followAppointment, holdsAppointment, listSlots,
} from '../services/appointments.js';
import { forgetSubscription } from '../services/notifier.js';
import { isPushEndpoint } from '../services/push.js';

export const appointmentsRouter = Router();

const Slots = z.object({ serviceId: z.string().min(1) });
const Book = z.object({ serviceId: z.string().min(1), slotStart: z.coerce.date() });
const Code = z.object({ code: z.string().trim().min(6).max(20) });
const Endpoint = z.string().max(2048).refine(isPushEndpoint, 'must be an https URL of a browser push service');
const PushSub = z.object({
  endpoint: Endpoint,
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** Booking-link routes (x-appointment-key): limited per booking for the holder, per IP for anyone else, then 404. */
const holder = keyHolder(
  (req: Request) => holdsAppointment(req.params.id, req.header('x-appointment-key')),
  rateLimit(RATE_LIMITS.tokenDetailPerKey, (req) => `appointment:${req.params.id}`),
  rateLimit(RATE_LIMITS.tokenDetail),
);
const wrongCodes = failureLimit(RATE_LIMITS.bookingCode);

appointmentsRouter.get('/slots', rateLimit(RATE_LIMITS.slots), handle((req) => listSlots(Slots.parse(req.query).serviceId)));
appointmentsRouter.post('/', rateLimit(RATE_LIMITS.book), handle((req) => {
  const body = Book.parse(req.body);
  return book(body.serviceId, body.slotStart.getTime());
}, 201));

/** Kiosk check-in by booking code. Wrong codes count per IP, so codes cannot be guessed. */
appointmentsRouter.post('/check-in', wrongCodes.guard, handle(async (req) => {
  const result = await checkInByCode(Code.parse(req.body).code);
  if (result) return result;
  wrongCodes.record(req);
  return fail(404, 'Booking code not found. Check the code on your booking, or ask at the desk');
}));

appointmentsRouter.get('/:id', holder, handle((req) => appointmentDetail(req.params.id)));
appointmentsRouter.post('/:id/check-in', holder, handle((req) => checkInById(req.params.id)));
appointmentsRouter.post('/:id/push', holder, handle((req) => {
  const { endpoint, keys } = PushSub.parse(req.body);
  return followAppointment(req.params.id, { endpoint, ...keys });
}, 201));
appointmentsRouter.delete('/:id/push', holder, handle((req) =>
  forgetSubscription({ appointmentId: req.params.id }, z.object({ endpoint: Endpoint }).parse(req.body).endpoint)));
appointmentsRouter.post('/:id/cancel', requireRole('cancel-appointment'), handle((req) => cancelAppointment(req.params.id, actor(req))));
