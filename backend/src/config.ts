import 'dotenv/config';
import { z } from 'zod';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Per-IP fixed-window limits for public routes: one table, so every number lives here. */
export const RATE_LIMITS = {
  issueToken: { max: 30, windowMs: MINUTE },
  tokenDetail: { max: 120, windowMs: MINUTE },
  tokenAction: { max: 20, windowMs: MINUTE },
  login: { max: 20, windowMs: 15 * MINUTE }, // failed staff logins per IP, so PINs cannot be brute-forced
} as const;

/** Staff sessions and the per-account lockout. */
export const AUTH = {
  sessionTtlMs: 12 * HOUR,
  maxFailedLogins: 5, // wrong PINs in a row before the account locks
  lockoutMs: 5 * MINUTE,
  minPinLength: 6, // for PINs set at seed time
} as const;

/** Miss audit: flag a staff member whose miss rate is well above the team's (both rules must hold). */
export const STAFF_AUDIT = {
  minCalls: 3, // too few calls to judge
  flagRatio: 1.5, // miss rate at least 1.5× the team rate…
  minExcess: 0.1, // …and at least 10 points above it
} as const;

export const LIMITS = {
  jsonBody: '20kb',
  wsMaxConnections: 500,
  shutdownTimeoutMs: 10_000,
} as const;

/** "true"/"false", a hop count ("1" behind Render/Vercel), or a subnet list as Express accepts it. */
const BOOLS: Record<string, boolean> = { true: true, false: false };
const trustProxy = (v: string): boolean | number | string => BOOLS[v] ?? (/^\d+$/.test(v) ? Number(v) : v);

const csv = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string({ required_error: 'is required' }).url('must be a database URL'),
  CORS_ORIGIN: z.string().default('http://localhost:5173').transform(csv)
    .pipe(z.array(z.string().url('each origin must be a URL like https://app.example.com')).min(1, 'needs at least one origin'))
    .transform((list) => list.map((o) => new URL(o).origin)), // "https://x.com/" → "https://x.com", as browsers send it
  TRUST_PROXY: z.string().default('false').transform(trustProxy),
});

export type Config = z.infer<typeof Env>;

/** Pure: validate an environment without side effects (used by tests). */
export const parseConfig = (env: NodeJS.ProcessEnv) => Env.safeParse(env);

/** One line per problem, e.g. "  - DATABASE_URL: is required". */
export const describeProblems = (error: z.ZodError) =>
  error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`).join('\n');

function load(): Config {
  const parsed = parseConfig(process.env);
  if (!parsed.success) {
    console.error(`Invalid configuration, refusing to start:\n${describeProblems(parsed.error)}\nSee backend/.env.example.`);
    process.exit(1);
  }
  process.env.STAFF_PIN
    && console.warn('[config] STAFF_PIN is no longer used: staff log in with their own accounts (npm run db:seed). Remove it.');
  return parsed.data;
}

export const config = load();
