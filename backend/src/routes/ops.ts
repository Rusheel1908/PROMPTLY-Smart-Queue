import { Router } from 'express';
import { z } from 'zod';
import { handle, isStaff, requireStaff } from '../lib/http.js';
import { evaluate, SPECS } from '../sim/evaluate.js';
import { resetDemo, spawnDemo, whatIf } from '../services/actions.js';
import { metrics, snapshot, SNAPSHOT_VIEWS } from '../services/queue.js';

export const opsRouter = Router();

const WhatIf = z.object({
  counters: z.array(z.object({
    id: z.string(),
    status: z.enum(['OPEN', 'PAUSED', 'CLOSED']).optional(),
    skills: z.array(z.string()).optional(),
  })),
});
const Spawn = z.object({ count: z.number().int().min(1).max(20).default(6) });
const Lab = z.object({
  days: z.number().int().min(1).max(30).default(8),
  seed: z.number().int().min(1).default(1),
  runs: z.number().int().min(10).max(200).default(40),
  policies: z.array(z.string()).optional(),
});

/** Read model for every screen. Without the staff PIN it is reduced to what the board shows: codes, no token ids. */
opsRouter.get('/snapshot', handle((req) => snapshot().then(SNAPSHOT_VIEWS[isStaff(req) ? 'staff' : 'public'])));
opsRouter.get('/metrics', handle(() => metrics()));
opsRouter.get('/auth/check', requireStaff, handle(async () => ({ ok: true })));

opsRouter.post('/whatif', requireStaff, handle(async (req) => whatIf(WhatIf.parse(req.body).counters)));
opsRouter.post('/demo/spawn', requireStaff, handle(async (req) => spawnDemo(Spawn.parse(req.body ?? {}).count)));
opsRouter.post('/demo/reset', requireStaff, handle(() => resetDemo()));

/** Simulation Lab: every policy on identical SYNTHETIC days. Runs synchronously (a few seconds). */
opsRouter.get('/lab/policies', handle(async () =>
  Object.entries(SPECS).map(([id, s]) => ({ id, label: s.label, group: s.group, eta: s.eta, miss: s.miss }))));
opsRouter.post('/lab/run', handle(async (req) => evaluate(Lab.parse(req.body ?? {}))));
