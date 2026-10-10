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
  const pts = lane.points;
  const f = Math.min(Math.max(t, 0), 1) * (pts.length - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, pts.length - 1);
  return out.lerpVectors(pts[i], pts[j], f - i);
}
