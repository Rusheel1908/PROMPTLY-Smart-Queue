import type { ArrivalRates } from './arrivals.js';

export type TokenClass ='EMERGENCY' | 'PRIORITY' | 'APPOINTMENT' | 'NORMAL';

export interface EngineToken {
  id: string;
  seq: number;
  serviceId: string;
  cls: TokenClass;
  creditedArrival: number; // ms epoch
  deadline: number;        // ms epoch
  notBefore: number;       // ms epoch
}

export interface EngineCounter {
  id: string;
  open: boolean;
  skills: Set<string>;
  busySince: number | null;   // ms epoch the current token was called, null when idle
  busyService: string | null; // service of the token currently at the counter
}

export interface EngineService {
  id: string;
  targetWaitMs: number;
  mu: number;    // log-mean of service time (minutes)
  sigma: number; // log-sd of service time
}

export interface EngineState {
  services: Record<string, EngineService>;
  counters: Record<string, EngineCounter>;
  waiting: EngineToken[];
  /** Expected future arrivals; when absent the forecast replays only the current queue. */
  arrivals?: ArrivalRates;
  /** Booked appointments not yet checked in: each arrives once at `t` with probability `p`. */
  expected?: ExpectedArrival[];
}

export interface ExpectedArrival {
  id: string;
  serviceId: string;
  t: number;        // ms epoch it would arrive (its slot, or now if the slot has started)
  p: number;        // show-up probability
  deadline: number; // ms epoch, anchored to the slot
}

/** A dispatch policy: given the queue, which token should this counter call now? */
export type Policy = (s: EngineState, counterId: string, now: number) => EngineToken | null;

export const MIN = 60_000;

export const CLASS_FACTOR: Record<TokenClass, number> = {
  EMERGENCY: 0.05, PRIORITY: 0.3, APPOINTMENT: 0.2, NORMAL: 1,
};
/** Strict-priority rank (lower is served first); used by baselines and ablations. */
export const CLASS_RANK: Record<TokenClass, number> = {
  EMERGENCY: 0, PRIORITY: 1, APPOINTMENT: 2, NORMAL: 3,
};
export const HARD_CEILING_FACTOR = 2;
/** Deadlines within the same bucket count as tied, so the scarcity tie-break can act. */
export const DEADLINE_BUCKET_MS = 2 * MIN;
/** Promises are whole minutes, and never sooner than the walk to a counter. */
export const PROMISE_MIN_LEAD_MS = 2 * MIN;

export const CALL_WINDOW_MS = 45_000;    // per call; one auto-recall → 90 s total
export const MISS_GRACE_MS = 2 * MIN;    // missed token re-enters after this delay
export const REENTRY_FACTOR = 0.2;       // re-entry deadline = grace + 0.2 × target
export const MAX_MISSES = 2;             // second miss → NO_SHOW
export const MAX_REDIRECTS = 2;          // anti-gaming cap on arrival credit
