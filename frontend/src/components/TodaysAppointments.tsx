import { CalendarCheck, CalendarDays, CalendarX, ExternalLink, Ticket, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { APPOINTMENT_META, appointmentLink, fmtClock, STATE_META } from '../lib/format';
import type { AppointmentStatus, AppointmentView, TodaysAppointments as Today } from '../lib/types';
import { Button, Card, Chip, Modal, Skeleton, useAction } from './ui';

type Row = Today['appointments'][number];
type DemoTiming = 'on-time' | 'late';
type DemoBooking = AppointmentView & { secret: string; timing: DemoTiming };
const STATUS_ORDER: AppointmentStatus[] = ['BOOKED', 'CHECKED_IN', 'LATE_DOWNGRADED', 'NO_SHOW', 'CANCELLED'];

/** Today's bookings with a count per status; a booking that has not checked in can be cancelled. `version` re-fetches on queue events. */
export function TodaysAppointments({ version }: { version: number | undefined }) {
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [demo, setDemo] = useState<DemoBooking | null>(null);
  const { run, busy } = useAction();

  const load = useCallback(() => api<Today>('/ops/appointments').then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [version, load]);

  const cancel = (row: Row) => run('cancel', () => api(`/appointments/${row.id}/cancel`, { json: {} }), () => `Booking ${row.code} cancelled. The customer is notified`)
    .then(() => { setConfirm(null); load(); });
  // check-in at any hour: a booking whose window is open now, or one that closed 15 min ago
  const makeDemo = (timing: DemoTiming) => run(`demo-${timing}`, () => api<AppointmentView & { secret: string }>('/demo/booking', { json: { timing } }))
    .then((b) => { b && setDemo({ ...b, timing }); load(); });

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-5 text-brand" />
          <div>
            <div className="font-semibold">Today's appointments</div>
            <div className="text-xs text-muted">Booked times and how each one went. Codes help a customer at the desk.</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" icon={CalendarCheck} loading={busy === 'demo-on-time'} onClick={() => makeDemo('on-time')}>Demo booking: on time</Button>
          <Button variant="ghost" size="sm" icon={CalendarX} loading={busy === 'demo-late'} onClick={() => makeDemo('late')}>Demo booking: late</Button>
        </div>
      </div>
      {data && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {STATUS_ORDER.map((s) => <Chip key={s} icon={APPOINTMENT_META[s].icon} className={APPOINTMENT_META[s].chip}>{APPOINTMENT_META[s].label} {data.counts[s]}</Chip>)}
        </div>
      )}
      {!data && !error && <Skeleton className="h-24" />}
      {error && !data && <p className="text-sm text-critical">{error}</p>}
      {data && data.appointments.length === 0 && <p className="py-4 text-center text-sm text-muted">No bookings for today yet.</p>}
      {data && data.appointments.length > 0 && (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-1.5 pr-3 font-semibold">Time</th>
                <th className="px-3 font-semibold">Code</th>
                <th className="px-3 font-semibold">Service</th>
                <th className="px-3 font-semibold">Status</th>
                <th className="px-3 font-semibold">Token</th>
                <th className="pl-3" />
              </tr>
            </thead>
            <tbody>
              {data.appointments.map((r) => {
                const st = APPOINTMENT_META[r.status];
                return (
                  <tr key={r.id} className="border-t border-line">
                    <td className="tabular py-2 pr-3 font-semibold">{fmtClock(r.slotStart)}</td>
                    <td className="px-3 font-mono text-xs">{r.code}</td>
                    <td className="px-3">{r.serviceName}</td>
                    <td className="px-3"><Chip icon={st.icon} className={st.chip}>{st.label}</Chip></td>
                    <td className="px-3">
                      {r.tokenCode ? <span className="font-mono font-semibold">{r.tokenCode}{r.tokenState && <span className="ml-1.5 font-sans text-xs font-normal text-muted">{STATE_META[r.tokenState].label}</span>}</span> : <span className="text-muted">—</span>}
                    </td>
                    <td className="pl-3 text-right">
                      {r.status === 'BOOKED' && <Button variant="ghost" size="sm" icon={XCircle} onClick={() => setConfirm(r)}>Cancel</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Cancel this booking?">
        <p className="text-ink-2">
          {confirm && <>Booking <b className="font-mono">{confirm.code}</b> at {fmtClock(confirm.slotStart)} ({confirm.serviceName}). </>}
          The customer is notified and the place in that slot is released.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>Keep it</Button>
          <Button variant="danger" loading={busy === 'cancel'} onClick={() => confirm && cancel(confirm)}>Cancel booking</Button>
        </div>
      </Modal>
      <Modal open={!!demo} onClose={() => setDemo(null)} title={demo?.timing === 'late' ? 'Late demo booking' : 'On-time demo booking'}>
        {demo && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl bg-navy p-4 text-center text-white">
              <div className="font-mono text-4xl font-black tracking-tight">{demo.code}</div>
              <div className="mt-1 text-sm text-white/80">{demo.serviceName} at {fmtClock(demo.slotStart)} · check-in {fmtClock(demo.opensAt)}–{fmtClock(demo.closesAt)}</div>
            </div>
            <p className="text-sm text-ink-2">
              {demo.timing === 'late'
                ? 'Its check-in window has closed: checking in now gives a normal token, with "Arrived after your check-in window". Until then, the sweeper marks it missed within a minute and tells the booking page.'
                : 'Its check-in window is open: checking in now gives an Appointment token, due around its booked time.'}
            </p>
            <div className="flex gap-2">
              <Link to={`/kiosk?booking=${encodeURIComponent(demo.code)}`} className="flex-1"><Button className="w-full" icon={Ticket}>Check in at the kiosk</Button></Link>
              <Link to={appointmentLink(demo.id, demo.secret)}><Button variant="ghost" icon={ExternalLink}>Booking page</Button></Link>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
