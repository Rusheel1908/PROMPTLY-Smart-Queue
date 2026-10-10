import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluate, SPECS } from './evaluate.js';

/** `npm run lab:snapshot`: the full evaluation the Lab page shows on load. SYNTHETIC data. */
const params = { days: 30, seed: 1, runs: 40, sampleEvery: 3, policies: Object.keys(SPECS) };
const out = fileURLToPath(new URL('./precomputed.json', import.meta.url));

const started = Date.now();
const result = evaluate({
  ...params,
  onProgress: (done, total) => process.stdout.write(`\r${done}/${total} policy-days`),
});
const snapshot = { source: 'precomputed' as const, generatedAt: new Date().toISOString(), params, ...result };
writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`\nWrote ${out} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
