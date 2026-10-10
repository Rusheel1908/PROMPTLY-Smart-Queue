import { Router } from 'express';
import { z } from 'zod';
import { actor, fail, handle, loadStaff, requireRole } from '../lib/http.js';
import { SPECS } from '../sim/evaluate.js';
import precomputed from '../sim/precomputed.json' with { type: 'json' };
import { getLabJob, startLabJob } from '../services/labJobs.js';
import { resetDemo, spawnDemo, whatIf } from '../services/actions.js';
import { applySuggestion, getSuggestions } from '../services/suggestions.js';
import { metrics, snapshot, SNAPSHOT_VIEWS } from '../services/queue.js';
import { staffStats } from '../services/staffStats.js';
import { pushPublicKey } from '../services/push.js';
import { DEMO_TIMINGS, demoBooking, todaysAppointments } from '../services/appointments.js';

export const opsRouter = Router();

const WhatIf = z.object({
  counters: z.array(z.object({
    id: z.string(),
    status: z.enum(['OPEN', 'PAUSED', 'CLOSED']).optional(),
    skills: z.array(z.string()).optional(),
  })),
});
const Spawn = z.object({ count: z.number().int().min(1).max(20).default(6) });
const DemoBooking = z.object({ timing: z.enum(DEMO_TIMINGS) });
const Lab = z.object({
  days: z.number().int().min(1).max(30).default(8),
  seed: z.number().int().min(1).default(1),
  runs: z.number().int().min(10).max(200).default(40),
  policies: z.array(z.string()).optional(),
});

/** Read model for every screen. Without a staff session it is reduced to what the board shows: codes, no token ids. */
opsRouter.get('/snapshot', loadStaff, handle((req) => snapshot().then(SNAPSHOT_VIEWS[req.staff ? 'staff' : 'public'])));
opsRouter.get('/metrics', handle(() => metrics()));
/** The VAPID public key browsers subscribe with; null when push is off (status pages then hide "Notify me"). */
opsRouter.get('/push/key', handle(async () => ({ publicKey: pushPublicKey() })));

opsRouter.post('/whatif', requireRole('whatif'), handle(async (req) => whatIf(WhatIf.parse(req.body).counters)));
/** Supervisor suggestions: details only with a session (the WebSocket carries a bare "suggestions-updated" ping). */
opsRouter.get('/ops/suggestions', requireRole('view-suggestions'), handle(() => getSuggestions()));
opsRouter.post('/ops/suggestions/:id/apply', requireRole('apply-suggestion'), handle((req) => applySuggestion(req.params.id, actor(req))));
/** Miss audit: today's calls, completes and misses per staff member, with outliers flagged. */
opsRouter.get('/ops/staff-stats', requireRole('staff-stats'), handle(() => staffStats()));
/** Today's bookings with a count per status. */
opsRouter.get('/ops/appointments', requireRole('view-appointments'), handle(() => todaysAppointments()));
opsRouter.post('/demo/spawn', requireRole('demo'), handle(async (req) => spawnDemo(Spawn.parse(req.body ?? {}).count)));
opsRouter.post('/demo/reset', requireRole('demo'), handle((req) => resetDemo(actor(req))));
/** A booking whose check-in window is open now ("on-time") or already closed ("late"), to show check-in at any hour. */
opsRouter.post('/demo/booking', requireRole('demo'), handle((req) => demoBooking(DemoBooking.parse(req.body ?? {}).timing, actor(req)), 201));

/** Simulation Lab: every policy on identical SYNTHETIC days. */
opsRouter.get('/lab/policies', handle(async () =>
  Object.entries(SPECS).map(([id, s]) => ({ id, label: s.label, group: s.group, eta: s.eta, miss: s.miss }))));
/** The saved full evaluation (`npm run lab:snapshot`), so the page shows something instantly. */
opsRouter.get('/lab/latest', handle(async () => precomputed));
/** Live runs go to a worker thread (one at a time); the client polls the job or waits for a "lab" ping. */
opsRouter.post('/lab/run', requireRole('lab-run'), handle(async (req) => ({ jobId: startLabJob(Lab.parse(req.body ?? {})).id }), 202));
opsRouter.get('/lab/jobs/:id', requireRole('lab-run'), handle(async (req) => getLabJob(req.params.id) ?? fail(404, 'Lab job not found')));
