import { parentPort, workerData } from 'node:worker_threads';
import { suggest, SuggestInput, SuggestResult } from '../engine/suggest.js';
import type { WorkerReply } from '../lib/worker.js';

/** Worker-thread entry: score supervisor suggestions off the main thread and post one reply. */
const reply = (m: WorkerReply<SuggestResult>) => parentPort!.postMessage(m);

try {
  reply({ ok: true, value: suggest(workerData as SuggestInput) });
} catch (e) {
  reply({ ok: false, error: (e as Error).message });
}
