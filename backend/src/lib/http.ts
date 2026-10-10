import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config, RATE_LIMITS } from '../config.js';
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

export const isStaff = (req: Request) => safeEqual(req.header('x-staff-pin'), config.STAFF_PIN);

/** Tiny in-memory fixed-window rate limiter for public routes. */
export function rateLimit({ max, windowMs }: { max: number; windowMs: number }): RequestHandler {
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

/** Only wrong-PIN attempts count, so staff working normally never hit the limit. */
const pinGuesses = rateLimit(RATE_LIMITS.staffAuth);

/** Staff-only routes: a shared PIN stands in for a role-scoped session in this MVP. */
export const requireStaff: RequestHandler = (req, res, next) =>
  isStaff(req) ? next() : pinGuesses(req, res, () => fail(401, 'Staff PIN required'));
