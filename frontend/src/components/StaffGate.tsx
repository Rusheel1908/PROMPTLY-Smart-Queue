import { motion } from 'framer-motion';
import { KeyRound, Lock } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, staffPin } from '../lib/api';
import { Button, Card } from './ui';

type Phase = 'checking' | 'locked' | 'open';

/** Whether this browser holds a valid staff PIN. `unlock` stores a candidate and rejects if it is wrong. */
export function useStaff() {
  const [phase, setPhase] = useState<Phase>('checking');

  const unlock = useCallback((candidate: string) => {
    staffPin.set(candidate);
    return api('/auth/check').then(() => setPhase('open')).catch((e) => {
      staffPin.clear();
      setPhase('locked');
      return Promise.reject(e);
    });
  }, []);
  const lock = useCallback(() => { staffPin.clear(); setPhase('locked'); }, []);

  useEffect(() => { unlock(staffPin.get()).catch(() => undefined); }, [unlock]);
  return { phase, unlock, lock };
}

/** The shared PIN form: shakes and clears on a wrong PIN, calls `onUnlocked` on a right one. */
export function PinForm({ unlock, onUnlocked }: { unlock: (pin: string) => Promise<void>; onUnlocked?: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);

  const submit = () => unlock(pin).then(onUnlocked, (e) => {
    setError(e instanceof ApiError && e.status === 401 ? 'Wrong PIN' : 'Cannot reach the server. Is the backend running?');
    setShake((n) => n + 1);
    setPin('');
  });

  return (
    <motion.form key={shake} animate={{ x: shake ? [0, -10, 10, -6, 6, 0] : 0 }} transition={{ duration: 0.4 }}
      className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input autoFocus inputMode="numeric" type="password" value={pin} onChange={(e) => { setPin(e.target.value); setError(''); }}
        placeholder="••••" className="h-14 rounded-xl text-center text-2xl tracking-[0.5em] ring-1 ring-line outline-none focus:ring-2 focus:ring-brand" />
      {error && <div className="text-sm font-medium text-critical">{error}</div>}
      <Button type="submit" size="lg" icon={KeyRound} disabled={!pin}>Unlock</Button>
      <p className="text-center text-xs text-muted">Demo PIN: 1234</p>
    </motion.form>
  );
}

/** Staff screens ask for the shared PIN once per browser (stand-in for real staff sessions). */
export function StaffGate({ children, title }: { children: ReactNode; title: string }) {
  const { phase, unlock } = useStaff();

  const SCREENS: Record<Phase, () => ReactNode> = {
    checking: () => null,
    open: () => children,
    locked: () => (
      <div className="grid min-h-[70vh] place-items-center">
        <Card initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm text-center">
          <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-navy text-white"><Lock className="size-7" /></div>
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="mt-1 mb-5 text-sm text-ink-2">Staff only. Enter the branch PIN.</p>
          <PinForm unlock={unlock} />
        </Card>
      </div>
    ),
  };
  return <>{SCREENS[phase]()}</>;
}
