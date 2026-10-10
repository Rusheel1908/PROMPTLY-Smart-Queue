import { useCallback, useState } from 'react';

/** In-page alerts for the status page: a short beep and a vibration, per urgency. Both respect the mute toggle. */
export type Urgency = 'normal' | 'high';

const ALERTS: Record<Urgency, { vibrate: number[]; beeps: number[] }> = {
  high: { vibrate: [300, 120, 300, 120, 300], beeps: [880, 0, 880, 0, 1175] }, // Hz per 150 ms step, 0 = pause
  normal: { vibrate: [200], beeps: [660, 0, 880] },
};
const STEP_S = 0.15;

let audio: AudioContext | null = null;

/** Mobile browsers only start audio after a tap; create the context on the first one so later alerts can sound. */
export function unlockAudioOnFirstTap() {
  const unlock = () => {
    try { audio ??= new AudioContext(); void audio.resume(); } catch { /* no Web Audio */ }
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  return () => window.removeEventListener('pointerdown', unlock);
}

function beep(freqs: number[]) {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    freqs.forEach((hz, i) => {
      if (!hz) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + i * STEP_S;
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + STEP_S);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + STEP_S);
    });
  } catch { /* audio not available */ }
}

export function alertUser(urgency: Urgency) {
  beep(ALERTS[urgency].beeps);
  try { navigator.vibrate?.(ALERTS[urgency].vibrate); } catch { /* vibration not available */ }
}

const MUTE_KEY = 'promptly.muted';
const readMuted = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } };

/** Mute toggle, remembered in this browser. */
export function useMuted() {
  const [muted, setMuted] = useState(readMuted);
  const toggle = useCallback(() => setMuted((m) => {
    try { localStorage.setItem(MUTE_KEY, m ? '0' : '1'); } catch { /* private mode */ }
    return !m;
  }), []);
  return { muted, toggle };
}
