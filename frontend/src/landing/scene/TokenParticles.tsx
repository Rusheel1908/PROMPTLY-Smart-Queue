import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { LANDING } from '../config';
import { sampleLane, type Lane } from './paths';
import { GateField, Phase, QueueSim } from './simulation';

const T = LANDING.timing;
const NORMAL = [new Color(LANDING.colors.ink), new Color(LANDING.colors.teal)];

/** All tokens as one InstancedMesh (one draw call). Free slots are scaled to zero. */
export function TokenParticles({ lanes, gates, cap, target, tint }: {
  lanes: Lane[]; gates: GateField; cap: number;
  /** particles wanted on screen right now (demo density, or scaled from the real waiting count) */
  target: MutableRefObject<number>;
  /** colour for a newly spawned normal token (live mode tints by real service) */
  tint?: MutableRefObject<(() => Color) | null>;
}) {
  const mesh = useRef<InstancedMesh>(null!);
  const sim = useMemo(() => new QueueSim(cap, lanes.length), [cap, lanes.length]);
  const tmp = useMemo(() => ({ m: new Matrix4(), p: new Vector3(), q: new Quaternion(), s: new Vector3(), c: new Color() }), []);
  const pickNormal = useMemo(() => () => NORMAL[Math.random() < 0.7 ? 0 : 1], []);

  useLayoutEffect(() => {
    const m = mesh.current;
    tmp.m.makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) { m.setMatrixAt(i, tmp.m); m.setColorAt(i, tmp.c.set(0, 0, 0)); }
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor!.needsUpdate = true;
  }, [cap, tmp]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20); // after a stall, catch up gently instead of teleporting
    sim.update(dt, gates, target.current, tint?.current ?? pickNormal);
    const m = mesh.current;
    let colors = false;
    for (let i = 0; i < cap; i++) {
      const phase = sim.phase[i];
      let scale = 0;
      if (phase !== Phase.Free) {
        sampleLane(lanes[sim.gate[i]], sim.t[i], tmp.p);
        const fadeIn = Math.min(1, sim.t[i] * 12); // grow out of the kiosk
        const settle = 1 - sim.t[i]; // the stream tightens as it reaches the gate
        tmp.p.y += sim.jitter[i * 2] * settle;
        tmp.p.z += sim.jitter[i * 2 + 1] * settle;
        if (phase === Phase.Travel) scale = fadeIn;
        else if (phase === Phase.Serve) scale = 1 + 0.35 * Math.sin((sim.timer[i] / T.serveSec) * Math.PI);
        else scale = 1 - sim.timer[i] / T.dissolveSec; // dissolve: "served"
        if (sim.colorDirty[i]) {
          m.setColorAt(i, tmp.c.fromArray(sim.color, i * 3));
          sim.colorDirty[i] = 0;
          colors = true;
        }
      }
      tmp.s.setScalar(Math.max(scale, 0));
      m.setMatrixAt(i, tmp.m.compose(tmp.p, tmp.q, tmp.s));
    }
    m.instanceMatrix.needsUpdate = true;
    if (colors) m.instanceColor!.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cap]} frustumCulled={false}>
      <icosahedronGeometry args={[0.085, 1]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
