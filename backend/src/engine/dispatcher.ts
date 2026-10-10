import { EngineState, EngineToken, HARD_CEILING_FACTOR } from './types.js';

/** Earliest-deadline-first with a hard wait ceiling. Pure function: same input, same output. */
export function pickNext(s: EngineState, counterId: string, now: number): EngineToken | null {
  const c = s.counters[counterId];
  if (!c || !c.open) return null;
  let best: EngineToken | null = null;
  let bestKey: number[] | null = null;
  for (const t of s.waiting) {
    if (!c.skills.has(t.serviceId) || t.notBefore > now) continue;
    const target = s.services[t.serviceId].targetWaitMs;
    const breached = now - t.creditedArrival > HARD_CEILING_FACTOR * target ? 0 : 1;
    const key = [breached, t.deadline, t.seq];
    if (!bestKey || lexLess(key, bestKey)) { best = t; bestKey = key; }
  }
  return best;
}

function lexLess(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
