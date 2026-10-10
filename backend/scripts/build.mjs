/**
 * Production build: a clean dist/ from tsc, plus every non-TS file under src/ the server reads at runtime
 * (the Lab's precomputed.json today). Fails if an entry `node dist/index.js` or a worker thread needs is missing.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'src';
const DIST = 'dist';
const REQUIRED = ['index.js', 'sim/labWorker.js', 'services/suggestWorker.js', 'sim/precomputed.json'];

rmSync(DIST, { recursive: true, force: true }); // no stale files from deleted sources
execSync('npx tsc', { stdio: 'inherit' });

const assets = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile() && !f.name.endsWith('.ts'))
  .map((f) => relative(SRC, join(f.parentPath, f.name)));
for (const a of assets) cpSync(join(SRC, a), join(DIST, a));

const missing = REQUIRED.filter((f) => !existsSync(join(DIST, f)));
if (missing.length) {
  console.error(`Build is missing runtime files: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`Built ${DIST}/ (${assets.length} asset${assets.length === 1 ? '' : 's'} copied: ${assets.join(', ') || 'none'})`);
