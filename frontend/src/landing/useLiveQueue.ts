import { useMemo } from 'react';
import { useSnapshot } from '../lib/live';
import type { PublicSnapshot } from '../lib/types';
import { LANDING, type GateState } from './config';

export interface LiveQueue {
  /** True only while the latest /api/snapshot call succeeded; otherwise the scene runs its demo loop and no numbers are shown. */
  live: boolean;
  loading: boolean;
  waiting: number;
  missed: number;
  openCounters: number;
  totalCounters: number;
  /** Share of today's called tokens that were called by their promise; null when none has come due yet. */
  promiseKept: number | null;
  /** The first five real counters, in API order (the scene has five gates). */
  gates: GateState[];
  /** serviceId → tint from the app's chart palette, in service order. */
  serviceColors: Record<string, string>;
  /** Waiting tokens' service ids, so live particles can be tinted by their real service. */
  waitingServices: string[];
}

/** The public snapshot reshaped for the landing page. Reuses the app's own live hook (fetch + WebSocket refresh). */
export function useLiveQueue(): LiveQueue {
  const { snap, error } = useSnapshot<PublicSnapshot>();
  return useMemo(() => {
    const live = !!snap && !error;
    if (!snap) {
      return { live: false, loading: !error, waiting: 0, missed: 0, openCounters: 0, totalCounters: 0, promiseKept: null, gates: [], serviceColors: {}, waitingServices: [] };
    }
    const serviceColors = Object.fromEntries(snap.services.map((s, i) => [s.id, LANDING.serviceColors[i % LANDING.serviceColors.length]]));
    return {
      live,
      loading: false,
      waiting: snap.metrics.waiting,
      missed: snap.tokens.filter((t) => t.state === 'MISSED').length,
      openCounters: snap.counters.filter((c) => c.status === 'OPEN').length,
      totalCounters: snap.counters.length,
      promiseKept: snap.metrics.promiseKept,
      gates: snap.counters.slice(0, LANDING.gates.length).map((c) => ({ name: c.name, open: c.status === 'OPEN' })),
      serviceColors,
      waitingServices: snap.tokens.filter((t) => t.state === 'WAITING').map((t) => t.serviceId),
    };
  }, [snap, error]);
}
