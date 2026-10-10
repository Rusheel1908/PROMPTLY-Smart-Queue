import { MAX_MISSES } from './types.js';

export type TokenState =
  | 'WAITING' | 'CALLED' | 'SERVING' | 'DONE' | 'MISSED' | 'NO_SHOW' | 'REDIRECTED' | 'CANCELLED';

/**
 * WAITING → CALLED → SERVING → DONE, plus side paths.
 * Each action lists the states it may start from and the state it lands in.
 */
export const TRANSITIONS = {
  call:       { from: ['WAITING'], to: 'CALLED' },
  recall:     { from: ['CALLED'], to: 'CALLED' },
  ack:        { from: ['CALLED'], to: 'SERVING' },
  complete:   { from: ['SERVING'], to: 'DONE' },
  miss:       { from: ['CALLED'], to: 'MISSED' },
  redirect:   { from: ['SERVING'], to: 'REDIRECTED' },
  release:    { from: ['CALLED'], to: 'WAITING' },          // counter closed while calling
  away:       { from: ['WAITING'], to: 'WAITING' },          // "I'm stepping away"
  reactivate: { from: ['NO_SHOW', 'MISSED'], to: 'WAITING' },
  cancel:     { from: ['WAITING', 'CALLED', 'MISSED'], to: 'CANCELLED' },
} as const satisfies Record<string, { from: readonly TokenState[]; to: TokenState }>;

export type Action = keyof typeof TRANSITIONS;

export const canTransition = (state: TokenState, action: Action): boolean =>
  (TRANSITIONS[action].from as readonly TokenState[]).includes(state);

/** After a miss the token re-enters the queue, unless this was its last allowed miss. */
export const afterMiss = (missCount: number): TokenState =>
  (['WAITING', 'NO_SHOW'] as const)[Number(missCount + 1 >= MAX_MISSES)];
