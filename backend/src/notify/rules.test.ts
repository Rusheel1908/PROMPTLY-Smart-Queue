import { describe, expect, it } from 'vitest';
import { MIN } from '../engine/types.js';
import { fmtTime, MESSAGES, render, VAR_NAMES, type MessageKey } from './messages.js';
import { notice, replanNotices } from './notices.js';
import { isBigDelay, isNextUp, NOTIFY_RULES, type NotifyEvent } from './rules.js';

const NOW = new Date('2026-10-11T10:30:00').getTime();
const tok = (id: string, over: { missCount?: number; notBefore?: number } = {}) => ({
  id, code: `D-${id}`, missCount: over.missCount ?? 0, notBefore: new Date(over.notBefore ?? NOW),
});
const textOf = (event: NotifyEvent, vars: Parameters<typeof render>[1]) =>
  `${render(NOTIFY_RULES[event].titleKey, vars)} ${render(NOTIFY_RULES[event].bodyKey, vars)}`;

describe('notification rules', () => {
  it('every event has a title and body in English, using only allowed variables', () => {
    for (const rule of Object.values(NOTIFY_RULES)) {
      for (const key of [rule.titleKey, rule.bodyKey] as MessageKey[]) {
        const used = [...MESSAGES.en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        expect(used.every((v) => (VAR_NAMES as readonly string[]).includes(v)), `${key} uses ${used}`).toBe(true);
      }
    }
  });

  it('renders each event with no placeholders left', () => {
    const t = tok('014', { missCount: 2 });
    const cases: [NotifyEvent, ReturnType<typeof notice>][] = [
      ['NEXT_UP', notice('a', 'NEXT_UP', t, { p50: NOW + 2 * MIN })],
      ['CALLED', notice('a', 'CALLED', { ...t, counterName: 'Counter 3' })],
      ['RECALLED', notice('a', 'RECALLED', { ...t, counterName: 'Counter 3' })],
      ['MISSED', notice('a', 'MISSED', t)],
      ['NO_SHOW', notice('a', 'NO_SHOW', t)],
      ['BIG_DELAY', notice('a', 'BIG_DELAY', t, { p50: NOW + 20 * MIN, deltaS: 6 * 60, reason: 'Counter 2 closed' })],
    ];
    for (const [event, n] of cases) expect(textOf(event, n.vars)).not.toMatch(/\{\w+\}/);
    expect(textOf('CALLED', cases[1][1].vars)).toContain('Token D-014: please go to Counter 3 now');
    expect(textOf('NO_SHOW', cases[4][1].vars)).toContain('cancelled after 2 missed calls');
    expect(textOf('BIG_DELAY', cases[5][1].vars)).toContain('Why: Counter 2 closed');
  });

  it('the missed-turn message tells the customer when to come back (the re-entry time)', () => {
    const reentry = NOW + 2 * MIN;
    const n = notice('a', 'MISSED', tok('014', { missCount: 1, notBefore: reentry }));
    expect(textOf('MISSED', n.vars)).toContain(`Come back by ${fmtTime(reentry)}; you'll be called near the front`);
  });

  it('an unknown language falls back to English', () => {
    expect(render('notify.nextUp.title', { code: 'D-1' }, 'xx')).toBe("You're almost up");
  });

  it('next up: 2 or fewer ahead, or expected within 3 minutes', () => {
    expect(isNextUp(2, NOW + 30 * MIN, NOW)).toBe(true);
    expect(isNextUp(3, NOW + 3 * MIN, NOW)).toBe(true);
    expect(isNextUp(3, NOW + 3 * MIN + 1, NOW)).toBe(false);
  });

  it('big delay: later by more than 5 minutes (earlier never counts)', () => {
    expect(isBigDelay(5 * 60)).toBe(false);
    expect(isBigDelay(5 * 60 + 1)).toBe(true);
    expect(isBigDelay(-20 * 60)).toBe(false);
  });

  it('dedupe keys: once per round for queue events, once per ETA change for delays', () => {
    expect(notice('a', 'CALLED', tok('1')).key).toBe('CALLED#0');
    expect(notice('a', 'CALLED', tok('1', { missCount: 1 })).key).toBe('CALLED#1');
    expect(notice('a', 'BIG_DELAY', tok('1'), { p50: NOW, deltaS: 400 }, 77).key).toBe('BIG_DELAY#77');
  });
});

describe('replan notices', () => {
  const waiting = ['1', '2', '3', '4'].map((id) => tok(id));
  const bands = Object.fromEntries(waiting.map((t, i) => [t.id, { p50: NOW + (i + 1) * 10 * MIN, p90: NOW + (i + 2) * 10 * MIN }]));

  it('the first three in expected-call order are next up, whatever their array order', () => {
    const got = replanNotices({ waiting: [...waiting].reverse(), bands, changes: [], reason: 'x', now: NOW });
    expect(got.map((n) => `${n.event}:${n.tokenId}`)).toEqual(['NEXT_UP:1', 'NEXT_UP:2', 'NEXT_UP:3']);
  });

  it('a large later shift becomes BIG_DELAY with the reason; small or earlier shifts do not', () => {
    const changes = [{ id: 9, tokenId: '4', deltaS: 6 * 60 }, { id: 10, tokenId: '3', deltaS: 2 * 60 }, { id: 11, tokenId: '2', deltaS: -9 * 60 }];
    const delays = replanNotices({ waiting, bands, changes, reason: 'Counter 2 closed', now: NOW }).filter((n) => n.event === 'BIG_DELAY');
    expect(delays).toEqual([expect.objectContaining({ tokenId: '4', key: 'BIG_DELAY#9', vars: expect.objectContaining({ minutes: 6, reason: 'Counter 2 closed' }) })]);
  });
});
