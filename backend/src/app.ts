import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { config, LIMITS } from './config.js';
import { fail, HttpError } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { countersRouter } from './routes/counters.js';
import { opsRouter } from './routes/ops.js';
import { tokensRouter } from './routes/tokens.js';

/** body-parser errors (oversized or malformed JSON) carry their own status and a client-safe message. */
const isClientHttpError = (e: any) => typeof e?.status === 'number' && e.status < 500 && e.expose === true;

export function createApp() {
  const app = express();
  app.set('trust proxy', config.TRUST_PROXY); // so req.ip (and the rate limits) see the real client behind Render/Vercel
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN }));
  app.use(express.json({ limit: LIMITS.jsonBody }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/tokens', tokensRouter);
  app.use('/api/counters', countersRouter);
  app.use('/api', opsRouter);
  app.use('/api', () => fail(404, 'Not found'));

  /** First matching rule decides the response. */
  const ERROR_RULES: [(e: unknown) => boolean, (e: any) => [number, object]][] = [
    [(e) => e instanceof ZodError, (e: ZodError) => [400, { error: 'Invalid request', issues: e.issues }]],
    [(e) => e instanceof HttpError, (e: HttpError) => [e.status, { error: e.message }]],
    [isClientHttpError, (e) => [e.status, { error: e.message }]],
    [() => true, (e) => (console.error(e), [500, { error: 'Internal error' }])],
  ];
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const [status, body] = ERROR_RULES.find(([matches]) => matches(err))![1](err);
    res.status(status).json(body);
  };
  app.use(onError);
  return app;
}
