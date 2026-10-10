/**
 * DEMO DATASET (labeled): a branch with 4 services, 5 counters with overlapping skills, and 3 staff accounts.
 * Idempotent: re-running updates the same rows. Staff PINs are only set for new accounts (or with --reset-pins):
 *  - SEED_STAFF_PINS='{"Asha":"…","Ravi":"…","Meera":"…"}' sets them explicitly (required in production);
 *  - otherwise, outside production, each gets a random 6-digit PIN that is printed once, here.
 * Production means NODE_ENV=production or the --production flag (npm run db:setup passes it, so a laptop shell
 * pointed at the production database can never generate PINs). It reports which accounts changed, never a PIN.
 */
import { randomInt } from 'node:crypto';
import { PrismaClient, type StaffRole } from '@prisma/client';
import { z } from 'zod';
import { AUTH } from '../src/config.js';
import { hashPin } from '../src/lib/secret.js';

const prisma = new PrismaClient();

const SERVICES = [
  { prefix: 'D', name: 'Deposits', icon: 'wallet', targetWaitS: 15 * 60, minutes: 4, sigma: 0.5 },
  { prefix: 'L', name: 'Loans', icon: 'landmark', targetWaitS: 30 * 60, minutes: 12, sigma: 0.45 },
  { prefix: 'E', name: 'Enquiry', icon: 'help', targetWaitS: 10 * 60, minutes: 3, sigma: 0.6 },
  { prefix: 'C', name: 'Cards', icon: 'card', targetWaitS: 20 * 60, minutes: 6, sigma: 0.5 },
];

const COUNTERS = [
  { name: 'Counter 1', skills: ['D', 'E'] },
  { name: 'Counter 2', skills: ['D', 'E', 'C'] },
  { name: 'Counter 3', skills: ['L', 'D'] },
  { name: 'Counter 4', skills: ['L'] },
  { name: 'Counter 5', skills: ['E', 'C'] },
];

const STAFF: { name: string; role: StaffRole }[] = [
  { name: 'Asha', role: 'SUPERVISOR' },
  { name: 'Ravi', role: 'STAFF' },
  { name: 'Meera', role: 'STAFF' },
];

const PinInput = z.record(z.string(), z.string().min(AUTH.minPinLength, `PINs must be at least ${AUTH.minPinLength} characters`));
const randomPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** PINs given explicitly via SEED_STAFF_PINS (JSON: name → PIN). */
function givenPins() {
  const raw = process.env.SEED_STAFF_PINS;
  if (!raw) return {};
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new Error('SEED_STAFF_PINS is not valid JSON'); } // V8's own message quotes the input, PINs included
  return PinInput.parse(json);
}

const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production');

/** The PIN to set for one account: given, or generated outside production. Production never generates or prints one. */
function newPin(name: string, given: Record<string, string>) {
  if (given[name]) return { pin: given[name], generated: false };
  if (production) throw new Error(`SEED_STAFF_PINS has no PIN for ${name} (required in production)`);
  return { pin: randomPin(), generated: true };
}

async function seedStaff() {
  const resetPins = process.argv.includes('--reset-pins');
  const given = givenPins();
  const unknown = Object.keys(given).filter((n) => !STAFF.some((s) => s.name === n));
  if (unknown.length) throw new Error(`SEED_STAFF_PINS names unknown staff: ${unknown.join(', ')} (expected ${STAFF.map((s) => s.name).join(', ')})`);
  if (production) { // check every PIN up front, so a missing one changes no account
    const existing = new Set((await prisma.staff.findMany({ select: { name: true } })).map((s) => s.name));
    const missing = STAFF.filter((s) => !given[s.name] && (resetPins || !existing.has(s.name))).map((s) => s.name);
    if (missing.length) throw new Error(`SEED_STAFF_PINS has no PIN for ${missing.join(', ')} (required in production)`);
  }
  const printed: string[] = [];
  const report = { created: [] as string[], 'PIN set': [] as string[], 'PIN kept': [] as string[] };
  for (const s of STAFF) {
    const existing = await prisma.staff.findUnique({ where: { name: s.name } });
    const next = !existing || resetPins || given[s.name] ? newPin(s.name, given) : null;
    const pinHash = next ? await hashPin(next.pin) : undefined;
    // not upsert: Prisma validates its create branch even when the row exists, and a kept PIN has no hash to give it
    await (existing
      ? prisma.staff.update({ where: { id: existing.id }, data: { role: s.role, active: true, ...(pinHash && { pinHash, failedLogins: 0, lockedUntil: null }) } })
      : prisma.staff.create({ data: { ...s, pinHash: pinHash! } }));
    report[!existing ? 'created' : next ? 'PIN set' : 'PIN kept'].push(`${s.name} (${s.role})`);
    next?.generated && printed.push(`  ${s.name.padEnd(6)} ${s.role.padEnd(10)}  PIN ${next.pin}`);
  }
  for (const [what, names] of Object.entries(report)) names.length && console.log(`Staff ${what}: ${names.join(', ')}`);
  printed.length && console.log(`Demo staff PINs (dev only, shown once; save them now):\n${printed.join('\n')}`);
}

async function main() {
  await seedStaff(); // first: in production it checks every PIN before writing anything
  const services = await Promise.all(SERVICES.map(({ minutes, sigma, ...s }) => prisma.service.upsert({
    where: { prefix: s.prefix },
    update: { ...s, priorMu: Math.log(minutes), priorSigma: sigma },
    create: { ...s, priorMu: Math.log(minutes), priorSigma: sigma },
  })));
  const byPrefix = Object.fromEntries(services.map((s) => [s.prefix, s.id]));

  for (const c of COUNTERS) {
    const counter = (await prisma.counter.findFirst({ where: { name: c.name } }))
      ?? (await prisma.counter.create({ data: { name: c.name } }));
    await prisma.counterSkill.deleteMany({ where: { counterId: counter.id } });
    await prisma.counterSkill.createMany({ data: c.skills.map((p) => ({ counterId: counter.id, serviceId: byPrefix[p] })) });
  }
  console.log(`Seeded ${services.length} services and ${COUNTERS.length} counters (demo data).`);
}

main().finally(() => prisma.$disconnect());
