import { motion } from 'framer-motion';
import { fmtClock } from '../lib/format';

/**
 * Visual band from now → P90 with markers for the likely call (P50) and the frozen promise.
 * Times are ms epoch; a band, never a falsely precise minute.
 */
export function EtaBand({ now, p50, p90, promise }: { now: number; p50: number; p90: number; promise: number | null }) {
  const end = Math.max(p90, promise ?? 0, now + 60_000) + 60_000;
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - now) / (end - now)) * 100));
  const at = (t: number) => `${pos(t)}%`;
  const breach = promise != null && p90 > promise;
  return (
    <div className="w-full">
      <div className="relative h-14">
        <div className="absolute inset-x-0 top-6 h-2 rounded-full bg-slate-100" />
        <motion.div className="absolute top-6 h-2 rounded-full bg-gradient-to-r from-brand/30 to-brand"
          initial={{ left: at(p50), width: 0 }} animate={{ left: at(p50), width: `calc(${at(p90)} - ${at(p50)})` }}
          transition={{ type: 'spring', bounce: 0.2 }} />
        <Marker pos={pos(p50)} label="likely" time={fmtClock(p50)} className="bg-brand" top />
        {promise != null && (
          <Marker pos={pos(promise)} label="promise" time={fmtClock(promise)} className={breach ? 'bg-critical' : 'bg-teal'} />
        )}
        <div className="absolute top-5 left-0 size-4 rounded-full border-2 border-white bg-navy shadow" title="Now" />
      </div>
      <div className="flex justify-between text-[11px] text-muted"><span>now</span><span>{fmtClock(end)}</span></div>
    </div>
  );
}

/** A label near either end hangs inward from its tick, so it never spills off a narrow (phone) screen. */
const anchor = (pos: number) => (pos < 20 ? 'items-start' : pos > 80 ? '-translate-x-full items-end' : '-translate-x-1/2 items-center');

function Marker({ pos, label, time, className, top }: { pos: number; label: string; time: string; className: string; top?: boolean }) {
  const left = `${pos}%`;
  return (
    <motion.div className={`absolute flex flex-col ${anchor(pos)}`} style={{ top: top ? 0 : 22 }}
      initial={{ left }} animate={{ left }} transition={{ type: 'spring', bounce: 0.2 }}>
      {top && <span className="tabular text-[11px] font-semibold whitespace-nowrap text-ink-2">{label} {time}</span>}
      <span className={`mt-0.5 h-4 w-1 rounded-full ${className}`} />
      {!top && <span className="tabular text-[11px] font-semibold whitespace-nowrap text-ink-2">{label} {time}</span>}
    </motion.div>
  );
}
