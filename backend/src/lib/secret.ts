import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Per-token access key carried in the customer's QR link: 24 random bytes, base64url (32 chars). */
export const newTokenSecret = () => randomBytes(24).toString('base64url');

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time string comparison. Hashing first gives equal-length buffers, so length is not leaked either. */
export const safeEqual = (a: string | undefined, b: string | undefined) =>
  a != null && b != null && timingSafeEqual(digest(a), digest(b));
