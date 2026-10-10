import { AlertTriangle, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cx, pct } from '../lib/format';
import type { StaffStats as Stats } from '../lib/types';
import { Card, Skeleton } from './ui';

/** Today's miss audit per staff member (supervisor only). `version` changes whenever the event log moves, to re-fetch. */
export function StaffStats({ version }: { version: number | undefined }) {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Stats>('/ops/staff-stats').then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, [version]);

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <UserCheck className="size-5 text-brand" />
        <div>
          <div className="font-semibold">Staff today</div>
          <div className="text-xs text-muted">
            Calls, completes and misses each person made. Team miss rate {pct(data?.teamRate)}.
            Flagged at {data ? `${data.rules.flagRatio}× the team rate and +${pct(data.rules.minExcess)}` : '…'}, after {data?.rules.minCalls ?? '…'} calls.
          </div>
        </div>
      </div>
      {!data && !error && <Skeleton className="h-24" />}
      {error && !data && <p className="text-sm text-critical">{error}</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-1.5 pr-3 font-semibold">Staff</th>
                <th className="px-3 text-right font-semibold">Calls</th>
                <th className="px-3 text-right font-semibold">Completes</th>
                <th className="px-3 text-right font-semibold">Misses</th>
                <th className="pl-3 text-right font-semibold">Miss rate</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {data.staff.map((s) => (
                <tr key={s.staffId} className={cx('border-t border-line', s.flagged && 'bg-red-50 text-red-900')}>
                  <td className="py-2 pr-3 font-semibold">
                    <span className="flex items-center gap-2">
                      {s.name}
                      {s.flagged && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-critical px-1.5 py-0.5 text-[11px] font-semibold text-white">
                          <AlertTriangle className="size-3" /> well above team avg
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 text-right">{s.calls}</td>
                  <td className="px-3 text-right">{s.completes}</td>
                  <td className="px-3 text-right">{s.misses}</td>
                  <td className={cx('pl-3 text-right', s.flagged && 'font-bold text-critical')}>{pct(s.missRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">Only misses a person marked by hand count. Automatic misses after the call window are not anyone's.</p>
        </div>
      )}
    </Card>
  );
}
