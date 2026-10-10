import { Bell, BellOff, BellRing, Share, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { currentEndpoint, enablePush, following, permission, pushSupport } from '../lib/push';
import { Button, useAction } from './ui';

type PushView = 'ios-home-screen' | 'unsupported' | 'blocked' | 'on' | 'off';

/**
 * "Notify me": Web Push, so alerts arrive with the page closed. Permission is asked only when the button is tapped.
 * Used for a token (status page) and a booking (appointment page); `save`/`forget` send the subscription to its route.
 */
export function NotifyMe({ followId, label, save, forget }: {
  followId: string; label: string; save: (sub: PushSubscriptionJSON) => Promise<unknown>; forget: (endpoint: string) => Promise<unknown>;
}) {
  const support = useMemo(pushSupport, []);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [on, setOn] = useState(() => following.get(followId) && permission() === 'granted');
  const [blocked, setBlocked] = useState(() => permission() === 'denied');
  const { run, busy } = useAction();
  useEffect(() => {
    api<{ publicKey: string | null }>('/push/key').then((r) => setPublicKey(r.publicKey)).catch(() => setPublicKey(null));
  }, []);
  if (!publicKey) return null; // push is not set up on this server: in-page alerts only

  const turnOn = async () => {
    const result = await run('push', () => enablePush(publicKey, save));
    result === 'granted' && (following.set(followId, true), setOn(true));
    result === 'denied' && setBlocked(true);
  };
  const turnOff = async () => {
    const done = await run('push', async () => {
      const endpoint = await currentEndpoint();
      endpoint && (await forget(endpoint));
      return true;
    });
    done && (following.set(followId, false), setOn(false));
  };

  const view: PushView = support !== 'ready' ? support : blocked ? 'blocked' : on ? 'on' : 'off';
  const VIEWS: Record<PushView, () => ReactNode> = {
    'ios-home-screen': () => (
      <Hint icon={Share}>
        On iPhone, alerts with the page closed need Promptly on your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>, and open it from there.
      </Hint>
    ),
    unsupported: () => <Hint icon={BellOff}>This browser can't alert you once the page is closed, so keep this page open.</Hint>,
    blocked: () => <Hint icon={BellOff}>Notifications are blocked for this site. Allow them in your browser settings to get alerts with the page closed.</Hint>,
    off: () => (
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={Bell} loading={busy === 'push'} onClick={turnOn}>Notify me</Button>
        <span className="text-sm text-muted">Get alerts on this phone even when this page is closed.</span>
      </div>
    ),
    on: () => (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-teal"><BellRing className="size-4" /> Notifications on for {label}</span>
        <Button variant="ghost" size="sm" icon={BellOff} loading={busy === 'push'} onClick={turnOff}>Stop</Button>
      </div>
    ),
  };
  return <>{VIEWS[view]()}</>;
}

export const Hint = ({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) => (
  <div className="flex items-start gap-2 rounded-xl bg-card p-3 text-sm text-ink-2"><Icon className="mt-0.5 size-4 shrink-0" /><span>{children}</span></div>
);
