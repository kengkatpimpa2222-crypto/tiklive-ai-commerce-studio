import type { Emotion } from "@tlai/shared";

/**
 * Small per-emotion adjustments on top of the character's base voice so the
 * delivery matches the face: brighter and quicker when excited, slower and
 * lower when apologising. Kept subtle so the voice still sounds like one person.
 */
export const EMOTION_PROSODY: Record<Emotion, { rate: number; pitch: number }> = {
  neutral: { rate: 1, pitch: 1 },
  happy: { rate: 1.03, pitch: 1.05 },
  excited: { rate: 1.08, pitch: 1.1 },
  thinking: { rate: 0.92, pitch: 0.97 },
  surprised: { rate: 1.05, pitch: 1.12 },
  calm: { rate: 0.95, pitch: 0.98 },
  apologetic: { rate: 0.93, pitch: 0.94 },
};

export function prosodyFor(emotion: Emotion, base: { rate: number; pitch: number }): { rate: number; pitch: number } {
  const p = EMOTION_PROSODY[emotion];
  return { rate: clamp(base.rate * p.rate, 0.5, 2), pitch: clamp(base.pitch * p.pitch, 0, 2) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, +v.toFixed(3)));
