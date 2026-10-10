import { Component, lazy, Suspense, type ReactNode } from 'react';
import { StaticQueueArt } from './StaticQueueArt';
import type { LiveQueue } from './useLiveQueue';

/** three.js and the scene are their own chunk: requested only from here, so no other page ever loads them. */
const QueueFlowScene = lazy(() => import('./scene/QueueFlowScene'));

/** Any failure in the 3D layer (chunk didn't load, WebGL context lost or refused) falls back to the still art; the page stays up. */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** The hero's scene layer: the static Queue Flow art shows while the 3D chunk downloads, then the live canvas replaces it. */
export function HeroStage({ q }: { q: LiveQueue }) {
  const still = <StaticQueueArt gates={q.live ? q.gates : undefined} />;
  return (
    <SceneBoundary fallback={still}>
      <Suspense fallback={still}>
        <QueueFlowScene />
      </Suspense>
    </SceneBoundary>
  );
}
