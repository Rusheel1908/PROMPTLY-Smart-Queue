import { describe, expect, it } from 'vitest';
import { auditStaff, StaffCounts } from './missAudit.js';

const RULES = { minCalls: 3, flagRatio: 1.5, minExcess: 0.1 };
const row = (name: string, calls: number, misses: number): StaffCounts =>
  ({ staffId: name, name, calls, completes: calls - misses, misses });
const flagged = (rows: StaffCounts[]) => auditStaff(rows, RULES).staff.filter((r) => r.flagged).map((r) => r.name);

describe('auditStaff', () => {
  it('computes each miss rate and the team rate over all calls', () => {
    const r = auditStaff([row('a', 10, 1), row('b', 10, 3)], RULES);
    expect(r.teamRate).toBeCloseTo(0.2);
    expect(r.staff.map((s) => s.missRate)).toEqual([0.1, 0.3]);
  });

  it('flags someone well above the team', () => {
    expect(flagged([row('a', 10, 0), row('b', 10, 1), row('c', 6, 4)])).toEqual(['c']);
  });

  it('does not flag on too few calls', () => {
    expect(flagged([row('a', 10, 0), row('b', 2, 2)])).toEqual([]);
  });

  it('does not flag a small absolute gap, even at a high ratio', () => {
    expect(flagged([row('a', 100, 1), row('b', 100, 5)])).toEqual([]); // 5% vs 3% team
  });

  it('flags nobody when everyone misses at the same rate', () => {
    expect(flagged([row('a', 10, 5), row('b', 10, 5)])).toEqual([]);
  });

  it('has no rates without calls', () => {
    const r = auditStaff([row('a', 0, 0)], RULES);
    expect(r.teamRate).toBeNull();
    expect(r.staff[0]).toMatchObject({ missRate: null, flagged: false });
  });
});
