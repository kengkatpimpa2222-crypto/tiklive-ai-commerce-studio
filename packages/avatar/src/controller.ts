import type { Emotion, Gesture } from "@tlai/shared";
import { sampleTimeline, type Viseme, type VisemeFrame } from "@tlai/tts";
import { EXPRESSIONS, type FaceTargets } from "./expressions.js";
import { GESTURE_DURATION_MS, gesturePose, REST_POSE, type ArmPose } from "./gestures.js";
import { createRng, drift } from "./rng.js";

/** Everything the renderer needs for one frame. */
export interface AvatarFrame {
  mouthOpen: number;
  viseme: Viseme;
  eyeOpenL: number;
  eyeOpenR: number;
  gazeX: number; // -1..1
  gazeY: number;
  headYaw: number; // degrees
  headPitch: number;
  headRoll: number;
  bodySway: number; // px
  breath: number; // 0..1
  face: FaceTargets;
  arms: ArmPose;
  speaking: boolean;
  emotion: Emotion;
  gesture: Gesture;
}

interface SpeechState {
  startedAt: number;
  durationMs: number;
  visemes: VisemeFrame[];
  /** Optional live amplitude from real audio, 0..1 */
  amplitude?: number;
}

/**
 * Drives a natural-looking idle and speaking performance: blinks, saccades,
 * breathing, head drift, emotion blending, gestures, lip sync and emphasis nods.
 * Pure logic, renderer-agnostic; call update() once per animation frame.
 */
export class AvatarController {
  private rng: () => number;
  private seed: number;
  private now = 0;
  private face: FaceTargets = { ...EXPRESSIONS.neutral };
  private emotion: Emotion = "neutral";
  private emotionHoldUntil = 0;

  private nextBlinkAt = 0;
  private blinkStart = -1;
  private doubleBlink = false;

  private gaze = { x: 0, y: 0 };
  private gazeTarget = { x: 0, y: 0 };
  private nextSaccadeAt = 0;

  private gesture: Gesture = "none";
  private gestureStart = 0;
  private nextIdleGestureAt = 0;

  private speech: SpeechState | null = null;
  private mouthOpen = 0;
  private emphasisNodAt = -1;

  constructor(seed = 7) {
    this.seed = seed;
    this.rng = createRng(seed);
    this.scheduleBlink();
    this.nextSaccadeAt = 400;
    this.nextIdleGestureAt = 8000;
  }

  setEmotion(e: Emotion, holdMs = 0): void {
    this.emotion = e;
    this.emotionHoldUntil = holdMs > 0 ? this.now + holdMs : 0;
  }

  playGesture(g: Gesture): void {
    if (g === "none") return;
    this.gesture = g;
    this.gestureStart = this.now;
  }

  startSpeech(visemes: VisemeFrame[], durationMs: number): void {
    this.speech = { startedAt: this.now, durationMs, visemes };
    this.gazeTarget = { x: 0, y: 0 }; // look at camera while talking
    this.nextSaccadeAt = this.now + 900;
  }

  /** Feed real audio amplitude while TTS audio plays. */
  setAmplitude(rms: number | undefined): void {
    if (this.speech) this.speech.amplitude = rms;
  }

  /** Re-time the current utterance when the true audio duration becomes known. */
  setSpeechDuration(durationMs: number): void {
    if (!this.speech || durationMs <= 0) return;
    const k = durationMs / this.speech.durationMs;
    this.speech.visemes = this.speech.visemes.map((f) => ({ ...f, t: f.t * k }));
    this.speech.durationMs = durationMs;
  }

  stopSpeech(): void {
    this.speech = null;
  }

  get isSpeaking(): boolean {
    return this.speech !== null;
  }

