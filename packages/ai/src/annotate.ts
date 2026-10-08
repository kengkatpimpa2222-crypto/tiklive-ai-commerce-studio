import { newId, splitSentences, type Emotion, type Gesture, type HostEnergy, type SpeechSegment, type SpeechSource } from "@tlai/shared";

interface Cue {
  pattern: RegExp;
  emotion?: Emotion;
  gesture?: Gesture;
}

const CUES: Cue[] = [
  { pattern: /สวัสดี|hello|hi\b|ยินดีต้อนรับ/i, emotion: "happy", gesture: "wave" },
  { pattern: /ขอบคุณ|thank/i, emotion: "happy", gesture: "heart_hands" },
  { pattern: /ขอโทษ|ขออภัย|sorry/i, emotion: "apologetic", gesture: "nod" },
  { pattern: /ไม่แน่ใจ|ขอเช็ก|ขอตรวจสอบ|เดี๋ยวขอดู/i, emotion: "thinking", gesture: "think_chin" },
  { pattern: /ว้าว|โอ้โห|wow/i, emotion: "surprised", gesture: "open_palms" },
  { pattern: /โปร|ลด|แถม|ส่งฟรี|ราคาพิเศษ/i, emotion: "excited", gesture: "count_fingers" },
  { pattern: /ตัวนี้|ชิ้นนี้|ดูตรงนี้|ดูนี่|สินค้า/i, gesture: "point_product" },
  { pattern: /ดีมาก|แนะนำเลย|ชอบมาก|ปัง/i, emotion: "happy", gesture: "thumbs_up" },
  { pattern: /\d+\s*บาท/, emotion: "excited", gesture: "count_fingers" },
  { pattern: /AI|ตัวละคร|เอไอ/i, emotion: "calm", gesture: "open_palms" },
];

/** Hand movements that go with ordinary sentences when the host is lively. */
const BEATS: Gesture[] = ["open_palms", "point_product", "nod", "count_fingers", "thumbs_up"];

/** Natural pause after a sentence, based on how it ends. */
export function pauseAfter(sentence: string, isLast: boolean): number {
  if (isLast) return 900;
  if (/[?？]$/.test(sentence) || /(ไหม|มั้ย|หรือเปล่า|คะ)$/.test(sentence)) return 650;
  if (/[!！]$/.test(sentence)) return 450;
  if (/(ค่ะ|ครับ|นะคะ|นะครับ)$/.test(sentence)) return 380;
  return 260;
}

/**
 * Turns plain host text into speech segments with an emotion, gesture and pause
 * for each sentence. Gestures are spaced so the host does not move on every line.
 */
export function annotate(text: string, source: SpeechSource, opts: { productId?: string; baseEmotion?: Emotion; energy?: HostEnergy } = {}): SpeechSegment[] {
  const sentences = splitSentences(text);
  const high = (opts.energy ?? "high") === "high";
  const calm = opts.energy === "calm";
  // A lively seller smiles through ordinary lines, moves on most of them and keeps pauses short.
  const base: Emotion = opts.baseEmotion ?? (high ? "happy" : "neutral");
  const spacing = high ? 1 : calm ? 3 : 2;
  const pace = high ? 0.7 : calm ? 1.25 : 1;
  let lastGestureIdx = -3;
  return sentences.map((s, i) => {
    let emotion: Emotion = base;
    let gesture: Gesture = "none";
    for (const c of CUES) {
      if (!c.pattern.test(s)) continue;
      if (c.emotion && emotion === base) emotion = c.emotion;
      if (c.gesture && gesture === "none") gesture = c.gesture;
    }
    if (gesture === "none" && high && i - lastGestureIdx >= spacing && source !== "disclosure") gesture = BEATS[(i + s.length) % BEATS.length]!;
    if (gesture !== "none" && gesture !== "wave" && i - lastGestureIdx < spacing) gesture = "none";
    if (gesture !== "none") lastGestureIdx = i;
    return { id: newId("seg"), text: s, emotion, gesture, pauseAfterMs: Math.round(pauseAfter(s, i === sentences.length - 1) * pace), source, productId: opts.productId };
  });
}
