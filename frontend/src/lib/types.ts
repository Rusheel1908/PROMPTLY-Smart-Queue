export type TokenClass = 'EMERGENCY' | 'PRIORITY' | 'APPOINTMENT' | 'NORMAL';
export type TokenState =
  | 'WAITING' | 'CALLED' | 'SERVING' | 'DONE' | 'MISSED' | 'NO_SHOW' | 'REDIRECTED' | 'CANCELLED';
export type CounterStatus = 'OPEN' | 'PAUSED' | 'CLOSED';

export interface Quote { p50Min: number; p90Min: number }

export interface Service {
  id: string; name: string; prefix: string; icon: string; targetWaitMin: number;
  meanServiceMin: number; learnedFrom: number; waiting: number; capable: number; quote: Quote | null;
}

export interface Token {
  id: string; code: string; serviceId: string; class: TokenClass; state: TokenState; counterId: string | null;
  arrivedAt: string; deadline: string; notBefore: string; calledAt: string | null; servedAt: string | null;
  etaP50: string | null; etaP90: string | null; promiseP90: string | null; missCount: number; pickReason: string | null;
  waitMin: number; etaMin: number | null; position: number | null; unavailable: boolean; atRisk: boolean;
}

export interface Counter {
  id: string; name: string; status: CounterStatus; skills: string[]; current: Token | null;
}

/** What the public snapshot carries per token: board fields only, no token id. */
export type BoardToken = Pick<Token, 'code' | 'serviceId' | 'state' | 'counterId' | 'etaMin' | 'position' | 'unavailable'>;

export interface QueueEvent {
  seq: number; ts: string; type: string; payload: Record<string, unknown> | null; code: string | null; counter: string | null;
  actor: string | null; actorName: string | null; // staff id (or kiosk/system) and its display name
}

export interface Metrics {
  issued: number; served: number; noShows: number; missed: number; waiting: number; atRisk: number;
  promiseKept: number | null; waitByClass: Record<TokenClass, number | null>;
}

export interface Snapshot {
  now: number;
  services: Service[];
  counters: Counter[];
  tokens: Token[];
  recentCalls: { id: string; code: string; counter: string | null; calledAt: string; state: TokenState }[];
  events: QueueEvent[];
  metrics: Metrics;
}

/** Snapshot without a staff session (Board, Kiosk). The staff Snapshot is a superset of it. */
export interface PublicSnapshot extends Omit<Snapshot, 'counters' | 'tokens' | 'recentCalls'> {
  counters: (Pick<Counter, 'id' | 'name' | 'status'> & { current: BoardToken | null })[];
  tokens: BoardToken[];
  recentCalls: Omit<Snapshot['recentCalls'][number], 'id'>[];
}

/** Customer notification events (backend/src/notify/rules.ts). */
export type NotifyEvent = 'NEXT_UP' | 'CALLED' | 'RECALLED' | 'MISSED' | 'NO_SHOW' | 'BIG_DELAY';
export interface TokenNotification { id: number; event: NotifyEvent; ts: string; title: string; body: string; urgency: 'normal' | 'high' }

export interface TokenDetail extends Token {
  serviceName: string; counterName: string | null; ahead: number; queueSize: number;
  changes: { ts: string; deltaS: number; reason: string }[];
  child: { id: string; code: string; key: string } | null; // key: the child's own access key
  notifications: TokenNotification[]; // newest first
}

export interface Announcement { code: string; counter: string; recall: boolean }

export interface LabPolicyResult {
  id: string; label: string; group: 'baseline' | 'fairline' | 'ablation';
  waitByClass: Record<TokenClass, { mean: number; p95: number; n: number }>;
  maxNormalWait: number; promiseKept: number; etaMae: number; utilization: number;
  starvation: number; missRecovery: number; noShows: number; served: number;
  perDay: { day: number; maxNormalWait: number; meanWait: number }[];
}

export interface LabResult {
  synthetic: true; days: number; seed: number; runs: number; sampleEvery: number;
  arrivalsPerDay: number; elapsedMs: number; results: LabPolicyResult[];
  source: 'precomputed' | 'live';
  generatedAt?: string; // precomputed: when `npm run lab:snapshot` ran
}

export interface LabJob {
  id: string; status: 'queued' | 'running' | 'done' | 'failed';
  progress?: number; result?: LabResult; error?: string; createdAt: string; finishedAt?: string;
}

/** A supervisor suggestion from GET /api/ops/suggestions (staff only). */
export interface Suggestion {
  id: string;
  score: number;
  change: {
    kind: 'add-skill' | 'reopen'; counterId: string; counterName: string;
    serviceId: string | null; serviceName: string | null; patch: { status?: CounterStatus; skills?: string[] };
  };
  explanation: string;
  numbers: {
    avgMinutesSaved: number; promisesRescued: number; promisesBroken: number; newlyServable: number;
    madeWorse: number; madeWorseMin: number;
  };
  bar: { serviceName: string; beforeMin: number | null; afterMin: number | null };
}
export interface Suggestions {
  computedAt: string;
  timing: { screenMs: number; rescoreMs: number; totalMs: number; candidates: number; waiting: number };
  suggestions: Suggestion[];
}

/* ---------- staff accounts ---------- */

export type StaffRole = 'STAFF' | 'SUPERVISOR';
export interface StaffUser { id: string; name: string; role: StaffRole }
/** Action names from the backend PERMISSIONS table (backend/src/lib/permissions.ts). */
export type Permission =
  | 'call-next' | 'recall' | 'ack' | 'complete' | 'miss' | 'redirect' | 'issue-priority' | 'view-token' | 'reactivate'
  | 'counter-update' | 'whatif' | 'view-suggestions' | 'apply-suggestion' | 'staff-stats' | 'lab-run' | 'demo';
/** GET /api/auth/me */
export interface Me { staff: StaffUser; expiresAt: string; permissions: Permission[] }
export interface LoginResult { token: string; staff: StaffUser; expiresAt: string }

/** GET /api/ops/staff-stats (supervisor only): today's per-staff miss audit. */
export interface StaffStats {
  teamRate: number | null;
  rules: { minCalls: number; flagRatio: number; minExcess: number };
  staff: { staffId: string; name: string; calls: number; completes: number; misses: number; missRate: number | null; flagged: boolean }[];
}
