import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, Check, Clock, ExternalLink, Lock, Ticket, Users } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LoginForm, useStaff } from '../components/StaffGate';
import { Button, Card, Modal, Skeleton, useAction } from '../components/ui';
import { api } from '../lib/api';
import { CLASS_META, cx, fmtClock, fmtMin, serviceIcon, statusLink } from '../lib/format';
import { useSnapshot } from '../lib/live';
import { prefetchOn } from '../lib/pages';
import type { PublicSnapshot, Service, Token, TokenClass } from '../lib/types';

type Issued = Token & { serviceName: string; secret: string };
const CLASSES: TokenClass[] = ['NORMAL', 'APPOINTMENT', 'PRIORITY', 'EMERGENCY'];
const TICKET_SECONDS = 25;

export default function Kiosk() {
  const { snap } = useSnapshot<PublicSnapshot>();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [cls, setCls] = useState<TokenClass>('NORMAL');
  const { can, logout } = useStaff();
  const staff = can('issue-priority');
  const [pinPrompt, setPinPrompt] = useState<TokenClass | null>(null);
  const [ticket, setTicket] = useState<Issued | null>(null);
  const { run, busy } = useAction();

  const selected = snap?.services.find((s) => s.id === serviceId) ?? null;

  const chooseClass = (c: TokenClass) => (c === 'NORMAL' || staff ? setCls(c) : setPinPrompt(c));

  const issue = async () => {
    const t = await run('issue', () => api<Issued>('/tokens', { json: { serviceId, class: cls } }));
    t && (setTicket(t), setServiceId(null), setCls('NORMAL'));
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <section>
        <motion.h1 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">
          Welcome. What brings you in today?
        </motion.h1>
        <p className="mt-2 text-ink-2">Pick a service. Waits are live forecasts from the actual queue, shown as a range.</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {(snap?.services ?? []).map((s, i) => (
            <ServiceCard key={s.id} s={s} index={i} selected={s.id === serviceId} onSelect={() => setServiceId(s.id)} />
          ))}
          {!snap && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      </section>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <Card className="flex flex-col gap-5">
          <div>
            <div className="text-sm font-semibold text-ink-2">1. Service</div>
            <AnimatePresence mode="wait">
              <motion.div key={selected?.id ?? 'none'} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
                className={cx('mt-1 text-xl font-bold', !selected && 'text-muted')}>
                {selected?.name ?? 'Choose a service'}
              </motion.div>
            </AnimatePresence>
          </div>

          <div>
            <div className="flex items-center justify-between text-sm font-semibold text-ink-2">
              <span>2. Customer type</span>
              {staff && <button onClick={() => { logout(); setCls('NORMAL'); }} className="text-xs text-muted hover:text-ink">Lock staff mode (log out)</button>}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {CLASSES.map((c) => {
                const meta = CLASS_META[c];
                const locked = c !== 'NORMAL' && !staff;
                return (
                  <motion.button key={c} whileTap={{ scale: 0.95 }} onClick={() => chooseClass(c)}
                    className={cx('relative flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold ring-1 transition-all',
                      cls === c ? 'bg-navy text-white ring-navy' : 'bg-white ring-line hover:ring-brand/50')}>
                    <meta.icon className="size-4 shrink-0" />
                    {meta.label}
                    {locked && <Lock className="ml-auto size-3.5 opacity-50" />}
                  </motion.button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted">Priority types are verified by staff to keep the queue fair.</p>
          </div>

          <Button size="lg" icon={Ticket} disabled={!selected} loading={busy === 'issue'} onClick={issue}>
            Get my token
          </Button>
        </Card>
      </aside>

      <Modal open={!!pinPrompt} onClose={() => setPinPrompt(null)} title="Staff verification">
        <p className="mb-4 text-sm text-ink-2">{pinPrompt && CLASS_META[pinPrompt].label} needs a staff member to log in and verify it.</p>
        <LoginForm onLoggedIn={() => { pinPrompt && setCls(pinPrompt); setPinPrompt(null); }} />
      </Modal>
      <AnimatePresence>{ticket && <TicketOverlay t={ticket} onClose={() => setTicket(null)} />}</AnimatePresence>
    </div>
  );
}

function ServiceCard({ s, selected, onSelect, index }: { s: Service; selected: boolean; onSelect: () => void; index: number }) {
  const Icon = serviceIcon(s.icon);
  const unavailable = s.capable === 0;
  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }}
      whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }} onClick={onSelect}
      className={cx('group relative overflow-hidden rounded-2xl bg-white p-5 text-left shadow-sm ring-1 transition-shadow hover:shadow-xl',
        selected ? 'ring-2 ring-brand shadow-xl shadow-brand/15' : 'ring-line')}
    >
      <div className="absolute -top-10 -right-10 size-32 rounded-full bg-card transition-transform duration-500 group-hover:scale-150" />
      <div className="relative flex items-start justify-between">
        <div className={cx('grid size-12 place-items-center rounded-xl transition-colors', selected ? 'bg-brand text-white' : 'bg-card text-brand')}>
          <Icon className="size-6" />
        </div>
        <AnimatePresence>
          {selected && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="grid size-7 place-items-center rounded-full bg-brand text-white">
              <Check className="size-4" />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="relative mt-4 text-lg font-bold">{s.name}</div>
      <div className="relative mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {unavailable ? (
          <span className="flex items-center gap-1.5 font-semibold text-critical"><AlertTriangle className="size-4" /> No counter open right now</span>
        ) : (
          <span className="flex items-center gap-1.5 text-ink-2">
            <Clock className="size-4" />
            <span className="tabular font-semibold text-ink">{fmtMin(s.quote?.p50Min)}</span>
            <span className="text-muted">likely · up to {fmtMin(s.quote?.p90Min)}</span>
          </span>
        )}
        <span className="flex items-center gap-1.5 text-muted"><Users className="size-4" /> {s.waiting} waiting</span>
      </div>
    </motion.button>
  );
}

