import { defineWorkspace } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/testDb.js';

export default defineWorkspace([
  // pure engine + simulator tests: no database
  { test: { name: 'engine', include: ['src/**/*.test.ts'] } },
  // HTTP + WebSocket tests against the separate *_test database
  {
    test: {
      name: 'api',
      include: ['test/**/*.test.ts'],
      globalSetup: ['test/globalSetup.ts'],
      env: { DATABASE_URL: TEST_DATABASE_URL, STAFF_PIN: '1234' },
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } }, // files share one database, so run them one after another
      testTimeout: 20_000,
    },
  },
]);
