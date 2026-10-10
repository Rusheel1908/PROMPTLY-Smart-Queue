/** API tests run against their own database on the local Docker Postgres, never the dev DB. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@localhost:5432/promptly_test?schema=public';
