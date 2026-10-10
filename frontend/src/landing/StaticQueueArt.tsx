import { gatePosition, LANDING, type GateState } from './config';

const C = LANDING.colors;
const K = LANDING.layout.kiosk;

/** World (x, y) → SVG (x, -y), so the static art lines up with the 3D scene's layout. */
const pt = (x: number, y: number) => [x, -y] as const;

/** Quadratic curve kiosk → gate; the control point pulls the path into a soft S like the 3D splines. */
function curve(i: number) {
  const [gx, gy] = gatePosition(i);
  const [kx, ky] = [K[0] + 0.9, K[1]];
  const cx = (kx + gx) / 2 - 0.6;
  const cy = gy * 0.35;
  const point = (t: number) => {
    const u = 1 - t;
    return pt(u * u * kx + 2 * u * t * cx + t * t * gx, u * u * ky + 2 * u * t * cy + t * t * gy);
  };
  const [sx, sy] = pt(kx, ky); const [qx, qy] = pt(cx, cy); const [ex, ey] = pt(gx, gy);
  return { d: `M${sx} ${sy} Q${qx} ${qy} ${ex} ${ey}`, point };
}

/** Token dots along each path: [gate, position 0–1, colour]. Purely illustrative, never a count. */
const DOTS: [number, number, string][] = [
  [0, 0.25, C.ink], [0, 0.62, C.teal], [1, 0.4, C.ink], [1, 0.78, C.priority], [1, 0.15, C.ink],
  [2, 0.55, C.ink], [2, 0.3, C.teal], [2, 0.86, C.ink], [4, 0.35, C.ink], [4, 0.7, C.teal], [3, 0.2, C.priority],
];

/**
 * The Queue Flow scene as a still SVG: shown for prefers-reduced-motion, without WebGL, and while the 3D bundle loads.
 * `gates` (live counters) dims closed gates; without it C4 is drawn closed to illustrate rerouting.
 */
export function StaticQueueArt({ gates }: { gates?: GateState[] }) {
  const open = (i: number) => (gates?.length ? gates[i]?.open ?? true : i !== 3);
  const [kx, ky] = pt(K[0], K[1]);
  return (
    <svg viewBox="-9.6 -5.2 18.1 10.4" preserveAspectRatio="xMidYMid meet" className="h-full w-full" aria-hidden="true" focusable="false">
      <defs>
        <filter id="lp-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.09" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="lp-kiosk" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={C.kiosk} stopOpacity="0.55" />
          <stop offset="100%" stopColor={C.kiosk} stopOpacity="0" />
        </radialGradient>
      </defs>

      {LANDING.gates.map((_, i) => (
        <path key={i} d={curve(i).d} fill="none" stroke={open(i) ? C.ink : C.gateClosed} strokeOpacity={open(i) ? 0.14 : 0.25}
          strokeWidth="0.035" strokeDasharray={open(i) ? undefined : '0.12 0.12'} />
      ))}

      {/* missed token: wide loop back toward the front of the queue */}
      <path d={`M${pt(3.6, -2.6).join(' ')} C${pt(2.5, -5.4).join(' ')} ${pt(-3.8, -5).join(' ')} ${pt(-4.2, -1.6).join(' ')}`}
        fill="none" stroke={C.missed} strokeOpacity="0.45" strokeWidth="0.035" strokeDasharray="0.08 0.14" />
      <circle cx={pt(-1.2, -4.5)[0]} cy={pt(-1.2, -4.5)[1]} r="0.11" fill={C.missed} filter="url(#lp-glow)" />

      <circle cx={kx} cy={ky} r="1.6" fill="url(#lp-kiosk)" />
      <rect x={kx - 0.42} y={ky - 0.75} width="0.84" height="1.5" rx="0.16" fill={C.spaceTop} stroke={C.kiosk} strokeWidth="0.06" filter="url(#lp-glow)" />
      <rect x={kx - 0.26} y={ky - 0.52} width="0.52" height="0.34" rx="0.05" fill={C.kiosk} opacity="0.85" />

      {DOTS.filter(([g]) => open(g)).map(([g, t, color], i) => {
        const [x, y] = curve(g).point(t);
        return <circle key={i} cx={x} cy={y} r={color === C.priority ? 0.12 : 0.085} fill={color} filter="url(#lp-glow)" />;
      })}

      {LANDING.gates.map((label, i) => {
        const [x, y] = pt(...(gatePosition(i).slice(0, 2) as [number, number]));
        const on = open(i);
        return (
          <g key={label} opacity={on ? 1 : 0.55}>
            <rect x={x - 0.16} y={y - 0.55} width="0.32" height="1.1" rx="0.16" fill="none" stroke={on ? C.gate : C.gateClosed} strokeWidth="0.07" filter={on ? 'url(#lp-glow)' : undefined} />
            <text x={x + 0.42} y={y + 0.12} fontSize="0.34" fill={on ? C.ink : '#8B97AD'} fontFamily="'JetBrains Mono', monospace">{label}</text>
          </g>
        );
      })}
    </svg>
  );
}
