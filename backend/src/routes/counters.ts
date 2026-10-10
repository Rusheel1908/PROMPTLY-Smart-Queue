import { Router } from 'express';
import { z } from 'zod';
import { handle, requireStaff } from '../lib/http.js';
import {
  callNext, complete, miss, recall, redirect, startService, updateCounter,
} from '../services/actions.js';

export const countersRouter = Router();
countersRouter.use(requireStaff);

const Redirect = z.object({ serviceId: z.string().min(1) });
const Patch = z.object({
  status: z.enum(['OPEN', 'PAUSED', 'CLOSED']).optional(),
  skills: z.array(z.string().min(1)).optional(),
});

/** One-line route table: action name → handler. */
const ACTIONS = {
  'call-next': callNext,
  recall,
  ack: startService,
  complete,
  miss,
} as const;

Object.entries(ACTIONS).forEach(([name, fn]) =>
  countersRouter.post(`/:id/${name}`, handle((req) => fn(req.params.id, 'staff'))));

countersRouter.post('/:id/redirect', handle((req) => redirect(req.params.id, Redirect.parse(req.body).serviceId, 'staff')));
countersRouter.patch('/:id', handle((req) => updateCounter(req.params.id, Patch.parse(req.body), 'staff')));
