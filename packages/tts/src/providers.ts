import type { VoiceConfig } from "@tlai/shared";
import { buildVisemeTimeline, estimateDurationMs, type VisemeFrame } from "./visemes.js";

export interface SynthesisResult {
  /** Encoded audio (mp3/wav). Absent for providers that speak directly (browser). */
  audio?: Uint8Array;
  mime?: string;
  durationMs: number;
  visemes: VisemeFrame[];
}

export interface TtsProvider {
  readonly id: string;
  synthesize(text: string, voice: VoiceConfig): Promise<SynthesisResult>;
}

/** Offline provider: produces timing and visemes only. The stage speaks with Windows voices. */
export class BrowserTtsPlan implements TtsProvider {
  readonly id = "browser";
  async synthesize(text: string, voice: VoiceConfig): Promise<SynthesisResult> {
    const durationMs = estimateDurationMs(text, voice.rate);
    return { durationMs, visemes: buildVisemeTimeline(text, durationMs) };
  }
}

/** Any OpenAI-compatible /audio/speech endpoint. */
export class OpenAICompatibleTts implements TtsProvider {
  readonly id = "openai";
  constructor(
    private readonly opts: { baseUrl: string; apiKey: string; model?: string; fetchImpl?: typeof fetch },
  ) {}
  async synthesize(text: string, voice: VoiceConfig): Promise<SynthesisResult> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`${this.opts.baseUrl.replace(/\/$/, "")}/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({ model: this.opts.model ?? "tts-1", voice: voice.voice || "alloy", input: text, speed: voice.rate, response_format: "mp3" }),
    });
    if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text().catch(() => "")}`);
    const audio = new Uint8Array(await res.arrayBuffer());
    // Exact duration is measured by the stage when decoding; this estimate seeds the viseme timeline.
    const durationMs = estimateDurationMs(text, voice.rate);
    return { audio, mime: "audio/mpeg", durationMs, visemes: buildVisemeTimeline(text, durationMs) };
  }
}
