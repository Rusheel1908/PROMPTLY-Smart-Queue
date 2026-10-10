import webpush from 'web-push';
import { config, PUSH_HOSTS } from '../config.js';
import { NOTIFY_CONFIG, type Urgency } from '../notify/rules.js';

export interface PushKeys { publicKey: string; privateKey: string; subject: string }
export interface PushTarget { endpoint: string; p256dh: string; auth: string }
/** What the service worker receives (frontend/public/sw.js). Text is already rendered; never personal data. */
export interface PushPayload { title: string; body: string; tag: string; url: string; urgency: Urgency }

/** Sends one push. Rejects on failure; a rejection with `statusCode` 404/410 means the subscription is gone. */
export type PushSender = (target: PushTarget, payload: string, opts: { urgency: Urgency; TTL: number; keys: PushKeys }) => Promise<unknown>;

const webPushSender: PushSender = (t, payload, { urgency, TTL, keys }) => webpush.sendNotification(
  { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
  payload,
  { urgency, TTL, vapidDetails: keys },
);

const keysFrom = (c: typeof config): PushKeys | null => (c.VAPID_PUBLIC_KEY && c.VAPID_PRIVATE_KEY && c.VAPID_SUBJECT
  ? { publicKey: c.VAPID_PUBLIC_KEY, privateKey: c.VAPID_PRIVATE_KEY, subject: c.VAPID_SUBJECT }
  : null);

let keys = keysFrom(config);
let sender = webPushSender;

/** Null when the VAPID keys are not configured: push is off and customers get in-page alerts only. */
export const pushPublicKey = () => keys?.publicKey ?? null;
export const pushEnabled = () => keys != null;

/** Tests only: pretend keys are (or are not) configured, and replace the network sender. */
export const configurePush = (k: PushKeys | null) => { keys = k; };
export const setPushSender = (s: PushSender = webPushSender) => { sender = s; };

export function sendPush(target: PushTarget, payload: PushPayload) {
  if (!keys) return Promise.reject(new Error('Web Push is not configured'));
  return sender(target, JSON.stringify(payload), { urgency: payload.urgency, TTL: NOTIFY_CONFIG.pushTtlS[payload.urgency], keys });
}

/** The push service says the subscription no longer exists: delete it. */
export const isGone = (e: unknown) => [404, 410].includes((e as { statusCode?: number })?.statusCode ?? 0);

/** An https endpoint on a known push service (PUSH_HOSTS; a leading dot allows subdomains). */
export function isPushEndpoint(endpoint: string) {
  const url = URL.canParse(endpoint) ? new URL(endpoint) : null;
  return url?.protocol === 'https:'
    && PUSH_HOSTS.some((h) => (h.startsWith('.') ? url.hostname.endsWith(h) : url.hostname === h));
}
