/**
 * Generate a VAPID key pair for Web Push (npm run push:keys). Paste the output into backend/.env, or into
 * Render's environment. Keep the private key secret; changing the pair invalidates every existing subscription.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com`);
