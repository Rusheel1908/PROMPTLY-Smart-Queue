import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/** Per-token access key carried in the customer's QR link: 24 random bytes, base64url (32 chars). */
export const newTokenSecret = () => randomBytes(24).toString('base64url');

/** Booking code typed at the kiosk: "BK-" + 6 characters without look-alikes (no 0/O, 1/I). 32^6 ≈ 1 billion. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newBookingCode = () => `BK-${[...randomBytes(6)].map((b) => CODE_ALPHABET[b % 32]).join('')}`;

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time string comparison. Hashing first gives equal-length buffers, so length is not leaked either. */
export const safeEqual = (a: string | undefined, b: string | undefined) =>
  a != null && b != null && timingSafeEqual(digest(a), digest(b));

/* ---------- staff PINs: scrypt with a per-user salt ---------- */

const scryptAsync = promisify(scrypt) as (pin: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LEN = 64;

/** "scrypt$<saltHex>$<hashHex>". The PIN itself is never stored. */
export async function hashPin(pin: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scryptAsync(pin, salt, KEY_LEN)).toString('hex')}`;
}

export async function verifyPin(pin: string, stored: string) {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scryptAsync(pin, Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Verified against when the staff id is unknown, so that answer takes as long as a wrong PIN. */
export const DUMMY_PIN_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(KEY_LEN)}`;

/* ---------- staff sessions: random bearer token, only its hash is stored ---------- */

export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => digest(token).toString('hex');
