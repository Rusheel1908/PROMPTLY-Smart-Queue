import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { TEST_DATABASE_URL } from './testDb.js';

/** Create/sync the test database schema once per run. Refuses anything not named *_test. */
export default function setup() {
  const name = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`Refusing to run API tests against "${name}": database name must end in _test`);
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
