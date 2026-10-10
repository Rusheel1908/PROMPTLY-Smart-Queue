import type { Token } from '@prisma/client';
import { CALL_WINDOW_MS, MIN } from '../engine/types.js';
import { prisma } from '../lib/db.js';
import { broadcast } from '../realtime.js';
import { missToken } from './actions.js';
import { logEvent, replan, serial } from './queue.js';

type Called = Token & { service: { targetWaitS: number }; counter: { name: string } | null };

/** First expiry of the call window → one automatic recall; second → missed turn. */
const ON_EXPIRY: ((t: Called) => Promise<unknown>)[] = [
  async (t) => {
    await prisma.token.update({ where: { id: t.id }, data: { recallCount: { increment: 1 }, lastCallAt: new Date() } });
    await logEvent('RECALLED', { tokenId: t.id, counterId: t.counterId ?? undefined, actor: 'system' });
    broadcast('announce', { code: t.code, tokenId: t.id, counter: t.counter?.name, recall: true });
    broadcast('queue', { reason: 'auto-recall' });
  },
  (t) => missToken(t, 'system'),
];

async function sweepCalls() {
  const expired = await prisma.token.findMany({
    where: { state: 'CALLED', lastCallAt: { lt: new Date(Date.now() - CALL_WINDOW_MS) } },
    include: { service: { select: { targetWaitS: true } }, counter: { select: { name: true } } },
  });
  for (const t of expired) await ON_EXPIRY[Math.min(t.recallCount, 1)](t);
}

/** Background loops: call-window enforcement every 5 s, re-forecast every 30 s as time passes. */
export function startSweeper() {
  const safely = (fn: () => Promise<unknown>) => () => { serial(fn).catch((e) => console.error('[sweeper]', e)); };
  setInterval(safely(sweepCalls), 5_000);
  setInterval(safely(() => replan('Services running longer or shorter than expected', undefined, 3 * MIN)), 30_000);
  safely(() => replan('Server started'))();
}
