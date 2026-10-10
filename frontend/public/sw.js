/**
 * Promptly service worker: shows Web Push notifications about a customer's token (sent by backend/src/services/notifier.ts)
 * and opens that token's status page when one is tapped. It caches nothing; the app itself always loads from the network.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** Vibration per urgency, as on the status page. */
const VIBRATE = { high: [300, 120, 300, 120, 300], normal: [200] };

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* not JSON: show the generic text below */ }
  const urgency = data.urgency === 'high' ? 'high' : 'normal';
  event.waitUntil(self.registration.showNotification(data.title || 'Promptly', {
    body: data.body || 'There is an update about your token.',
    tag: data.tag, // one notification per token: a newer one replaces the last…
    renotify: Boolean(data.tag), // …and still alerts
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: VIBRATE[urgency],
    requireInteraction: urgency === 'high', // "go to Counter 3" stays until seen
    data: { url: data.url || '/' },
  }));
});

/** Same-origin paths only, so a payload can never open another site. */
const safeUrl = (url) => {
  const u = new URL(url || '/', self.location.origin);
  return u.origin === self.location.origin ? u.href : self.location.origin + '/';
};

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url === url);
    return open ? open.focus() : self.clients.openWindow(url);
  })());
});
