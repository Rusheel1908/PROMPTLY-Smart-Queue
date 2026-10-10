import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Archive, CheckCircle2, FlaskConical, Info, Lock, Play, Table2, X, XCircle, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PinForm, useStaff } from '../components/StaffGate';
import { Button, Card, Chip, Modal, Segmented, Skeleton, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { cx, fmtClock, pct } from '../lib/format';
import { useSocket } from '../lib/live';
import type { LabJob, LabPolicyResult, LabResult } from '../lib/types';

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

type Notice = { tone: 'warn' | 'bad'; text: string };
const NOTICE_TONE = { warn: 'bg-amber-50 text-amber-900 ring-amber-200', bad: 'bg-red-50 text-critical ring-critical/30' };

/** How a refused live run is explained; anything else shows the server's message. */
const RUN_ERRORS: Record<number, Notice> = {
  409: { tone: 'warn', text: 'A live run is already in progress (maybe started from another screen). Try again when it finishes.' },
  401: { tone: 'warn', text: 'The staff PIN is required to run live. Enter it and try again.' },
};

const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Where the result on screen came from, always stated on the page. */
const SOURCE: Record<LabResult['source'], { icon: typeof Archive; cls: string; label: (r: LabResult) => string }> = {
  precomputed: { icon: Archive, cls: 'bg-amber-50 text-amber-800 ring-amber-200', label: (r) => `Pre-computed on ${fmtDate(r.generatedAt)}, synthetic data` },
  live: { icon: Zap, cls: 'bg-blue-50 text-brand ring-brand/30', label: (r) => `Live run · ${fmtClock(r.generatedAt)}, synthetic data` },
};

const POLL_MS = 500;
const isFinished = (j: LabJob) => j.status === 'done' || j.status === 'failed';

export default function Lab() {
  const [days, setDays] = useState(8);
  const [runs, setRuns] = useState(40);
  const [seed, setSeed] = useState(1);
  const [saved, setSaved] = useState<LabResult | null>(null);
  const [live, setLive] = useState<LabResult | null>(null);
  const [showLive, setShowLive] = useState(false);
  const [job, setJob] = useState<LabJob | null>(null);
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [askPin, setAskPin] = useState(false);
  const [view, setView] = useState<'charts' | 'table'>('charts');
  const [elapsed, setElapsed] = useState(0);
  const staff = useStaff();
  const toast = useToast();

  useEffect(() => {
    api<LabResult>('/lab/latest').then(setSaved).catch((e) => setNotice({ tone: 'bad', text: `Could not load the saved result: ${e.message}` }));
  }, []);

  const running = job != null && !isFinished(job);
  const jobId = running ? job.id : null;

  const ON_FINISH: Record<'done' | 'failed', (j: LabJob) => void> = {
    done: (j) => {
      setLive({ ...j.result!, generatedAt: j.finishedAt });
      setShowLive(true);
      toast(`Live run: ${j.result!.days} days × ${j.result!.results.length} policies in ${(j.result!.elapsedMs / 1000).toFixed(1)}s`, 'good');
    },
    failed: (j) => setNotice({ tone: 'bad', text: `Live run failed: ${j.error}` }),
  };

  // poll the running job; a "lab" socket ping triggers an immediate check
  const check = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const stop = (j: LabJob | null) => { stopped = true; setJob(j); };
    check.current = () => void api<LabJob>(`/lab/jobs/${jobId}`).then((j) => {
      if (stopped) return;
      isFinished(j) ? (stop(j), ON_FINISH[j.status as 'done' | 'failed'](j)) : setJob(j);
    }).catch((e) => {
      // the server answered (job gone, PIN changed): give up; network blips just retry
      e instanceof ApiError && !stopped && (stop(null), setNotice({ tone: 'bad', text: `Lost track of the live run: ${e.message}` }));
    });
    const poll = setInterval(() => check.current(), POLL_MS);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => { stopped = true; clearInterval(poll); clearInterval(tick); setElapsed(0); };
  }, [jobId]);
  useSocket((m) => { m.type === 'lab' && (m.data as { jobId?: string }).jobId === jobId && check.current(); });

  const start = () => {
    setNotice(null);
    setPosting(true);
    api<{ jobId: string }>('/lab/run', { json: { days, runs, seed } })
      .then(({ jobId: id }) => setJob({ id, status: 'queued', createdAt: new Date().toISOString() }))
      .catch((e: ApiError) => {
        setNotice(RUN_ERRORS[e.status] ?? { tone: 'bad', text: e.message });
        e.status === 401 && (staff.lock(), setAskPin(true));
      })
      .finally(() => setPosting(false));
  };
  const runLive = () => (staff.phase === 'open' ? start() : setAskPin(true));

  const result = showLive && live ? live : saved;
  const by = Object.fromEntries((result?.results ?? []).map((r) => [r.id, r]));
  const progress = job?.progress ?? 0;

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
        <Button size="lg" icon={staff.phase === 'open' ? Play : Lock} loading={posting || running} onClick={runLive} className="ml-auto">
          {running ? `Running… ${pct(progress)} · ${(elapsed / 1000).toFixed(1)}s` : staff.phase === 'open' ? 'Run live' : 'Run live (staff)'}
        </Button>
        {running && (
          <div className="basis-full">
            <div className="h-2 overflow-hidden rounded-full bg-line/60">
              <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${progress * 100}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {job.status === 'queued' ? 'Starting a background worker…' : 'Simulating in a background worker. The board, counters and status pages keep running.'}
            </p>
          </div>
        )}
      </Card>

      <AnimatePresence>
        {notice && (
          <motion.div role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={cx('flex items-start gap-2 rounded-xl px-4 py-3 text-sm ring-1', NOTICE_TONE[notice.tone])}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="ml-auto rounded p-0.5 hover:bg-black/5" aria-label="Dismiss"><X className="size-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {!result ? (
          <motion.div key="sk" className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)}</motion.div>
        ) : (
          <motion.div key={`${result.source}-${result.generatedAt}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className={cx('flex flex-col gap-6 transition-opacity', running && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-3">
              <Chip icon={SOURCE[result.source].icon} className={SOURCE[result.source].cls}>{SOURCE[result.source].label(result)}</Chip>
              {live && (
                <button onClick={() => setShowLive(!showLive)} className="text-sm font-semibold text-brand hover:underline">
                  {showLive ? 'Back to saved result' : 'Show live result'}
                </button>
              )}
            </div>
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

      <Modal open={askPin} onClose={() => setAskPin(false)} title="Staff PIN to run live">
        <p className="mb-4 text-sm text-ink-2">Live runs use server CPU, so only staff can start one. The saved result stays visible to everyone.</p>
        <PinForm unlock={staff.unlock} onUnlocked={() => { setAskPin(false); start(); }} />
      </Modal>
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
    ...(by['F-noArrivals'] ? [{
      title: 'Expecting later arrivals keeps promises',
      pass: F.promiseKept > by['F-noArrivals'].promiseKept,
      detail: `${pct(F.promiseKept)} kept when the forecast samples customers who have not arrived yet (rates learned from arrivals so far) vs ${pct(by['F-noArrivals'].promiseKept)} without.`,
    }] : []),
  ] : [];
  return (
    <div className={cx('grid gap-4 md:grid-cols-2', checks.length > 3 ? 'xl:grid-cols-4' : 'lg:grid-cols-3')}>
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
