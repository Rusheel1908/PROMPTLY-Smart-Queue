import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Coffee, History, Megaphone, PartyPopper, PhoneMissed, Shuffle, TrendingDown,
  TrendingUp, XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EtaBand } from '../components/EtaBand';
import { Button, Card, Chip, Empty, Modal, Skeleton, useAction } from '../components/ui';
import { api } from '../lib/api';
import { CLASS_META, cx, fmtAgo, fmtClock, fmtMin, STATE_META, statusLink } from '../lib/format';
import { useAnnouncements, useNow, useSocket, useThrottled } from '../lib/live';
import type { TokenDetail, TokenState } from '../lib/types';

/** The ticket's access key travels as ?k= in the QR link and is sent on every call for this token. */
const tokenApi = (id: string, key: string) => <T,>(path = '', json?: unknown) =>
  api<T>(`/tokens/${id}${path}`, { json, headers: { 'x-token-key': key } });

export default function Status() {
  const { id = '' } = useParams();
  const key = useSearchParams()[0].get('k') ?? '';
  const call = useMemo(() => tokenApi(id, key), [id, key]);
  const [t, setT] = useState<TokenDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [yourTurn, setYourTurn] = useState(false);
  const now = useNow(5000);

  // a wrong or missing key gets the same 404 as an unknown token
  const load = useCallback(() => call<TokenDetail>().then(setT).catch(() => setMissing(true)), [call]);
  useEffect(() => { setT(null); setMissing(false); load(); }, [load]);
  const onPing = useThrottled(load);
  useSocket((m) => { m.type === 'queue' && onPing(); });
  useAnnouncements((a) => {
    const mine = !!t && a.code === t.code;
    mine && setYourTurn(true);
    mine && navigator.vibrate?.([300, 120, 300]);
    mine && speak(`Token ${a.code.split('').join(' ')}, please go to ${a.counter}`);
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
        <AnimatePresence mode="wait">
          <motion.div key={t!.state} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {STATE_PANELS[t!.state]({ t: t!, now, reload: load, call })}
          </motion.div>
        </AnimatePresence>
        <WhyChanged t={t!} now={now} />
        <YourTurn open={yourTurn && t!.state === 'CALLED'} t={t!} onClose={() => setYourTurn(false)} />
      </div>
    ),
  };
  return VIEWS[phase]();
}

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
