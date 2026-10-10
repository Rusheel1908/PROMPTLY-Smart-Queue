import { describe, expect, it } from 'vitest';
import { describeProblems, parseConfig } from '../src/config.js';

const BASE = { DATABASE_URL: 'postgresql://u:p@localhost:5432/promptly', NODE_ENV: 'production' };
const STRONG = 'k7#Qm2-vR9';

const pinProblem = (env: object) => {
  const r = parseConfig(env);
  expect(r.success).toBe(false);
  return r.error!.issues.find((i) => i.path[0] === 'STAFF_PIN')?.message;
};

describe('production staff PIN', () => {
  it.each([
    ['missing', {}, /required/],
    ['empty', { STAFF_PIN: '' }, /required/],
    ['short', { STAFF_PIN: '98765' }, /at least 6/],
    ['the dev default', { STAFF_PIN: '1234' }, /default/],
  ])('rejects a %s PIN', (_name, pin, message) => {
    expect(pinProblem({ ...BASE, ...pin })).toMatch(message);
  });

  it('accepts a strong PIN', () => {
    const r = parseConfig({ ...BASE, STAFF_PIN: STRONG });
    expect(r.success).toBe(true);
    expect(r.data!.STAFF_PIN).toBe(STRONG);
  });

  it('never echoes the PIN in the error output', () => {
    const r = parseConfig({ ...BASE, STAFF_PIN: 'abc12' });
    expect(describeProblems(r.error!)).not.toContain('abc12');
  });
});

describe('other variables', () => {
  it('dev defaults the PIN to 1234 and parses CORS and proxy settings', () => {
    const r = parseConfig({
      DATABASE_URL: BASE.DATABASE_URL,
      CORS_ORIGIN: 'https://a.example.com/, http://localhost:5173',
      TRUST_PROXY: '1',
    });
    expect(r.data).toMatchObject({
      NODE_ENV: 'development', PORT: 4000, STAFF_PIN: '1234',
      CORS_ORIGIN: ['https://a.example.com', 'http://localhost:5173'], TRUST_PROXY: 1,
    });
  });

  it('lists every problem at once', () => {
    const r = parseConfig({ NODE_ENV: 'production', PORT: 'abc', CORS_ORIGIN: 'not-a-url' });
    const paths = r.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['PORT', 'DATABASE_URL', 'CORS_ORIGIN']));
  });
});
