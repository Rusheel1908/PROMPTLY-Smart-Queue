export type TokenClass = 'EMERGENCY' | 'PRIORITY' | 'APPOINTMENT' | 'NORMAL';

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
  busyUntil: number;
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
}

export const CLASS_FACTOR: Record<TokenClass, number> = {
  EMERGENCY: 0.05, PRIORITY: 0.3, APPOINTMENT: 0.2, NORMAL: 1,
};
export const HARD_CEILING_FACTOR = 2;
