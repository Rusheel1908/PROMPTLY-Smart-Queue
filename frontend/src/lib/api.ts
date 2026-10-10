const BASE = import.meta.env.VITE_API_URL ?? '';
const PIN_KEY = 'promptly.staffPin';

const storage = {
  get: () => { try { return localStorage.getItem(PIN_KEY) ?? ''; } catch { return ''; } },
  set: (v: string) => { try { localStorage.setItem(PIN_KEY, v); } catch { /* private mode */ } },
};

export const staffPin = { get: storage.get, set: storage.set, clear: () => storage.set('') };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    method: init?.method ?? (init?.json === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', 'x-staff-pin': staffPin.get(), ...init?.headers },
    body: init?.json === undefined ? init?.body : JSON.stringify(init.json),
  });
  const body = await res.json().catch(() => ({}));
  res.ok || raise(new ApiError(res.status, body.error ?? res.statusText));
  return body as T;
}

const raise = (e: Error): never => { throw e; };

/** Live updates from the backend WebSocket hub, reconnecting with backoff. Returns a cleanup function. */
export function subscribe(
  onMessage: (msg: { type: string; data: unknown }) => void,
  onStatus: (connected: boolean) => void = () => undefined,
) {
  const url = BASE ? BASE.replace(/^http/, 'ws') + '/ws' : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  let ws: WebSocket;
  let closed = false;
  let delay = 500;
  let timer: ReturnType<typeof setTimeout>;
  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => { delay = 500; onStatus(true); };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      onStatus(false);
      timer = setTimeout(() => closed || connect(), delay);
      delay = Math.min(delay * 2, 8000);
    };
  };
  connect();
  return () => { closed = true; clearTimeout(timer); ws.close(); };
}
