import { motion, MotionConfig } from 'framer-motion';
import { BellRing, KeyRound, LayoutDashboard, MonitorPlay, Route, Ticket, WifiOff, Zap, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cx, pct } from '../lib/format';
import { prefetchOn } from '../lib/pages';
import { LANDING } from './config';
import { HeroStage } from './HeroStage';
import './landing.css';
import { useLiveQueue, type LiveQueue } from './useLiveQueue';

const C = LANDING.colors;
const FOCUS = 'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC21A]';

const ENTRIES: { to: string; label: string; hint: string; icon: LucideIcon; primary?: boolean }[] = [
  { to: '/kiosk', label: 'Take a token', hint: 'Pick a service and get an honest wait promise.', icon: Ticket, primary: true },
  { to: '/board', label: 'Live board', hint: 'Who is being called, counter by counter.', icon: MonitorPlay },
  { to: '/counter', label: 'Staff login', hint: 'Log in to the counter console.', icon: KeyRound },
  { to: '/ops', label: 'Supervisor ops', hint: 'Promises, risk and what-if planning.', icon: LayoutDashboard },
];

const STEPS: { title: string; body: string; icon: LucideIcon }[] = [
  { title: 'Take a token', icon: Ticket, body: 'Pick a service at the kiosk. You get a token and a promised time range, not a guess.' },
  { title: 'Smart dispatch + forecast', icon: Route, body: 'Each counter calls the right next customer. Every wait is forecast by simulating the real queue: priority customers, missed turns and closed counters included.' },
  { title: 'Promise & live updates', icon: BellRing, body: 'Scan the QR code to follow your token live. When your time changes, Promptly tells you why.' },
];

const LEGEND: [string, string][] = [['Normal token', C.ink], ['Priority', C.priority], ['Missed turn', C.missed], ['Closed counter', C.gateClosed]];

function EntryButton({ to, label, icon: Icon, primary, size = 'md' }: (typeof ENTRIES)[number] & { size?: 'md' | 'lg' }) {
  return (
    <Link to={to} {...prefetchOn(to)}
      className={cx('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors', FOCUS,
        size === 'lg' ? 'h-14 px-6 text-base' : 'h-12 px-5 text-sm',
        primary ? 'bg-[#1F6FEB] text-white shadow-lg shadow-[#1F6FEB]/30 hover:bg-[#3a82f5]' : 'bg-white/8 text-[#EEF4FD] ring-1 ring-white/20 hover:bg-white/14')}>
      <Icon className="size-4.5 shrink-0" aria-hidden="true" />{label}
    </Link>
  );
}

function ModePill({ q }: { q: LiveQueue }) {
  const [label, color] = q.live ? ['Scene driven by the live queue', C.teal] : q.loading ? ['Connecting to the queue…', '#8B97AD'] : ['Demo animation', '#8B97AD'];
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1 text-xs font-medium text-[#EEF4FD]/85 ring-1 ring-white/15">
      <span className={cx('size-2 rounded-full', q.live && 'lp-pulse')} style={{ background: color }} aria-hidden="true" />{label}
    </span>
  );
}

function Hero({ q }: { q: LiveQueue }) {
  return (
    <section className="lp-space relative isolate flex min-h-[100svh] flex-col overflow-hidden lg:min-h-[min(100svh,920px)]" aria-labelledby="lp-title">
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
        <Link to="/" className={cx('flex items-center gap-2 rounded-lg font-bold tracking-tight text-white', FOCUS)}>
          <span className="grid size-8 place-items-center rounded-lg bg-[#1F6FEB]"><Zap className="size-4.5" aria-hidden="true" /></span>
          <span className="lp-display text-lg">Promptly</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1" aria-label="Main">
          {ENTRIES.slice(1).map(({ to, label }) => (
            <Link key={to} to={to} {...prefetchOn(to)} className={cx('hidden rounded-lg px-3 py-2 text-sm font-medium text-[#EEF4FD]/75 hover:text-white md:inline-block', FOCUS)}>{label}</Link>
          ))}
          <Link to="/kiosk" {...prefetchOn('/kiosk')} className={cx('ml-1 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-[#071A3D] hover:bg-[#EEF4FD]', FOCUS)}>Take a token</Link>
        </nav>
      </header>

      {/* scrim behind the copy only (desktop: left side; the scene stays clear on the right) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-0 hidden w-[56%] bg-[linear-gradient(90deg,rgba(4,15,36,0.94)_0%,rgba(4,15,36,0.75)_60%,rgba(4,15,36,0)_100%)] lg:block" />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pt-10 pb-6 sm:px-6 lg:pt-24">
        <ModePill q={q} />
        <h1 id="lp-title" className="lp-display mt-5 max-w-[14ch] text-[clamp(2.5rem,6.2vw,4.9rem)] leading-[1.02] font-extrabold tracking-tight text-white">
          Every token, an honest promise.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#EEF4FD]/85">
          Promptly forecasts your real wait, re-plans when the queue changes, and tells you why.
        </p>
        <div className="mt-8 flex max-w-2xl flex-wrap gap-3">
          {ENTRIES.map((e) => <EntryButton key={e.to} {...e} />)}
        </div>
        <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#EEF4FD]/75" aria-label="Scene legend">
          {LEGEND.map(([label, color]) => (
            <li key={label} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} aria-hidden="true" />{label}</li>
          ))}
        </ul>
      </div>

      {/* Queue Flow: behind the copy on desktop, its own band below the copy on small screens */}
      {/* edge fade so the canvas melts into the hero background (top edge on phones, left edge on desktop) */}
      <div className="relative h-[340px] w-full [mask-image:linear-gradient(to_bottom,transparent,black_18%)] sm:h-[420px] lg:absolute lg:inset-y-0 lg:right-0 lg:left-[42%] lg:z-[-1] lg:h-auto lg:w-auto lg:[mask-image:linear-gradient(to_right,transparent,black_14%)]" aria-hidden="true">
        <HeroStage q={q} />
      </div>
      <p className="sr-only">
        Illustration: tokens travel as glowing dots from a kiosk on the left to five counters, C1 to C5, on the right.
        Priority tokens in yellow merge ahead, missed tokens in orange loop back and re-enter near the front, and when a counter closes its tokens reroute to the others.
      </p>
    </section>
  );
}

