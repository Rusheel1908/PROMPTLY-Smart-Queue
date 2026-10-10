import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ArrowRight, Bell, BellOff, BellRing, CheckCircle2, Clock, Coffee, History, Megaphone, PartyPopper, PhoneMissed,
  Share, Shuffle, TrendingDown, TrendingUp, Volume2, VolumeX, X, XCircle, type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EtaBand } from '../components/EtaBand';
import { Button, Card, Chip, Empty, Modal, Skeleton, useAction } from '../components/ui';
import { alertUser, unlockAudioOnFirstTap, useMuted } from '../lib/alerts';
import { api } from '../lib/api';
import { CLASS_META, cx, fmtAgo, fmtClock, fmtMin, STATE_META, statusLink } from '../lib/format';
import { useAnnouncements, useNow, useSocket, useThrottled } from '../lib/live';
import { currentEndpoint, enablePush, following, permission, pushSupport } from '../lib/push';
import type { NotifyEvent, TokenDetail, TokenNotification, TokenState } from '../lib/types';

/** The ticket's access key travels as ?k= in the QR link and is sent on every call for this token. */
const tokenApi = (id: string, key: string) => <T,>(path = '', json?: unknown, method?: string) =>
  api<T>(`/tokens/${id}${path}`, { json, method, headers: { 'x-token-key': key } });

export default function Status() {
  const { id = '' } = useParams();
  const key = useSearchParams()[0].get('k') ?? '';
  const call = useMemo(() => tokenApi(id, key), [id, key]);
  const [t, setT] = useState<TokenDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [yourTurn, setYourTurn] = useState(false);
  const now = useNow(5000);
  const { muted, toggle: toggleMute } = useMuted();
  const banner = useNotificationBanner(t, muted);
  useEffect(unlockAudioOnFirstTap, []);

  // a wrong or missing key gets the same 404 as an unknown token
  const load = useCallback(() => call<TokenDetail>().then(setT).catch(() => setMissing(true)), [call]);
  useEffect(() => { setT(null); setMissing(false); load(); }, [load]);
  const onPing = useThrottled(load);
  useSocket((m) => {
    m.type === 'queue' && onPing();
    // a notification for this code: fetch it now (with our key), not at the next throttled refresh
    m.type === 'notify' && !!t && (m.data as { code: string }).code === t.code && load();
  });
  useAnnouncements((a) => {
    const mine = !!t && a.code === t.code;
    mine && setYourTurn(true); // the beep and vibration come with the CALLED notification
    mine && !muted && speak(`Token ${a.code.split('').join(' ')}, please go to ${a.counter}`);
  });

  const phase = (missing && 'missing') || (t && 'ready') || 'loading';
  const VIEWS = {
    missing: () => (
      <Empty icon={XCircle} title="This link is invalid or has expired"
        hint="Scan the QR code on your ticket again, or ask at the desk and staff can look up your token." />
    ),
    loading: () => <div className="mx-auto max-w-xl space-y-4"><Skeleton className="h-36" /><Skeleton className="h-52" /><Skeleton className="h-40" /></div>,
    ready: () => (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <Header t={t!} />
        <AlertBanner n={banner.shown} live={banner.live} onClose={banner.dismiss} />
        <AnimatePresence mode="wait">
          <motion.div key={t!.state} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {STATE_PANELS[t!.state]({ t: t!, now, reload: load, call })}
          </motion.div>
        </AnimatePresence>
        <Alerts t={t!} call={call} muted={muted} onToggleMute={toggleMute} />
        <WhyChanged t={t!} now={now} />
        <YourTurn open={yourTurn && t!.state === 'CALLED'} t={t!} onClose={() => setYourTurn(false)} />
      </div>
    ),
  };
  return VIEWS[phase]();
}

/* ---------- in-page alerts ---------- */

/** Older notifications are shown on open only if this recent; anything older is history, not news. */
const FRESH_ON_OPEN_MS = 15 * 60_000;

