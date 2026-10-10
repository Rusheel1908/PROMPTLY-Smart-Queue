import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CheckCircle2, Hourglass, RotateCcw, ShieldCheck, Sparkles,
  UserPlus, Users, Wand2, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StaffStats } from '../components/StaffStats';
import { SuggestedActions } from '../components/SuggestedActions';
import { TodaysAppointments } from '../components/TodaysAppointments';
import { Button, Card, Modal, Stat, useAction } from '../components/ui';
import { api } from '../lib/api';
import { CLASS_META, COUNTER_META, cx, describeEvent, fmtAgo, fmtMin, pct, serviceIcon } from '../lib/format';
import { useNow, useSnapshot } from '../lib/live';
import type { Counter, CounterStatus, Snapshot, Token, TokenClass } from '../lib/types';

type Draft = Record<string, { status?: CounterStatus; skills?: string[] }>;
interface WhatIf {
  services: { id: string; name: string; waiting: number; beforeP90: number | null; afterP90: number | null; unavailableBefore: number; unavailableAfter: number }[];
}

export default function Ops() {
  const { snap, refresh } = useSnapshot();
  const now = useNow(5000);
  const [draft, setDraft] = useState<Draft>({});
  const { run, busy } = useAction();
  const [confirmReset, setConfirmReset] = useState(false);

  const stranded = (snap?.services ?? []).filter((s) => s.capable === 0 && s.waiting > 0);
  const m = snap?.metrics;

  const spawn = () => run('spawn', () => api<{ issued: string[] }>('/demo/spawn', { json: { count: 6 } }), (r) => `Demo customers joined: ${r.issued.join(', ')}`);
  const reset = () => run('reset', () => api('/demo/reset', { json: {} }), () => 'Demo reset').then(() => setConfirmReset(false));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-navy">Supervisor ops</h1>
          <p className="text-ink-2">Live promises, risk and what-if planning. Changes are simulated before they're applied.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={UserPlus} loading={busy === 'spawn'} onClick={spawn}>Add 6 demo customers</Button>
          <Button variant="ghost" icon={RotateCcw} onClick={() => setConfirmReset(true)}>Reset demo</Button>
        </div>
      </div>

      <SuggestedActions onApplied={refresh} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Waiting" icon={Users} value={m?.waiting ?? '—'} hint={`${m?.issued ?? 0} issued today`} />
        <Stat label="Promises at risk" icon={AlertTriangle} value={m?.atRisk ?? '—'} tone={m?.atRisk ? 'text-critical' : 'text-ink'} hint="P90 now past the promise" />
        <Stat label="Promise kept" icon={ShieldCheck} value={pct(m?.promiseKept)} hint="target ≈ 90% (calibrated)" />
        <Stat label="Served today" icon={CheckCircle2} value={m?.served ?? '—'} hint={`${m?.missed ?? 0} missed turns`} />
        <Stat label="No-shows" icon={Hourglass} value={m?.noShows ?? '—'} hint="after two misses" />
      </div>

      <AnimatePresence>
        {stranded.map((s) => (
          <motion.div key={s.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-red-50 p-4 text-red-900 ring-1 ring-red-200">
              <AlertTriangle className="size-5" />
              <span className="flex-1"><b>{s.name}</b> has no open counter. {s.waiting} customer{s.waiting === 1 ? '' : 's'} see "unavailable". Plan a fix below.</span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {snap && <Planner snap={snap} draft={draft} setDraft={setDraft} onApplied={refresh} />}

      <StaffStats version={snap?.events[0]?.seq} />

      <TodaysAppointments version={snap?.events[0]?.seq} />

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        {snap && <RiskHeatmap snap={snap} />}
        {snap && <WaitsByClass waits={snap.metrics.waitByClass} />}
      </div>

      <Card>
        <div className="mb-3 flex items-center gap-2 font-semibold"><Activity className="size-4" /> Live event log</div>
        <ul className="grid gap-x-8 gap-y-1.5 text-sm md:grid-cols-2">
          <AnimatePresence initial={false}>
            {(snap?.events ?? []).slice(0, 20).map((e) => (
              <motion.li key={e.seq} layout initial={{ opacity: 0, backgroundColor: '#eef4fd' }} animate={{ opacity: 1, backgroundColor: '#ffffff00' }} transition={{ duration: 1.2 }}
                className="flex justify-between gap-3 rounded-md px-1">
                <span className="truncate text-ink-2">
                  {describeEvent(e)}
                  {e.actorName && <span className="ml-1.5 text-xs text-muted">· {e.actorName}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{fmtAgo(e.ts, now)}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Card>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset demo data?">
        <p className="text-ink-2">
          Clears all tokens, bookings and the event log, reopens every counter with its usual services, forgets learned service times,
          and books one demo appointment.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button variant="danger" loading={busy === 'reset'} onClick={reset}>Reset</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------- What-if planner ---------------- */

function Planner({ snap, draft, setDraft, onApplied }: { snap: Snapshot; draft: Draft; setDraft: (d: Draft) => void; onApplied: () => void }) {
  const [result, setResult] = useState<WhatIf | null>(null);
  const [loading, setLoading] = useState(false);
  const { run, busy } = useAction();
  const changes = Object.entries(draft).map(([id, c]) => ({ id, ...c }));
  const dirty = changes.length > 0;

  // re-simulate whenever the draft changes (debounced)
  useEffect(() => {
    const id = setTimeout(() => {
      setLoading(dirty);
      dirty && api<WhatIf>('/whatif', { json: { counters: changes } }).then(setResult).finally(() => setLoading(false));
    }, 350);
    dirty || setResult(null);
    return () => clearTimeout(id);
  }, [JSON.stringify(draft)]);

  const effective = (c: Counter) => ({ status: draft[c.id]?.status ?? c.status, skills: draft[c.id]?.skills ?? c.skills });
  const patch = (c: Counter, p: { status?: CounterStatus; skills?: string[] }) => {
    const next = { ...effective(c), ...p };
    const same = next.status === c.status && [...next.skills].sort().join() === [...c.skills].sort().join();
    const { [c.id]: _, ...rest } = draft;
    setDraft(same ? rest : { ...rest, [c.id]: next });
  };
  const cycle: Record<CounterStatus, CounterStatus> = { OPEN: 'PAUSED', PAUSED: 'CLOSED', CLOSED: 'OPEN' };

  const apply = () => run('apply', async () => {
    for (const ch of changes) await api(`/counters/${ch.id}`, { method: 'PATCH', json: { status: ch.status, skills: ch.skills } });
    return changes.length;
  }, (n) => `Applied ${n} change${n === 1 ? '' : 's'}. Customers see the reasons`).then(() => { setDraft({}); onApplied(); });

  return (
    <Card className={cx('transition-shadow', dirty && 'ring-2 ring-brand/40 shadow-lg shadow-brand/10')}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wand2 className="size-5 text-brand" />
          <div>
            <div className="font-semibold">Counters & what-if</div>
            <div className="text-xs text-muted">Click a status to cycle it, or a service to toggle it. The impact is simulated before anything changes.</div>
          </div>
        </div>
        <AnimatePresence>
          {dirty && (
            <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex gap-2">
              <Button variant="ghost" size="sm" icon={X} onClick={() => setDraft({})}>Discard</Button>
              <Button size="sm" icon={Sparkles} loading={busy === 'apply'} onClick={apply}>Apply {changes.length} change{changes.length === 1 ? '' : 's'}</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {snap.counters.map((c) => {
          const eff = effective(c);
          const meta = COUNTER_META[eff.status];
          const changed = !!draft[c.id];
          return (
            <motion.div key={c.id} layout className={cx('rounded-xl p-3 ring-1 transition-colors', changed ? 'bg-card ring-brand' : 'ring-line')}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{c.name}</span>
                {changed && <span className="text-[10px] font-bold tracking-wide text-brand uppercase">planned</span>}
              </div>
              <motion.button whileTap={{ scale: 0.94 }} onClick={() => patch(c, { status: cycle[eff.status] })}
                className={cx('mt-2 flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold ring-1 ring-inset', meta.chip)}>
                <meta.icon className="size-3.5" /> {meta.label}
                <span className="ml-auto truncate font-mono font-normal opacity-70">{c.current?.code}</span>
              </motion.button>
              <div className="mt-2 flex flex-wrap gap-1">
                {snap.services.map((s) => {
                  const on = eff.skills.includes(s.id);
                  const Icon = serviceIcon(s.icon);
                  return (
                    <motion.button key={s.id} whileTap={{ scale: 0.9 }} title={`${on ? 'Remove' : 'Add'} ${s.name}`}
                      onClick={() => patch(c, { skills: on ? eff.skills.filter((x) => x !== s.id) : [...eff.skills, s.id] })}
                      className={cx('flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors',
                        on ? 'bg-navy text-white' : 'bg-slate-100 text-muted hover:bg-slate-200')}>
                      <Icon className="size-3" />{s.name}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {dirty && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-5 rounded-xl bg-page p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                Projected impact (avg P90 wait of customers already waiting)
                {loading && <span className="h-1.5 w-16 animate-shimmer rounded-full bg-gradient-to-r from-line via-brand/50 to-line bg-[length:200%_100%]" />}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(result?.services ?? []).map((s) => <ImpactTile key={s.id} s={s} />)}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function ImpactTile({ s }: { s: WhatIf['services'][number] }) {
  const delta = s.afterP90 != null && s.beforeP90 != null ? s.afterP90 - s.beforeP90 : null;
  const strands = s.unavailableAfter > s.unavailableBefore;
  const rescues = s.unavailableAfter < s.unavailableBefore;
  const better = (delta ?? 0) < -0.5 || rescues;
  const worse = (delta ?? 0) > 0.5 || strands;
  const tone = (worse && 'text-critical') || (better && 'text-good') || 'text-ink-2';
  const Icon = (worse && ArrowUp) || (better && ArrowDown) || ArrowRight;
  const text = (strands && `${s.unavailableAfter} stranded`)
    || (rescues && 'back in service')
    || (delta == null && 'no one waiting')
    || (Math.abs(delta!) < 0.5 && 'no change')
    || `${delta! > 0 ? '+' : '−'}${fmtMin(Math.abs(delta!))}`;
  return (
    <motion.div layout className="rounded-xl bg-white p-3 ring-1 ring-line">
      <div className="text-sm font-semibold">{s.name} <span className="font-normal text-muted">· {s.waiting} waiting</span></div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="tabular text-sm text-muted">{fmtMin(s.beforeP90)}</span>
        <ArrowRight className="size-3 text-muted" />
        <span className="tabular text-lg font-bold">{s.unavailableAfter && s.afterP90 == null ? 'n/a' : fmtMin(s.afterP90)}</span>
      </div>
      <div className={cx('mt-1 flex items-center gap-1 text-xs font-semibold', tone)}><Icon className="size-3.5" />{text}</div>
    </motion.div>
  );
}

/* ---------------- Promise risk heatmap ---------------- */

/** Diverging scale (blue = ahead of promise, gray = on the line, red = behind), never color alone: tooltips + legend. */
const SLACK_STEPS: { min: number; color: string; label: string }[] = [
  { min: 5, color: '#256abf', label: '5+ min spare' },
  { min: 2, color: '#86b6ef', label: '2–5 spare' },
  { min: -2, color: '#e1e0d9', label: 'on the line' },
  { min: -5, color: '#f0a09f', label: '2–5 late' },
  { min: -Infinity, color: '#e34948', label: '5+ min late' },
];
const slackStep = (slack: number) => SLACK_STEPS.find((s) => slack >= s.min)!;

function RiskHeatmap({ snap }: { snap: Snapshot }) {
  const [hover, setHover] = useState<Token | null>(null);
  const waiting = snap.tokens.filter((t) => t.state === 'WAITING');
  const slack = (t: Token) => (t.promiseP90 && t.etaP90 ? (new Date(t.promiseP90).getTime() - new Date(t.etaP90).getTime()) / 60000 : null);
  return (
    <Card>
      <div className="mb-1 font-semibold">Promise risk</div>
      <div className="mb-4 text-xs text-muted">Each square is a waiting customer: current P90 vs the promise made at issue.</div>
      <div className="flex flex-col gap-3">
        {snap.services.map((svc) => {
          const rows = waiting.filter((t) => t.serviceId === svc.id).sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
          return (
            <div key={svc.id} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-sm text-ink-2">{svc.name}</span>
              <div className="flex min-h-7 flex-wrap gap-[2px]">
                <AnimatePresence>
                  {rows.map((t) => {
                    const s = slack(t);
                    return (
                      <motion.button key={t.id} layout initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                        onMouseEnter={() => setHover(t)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(t)} onBlur={() => setHover(null)}
                        aria-label={`${t.code}: ${s == null ? 'unavailable' : slackStep(s).label}`}
                        className={cx('size-7 rounded-[4px] transition-transform hover:scale-125', s == null && 'bg-[repeating-linear-gradient(45deg,#e1e0d9_0_3px,#fff_3px_6px)]')}
                        style={s == null ? undefined : { background: slackStep(s).color }} />
                    );
                  })}
                </AnimatePresence>
                {rows.length === 0 && <span className="text-xs text-muted">—</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex h-12 items-center justify-between gap-3 border-t border-line pt-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-2">
          {SLACK_STEPS.map((s) => <span key={s.label} className="flex items-center gap-1"><span className="size-3 rounded-[3px]" style={{ background: s.color }} />{s.label}</span>)}
          <span className="flex items-center gap-1"><span className="size-3 rounded-[3px] bg-[repeating-linear-gradient(45deg,#e1e0d9_0_2px,#fff_2px_4px)]" />unavailable</span>
        </div>
        <AnimatePresence mode="wait">
          {hover && (
            <motion.div key={hover.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="shrink-0 rounded-lg bg-navy px-3 py-1.5 text-xs text-white">
              <b className="font-mono">{hover.code}</b> · {CLASS_META[hover.class].label} · waited {fmtMin(hover.waitMin)} · {hover.unavailable ? 'no counter' : `ETA ${fmtMin(hover.etaMin)}`}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}

/* ---------------- Waits by class ---------------- */

const CLASS_ORDER: TokenClass[] = ['EMERGENCY', 'PRIORITY', 'APPOINTMENT', 'NORMAL'];

function WaitsByClass({ waits }: { waits: Record<TokenClass, number | null> }) {
  const data = useMemo(() => CLASS_ORDER.map((c) => ({ name: CLASS_META[c].label, wait: waits[c] == null ? 0 : +waits[c]!.toFixed(1), has: waits[c] != null })), [waits]);
  return (
    <Card>
      <div className="mb-1 font-semibold">Average wait today by customer type</div>
      <div className="mb-3 text-xs text-muted">Minutes from arrival to call. Normals stay bounded, which is the anti-starvation guarantee.</div>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 20, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e1e0d9" />
            <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: '#c3c2b7' }} tick={{ fill: '#52514e', fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: '#898781', fontSize: 11 }} unit="m" />
            <Tooltip cursor={{ fill: '#eef4fd' }} content={({ active, payload }) => (active && payload?.[0] ? (
              <div className="rounded-lg bg-navy px-3 py-2 text-xs text-white shadow-lg">
                <b>{payload[0].payload.name}</b>: {payload[0].payload.has ? `${payload[0].payload.wait} min` : 'no customers yet'}
              </div>
            ) : null)} />
            <Bar dataKey="wait" fill="var(--color-s1)" radius={[4, 4, 0, 0]} maxBarSize={48} animationDuration={700}>
              <LabelList dataKey="wait" position="top" formatter={(v: number) => (v ? `${v}m` : '')} style={{ fill: '#52514e', fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
