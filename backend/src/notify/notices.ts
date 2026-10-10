import type { Token } from '@prisma/client';
import type { Band } from '../engine/forecast.js';
import { fmtTime, type Vars } from './messages.js';
import { dedupeKey, isBigDelay, isNextUp, type NotifyEvent } from './rules.js';

/** Pure: which notifications a token or a replan produces, with their message variables and dedupe keys. */

/** The token fields messages may use: code, counter and times only. */
type Subject = Pick<Token, 'code' | 'missCount' | 'notBefore'> & { counterName?: string | null };
interface Extra { p50?: number; deltaS?: number; reason?: string }

const VARS: Record<NotifyEvent, (t: Subject, x: Extra) => Vars> = {
  NEXT_UP: (t, x) => ({ code: t.code, time: fmtTime(x.p50!) }),
  CALLED: (t) => ({ code: t.code, counter: t.counterName ?? 'the counter' }),
  RECALLED: (t) => ({ code: t.code, counter: t.counterName ?? 'the counter' }),
  MISSED: (t) => ({ code: t.code, time: fmtTime(t.notBefore.getTime()) }), // the re-entry time
  NO_SHOW: (t) => ({ code: t.code, misses: t.missCount }),
  BIG_DELAY: (t, x) => ({ code: t.code, minutes: Math.round(x.deltaS! / 60), time: fmtTime(x.p50!), reason: x.reason }),
};

export interface Notice { tokenId: string; event: NotifyEvent; key: string; vars: Vars }

export const notice = (tokenId: string, event: NotifyEvent, t: Subject, x: Extra = {}, round: number | string = t.missCount): Notice =>
  ({ tokenId, event, key: dedupeKey(event, round), vars: VARS[event](t, x) });

export interface ReplanOutcome {
  waiting: (Subject & Pick<Token, 'id'>)[]; // as loaded before the replan
  bands: Record<string, Band>;
  changes: { id: number; tokenId: string; deltaS: number }[]; // EtaChange rows the replan wrote
  reason: string;
  now: number;
}

/** NEXT_UP for the front of the queue, BIG_DELAY for each large shift later. Dedupe happens on insert. */
export function replanNotices({ waiting, bands, changes, reason, now }: ReplanOutcome): Notice[] {
  const byId = Object.fromEntries(waiting.map((t) => [t.id, t]));
  const ranked = waiting.filter((t) => bands[t.id]).sort((a, b) => bands[a.id].p50 - bands[b.id].p50);
  return [
    ...ranked.filter((t, ahead) => isNextUp(ahead, bands[t.id].p50, now))
      .map((t) => notice(t.id, 'NEXT_UP', t, { p50: bands[t.id].p50 })),
    ...changes.filter((c) => isBigDelay(c.deltaS) && byId[c.tokenId] && bands[c.tokenId])
      .map((c) => notice(c.tokenId, 'BIG_DELAY', byId[c.tokenId], { p50: bands[c.tokenId].p50, deltaS: c.deltaS, reason }, c.id)),
  ];
}

