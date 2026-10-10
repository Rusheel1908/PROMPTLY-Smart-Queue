import { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

let wss: WebSocketServer;

export function attachRealtime(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' });
}

/** Push an update to every connected board / status page / console. */
export function broadcast(type: string, data: unknown) {
  if (!wss) return;
  const msg = JSON.stringify({ type, data });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(msg);
}
