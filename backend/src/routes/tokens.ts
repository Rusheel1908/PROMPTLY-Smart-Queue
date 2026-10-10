import { RequestHandler, Router } from 'express';
import { z } from 'zod';
import { RATE_LIMITS } from '../config.js';
import { handle, isStaff, must, rateLimit, requireStaff } from '../lib/http.js';
import { cancelToken, holdsToken, issueToken, reactivate, stepAway, tokenDetail } from '../services/actions.js';

export const tokensRouter = Router();

const CreateToken = z.object({
  serviceId: z.string().min(1),
  class: z.enum(['EMERGENCY', 'PRIORITY', 'APPOINTMENT', 'NORMAL']).default('NORMAL'),
});
const Away = z.object({ minutes: z.number().int().min(1).max(30).default(5) });

/** Customer routes: open to the QR-link holder (x-token-key) or staff. Anyone else gets a plain 404. */
const ownerOrStaff: RequestHandler = (req, _res, next) => {
  const allowed = async () => isStaff(req) || holdsToken(req.params.id, req.header('x-token-key'));
  allowed().then((ok) => { must(ok, 404, 'Token not found'); next(); }).catch(next);
};

tokensRouter.post('/', rateLimit(RATE_LIMITS.issueToken), handle(async (req) => {
  const body = CreateToken.parse(req.body);
  // priority classes are set or verified by staff, never self-selected at the kiosk
  must(body.class === 'NORMAL' || isStaff(req), 403, 'Priority classes must be verified by staff');
  return issueToken(body.serviceId, body.class, isStaff(req) ? 'staff' : 'kiosk');
}, 201));

tokensRouter.get('/:id', rateLimit(RATE_LIMITS.tokenDetail), ownerOrStaff, handle((req) => tokenDetail(req.params.id)));
tokensRouter.post('/:id/away', rateLimit(RATE_LIMITS.tokenAction), ownerOrStaff, handle((req) => stepAway(req.params.id, Away.parse(req.body ?? {}).minutes)));
tokensRouter.post('/:id/cancel', rateLimit(RATE_LIMITS.tokenAction), ownerOrStaff, handle((req) => cancelToken(req.params.id)));
tokensRouter.post('/:id/reactivate', requireStaff, handle((req) => reactivate(req.params.id, 'staff')));
