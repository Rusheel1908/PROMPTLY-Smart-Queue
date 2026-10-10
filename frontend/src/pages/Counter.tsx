import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, BellRing, CheckCheck, Clock, Lightbulb, Megaphone, PhoneMissed, Play, Shuffle, Sparkles, UserRoundX,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Chip, Empty, Kbd, Modal, Segmented, Skeleton, useAction } from '../components/ui';
import { api } from '../lib/api';
import { CLASS_META, COUNTER_META, cx, describeEvent, fmtAgo, fmtDuration, fmtMin, serviceIcon } from '../lib/format';
import { useNow, useSnapshot } from '../lib/live';
import type { Counter as CounterT, CounterStatus, Snapshot, Token } from '../lib/types';

const SELECTED_KEY = 'promptly.counter';
const CALL_WINDOW_S = 90;

type Mode = 'IDLE' | 'CALLED' | 'SERVING';
type Result = { token?: Token | null; reason?: string; outcome?: string };
interface ActionDef {
  key: string; label: string; icon: LucideIcon; kbd: string;
  variant: 'primary' | 'ghost' | 'danger' | 'good' | 'warn' | 'dark';
  path: string | null;               // null = opens a picker instead of calling the API
  message: (r: Result) => string;
}

/** Which buttons a counter shows, by what is happening at the desk. */
const ACTIONS: Record<Mode, ActionDef[]> = {
  IDLE: [{ key: 'call', label: 'Call next', icon: Megaphone, variant: 'primary', kbd: 'N', path: 'call-next',
    message: (r) => (r.token ? `Calling ${r.token.code}` : r.reason ?? '') }],
  CALLED: [
    { key: 'ack', label: 'Customer arrived', icon: Play, variant: 'good', kbd: 'S', path: 'ack', message: () => 'Service started' },
    { key: 'recall', label: 'Recall', icon: BellRing, variant: 'ghost', kbd: 'R', path: 'recall', message: () => 'Recalled on the board' },
    { key: 'miss', label: 'Missed', icon: PhoneMissed, variant: 'ghost', kbd: 'M', path: 'miss',
      message: (r) => `Missed → ${(r.outcome ?? '').toLowerCase().replace('_', '-')}` },
  ],
  SERVING: [
    { key: 'complete', label: 'Complete', icon: CheckCheck, variant: 'good', kbd: 'C', path: 'complete', message: () => 'Service completed' },
    { key: 'redirect', label: 'Redirect', icon: Shuffle, variant: 'ghost', kbd: 'D', path: null, message: () => '' },
  ],
};

const MODE_OF: Record<string, Mode> = { CALLED: 'CALLED', SERVING: 'SERVING' };
const modeOf = (t: Token | null): Mode => MODE_OF[t?.state ?? ''] ?? 'IDLE';

export default function Counter() {
  const { snap, refresh } = useSnapshot();
  const [selected, setSelected] = useState<string>(() => { try { return localStorage.getItem(SELECTED_KEY) ?? ''; } catch { return ''; } });
  const counter = snap?.counters.find((c) => c.id === selected) ?? snap?.counters[0];
  useEffect(() => { try { counter && localStorage.setItem(SELECTED_KEY, counter.id); } catch { /* ignore */ } }, [counter?.id]);

  return !snap || !counter ? (
    <div className="space-y-4"><Skeleton className="h-12 w-96" /><Skeleton className="h-80" /></div>
  ) : (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {snap.counters.map((c) => (
            <motion.button key={c.id} whileTap={{ scale: 0.95 }} onClick={() => setSelected(c.id)}
              className={cx('relative flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ring-1 transition-colors',
                c.id === counter.id ? 'bg-navy text-white ring-navy' : 'bg-white ring-line hover:ring-brand/40')}>
              <span className={cx('size-2 rounded-full', COUNTER_META[c.status].dot)} />
              {c.name}
              {c.current && <span className="rounded-md bg-white/15 px-1.5 text-xs">{c.current.code}</span>}
            </motion.button>
          ))}
        </div>
        <StatusControl counter={counter} onDone={refresh} />
      </div>
      <Console key={counter.id} counter={counter} snap={snap} />
    </div>
  );
}

function StatusControl({ counter, onDone }: { counter: CounterT; onDone: () => void }) {
  const { run } = useAction();
  const set = (status: CounterStatus) => run('status', () => api(`/counters/${counter.id}`, { method: 'PATCH', json: { status } }),
    () => `${counter.name} ${COUNTER_META[status].label.toLowerCase()}. Queue re-planned`).then(onDone);
  return (
    <Segmented id="status" value={counter.status} onChange={set}
      options={(['OPEN', 'PAUSED', 'CLOSED'] as const).map((s) => ({ value: s, label: <span className="flex items-center gap-1.5"><span className={cx('size-2 rounded-full', COUNTER_META[s].dot)} />{COUNTER_META[s].label}</span> }))} />
  );
}

