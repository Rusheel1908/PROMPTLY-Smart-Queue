import 'dotenv/config';
import { z } from 'zod';

/** Dev-only fallback PIN. Production refuses to start with it (or without a PIN at all). */
export const DEV_PIN = '1234';
const MIN_PROD_PIN_LENGTH = 6;
const MINUTE = 60_000;

/** Per-IP fixed-window limits for public routes: one table, so every number lives here. */
export const RATE_LIMITS = {
  issueToken: { max: 30, windowMs: MINUTE },
  tokenDetail: { max: 120, windowMs: MINUTE },
  tokenAction: { max: 20, windowMs: MINUTE },
  staffAuth: { max: 20, windowMs: 15 * MINUTE }, // wrong-PIN attempts, so the PIN cannot be brute-forced
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

/** Production PIN rules: first failing rule's message is reported. The PIN itself never appears in output. */
const PROD_PIN_RULES: [(pin: string | undefined) => boolean, string][] = [
  [(p) => !p, 'is required in production'],
  [(p) => p === DEV_PIN, `must not be the default "${DEV_PIN}" in production`],
  [(p) => p!.length < MIN_PROD_PIN_LENGTH, `must be at least ${MIN_PROD_PIN_LENGTH} characters in production`],
];

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string({ required_error: 'is required' }).url('must be a database URL'),
  CORS_ORIGIN: z.string().default('http://localhost:5173').transform(csv)
    .pipe(z.array(z.string().url('each origin must be a URL like https://app.example.com')).min(1, 'needs at least one origin'))
    .transform((list) => list.map((o) => new URL(o).origin)), // "https://x.com/" → "https://x.com", as browsers send it
  STAFF_PIN: z.string().optional(),
  TRUST_PROXY: z.string().default('false').transform(trustProxy),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  const broken = PROD_PIN_RULES.find(([fails]) => fails(env.STAFF_PIN));
  broken && ctx.addIssue({ code: 'custom', path: ['STAFF_PIN'], message: broken[1] });
}).transform((env) => ({ ...env, STAFF_PIN: env.STAFF_PIN || DEV_PIN }));

export type Config = z.infer<typeof Env>;

/** Pure: validate an environment without side effects (used by tests). */
export const parseConfig = (env: NodeJS.ProcessEnv) => Env.safeParse(env);

/** One line per problem, e.g. "  - STAFF_PIN: is required in production". */
export const describeProblems = (error: z.ZodError) =>
  error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`).join('\n');

function load(): Config {
  const parsed = parseConfig(process.env);
  if (!parsed.success) {
    console.error(`Invalid configuration, refusing to start:\n${describeProblems(parsed.error)}\nSee backend/.env.example.`);
    process.exit(1);
  }
  const weakPin = parsed.data.STAFF_PIN === DEV_PIN;
  weakPin && parsed.data.NODE_ENV === 'development'
    && console.warn('[config] Using the default dev staff PIN. Fine locally; set a strong STAFF_PIN before deploying.');
  return parsed.data;
}

export const config = load();
