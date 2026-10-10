/** Pure: per-staff miss rates against the team rate, with outliers flagged. No I/O, so it is unit-tested directly. */

export interface StaffCounts { staffId: string; name: string; calls: number; completes: number; misses: number }
export interface AuditRules { minCalls: number; flagRatio: number; minExcess: number }

const rate = (misses: number, calls: number) => (calls ? misses / calls : null);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Flagged only when every rule holds: enough calls to judge, and well above the team in ratio and in points. */
const FLAG_RULES: ((r: number, team: number, row: StaffCounts, cfg: AuditRules) => boolean)[] = [
  (_r, _team, row, cfg) => row.calls >= cfg.minCalls,
  (r, team, _row, cfg) => r >= team * cfg.flagRatio,
  (r, team, _row, cfg) => r - team >= cfg.minExcess,
];

export function auditStaff(rows: StaffCounts[], cfg: AuditRules) {
  const teamRate = rate(sum(rows.map((r) => r.misses)), sum(rows.map((r) => r.calls)));
  return {
    teamRate,
    rules: cfg,
    staff: rows.map((row) => {
      const missRate = rate(row.misses, row.calls);
      const flagged = missRate != null && teamRate != null && FLAG_RULES.every((ok) => ok(missRate, teamRate, row, cfg));
      return { ...row, missRate, flagged };
    }),
  };
}
