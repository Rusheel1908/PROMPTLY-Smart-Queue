import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { safeEqual } from './secret.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Throw an HTTP error. Typed `never` so it works in expressions: `x ?? fail(404, '...')`. */
export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

/** Assert a condition or fail with an HTTP error. */
export function must(cond: unknown, status: number, message: string): void {
  cond || fail(status, message);
}

/** Wrap an async handler: its return value becomes the JSON response; errors go to the error middleware. */
export const handle = (fn: (req: Request, res: Response) => Promise<unknown>, status = 200): RequestHandler =>
  (req, res, next) => { fn(req, res).then((data) => res.status(status).json(data)).catch(next); };

const STAFF_PIN = () => process.env.STAFF_PIN ?? '1234';

export const isStaff = (req: Request) => safeEqual(req.header('x-staff-pin'), STAFF_PIN());

/** Staff-only routes: a shared PIN stands in for a role-scoped session in this MVP. */
export const requireStaff: RequestHandler = (req, _res, next) => {
  must(isStaff(req), 401, 'Staff PIN required');
  next();
};

/** Tiny in-memory fixed-window rate limiter for public routes. */
export function rateLimit(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, number[]>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    hits.set(key, [...recent, now]);
    must(recent.length < max, 429, 'Too many requests, please slow down');
    next();
  };
}
