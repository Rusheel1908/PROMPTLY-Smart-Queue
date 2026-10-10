import { motion } from 'framer-motion';
import { FlaskConical, LayoutDashboard, MonitorPlay, Ticket, UserRoundCheck, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cx } from '../lib/format';
import { useConnected, useNow } from '../lib/live';
import { prefetchOn } from '../lib/pages';
import { StaffBadge } from './StaffGate';
import { LiveDot } from './ui';

const LINKS = [
  { to: '/kiosk', label: 'Kiosk', icon: Ticket },
  { to: '/counter', label: 'Counter', icon: UserRoundCheck },
  { to: '/board', label: 'Board', icon: MonitorPlay },
  { to: '/ops', label: 'Ops', icon: LayoutDashboard },
  { to: '/lab', label: 'Lab', icon: FlaskConical },
];

export function Layout({ children }: { children: ReactNode }) {
  const connected = useConnected();
  const now = useNow(1000);
  const { pathname } = useLocation();
  const fullBleed = pathname === '/board';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-navy text-white shadow-lg shadow-navy/20">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-6">
          <NavLink to="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-brand"><Zap className="size-4.5" /></span>
            <span className="hidden sm:inline">Promptly</span>
          </NavLink>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {LINKS.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/'} {...prefetchOn(to)}
                className={({ isActive }) => cx('relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', isActive ? 'text-white' : 'text-white/60 hover:text-white')}>
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-lg bg-white/12" transition={{ type: 'spring', bounce: 0.25, duration: 0.45 }} />}
                    <Icon className="relative size-4" />
                    <span className="relative hidden md:inline">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <StaffBadge />
          <LiveDot on={connected} />
          <span className="tabular hidden text-sm text-white/70 sm:inline">{new Date(now).toLocaleTimeString()}</span>
        </div>
      </header>
      <motion.main key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
        className={fullBleed ? '' : 'mx-auto max-w-7xl px-4 py-6'}>
        {children}
      </motion.main>
    </div>
  );
}
