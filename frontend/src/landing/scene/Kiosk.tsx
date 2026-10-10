import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, ExtrudeGeometry, Mesh, MeshBasicMaterial, Shape } from 'three';
import { LANDING } from '../config';
import { KIOSK_EXIT } from './paths';

const C = LANDING.colors;
const SCREEN = new Color(C.kiosk).multiplyScalar(2.2);

/** Rounded kiosk body: a rounded rectangle extruded with a soft bevel (centred on the origin). */
function bodyGeometry(w: number, h: number, d: number, r: number) {
  const s = new Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new ExtrudeGeometry(s, { depth: d - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -(d - 0.08) / 2);
  return g;
}

/** The token kiosk on the left: a dark body, a glowing screen and a pulsing ring where tokens leave. */
export function Kiosk() {
  const ring = useRef<Mesh>(null!);
  const body = useMemo(() => bodyGeometry(0.95, 1.7, 0.5, 0.12), []);
  useFrame(({ clock }) => {
    const k = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.4);
    ring.current.scale.setScalar(1 + 0.18 * k);
    (ring.current.material as MeshBasicMaterial).opacity = 0.35 + 0.4 * (1 - k);
  });
  return (
    <group position={LANDING.layout.kiosk}>
      <group rotation={[0, 0.35, 0]}>
        <mesh geometry={body}>
          <meshStandardMaterial color="#0d2754" metalness={0.35} roughness={0.45} emissive="#0a1f45" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[0, 0.32, 0.26]}>
          <planeGeometry args={[0.66, 0.42]} />
          <meshBasicMaterial color={SCREEN} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.28, 0.26]}>
          <planeGeometry args={[0.3, 0.05]} />
          <meshBasicMaterial color={C.ink} toneMapped={false} />
        </mesh>
      </group>
      {/* exit ring sits exactly where the lanes start (outside the rotated body) */}
      <mesh ref={ring} position={[KIOSK_EXIT.x - LANDING.layout.kiosk[0], 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.26, 0.025, 8, 40]} />
        <meshBasicMaterial color={SCREEN} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
