import { motion } from 'framer-motion';
import { KeyRound, Lock } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, staffPin } from '../lib/api';
import { Button, Card } from './ui';

type Phase = 'checking' | 'locked' | 'open';

/** Staff screens ask for the shared PIN once per browser (stand-in for real staff sessions). */
export function StaffGate({ children, title }: { children: ReactNode; title: string }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);

  const check = (candidate: string) => {
    staffPin.set(candidate);
    return api('/auth/check').then(() => setPhase('open')).catch(() => {
      staffPin.clear();
      setPhase('locked');
      return Promise.reject();
    });
  };

  useEffect(() => { check(staffPin.get()).catch(() => undefined); }, []);

  const submit = () => check(pin).catch(() => { setError('Wrong PIN'); setShake((n) => n + 1); setPin(''); });

  const SCREENS: Record<Phase, () => ReactNode> = {
    checking: () => null,
    open: () => children,
    locked: () => (
      <div className="grid min-h-[70vh] place-items-center">
        <Card initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm text-center">
          <motion.div key={shake} animate={{ x: shake ? [0, -10, 10, -6, 6, 0] : 0 }} transition={{ duration: 0.4 }}>
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-navy text-white"><Lock className="size-7" /></div>
            <h2 className="text-xl font-bold">{title}</h2>
            <p className="mt-1 text-sm text-ink-2">Staff only. Enter the branch PIN.</p>
            <form className="mt-5 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <input autoFocus inputMode="numeric" type="password" value={pin} onChange={(e) => { setPin(e.target.value); setError(''); }}
                placeholder="••••" className="h-14 rounded-xl text-center text-2xl tracking-[0.5em] ring-1 ring-line outline-none focus:ring-2 focus:ring-brand" />
              {error && <div className="text-sm font-medium text-critical">{error}</div>}
              <Button type="submit" size="lg" icon={KeyRound} disabled={!pin}>Unlock</Button>
              <p className="text-xs text-muted">Demo PIN: 1234</p>
            </form>
          </motion.div>
        </Card>
      </div>
    ),
  };
  return <>{SCREENS[phase]()}</>;
}
