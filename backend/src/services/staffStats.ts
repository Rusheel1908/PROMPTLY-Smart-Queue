import { STAFF_AUDIT } from '../config.js';
import { prisma } from '../lib/db.js';
import { auditStaff } from '../lib/missAudit.js';
import { startOfDay } from './queue.js';

/** Event type → the count it adds to. Misses are the ones a staff member marked; sweeper misses are 'system'. */
const COUNTED = { CALLED: 'calls', COMPLETED: 'completes', MISSED: 'misses' } as const;

/** Today's calls, completes and misses per active staff member, with high miss rates flagged. */
export async function staffStats() {
  const [staff, grouped] = await Promise.all([
    prisma.staff.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.event.groupBy({
      by: ['actor', 'type'],
      where: { type: { in: Object.keys(COUNTED) }, ts: { gte: startOfDay() }, actor: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const count = (staffId: string, type: keyof typeof COUNTED) =>
    grouped.find((g) => g.actor === staffId && g.type === type)?._count._all ?? 0;
  return auditStaff(staff.map((s) => ({
    staffId: s.id, name: s.name,
    calls: count(s.id, 'CALLED'), completes: count(s.id, 'COMPLETED'), misses: count(s.id, 'MISSED'),
  })), STAFF_AUDIT);
}
