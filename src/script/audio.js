// ===== AUDIO SYSTEM =====
// Worker mode can complete tiles too quickly for one blip per tile. Instead,
// we synthesize a continuous buzz and drive it from solver throughput.
import { PRACTICE_PRAYERS, PRACTICE_DEACTIVATE_AUDIO } from "./constants.js";

let audioCtx = null;
let solverBuzzState = null;
export function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
export function solverBuzzClamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
export function startSolverBuzz() {
  let ac = ensureAudio();
  if (ac.state === "suspended") ac.resume().catch(() => {});
  if (solverBuzzState && solverBuzzState.running) return;
  let t = ac.currentTime;
  let lowpass = ac.createBiquadFilter();
  let master = ac.createGain();
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
export function createSolverClickBuffer(ac) {
  let len = Math.floor(ac.sampleRate * 0.016);
  let buffer = ac.createBuffer(1, len, ac.sampleRate);
  let data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    let p = i / len;
    let env = Math.pow(1 - p, 1.75);
    let tooth = ((p * 34) % 1) * 2 - 1;
    let low = Math.sin(p * Math.PI * 30) * 0.35;
    let rasp = (Math.random() * 2 - 1) * 0.42;
    data[i] = (tooth * 0.48 + low + rasp) * env;
  }
  return buffer;
}
export function updateSolverBuzz() {
  let s = solverBuzzState;
  if (!s || !s.running || !audioCtx) return;
  let now = performance.now();
  let dt = Math.max(0.016, (now - s.lastTs) / 1000);
  s.lastTs = now;
  let instantRate = s.pendingWork / dt;
  let accentWeight = s.pendingAccent;
  s.pendingWork = 0;
  s.pendingAccent = 0;
  s.smoothedRate = s.smoothedRate * 0.72 + instantRate * 0.28;
  let rateNorm = solverBuzzClamp(s.smoothedRate / 210, 0, 1);
  let clickRate = 10 + rateNorm * 78;
  let t = audioCtx.currentTime;
  s.lowpass.frequency.setTargetAtTime(1600 + rateNorm * 1700, t, 0.025);
  s.clickDebt += clickRate * dt;
  if (s.clickDebt > 6) s.clickDebt = 6;
  let clicks = Math.min(4, Math.floor(s.clickDebt));
  s.clickDebt -= clicks;
  for (let i = 0; i < clicks; i++) {
    let at = t + 0.004 + (i / clicks) * dt + Math.random() * 0.006;
    scheduleSolverClick(at, rateNorm, accentWeight);
  }
}
export function scheduleSolverClick(at, rateNorm, accentWeight) {
  let s = solverBuzzState;
  if (!s || !s.running || !audioCtx) return;
  let src = audioCtx.createBufferSource();
  let gain = audioCtx.createGain();
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
export function registerSolverWork(units, pitchWeight) {
  let s = solverBuzzState;
  if (!s || !s.running) return;
  s.pendingWork += units || 0;
  s.pendingAccent += pitchWeight || 0;
}
export function stopSolverBuzz() {
  let s = solverBuzzState;
  if (!s || !s.running) return;
  solverBuzzState = null;
  clearInterval(s.timer);
  let t = audioCtx ? audioCtx.currentTime : 0;
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
export function playExclusionBlip() {
  registerSolverWork(0.35, 0);
}
export function playScoreBlip(avgDmg) {
  let clamped = solverBuzzClamp(avgDmg, 0, 100);
  let qualityNorm = 1 - clamped / 100; // lower damage = brighter accent
  registerSolverWork(1, qualityNorm);
}

export function playPracticePrayerSound(type, activating = true) {
  let src = activating ? PRACTICE_PRAYERS[type]?.audio : PRACTICE_DEACTIVATE_AUDIO;
  if (!src) return;
  let audio = new Audio(src);
  audio.volume = 0.65;
  audio.play().catch(() => {
    if (!activating) playSyntheticPrayerDeactivate();
  });
}
export function playSyntheticPrayerDeactivate() {
  try {
    let ctx = new (window.AudioContext || window.webkitAudioContext)();
    let osc = ctx.createOscillator(),
      gain = ctx.createGain();
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