/**
 * The banner shows the newest notification. Ones already there when the page opened appear quietly;
 * ones that arrive while it is open also beep and vibrate (unless muted).
 */
function useNotificationBanner(t: TokenDetail | null, muted: boolean) {
  const seen = useRef<{ tokenId: string; ids: Set<number> } | null>(null);
  const [shown, setShown] = useState<TokenNotification | null>(null);
  const [live, setLive] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    if (!t) return;
    const list = t.notifications ?? [];
    if (seen.current?.tokenId !== t.id) { // first load of this token: nothing is new yet
      seen.current = { tokenId: t.id, ids: new Set(list.map((n) => n.id)) };
      const latest = list[0];
      setShown(latest && Date.now() - new Date(latest.ts).getTime() < FRESH_ON_OPEN_MS ? latest : null);
      setLive(false);
      return;
    }
    const fresh = list.filter((n) => !seen.current!.ids.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach((n) => seen.current!.ids.add(n.id));
    setShown(fresh[0]);
    setLive(true);
    mutedRef.current || alertUser(fresh[0].urgency);
  }, [t]);

  return { shown, live, dismiss: () => setShown(null) };
}

const EVENT_META: Record<NotifyEvent, { icon: LucideIcon; tone: string }> = {
  NEXT_UP: { icon: BellRing, tone: 'bg-blue-50 text-blue-900 ring-blue-200' },
  CALLED: { icon: Megaphone, tone: 'bg-amber-50 text-amber-900 ring-amber-300' },
  RECALLED: { icon: Megaphone, tone: 'bg-orange-50 text-orange-900 ring-orange-300' },
  MISSED: { icon: PhoneMissed, tone: 'bg-orange-50 text-orange-900 ring-orange-300' },
  NO_SHOW: { icon: XCircle, tone: 'bg-red-50 text-red-900 ring-red-200' },
  BIG_DELAY: { icon: Clock, tone: 'bg-slate-50 text-slate-900 ring-slate-200' },
};