function TicketOverlay({ t, onClose }: { t: Issued; onClose: () => void }) {
  const link = statusLink(t.id, t.secret);
  const url = `${location.origin}${link}`;
  const meta = CLASS_META[t.class];
  useEffect(() => {
    const id = setTimeout(onClose, TICKET_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [onClose]);

  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-navy/60 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 120, rotate: -4, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', bounce: 0.35 }}
        className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="bg-navy px-6 pt-6 pb-8 text-center text-white">
          <div className="text-xs font-semibold tracking-[0.3em] text-white/60 uppercase">Your token</div>
          <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2, type: 'spring', bounce: 0.5 }}
            className="shimmer-text mt-1 text-7xl font-black tracking-tight">{t.code}</motion.div>
          <div className="mt-2 flex items-center justify-center gap-2 text-sm text-white/80">
            {t.serviceName} · <meta.icon className="size-4" /> {meta.label}
          </div>
        </div>
        <div className="relative -mt-4 flex justify-between px-0">
          <span className="size-8 -translate-x-1/2 rounded-full bg-navy/60" />
          <span className="flex-1 self-center border-t-2 border-dashed border-line" />
          <span className="size-8 translate-x-1/2 rounded-full bg-navy/60" />
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-6 pb-6">
          <div className="flex flex-col gap-3">
            {t.unavailable || !t.etaP50 ? (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                No counter can serve this right now. We'll show a time as soon as one opens.
              </div>
            ) : (
              <>
                <Line label="Expected call" value={fmtClock(t.etaP50)} hint="likely" />
                <Line label="Promise" value={`by ${fmtClock(t.promiseP90)}`} hint="9 in 10 customers" />
              </>
            )}
          </div>
          <div className="rounded-xl bg-white p-2 ring-1 ring-line"><QRCodeSVG value={url} size={96} /></div>
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <Link to={link} className="flex-1" {...prefetchOn(link)}><Button className="w-full" icon={ExternalLink}>Track live</Button></Link>
          <Button variant="ghost" onClick={onClose} icon={ArrowRight}>Done</Button>
        </div>
        <motion.div className="h-1 bg-brand" initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: TICKET_SECONDS, ease: 'linear' }} />
      </motion.div>
    </motion.div>
  );
}

const Line = ({ label, value, hint }: { label: string; value: string; hint: string }) => (
  <div>
    <div className="text-xs text-muted">{label}</div>
    <div className="tabular text-2xl font-bold">{value}</div>
    <div className="text-[11px] text-muted">{hint}</div>
  </div>
);
