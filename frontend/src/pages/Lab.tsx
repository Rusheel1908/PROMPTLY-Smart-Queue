import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, FlaskConical, Info, Play, Table2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Button, Card, Chip, Segmented, Skeleton, useAction } from '../components/ui';
import { api } from '../lib/api';
import { cx, pct } from '../lib/format';
import type { LabPolicyResult, LabResult } from '../lib/types';

/** Emphasis encoding by policy group (legend shown above the charts). */
const GROUP = {
  fairline: { color: '#2a78d6', label: 'Fairline' },
  baseline: { color: '#898781', label: 'Baselines' },
  ablation: { color: '#9ec5f4', label: 'Ablations' },
} as const;

/** Fixed series colors per entity for the per-day chart. */
const DAY_SERIES = [
  { id: 'F', color: 'var(--color-s1)' },
  { id: 'B1', color: 'var(--color-s2)' },
  { id: 'B2', color: 'var(--color-s3)' },
];

const METRICS: { key: keyof LabPolicyResult; title: string; unit: string; better: 'lower' | 'higher'; fmt: (v: number) => string; target?: number }[] = [
  { key: 'maxNormalWait', title: 'Worst normal-customer wait', unit: 'min, avg of daily max', better: 'lower', fmt: (v) => `${v.toFixed(0)}m` },
  { key: 'promiseKept', title: 'Promises kept', unit: 'share called by issue-time promise', better: 'higher', fmt: (v) => pct(v), target: 0.9 },
  { key: 'etaMae', title: 'ETA error', unit: 'mean |predicted − actual|, min', better: 'lower', fmt: (v) => `${v.toFixed(1)}m` },
];