function AlertBanner({ n, live, onClose }: { n: TokenNotification | null; live: boolean; onClose: () => void }) {
  const meta = n && (EVENT_META[n.event] ?? EVENT_META.NEXT_UP);
  return (
    <AnimatePresence>
      {n && meta && (
        <motion.div key={n.id} role="status" aria-live="assertive"
          initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: live ? [1, 1.02, 1] : 1 }} exit={{ opacity: 0, y: -8 }}
          className={cx('flex items-start gap-3 rounded-2xl p-4 ring-1', meta.tone, live && n.urgency === 'high' && 'ring-2')}>
          <meta.icon className={cx('mt-0.5 size-5 shrink-0', live && 'animate-bounce')} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{n.title}</div>
            <div className="text-sm opacity-90">{n.body}</div>
            <div className="mt-1 text-xs opacity-60">{fmtClock(n.ts)}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Dismiss" className="-m-1 rounded-lg p-1 opacity-60 hover:opacity-100">
            <X className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Nothing more will happen to these tokens, so there is nothing to alert about. */
const FINISHED: TokenState[] = ['DONE', 'CANCELLED', 'NO_SHOW', 'REDIRECTED'];

function Alerts({ t, call, muted, onToggleMute }: { t: TokenDetail; call: PanelProps['call']; muted: boolean; onToggleMute: () => void }) {
  if (FINISHED.includes(t.state)) return null;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold"><Bell className="size-4" /> Alerts</div>
        <Button variant="ghost" size="sm" icon={muted ? VolumeX : Volume2} onClick={onToggleMute} aria-pressed={muted}>
          {muted ? 'Sound off' : 'Sound on'}
        </Button>
      </div>
      <p className="text-sm text-ink-2">
        While this page is open, it {muted ? 'shows a banner' : 'beeps, vibrates and shows a banner'} when you're almost up, when you're called, and if your time changes a lot.
      </p>
      <NotifyMe t={t} call={call} />
    </Card>
  );
}

type PushView = 'ios-home-screen' | 'unsupported' | 'blocked' | 'on' | 'off';

/** "Notify me": Web Push, so alerts arrive with the page closed. Permission is asked only when the button is tapped. */
function NotifyMe({ t, call }: { t: TokenDetail; call: PanelProps['call'] }) {
  const support = useMemo(pushSupport, []);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [on, setOn] = useState(() => following.get(t.id) && permission() === 'granted');
  const [blocked, setBlocked] = useState(() => permission() === 'denied');
  const { run, busy } = useAction();
  useEffect(() => {
    api<{ publicKey: string | null }>('/push/key').then((r) => setPublicKey(r.publicKey)).catch(() => setPublicKey(null));
  }, []);
  if (!publicKey) return null; // push is not set up on this server: in-page alerts only

  const turnOn = async () => {
    const result = await run('push', () => enablePush(publicKey, (sub) => call('/push', sub)));
    result === 'granted' && (following.set(t.id, true), setOn(true));
    result === 'denied' && setBlocked(true);
  };
  const turnOff = async () => {
    const done = await run('push', async () => {
      const endpoint = await currentEndpoint();
      endpoint && (await call('/push', { endpoint }, 'DELETE'));
      return true;
    });
    done && (following.set(t.id, false), setOn(false));
  };

  const view: PushView = support !== 'ready' ? support : blocked ? 'blocked' : on ? 'on' : 'off';
  const VIEWS: Record<PushView, () => ReactNode> = {
    'ios-home-screen': () => (
      <Hint icon={Share}>
        On iPhone, alerts with the page closed need Promptly on your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>, and open it from there.
      </Hint>
    ),
    unsupported: () => <Hint icon={BellOff}>This browser can't alert you once the page is closed, so keep this page open.</Hint>,
    blocked: () => <Hint icon={BellOff}>Notifications are blocked for this site. Allow them in your browser settings to get alerts with the page closed.</Hint>,
    off: () => (
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={Bell} loading={busy === 'push'} onClick={turnOn}>Notify me</Button>
        <span className="text-sm text-muted">Get alerts on this phone even when this page is closed.</span>
      </div>
    ),
    on: () => (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-teal"><BellRing className="size-4" /> Notifications on for {t.code}</span>
        <Button variant="ghost" size="sm" icon={BellOff} loading={busy === 'push'} onClick={turnOff}>Stop</Button>
      </div>
    ),
  };
  return <>{VIEWS[view]()}</>;
}

const Hint = ({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) => (
  <div className="flex items-start gap-2 rounded-xl bg-card p-3 text-sm text-ink-2"><Icon className="mt-0.5 size-4 shrink-0" /><span>{children}</span></div>
);

function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    speechSynthesis.speak(u);
  } catch { /* speech not available */ }
}

function Header({ t }: { t: TokenDetail }) {
  const cls = CLASS_META[t.class];
  const st = STATE_META[t.state];
  return (
    <Card className="relative overflow-hidden bg-navy text-white ring-0">
      <div className="grid-dots absolute inset-0 opacity-20" />
      <div className="relative flex items-center justify-between gap-4">
        <div>
          <div className="text-xs tracking-[0.3em] text-white/60 uppercase">Token</div>
          <div className="text-5xl font-black tracking-tight">{t.code}</div>
          <div className="mt-1 text-white/80">{t.serviceName}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Chip icon={st.icon} className={st.chip}>{st.label}</Chip>
          {t.class !== 'NORMAL' && <Chip icon={cls.icon} className={cls.chip}>{cls.label}</Chip>}
        </div>
      </div>
    </Card>
  );
}

type PanelProps = { t: TokenDetail; now: number; reload: () => void; call: ReturnType<typeof tokenApi> };

