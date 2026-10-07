/**
 * Viseme classes the avatar mouth can form. A small set reads naturally at
 * stream resolution and maps cleanly from both Thai and Latin text.
 */
export const VISEMES = ["rest", "A", "E", "I", "O", "U", "MBP", "FV", "TH", "CH"] as const;
export type Viseme = (typeof VISEMES)[number];

export interface VisemeFrame {
  /** ms from the start of the utterance */
  t: number;
  viseme: Viseme;
  /** 0..1 jaw opening at this frame */
  open: number;
}

/** Jaw opening for each viseme at full emphasis. */
export const VISEME_OPEN: Record<Viseme, number> = {
  rest: 0, A: 1, E: 0.65, I: 0.4, O: 0.75, U: 0.45, MBP: 0, FV: 0.15, TH: 0.3, CH: 0.35,
};

const THAI_VOWEL: Record<string, Viseme> = {
  "ะ": "A", "ั": "A", "า": "A", "ำ": "A", "ไ": "A", "ใ": "A", "ๅ": "A",
  "ิ": "I", "ี": "I", "ึ": "I", "ื": "I",
  "ุ": "U", "ู": "U",
  "เ": "E", "แ": "E",
  "โ": "O", "อ": "O",
};
const THAI_CONS: Record<string, Viseme> = {
  "ม": "MBP", "บ": "MBP", "ป": "MBP", "พ": "MBP", "ภ": "MBP", "ผ": "MBP",
  "ฟ": "FV", "ฝ": "FV",
  "ช": "CH", "ฉ": "CH", "ฌ": "CH", "จ": "CH", "ศ": "CH", "ษ": "CH", "ส": "TH", "ซ": "TH",
  "ท": "TH", "ต": "TH", "ด": "TH", "ถ": "TH", "ธ": "TH", "ฐ": "TH", "ฑ": "TH", "ฒ": "TH", "ฏ": "TH", "ฎ": "TH", "น": "TH", "ณ": "TH", "ล": "TH", "ฬ": "TH", "ร": "TH",
};
const LATIN: Record<string, Viseme> = {
  a: "A", e: "E", i: "I", y: "I", o: "O", u: "U", w: "U",
  m: "MBP", b: "MBP", p: "MBP", f: "FV", v: "FV",
  t: "TH", d: "TH", n: "TH", l: "TH", s: "TH", z: "TH", r: "TH",
  c: "CH", j: "CH", g: "E", k: "E", q: "U", h: "A", x: "E",
};

interface Token {
  viseme: Viseme;
  weight: number;
}

/** Converts text to a sequence of mouth shapes with relative durations. */
export function textToVisemeTokens(text: string): Token[] {
  const tokens: Token[] = [];
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]!;
    if (/\s/.test(ch)) {
      tokens.push({ viseme: "rest", weight: 0.6 });
      continue;
    }
    if (/[,;:]/.test(ch)) {
      tokens.push({ viseme: "rest", weight: 2 });
      continue;
    }
    if (/[.!?…]/.test(ch)) {
      tokens.push({ viseme: "rest", weight: 3 });
      continue;
    }
    if (/\d/.test(ch)) {
      // Digits are spoken as whole words; approximate one open syllable each.
      tokens.push({ viseme: "A", weight: 1.6 }, { viseme: "TH", weight: 0.6 });
      continue;
    }
    const v = THAI_VOWEL[ch] ?? THAI_CONS[ch] ?? LATIN[ch];
    if (v) {
      const vowel = v === "A" || v === "E" || v === "I" || v === "O" || v === "U";
      tokens.push({ viseme: v, weight: vowel ? 1.4 : 0.7 });
    } else if (/[ก-ฮ]/.test(ch)) {
      // Other Thai consonants: inherent short vowel.
      tokens.push({ viseme: "A", weight: 0.8 });
    }
    // Tone marks and other combining characters add no mouth movement.
  }
  return tokens;
}

/** Rough speaking duration for text at a given rate (1 = normal). Thai ≈ 6 syllables/s. */
export function estimateDurationMs(text: string, rate = 1): number {
  const weight = textToVisemeTokens(text).reduce((s, t) => s + t.weight, 0);
  return Math.max(400, Math.round((weight * 62) / rate));
}

/**
 * Spreads viseme tokens across a known (or estimated) duration and applies
 * light coarticulation so consecutive shapes blend instead of snapping.
 */
export function buildVisemeTimeline(text: string, durationMs?: number, rate = 1): VisemeFrame[] {
  const tokens = textToVisemeTokens(text);
  if (tokens.length === 0) return [{ t: 0, viseme: "rest", open: 0 }];
  const total = tokens.reduce((s, t) => s + t.weight, 0);
  const dur = durationMs ?? estimateDurationMs(text, rate);
  const frames: VisemeFrame[] = [];
  let t = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const prev = tokens[i - 1];
    let open = VISEME_OPEN[tok.viseme];
    if (prev && tok.viseme !== "rest") open = open * 0.8 + VISEME_OPEN[prev.viseme] * 0.2;
    const last = frames[frames.length - 1];
    if (!last || last.viseme !== tok.viseme) frames.push({ t: Math.round(t), viseme: tok.viseme, open: +open.toFixed(3) });
    t += (tok.weight / total) * dur;
  }
  frames.push({ t: Math.round(dur), viseme: "rest", open: 0 });
  return frames;
}

/** Looks up the mouth state at time t (ms) with linear blending toward the next frame. */
export function sampleTimeline(frames: VisemeFrame[], t: number): { viseme: Viseme; open: number } {
  if (frames.length === 0) return { viseme: "rest", open: 0 };
  let i = 0;
  while (i + 1 < frames.length && frames[i + 1]!.t <= t) i++;
  const a = frames[i]!;
  const b = frames[i + 1];
  if (!b) return { viseme: a.viseme, open: a.open };
  const k = Math.min(1, Math.max(0, (t - a.t) / Math.max(1, b.t - a.t)));
  // Ease the jaw so it lingers on the target shape and moves quickly between.
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  return { viseme: k < 0.6 ? a.viseme : b.viseme, open: a.open + (b.open - a.open) * e };
}

/**
 * Converts a live audio amplitude (RMS 0..1) into jaw opening with attack/release
 * smoothing. Used when real TTS audio is playing, combined with the text timeline
 * for mouth shape.
 */
export class AmplitudeLipSync {
  private value = 0;
  constructor(private readonly attack = 0.55, private readonly release = 0.18, private readonly gate = 0.02) {}
  update(rms: number): number {
    const target = rms < this.gate ? 0 : Math.min(1, (rms - this.gate) * 6);
    const k = target > this.value ? this.attack : this.release;
    this.value += (target - this.value) * k;
    return this.value;
  }
}
