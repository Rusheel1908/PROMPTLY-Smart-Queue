const BASE = import.meta.env.VITE_API_URL ?? '';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

/** Live updates from the backend WebSocket hub. Returns a cleanup function. */
export function subscribe(onMessage: (msg: { type: string; data: unknown }) => void) {
  const url = BASE ? BASE.replace(/^http/, 'ws') + '/ws' : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const ws = new WebSocket(url);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  return () => ws.close();
}
