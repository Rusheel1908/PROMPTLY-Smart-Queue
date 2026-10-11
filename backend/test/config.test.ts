import { describe, expect, it } from 'vitest';
import { describeProblems, isAllowedOrigin, parseConfig } from '../src/config.js';

const BASE = { DATABASE_URL: 'postgresql://u:p@localhost:5432/promptly', NODE_ENV: 'production' };

describe('staff authentication', () => {
  it('no longer has a shared staff PIN: production starts without one, and a leftover one is ignored', () => {
    expect(parseConfig(BASE).success).toBe(true);
    const r = parseConfig({ ...BASE, STAFF_PIN: '1234' });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty('STAFF_PIN');
  });
});

describe('web push keys', () => {
  const KEYS = { VAPID_PUBLIC_KEY: 'BPub_key-1', VAPID_PRIVATE_KEY: 'priv_key-1', VAPID_SUBJECT: 'mailto:ops@example.com' };

  it('all three or none: none (or empty values) means push is off, not an error', () => {
    expect(parseConfig(BASE).data?.VAPID_PUBLIC_KEY).toBeUndefined();
    expect(parseConfig({ ...BASE, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' }).success).toBe(true);
    expect(parseConfig({ ...BASE, ...KEYS }).data).toMatchObject(KEYS);
  });

  it('a partial set names each missing variable; a bad subject or key is rejected', () => {
    const partial = parseConfig({ ...BASE, VAPID_PUBLIC_KEY: KEYS.VAPID_PUBLIC_KEY });
    expect(describeProblems(partial.error!)).toContain('VAPID_PRIVATE_KEY: is required when any of');
    expect(partial.error!.issues.map((i) => i.path[0])).toEqual(['VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);
    expect(parseConfig({ ...BASE, ...KEYS, VAPID_SUBJECT: 'ops@example.com' }).error!.issues[0].path).toEqual(['VAPID_SUBJECT']);
    expect(parseConfig({ ...BASE, ...KEYS, VAPID_PRIVATE_KEY: 'has spaces=' }).error!.issues[0].path).toEqual(['VAPID_PRIVATE_KEY']);
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

  it('allowed origins: the CORS_ORIGIN list, plus cloudflared quick tunnels in development only', () => {
    const dev = { CORS_ORIGIN: ['http://localhost:5173'], NODE_ENV: 'development' as const };
    const tunnel = 'https://simple-tails-anyway-cooper.trycloudflare.com';
    expect(isAllowedOrigin('http://localhost:5173', dev)).toBe(true);
    expect(isAllowedOrigin(tunnel, dev)).toBe(true);
    for (const other of ['http://simple-tails.trycloudflare.com', 'https://trycloudflare.com', 'https://a.trycloudflare.com.evil.example',
      'https://evil-trycloudflare.com', 'https://a.trycloudflare.com/x', 'https://evil.example']) {
      expect(isAllowedOrigin(other, dev)).toBe(false);
    }
    expect(isAllowedOrigin(tunnel, { ...dev, NODE_ENV: 'production' })).toBe(false);
    expect(isAllowedOrigin(tunnel, { ...dev, NODE_ENV: 'test' })).toBe(false);
  });

  it('lists every problem at once', () => {
    const r = parseConfig({ NODE_ENV: 'production', PORT: 'abc', CORS_ORIGIN: 'not-a-url' });
    const paths = r.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['PORT', 'DATABASE_URL', 'CORS_ORIGIN']));
  });
});
