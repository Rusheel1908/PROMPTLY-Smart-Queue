import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { broadcast } from '../realtime.js';

export const tokensRouter = Router();

const CreateToken = z.object({
  serviceId: z.string().min(1),
  class: z.enum(['EMERGENCY', 'PRIORITY', 'APPOINTMENT', 'NORMAL']).default('NORMAL'),
});

const FACTOR = { EMERGENCY: 0.05, PRIORITY: 0.3, APPOINTMENT: 0.2, NORMAL: 1 } as const;

tokensRouter.post('/', async (req, res, next) => {
  try {
    const body = CreateToken.parse(req.body);
    const service = await prisma.service.findUnique({ where: { id: body.serviceId } });
    if (!service) return res.status(404).json({ error: 'Unknown service' });
    const count = await prisma.token.count({ where: { serviceId: service.id } });
    const now = new Date();
    const token = await prisma.token.create({
      data: {
        code: `${service.prefix}-${String(count + 1).padStart(3, '0')}`,
        serviceId: service.id,
        class: body.class,
        deadline: new Date(now.getTime() + service.targetWaitS * 1000 * FACTOR[body.class]),
      },
    });
    await prisma.event.create({ data: { type: 'TOKEN_ISSUED', tokenId: token.id, payload: { class: body.class } } });
    broadcast('token:issued', token);
    res.status(201).json(token);
  } catch (e) { next(e); }
});

tokensRouter.get('/:id', async (req, res, next) => {
  try {
    const token = await prisma.token.findUnique({
      where: { id: req.params.id },
      include: { service: true, etaChanges: { orderBy: { ts: 'desc' } } },
    });
    if (!token) return res.status(404).json({ error: 'Not found' });
    res.json(token);
  } catch (e) { next(e); }
});
