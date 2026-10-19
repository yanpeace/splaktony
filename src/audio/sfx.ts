/**
 * Suoni chiptune generati con Web Audio (onde quadre, triangolari, rumore).
 * Niente file audio. Tutte le funzioni play*() sono sicure da chiamare
 * anche prima che l'audio sia sbloccato (in quel caso non suonano).
 *
 * Sui telefoni l'audio parte solo dopo un gesto: chiama unlockAudio() in un
 * pointerdown (lo fa già Game).
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
const MASTER_VOLUME = 0.35;

function ac(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return ctx.state === 'running' ? ctx : null;
}

export function unlockAudio(): void {
  ac();
  if (ctx && ctx.state !== 'running') void ctx.resume();
}

export function setMuted(value: boolean): void {
  muted = value;
  if (master && ctx) master.gain.setValueAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime);
}

export function isMuted(): boolean {
  return muted;
}

// ---- primitive ----

interface ToneOpts {
  type?: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  vol?: number;
  delay?: number;
}

export function tone({ type = 'square', from, to = from, dur, vol = 0.3, delay = 0 }: ToneOpts): void {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

interface NoiseOpts {
  dur: number;
  vol?: number;
  /** frequenza del filtro: passa-basso (default) o passa-alto */
  freq?: number;
  freqTo?: number;
  highpass?: boolean;
  delay?: number;
}

export function noise({ dur, vol = 0.3, freq = 2000, freqTo = freq, highpass = false, delay = 0 }: NoiseOpts): void {
  const a = ac();
  if (!a || !master || !noiseBuf) return;
  const t = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = highpass ? 'highpass' : 'lowpass';
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

// ---- limitatore per evitare raffiche ----

const lastPlay = new Map<string, number>();
function throttled(id: string, minMs: number): boolean {
  const now = performance.now();
  if (now - (lastPlay.get(id) ?? -1e9) < minMs) return true;
  lastPlay.set(id, now);
  return false;
}

// ---- suoni del gioco ----

/** Botta su stoffa imbottita. intensity 0..1 */
export function playHit(intensity = 0.5): void {
  if (throttled('hit', 35)) return;
  const k = Math.min(1, Math.max(0, intensity));
  noise({ dur: 0.06 + k * 0.08, vol: 0.25 + k * 0.3, freq: 1800 + k * 2000, freqTo: 300 });
  tone({ type: 'triangle', from: 220 - k * 60, to: 55, dur: 0.08 + k * 0.1, vol: 0.4 + k * 0.3 });
  if (k > 0.6) tone({ type: 'square', from: 110, to: 40, dur: 0.14, vol: 0.18 });
}

/** Cigolio del pupazzo (colpi in testa). */
export function playSqueak(): void {
  if (throttled('squeak', 120)) return;
  const base = 700 + Math.random() * 300;
  tone({ type: 'square', from: base, to: base * 1.6, dur: 0.07, vol: 0.12 });
  tone({ type: 'square', from: base * 1.5, to: base * 1.1, dur: 0.06, vol: 0.1, delay: 0.06 });
}

export function playPunch(): void {
  if (throttled('punch', 30)) return;
  noise({ dur: 0.05, vol: 0.35, freq: 4000, freqTo: 800 });
  tone({ type: 'square', from: 240, to: 90, dur: 0.07, vol: 0.2 });
}

/** Colpo a vuoto. */
export function playWhiff(): void {
  if (throttled('whiff', 60)) return;
  noise({ dur: 0.09, vol: 0.15, freq: 600, freqTo: 3000, highpass: true });
}

export function playShot(): void {
  if (throttled('shot', 25)) return;
  noise({ dur: 0.12, vol: 0.35, freq: 6000, freqTo: 500 });
  tone({ type: 'square', from: 900, to: 120, dur: 0.1, vol: 0.18 });
}

export function playExplosion(): void {
  if (throttled('boom', 60)) return;
  noise({ dur: 0.6, vol: 0.55, freq: 3000, freqTo: 80 });
  tone({ type: 'square', from: 80, to: 25, dur: 0.45, vol: 0.3 });
  tone({ type: 'triangle', from: 120, to: 30, dur: 0.5, vol: 0.35 });
}

export function playCoin(): void {
  if (throttled('coin', 70)) return;
  tone({ type: 'square', from: 988, dur: 0.06, vol: 0.12 });
  tone({ type: 'square', from: 1319, dur: 0.14, vol: 0.12, delay: 0.06 });
}

export function playClick(): void {
  if (throttled('click', 30)) return;
  tone({ type: 'square', from: 660, to: 520, dur: 0.035, vol: 0.12 });
}

export function playBuy(): void {
  [523, 659, 784].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.08, vol: 0.12, delay: i * 0.07 }));
}

export function playError(): void {
  tone({ type: 'square', from: 180, to: 140, dur: 0.18, vol: 0.15 });
}

export function playLevelUp(): void {
  [523, 659, 784, 1047, 1319].forEach((f, i) =>
    tone({ type: 'square', from: f, dur: 0.1, vol: 0.12, delay: i * 0.08 }),
  );
}

/** Rimbalzo/lancio leggero. */
export function playWhoosh(): void {
  if (throttled('whoosh', 120)) return;
  noise({ dur: 0.16, vol: 0.12, freq: 400, freqTo: 2400, highpass: true });
}
