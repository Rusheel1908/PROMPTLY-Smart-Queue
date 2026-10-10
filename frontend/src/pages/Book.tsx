import { AnimatePresence, motion } from 'framer-motion';
import { CalendarCheck, CalendarPlus, CalendarX, Check, ExternalLink, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Empty, Skeleton, useAction } from '../components/ui';
import { api } from '../lib/api';
import { appointmentLink, cx, fmtClock, fmtDay, serviceIcon } from '../lib/format';
import { useSnapshot } from '../lib/live';
import { prefetchOn } from '../lib/pages';
import type { AppointmentView, PublicSnapshot, SlotList } from '../lib/types';

/** POST /api/appointments: the only response that carries the booking link's key. */
type Booked = AppointmentView & { secret: string };

export default function Book() {
  const { snap } = useSnapshot<PublicSnapshot>();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotList | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [slot, setSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);
  const { run, busy } = useAction();

  useEffect(() => {
    setSlots(null);
    setSlot(null);
    setSlotsError(null);
    if (!serviceId) return;
    let live = true; // a late answer for the previously picked service is dropped
    api<SlotList>(`/appointments/slots?serviceId=${encodeURIComponent(serviceId)}`)
      .then((s) => live && setSlots(s))
      .catch((e) => live && setSlotsError(e.message));
    return () => { live = false; };
  }, [serviceId, reload]);

  const days = useMemo(() => {
    const groups = new Map<string, SlotList['slots']>();
    (slots?.slots ?? []).forEach((s) => groups.set(fmtDay(s.start), [...(groups.get(fmtDay(s.start)) ?? []), s]));
    return [...groups];
  }, [slots]);

  const book = async () => {
    const b = await run('book', () => api<Booked>('/appointments', { json: { serviceId, slotStart: slot } }));
    b ? setBooked(b) : setReload((n) => n + 1); // e.g. the slot just filled up: show what is still open
  };

  if (booked) return <Confirmation b={booked} onAgain={() => { setBooked(null); setServiceId(null); }} />;

  const selected = snap?.services.find((s) => s.id === serviceId) ?? null;
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <section className="flex flex-col gap-6">
        <div>
          <motion.h1 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">
            Book a time
          </motion.h1>
          <p className="mt-2 text-ink-2">Pick a service and a time today or tomorrow. Booked customers are served around their time.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(snap?.services ?? []).map((s) => {
            const Icon = serviceIcon(s.icon);
            const on = s.id === serviceId;
            return (
              <motion.button key={s.id} whileTap={{ scale: 0.97 }} onClick={() => setServiceId(s.id)}
                className={cx('flex items-center gap-3 rounded-2xl bg-white p-4 text-left font-semibold shadow-sm ring-1 transition-shadow hover:shadow-lg',
                  on ? 'ring-2 ring-brand' : 'ring-line')}>
                <span className={cx('grid size-10 place-items-center rounded-xl', on ? 'bg-brand text-white' : 'bg-card text-brand')}><Icon className="size-5" /></span>
                {s.name}
                {on && <Check className="ml-auto size-4 text-brand" />}
              </motion.button>
            );
          })}
          {!snap && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[74px]" />)}
        </div>

        {serviceId && (
          <Card className="flex flex-col gap-5">
            <div className="font-semibold">Choose a time{slots && <span className="font-normal text-muted"> · {slots.slotMin}-minute slots, {slots.capacity} places each</span>}</div>
            {!slots && !slotsError && <Skeleton className="h-32" />}
            {slotsError && <p className="text-sm text-critical">{slotsError}</p>}
            {slots && days.length === 0 && <Empty icon={CalendarX} title="No open times" hint="Every slot today and tomorrow is taken. You can still take a normal token at the kiosk." />}
            {days.map(([day, list]) => (
              <div key={day}>
                <div className="mb-2 text-sm font-semibold text-ink-2">{day}</div>
                <div className="flex flex-wrap gap-2">
                  {list.map((s) => (
                    <motion.button key={s.start} whileTap={{ scale: 0.94 }} onClick={() => setSlot(s.start)} aria-pressed={slot === s.start}
                      className={cx('tabular flex w-[84px] flex-col items-center rounded-xl px-2 py-1.5 ring-1 transition-colors',
                        slot === s.start ? 'bg-navy text-white ring-navy' : 'bg-white ring-line hover:ring-brand/50')}>
                      <span className="font-bold">{fmtClock(s.start)}</span>
                      <span className={cx('text-[11px]', slot === s.start ? 'text-white/70' : 'text-muted')}>{s.left} left</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <Card className="flex flex-col gap-5">
          <Summary label="1. Service" value={selected?.name} />
          <Summary label="2. Time" value={slot && `${fmtDay(slot)} at ${fmtClock(slot)}`} />
          <Button size="lg" icon={CalendarCheck} disabled={!slot} loading={busy === 'book'} onClick={book}>Book this time</Button>
          <div className="flex flex-col gap-2 text-xs text-muted">
            <p className="flex items-start gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0" /> No name or phone number. You get a booking code and a private link, nothing else.
            </p>
            {slots && (
              <p>
                Check in at the kiosk from {slots.checkIn.opensBeforeMin} min before your time until {slots.checkIn.closesAfterMin} min after.
                Later than that, you join the normal queue.
              </p>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}

const Summary = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div>
    <div className="text-sm font-semibold text-ink-2">{label}</div>
    <AnimatePresence mode="wait">
      <motion.div key={value ?? 'none'} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
        className={cx('mt-1 text-xl font-bold', !value && 'text-muted')}>
        {value || 'Not chosen yet'}
      </motion.div>
    </AnimatePresence>
  </div>
);

function Confirmation({ b, onAgain }: { b: Booked; onAgain: () => void }) {
  const link = appointmentLink(b.id, b.secret);
  return (
    <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', bounce: 0.3 }}
      className="mx-auto w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-line">
      <div className="bg-navy px-6 pt-6 pb-8 text-center text-white">
        <div className="text-xs font-semibold tracking-[0.3em] text-white/60 uppercase">Your booking code</div>
        <div className="shimmer-text mt-1 font-mono text-5xl font-black tracking-tight">{b.code}</div>
        <div className="mt-2 text-sm text-white/80">{b.serviceName} · {fmtDay(b.slotStart)} at {fmtClock(b.slotStart)}</div>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-6">
        <div>
          <div className="text-xs text-muted">Check in between</div>
          <div className="tabular text-2xl font-bold">{fmtClock(b.opensAt)}–{fmtClock(b.closesAt)}</div>
          <p className="mt-1 text-sm text-ink-2">Type the code at the kiosk, or open your booking and tap Check in.</p>
        </div>
        <div className="rounded-xl bg-white p-2 ring-1 ring-line"><QRCodeSVG value={`${location.origin}${link}`} size={104} /></div>
      </div>
      <p className="px-6 text-xs text-muted">
        Arrive after {fmtClock(b.closesAt)} and you join the normal queue. Keep this code or scan the QR: it is the only way to find your booking.
      </p>
      <div className="flex gap-2 p-6">
        <Link to={link} className="flex-1" {...prefetchOn(link)}><Button className="w-full" icon={ExternalLink}>Open my booking</Button></Link>
        <Button variant="ghost" icon={CalendarPlus} onClick={onAgain}>Book another</Button>
      </div>
    </motion.div>
  );
}
