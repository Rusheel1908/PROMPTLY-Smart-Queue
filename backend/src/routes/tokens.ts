import { Router } from 'express';
import { z } from 'zod';
import { handle, isStaff, must, rateLimit, requireStaff } from '../lib/http.js';
import { cancelToken, issueToken, reactivate, stepAway, tokenDetail } from '../services/actions.js';

export const tokensRouter = Router();

const CreateToken = z.object({
  serviceId: z.string().min(1),
  class: z.enum(['EMERGENCY', 'PRIORITY', 'APPOINTMENT', 'NORMAL']).default('NORMAL'),
});
const Away = z.object({ minutes: z.number().int().min(1).max(30).default(5) });

tokensRouter.post('/', rateLimit(30, 60_000), handle(async (req) => {
  const body = CreateToken.parse(req.body);
  // priority classes are set or verified by staff, never self-selected at the kiosk
  must(body.class === 'NORMAL' || isStaff(req), 403, 'Priority classes must be verified by staff');
  return issueToken(body.serviceId, body.class, isStaff(req) ? 'staff' : 'kiosk');
}, 201));

tokensRouter.get('/:id', rateLimit(120, 60_000), handle((req) => tokenDetail(req.params.id)));
tokensRouter.post('/:id/away', rateLimit(20, 60_000), handle((req) => stepAway(req.params.id, Away.parse(req.body ?? {}).minutes)));
tokensRouter.post('/:id/cancel', rateLimit(20, 60_000), handle((req) => cancelToken(req.params.id)));
tokensRouter.post('/:id/reactivate', requireStaff, handle((req) => reactivate(req.params.id, 'staff')));
