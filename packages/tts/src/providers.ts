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

/** Microsoft neural Thai voices on Azure AI Speech (the same voices as Edge "Read aloud"). */
export const AZURE_THAI_VOICES = [
  { id: "th-TH-PremwadeeNeural", label: "เปรมวดี (ผู้หญิง เสียงใส)", gender: "female" },
  { id: "th-TH-AcharaNeural", label: "อัจฉรา (ผู้หญิง นุ่มนวล)", gender: "female" },
  { id: "th-TH-NiwatNeural", label: "นิวัฒน์ (ผู้ชาย)", gender: "male" },
] as const;

export interface AzureSpeechConfig {
  key: string;
  /** Azure region of the Speech resource, e.g. "southeastasia". */
  region: string;
}

const xmlEscape = (t: string) => t.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);
const percent = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}%`;

/** SSML for one line: the character's speed (1 = normal) and pitch (1 = normal) become prosody percentages. */
export function azureSsml(text: string, voice: Pick<VoiceConfig, "voice" | "rate" | "pitch">): string {
  const name = /^[a-z]{2}-[A-Z]{2}-\w+$/.test(voice.voice) ? voice.voice : "th-TH-PremwadeeNeural";
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="th-TH"><voice name="${name}"><prosody rate="${percent((voice.rate - 1) * 100)}" pitch="${percent((voice.pitch - 1) * 50)}">${xmlEscape(text)}</prosody></voice></speak>`;
}

export function azureErrorMessage(status: number): string {
  if (status === 401 || status === 403) return "Azure Speech key หรือ region ไม่ถูกต้อง";
  if (status === 429) return "ใช้เสียง Azure ถี่เกินไปหรือโควตาฟรีเดือนนี้หมด";
  return `Azure Speech ตอบกลับผิดพลาด (${status})`;
}

/** Azure AI Speech REST text-to-speech. The key stays in the local API; the stage only gets audio. */
export class AzureTts implements TtsProvider {
  readonly id = "azure";
  /** `baseUrl` replaces the regional endpoint for local checks only. */
  constructor(private readonly cfg: AzureSpeechConfig, private readonly fetchImpl: typeof fetch = fetch, private readonly baseUrl?: string) {}

  private base(): string {
    return this.baseUrl || `https://${this.cfg.region}.tts.speech.microsoft.com`;
  }

  /** Lists voices; also proves the key and region work. */
  async check(): Promise<void> {
    const res = await this.fetchImpl(`${this.base()}/cognitiveservices/voices/list`, { headers: { "Ocp-Apim-Subscription-Key": this.cfg.key }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(azureErrorMessage(res.status));
  }

  async synthesize(text: string, voice: VoiceConfig): Promise<SynthesisResult> {
    const res = await this.fetchImpl(`${this.base()}/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": this.cfg.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "TikLiveAIStudio",
      },
      body: azureSsml(text, voice),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(azureErrorMessage(res.status));
    const audio = new Uint8Array(await res.arrayBuffer());
    const durationMs = estimateDurationMs(text, voice.rate);
    return { audio, mime: "audio/mpeg", durationMs, visemes: buildVisemeTimeline(text, durationMs) };
  }
}
