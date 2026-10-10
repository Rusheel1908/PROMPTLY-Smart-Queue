/** The backend origin in production (e.g. https://promptly-api.onrender.com); empty in dev, where Vite proxies /api and /ws. */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const SESSION_KEY = 'promptly.session';

/** The staff session token, per browser tab (sessionStorage), so closing the tab logs out. */
export const session = {
  get: () => { try { return sessionStorage.getItem(SESSION_KEY) ?? ''; } catch { return ''; } },
  set: (token: string) => { try { sessionStorage.setItem(SESSION_KEY, token); } catch { /* private mode */ } },
  clear: () => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* private mode */ } },
};

/** Called when the server rejects our session (expired, logged out elsewhere), so the app can show the login screen. */
let onSessionLost = () => undefined as void;
export const setOnSessionLost = (fn: () => void) => { onSessionLost = fn; };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const token = session.get();
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    method: init?.method ?? (init?.json === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...init?.headers },
    body: init?.json === undefined ? init?.body : JSON.stringify(init.json),
  });
  const body = await res.json().catch(() => ({}));
  res.status === 401 && token && (session.clear(), onSessionLost());
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
