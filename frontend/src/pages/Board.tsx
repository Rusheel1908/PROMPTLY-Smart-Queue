import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, BellRing, Maximize, Volume2, VolumeX } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { COUNTER_META, cx, fmtAgo, fmtMin, serviceIcon } from '../lib/format';
import { useAnnouncements, useNow, useSnapshot } from '../lib/live';
import type { Announcement, PublicSnapshot } from '../lib/types';

/** Two-note chime via WebAudio: no asset files needed. */
function chime(ctx: AudioContext) {
  [660, 880].forEach((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    const t = ctx.currentTime + i * 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.65);
  });
}

export default function Board() {
  const { snap } = useSnapshot<PublicSnapshot>();
  const now = useNow(1000);
  const [sound, setSound] = useState(false);
  const [flash, setFlash] = useState<Announcement | null>(null);
  const audio = useRef<AudioContext | null>(null);

  useAnnouncements((a) => {
    setFlash(a);
    setTimeout(() => setFlash((f) => (f === a ? null : f)), 6000);
    sound && audio.current && chime(audio.current);
    sound && setTimeout(() => {
      try { speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(`Token ${a.code.split('').join(' ')}, please go to ${a.counter}`), { rate: 0.9 })); } catch { /* no speech */ }
    }, 700);
  });

  const toggleSound = () => {
    audio.current ??= new AudioContext();
    setSound((s) => !s);
  };

  const latest = snap?.recentCalls.find((c) => c.state === 'CALLED') ?? snap?.recentCalls[0];
  const hero = flash ?? (latest && { code: latest.code, counter: latest.counter ?? '', recall: false });
  const upNext = (snap?.tokens ?? []).filter((t) => t.state === 'WAITING' && t.position != null).sort((a, b) => a.position! - b.position!).slice(0, 8);
  const svcName = Object.fromEntries((snap?.services ?? []).map((s) => [s.id, s.name]));

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#050f24] text-white">
      <div className="mx-auto grid max-w-[1600px] gap-6 p-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-6">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-navy-2 p-8 shadow-2xl shadow-brand/20">
            <div className="grid-dots absolute inset-0 opacity-30" />
            <div className="relative flex items-center justify-between">
              <div className="text-sm font-semibold tracking-[0.3em] text-white/70 uppercase">Now calling</div>
              <div className="flex gap-2">
                <IconBtn onClick={toggleSound} label={sound ? 'Mute' : 'Enable sound'}>{sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}</IconBtn>
                <IconBtn onClick={() => document.documentElement.requestFullscreen?.()} label="Fullscreen"><Maximize className="size-5" /></IconBtn>
              </div>
            </div>
            <AnimatePresence mode="popLayout">
              {hero ? (
                <motion.div key={hero.code + hero.counter + String(flash?.recall)} className="relative mt-4 flex flex-wrap items-end justify-between gap-6"
                  initial={{ rotateX: -90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} exit={{ rotateX: 90, opacity: 0 }} transition={{ type: 'spring', bounce: 0.3 }}>
                  <div className={cx('text-[clamp(5rem,12vw,10rem)] leading-none font-black tracking-tight', flash && 'animate-pulse')}>{hero.code}</div>
                  <div className="text-right">
                    <div className="text-white/70">please go to</div>
                    <div className="text-[clamp(2rem,4vw,3.5rem)] font-bold">{hero.counter}</div>
                    {flash?.recall && <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning px-3 py-1 text-sm font-bold text-navy"><BellRing className="size-4" /> Recall</div>}
                  </div>
                </motion.div>
              ) : (
                <motion.div key="none" className="relative mt-6 text-4xl font-bold text-white/50">Waiting for the first call…</motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(snap?.counters ?? []).map((c) => {
              const meta = COUNTER_META[c.status];
              const calling = c.current?.state === 'CALLED';
              return (
                <motion.div key={c.id} layout className={cx('rounded-2xl p-5 ring-1 transition-colors', calling ? 'bg-warning/15 ring-warning/60' : 'bg-white/5 ring-white/10', c.status !== 'OPEN' && 'opacity-50')}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-white/80">{c.name}</span>
                    <span className="flex items-center gap-1.5 text-white/60"><span className={cx('size-2 rounded-full', meta.dot)} />{meta.label}</span>
                  </div>
                  <AnimatePresence mode="wait">
                    <motion.div key={c.current?.code ?? 'idle'} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}
                      className={cx('mt-2 text-5xl font-black', calling ? 'text-warning' : c.current ? 'text-white' : 'text-white/25')}>
                      {c.current?.code ?? '—'}
                    </motion.div>
                  </AnimatePresence>
                  <div className="mt-1 text-xs text-white/50">{calling ? 'calling' : c.current ? 'serving' : 'available'}</div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-3xl bg-white/5 p-6 ring-1 ring-white/10">
            <div className="mb-4 text-sm font-semibold tracking-[0.2em] text-white/60 uppercase">Up next</div>
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {upNext.map((t, i) => (
                  <motion.li key={t.code} layout initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
                    className={cx('flex items-center gap-4 rounded-xl px-4 py-3', i === 0 ? 'bg-white/12' : 'bg-white/[0.03]')}>
                    <span className="w-6 text-white/40 tabular">{i + 1}</span>
                    <span className="w-24 font-mono text-2xl font-bold">{t.code}</span>
                    <span className="flex-1 truncate text-white/60">{svcName[t.serviceId]}</span>
                    <span className="tabular text-white/80">~{fmtMin(t.etaMin)}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
              {upNext.length === 0 && <li className="py-8 text-center text-white/40">No one waiting</li>}
            </ul>
          </div>

          <div className="rounded-3xl bg-white/5 p-6 ring-1 ring-white/10">
            <div className="mb-3 text-sm font-semibold tracking-[0.2em] text-white/60 uppercase">Services</div>
            <div className="grid grid-cols-2 gap-3">
              {(snap?.services ?? []).map((s) => {
                const Icon = serviceIcon(s.icon);
                return (
                  <div key={s.id} className="rounded-xl bg-white/[0.04] p-3">
                    <div className="flex items-center gap-2 font-semibold"><Icon className="size-4 text-[#86b6ef]" />{s.name}</div>
                    {s.capable === 0
                      ? <div className="mt-1 flex items-center gap-1 text-sm text-serious"><AlertTriangle className="size-3.5" /> unavailable</div>
                      : <div className="mt-1 text-sm text-white/60">{s.waiting} waiting · ~{fmtMin(s.quote?.p50Min)}</div>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl bg-white/5 p-6 ring-1 ring-white/10">
            <div className="mb-3 text-sm font-semibold tracking-[0.2em] text-white/60 uppercase">Recently called</div>
            <div className="flex flex-wrap gap-2">
              {(snap?.recentCalls ?? []).slice(0, 8).map((c) => (
                <span key={c.code + c.calledAt} className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-sm"><b className="font-mono">{c.code}</b> <span className="text-white/50">→ {c.counter} · {fmtAgo(c.calledAt, now)}</span></span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const IconBtn = ({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) => (
  <motion.button whileTap={{ scale: 0.9 }} onClick={onClick} title={label} aria-label={label} className="grid size-10 place-items-center rounded-xl bg-white/10 hover:bg-white/20">{children}</motion.button>
);
