import { motion } from 'framer-motion';
import { KeyRound, Lock, LogOut, ShieldAlert } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, session, setOnSessionLost } from '../lib/api';
import { cx } from '../lib/format';
import type { LoginResult, Me, Permission, StaffRole, StaffUser } from '../lib/types';
import { Button, Card } from './ui';

type Phase = 'checking' | 'out' | 'in';

export const ROLE_LABEL: Record<StaffRole, string> = { STAFF: 'Staff', SUPERVISOR: 'Supervisor' };

interface StaffSession {
  phase: Phase;
  me: Me | null;
  /** Rejects with the ApiError on a wrong PIN or a lockout. */
  login: (staffId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Whether the logged-in role may do an action (the server's PERMISSIONS table, via /auth/me). */
  can: (action: Permission) => boolean;
}

const StaffContext = createContext<StaffSession | null>(null);

/** One staff session for the whole app: header, gates and buttons all read it. */
export function StaffProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [me, setMe] = useState<Me | null>(null);

  const signedOut = useCallback(() => { session.clear(); setMe(null); setPhase('out'); }, []);
  const loadMe = useCallback(() => api<Me>('/auth/me').then((m) => { setMe(m); setPhase('in'); }), []);

  // resume this tab's session, if any; any later 401 (expired, logged out elsewhere) returns to the login screen
  useEffect(() => {
    setOnSessionLost(signedOut);
    session.get() ? loadMe().catch(signedOut) : setPhase('out');
  }, [loadMe, signedOut]);

  const login = useCallback(async (staffId: string, pin: string) => {
    const r = await api<LoginResult>('/auth/login', { json: { staffId, pin } });
    session.set(r.token);
    await loadMe();
  }, [loadMe]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { json: {} }).catch(() => undefined); // logged out locally either way
    signedOut();
  }, [signedOut]);

  const value = useMemo<StaffSession>(() => ({
    phase, me, login, logout, can: (action) => !!me?.permissions.includes(action),
  }), [phase, me, login, logout]);
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

export function useStaff() {
  const ctx = useContext(StaffContext);
  if (!ctx) throw new Error('useStaff needs <StaffProvider>');
  return ctx;
}

const OFFLINE = 'Cannot reach the server. Is the backend running?';

/** Login error → what the form says. 429 carries the server's lockout message. */
const LOGIN_ERRORS: [(e: unknown) => boolean, (e: ApiError) => string][] = [
  [(e) => e instanceof ApiError && e.status === 401, () => 'Wrong name or PIN'],
  [(e) => e instanceof ApiError && e.status === 429, (e) => e.message],
  [() => true, () => OFFLINE],
];

/** Pick your name, enter your PIN. Shakes and clears on a wrong PIN, calls `onLoggedIn` on success. */
export function LoginForm({ onLoggedIn }: { onLoggedIn?: () => void }) {
  const { login } = useStaff();
  const [people, setPeople] = useState<{ id: string; name: string }[] | null>(null);
  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ id: string; name: string }[]>('/auth/staff').then(setPeople).catch(() => setError(OFFLINE));
  }, []);

  const submit = () => {
    setBusy(true);
    login(staffId, pin).then(onLoggedIn, (e) => {
      setError(LOGIN_ERRORS.find(([matches]) => matches(e))![1](e));
      setShake((n) => n + 1);
      setPin('');
    }).finally(() => setBusy(false));
  };

  return (
    <motion.form key={shake} animate={{ x: shake ? [0, -10, 10, -6, 6, 0] : 0 }} transition={{ duration: 0.4 }}
      className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Who are you?">
        {(people ?? []).map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={staffId === p.id}
            onClick={() => { setStaffId(p.id); setError(''); }}
            className={cx('rounded-xl px-4 py-2 text-sm font-semibold ring-1 transition-colors',
              staffId === p.id ? 'bg-navy text-white ring-navy' : 'bg-white text-ink-2 ring-line hover:text-ink')}>
            {p.name}
          </button>
        ))}
        {people?.length === 0 && <p className="text-sm text-muted">No staff accounts yet. Run <code>npm run db:seed</code>.</p>}
      </div>
      <input inputMode="numeric" type="password" autoComplete="current-password" value={pin} aria-label="PIN"
        onChange={(e) => { setPin(e.target.value); setError(''); }} disabled={!staffId}
        placeholder={staffId ? '••••••' : 'Pick your name first'}
        className="h-14 rounded-xl text-center text-2xl tracking-[0.5em] ring-1 ring-line outline-none placeholder:text-base placeholder:tracking-normal focus:ring-2 focus:ring-brand disabled:bg-page" />
      {error && <div className="text-sm font-medium text-critical">{error}</div>}
      <Button type="submit" size="lg" icon={KeyRound} loading={busy} disabled={!staffId || !pin}>Log in</Button>
    </motion.form>
  );
}

const GateCard = ({ title, icon: Icon, children }: { title: string; icon: typeof Lock; children: ReactNode }) => (
  <div className="grid min-h-[70vh] place-items-center">
    <Card initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm text-center">
      <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-navy text-white"><Icon className="size-7" /></div>
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </Card>
  </div>
);

/** Staff screens: log in first; `need` names an action the role must be allowed (e.g. Ops needs a supervisor). */
export function StaffGate({ children, title, need }: { children: ReactNode; title: string; need?: Permission }) {
  const { phase, me, can, logout } = useStaff();

  const SCREENS: Record<Phase, () => ReactNode> = {
    checking: () => null,
    out: () => (
      <GateCard title={title} icon={Lock}>
        <p className="mt-1 mb-5 text-sm text-ink-2">Staff only. Pick your name and enter your PIN.</p>
        <LoginForm />
      </GateCard>
    ),
    in: () => (!need || can(need) ? children : (
      <GateCard title={title} icon={ShieldAlert}>
        <p className="mt-1 mb-5 text-sm text-ink-2">
          Supervisors only. You're logged in as {me?.staff.name} ({ROLE_LABEL[me?.staff.role ?? 'STAFF']}).
        </p>
        <Button variant="ghost" icon={LogOut} onClick={logout}>Log out to switch account</Button>
      </GateCard>
    )),
  };
  return <>{SCREENS[phase]()}</>;
}

/** Header badge: "Asha (Supervisor)" + log out. */
export function StaffBadge() {
  const { me, logout } = useStaff();
  if (!me) return null;
  const who: StaffUser = me.staff;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="hidden text-white/70 lg:inline">Logged in as</span>
      <span className="font-semibold">{who.name} <span className="font-normal text-white/70">({ROLE_LABEL[who.role]})</span></span>
      <button onClick={logout} title="Log out" aria-label="Log out"
        className="grid size-8 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white">
        <LogOut className="size-4" />
      </button>
    </div>
  );
}
