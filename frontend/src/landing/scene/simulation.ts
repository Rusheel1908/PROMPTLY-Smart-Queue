import { Color } from 'three';
import { LANDING } from '../config';

const T = LANDING.timing;

/** Token lifecycle. Free slots are reused, so the particle buffers never grow. */
export const Phase = { Free: 0, Travel: 1, Serve: 2, Dissolve: 3 } as const;

/** Open/closed state per gate; `openness` eases toward the target so closing and reopening are smooth. */
export class GateField {
  readonly target: boolean[];
  readonly openness: Float32Array;
  constructor(n: number) {
    this.target = Array.from({ length: n }, () => true);
    this.openness = new Float32Array(n).fill(1);
  }
  update(dt: number) {
    const step = dt / T.gateFadeSec;
    this.target.forEach((open, i) => {
      const goal = open ? 1 : 0;
      const o = this.openness[i];
      this.openness[i] = o < goal ? Math.min(goal, o + step) : Math.max(goal, o - step);
    });
  }
  openGates() { return this.target.flatMap((open, i) => (open ? [i] : [])); }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** The queue as plain typed arrays, stepped once per frame; TokenParticles turns it into instance matrices and colours. */
export class QueueSim {
  readonly cap: number;
  readonly phase: Uint8Array;
  readonly gate: Uint8Array;
  readonly t: Float32Array; // progress along the lane, 0 (kiosk) → 1 (gate)
  readonly speed: Float32Array; // lane progress per second
  readonly timer: Float32Array; // seconds spent in the current phase
  readonly jitter: Float32Array; // per-token lateral offset (y, z), so a lane reads as a stream
  readonly color: Float32Array; // rgb per token
  readonly colorDirty: Uint8Array;
  /** Tokens heading to or at each gate, for least-loaded dispatch. */
  readonly load: Int16Array;
  private spawnAcc = 0;

  constructor(cap: number, gates: number) {
    this.cap = cap;
    this.phase = new Uint8Array(cap);
    this.gate = new Uint8Array(cap);
    this.t = new Float32Array(cap);
    this.speed = new Float32Array(cap);
    this.timer = new Float32Array(cap);
    this.jitter = new Float32Array(cap * 2);
    this.color = new Float32Array(cap * 3);
    this.colorDirty = new Uint8Array(cap);
    this.load = new Int16Array(gates);
  }

  /** Average seconds a token is on screen, used to turn a target particle count into a spawn rate. */
  static lifetime() { return (T.travelSec[0] + T.travelSec[1]) / 2 + T.serveSec + T.dissolveSec; }

  private pickGate(open: number[]) {
    let best = open[0];
    for (const g of open) if (this.load[g] < this.load[best] || (this.load[g] === this.load[best] && Math.random() < 0.5)) best = g;
    return best;
  }

  private setColor(i: number, c: Color) {
    const glow = 1.6; // >1 so bloom picks tokens up
    this.color.set([c.r * glow, c.g * glow, c.b * glow], i * 3);
    this.colorDirty[i] = 1;
  }

  private spawn(gates: GateField, tint: () => Color) {
    const open = gates.openGates();
    if (!open.length) return;
    const i = this.phase.indexOf(Phase.Free);
    if (i < 0) return;
    const g = this.pickGate(open);
    this.phase[i] = Phase.Travel;
    this.gate[i] = g;
    this.load[g]++;
    this.t[i] = 0;
    this.timer[i] = 0;
    this.speed[i] = 1 / rand(...T.travelSec);
    this.jitter[i * 2] = rand(-0.14, 0.14);
    this.jitter[i * 2 + 1] = rand(-0.18, 0.18);
    this.setColor(i, tint());
  }

  private free(i: number) {
    this.load[this.gate[i]]--;
    this.phase[i] = Phase.Free;
  }

  /** Advance everything by dt seconds, spawning toward `target` particles on screen. */
  update(dt: number, gates: GateField, target: number, tint: () => Color) {
    this.spawnAcc += dt * (Math.min(target, this.cap) / QueueSim.lifetime());
    while (this.spawnAcc >= 1) { this.spawnAcc--; this.spawn(gates, tint); }

    for (let i = 0; i < this.cap; i++) {
      const p = this.phase[i];
      if (p === Phase.Free) continue;
      this.timer[i] += dt;
      if (p === Phase.Travel) {
        this.t[i] = Math.min(1, this.t[i] + this.speed[i] * dt);
        if (this.t[i] >= 1) { this.phase[i] = Phase.Serve; this.timer[i] = 0; }
      } else if (p === Phase.Serve && this.timer[i] >= T.serveSec) {
        this.phase[i] = Phase.Dissolve; this.timer[i] = 0;
      } else if (p === Phase.Dissolve && this.timer[i] >= T.dissolveSec) {
        this.free(i);
      }
    }
  }
}
