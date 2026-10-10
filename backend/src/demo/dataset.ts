import type { Prisma } from '@prisma/client';

/**
 * DEMO DATASET (labeled): the branch layout the seed creates and "Reset demo" restores.
 * One definition, so a demo always starts from the same services, counters and skills.
 */
export const DEMO_SERVICES = [
  { prefix: 'D', name: 'Deposits', icon: 'wallet', targetWaitS: 15 * 60, minutes: 4, sigma: 0.5 },
  { prefix: 'L', name: 'Loans', icon: 'landmark', targetWaitS: 30 * 60, minutes: 12, sigma: 0.45 },
  { prefix: 'E', name: 'Enquiry', icon: 'help', targetWaitS: 10 * 60, minutes: 3, sigma: 0.6 },
  { prefix: 'C', name: 'Cards', icon: 'card', targetWaitS: 20 * 60, minutes: 6, sigma: 0.5 },
];

export const DEMO_COUNTERS = [
  { name: 'Counter 1', skills: ['D', 'E'] },
  { name: 'Counter 2', skills: ['D', 'E', 'C'] },
  { name: 'Counter 3', skills: ['L', 'D'] },
  { name: 'Counter 4', skills: ['L'] },
  { name: 'Counter 5', skills: ['E', 'C'] },
];

/**
 * Create or update the demo services and counters, and set each demo counter's skills exactly.
 * Matches services by prefix and counters by name; other rows are left alone. Statuses are not touched.
 */
export async function restoreDemoDataset(db: Prisma.TransactionClient) {
  const services = await Promise.all(DEMO_SERVICES.map(({ minutes, sigma, ...s }) => {
    const data = { ...s, priorMu: Math.log(minutes), priorSigma: sigma };
    return db.service.upsert({ where: { prefix: s.prefix }, update: data, create: data });
  }));
  const byPrefix = Object.fromEntries(services.map((s) => [s.prefix, s.id]));

  for (const c of DEMO_COUNTERS) {
    const counter = (await db.counter.findFirst({ where: { name: c.name } })) ?? (await db.counter.create({ data: { name: c.name } }));
    await db.counterSkill.deleteMany({ where: { counterId: counter.id } });
    await db.counterSkill.createMany({ data: c.skills.map((p) => ({ counterId: counter.id, serviceId: byPrefix[p] })) });
  }
  return { services: services.length, counters: DEMO_COUNTERS.length };
}