  update(dtMs: number): AvatarFrame {
    this.now += dtMs;
    const t = this.now;
    const target = EXPRESSIONS[this.emotion];
    // Expressions ease in over ~300ms, a little faster for surprise.
    const k = 1 - Math.exp(-dtMs / (this.emotion === "surprised" ? 120 : 300));
    for (const key of Object.keys(this.face) as (keyof FaceTargets)[]) this.face[key] += (target[key] - this.face[key]) * k;
    if (this.emotionHoldUntil && t > this.emotionHoldUntil && !this.speech) {
      this.emotion = "neutral";
      this.emotionHoldUntil = 0;
    }

    // Lip sync
    let viseme: Viseme = "rest";
    let mouthTarget = 0;
    if (this.speech) {
      const st = t - this.speech.startedAt;
      const s = sampleTimeline(this.speech.visemes, st);
      viseme = s.viseme;
      mouthTarget = this.speech.amplitude !== undefined ? s.open * 0.4 + this.speech.amplitude * 0.6 : s.open;
      // Emphasis nods on long open vowels.
      if (s.open > 0.9 && t - this.emphasisNodAt > 1400 && this.rng() < 0.08) this.emphasisNodAt = t;
      if (st > this.speech.durationMs + 120) this.speech = null;
    }
    this.mouthOpen += (mouthTarget - this.mouthOpen) * (1 - Math.exp(-dtMs / 45));

    // Blinks: 2.5–6s apart, ~150ms, occasional double blink. Less frequent while speaking emphatically.
    if (this.blinkStart < 0 && t >= this.nextBlinkAt) this.blinkStart = t;
    let lid = 1;
    if (this.blinkStart >= 0) {
      const p = (t - this.blinkStart) / 150;
      if (p >= 1) {
        this.blinkStart = this.doubleBlink ? t + 90 : -1;
        if (this.doubleBlink) this.doubleBlink = false;
        else this.scheduleBlink();
      } else if (p >= 0) {
        lid = 1 - Math.sin(p * Math.PI);
      }
    }
    const eyeOpen = Math.max(0, lid * this.face.eyeOpen * (1 - this.face.cheek * 0.15));

    // Saccades: quick gaze jumps, more frequent when idle or thinking.
    if (t >= this.nextSaccadeAt) {
      const wander = this.speech ? 0.25 : this.emotion === "thinking" ? 0.9 : 0.5;
      this.gazeTarget = { x: (this.rng() * 2 - 1) * wander, y: (this.rng() * 2 - 1) * wander * 0.5 + (this.emotion === "thinking" ? 0.4 : 0) };
      this.nextSaccadeAt = t + (this.speech ? 1200 + this.rng() * 1800 : 600 + this.rng() * 2200);
    }
    const g = 1 - Math.exp(-dtMs / 35);
    this.gaze.x += (this.gazeTarget.x - this.gaze.x) * g;
    this.gaze.y += (this.gazeTarget.y - this.gaze.y) * g;

    // Idle gestures so the host never freezes between lines.
    if (!this.speech && this.gesture === "none" && t >= this.nextIdleGestureAt) {
      this.playGesture(this.rng() < 0.5 ? "nod" : "open_palms");
      this.nextIdleGestureAt = t + 9000 + this.rng() * 9000;
    }
    let arms = REST_POSE;
    if (this.gesture !== "none") {
      const p = (t - this.gestureStart) / GESTURE_DURATION_MS[this.gesture];
      if (p >= 1) this.gesture = "none";
      else arms = gesturePose(this.gesture, p, this.face.energy);
    }

    // Head: slow drift + breathing + speech bob + emphasis nod + gesture contribution.
    const energy = this.face.energy;
    const speakBob = this.speech ? Math.sin(t * 0.011) * 1.2 * this.mouthOpen : 0;
    const nodP = this.emphasisNodAt >= 0 ? (t - this.emphasisNodAt) / 450 : 2;
    const nod = nodP < 1 ? Math.sin(nodP * Math.PI) * 4 : 0;
    const breath = (Math.sin((t / 4200) * Math.PI * 2) + 1) / 2;

    return {
      mouthOpen: this.mouthOpen,
      viseme,
      eyeOpenL: eyeOpen,
      eyeOpenR: eyeOpen,
      gazeX: this.gaze.x,
      gazeY: this.gaze.y,
      headYaw: drift(t, this.seed) * 6 * energy + arms.headYaw + this.gaze.x * 3,
      headPitch: drift(t, this.seed + 11) * 3 * energy + speakBob + nod + arms.headPitch,
      headRoll: drift(t, this.seed + 23) * 2.5 + this.face.headTilt,
      bodySway: drift(t, this.seed + 37) * 4 * energy,
      breath,
      face: { ...this.face },
      arms,
      speaking: this.speech !== null,
      emotion: this.emotion,
      gesture: this.gesture,
    };
  }

  private scheduleBlink(): void {
    this.nextBlinkAt = this.now + 2500 + this.rng() * 3500;
    this.doubleBlink = this.rng() < 0.15;
  }
}
