import { Router } from 'express';
import { z } from 'zod';
import { actor, handle, requireRole } from '../lib/http.js';
import type { Action } from '../lib/permissions.js';
import {
  callNext, complete, miss, recall, redirect, startService, updateCounter,
} from '../services/actions.js';

export const countersRouter = Router();

const Redirect = z.object({ serviceId: z.string().min(1) });
const Patch = z.object({
  status: z.enum(['OPEN', 'PAUSED', 'CLOSED']).optional(),
  skills: z.array(z.string().min(1)).optional(),
});

/** One-line route table: path → handler. Each path is also its permission name in PERMISSIONS. */
const ACTIONS = {
  'call-next': callNext,
  recall,
  ack: startService,
  complete,
  miss,
} satisfies Partial<Record<Action, (counterId: string, actor: string) => Promise<unknown>>>;

Object.entries(ACTIONS).forEach(([name, fn]) =>
  countersRouter.post(`/:id/${name}`, requireRole(name as Action), handle((req) => fn(req.params.id, actor(req)))));

countersRouter.post('/:id/redirect', requireRole('redirect'),
  handle((req) => redirect(req.params.id, Redirect.parse(req.body).serviceId, actor(req))));
countersRouter.patch('/:id', requireRole('counter-update'),
  handle((req) => updateCounter(req.params.id, Patch.parse(req.body), actor(req))));
