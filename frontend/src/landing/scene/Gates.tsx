import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, CanvasTexture, Color, Group, Line, LineBasicMaterial, MeshBasicMaterial, SpriteMaterial, SRGBColorSpace } from 'three';
import { gatePosition, LANDING } from '../config';
import type { Lane } from './paths';
import type { GateField } from './simulation';

const C = LANDING.colors;
const OPEN = new Color(C.gate).multiplyScalar(1.7); // HDR so the ring blooms
const CLOSED = new Color(C.gateClosed);
const LABEL_OPEN = new Color(C.ink);
const LABEL_CLOSED = new Color('#56627a');

/** "C1"… drawn once to a small canvas; no font files or text libraries needed in the 3D bundle. */
function labelTexture(text: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 40px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 34);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Five counter gates on the arc, plus the faint lane each one is fed by. Closed gates dim and shrink. */
export function Gates({ gates, lanes }: { gates: GateField; lanes: Lane[] }) {
  const groups = useRef<(Group | null)[]>([]);
  const parts = useMemo(() => LANDING.gates.map((name, i) => ({
    name,
    pos: gatePosition(i),
    ring: new MeshBasicMaterial({ color: OPEN.clone(), toneMapped: false, transparent: true }),
    halo: new MeshBasicMaterial({ color: new Color(C.gate), transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false }),
    label: new SpriteMaterial({ map: labelTexture(name), color: LABEL_OPEN.clone(), transparent: true, depthWrite: false }),
    lane: new Line(new BufferGeometry().setFromPoints(lanes[i].points), new LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0.1, depthWrite: false })),
  })), [lanes]);

  useEffect(() => () => parts.forEach((p) => {
    p.ring.dispose(); p.halo.dispose(); p.label.map?.dispose(); p.label.dispose();
    p.lane.geometry.dispose(); (p.lane.material as LineBasicMaterial).dispose();
  }), [parts]);

  useFrame(() => {
    parts.forEach((p, i) => {
      const o = gates.openness[i];
      p.ring.color.lerpColors(CLOSED, OPEN, o);
      p.ring.opacity = 0.55 + 0.45 * o;
      p.halo.opacity = 0.12 * o;
      p.label.color.lerpColors(LABEL_CLOSED, LABEL_OPEN, o);
      (p.lane.material as LineBasicMaterial).opacity = 0.03 + 0.08 * o;
      groups.current[i]?.scale.setScalar(0.86 + 0.14 * o);
    });
  });

  return (
    <>
      {parts.map((p, i) => (
        <group key={p.name}>
          <primitive object={p.lane} />
          <group ref={(g) => { groups.current[i] = g; }} position={p.pos} rotation={[0, -0.35, 0]}>
            {/* tall rounded ring: a torus squashed horizontally */}
            <mesh material={p.ring} scale={[0.42, 1, 1]}>
              <torusGeometry args={[0.62, 0.05, 12, 48]} />
            </mesh>
            <mesh material={p.halo} scale={[0.42, 1, 1]}>
              <circleGeometry args={[0.62, 32]} />
            </mesh>
            <sprite material={p.label} position={[0.72, 0, 0]} scale={[0.8, 0.4, 1]} />
          </group>
        </group>
      ))}
    </>
  );
}