const STATE_PANELS: Record<TokenState, (p: PanelProps) => ReactNode> = {
  WAITING: (p) => <Waiting {...p} />,
  CALLED: ({ t }) => (
    <Card className="border-2 border-warning bg-amber-50 text-center ring-0">
      <Megaphone className="mx-auto size-12 animate-bounce text-amber-600" />
      <div className="mt-2 text-2xl font-bold">It's your turn!</div>
      <div className="mt-1 text-lg">Please go to <b>{t.counterName}</b> now</div>
      <div className="mt-2 text-sm text-ink-2">If you don't arrive within about 90 seconds, you'll re-enter the queue near the front.</div>
    </Card>
  ),
  SERVING: ({ t }) => <Message icon={CheckCircle2} tone="text-teal" title={`Being served at ${t.counterName}`} body="Thanks for your patience." />,
  DONE: () => <Message icon={PartyPopper} tone="text-good" title="All done" body="Thanks for visiting. Have a great day!" />,
  MISSED: ({ t }) => <Message icon={PhoneMissed} tone="text-orange-600" title="You missed your call" body={`You'll be called again shortly, near the front. Expected ${fmtClock(t.etaP50)}.`} />,
  NO_SHOW: () => <Message icon={PhoneMissed} tone="text-critical" title="Marked as no-show" body="You missed two calls. Please speak to the desk and they can reactivate your token with your original place credited." />,
  REDIRECTED: ({ t }) => (
    <Card className="text-center">
      <Shuffle className="mx-auto size-10 text-violet-600" />
      <div className="mt-2 text-xl font-bold">You've been redirected</div>
      <p className="mt-1 text-ink-2">Your new token keeps your original arrival time, so you aren't sent to the back.</p>
      {t.child && <Link to={statusLink(t.child.id, t.child.key)}><Button className="mt-4" icon={ArrowRight}>Track {t.child.code}</Button></Link>}
    </Card>
  ),
  CANCELLED: () => <Message icon={XCircle} tone="text-muted" title="Token cancelled" body="You can take a new token at the kiosk anytime." />,
};

const Message = ({ icon: Icon, tone, title, body }: { icon: typeof CheckCircle2; tone: string; title: string; body: string }) => (
  <Card className="text-center">
    <Icon className={cx('mx-auto size-12', tone)} />
    <div className="mt-2 text-xl font-bold">{title}</div>
    <p className="mt-1 text-ink-2">{body}</p>
  </Card>
);

function Waiting({ t, now, reload, call }: PanelProps) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [awayOpen, setAwayOpen] = useState(false);
  const { run, busy } = useAction();
  const away = (minutes: number) => run('away', () => call('/away', { minutes }), () => `We'll hold your place for ${minutes} min`).then(() => { setAwayOpen(false); reload(); });
  const cancel = () => run('cancel', () => call('/cancel', {}), () => 'Token cancelled').then(() => { setConfirmCancel(false); reload(); });
  const steppedAway = new Date(t.notBefore).getTime() > now;

  return (
    <Card className="flex flex-col gap-5">
      {t.unavailable ? (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 p-4 text-red-800">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div><b>Wait time unavailable.</b> No open counter can serve {t.serviceName} right now. Staff have been alerted, and we'll never show you a made-up number.</div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Big label="Expected call" value={fmtClock(t.etaP50)} hint={`likely · in ${fmtMin(t.etaMin)}`} />
            <Big label="Promise" value={t.promiseP90 ? `by ${fmtClock(t.promiseP90)}` : '—'} hint="9 in 10 customers" tone={t.atRisk ? 'text-critical' : 'text-teal'} />
          </div>
          <EtaBand now={now} p50={new Date(t.etaP50!).getTime()} p90={new Date(t.etaP90!).getTime()} promise={t.promiseP90 ? new Date(t.promiseP90).getTime() : null} />
          <Ahead ahead={t.ahead} />
          {t.atRisk && (
            <div className="flex items-start gap-2 rounded-xl bg-orange-50 p-3 text-sm text-orange-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Your promise is at risk. See below for why. Staff can see this too.
            </div>
          )}
        </>
      )}
      {steppedAway && <div className="flex items-center gap-2 rounded-xl bg-card p-3 text-sm"><Coffee className="size-4" /> You're away. We won't call you before {fmtClock(t.notBefore)}.</div>}
      <div className="flex gap-2">
        <Button variant="ghost" icon={Coffee} className="flex-1" onClick={() => setAwayOpen(true)}>I'm stepping away</Button>
        <Button variant="ghost" icon={XCircle} onClick={() => setConfirmCancel(true)}>Cancel</Button>
      </div>
      <Modal open={awayOpen} onClose={() => setAwayOpen(false)} title="Step away for…">
        <div className="grid grid-cols-3 gap-2">
          {[5, 10, 15].map((m) => <Button key={m} variant="ghost" size="lg" loading={busy === 'away'} onClick={() => away(m)}>{m} min</Button>)}
        </div>
        <p className="mt-3 text-sm text-ink-2">You keep your place. We just won't call you during this time.</p>
      </Modal>
      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel your token?">
        <p className="text-ink-2">You'll lose your place in the queue.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep it</Button>
          <Button variant="danger" loading={busy === 'cancel'} onClick={cancel}>Cancel token</Button>
        </div>
      </Modal>
    </Card>
  );
}

