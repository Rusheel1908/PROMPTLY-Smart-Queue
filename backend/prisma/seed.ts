/**
 * DEMO DATASET (labeled): a branch with 4 services and 5 counters with overlapping skills.
 * Idempotent: re-running updates the same rows.
 */
import { PrismaClient } from '@prisma/client';

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

async function main() {
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
