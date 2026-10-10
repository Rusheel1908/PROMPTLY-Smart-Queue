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

export interface QueueEvent {
  seq: number; ts: string; type: string; payload: Record<string, unknown> | null; code: string | null; counter: string | null;
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

export interface TokenDetail extends Token {
  serviceName: string; counterName: string | null; ahead: number; queueSize: number;
  changes: { ts: string; deltaS: number; reason: string }[];
  child: { id: string; code: string } | null;
}

export interface Announcement { code: string; tokenId: string; counter: string; recall: boolean }

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
}
