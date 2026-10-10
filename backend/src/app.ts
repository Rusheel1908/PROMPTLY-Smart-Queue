import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { tokensRouter } from './routes/tokens.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/tokens', tokensRouter);

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid request', issues: err.issues });
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  };
  app.use(onError);
  return app;
}
