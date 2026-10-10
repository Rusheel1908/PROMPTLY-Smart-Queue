/**
 * Web Push for the status page: alerts that arrive with the tab closed. Works on Android Chrome and desktop browsers;
 * on iPhone only once the page is added to the home screen (Safari tabs cannot receive push).
 */
export type PushSupport = 'ready' | 'ios-home-screen' | 'unsupported';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const capable = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** First matching rule wins. */
const SUPPORT_RULES: [() => boolean, PushSupport][] = [
  [() => isIos() && !isStandalone(), 'ios-home-screen'],
  [capable, 'ready'],
  [() => true, 'unsupported'],
];
export const pushSupport = (): PushSupport => SUPPORT_RULES.find(([applies]) => applies())![1];

export const permission = (): NotificationPermission => ('Notification' in window ? Notification.permission : 'default');

/** VAPID public key (base64url) → the bytes PushManager.subscribe wants. */
function keyBytes(base64url: string) {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

/**
 * Ask permission (call straight from the click, browsers require a user gesture), register the service worker,
 * subscribe and hand the subscription to `save`. Reuses this browser's subscription unless the server key changed.
 */
export async function enablePush(publicKey: string, save: (sub: PushSubscriptionJSON) => Promise<unknown>) {
  const granted = await Notification.requestPermission();
  if (granted !== 'granted') return granted;
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const key = keyBytes(publicKey);
  const existing = await reg.pushManager.getSubscription();
  const reusable = existing && sameKey(existing.options.applicationServerKey, key) ? existing : null;
  if (existing && !reusable) await existing.unsubscribe(); // keys were rotated on the server
  const sub = reusable ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  await save(sub.toJSON());
  return granted;
}

/** This browser's current subscription endpoint, if any (to tell the server which one to forget). */
export async function currentEndpoint() {
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
}

/* ---------- which tokens this browser asked to be notified about (a convenience; the server is the truth) ---------- */

const followKey = (tokenId: string) => `promptly.push.${tokenId}`;
export const following = {
  get: (tokenId: string) => { try { return localStorage.getItem(followKey(tokenId)) === '1'; } catch { return false; } },
  set: (tokenId: string, on: boolean) => {
    try { on ? localStorage.setItem(followKey(tokenId), '1') : localStorage.removeItem(followKey(tokenId)); } catch { /* private mode */ }
  },
};
