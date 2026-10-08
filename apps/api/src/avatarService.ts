/**
 * Realistic streaming avatars through D-ID's official Agents Streams API.
 *
 * The seller pastes their own D-ID API key. The key stays in this process: the stage only
 * does WebRTC and asks this server to speak a segment the director already sent, so the
 * avatar can never say anything that did not pass the compliance guard.
 */
export const DID_API = "https://api.d-id.com";
/** Lets a local stand-in replace D-ID for end-to-end checks; never set in normal use. */
const didBase = () => process.env.TLAI_DID_API_BASE || DID_API;

/** Microsoft neural voices D-ID offers for Thai. */
export const THAI_VOICES = [
  { id: "th-TH-PremwadeeNeural", label: "เปรมวดี (ผู้หญิง)", gender: "female" },
  { id: "th-TH-AcharaNeural", label: "อัจฉรา (ผู้หญิง)", gender: "female" },
  { id: "th-TH-NiwatNeural", label: "นิวัฒน์ (ผู้ชาย)", gender: "male" },
] as const;

export const defaultThaiVoice = (gender: string | undefined) => (gender === "male" ? "th-TH-NiwatNeural" : "th-TH-PremwadeeNeural");

export interface AvatarServiceConfig {
  provider: "did";
  apiKey: string;
}

export interface ServicePresenter {
  id: string;
  name: string;
  gender: "male" | "female" | string;
  imageUrl: string;
  /** Short talking clip D-ID provides for previews, when available. */
  previewUrl?: string;
}

export interface StreamInit {
  streamId: string;
  sessionId: string;
  offer: RTCSessionDescriptionInit;
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
}

interface RTCSessionDescriptionInit {
  type: "offer" | "answer";
  sdp: string;
}

/** Turns D-ID HTTP failures into messages a seller can act on. */
export function didErrorMessage(status: number, body: string): string {
  if (status === 401) return "API key ของ D-ID ไม่ถูกต้อง ตรวจว่าคัดลอกมาครบ";
  if (status === 402) return "เครดิต D-ID หมด เติมแพ็กเกจที่ studio.d-id.com";
  if (status === 403) return "แพ็กเกจ D-ID นี้ยังใช้การสตรีมอวตารไม่ได้ ต้องเป็นแพ็กเกจ API ที่รองรับ Streaming";
  if (status === 429) return "ส่งคำขอถี่เกินไป D-ID ขอให้รอสักครู่";
  let detail = "";
  try {
    const j = JSON.parse(body) as { description?: string; message?: string; kind?: string };
    detail = j.description ?? j.message ?? j.kind ?? "";
  } catch {
    detail = body.slice(0, 160);
  }
  return `D-ID ตอบกลับผิดพลาด (${status})${detail ? `: ${detail}` : ""}`;
}

export class DidClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly base = didBase(),
  ) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        // D-ID shows the key ready to use after "Basic".
        headers: { Authorization: `Basic ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new Error(`เชื่อมต่อ D-ID ไม่ได้ ตรวจอินเทอร์เน็ต (${(e as Error).message})`);
    }
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(didErrorMessage(res.status, text)), { statusCode: res.status === 401 || res.status === 402 || res.status === 403 ? 400 : 502 });
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Remaining credits; also proves the key works. */
  async credits(): Promise<{ remaining: number; total: number }> {
    const r = await this.req<{ remaining?: number; total?: number }>("GET", "/credits");
    return { remaining: r.remaining ?? 0, total: r.total ?? 0 };
  }

  /** Stock realistic presenters that can stream. */
  async presenters(): Promise<ServicePresenter[]> {
    const r = await this.req<{ presenters?: Record<string, unknown>[] }>("GET", "/clips/presenters?limit=100");
    return (r.presenters ?? [])
      .filter((p) => p.is_streamable !== false && (p.status === undefined || p.status === "done"))
      .map((p) => ({
        id: String(p.presenter_id),
        name: String(p.name ?? p.presenter_id),
        gender: String(p.gender ?? ""),
        imageUrl: String(p.thumbnail_url ?? p.image_url ?? p.preview_url ?? ""),
        previewUrl: (p.talking_preview_url as string | undefined) || undefined,
      }))
      .filter((p) => p.imageUrl);
  }

  /** An agent wraps a presenter and a voice. No D-ID LLM: this app writes every line itself. */
  async createAgent(name: string, presenterId: string, voiceId: string): Promise<string> {
    const r = await this.req<{ id: string }>("POST", "/agents", {
      preview_name: name,
      presenter: { type: "clip", presenter_id: presenterId, voice: { type: "microsoft", voice_id: voiceId } },
    });
    return r.id;
  }

  async createStream(agentId: string): Promise<StreamInit> {
    const r = await this.req<{ id: string; session_id?: string; jsep?: RTCSessionDescriptionInit; offer?: RTCSessionDescriptionInit; ice_servers?: StreamInit["iceServers"] }>(
      "POST",
      `/agents/${encodeURIComponent(agentId)}/streams`,
      { stream_warmup: true },
    );
    const offer = r.jsep ?? r.offer;
    if (!r.id || !offer) throw new Error("D-ID ไม่ได้ส่งข้อมูลการเชื่อมต่อวิดีโอกลับมา");
    return { streamId: r.id, sessionId: r.session_id ?? "", offer, iceServers: r.ice_servers ?? [] };
  }

  async sdp(agentId: string, streamId: string, sessionId: string, answer: unknown): Promise<void> {
    await this.req("POST", `/agents/${encodeURIComponent(agentId)}/streams/${encodeURIComponent(streamId)}/sdp`, { answer, session_id: sessionId });
  }

  async ice(agentId: string, streamId: string, sessionId: string, c: { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null }): Promise<void> {
    await this.req("POST", `/agents/${encodeURIComponent(agentId)}/streams/${encodeURIComponent(streamId)}/ice`, { ...c, session_id: sessionId });
  }

  async speak(agentId: string, streamId: string, sessionId: string, text: string, voiceId: string): Promise<{ duration?: number }> {
    return this.req("POST", `/agents/${encodeURIComponent(agentId)}/streams/${encodeURIComponent(streamId)}`, {
      session_id: sessionId,
      script: { type: "text", input: text, provider: { type: "microsoft", voice_id: voiceId } },
    });
  }

  async closeStream(agentId: string, streamId: string, sessionId: string): Promise<void> {
    await this.req("DELETE", `/agents/${encodeURIComponent(agentId)}/streams/${encodeURIComponent(streamId)}`, { session_id: sessionId });
  }
}