function Console({ counter, snap }: { counter: CounterT; snap: Snapshot }) {
  const { run, busy } = useAction();
  const [redirectOpen, setRedirectOpen] = useState(false);
  const [lastReason, setLastReason] = useState<string | null>(null);
  const now = useNow(1000);
  const current = counter.current;
  const mode = modeOf(current);
  const services = Object.fromEntries(snap.services.map((s) => [s.id, s]));

  const callApi = (a: ActionDef) => run(a.key, async () => {
    const r = await api<Result>(`/counters/${counter.id}/${a.path}`, { json: {} });
    r.reason && setLastReason(r.reason);
    return r;
  }, a.message);
  const perform = (a: ActionDef) => (a.path ? callApi(a) : setRedirectOpen(true));

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      const action = ACTIONS[mode].find((a) => a.kbd === e.key.toUpperCase());
      !typing && !e.metaKey && !e.ctrlKey && action && counter.status === 'OPEN' && perform(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const queue = useMemo(() => snap.tokens
    .filter((t) => t.state === 'WAITING' && counter.skills.includes(t.serviceId))
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9)), [snap.tokens, counter.skills]);
  const log = snap.events.filter((e) => e.counter === counter.name).slice(0, 6);
  const closed = counter.status !== 'OPEN';

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-6">
        <Card className={cx('relative min-h-80 overflow-hidden', closed && 'opacity-70')}>
          <AnimatePresence mode="wait">
            {current ? (
              <CurrentCustomer key={current.id} t={current} mode={mode} now={now} serviceName={services[current.serviceId]?.name ?? ''} />
            ) : (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid h-56 place-items-center text-center">
                <div>
                  <Sparkles className="mx-auto size-10 text-brand/60" />
                  <div className="mt-2 text-lg font-semibold">{closed ? `${counter.name} is ${counter.status.toLowerCase()}` : 'Ready for the next customer'}</div>
                  <div className="text-sm text-muted">{closed ? 'Open the counter to call customers.' : `${queue.length} eligible waiting · press N to call`}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-6 flex flex-wrap gap-3">
            {ACTIONS[mode].map((a) => (
              <Button key={a.key} size={mode === 'IDLE' ? 'xl' : 'lg'} variant={a.variant} icon={a.icon} kbd={a.kbd}
                className={cx(mode === 'IDLE' && 'w-full')} loading={busy === a.key} disabled={closed && mode === 'IDLE'} onClick={() => perform(a)}>
                {a.label}
              </Button>
            ))}
          </div>
        </Card>

        <AnimatePresence>
          {(current?.pickReason ?? lastReason) && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Card className="flex gap-3 bg-card ring-brand/20">
                <Lightbulb className="mt-0.5 size-5 shrink-0 text-brand" />
                <div>
                  <div className="text-sm font-semibold">Why this customer</div>
                  <div className="text-sm text-ink-2">{current?.pickReason ?? lastReason}</div>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <div className="font-semibold">Up next here</div>
            <div className="flex gap-1">{counter.skills.map((id) => <SkillPill key={id} name={services[id]?.name} icon={services[id]?.icon} />)}</div>
          </div>
          {queue.length === 0 ? <Empty icon={UserRoundX} title="Nobody waiting" hint="Customers for this counter's services will appear here." /> : (
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {queue.slice(0, 8).map((t, i) => <QueueRow key={t.id} t={t} first={i === 0} now={now} serviceName={services[t.serviceId]?.name ?? ''} />)}
              </AnimatePresence>
            </ul>
          )}
          {queue.length > 8 && <div className="mt-2 text-center text-xs text-muted">+{queue.length - 8} more</div>}
          <div className="mt-3 text-[11px] text-muted">Order follows the live forecast. The dispatcher makes the final pick when you press Call next.</div>
        </Card>

        <Card>
          <div className="mb-2 font-semibold">Activity at {counter.name}</div>
          {log.length === 0 ? <div className="text-sm text-muted">Nothing yet.</div> : (
            <ul className="space-y-1.5 text-sm">
              {log.map((e) => <li key={e.seq} className="flex justify-between gap-2"><span className="text-ink-2">{describeEvent(e)}</span><span className="shrink-0 text-xs text-muted">{fmtAgo(e.ts, now)}</span></li>)}
            </ul>
          )}
        </Card>
      </div>

      <RedirectModal open={redirectOpen} onClose={() => setRedirectOpen(false)} counterId={counter.id} current={current} services={snap.services} />
      <div className="text-xs text-muted lg:col-span-2">
        Shortcuts: <Kbd>N</Kbd> call · <Kbd>S</Kbd> arrived · <Kbd>R</Kbd> recall · <Kbd>M</Kbd> missed · <Kbd>C</Kbd> complete · <Kbd>D</Kbd> redirect
      </div>
    </div>
  );
}

function CurrentCustomer({ t, mode, now, serviceName }: { t: Token; mode: Mode; now: number; serviceName: string }) {
  const cls = CLASS_META[t.class];
  const since = new Date((mode === 'SERVING' ? t.servedAt : t.calledAt) ?? now).getTime();
  const elapsed = now - since;
  const windowLeft = Math.max(0, CALL_WINDOW_S - elapsed / 1000);
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="flex items-center justify-between gap-6">
      <div>
        <div className="text-sm font-semibold text-muted">{mode === 'CALLED' ? 'Calling…' : 'Now serving'}</div>
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-7xl font-black tracking-tight text-navy">{t.code}</motion.div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip className="bg-card text-navy ring-brand/20">{serviceName}</Chip>
          <Chip icon={cls.icon} className={cls.chip}>{cls.label}</Chip>
          {t.missCount > 0 && <Chip icon={PhoneMissed} className="bg-orange-50 text-orange-700 ring-orange-200">missed {t.missCount}×</Chip>}
        </div>
        <div className="mt-3 flex items-center gap-4 text-sm text-ink-2">
          <span className="flex items-center gap-1"><Clock className="size-4" /> waited {fmtMin(t.waitMin)}</span>
          <span className="tabular">{mode === 'SERVING' ? 'serving' : 'called'} {fmtDuration(elapsed)}</span>
        </div>
      </div>
      {mode === 'CALLED' && <WindowRing left={windowLeft} />}
    </motion.div>
  );
}

