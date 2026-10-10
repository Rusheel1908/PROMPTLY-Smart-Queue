import { parentPort, workerData } from 'node:worker_threads';
import { evaluate, EvalOptions } from './evaluate.js';

/** Worker-thread entry for a live Lab run. Messages: progress (0..1, whole percents) → done | failed. */
const post = (msg: LabWorkerMessage) => parentPort!.postMessage(msg);

export type LabWorkerMessage =
  | { type: 'progress'; progress: number }
  | { type: 'done'; result: ReturnType<typeof evaluate> }
  | { type: 'failed'; error: string };

let lastPct = -1;
const onProgress = (done: number, total: number) => {
  const pct = Math.floor((100 * done) / total);
  pct > lastPct && post({ type: 'progress', progress: pct / 100 });
  lastPct = pct;
};

try {
  post({ type: 'done', result: evaluate({ ...(workerData as EvalOptions), onProgress }) });
} catch (e) {
  post({ type: 'failed', error: (e as Error).message });
}
