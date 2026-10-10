import { useCallback, useEffect, useRef, useState } from 'react';
import { api, subscribe } from './api';
import type { Announcement, PublicSnapshot, Snapshot } from './types';

type Listener = (msg: { type: string; data: unknown }) => void;

/** One shared WebSocket for the whole app; components register listeners. */
const listeners = new Set<Listener>();
const statusListeners = new Set<(c: boolean) => void>();
let connected = false;
let stop: (() => void) | null = null;

function ensureSocket() {
  stop ??= subscribe(
    (msg) => listeners.forEach((l) => l(msg)),
    (c) => { connected = c; statusListeners.forEach((l) => l(c)); },
  );
}

export function useSocket(listener: Listener) {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => {
    ensureSocket();
    const l: Listener = (m) => ref.current(m);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}

export function useConnected() {
  const [c, setC] = useState(connected);
  useEffect(() => {
    ensureSocket();
    statusListeners.add(setC);
    return () => { statusListeners.delete(setC); };
  }, []);
  return c;
}

/**
 * Live queue snapshot: fetched once, re-fetched (coalesced) on every "queue" ping.
 * Staff screens get the full Snapshot (the api helper sends the PIN); public screens type it as PublicSnapshot.
 */
export function useSnapshot<S extends PublicSnapshot = Snapshot>() {
  const [snap, setSnap] = useState<S | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const queued = useRef(false);

  // bursts of pings collapse into at most one extra fetch
  const refresh = useCallback(() => {
    queued.current = true;
    inflight.current || drain();
  }, []);

  async function drain() {
    inflight.current = true;
    while (queued.current) {
      queued.current = false;
      await api<S>('/snapshot').then((s) => { setSnap(s); setError(null); }).catch((e) => setError(e.message));
    }
    inflight.current = false;
  }

  useEffect(() => { refresh(); }, [refresh]);
  useSocket((m) => { m.type === 'queue' && refresh(); });
  return { snap, error, refresh };
}

export function useAnnouncements(onAnnounce: (a: Announcement) => void) {
  useSocket((m) => { m.type === 'announce' && onAnnounce(m.data as Announcement); });
}

/** Re-render every `ms` so relative times tick. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
