import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { HttpError } from './lib/http.js';
import { countersRouter } from './routes/counters.js';
import { opsRouter } from './routes/ops.js';
import { tokensRouter } from './routes/tokens.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/tokens', tokensRouter);
  app.use('/api/counters', countersRouter);
  app.use('/api', opsRouter);

  /** First matching rule decides the response. */
  const ERROR_RULES: [(e: unknown) => boolean, (e: any) => [number, object]][] = [
    [(e) => e instanceof ZodError, (e: ZodError) => [400, { error: 'Invalid request', issues: e.issues }]],
    [(e) => e instanceof HttpError, (e: HttpError) => [e.status, { error: e.message }]],
    [() => true, (e) => (console.error(e), [500, { error: 'Internal error' }])],
  ];
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const [status, body] = ERROR_RULES.find(([matches]) => matches(err))![1](err);
    res.status(status).json(body);
  };
  app.use(onError);
  return app;
}
