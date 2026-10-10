import { StaticQueueArt } from './StaticQueueArt';
import type { LiveQueue } from './useLiveQueue';

/** The hero's scene layer. Stage 1: the static Queue Flow art (live gates dim when real counters are closed). */
export function HeroStage({ q }: { q: LiveQueue }) {
  return <StaticQueueArt gates={q.live ? q.gates : undefined} />;
}
