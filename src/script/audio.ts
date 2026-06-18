// ===== AUDIO SYSTEM =====
// Worker mode can complete tiles too quickly for one blip per tile. Instead,
// we synthesize a continuous buzz and drive it from solver throughput.
import { PRACTICE_DEACTIVATE_AUDIO, PRACTICE_PRAYERS } from "./constants.js";

let audioCtx: AudioContext | null = null;

interface SolverBuzzState {
  running: boolean;
  lowpass: BiquadFilterNode;
  master: GainNode;
  clickBuffer: AudioBuffer;
  clickDebt: number;
  pendingWork: number;
  pendingAccent: number;
  smoothedRate: number;
  lastTs: number;
  timer: ReturnType<typeof setInterval>;
}

let solverBuzzState: SolverBuzzState | null = null;

export function ensureAudio(): AudioContext {
  if (!audioCtx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AC();
  }
  return audioCtx;
}

export function solverBuzzClamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function startSolverBuzz(): void {
  const ac = ensureAudio();
  if (ac.state === "suspended") ac.resume().catch(() => {});
  if (solverBuzzState && solverBuzzState.running) return;
  const t = ac.currentTime;
  const lowpass = ac.createBiquadFilter();
  const master = ac.createGain();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(2600, t);
  lowpass.Q.setValueAtTime(0.55, t);
  master.gain.setValueAtTime(0.85, t);
  lowpass.connect(master);
  master.connect(ac.destination);
  solverBuzzState = {
    running: true,
    lowpass,
    master,
    clickBuffer: createSolverClickBuffer(ac),
    clickDebt: 0,
    pendingWork: 0,
    pendingAccent: 0,
    smoothedRate: 0,
    lastTs: performance.now(),
    timer: setInterval(updateSolverBuzz, 35),
  };
}

export function createSolverClickBuffer(ac: AudioContext): AudioBuffer {
  const len = Math.floor(ac.sampleRate * 0.016);
  const buffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const p = i / len;
    const env = Math.pow(1 - p, 1.75);
    const tooth = ((p * 34) % 1) * 2 - 1;
    const low = Math.sin(p * Math.PI * 30) * 0.35;
    const rasp = (Math.random() * 2 - 1) * 0.42;
    data[i] = (tooth * 0.48 + low + rasp) * env;
  }
  return buffer;
}

export function updateSolverBuzz(): void {
  const s = solverBuzzState;
  if (!s || !s.running || !audioCtx) return;
  const now = performance.now();
  const dt = Math.max(0.016, (now - s.lastTs) / 1000);
  s.lastTs = now;
  const instantRate = s.pendingWork / dt;
  const accentWeight = s.pendingAccent;
  s.pendingWork = 0;
  s.pendingAccent = 0;
  s.smoothedRate = s.smoothedRate * 0.72 + instantRate * 0.28;
  const rateNorm = solverBuzzClamp(s.smoothedRate / 210, 0, 1);
  const clickRate = 10 + rateNorm * 78;
  const t = audioCtx.currentTime;
  s.lowpass.frequency.setTargetAtTime(1600 + rateNorm * 1700, t, 0.025);
  s.clickDebt += clickRate * dt;
  if (s.clickDebt > 6) s.clickDebt = 6;
  const clicks = Math.min(4, Math.floor(s.clickDebt));
  s.clickDebt -= clicks;
  for (let i = 0; i < clicks; i++) {
    const at = t + 0.004 + (i / clicks) * dt + Math.random() * 0.006;
    scheduleSolverClick(at, rateNorm, accentWeight);
  }
}

export function scheduleSolverClick(at: number, rateNorm: number, accentWeight: number): void {
  const s = solverBuzzState;
  if (!s || !s.running || !audioCtx) return;
  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  src.buffer = s.clickBuffer;
  src.playbackRate.setValueAtTime(
    0.78 + rateNorm * 0.24 + Math.min(0.08, accentWeight * 0.012),
    at,
  );
  gain.gain.setValueAtTime(0.06 + rateNorm * 0.11, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.02);
  src.connect(gain);
  gain.connect(s.lowpass);
  src.start(at);
  src.stop(at + 0.026);
  src.onended = () => {
    try {
      src.disconnect();
      gain.disconnect();
    } catch {}
  };
}

export function registerSolverWork(units: number, pitchWeight: number): void {
  const s = solverBuzzState;
  if (!s || !s.running) return;
  s.pendingWork += units || 0;
  s.pendingAccent += pitchWeight || 0;
}

export function stopSolverBuzz(): void {
  const s = solverBuzzState;
  if (!s || !s.running) return;
  solverBuzzState = null;
  clearInterval(s.timer);
  const t = audioCtx ? audioCtx.currentTime : 0;
  try {
    s.master.gain.setTargetAtTime(0.00001, t, 0.025);
  } catch {}
  setTimeout(() => {
    try {
      s.lowpass.disconnect();
    } catch {}
    try {
      s.master.disconnect();
    } catch {}
  }, 150);
}

export function playExclusionBlip(): void {
  registerSolverWork(0.35, 0);
}

export function playScoreBlip(avgDmg: number): void {
  const clamped = solverBuzzClamp(avgDmg, 0, 100);
  const qualityNorm = 1 - clamped / 100; // lower damage = brighter accent
  registerSolverWork(1, qualityNorm);
}

export function playPracticePrayerSound(type: string, activating = true): void {
  const src = activating ? PRACTICE_PRAYERS[type]?.audio : PRACTICE_DEACTIVATE_AUDIO;
  if (!src) return;
  const audio = new Audio(src);
  audio.volume = 0.65;
  audio.play().catch(() => {
    if (!activating) playSyntheticPrayerDeactivate();
  });
}

export function playSyntheticPrayerDeactivate(): void {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(95, ctx.currentTime + 0.055);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.075);
  } catch {}
}
