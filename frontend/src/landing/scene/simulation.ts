import { Color, Vector3 } from 'three';
import { LANDING } from '../config';
import { REENTRY_T, sampleLane, samplePoints, type Lane, type MissLoop } from './paths';

const T = LANDING.timing;
const REROUTE_SEC = 0.9; // blend time when a token's gate closes under it
const REJOIN_SEC = 0.6;
const MISS_FLASH_SEC = 0.35;

/** Token lifecycle. Free slots are reused, so the particle buffers never grow. */
export const Phase = { Free: 0, Travel: 1, Serve: 2, Dissolve: 3, MissFlash: 4, Loop: 5, Grace: 6, Rejoin: 7 } as const;
/** A "missed" token looks normal until it reaches its gate and doesn't answer the call. */
export const Kind = { Normal: 0, Priority: 1, Missed: 2 } as const;

const PRIORITY = new Color(LANDING.colors.priority);
const MISSED = new Color(LANDING.colors.missed);

/** Open/closed state per gate; `openness` eases toward the target so closing and reopening are smooth. */
export class GateField {
  readonly target: boolean[];
  readonly openness: Float32Array;
  /** 1 right after a token is served at the gate, decaying to 0 (drives the gate's flash). */
  readonly flash: Float32Array;
  constructor(n: number) {
    this.target = Array.from({ length: n }, () => true);
    this.openness = new Float32Array(n).fill(1);
    this.flash = new Float32Array(n);
  }
  update(dt: number) {
    const step = dt / T.gateFadeSec;
    this.target.forEach((open, i) => {
      const goal = open ? 1 : 0;
      const o = this.openness[i];
      this.openness[i] = o < goal ? Math.min(goal, o + step) : Math.max(goal, o - step);
      this.flash[i] = Math.max(0, this.flash[i] - dt * 2.5);
    });
  }
  openGates() { return this.target.flatMap((open, i) => (open ? [i] : [])); }
}

