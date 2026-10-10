import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Bell, CalendarCheck, CalendarClock, CalendarPlus, CalendarX, LogIn, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertBanner, useNotificationBanner } from '../components/AlertBanner';
import { NotifyMe } from '../components/NotifyMe';
import { Button, Card, Chip, Empty, Skeleton, useAction } from '../components/ui';
import { unlockAudioOnFirstTap, useMuted } from '../lib/alerts';
import { api, ApiError } from '../lib/api';
import { APPOINTMENT_META, cx, fmtClock, fmtCountdown, fmtDay, statusLink } from '../lib/format';
import { useNow, useSocket, useThrottled } from '../lib/live';
import { following } from '../lib/push';
import type { AppointmentDetail, AppointmentStatus, CheckInResult } from '../lib/types';

/** The booking link's key travels as ?k= and is sent on every call for this booking. */
const bookingApi = (id: string, key: string) => <T,>(path = '', json?: unknown, method?: string) =>
  api<T>(`/appointments/${id}${path}`, { json, method, headers: { 'x-appointment-key': key } });

/** Reminders come from the server's 30 s sweep, which does not ping this page, so it also polls at that pace. */
const POLL_MS = 30_000;

/** Where now sits against the check-in window, for display only: the server decides at check-in. */
type Phase = 'EARLY' | 'ON_TIME' | 'LATE';
const phaseAt = (a: AppointmentDetail, now: number): Phase =>
  now < Date.parse(a.opensAt) ? 'EARLY' : now <= Date.parse(a.closesAt) ? 'ON_TIME' : 'LATE';

