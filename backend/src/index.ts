import { createServer } from 'node:http';
import { config, LIMITS } from './config.js';
import { createApp } from './app.js';
import { prisma } from './lib/db.js';
import { attachRealtime, closeRealtime } from './realtime.js';
import { stopLabJobs } from './services/labJobs.js';
import { flushNotifications } from './services/notifier.js';
import { startSuggestions } from './services/suggestions.js';
import { startSweeper } from './services/sweeper.js';

const server = createServer(createApp());
attachRealtime(server);
const stopSweeper = startSweeper();
const stopSuggestions = startSuggestions();
server.listen(config.PORT, () => console.log(`Promptly API on http://localhost:${config.PORT}  (ws: /ws)`));

/** Shutdown order: background work first, then clients, then the database. */
const SHUTDOWN_STEPS: [string, () => Promise<unknown>][] = [
  ['stop sweeper', () => stopSweeper()],
  ['stop suggestions', () => stopSuggestions()],
  ['stop lab worker', stopLabJobs],
  ['finish notifications', flushNotifications],
  ['close websockets', closeRealtime],
  ['close http server', () => httpClosed],
  ['disconnect database', () => prisma.$disconnect()],
];

let shuttingDown = false;
let httpClosed: Promise<unknown> = Promise.resolve();

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down…`);
  setTimeout(() => {
    console.error(`Shutdown took longer than ${LIMITS.shutdownTimeoutMs / 1000} s, forcing exit`);
    process.exit(1);
  }, LIMITS.shutdownTimeoutMs).unref();

  httpClosed = new Promise((resolve) => server.close(resolve)); // stop accepting now; the step below waits for open ones
  server.closeIdleConnections();
  for (const [name, step] of SHUTDOWN_STEPS) {
    await step().catch((e) => console.error(`[shutdown] ${name} failed`, e));
  }
  process.exit(0);
}

(['SIGTERM', 'SIGINT'] as const).forEach((signal) => process.once(signal, () => void shutdown(signal)));