/** Demo loop: every gateCycleSec one gate closes for gateClosedSec, then reopens (never the same gate twice running). */
export class GateCycle {
  private timer = 0;
  private closed = -1;
  private last = -1;
  update(dt: number, gates: GateField) {
    this.timer += dt;
    if (this.closed < 0 && this.timer >= T.gateCycleSec - T.gateClosedSec) {
      const choices = gates.openGates().filter((g) => g !== this.last);
      if (choices.length < 2) return;
      this.closed = choices[Math.floor(Math.random() * choices.length)];
      gates.target[this.closed] = false;
      this.timer = 0;
    } else if (this.closed >= 0 && this.timer >= T.gateClosedSec) {
      gates.target[this.closed] = true;
      this.last = this.closed;
      this.closed = -1;
      this.timer = 0;
    }
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (x: number) => { const t = Math.min(Math.max(x, 0), 1); return t * t * (3 - 2 * t); };

export interface SpawnMix { priority: number; missed: number }

/** The queue as plain typed arrays, stepped once per frame; TokenParticles turns it into instance matrices and colours. */
export class QueueSim {
  readonly cap: number;
  readonly phase: Uint8Array;
  readonly kind: Uint8Array;
  readonly gate: Uint8Array;
  readonly prevGate: Uint8Array; // lane being left while rerouting
  readonly blend: Float32Array; // 0 = on prevGate's lane … 1 = on gate's lane
  readonly loopGate: Uint8Array; // whose miss loop a missed token is on
  readonly t: Float32Array; // progress along the lane, 0 (kiosk) → 1 (gate)
  readonly speed: Float32Array; // lane progress per second
  readonly timer: Float32Array; // seconds spent in the current phase
  readonly jitter: Float32Array; // per-token lateral offset (y, z), so a lane reads as a stream
  readonly color: Float32Array; // rgb per token (HDR, >1 so bloom picks it up)
  readonly colorDirty: Uint8Array;
  /** Tokens heading to or at each gate, for least-loaded dispatch. */
  readonly load: Int16Array;
  private spawnAcc = 0;
  private readonly a = new Vector3();
  private readonly b = new Vector3();

  constructor(cap: number, gates: number) {
    this.cap = cap;
    this.phase = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.gate = new Uint8Array(cap);
    this.prevGate = new Uint8Array(cap);
    this.blend = new Float32Array(cap);
    this.loopGate = new Uint8Array(cap);
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
    const glow = 1.6;
    this.color.set([c.r * glow, c.g * glow, c.b * glow], i * 3);
    this.colorDirty[i] = 1;
  }

  private spawn(gates: GateField, tint: () => Color, mix: SpawnMix) {
    const open = gates.openGates();
    if (!open.length) return;
    const i = this.phase.indexOf(Phase.Free);
    if (i < 0) return;
    const g = this.pickGate(open);
    const r = Math.random();
    const kind = r < mix.priority ? Kind.Priority : r < mix.priority + mix.missed ? Kind.Missed : Kind.Normal;
    this.phase[i] = Phase.Travel;
    this.kind[i] = kind;
    this.gate[i] = this.prevGate[i] = g;
    this.blend[i] = 1;
    this.load[g]++;
    this.t[i] = 0;
    this.timer[i] = 0;
    // priority tokens are visibly quicker: they overtake the stream and merge in ahead
    this.speed[i] = (kind === Kind.Priority ? 1.55 : 1) / rand(...T.travelSec);
    this.jitter[i * 2] = rand(-0.14, 0.14);
    this.jitter[i * 2 + 1] = rand(-0.18, 0.18);
    this.setColor(i, kind === Kind.Priority ? PRIORITY : tint());
  }

  private moveTo(i: number, g: number, blendFrom: boolean) {
    this.load[this.gate[i]]--;
    this.prevGate[i] = blendFrom ? this.gate[i] : g;
    this.gate[i] = g;
    this.blend[i] = blendFrom ? 0 : 1;
    this.load[g]++;
  }

  /** A token whose gate has closed moves to the least-loaded open gate. */
  private reroute(i: number, gates: GateField, blendFrom: boolean) {
    if (gates.target[this.gate[i]]) return;
    const open = gates.openGates();
    if (open.length) this.moveTo(i, this.pickGate(open), blendFrom);
  }

  private free(i: number) {
    this.load[this.gate[i]]--;
    this.phase[i] = Phase.Free;
  }

  private next(i: number, phase: number) { this.phase[i] = phase; this.timer[i] = 0; }

  /** Advance everything by dt seconds, spawning toward `target` particles on screen. */
  update(dt: number, gates: GateField, target: number, tint: () => Color, mix: SpawnMix = LANDING.mix) {
    this.spawnAcc += dt * (Math.min(target, this.cap) / QueueSim.lifetime());
    while (this.spawnAcc >= 1) { this.spawnAcc--; this.spawn(gates, tint, mix); }

    for (let i = 0; i < this.cap; i++) {
      const p = this.phase[i];
      if (p === Phase.Free) continue;
      this.timer[i] += dt;
      if (this.blend[i] < 1) this.blend[i] = Math.min(1, this.blend[i] + dt / REROUTE_SEC);
      switch (p) {
        case Phase.Travel:
          this.reroute(i, gates, true);
          this.t[i] = Math.min(1, this.t[i] + this.speed[i] * dt);
          if (this.t[i] >= 1) {
            if (this.kind[i] === Kind.Missed) { this.next(i, Phase.MissFlash); this.setColor(i, MISSED); }
            else { this.next(i, Phase.Serve); gates.flash[this.gate[i]] = 1; }
          }
          break;
        case Phase.Serve: if (this.timer[i] >= T.serveSec) this.next(i, Phase.Dissolve); break;
        case Phase.Dissolve: if (this.timer[i] >= T.dissolveSec) this.free(i); break;
        case Phase.MissFlash:
          if (this.timer[i] >= MISS_FLASH_SEC) { this.loopGate[i] = this.gate[i]; this.next(i, Phase.Loop); }
          break;
        case Phase.Loop: if (this.timer[i] >= T.missedLoopSec) this.next(i, Phase.Grace); break;
        case Phase.Grace:
          if (this.timer[i] >= T.graceSec) {
            this.reroute(i, gates, false); // its counter closed while it waited: rejoin another one's front
            this.kind[i] = Kind.Normal; // second chance: this time it is served
            this.next(i, Phase.Rejoin);
          }
          break;
        case Phase.Rejoin:
          this.reroute(i, gates, true);
          if (this.timer[i] >= REJOIN_SEC) { this.t[i] = REENTRY_T; this.next(i, Phase.Travel); }
          break;
      }
    }
  }

  /** Point on the token's lane at progress t, easing across lanes while it reroutes. */
  private lanePoint(i: number, lanes: Lane[], t: number, out: Vector3) {
    sampleLane(lanes[this.gate[i]], t, out);
    if (this.blend[i] < 1) out.lerpVectors(sampleLane(lanes[this.prevGate[i]], t, this.b), out, smooth(this.blend[i])); // per-component, so out may alias
    return out;
  }

  /** World position and size of token i this frame (scale 0 = hidden). */
  place(i: number, lanes: Lane[], loops: MissLoop[], out: Vector3): number {
    const p = this.phase[i];
    const kind = this.kind[i];
    switch (p) {
      case Phase.Free: return 0;
      case Phase.Travel: {
        const t = this.t[i];
        this.lanePoint(i, lanes, t, out);
        if (kind === Kind.Priority) {
          // a lane of its own just in front of the stream, merging in before the gate
          const off = 1 - smooth((t - 0.3) / 0.45);
          out.y += 0.42 * off;
          out.z += 0.4 * off;
        } else {
          const settle = 1 - t; // the stream tightens as it reaches the gate
          out.y += this.jitter[i * 2] * settle;
          out.z += this.jitter[i * 2 + 1] * settle;
        }
        const grow = Math.min(1, t * 12);
        return grow * (kind === Kind.Priority ? 1.3 : 1);
      }
      case Phase.Serve:
        this.lanePoint(i, lanes, 1, out);
        return 1 + 0.35 * Math.sin((this.timer[i] / T.serveSec) * Math.PI);
      case Phase.Dissolve:
        this.lanePoint(i, lanes, 1, out);
        return Math.max(0, 1 - this.timer[i] / T.dissolveSec);
      case Phase.MissFlash:
        this.lanePoint(i, lanes, 1, out);
        return 1 + 0.5 * Math.sin((this.timer[i] / MISS_FLASH_SEC) * Math.PI);
      case Phase.Loop:
        samplePoints(loops[this.loopGate[i]].points, smooth(this.timer[i] / T.missedLoopSec), out);
        return 1.1;
      case Phase.Grace:
        out.copy(loops[this.loopGate[i]].grace);
        out.y += 0.06 * Math.sin(this.timer[i] * 6);
        return 1.1 + 0.15 * Math.sin(this.timer[i] * 8); // pulsing while the grace period runs
      case Phase.Rejoin: {
        const from = this.a.copy(loops[this.loopGate[i]].grace);
        this.lanePoint(i, lanes, REENTRY_T, out);
        out.lerpVectors(from, out, smooth(this.timer[i] / REJOIN_SEC));
        return 1.1;
      }
    }
    return 0;
  }
}
