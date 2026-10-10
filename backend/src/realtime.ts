import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { config, LIMITS } from './config.js';

let wss: WebSocketServer | undefined;

/** Browsers always send Origin; only non-browser clients (curl, tests) omit it, which production does not allow. */
const ALLOW_NO_ORIGIN = { development: true, test: true, production: false } as const;

/** First failing rule rejects the upgrade with its HTTP status. */
const UPGRADE_RULES: [(req: IncomingMessage, hub: WebSocketServer) => boolean, number, string][] = [
  [(req) => (req.headers.origin ? config.CORS_ORIGIN.includes(req.headers.origin) : ALLOW_NO_ORIGIN[config.NODE_ENV]), 403, 'Origin not allowed'],
  [(_req, hub) => hub.clients.size < LIMITS.wsMaxConnections, 503, 'Too many connections'],
];

export function attachRealtime(server: Server) {
  const hub: WebSocketServer = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: ({ req }, done) => {
      const rejected = UPGRADE_RULES.find(([ok]) => !ok(req, hub));
      rejected ? done(false, rejected[1], rejected[2]) : done(true);
    },
  });
  wss = hub;
}

/** Drop every client and stop the hub (graceful shutdown). */
export function closeRealtime() {
  const hub = wss;
  wss = undefined;
  if (!hub) return Promise.resolve();
  hub.clients.forEach((client) => client.terminate());
  return new Promise<void>((resolve) => hub.close(() => resolve()));
}

/** Push an update to every connected board / status page / console. */
export function broadcast(type: string, data: unknown) {
  if (!wss) return;
  const msg = JSON.stringify({ type, data });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(msg);
}
