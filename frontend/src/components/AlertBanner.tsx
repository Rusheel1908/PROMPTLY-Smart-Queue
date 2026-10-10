import { AnimatePresence, motion } from 'framer-motion';
import { BellRing, CalendarX, Clock, Megaphone, PhoneMissed, X, XCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { alertUser } from '../lib/alerts';
import { cx, fmtClock } from '../lib/format';
import type { NotifyEvent, TokenNotification } from '../lib/types';

/** Older notifications are shown on open only if this recent; anything older is history, not news. */
const FRESH_ON_OPEN_MS = 15 * 60_000;
/** Notifications this close together are one piece of news. */
const SAME_NEWS_MS = 60_000;

/**
 * The one to show (list newest first): the newest, unless an urgent one came with it. "You missed your turn" must not
 * be hidden by the routine "You're almost up" that the same miss triggers a second later.
 */
const headline = (list: TokenNotification[]) => {
  const newest = list[0];
  if (!newest) return null;
  const sameNews = list.filter((n) => Date.parse(newest.ts) - Date.parse(n.ts) <= SAME_NEWS_MS);
  return sameNews.find((n) => n.urgency === 'high') ?? newest;
};

/**
 * The banner shows the newest notification of a token or a booking. Ones already there when the page opened appear
 * quietly; ones that arrive while it is open also beep and vibrate (unless muted).
 */
export function useNotificationBanner(owner: { id: string; notifications: TokenNotification[] } | null, muted: boolean) {
  const seen = useRef<{ ownerId: string; ids: Set<number> } | null>(null);
  const [shown, setShown] = useState<TokenNotification | null>(null);
  const [live, setLive] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    if (!owner) return;
    const list = owner.notifications ?? [];
    if (seen.current?.ownerId !== owner.id) { // first load of this token or booking: nothing is new yet
      seen.current = { ownerId: owner.id, ids: new Set(list.map((n) => n.id)) };
      const latest = headline(list);
      setShown(latest && Date.now() - new Date(list[0].ts).getTime() < FRESH_ON_OPEN_MS ? latest : null);
      setLive(false);
      return;
    }
    const fresh = list.filter((n) => !seen.current!.ids.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach((n) => seen.current!.ids.add(n.id));
    const news = headline(fresh)!;
    setShown(news);
    setLive(true);
    mutedRef.current || alertUser(news.urgency);
  }, [owner]);

  return { shown, live, dismiss: () => setShown(null) };
}

const EVENT_META: Record<NotifyEvent, { icon: LucideIcon; tone: string }> = {
  NEXT_UP: { icon: BellRing, tone: 'bg-blue-50 text-blue-900 ring-blue-200' },
  CALLED: { icon: Megaphone, tone: 'bg-amber-50 text-amber-900 ring-amber-300' },
  RECALLED: { icon: Megaphone, tone: 'bg-orange-50 text-orange-900 ring-orange-300' },
  MISSED: { icon: PhoneMissed, tone: 'bg-orange-50 text-orange-900 ring-orange-300' },
  NO_SHOW: { icon: XCircle, tone: 'bg-red-50 text-red-900 ring-red-200' },
  BIG_DELAY: { icon: Clock, tone: 'bg-slate-50 text-slate-900 ring-slate-200' },
  APPT_LATE: { icon: Clock, tone: 'bg-orange-50 text-orange-900 ring-orange-300' },
  APPT_REMINDER: { icon: BellRing, tone: 'bg-blue-50 text-blue-900 ring-blue-200' },
  APPT_MISSED: { icon: CalendarX, tone: 'bg-orange-50 text-orange-900 ring-orange-300' },
  APPT_CANCELLED: { icon: XCircle, tone: 'bg-red-50 text-red-900 ring-red-200' },
};

export function AlertBanner({ n, live, onClose }: { n: TokenNotification | null; live: boolean; onClose: () => void }) {
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