export default function Appointment() {
  const { id = '' } = useParams();
  const key = useSearchParams()[0].get('k') ?? '';
  const call = useMemo(() => bookingApi(id, key), [id, key]);
  const navigate = useNavigate();
  const [a, setA] = useState<AppointmentDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const now = useNow(1000);
  const { muted } = useMuted();
  const banner = useNotificationBanner(a, muted);
  const { run, busy } = useAction();
  useEffect(unlockAudioOnFirstTap, []);

  // a wrong key gets the same 404 as an unknown booking; other failures keep the last view
  const load = useCallback(() => call<AppointmentDetail>().then((d) => { setA(d); setMissing(false); })
    .catch((e) => e instanceof ApiError && e.status === 404 && setMissing(true)), [call]);
  useEffect(() => {
    setA(null);
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);
  const onPing = useThrottled(load);
  useSocket((m) => { m.type === 'queue' && onPing(); }); // check-in at the kiosk, a cancellation or a no-show replans the queue

  const checkIn = async () => {
    const r = await run('check-in', () => call<CheckInResult>('/check-in', {}), (r) => `Checked in: your token is ${r.token.code}`);
    if (!r) return load(); // e.g. too early: the toast has the server's reason
    following.get(id) && following.set(r.token.id, true); // the server moved this phone's alerts to the token
    navigate(statusLink(r.token.id, r.token.secret));
  };

  const phase = (missing && 'missing') || (a && 'ready') || 'loading';
  const VIEWS = {
    missing: () => <Empty icon={XCircle} title="This booking link is invalid" hint="Open the link from your booking again, or type your booking code at the kiosk." />,
    loading: () => <div className="mx-auto max-w-xl space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>,
    ready: () => (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <Header a={a!} />
        <AlertBanner n={banner.shown} live={banner.live} onClose={banner.dismiss} />
        <AnimatePresence mode="wait">
          <motion.div key={a!.status} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {PANELS[a!.status]({ a: a!, now, checkIn, checkingIn: busy === 'check-in' })}
          </motion.div>
        </AnimatePresence>
        {a!.status === 'BOOKED' && (
          <Card className="flex flex-col gap-3">
            <div className="flex items-center gap-2 font-semibold"><Bell className="size-4" /> Reminder</div>
            <p className="text-sm text-ink-2">We remind you shortly before your time. While this page is open it {muted ? 'shows a banner' : 'beeps and shows a banner'}.</p>
            <NotifyMe
              followId={a!.id} label={a!.code}
              save={(sub) => call('/push', sub)} forget={(endpoint) => call('/push', { endpoint }, 'DELETE')}
            />
          </Card>
        )}
      </div>
    ),
  };
  return VIEWS[phase]();
}

function Header({ a }: { a: AppointmentDetail }) {
  const st = APPOINTMENT_META[a.status];
  return (
    <Card className="relative overflow-hidden bg-navy text-white ring-0">
      <div className="grid-dots absolute inset-0 opacity-20" />
      <div className="relative flex items-center justify-between gap-4">
        <div>
          <div className="text-xs tracking-[0.3em] text-white/60 uppercase">Booking</div>
          <div className="font-mono text-4xl font-black tracking-tight">{a.code}</div>
          <div className="mt-1 text-white/80">{a.serviceName} · {fmtDay(a.slotStart)} at {fmtClock(a.slotStart)}</div>
        </div>
        <Chip icon={st.icon} className={st.chip}>{st.label}</Chip>
      </div>
    </Card>
  );
}

type PanelProps = { a: AppointmentDetail; now: number; checkIn: () => void; checkingIn: boolean };

const PANELS: Record<AppointmentStatus, (p: PanelProps) => ReactNode> = {
  BOOKED: (p) => <Waiting {...p} />,
  NO_SHOW: (p) => <Waiting {...p} />, // the window closed: the same day, they can still come in as a normal customer
  CHECKED_IN: (p) => <CheckedIn {...p} />,
  LATE_DOWNGRADED: (p) => <CheckedIn {...p} />,
  CANCELLED: () => (
    <Card className="flex flex-col items-center gap-3 text-center">
      <XCircle className="size-12 text-muted" />
      <div className="text-xl font-bold">This booking was cancelled</div>
      <p className="text-ink-2">Book another time, or take a normal token at the kiosk.</p>
      <Link to="/book"><Button icon={CalendarPlus}>Book again</Button></Link>
    </Card>
  ),
};

/** What each phase says, and what the Check in button does (EARLY: nothing yet). */
const PHASE_COPY: Record<Phase, (a: AppointmentDetail, now: number) => { note: ReactNode; button: string; variant: 'primary' | 'warn' | 'ghost'; tone: string }> = {
  EARLY: (a, now) => ({
    note: <>Check-in opens at <b>{fmtClock(a.opensAt)}</b>, in {fmtCountdown(Date.parse(a.opensAt) - now)}.</>,
    button: `Check-in opens at ${fmtClock(a.opensAt)}`, variant: 'ghost', tone: 'bg-card text-ink-2',
  }),
  ON_TIME: (a) => ({
    note: <>Your check-in window is open until <b>{fmtClock(a.closesAt)}</b>. Check in to keep your appointment.</>,
    button: 'Check in now', variant: 'primary', tone: 'bg-emerald-50 text-emerald-900',
  }),
  LATE: (a) => ({
    note: <>Your check-in window closed at <b>{fmtClock(a.closesAt)}</b>. You can still come in and join the normal queue.</>,
    button: 'Check in as a normal customer', variant: 'warn', tone: 'bg-orange-50 text-orange-900',
  }),
};

function Waiting({ a, now, checkIn, checkingIn }: PanelProps) {
  const phase = phaseAt(a, now);
  const copy = PHASE_COPY[phase](a, now);
  const slot = Date.parse(a.slotStart);
  const expired = phase === 'LATE' && fmtDay(slot, now) !== 'Today'; // a past day: nothing to check in to
  return (
    <Card className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-sm text-muted">Your time</div>
          <div className="tabular text-3xl font-bold">{fmtClock(slot)}</div>
          <div className="text-xs text-muted">{fmtDay(slot, now)}</div>
        </div>
        <div>
          <div className="text-sm text-muted">{slot > now ? 'Starts in' : 'Started'}</div>
          <div className={cx('tabular text-3xl font-bold', phase === 'LATE' ? 'text-critical' : 'text-teal')}>{fmtCountdown(Math.abs(slot - now))}</div>
          <div className="text-xs text-muted">{slot > now ? 'until your appointment' : 'ago'}</div>
        </div>
      </div>
      <WindowBar a={a} now={now} />
      <div className={cx('flex items-start gap-2 rounded-xl p-3 text-sm', copy.tone)}>
        <CalendarClock className="mt-0.5 size-4 shrink-0" /><span>{copy.note}</span>
      </div>
      {expired ? (
        <p className="text-sm text-ink-2">This booking has expired. <Link to="/book" className="font-semibold text-brand hover:underline">Book again</Link> or take a normal token at the kiosk.</p>
      ) : (
        <Button size="xl" variant={copy.variant} icon={LogIn} disabled={phase === 'EARLY'} loading={checkingIn} onClick={checkIn}>{copy.button}</Button>
      )}
    </Card>
  );
}

/** The check-in window as a track (opens, booked time, closes) with a marker for now. */
function WindowBar({ a, now }: { a: AppointmentDetail; now: number }) {
  const opens = Date.parse(a.opensAt);
  const closes = Date.parse(a.closesAt);
  const at = (t: number) => `${((t - opens) / (closes - opens)) * 100}%`;
  const marker = Math.min(Math.max(now, opens), closes);
  return (
    <div>
      <div className="relative h-2 rounded-full bg-slate-200">
        <div className="absolute inset-y-0 left-0 rounded-full bg-teal/60" style={{ width: at(marker) }} />
        <div className="absolute -top-1 h-4 w-0.5 bg-navy" style={{ left: at(Date.parse(a.slotStart)) }} title="Your time" />
        {now >= opens && now <= closes && <span className="absolute -top-1 size-4 -translate-x-1/2 animate-ring rounded-full bg-brand" style={{ left: at(now) }} title="Now" />}
      </div>
      <div className="tabular mt-1.5 flex justify-between text-[11px] text-muted">
        <span>Opens {fmtClock(opens)}</span>
        <span>Your time {fmtClock(a.slotStart)}</span>
        <span>Closes {fmtClock(closes)}</span>
      </div>
    </div>
  );
}

function CheckedIn({ a }: PanelProps) {
  const late = a.status === 'LATE_DOWNGRADED';
  const Icon = late ? CalendarX : CalendarCheck;
  return (
    <Card className="flex flex-col items-center gap-3 text-center">
      <Icon className={cx('size-12', late ? 'text-orange-600' : 'text-teal')} />
      <div className="text-xl font-bold">{late ? 'Checked in after your window' : "You're checked in"}</div>
      <p className="text-ink-2">
        {late ? 'You arrived after your check-in window, so you joined the normal queue.' : 'Your token is planned around your booked time.'}
      </p>
      {a.token && (
        <>
          <div className="text-5xl font-black tracking-tight">{a.token.code}</div>
          <Link to={statusLink(a.token.id, a.token.key)}><Button icon={ArrowRight}>Track {a.token.code} live</Button></Link>
        </>
      )}
    </Card>
  );
}
