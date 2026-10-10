import { Request, RequestHandler, Router } from 'express';
import { z } from 'zod';
import { RATE_LIMITS } from '../config.js';
import { actor, handle, loadStaff, must, rateLimit, requireRole } from '../lib/http.js';
import { can, type Action } from '../lib/permissions.js';
import { cancelToken, holdsToken, issueToken, reactivate, stepAway, tokenDetail } from '../services/actions.js';

export const tokensRouter = Router();

const CreateToken = z.object({
  serviceId: z.string().min(1),
  class: z.enum(['EMERGENCY', 'PRIORITY', 'APPOINTMENT', 'NORMAL']).default('NORMAL'),
});
const Away = z.object({ minutes: z.number().int().min(1).max(30).default(5) });

const staffMay = (req: Request, action: Action) => !!req.staff && can(req.staff.role, action);

/** Customer routes: open to the QR-link holder (x-token-key) or a staff session. Anyone else gets a plain 404. */
const ownerOrStaff: RequestHandler = (req, _res, next) => {
  const allowed = async () => staffMay(req, 'view-token') || holdsToken(req.params.id, req.header('x-token-key'));
  allowed().then((ok) => { must(ok, 404, 'Token not found'); next(); }).catch(next);
};

tokensRouter.post('/', rateLimit(RATE_LIMITS.issueToken), loadStaff, handle(async (req) => {
  const body = CreateToken.parse(req.body);
  // priority classes are set or verified by staff, never self-selected at the kiosk
  must(body.class === 'NORMAL' || staffMay(req, 'issue-priority'), 403, 'Priority classes must be verified by staff');
  return issueToken(body.serviceId, body.class, req.staff?.id ?? 'kiosk');
}, 201));

tokensRouter.get('/:id', rateLimit(RATE_LIMITS.tokenDetail), loadStaff, ownerOrStaff, handle((req) => tokenDetail(req.params.id)));
tokensRouter.post('/:id/away', rateLimit(RATE_LIMITS.tokenAction), loadStaff, ownerOrStaff, handle((req) => stepAway(req.params.id, Away.parse(req.body ?? {}).minutes)));
tokensRouter.post('/:id/cancel', rateLimit(RATE_LIMITS.tokenAction), loadStaff, ownerOrStaff, handle((req) => cancelToken(req.params.id)));
tokensRouter.post('/:id/reactivate', requireRole('reactivate'), handle((req) => reactivate(req.params.id, actor(req))));
