import { CatmullRomCurve3, Vector3 } from 'three';
import { gatePosition, LANDING } from '../config';

const K = LANDING.layout.kiosk;
export const KIOSK_EXIT = new Vector3(K[0] + 0.85, K[1], K[2]);

/** Kiosk → gate i: leaves the kiosk heading right, fans out, and arrives square-on to the gate. */
export function gateCurve(i: number): CatmullRomCurve3 {
  const g = new Vector3(...gatePosition(i));
  const e = KIOSK_EXIT;
  const mid = new Vector3().lerpVectors(e, g, 0.5);
  mid.y = e.y + (g.y - e.y) * 0.55;
  mid.z += 0.9; // bow toward the camera so lanes read in depth
  return new CatmullRomCurve3([
    e.clone(),
    new Vector3(e.x + 1.4, e.y, e.z + 0.3),
    mid,
    new Vector3(g.x - 1.3, g.y, g.z + 0.2),
    g.clone(),
  ], false, 'centripetal');
}

/** Precomputed lanes (one per gate) plus a lookup table of points, so per-frame sampling doesn't allocate. */
export function buildLanes() {
  return LANDING.gates.map((_, i) => {
    const curve = gateCurve(i);
    return { curve, points: curve.getSpacedPoints(160) };
  });
}

export type Lane = ReturnType<typeof buildLanes>[number];

/** Position at progress t (0–1) on a lane, linearly interpolated from the spaced point table. */
export function sampleLane(lane: Lane, t: number, out: Vector3): Vector3 {
  return samplePoints(lane.points, t, out);
}

/** Where a missed token rejoins its lane: near the front of the queue, not the back. */
export const REENTRY_T = 0.74;

/**
 * Missed turn: from the gate, a wide arc outward (above the lane for upper gates, below for lower ones)
 * that swings back to a grace spot beside the front of the queue.
 */
export function buildMissLoops(lanes: Lane[]) {
  return lanes.map((lane) => {
    const g = lane.points[lane.points.length - 1];
    const side = g.y > 0.3 ? 1 : -1;
    const grace = sampleLane(lane, 0.56, new Vector3()).add(new Vector3(0, side * 1.25, 0.5));
    const curve = new CatmullRomCurve3([
      g.clone(),
      new Vector3(g.x + 1.1, g.y + side * 0.8, g.z + 0.4),
      new Vector3(g.x - 0.4, g.y + side * 2.1, g.z + 1.0),
      new Vector3((g.x + grace.x) / 2, grace.y + side * 0.75, grace.z + 0.4),
      grace.clone(),
    ], false, 'centripetal');
    return { points: curve.getSpacedPoints(120), grace, rejoin: sampleLane(lane, REENTRY_T, new Vector3()) };
  });
}

export type MissLoop = ReturnType<typeof buildMissLoops>[number];

/** Same lookup-table sampling as sampleLane, for any point list. */
export function samplePoints(pts: Vector3[], t: number, out: Vector3): Vector3 {
  const f = Math.min(Math.max(t, 0), 1) * (pts.length - 1);
  const i = Math.floor(f);
  return out.lerpVectors(pts[i], pts[Math.min(i + 1, pts.length - 1)], f - i);
}
