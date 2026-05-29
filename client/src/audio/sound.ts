/**
 * Tiny synthesized SFX bank built on the Web Audio API. No asset files —
 * every sound is generated procedurally from oscillators + noise.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
const throttle = new Map<string, number>();

function ensureCtx(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(ctx.destination);
    noiseBuffer = makeNoiseBuffer(ctx, 0.6);
  }
  return ctx;
}

function makeNoiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function canPlay(key: string, minIntervalSec: number): boolean {
  const now = performance.now() / 1000;
  const last = throttle.get(key) ?? 0;
  if (now - last < minIntervalSec) return false;
  throttle.set(key, now);
  return true;
}

function playNoise(filterStart: number, filterEnd: number, duration: number, gain: number): void {
  const c = ensureCtx();
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  const t0 = c.currentTime;
  filter.frequency.setValueAtTime(filterStart, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, filterEnd), t0 + duration);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  src.connect(filter).connect(g).connect(masterGain!);
  src.start(t0);
  src.stop(t0 + duration + 0.05);
}

function playThump(startHz: number, endHz: number, duration: number, gain: number, type: OscillatorType = "sine"): void {
  const c = ensureCtx();
  const osc = c.createOscillator();
  osc.type = type;
  const t0 = c.currentTime;
  osc.frequency.setValueAtTime(startHz, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, endHz), t0 + duration);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(g).connect(masterGain!);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export const sound = {
  /** Must be called from a user gesture (click) to unlock audio in browsers. */
  init(): void {
    const c = ensureCtx();
    if (c.state === "suspended") void c.resume();
  },

  swing(): void {
    if (!canPlay("swing", 0.08)) return;
    playNoise(7000, 300, 0.18, 0.28);
  },

  throwStar(): void {
    if (!canPlay("throw", 0.06)) return;
    playNoise(12000, 1500, 0.12, 0.22);
  },

  monsterHit(): void {
    if (!canPlay("monsterHit", 0.05)) return;
    playThump(120, 45, 0.14, 0.4, "sine");
    playNoise(2200, 250, 0.07, 0.18);
  },

  monsterDeath(): void {
    if (!canPlay("monsterDeath", 0.04)) return;
    playNoise(4000, 200, 0.4, 0.32);
    playThump(90, 30, 0.3, 0.38, "triangle");
  },

  playerHit(): void {
    if (!canPlay("playerHit", 0.18)) return;
    playThump(240, 55, 0.22, 0.5, "sine");
    playNoise(3500, 250, 0.12, 0.28);
  },

  dragonRoar(): void {
    if (!canPlay("dragonRoar", 0.6)) return;
    playThump(160, 38, 1.2, 0.7, "sawtooth");
    playNoise(1500, 120, 0.9, 0.4);
  },

  dragonHit(): void {
    if (!canPlay("dragonHit", 0.08)) return;
    playThump(95, 35, 0.22, 0.55, "sine");
    playNoise(1800, 200, 0.10, 0.28);
  },

  fireball(): void {
    if (!canPlay("fireball", 0.08)) return;
    playNoise(6500, 700, 0.35, 0.3);
    playThump(300, 110, 0.35, 0.32, "sawtooth");
  },

  fireballImpact(): void {
    if (!canPlay("fireballImpact", 0.05)) return;
    playThump(190, 32, 0.5, 0.65, "sine");
    playNoise(2800, 100, 0.4, 0.45);
  },

  fireBreath(): void {
    if (!canPlay("fireBreath", 0.25)) return;
    playNoise(2200, 220, 1.1, 0.42);
    playThump(180, 110, 0.9, 0.2, "sawtooth");
  },

  dragonDeath(): void {
    if (!canPlay("dragonDeath", 0.6)) return;
    playThump(230, 28, 2.2, 0.75, "sawtooth");
    playNoise(2400, 90, 1.6, 0.42);
  },

  victory(): void {
    if (!canPlay("victory", 1.5)) return;
    const c = ensureCtx();
    const notes = [261.63, 329.63, 392.00, 523.25]; // C-E-G-C ascending
    notes.forEach((freq, i) => {
      const t0 = c.currentTime + i * 0.16;
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.32, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);
      osc.connect(g).connect(masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.75);
    });
  },

  doorOpen(): void {
    if (!canPlay("doorOpen", 0.1)) return;
    playThump(85, 135, 0.25, 0.32, "sawtooth");
    playNoise(850, 220, 0.18, 0.16);
  },

  doorClose(): void {
    if (!canPlay("doorClose", 0.1)) return;
    playThump(180, 65, 0.20, 0.45, "sine");
    playNoise(550, 90, 0.14, 0.22);
  },

  rumble(): void {
    if (!canPlay("rumble", 1.2)) return;
    playNoise(420, 60, 1.4, 0.3);
    playThump(72, 38, 1.5, 0.38, "sine");
  },

  collapse(): void {
    if (!canPlay("collapse", 0.4)) return;
    playThump(130, 28, 1.1, 0.75, "sawtooth");
    playNoise(900, 65, 1.0, 0.55);
  },

  loot(): void {
    if (!canPlay("loot", 0.3)) return;
    const c = ensureCtx();
    // Coin-shower of 6 quick triangle tinkles at random high pitches.
    for (let i = 0; i < 6; i++) {
      const t0 = c.currentTime + i * 0.04;
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 1200 + Math.random() * 900;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.18, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
      osc.connect(g).connect(masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    }
  },
};
