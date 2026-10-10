import { MIN } from '../engine/types.js';
import type { MessageKey } from './messages.js';

/** What a customer can be told about their token… */
export type TokenEvent = 'NEXT_UP' | 'CALLED' | 'RECALLED' | 'MISSED' | 'NO_SHOW' | 'BIG_DELAY' | 'APPT_LATE';
/** …or, before check-in, about their appointment. */
export type AppointmentEvent = 'APPT_REMINDER' | 'APPT_MISSED' | 'APPT_CANCELLED';
export type NotifyEvent = TokenEvent | AppointmentEvent;
export type Urgency = 'normal' | 'high';

export interface Rule { titleKey: MessageKey; bodyKey: MessageKey; urgency: Urgency; sendPush: boolean }

/** Notification rules as data: every event's text, urgency and whether it goes out as Web Push. */
export const NOTIFY_RULES = {
  NEXT_UP: { titleKey: 'notify.nextUp.title', bodyKey: 'notify.nextUp.body', urgency: 'normal', sendPush: true },
  CALLED: { titleKey: 'notify.called.title', bodyKey: 'notify.called.body', urgency: 'high', sendPush: true },
  RECALLED: { titleKey: 'notify.recalled.title', bodyKey: 'notify.recalled.body', urgency: 'high', sendPush: true },
  MISSED: { titleKey: 'notify.missed.title', bodyKey: 'notify.missed.body', urgency: 'high', sendPush: true },
  NO_SHOW: { titleKey: 'notify.noShow.title', bodyKey: 'notify.noShow.body', urgency: 'high', sendPush: true },
  BIG_DELAY: { titleKey: 'notify.delay.title', bodyKey: 'notify.delay.body', urgency: 'normal', sendPush: true },
  APPT_LATE: { titleKey: 'notify.apptLate.title', bodyKey: 'notify.apptLate.body', urgency: 'normal', sendPush: true },
  APPT_REMINDER: { titleKey: 'notify.apptReminder.title', bodyKey: 'notify.apptReminder.body', urgency: 'normal', sendPush: true },
  APPT_MISSED: { titleKey: 'notify.apptMissed.title', bodyKey: 'notify.apptMissed.body', urgency: 'high', sendPush: true },
  APPT_CANCELLED: { titleKey: 'notify.apptCancelled.title', bodyKey: 'notify.apptCancelled.body', urgency: 'high', sendPush: true },
} as const satisfies Record<NotifyEvent, Rule>;

export const NOTIFY_CONFIG = {
  nextUpAhead: 2, // "about 2 people ahead"…
  nextUpMs: 3 * MIN, // …or an expected call this close
  bigDelayMs: 5 * MIN, // one ETA change later than this is worth interrupting someone for
  pushTtlS: { high: 10 * 60, normal: 30 * 60 } as Record<Urgency, number>, // a stale "go to Counter 3" is worse than none
  recentInDetail: 10, // notifications listed on the status page
};

/** Queue events that tell the token's holder something. A miss splits on whether the token re-entered. */
export const EVENT_NOTICE: Record<string, (payload: { outcome?: string } | null) => TokenEvent> = {
  CALLED: () => 'CALLED',
  RECALLED: () => 'RECALLED',
  MISSED: (p) => (p?.outcome === 'NO_SHOW' ? 'NO_SHOW' : 'MISSED'),
};

export const isNextUp = (ahead: number, p50: number, now: number, cfg = NOTIFY_CONFIG) =>
  ahead <= cfg.nextUpAhead || p50 - now <= cfg.nextUpMs;

export const isBigDelay = (deltaS: number, cfg = NOTIFY_CONFIG) => deltaS * 1000 > cfg.bigDelayMs;

/**
 * Dedupe key: each event once per round. A round is the token's miss count, so a token that re-enters after
 * a miss (or is reactivated) can be told "you're almost up" and "called" again. Delays dedupe per ETA change.
 */
export const dedupeKey = (event: NotifyEvent, round: number | string) => `${event}#${round}`;