export default function Lab() {
  const [days, setDays] = useState(8);
  const [runs, setRuns] = useState(40);
  const [seed, setSeed] = useState(1);
  const [result, setResult] = useState<LabResult | null>(null);
  const [view, setView] = useState<'charts' | 'table'>('charts');
  const { run, busy } = useAction();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = busy === 'lab' ? setInterval(() => setElapsed(Date.now() - started), 100) : undefined;
    return () => clearInterval(id);
  }, [busy]);

  const go = () => run('lab', () => api<LabResult>('/lab/run', { json: { days, runs, seed } }), (r) => `Simulated ${r.days} days × ${r.results.length} policies in ${(r.elapsedMs / 1000).toFixed(1)}s`).then((r) => r && setResult(r));
  useEffect(() => { go(); }, []);

  const by = Object.fromEntries((result?.results ?? []).map((r) => [r.id, r]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-navy"><FlaskConical className="size-7" /> Simulation lab</h1>
          <p className="text-ink-2">Every policy runs on identical synthetic days: same arrivals, durations, misses and a mid-day counter outage.</p>
        </div>
        <Chip icon={Info} className="bg-amber-50 text-amber-800 ring-amber-200">Synthetic data. Not measured in a real branch.</Chip>
      </div>

      <Card className="flex flex-wrap items-end gap-6">
        <Slider label="Days" value={days} min={1} max={30} onChange={setDays} />
        <Slider label="Forecast runs" value={runs} min={10} max={200} step={10} onChange={setRuns} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink-2">Seed</span>
          <input type="number" min={1} value={seed} onChange={(e) => setSeed(Math.max(1, +e.target.value || 1))} className="h-10 w-24 rounded-xl px-3 ring-1 ring-line outline-none focus:ring-2 focus:ring-brand" />
        </label>
        <Button size="lg" icon={Play} loading={busy === 'lab'} onClick={go} className="ml-auto">
          {busy === 'lab' ? `Simulating… ${(elapsed / 1000).toFixed(1)}s` : 'Run evaluation'}
        </Button>
      </Card>

      <AnimatePresence mode="wait">
        {!result ? (
          <motion.div key="sk" className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)}</motion.div>
        ) : (
          <motion.div key={`${result.seed}-${result.days}-${result.runs}-${result.elapsedMs}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">
            <Verdicts by={by} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-sm text-ink-2">
                {Object.values(GROUP).map((g) => <span key={g.label} className="flex items-center gap-1.5"><span className="size-3 rounded-[3px]" style={{ background: g.color }} />{g.label}</span>)}
                <span className="text-muted">· {result.arrivalsPerDay} arrivals/day · {result.days} days · seed {result.seed}</span>
              </div>
              <Segmented id="labview" value={view} onChange={setView} options={[{ value: 'charts', label: 'Charts' }, { value: 'table', label: <span className="flex items-center gap-1"><Table2 className="size-3.5" />Table</span> }]} />
            </div>
            {view === 'charts' ? (
              <>
                <div className="grid gap-4 lg:grid-cols-3">{METRICS.map((m) => <MetricChart key={m.key} m={m} results={result.results} />)}</div>
                <PerDay results={result.results} />
              </>
            ) : <ResultsTable results={result.results} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="flex w-56 flex-col gap-1 text-sm">
      <span className="flex justify-between font-semibold text-ink-2">{label}<span className="tabular text-ink">{value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="accent-brand" />
    </label>
  );
}

/** The plan's own pass/fail criteria, stated honestly either way. */
function Verdicts({ by }: { by: Record<string, LabPolicyResult> }) {
  const F = by.F;
  const checks = F && by.B1 && by['F-naiveEta'] ? [
    {
      title: 'Deadline dispatch limits starvation',
      pass: F.maxNormalWait < by.B1.maxNormalWait,
      detail: `Worst normal wait ${F.maxNormalWait.toFixed(0)}m vs ${by.B1.maxNormalWait.toFixed(0)}m under strict priority (B1). Priority P95: ${F.waitByClass.PRIORITY.p95.toFixed(1)}m vs ${by.B1.waitByClass.PRIORITY.p95.toFixed(1)}m.`,
    },
    {
      title: 'Simulated ETAs beat naive ETAs',
      pass: F.etaMae < by['F-naiveEta'].etaMae,
      detail: `Same dispatcher, ETA error ${F.etaMae.toFixed(1)}m (simulation) vs ${by['F-naiveEta'].etaMae.toFixed(1)}m (position × mean).`,
    },
    {
      title: 'Promises are calibrated (85–95%)',
      pass: F.promiseKept >= 0.85 && F.promiseKept <= 0.95,
      detail: `${pct(F.promiseKept)} kept. Well above 95% would mean padded promises; below 85% means over-promising.`,
    },
  ] : [];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {checks.map((c, i) => {
        const Icon = c.pass ? CheckCircle2 : XCircle;
        return (
          <Card key={c.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
            className={cx('ring-2', c.pass ? 'ring-good/30' : 'ring-critical/30')}>
            <div className="flex items-center gap-2 font-semibold">
              <Icon className={cx('size-5', c.pass ? 'text-good' : 'text-critical')} />
              {c.title}
            </div>
            <div className={cx('mt-1 text-xs font-bold tracking-wide uppercase', c.pass ? 'text-[#006300]' : 'text-critical')}>{c.pass ? 'holds on this run' : 'does not hold on this run'}</div>
            <p className="mt-2 text-sm text-ink-2">{c.detail}</p>
          </Card>
        );
      })}
    </div>
  );
}

function MetricChart({ m, results }: { m: typeof METRICS[number]; results: LabPolicyResult[] }) {
  const data = results.map((r) => ({ id: r.id, label: r.label, group: r.group, value: r[m.key] as number }));
  const best = (m.better === 'lower' ? Math.min : Math.max)(...data.map((d) => d.value));
  return (
    <Card>
      <div className="font-semibold">{m.title}</div>
      <div className="mb-2 text-xs text-muted">{m.unit} · {m.better} is better</div>
      <div className="h-64">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, left: 0, bottom: 0 }} barCategoryGap={4}>
            <CartesianGrid horizontal={false} stroke="#e1e0d9" />
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" dataKey="id" width={96} tickLine={false} axisLine={false} tick={{ fill: '#52514e', fontSize: 11 }} />
            {m.target && <ReferenceLine x={m.target} stroke="#52514e" strokeDasharray="3 3" label={{ value: 'target', fill: '#898781', fontSize: 10, position: 'top' }} />}
            <Tooltip cursor={{ fill: '#eef4fd' }} content={({ active, payload }) => (active && payload?.[0] ? (
              <div className="rounded-lg bg-navy px-3 py-2 text-xs text-white shadow-lg"><b>{payload[0].payload.label}</b><br />{m.fmt(payload[0].payload.value)}</div>
            ) : null)} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} animationDuration={800}>
              {data.map((d) => <Cell key={d.id} fill={GROUP[d.group].color} />)}
              <LabelList dataKey="value" position="right" formatter={(v: number) => `${m.fmt(v)}${v === best ? ' ★' : ''}`} style={{ fill: '#52514e', fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function PerDay({ results }: { results: LabPolicyResult[] }) {
  const by = Object.fromEntries(results.map((r) => [r.id, r]));
  const days = by.F?.perDay ?? [];
  const data = days.map((d, i) => Object.fromEntries([['day', `Day ${d.day}`], ...DAY_SERIES.map((s) => [s.id, +(by[s.id]?.perDay[i]?.maxNormalWait ?? 0).toFixed(1)])]));
  return (
    <Card>
      <div className="font-semibold">Worst normal-customer wait, day by day</div>
      <div className="mb-3 text-xs text-muted">Minutes. Each day uses identical arrivals for every policy.</div>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e1e0d9" />
            <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: '#c3c2b7' }} tick={{ fill: '#898781', fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: '#898781', fontSize: 11 }} unit="m" />
            <Tooltip cursor={{ stroke: '#c3c2b7' }} contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 8px 24px rgb(0 0 0 / .12)', fontSize: 12 }} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: '#52514e' }} formatter={(v) => by[v]?.label ?? v} />
            {DAY_SERIES.map((s) => (
              <Line key={s.id} type="linear" dataKey={s.id} stroke={s.color} strokeWidth={2}
                dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: s.color }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2, fill: s.color }} animationDuration={900} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function ResultsTable({ results }: { results: LabPolicyResult[] }) {
  const cols: [string, (r: LabPolicyResult) => string][] = [
    ['Max normal wait', (r) => `${r.maxNormalWait.toFixed(1)}m`],
    ['Normal mean / P95', (r) => `${r.waitByClass.NORMAL.mean.toFixed(1)} / ${r.waitByClass.NORMAL.p95.toFixed(1)}m`],
    ['Priority mean / P95', (r) => `${r.waitByClass.PRIORITY.mean.toFixed(1)} / ${r.waitByClass.PRIORITY.p95.toFixed(1)}m`],
    ['Promise kept', (r) => pct(r.promiseKept)],
    ['ETA MAE', (r) => `${r.etaMae.toFixed(2)}m`],
    ['Utilization', (r) => pct(r.utilization)],
    ['Past ceiling', (r) => String(r.starvation)],
    ['Miss recovery', (r) => `${r.missRecovery.toFixed(1)}m`],
    ['No-shows', (r) => String(r.noShows)],
  ];
  return (
    <Card className="overflow-x-auto p-0">
      <table className="tabular w-full text-sm">
        <thead className="bg-page text-left text-xs text-ink-2">
          <tr><th className="px-4 py-3">Policy</th>{cols.map(([h]) => <th key={h} className="px-3 py-3 text-right whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.id} className={cx('border-t border-line', r.id === 'F' && 'bg-card font-semibold')}>
              <td className="px-4 py-2.5 whitespace-nowrap">{r.label}</td>
              {cols.map(([h, f]) => <td key={h} className="px-3 py-2.5 text-right">{f(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
