import type { TokenState } from './stateMachine.js';

/** An Event row as stored: the log is append-only and ordered by seq. */
export interface LoggedEvent {
  seq: number;
  type: string;
  tokenId: string | null;
  counterId: string | null;
  payload: unknown;
}

export interface ReplayedToken { state: TokenState; missCount: number; counterId: string | null }
type Tokens = Map<string, ReplayedToken>;

const field = <T>(e: LoggedEvent, name: string) => (e.payload as Record<string, T> | null)?.[name];

/** Patch the event's token, if the log has seen it issued. */
const update = (patch: (t: ReplayedToken, e: LoggedEvent) => Partial<ReplayedToken>) => (m: Tokens, e: LoggedEvent) => {
  const t = m.get(e.tokenId ?? '');
  t && Object.assign(t, patch(t, e));
};

/** How each event type changes token state. Types not listed (RECALLED, STEPPED_AWAY, CALL_EMPTY) change none. */
const APPLY: Record<string, (m: Tokens, e: LoggedEvent) => void> = {
  TOKEN_ISSUED: (m, e) => { m.set(e.tokenId!, { state: 'WAITING', missCount: 0, counterId: null }); },
  CALLED: update((_t, e) => ({ state: 'CALLED', counterId: e.counterId })),
  SERVING: update(() => ({ state: 'SERVING' })),
  COMPLETED: update(() => ({ state: 'DONE' })),
  MISSED: update((t, e) => ({ state: field<TokenState>(e, 'outcome'), missCount: t.missCount + 1, counterId: null })),
  CANCELLED: update(() => ({ state: 'CANCELLED', counterId: null })),
  REACTIVATED: update(() => ({ state: 'WAITING', counterId: null })),
  // logged against the new child token; the parent keeps its counter, as in the token table
  REDIRECTED: (m, e) => {
    update(() => ({ state: 'REDIRECTED' }))(m, { ...e, tokenId: field<string>(e, 'parentId') ?? null });
    m.set(e.tokenId!, { state: 'WAITING', missCount: 0, counterId: null });
  },
  COUNTER_CHANGED: (m, e) => {
    for (const id of field<string[]>(e, 'released') ?? []) update(() => ({ state: 'WAITING', counterId: null }))(m, { ...e, tokenId: id });
  },
  DEMO_RESET: (m) => m.clear(),
};

/** Rebuild every token's state, miss count and counter from the event log alone. Pure. */
export function replayTokens(events: LoggedEvent[]): Record<string, ReplayedToken> {
  const tokens: Tokens = new Map();
  [...events].sort((a, b) => a.seq - b.seq).forEach((e) => APPLY[e.type]?.(tokens, e));
  return Object.fromEntries(tokens);
}