/** Countdown for the call window; at zero the system auto-recalls, then marks missed. */
function WindowRing({ left }: { left: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const frac = left / CALL_WINDOW_S;
  const color = frac > 0.5 ? 'var(--color-good)' : frac > 0.2 ? 'var(--color-warning)' : 'var(--color-critical)';
  return (
    <div className="relative grid size-24 shrink-0 place-items-center" title="Call window">
      <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-line)" strokeWidth="6" />
        <motion.circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} animate={{ strokeDashoffset: c * (1 - frac) }} transition={{ duration: 0.9, ease: 'linear' }} />
      </svg>
      <div className="text-center">
        <div className="tabular text-xl font-bold">{Math.ceil(left)}s</div>
        <div className="text-[10px] text-muted">window</div>
      </div>
    </div>
  );
}

function QueueRow({ t, first, now, serviceName }: { t: Token; first: boolean; now: number; serviceName: string }) {
  const cls = CLASS_META[t.class];
  const dueMin = (new Date(t.deadline).getTime() - now) / 60000;
  const graced = new Date(t.notBefore).getTime() > now;
  return (
    <motion.li layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
      className={cx('flex items-center gap-3 rounded-xl px-3 py-2 ring-1', first ? 'bg-card ring-brand/30' : 'ring-line', graced && 'opacity-60')}>
      <span className="w-14 font-mono font-bold">{t.code}</span>
      <cls.icon className="size-4 shrink-0 text-ink-2" aria-label={cls.label} />
      <span className="flex-1 truncate text-sm text-ink-2">{serviceName}{graced && ' · away'}</span>
      {t.atRisk && <AlertTriangle className="size-4 text-serious" aria-label="Promise at risk" />}
      <span className={cx('tabular text-xs font-semibold', dueMin < 0 ? 'text-critical' : 'text-muted')}>
        {dueMin < 0 ? `${Math.round(-dueMin)}m over` : `due ${Math.round(dueMin)}m`}
      </span>
    </motion.li>
  );
}

const SkillPill = ({ name, icon }: { name?: string; icon?: string }) => {
  const Icon = serviceIcon(icon ?? '');
  return <span title={name} className="grid size-7 place-items-center rounded-lg bg-card text-brand"><Icon className="size-4" /></span>;
};

function RedirectModal({ open, onClose, counterId, current, services }: {
  open: boolean; onClose: () => void; counterId: string; current: Token | null; services: Snapshot['services'];
}) {
  const { run, busy } = useAction();
  const go = (serviceId: string) => run('redirect',
    () => api<{ child: { code: string } }>(`/counters/${counterId}/redirect`, { json: { serviceId } }),
    (r) => `Redirected as ${r.child.code}, arrival time kept`).then(onClose);
  return (
    <Modal open={open} onClose={onClose} title={`Redirect ${current?.code ?? ''} to…`}>
      <div className="grid grid-cols-2 gap-2">
        {services.filter((s) => s.id !== current?.serviceId).map((s) => {
          const Icon = serviceIcon(s.icon);
          return (
            <motion.button key={s.id} whileHover={{ y: -2 }} whileTap={{ scale: 0.96 }} disabled={busy === 'redirect'} onClick={() => go(s.id)}
              className="flex flex-col items-start gap-1 rounded-xl p-3 text-left ring-1 ring-line hover:ring-brand">
              <Icon className="size-5 text-brand" />
              <span className="font-semibold">{s.name}</span>
              <span className="text-xs text-muted">{s.capable === 0 ? 'no counter open' : `${s.waiting} waiting · ~${fmtMin(s.quote?.p50Min)}`}</span>
            </motion.button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">The customer keeps their original arrival time in the new queue.</p>
    </Modal>
  );
}