const reveal = { initial: { opacity: 0, y: 24 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' } };

function HowItWorks() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6" aria-labelledby="lp-how">
      <h2 id="lp-how" className="lp-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">How it works</h2>
      <ol className="mt-10 grid gap-5 md:grid-cols-3">
        {STEPS.map(({ title, body, icon: Icon }, i) => (
          <motion.li key={title} {...reveal} transition={{ duration: 0.5, delay: i * 0.12 }}
            className="relative rounded-2xl bg-white/[0.04] p-6 ring-1 ring-white/10">
            <div className="flex items-center gap-3">
              <span className="lp-mono text-sm font-semibold text-[#FFC21A]">0{i + 1}</span>
              <span className="grid size-10 place-items-center rounded-xl bg-[#1F6FEB]/20 text-[#8db7ff]"><Icon className="size-5" aria-hidden="true" /></span>
            </div>
            <h3 className="lp-display mt-5 text-xl font-semibold text-white">{title}</h3>
            <p className="mt-2 leading-relaxed text-[#EEF4FD]/75">{body}</p>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

function LiveNow({ q }: { q: LiveQueue }) {
  const tiles: [string, string, string?][] = [
    ['Customers waiting', String(q.waiting)],
    ['Counters open', `${q.openCounters} / ${q.totalCounters}`],
    q.promiseKept == null ? ['Promises kept today', '—', 'No promises due yet today'] : ['Promises kept today', pct(q.promiseKept), 'Called by their promised time'],
  ];
  return (
    <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6" aria-labelledby="lp-live" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="lp-live" className="lp-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Live right now</h2>
        {q.live && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0E8F83]/20 px-2.5 py-1 text-xs font-bold tracking-wider text-[#5fe0d3] ring-1 ring-[#0E8F83]/50">
            <span className="lp-pulse size-1.5 rounded-full bg-[#5fe0d3]" aria-hidden="true" />LIVE
          </span>
        )}
      </div>
      {q.live ? (
        <dl className="mt-8 grid gap-5 sm:grid-cols-3">
          {tiles.map(([label, value, note]) => (
            <div key={label} className="rounded-2xl bg-white/[0.04] p-6 ring-1 ring-white/10">
              <dt className="text-sm font-medium text-[#EEF4FD]/75">{label}</dt>
              <dd className="lp-mono mt-2 text-4xl font-semibold text-white sm:text-5xl">{value}</dd>
              {note && <dd className="mt-2 text-xs text-[#EEF4FD]/60">{note}</dd>}
            </div>
          ))}
        </dl>
      ) : (
        <div className="mt-8 flex items-center gap-4 rounded-2xl bg-white/[0.04] p-6 ring-1 ring-white/10">
          <WifiOff className="size-6 shrink-0 text-[#8B97AD]" aria-hidden="true" />
          <div>
            <p className="font-semibold text-white">{q.loading ? 'Connecting to the live queue…' : 'Live data unavailable'}</p>
            <p className="mt-1 text-sm text-[#EEF4FD]/70">{q.loading ? 'Numbers appear as soon as the queue server answers.' : 'The queue server can’t be reached right now, so no numbers are shown.'}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function Entries() {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6" aria-labelledby="lp-start">
      <h2 id="lp-start" className="lp-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Jump in</h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ENTRIES.map(({ to, label, hint, icon: Icon, primary }) => (
          <Link key={to} to={to} {...prefetchOn(to)}
            className={cx('group flex flex-col gap-4 rounded-2xl p-6 ring-1 transition-colors', FOCUS,
              primary ? 'bg-[#1F6FEB] text-white ring-[#1F6FEB] hover:bg-[#3a82f5]' : 'bg-white/[0.04] text-white ring-white/10 hover:bg-white/[0.08]')}>
            <Icon className="size-7" aria-hidden="true" />
            <span>
              <span className="lp-display block text-xl font-semibold">{label}</span>
              <span className={cx('mt-1 block text-sm', primary ? 'text-white/85' : 'text-[#EEF4FD]/70')}>{hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Public landing page at "/": the Queue Flow hero, how it works, live numbers and the ways into the app. */
export default function Landing() {
  const q = useLiveQueue();
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[#040F24] text-[#EEF4FD]">
        <Hero q={q} />
        <main>
          <HowItWorks />
          <LiveNow q={q} />
          <Entries />
        </main>
        <footer className="border-t border-white/10 px-4 py-8 text-center text-sm text-[#EEF4FD]/65">Team Alpha · CBC015 · CBC 2.0</footer>
      </div>
    </MotionConfig>
  );
}
