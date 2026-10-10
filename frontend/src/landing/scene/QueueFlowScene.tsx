import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { MathUtils, PerspectiveCamera } from 'three';
import { LANDING } from '../config';
import { Gates } from './Gates';
import { Kiosk } from './Kiosk';
import { buildLanes, buildMissLoops } from './paths';
import { GateCycle, GateField } from './simulation';
import { TokenParticles } from './TokenParticles';

const CAM = LANDING.camera;
/** World-space box the camera keeps in frame, whatever the container's shape. */
const FRAME = { width: 15.8, height: 10, centerX: -0.5, centerY: -0.2 };

/** Pulls the camera back far enough that the whole scene fits the container (wide desktop band or narrow phone strip). */
function CameraRig() {
  const { camera, size } = useThree();
  useFrame(() => {
    const cam = camera as PerspectiveCamera;
    const tanHalf = Math.tan(MathUtils.degToRad(cam.fov / 2));
    const aspect = size.width / Math.max(size.height, 1);
    const dist = Math.max(FRAME.height / (2 * tanHalf), FRAME.width / (2 * tanHalf * aspect));
    cam.position.set(FRAME.centerX, FRAME.centerY + CAM.position[1], dist);
    cam.lookAt(FRAME.centerX, FRAME.centerY, 0);
  });
  return null;
}

function Flow({ mobile }: { mobile: boolean }) {
  const lanes = useMemo(buildLanes, []);
  const loops = useMemo(() => buildMissLoops(lanes), [lanes]);
  const gates = useMemo(() => new GateField(LANDING.gates.length), []);
  const cycle = useMemo(() => new GateCycle(), []);
  const cap = mobile ? LANDING.particles.mobile : LANDING.particles.desktop;
  const target = useRef(cap * 0.85);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    cycle.update(dt, gates); // demo: one gate closes every ~10 s, then reopens
    gates.update(dt);
  });
  return (
    <>
      <Kiosk />
      <Gates gates={gates} lanes={lanes} />
      <TokenParticles lanes={lanes} loops={loops} gates={gates} cap={cap} target={target} />
    </>
  );
}

/** "Queue Flow": tokens travel from the kiosk to five counter gates. Transparent canvas over the hero's CSS gradient. */
export default function QueueFlowScene() {
  const mobile = typeof window !== 'undefined' && window.innerWidth < LANDING.mobileBreakpoint;
  return (
    <Canvas
      dpr={[1, LANDING.render.maxDpr]}
      camera={{ fov: CAM.fov, position: CAM.position, near: 0.1, far: 60 }}
      gl={{ antialias: !mobile, alpha: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[-5, 2, 4]} intensity={30} color={LANDING.colors.kiosk} />
      <CameraRig />
      <Flow mobile={mobile} />
    </Canvas>
  );
}
