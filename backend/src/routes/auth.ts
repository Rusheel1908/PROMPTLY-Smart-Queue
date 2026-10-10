import { Router } from 'express';
import { z } from 'zod';
import { RATE_LIMITS } from '../config.js';
import { fail, failureLimit, handle, HttpError, loadStaff } from '../lib/http.js';
import { listActiveStaff, login, logout, me, sessionFor } from '../services/auth.js';

export const authRouter = Router();

const Login = z.object({ staffId: z.string().min(1).max(64), pin: z.string().min(1).max(64) });

/** Only failed logins count toward the per-IP limit, so staff logging in normally never hit it. */
const failedLogins = failureLimit(RATE_LIMITS.login);
const isBadLogin = (e: unknown) => e instanceof HttpError && e.status === 401;

authRouter.get('/staff', handle(() => listActiveStaff()));
authRouter.post('/login', failedLogins.guard, handle(async (req) => {
  const { staffId, pin } = Login.parse(req.body);
  return login(staffId, pin).catch((e) => { isBadLogin(e) && failedLogins.record(req); throw e; });
}));

authRouter.get('/me', loadStaff, handle(async (req) => me((await sessionFor(req.bearer)) ?? fail(401, 'Log in required'))));
authRouter.post('/logout', loadStaff, handle(async (req) => {
  req.bearer && (await logout(req.bearer));
  return { ok: true };
}));