const Big = ({ label, value, hint, tone = 'text-ink' }: { label: string; value: string; hint: string; tone?: string }) => (
  <div>
    <div className="text-sm text-muted">{label}</div>
    <motion.div key={value} initial={{ scale: 1.15, color: '#1f6feb' }} animate={{ scale: 1, color: '' }} className={cx('tabular text-3xl font-bold', tone)}>{value}</motion.div>
    <div className="text-xs text-muted">{hint}</div>
  </div>
);

function Ahead({ ahead }: { ahead: number }) {
  const shown = Math.min(ahead, 12);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold">{ahead === 0 ? "You're next!" : `${ahead} ahead of you`}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <AnimatePresence>
          {Array.from({ length: shown }, (_, i) => (
            <motion.span key={i} layout initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0, opacity: 0 }}
              className="size-3 rounded-full bg-slate-300" />
          ))}
        </AnimatePresence>
        {ahead > shown && <span className="text-xs text-muted">+{ahead - shown}</span>}
        <motion.span layout className="ml-1 size-4 animate-ring rounded-full bg-brand" title="You" />
      </div>
    </div>
  );
}

function WhyChanged({ t, now }: { t: TokenDetail; now: number }) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2 font-semibold"><History className="size-4" /> Why my time changed</div>
      {t.changes.length === 0 ? (
        <p className="text-sm text-muted">No changes yet. Your estimate has held steady.</p>
      ) : (
        <ol className="relative ml-2 border-l-2 border-line">
          <AnimatePresence initial={false}>
            {t.changes.map((c) => {
              const later = c.deltaS > 0;
              const Icon = later ? TrendingUp : TrendingDown;
              return (
                <motion.li key={c.ts + c.reason} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="relative mb-3 pl-5">
                  <span className={cx('absolute top-1 -left-[7px] size-3 rounded-full ring-2 ring-white', later ? 'bg-serious' : 'bg-good')} />
                  <div className="flex items-center gap-2 text-sm">
                    <span className={cx('tabular inline-flex items-center gap-1 font-bold', later ? 'text-orange-700' : 'text-emerald-700')}>
                      <Icon className="size-3.5" />{later ? '+' : '−'}{Math.max(1, Math.round(Math.abs(c.deltaS) / 60))} min
                    </span>
                    <span className="text-xs text-muted">{fmtClock(c.ts)} · {fmtAgo(c.ts, now)}</span>
                  </div>
                  <div className="text-sm text-ink-2">{c.reason}</div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </Card>
  );
}

function YourTurn({ open, t, onClose }: { open: boolean; t: TokenDetail; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-brand p-6 text-center text-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div initial={{ scale: 0.6 }} animate={{ scale: [0.6, 1.08, 1] }} transition={{ duration: 0.6 }}>
            <Megaphone className="mx-auto size-20 animate-bounce" />
            <div className="mt-4 text-6xl font-black">{t.code}</div>
            <div className="mt-3 text-2xl">Please go to <b>{t.counterName}</b></div>
            <div className="mt-6 text-sm text-white/70">Tap anywhere to dismiss</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
