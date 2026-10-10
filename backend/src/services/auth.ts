import type { Staff, StaffRole } from '@prisma/client';
import { AUTH } from '../config.js';
import * as clock from '../lib/clock.js';
import { prisma } from '../lib/db.js';
import { fail } from '../lib/http.js';
import { allowedActions } from '../lib/permissions.js';
import { DUMMY_PIN_HASH, hashToken, newSessionToken, verifyPin } from '../lib/secret.js';

export interface StaffUser { id: string; name: string; role: StaffRole }

/** One answer for "no such staff" and "wrong PIN", so the login form does not confirm who exists. */
export const BAD_LOGIN = 'Invalid name or PIN';

const toUser = (s: Pick<Staff, 'id' | 'name' | 'role'>): StaffUser => ({ id: s.id, name: s.name, role: s.role });

/** Public: names for the login picker. Nothing else about an account leaves the server. */
export const listActiveStaff = () =>
  prisma.staff.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });

export async function createSession(staffId: string) {
  const token = newSessionToken();
  const expiresAt = new Date(clock.now() + AUTH.sessionTtlMs);
  await prisma.session.create({ data: { tokenHash: hashToken(token), staffId, expiresAt } });
  return { token, expiresAt };
}

const minutesLeft = (until: Date, now: number) => Math.max(1, Math.ceil((until.getTime() - now) / 60_000));

/** Wrong PIN: count it, and lock the account once it reaches the limit (the count starts over after a lockout). */
async function recordFailure(s: Staff, now: number) {
  const failed = s.failedLogins + 1;
  const locks = failed >= AUTH.maxFailedLogins;
  await prisma.staff.update({
    where: { id: s.id },
    data: locks ? { failedLogins: 0, lockedUntil: new Date(now + AUTH.lockoutMs) } : { failedLogins: failed },
  });
}

/** Rejects with 401 (unknown, inactive or wrong PIN) or 429 (locked). Resolves to a new session. */
export async function login(staffId: string, pin: string) {
  const now = clock.now();
  const s = await prisma.staff.findUnique({ where: { id: staffId } });
  const known = s?.active ? s : null;
  const pinOk = await verifyPin(pin, known?.pinHash ?? DUMMY_PIN_HASH); // always hash, so timing does not tell
  if (!known) fail(401, BAD_LOGIN);
  if (known.lockedUntil && known.lockedUntil.getTime() > now) {
    fail(429, `Too many wrong PINs. Try again in ${minutesLeft(known.lockedUntil, now)} min`);
  }
  if (!pinOk) {
    await recordFailure(known, now);
    fail(401, BAD_LOGIN);
  }
  await prisma.staff.update({ where: { id: known.id }, data: { failedLogins: 0, lockedUntil: null } });
  return { ...(await createSession(known.id)), staff: toUser(known) };
}

/** The staff member behind a bearer token, or null when the token is unknown, expired or the account inactive. */
export async function sessionFor(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { staff: true } });
  if (!session) return null;
  const live = session.expiresAt.getTime() > clock.now() && session.staff.active;
  live || (await prisma.session.deleteMany({ where: { id: session.id } }));
  return live ? { staff: toUser(session.staff), expiresAt: session.expiresAt } : null;
}

export const logout = (token: string) => prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });

export const me = (s: { staff: StaffUser; expiresAt: Date }) => ({ ...s, permissions: allowedActions(s.staff.role) });
