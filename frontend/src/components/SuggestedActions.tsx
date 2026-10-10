import { AnimatePresence, motion } from 'framer-motion';
import { Check, Lightbulb, Scale, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { cx, fmtMin } from '../lib/format';
import { useSuggestions } from '../lib/live';
import type { Suggestion } from '../lib/types';
import { Button, Card, Skeleton, useAction } from './ui';

/** System-proposed counter changes, best first. Apply asks for confirmation, then uses the normal counter update. */
export function SuggestedActions({ onApplied }: { onApplied: () => void }) {
  const { data, error, refresh } = useSuggestions();
  const [confirming, setConfirming] = useState<string | null>(null);
  const { run, busy } = useAction();

  // a stale suggestion answers 409 with a "refresh" message (shown as a toast); either way, fetch the current set
  const apply = (s: Suggestion) => run(s.id,
    () => api(`/ops/suggestions/${encodeURIComponent(s.id)}/apply`, { json: {} }),
    () => `Applied: ${actionOf(s)}`,
  ).then(() => { setConfirming(null); refresh(); onApplied(); });

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Lightbulb className="size-5 text-brand" />
        <div>
          <div className="font-semibold">Suggested actions</div>
          <div className="text-xs text-muted">Simulated on the live queue. Nothing changes until you apply one.</div>
        </div>
      </div>

      {!data && !error && <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
      {error && !data && <p className="text-sm text-critical">{error}</p>}
      {data && data.suggestions.length === 0 && (
        <p className="flex items-center gap-2 rounded-xl bg-page p-3 text-sm text-ink-2">
          <Scale className="size-4" /> Queue looks balanced, no changes needed.
        </p>
      )}

      <ul className="grid gap-2">
        <AnimatePresence initial={false}>
          {data?.suggestions.map((s) => (
            <motion.li key={s.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap items-center gap-4 rounded-xl p-3 ring-1 ring-line">
              <div className="min-w-0 flex-1">
                <div className="text-sm"><b>{actionOf(s)}</b>{benefitOf(s) && <span className="text-ink-2"> → {benefitOf(s)}</span>}</div>
                <BeforeAfter bar={s.bar} />
              </div>
              {confirming === s.id ? (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" icon={X} onClick={() => setConfirming(null)}>Cancel</Button>
                  <Button size="sm" icon={Check} loading={busy === s.id} onClick={() => apply(s)}>Confirm</Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirming(s.id)}>Apply</Button>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Card>
  );
}

/** "Add Loans to Counter 5 → …": the action before the arrow, the benefit after it. */
const actionOf = (s: Suggestion) => s.explanation.split(' → ')[0];
const benefitOf = (s: Suggestion) => s.explanation.split(' → ').slice(1).join(' → ');

/** Average expected wait of the service it helps most, before vs after (no bar = no counter could serve). */
function BeforeAfter({ bar }: { bar: Suggestion['bar'] }) {
  const max = Math.max(bar.beforeMin ?? 0, bar.afterMin ?? 0, 1);
  const rows = [
    { label: 'Now', min: bar.beforeMin, cls: 'bg-slate-300' },
    { label: 'After', min: bar.afterMin, cls: 'bg-brand' },
  ];
  return (
    <div className="mt-2 grid max-w-sm gap-1 text-[11px] text-muted">
      <div>{bar.serviceName} wait</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-9">{r.label}</span>
          <div className="h-1.5 flex-1 rounded-full bg-slate-100">
            {r.min != null && (
              <motion.div className={cx('h-1.5 rounded-full', r.cls)} initial={{ width: 0 }} animate={{ width: `${(100 * r.min) / max}%` }} />
            )}
          </div>
          <span className="w-20 text-right">{r.min == null ? 'unavailable' : fmtMin(r.min)}</span>
        </div>
      ))}
    </div>
  );
}
