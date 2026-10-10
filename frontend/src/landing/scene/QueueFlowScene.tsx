import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CanvasTexture, Color, Fog, MathUtils, PerspectiveCamera, SRGBColorSpace } from 'three';
import { LANDING } from '../config';
import type { LiveQueue } from '../useLiveQueue';
import { Effects } from './Effects';
import { Gates } from './Gates';
import { Kiosk } from './Kiosk';
import { buildLanes, buildMissLoops } from './paths';
import { GateCycle, GateField, type SpawnMix } from './simulation';
import { TokenParticles } from './TokenParticles';

const C = LANDING.colors;
const CAM = LANDING.camera;
const P = LANDING.particles;
/** World-space box the camera keeps in frame, whatever the container's shape. */
const FRAME = { width: 15.8, height: 10, centerX: -0.5, centerY: -0.2 };
const NORMAL = [new Color(C.ink), new Color(C.teal)];

/** Opaque backdrop matching the hero's CSS gradient, so bloom has real pixels to glow over. */
function Backdrop() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, C.spaceTop); g.addColorStop(1, C.spaceBottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 256);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    scene.background = tex;
    scene.fog = new Fog(C.spaceBottom, 10, 30);
    return () => { tex.dispose(); scene.background = null; scene.fog = null; };
  }, [scene]);
  return null;
}

/** Fits the scene to the container, then adds a slow drift and a gentle parallax toward the cursor. */
function CameraRig() {
  const { camera, size, scene } = useThree();
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);
  useFrame(({ clock }, delta) => {
    const cam = camera as PerspectiveCamera;
    const tanHalf = Math.tan(MathUtils.degToRad(cam.fov / 2));
    const aspect = size.width / Math.max(size.height, 1);
    const dist = Math.max(FRAME.height / (2 * tanHalf), FRAME.width / (2 * tanHalf * aspect));
    const p = pointer.current;
    p.sx = MathUtils.damp(p.sx, p.x, 2.5, delta); // eased, so the camera never snaps
    p.sy = MathUtils.damp(p.sy, p.y, 2.5, delta);
    const w = (clock.elapsedTime / CAM.driftSec) * Math.PI * 2;
    cam.position.set(
      FRAME.centerX + Math.sin(w) * CAM.driftAmp + p.sx * CAM.parallax,
      FRAME.centerY + CAM.position[1] + Math.cos(w * 0.7) * CAM.driftAmp * 0.6 - p.sy * CAM.parallax * 0.6,
      dist,
    );
    cam.lookAt(FRAME.centerX, FRAME.centerY, 0);
    if (scene.fog instanceof Fog) { scene.fog.near = dist - 2; scene.fog.far = dist + 14; } // depth haze on the far gates
  });
  return null;
}

/**
 * False while the tab is hidden or the hero is scrolled out of view. It drives <Canvas frameloop> directly:
 * calling setFrameloop() inside the canvas would be undone whenever the Canvas re-renders (live data, quality drop).
 */
function useOnScreen(ref: RefObject<HTMLElement>) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let visible = !document.hidden;
    let inView = true;
    const apply = () => setOn(visible && inView);
    const onVisibility = () => { visible = !document.hidden; apply(); };
    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; apply(); });
    io.observe(el);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [ref]);
  return on;
}

/** Low-FPS mode: pixel ratio 1 (bloom and particle halving are handled by the parent). Tagged on the canvas for debugging. */
function Quality({ low }: { low: boolean }) {
  const { gl, setDpr } = useThree();
  useEffect(() => {
    gl.domElement.dataset.quality = low ? 'low' : 'high';
    if (low) setDpr(1);
  }, [gl, low, setDpr]);
  return null;
}

function Flow({ q, mobile, low }: { q: LiveQueue; mobile: boolean; low: boolean }) {
  const lanes = useMemo(buildLanes, []);
  const loops = useMemo(() => buildMissLoops(lanes), [lanes]);
  const gates = useMemo(() => new GateField(LANDING.gates.length), []);
  const cycle = useMemo(() => new GateCycle(), []);
  const cap = mobile ? P.mobile : P.desktop; // buffer size never changes, so dropping quality doesn't reset the flow
  const limit = low ? Math.min(cap, P.lowFps) : cap;
  const target = useRef(limit * 0.85);
  const mix = useRef<SpawnMix>({ ...LANDING.mix });
  const tint = useRef<(() => Color) | null>(null);
  const live = useRef(false);

  // Live mode: real counters open/close the gates, the real waiting count sets the density,
  // real missed turns set the missed share, and normal tokens take their real service's colour.
  // Priority stays at the demo share: the public snapshot doesn't say which customers are priority.
  useEffect(() => {
    live.current = q.live && q.gates.length > 0;
    if (!live.current) {
      target.current = limit * 0.85;
      mix.current = { ...LANDING.mix };
      tint.current = null;
      gates.target.fill(true);
      return;
    }
    LANDING.gates.forEach((_, i) => { gates.target[i] = q.gates[i]?.open ?? false; });
    target.current = MathUtils.clamp(P.liveMin + q.waiting * P.perWaiting, Math.min(P.liveMin, limit), limit);
    mix.current = { priority: LANDING.mix.priority, missed: q.missed ? MathUtils.clamp(q.missed / Math.max(q.waiting, 1), 0.04, 0.25) : 0 };
    const colors = q.waitingServices.map((s) => new Color(q.serviceColors[s] ?? C.ink));
    tint.current = colors.length ? () => colors[Math.floor(Math.random() * colors.length)] : () => NORMAL[Math.random() < 0.7 ? 0 : 1];
  }, [q, limit, gates]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    if (!live.current) cycle.update(dt, gates); // demo: one gate closes every ~10 s, then reopens
    gates.update(dt);
  });

  return (
    <>
      <Kiosk />
      <Gates gates={gates} lanes={lanes} />
      <TokenParticles lanes={lanes} loops={loops} gates={gates} cap={cap} target={target} tint={tint} mix={mix} />
    </>
  );
}

/** "Queue Flow": tokens travel from the kiosk to five counter gates, driven by the live queue when it is reachable. */
export default function QueueFlowScene({ q }: { q: LiveQueue }) {
  const mobile = typeof window !== 'undefined' && window.innerWidth < LANDING.mobileBreakpoint;
  // once the frame rate drops, stay in low mode (halved particles, no bloom, dpr 1) rather than flip-flopping
  const [low, setLow] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(wrap);
  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        frameloop={onScreen ? 'always' : 'never'}
        dpr={[1, LANDING.render.maxDpr]}
        camera={{ fov: CAM.fov, position: CAM.position, near: 0.1, far: 60 }}
        gl={{ antialias: mobile, powerPreference: 'high-performance' }} // desktop: the bloom composer does MSAA instead
        style={{ position: 'absolute', inset: 0 }}
      >
        <PerformanceMonitor onDecline={() => setLow(true)} onFallback={() => setLow(true)} flipflops={3} />
        <Quality low={low} />
        <Backdrop />
        <ambientLight intensity={0.5} />
        <pointLight position={[-5, 2, 4]} intensity={30} color={C.kiosk} />
        <CameraRig />
        <Flow q={q} mobile={mobile} low={low} />
        {!mobile && !low && <Effects />}
      </Canvas>
    </div>
  );
}
