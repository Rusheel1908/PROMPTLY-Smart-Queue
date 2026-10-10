import {
  AlertTriangle, Ban, CalendarCheck, CalendarClock, CalendarX, CheckCircle2, CircleDot, Clock, CreditCard, HeartPulse, HelpCircle,
  Hourglass, Landmark, LogOut, Megaphone, PhoneMissed, Shuffle, Siren, UserRound, Wallet, XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { AppointmentStatus, CounterStatus, TokenClass, TokenState } from './types';

export const SERVICE_ICON: Record<string, LucideIcon> = {
  wallet: Wallet, landmark: Landmark, help: HelpCircle, card: CreditCard,
};
export const serviceIcon = (name: string) => SERVICE_ICON[name] ?? CircleDot;

export const CLASS_META: Record<TokenClass, { label: string; short: string; icon: LucideIcon; chip: string; series: string }> = {
  EMERGENCY: { label: 'Emergency', short: 'EMG', icon: Siren, chip: 'bg-red-50 text-red-700 ring-red-200', series: 'var(--color-s2)' },
  PRIORITY: { label: 'Priority', short: 'PRI', icon: HeartPulse, chip: 'bg-amber-50 text-amber-800 ring-amber-200', series: 'var(--color-s4)' },
  APPOINTMENT: { label: 'Appointment', short: 'APT', icon: CalendarCheck, chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', series: 'var(--color-s3)' },
  NORMAL: { label: 'Normal', short: 'STD', icon: UserRound, chip: 'bg-slate-100 text-slate-700 ring-slate-200', series: 'var(--color-s1)' },
};

export const STATE_META: Record<TokenState, { label: string; icon: LucideIcon; chip: string }> = {
  WAITING: { label: 'Waiting', icon: Hourglass, chip: 'bg-blue-50 text-blue-700 ring-blue-200' },
  CALLED: { label: 'Called', icon: Megaphone, chip: 'bg-amber-50 text-amber-800 ring-amber-200' },
  SERVING: { label: 'Being served', icon: UserRound, chip: 'bg-teal-50 text-teal-700 ring-teal-200' },
  DONE: { label: 'Done', icon: CheckCircle2, chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  MISSED: { label: 'Missed turn', icon: PhoneMissed, chip: 'bg-orange-50 text-orange-700 ring-orange-200' },
  NO_SHOW: { label: 'No-show', icon: Ban, chip: 'bg-red-50 text-red-700 ring-red-200' },
  REDIRECTED: { label: 'Redirected', icon: Shuffle, chip: 'bg-violet-50 text-violet-700 ring-violet-200' },
  CANCELLED: { label: 'Cancelled', icon: XCircle, chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

export const APPOINTMENT_META: Record<AppointmentStatus, { label: string; icon: LucideIcon; chip: string }> = {
  BOOKED: { label: 'Booked', icon: CalendarClock, chip: 'bg-blue-50 text-blue-700 ring-blue-200' },
  CHECKED_IN: { label: 'Checked in', icon: CalendarCheck, chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  LATE_DOWNGRADED: { label: 'Late: normal queue', icon: Clock, chip: 'bg-orange-50 text-orange-700 ring-orange-200' },
  NO_SHOW: { label: 'Missed', icon: CalendarX, chip: 'bg-red-50 text-red-700 ring-red-200' },
  CANCELLED: { label: 'Cancelled', icon: XCircle, chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

export const COUNTER_META: Record<CounterStatus, { label: string; dot: string; chip: string; icon: LucideIcon }> = {
  OPEN: { label: 'Open', dot: 'bg-good', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: CheckCircle2 },
  PAUSED: { label: 'Paused', dot: 'bg-warning', chip: 'bg-amber-50 text-amber-800 ring-amber-200', icon: Hourglass },
  CLOSED: { label: 'Closed', dot: 'bg-critical', chip: 'bg-red-50 text-red-700 ring-red-200', icon: LogOut },
};

export const RISK_ICON = AlertTriangle;

/** Human event descriptions for the live feed. Unknown types fall back to the raw name. */
export const EVENT_TEXT: Record<string, (e: { code: string | null; counter: string | null; payload: any }) => string> = {
  TOKEN_ISSUED: (e) => `${e.code} joined ${e.payload?.service ?? ''}${e.payload?.class === 'NORMAL' ? '' : ` (${String(e.payload?.class).toLowerCase()})`}`,
  CALLED: (e) => `${e.code} called to ${e.counter}`,
  CALL_EMPTY: (e) => `${e.counter} found nobody eligible`,
  RECALLED: (e) => `${e.code} recalled at ${e.counter ?? 'counter'}`,
  SERVING: (e) => `${e.code} being served at ${e.counter}`,
  COMPLETED: (e) => `${e.code} done in ${Number(e.payload?.minutes ?? 0).toFixed(1)} min`,
  MISSED: (e) => `${e.code} missed their turn → ${String(e.payload?.outcome ?? '').toLowerCase().replace('_', '-')}`,
  REDIRECTED: (e) => `${e.payload?.from} redirected as ${e.payload?.to}`,
  COUNTER_CHANGED: (e) => `${e.counter} ${e.payload?.status ? `→ ${String(e.payload.status).toLowerCase()}` : 'skills updated'}`,
  STEPPED_AWAY: (e) => `${e.code} stepped away for ${e.payload?.minutes} min`,
  CANCELLED: (e) => `${e.code} cancelled`,
  REACTIVATED: (e) => `${e.code} reactivated`,
  DEMO_RESET: () => 'Demo reset',
  SUGGESTION_APPLIED: (e) => `Suggestion applied: ${e.payload?.explanation ?? ''}`,
  APPOINTMENT_BOOKED: (e) => `Appointment booked for ${fmtClock(e.payload?.slotStart)}`,
  APPOINTMENT_CHECKED_IN: (e) => `${e.code} checked in for an appointment${e.payload?.phase === 'LATE' ? ' (late → normal queue)' : ''}`,
  APPOINTMENT_NO_SHOW: () => 'A booked customer did not arrive',
  APPOINTMENT_CANCELLED: () => 'An appointment was cancelled',
};
export const describeEvent = (e: { type: string; code: string | null; counter: string | null; payload: any }) =>
  (EVENT_TEXT[e.type] ?? (() => e.type))(e);

export const fmtMin = (m: number | null | undefined) =>
  m == null ? '—' : m < 1 ? '<1 min' : `${Math.round(m)} min`;

export const fmtClock = (d: string | number | Date | null | undefined) =>
  d == null ? '—' : new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const fmtAgo = (d: string | number, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - new Date(d).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** "4:05" under an hour, "2 h 05 min" beyond. */
export const fmtCountdown = (ms: number) =>
  ms < 3_600_000 ? fmtDuration(ms) : `${Math.floor(ms / 3_600_000)} h ${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')} min`;

/** "Today", "Tomorrow", or a weekday (bookings are for today and tomorrow). */
export const fmtDay = (d: string | number | Date, now = Date.now()) => {
  const midnight = (x: string | number | Date) => new Date(x).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(d) - midnight(now)) / 86_400_000); // rounded, so a DST day still counts as one
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : new Date(d).toLocaleDateString([], { weekday: 'long' });
};

export const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

/** A customer's private tracking link: the token id plus its access key (from the ticket QR). */
export const statusLink = (id: string, key: string) => `/status/${id}?k=${encodeURIComponent(key)}`;
export const appointmentLink = (id: string, key: string) => `/appointment/${id}?k=${encodeURIComponent(key)}`;
