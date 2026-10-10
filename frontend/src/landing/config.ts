/** Everything tunable about the landing page and the Queue Flow scene lives here: colours, counts, timings, layout. */
export const LANDING = {
  colors: {
    spaceTop: '#071A3D',
    spaceBottom: '#040F24',
    ink: '#EEF4FD', // body text and normal tokens
    teal: '#0E8F83',
    priority: '#FFC21A',
    missed: '#E8512F',
    gate: '#5B8DEF',
    gateClosed: '#2A3A5C',
    kiosk: '#1F6FEB',
  },

  /** The app's categorical chart palette (index.css s1–s4), used to tint tokens by service in live mode. */
  serviceColors: ['#2A78D6', '#1BAF7A', '#EDA100', '#EB6834'],

  gates: ['C1', 'C2', 'C3', 'C4', 'C5'],

  /** Scene layout in world units: kiosk on the left, gates on an arc bulging away from it. */
  layout: {
    kiosk: [-6.2, -0.2, 0] as [number, number, number],
    arc: { centerX: 0.6, radius: 5.4, spread: 0.95, ySquash: 0.78, depth: 2.2 },
  },

  /** Particles on screen at once, by device tier. Live mode scales between min and max by the real waiting count. */
  particles: {
    desktop: 140,
    mobile: 70,
    lowFps: 70, // PerformanceMonitor halves particles when the frame rate drops
    liveMin: 30,
    perWaiting: 9, // live mode: particles per waiting customer, clamped to the tier cap
  },

  /** Share of new tokens by type in the demo loop. */
  mix: { priority: 0.14, missed: 0.08 },

  timing: {
    spawnEverySec: 0.16, // demo spawn interval at full density
    travelSec: [3.6, 5.2] as [number, number], // kiosk → gate, randomised per token
    serveSec: 0.9, // pause at the gate
    dissolveSec: 0.7,
    missedLoopSec: 3.4, // the wide arc back
    graceSec: 1.6, // waiting in the grace area before re-entering near the front
    gateCycleSec: 10, // demo: one gate closes this often
    gateClosedSec: 4.5,
    gateFadeSec: 0.8,
  },

  camera: { position: [0, 0.6, 13.5] as [number, number, number], fov: 42, driftAmp: 0.35, driftSec: 18, parallax: 0.6 },

  render: { maxDpr: 1.5, fog: [11, 26] as [number, number], bloom: { intensity: 1.15, threshold: 0.18, smoothing: 0.4 } },

  /** Below this viewport width: mobile particle count, no bloom. */
  mobileBreakpoint: 768,
} as const;

export type GateState = { name: string; open: boolean };

/** World position of gate i (of n) on the arc. Shared by the 3D scene and the static fallback art. */
export function gatePosition(i: number, n: number = LANDING.gates.length): [number, number, number] {
  const { centerX, radius, spread, ySquash, depth } = LANDING.layout.arc;
  const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1 … 1, C1 at the top
  const theta = t * spread;
  return [centerX + radius * Math.cos(theta), -radius * Math.sin(theta) * ySquash, -depth * (1 - Math.cos(theta))];
}
