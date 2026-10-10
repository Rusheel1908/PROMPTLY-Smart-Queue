import { useCallback, useEffect, useRef, useState } from 'react';
import { api, subscribe } from './api';
import type { Announcement, PublicSnapshot, Snapshot, Suggestions } from './types';

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

/** Socket pings come in bursts (one per queue change); refetch at most once per this many ms. */
const REFETCH_GAP_MS = 2000;

/**
 * Throttle a socket-triggered refetch: run now if the last run was over `ms` ago, otherwise once at the end of the
 * window, however many pings arrive meanwhile. Keeps open pages (one per customer phone) from hammering the API.
 */
export function useThrottled(fn: () => void, ms = REFETCH_GAP_MS) {
  const ref = useRef(fn);
  ref.current = fn;
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(() => {
    if (timer.current) return; // a run is already scheduled for the end of this window
    const run = () => { timer.current = undefined; last.current = Date.now(); ref.current(); };
    const wait = last.current + ms - Date.now();
    if (wait <= 0) run();
    else timer.current = setTimeout(run, wait);
  }, [ms]);
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
 * Live queue snapshot: fetched once, re-fetched on "queue" pings (at most once per 2 s, and never two at once).
 * Staff screens get the full Snapshot (the api helper sends the session token); public screens type it as PublicSnapshot.
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
  const onPing = useThrottled(refresh);
  useSocket((m) => { m.type === 'queue' && onPing(); });
  return { snap, error, refresh };
}

/**
 * Supervisor suggestions: fetched with the staff session (the api helper sends it) and re-fetched on the
 * bare "suggestions-updated" ping. The details never travel over the public WebSocket.
 */
export function useSuggestions() {
  const [data, setData] = useState<Suggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => api<Suggestions>('/ops/suggestions')
    .then((d) => { setData(d); setError(null); })
    .catch((e) => setError(e.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const onPing = useThrottled(refresh);
  useSocket((m) => { m.type === 'suggestions-updated' && onPing(); });
  return { data, error, refresh };
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
