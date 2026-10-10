import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { StaticQueueArt } from './StaticQueueArt';
import type { LiveQueue } from './useLiveQueue';

/** three.js and the scene are their own chunk: requested only from here, so no other page ever loads them. */
const QueueFlowScene = lazy(() => import('./scene/QueueFlowScene'));

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Probe for WebGL with a throwaway context (released straight away), before downloading any 3D code. */
function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** 3D only with WebGL and without prefers-reduced-motion; follows the motion setting if it changes while the page is open. */
export function useCanAnimate() {
  const [query] = useState(() => (typeof window !== 'undefined' ? window.matchMedia?.(REDUCED_MOTION) : undefined));
  const [webgl] = useState(hasWebGL);
  const [reduced, setReduced] = useState(() => !!query?.matches);
  useEffect(() => {
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [query]);
  return webgl && !reduced;
}

/** Any failure in the 3D layer (chunk didn't load, WebGL context lost or refused) falls back to the still art; the page stays up. */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/**
 * The hero's scene layer. Reduced motion or no WebGL: the static Queue Flow art, and three.js is never downloaded.
 * Otherwise the static art shows while the 3D chunk loads, then the live canvas replaces it.
 */
export function HeroStage({ q, animate }: { q: LiveQueue; animate: boolean }) {
  const still = <StaticQueueArt gates={q.live ? q.gates : undefined} />;
  if (!animate) return still;
  return (
    <SceneBoundary fallback={still}>
      <Suspense fallback={still}>
        <QueueFlowScene q={q} />
      </Suspense>
    </SceneBoundary>
  );
}
