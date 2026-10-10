import { Worker } from 'node:worker_threads';

/**
 * Under tsx (dev) and Vitest modules load as .ts, so a worker entry is the .ts source and the worker
 * needs tsx's loader registered itself (a new thread does not reliably inherit it). Compiled (node dist/) it is .js.
 */
const EXT = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const EXEC_ARGS = { ts: ['--import', 'tsx'], js: [] };

/** Start a worker thread from an entry under src/, given without extension, e.g. 'sim/labWorker'. */
export const spawnWorker = (entry: string, workerData: unknown) =>
  new Worker(new URL(`../${entry}.${EXT}`, import.meta.url), { workerData, execArgv: [...process.execArgv, ...EXEC_ARGS[EXT]] });

/** The single message a one-shot worker posts back. */
export type WorkerReply<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run a one-shot worker to completion. First outcome wins; the thread is always terminated afterwards. */
export function runWorker<T>(entry: string, workerData: unknown, { timeoutMs }: { timeoutMs: number }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = spawnWorker(entry, workerData);
    let settled = false;
    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outcome();
      void worker.terminate();
    };
    const timer = setTimeout(() => settle(() => reject(new Error(`Worker ${entry} timed out after ${timeoutMs} ms`))), timeoutMs);
    worker.on('message', (m: WorkerReply<T>) => settle(() => (m.ok ? resolve(m.value) : reject(new Error(m.error)))));
    worker.on('error', (e) => settle(() => reject(e)));
    worker.on('exit', () => settle(() => reject(new Error(`Worker ${entry} exited unexpectedly`))));
  });
}
