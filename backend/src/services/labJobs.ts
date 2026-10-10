import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { must } from '../lib/http.js';
import { broadcast } from '../realtime.js';
import type { EvalOptions } from '../sim/evaluate.js';
import type { LabWorkerMessage } from '../sim/labWorker.js';

/** Live Simulation Lab runs: one at a time, off the main thread, kept in memory only. */
export type LabStatus = 'queued' | 'running' | 'done' | 'failed';
type LabResult = Extract<LabWorkerMessage, { type: 'done' }>['result'];

export interface LabJob {
  id: string; status: LabStatus; params: EvalOptions;
  progress?: number; result?: LabResult & { source: 'live' }; error?: string;
  createdAt: string; finishedAt?: string;
}

export const LAB_TIMEOUT_MS = 60_000;
const KEEP_FINISHED = 5;

/**
 * Under tsx (dev) and Vitest this module is loaded as .ts, so the worker entry is the .ts source and the worker
 * needs tsx's loader registered itself (a new thread does not reliably inherit it). Compiled (node dist/) it is .js.
 */
const EXT = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const WORKER_ARGS = { ts: ['--import', 'tsx'], js: [] };
const WORKER_ENTRY = new URL(`../sim/labWorker.${EXT}`, import.meta.url);

const jobs = new Map<string, LabJob>();
let active: string | null = null;
let activeWorker: Worker | null = null;

const now = () => new Date().toISOString();
const terminal = (j: LabJob) => j.status === 'done' || j.status === 'failed';

/** Drop the oldest finished jobs beyond KEEP_FINISHED (Map keeps insertion order). */
const prune = () => [...jobs.values()].filter(terminal).slice(0, -KEEP_FINISHED).forEach((j) => jobs.delete(j.id));

export const getLabJob = (id: string) => jobs.get(id);

export function startLabJob(params: EvalOptions, { timeoutMs = LAB_TIMEOUT_MS } = {}) {
  must(!active, 409, 'A live lab run is already in progress. Try again when it finishes.');
  const job: LabJob = { id: randomUUID(), status: 'queued', params, createdAt: now() };
  jobs.set(job.id, job);
  active = job.id;

  const worker = new Worker(WORKER_ENTRY, { workerData: params, execArgv: [...process.execArgv, ...WORKER_ARGS[EXT]] });

  /** First terminal event wins; later ones (exit after done, timeout after error) are ignored. */
  const finish = (patch: Pick<LabJob, 'status'> & Partial<LabJob>) => {
    if (terminal(job)) return;
    clearTimeout(timer);
    Object.assign(job, patch, { finishedAt: now() });
    active = null;
    activeWorker = null;
    prune();
    broadcast('lab', { jobId: job.id, status: job.status });
  };

  const ON_MESSAGE: { [K in LabWorkerMessage['type']]: (m: Extract<LabWorkerMessage, { type: K }>) => void } = {
    progress: (m) => { job.progress = m.progress; },
    done: (m) => finish({ status: 'done', progress: 1, result: { ...m.result, source: 'live' } }),
    failed: (m) => finish({ status: 'failed', error: m.error }),
  };

  const timer = setTimeout(() => {
    finish({ status: 'failed', error: `Timed out after ${Math.round(timeoutMs / 1000)} s` });
    void worker.terminate();
  }, timeoutMs);

  worker.on('online', () => { job.status === 'queued' && (job.status = 'running'); });
  worker.on('message', (m: LabWorkerMessage) => (ON_MESSAGE[m.type] as (m: LabWorkerMessage) => void)(m));
  worker.on('error', (e) => finish({ status: 'failed', error: e.message }));
  worker.on('exit', () => finish({ status: 'failed', error: 'Lab worker exited unexpectedly' }));
  activeWorker = worker;
  return job;
}

/** Graceful shutdown: kill a running lab worker (its job ends as failed via the exit handler). */
export const stopLabJobs = async () => { await activeWorker?.terminate(); };
