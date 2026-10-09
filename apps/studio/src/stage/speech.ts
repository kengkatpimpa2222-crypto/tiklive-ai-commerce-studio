import type { HostCharacter, SpeechSegment } from "@tlai/shared";
import { buildVisemeTimeline, estimateDurationMs, prosodyFor, type VisemeFrame } from "@tlai/tts";

export interface SpeechCallbacks {
  onStart(visemes: VisemeFrame[], durationMs: number): void;
  onAmplitude(rms: number | undefined): void;
  onDuration(durationMs: number): void;
  onEnd(): void;
}

/**
 * Speaks one segment. Browser voices (Windows: Microsoft Pattara/Niwat, or any
 * installed Thai voice) need no API key; a remote provider returns audio from
 * /api/tts and we analyse its amplitude for lip sync.
 */
export class SpeechEngine {
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private raf = 0;
  private timer = 0;
  private cancelled = false;
  constructor(private readonly muted = false) {}

  stop(): void {
    this.cancelled = true;
    window.speechSynthesis?.cancel();
    this.audio?.pause();
    this.audio = null;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
  }

  async speak(seg: SpeechSegment, c: HostCharacter, cb: SpeechCallbacks): Promise<void> {
    this.stop();
    this.cancelled = false;
    if (this.muted) return this.speakSilent(seg, c, cb);
    if (c.voice.provider !== "browser") {
      try {
        return await this.speakRemote(seg, c, cb);
      } catch (e) {
        console.warn("remote TTS failed, using local voice", e);
      }
    }
    if ("speechSynthesis" in window && pickVoice(c)) return this.speakBrowser(seg, c, cb);
    return this.speakSilent(seg, c, cb);
  }

  private speakBrowser(seg: SpeechSegment, c: HostCharacter, cb: SpeechCallbacks): void {
    const u = new SpeechSynthesisUtterance(seg.text);
    u.voice = pickVoice(c)!;
    u.lang = c.voice.lang;
    const { rate, pitch } = prosodyFor(seg.emotion, energized(c));
    u.rate = rate;
    u.pitch = pitch;
    const est = estimateDurationMs(seg.text, rate);
    let started = 0;
    u.onstart = () => {
      started = performance.now();
      cb.onStart(buildVisemeTimeline(seg.text, est), est);
    };
    // Re-time when the engine reports progress, so long sentences stay in sync.
    u.onboundary = (e) => {
      if (!started || e.charIndex <= 0) return;
      const elapsed = performance.now() - started;
      const projected = (elapsed / e.charIndex) * seg.text.length;
      if (projected > 300) cb.onDuration(projected);
    };
    u.onend = () => !this.cancelled && cb.onEnd();
    u.onerror = () => !this.cancelled && cb.onEnd();
    window.speechSynthesis.speak(u);
  }

  private async speakRemote(seg: SpeechSegment, c: HostCharacter, cb: SpeechCallbacks): Promise<void> {
    const res = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: seg.text, characterId: c.id }) });
    const data = (await res.json()) as { audio: string | null; mime?: string; durationMs: number; visemes: VisemeFrame[] };
    if (!data.audio || this.cancelled) throw new Error("no audio");
    const audio = new Audio(`data:${data.mime};base64,${data.audio}`);
    audio.playbackRate = prosodyFor(seg.emotion, energized({ ...c, voice: { ...c.voice, rate: 1, pitch: 1 } })).rate;
    this.audio = audio;
    this.ctx ??= new AudioContext();
    const src = this.ctx.createMediaElementSource(audio);
    const an = this.ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an).connect(this.ctx.destination);
    const buf = new Float32Array(an.fftSize);
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      cb.onAmplitude(Math.sqrt(s / buf.length));
      this.raf = requestAnimationFrame(tick);
    };
    audio.onloadedmetadata = () => isFinite(audio.duration) && cb.onDuration((audio.duration * 1000) / audio.playbackRate);
    audio.onended = () => {
      cancelAnimationFrame(this.raf);
      cb.onAmplitude(undefined);
      if (!this.cancelled) cb.onEnd();
    };
    await audio.play();
    cb.onStart(data.visemes, data.durationMs);
    tick();
  }

  /** No voice installed: animate from the text timeline and captions only. */
  private speakSilent(seg: SpeechSegment, c: HostCharacter, cb: SpeechCallbacks): void {
    const d = estimateDurationMs(seg.text, energized(c).rate);
    cb.onStart(buildVisemeTimeline(seg.text, d), d);
    this.timer = window.setTimeout(() => !this.cancelled && cb.onEnd(), d);
  }
}

export function pickVoice(c: HostCharacter): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return voices.find((v) => v.name === c.voice.voice) ?? voices.find((v) => v.lang.replace("_", "-").startsWith(c.voice.lang.slice(0, 2)));
}

/** A lively host speaks a little quicker and brighter; a calm one a little slower. */
function energized(c: HostCharacter): { rate: number; pitch: number } {
  const e = c.energy ?? "high";
  return { rate: c.voice.rate * (e === "high" ? 1.08 : e === "calm" ? 0.94 : 1), pitch: c.voice.pitch * (e === "high" ? 1.04 : 1) };
}
