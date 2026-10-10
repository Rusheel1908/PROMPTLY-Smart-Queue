import { describe, expect, it } from 'vitest';
import { describeProblems, parseConfig } from '../src/config.js';

const BASE = { DATABASE_URL: 'postgresql://u:p@localhost:5432/promptly', NODE_ENV: 'production' };

describe('staff authentication', () => {
  it('no longer has a shared staff PIN: production starts without one, and a leftover one is ignored', () => {
    expect(parseConfig(BASE).success).toBe(true);
    const r = parseConfig({ ...BASE, STAFF_PIN: '1234' });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty('STAFF_PIN');
  });
});

describe('other variables', () => {
  it('dev defaults, and parses CORS and proxy settings', () => {
    const r = parseConfig({
      DATABASE_URL: BASE.DATABASE_URL,
      CORS_ORIGIN: 'https://a.example.com/, http://localhost:5173',
      TRUST_PROXY: '1',
    });
    expect(r.data).toMatchObject({
      NODE_ENV: 'development', PORT: 4000,
      CORS_ORIGIN: ['https://a.example.com', 'http://localhost:5173'], TRUST_PROXY: 1,
    });
  });

  it('lists every problem at once', () => {
    const r = parseConfig({ NODE_ENV: 'production', PORT: 'abc', CORS_ORIGIN: 'not-a-url' });
    const paths = r.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['PORT', 'DATABASE_URL', 'CORS_ORIGIN']));
  });
});
