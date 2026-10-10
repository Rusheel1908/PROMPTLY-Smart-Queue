import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ROLE_LABEL, can, type Action } from './permissions.js';
import { sessionFor, type StaffUser } from '../services/auth.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffUser; // set by loadStaff when the request carries a live session
      bearer?: string;
    }
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, unknown>) { super(message); }
}

/** Throw an HTTP error. Typed `never` so it works in expressions: `x ?? fail(404, '...')`. Details join the JSON body. */
export function fail(status: number, message: string, details?: Record<string, unknown>): never {
  throw new HttpError(status, message, details);
}

/** Assert a condition or fail with an HTTP error. */
export function must(cond: unknown, status: number, message: string): void {
  cond || fail(status, message);
}

/** Wrap an async handler: its return value becomes the JSON response; errors go to the error middleware. */
export const handle = (fn: (req: Request, res: Response) => Promise<unknown>, status = 200): RequestHandler =>
  (req, res, next) => { fn(req, res).then((data) => res.status(status).json(data)).catch(next); };

type Limit = { max: number; windowMs: number };
const TOO_MANY = 'Too many requests, please slow down';

type Bucket = (req: Request) => string;
const byIp: Bucket = (req) => req.ip ?? 'unknown';

/** Every limiter's hit log, so tests can start each case with fresh limits. */
const allHits = new Set<Map<string, number[]>>();
/** Tests only: forget every recorded hit. */
export const resetRateLimits = () => allHits.forEach((h) => h.clear());

/** Hit log for a fixed window, one entry per bucket (the client IP unless given). */
function hitLog({ windowMs }: Limit, bucket: Bucket = byIp) {
  const hits = new Map<string, number[]>();
  allHits.add(hits);
  const recent = (req: Request) => (hits.get(bucket(req)) ?? []).filter((t) => Date.now() - t < windowMs);
  const add = (req: Request) => hits.set(bucket(req), [...recent(req), Date.now()]);
  return { recent, add };
}

/** Tiny in-memory fixed-window rate limiter for public routes, per IP unless another bucket is given. */
export function rateLimit(limit: Limit, bucket?: Bucket): RequestHandler {
  const log = hitLog(limit, bucket);
  return (req: Request, _res: Response, next: NextFunction) => {
    const seen = log.recent(req).length;
    log.add(req);
    must(seen < limit.max, 429, TOO_MANY);
    next();
  };
}

/**
 * Like rateLimit, but only failures count: `guard` refuses an IP with too many recent failures
 * (before any check runs, so a right guess cannot slip through), `record` adds one.
 */
export function failureLimit(limit: Limit) {
  const log = hitLog(limit);
  const guard: RequestHandler = (req, _res, next) => { must(log.recent(req).length < limit.max, 429, TOO_MANY); next(); };
  return { guard, record: log.add };
}

const bearerOf = (req: Request) => /^Bearer (\S+)$/.exec(req.header('authorization') ?? '')?.[1];

/** Attach req.staff when the request carries a live session. Never rejects: public routes use it too. */
export const loadStaff: RequestHandler = (req, _res, next) => {
  req.bearer = bearerOf(req);
  sessionFor(req.bearer).then((s) => { req.staff = s?.staff; next(); }).catch(next);
};

/**
 * Routes for the holder of a secret link (a token or booking key): limited per resource when the key is right, so
 * phones sharing one IP never starve each other, per IP otherwise (so guessing stays capped); then 404 unless the
 * caller holds the key or `alsoAllow` says so.
 */
export function keyHolder(
  holds: (req: Request) => Promise<boolean>, perKey: RequestHandler, perIp: RequestHandler, alsoAllow: (req: Request) => boolean = () => false,
): RequestHandler {
  return (req, res, next) => {
    holds(req).then((holder) => (holder ? perKey : perIp)(req, res, (err?: unknown) => {
      if (err) return next(err);
      must(holder || alsoAllow(req), 404, 'Not found');
      next();
    })).catch(next);
  };
}

/** Staff routes: 401 without a live session, 403 when the PERMISSIONS table does not allow the caller's role. */
export const requireRole = (action: Action): RequestHandler => (req, res, next) =>
  loadStaff(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (!req.staff) return next(new HttpError(401, 'Log in required'));
    can(req.staff.role, action)
      ? next()
      : next(new HttpError(403, `Your role (${ROLE_LABEL[req.staff.role]}) cannot do this. Ask a supervisor.`));
  });

/** The staff member a requireRole route runs as. */
export const actor = (req: Request) => req.staff!.id;
