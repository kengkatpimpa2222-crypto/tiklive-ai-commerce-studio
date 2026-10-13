/**
 * Short sound effects made with Web Audio, so there are no sound files to license.
 * Each is a few soft tones; the stage window's audio goes to TikTok LIVE Studio with the voice.
 */
export type SfxKind = "product" | "sale" | "coupon" | "order";

/** Notes (Hz) and their start offsets (s) for each effect. */
const PATTERNS: Record<SfxKind, { f: number; at: number; len: number; type: OscillatorType }[]> = {
  product: [
    { f: 880, at: 0, len: 0.18, type: "sine" },
    { f: 1318.5, at: 0.09, len: 0.3, type: "sine" },
  ],
  sale: [
    { f: 523.3, at: 0, len: 0.14, type: "triangle" },
    { f: 659.3, at: 0.1, len: 0.14, type: "triangle" },
    { f: 784, at: 0.2, len: 0.14, type: "triangle" },
    { f: 1046.5, at: 0.3, len: 0.4, type: "triangle" },
  ],
  coupon: [
    { f: 1568, at: 0, len: 0.12, type: "sine" },
    { f: 2093, at: 0.07, len: 0.12, type: "sine" },
    { f: 2637, at: 0.14, len: 0.25, type: "sine" },
  ],
  order: [
    { f: 1046.5, at: 0, len: 0.12, type: "square" },
    { f: 1568, at: 0.12, len: 0.35, type: "sine" },
  ],
};

let ctx: AudioContext | null = null;

export function playSfx(kind: SfxKind, volume: number): void {
  if (volume <= 0) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    for (const n of PATTERNS[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type;
      osc.frequency.value = n.f;
      // Quick attack and smooth decay: a chime, not a beep.
      const peak = 0.18 * volume * (n.type === "square" ? 0.35 : 1);
      gain.gain.setValueAtTime(0, t0 + n.at);
      gain.gain.linearRampToValueAtTime(peak, t0 + n.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.len + 0.05);
    }
  } catch {
    // No audio device: effects are optional.
  }
}
