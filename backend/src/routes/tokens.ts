import { Request, RequestHandler, Router } from 'express';
import { z } from 'zod';
import { RATE_LIMITS } from '../config.js';
import { actor, handle, loadStaff, must, rateLimit, requireRole } from '../lib/http.js';
import { can, type Action } from '../lib/permissions.js';
import { cancelToken, holdsToken, issueToken, reactivate, stepAway, tokenDetail } from '../services/actions.js';
import { followToken, unfollowToken } from '../services/notifier.js';
import { isPushEndpoint } from '../services/push.js';

export const tokensRouter = Router();

const CreateToken = z.object({
  serviceId: z.string().min(1),
  class: z.enum(['EMERGENCY', 'PRIORITY', 'APPOINTMENT', 'NORMAL']).default('NORMAL'),
});
const Away = z.object({ minutes: z.number().int().min(1).max(30).default(5) });
const Endpoint = z.string().max(2048).refine(isPushEndpoint, 'must be an https URL of a browser push service');
/** A browser PushSubscription as JSON (subscription.toJSON()). */
const PushSub = z.object({
  endpoint: Endpoint,
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

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

/**
 * Status reads (every open status page refetches on queue updates): a valid QR key is limited per token, so many
 * phones behind one branch Wi-Fi IP never hit 429. Anything else (wrong key, staff) stays per IP, so guessing is still capped.
 */
const readPerKey = rateLimit(RATE_LIMITS.tokenDetailPerKey, (req) => `token:${req.params.id}`);
const readPerIp = rateLimit(RATE_LIMITS.tokenDetail);
const statusRead: RequestHandler = (req, res, next) => {
  holdsToken(req.params.id, req.header('x-token-key')).then((holder) => (holder ? readPerKey : readPerIp)(req, res, (err?: unknown) => {
    if (err) return next(err);
    must(holder || staffMay(req, 'view-token'), 404, 'Token not found');
    next();
  })).catch(next);
};

/**
 * Push subscriptions: the QR-link holder only (a staff session is not enough to point a customer's alerts elsewhere).
 * Limited like status reads: per token for the holder, so a branch full of phones on one IP can all subscribe.
 */
const pushPerKey = rateLimit(RATE_LIMITS.tokenAction, (req) => `push:${req.params.id}`);
const pushPerIp = rateLimit(RATE_LIMITS.tokenAction);
const holderOnly: RequestHandler = (req, res, next) => {
  holdsToken(req.params.id, req.header('x-token-key')).then((holder) => (holder ? pushPerKey : pushPerIp)(req, res, (err?: unknown) => {
    if (err) return next(err);
    must(holder, 404, 'Token not found');
    next();
  })).catch(next);
};

tokensRouter.get('/:id', loadStaff, statusRead, handle((req) => tokenDetail(req.params.id)));
tokensRouter.post('/:id/away', rateLimit(RATE_LIMITS.tokenAction), loadStaff, ownerOrStaff, handle((req) => stepAway(req.params.id, Away.parse(req.body ?? {}).minutes)));
tokensRouter.post('/:id/cancel', rateLimit(RATE_LIMITS.tokenAction), loadStaff, ownerOrStaff, handle((req) => cancelToken(req.params.id)));
tokensRouter.post('/:id/push', holderOnly, handle((req) => {
  const { endpoint, keys } = PushSub.parse(req.body);
  return followToken(req.params.id, { endpoint, ...keys });
}, 201));
tokensRouter.delete('/:id/push', holderOnly, handle((req) =>
  unfollowToken(req.params.id, z.object({ endpoint: Endpoint }).parse(req.body).endpoint)));
tokensRouter.post('/:id/reactivate', requireRole('reactivate'), handle((req) => reactivate(req.params.id, actor(req))));
