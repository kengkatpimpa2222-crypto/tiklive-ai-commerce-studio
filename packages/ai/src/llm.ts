export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  readonly id: string;
  complete(messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number }): Promise<string>;
}

interface HttpOpts {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** A live cannot wait long for one line; slower replies fall back to the offline wording. */
  timeoutMs?: number;
  onUsage?: (u: LlmUsage) => void;
}

/** Turns an HTTP failure into a message a shop owner can act on. */
export function llmErrorMessage(status: number, body: string): string {
  if (status === 401 || status === 403) return "API key ไม่ถูกต้องหรือไม่มีสิทธิ์ใช้โมเดลนี้";
  if (status === 404) return "ไม่พบโมเดลนี้ ตรวจชื่อโมเดลอีกครั้ง";
  if (status === 402 || /credit|billing|quota|insufficient/i.test(body)) return "เครดิตในบัญชี AI หมด หรือยังไม่ได้ตั้งค่าการชำระเงิน";
  if (status === 429) return "เรียกใช้ถี่เกินขีดจำกัดของบัญชี ลองใหม่อีกครั้งหรือเพิ่มวงเงิน";
  if (status >= 500) return "ผู้ให้บริการ AI ขัดข้องชั่วคราว";
  return `เรียก AI ไม่สำเร็จ (HTTP ${status})`;
}

async function post(f: typeof fetch, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await f(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = (e as Error).name;
    throw new Error(name === "TimeoutError" || name === "AbortError" ? "AI ตอบช้าเกินไป" : "เชื่อมต่อผู้ให้บริการ AI ไม่ได้ ตรวจอินเทอร์เน็ต");
  }
  if (!res.ok) throw new Error(llmErrorMessage(res.status, await res.text().catch(() => "")));
  return res.json();
}

/** Works with OpenAI, Google Gemini's OpenAI endpoint, OpenRouter, local LM Studio/Ollama, etc. */
export class OpenAICompatibleLlm implements LlmProvider {
  readonly id = "openai-compatible";
  constructor(private readonly opts: HttpOpts & { baseUrl: string }) {}
  async complete(messages: ChatMessage[], o: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    const json = (await post(
      this.opts.fetchImpl ?? fetch,
      `${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`,
      this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {},
      { model: this.opts.model, messages, temperature: o.temperature ?? 0.6, max_tokens: o.maxTokens ?? 400 },
      this.opts.timeoutMs ?? 15_000,
    )) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    this.opts.onUsage?.({ inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 });
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  }
}

/** Anthropic Claude via the Messages API. */
export class AnthropicLlm implements LlmProvider {
  readonly id = "anthropic";
  constructor(private readonly opts: HttpOpts & { baseUrl?: string }) {}
  async complete(messages: ChatMessage[], o: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const json = (await post(
      this.opts.fetchImpl ?? fetch,
      `${(this.opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
      { "x-api-key": this.opts.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: this.opts.model,
        system: system || undefined,
        messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
        temperature: Math.min(o.temperature ?? 0.6, 1),
        max_tokens: o.maxTokens ?? 400,
      },
      this.opts.timeoutMs ?? 15_000,
    )) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    this.opts.onUsage?.({ inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 });
    return (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  }
}

export type AiProviderKind = "off" | "claude" | "openai" | "gemini" | "custom";

export interface AiConfig {
  provider: AiProviderKind;
  apiKey: string;
  model: string;
  /** Only for "custom" (any OpenAI-compatible endpoint). */
  baseUrl?: string;
}

/** Choices shown in the settings page; the first model of each is the default. */
export const AI_PRESETS: Record<Exclude<AiProviderKind, "off">, { label: string; baseUrl: string; models: { id: string; note: string }[]; keyUrl: string; priceUrl: string }> = {
  claude: {
    label: "Claude (Anthropic)",
    baseUrl: "https://api.anthropic.com",
    models: [
      { id: "claude-sonnet-5-5", note: "พูดไทยเป็นธรรมชาติที่สุด (แนะนำ)" },
      { id: "claude-haiku-5-5", note: "เร็วและถูกกว่า" },
    ],
    keyUrl: "https://console.anthropic.com/settings/keys",
    priceUrl: "https://claude.com/pricing#api",
  },
  openai: {
    label: "ChatGPT (OpenAI)",
    baseUrl: "https://api.openai.com/v1",
    models: [{ id: "gpt-4o-mini", note: "ถูก เร็ว" }, { id: "gpt-4o", note: "เก่งกว่า แพงกว่า" }],
    keyUrl: "https://platform.openai.com/api-keys",
    priceUrl: "https://openai.com/api/pricing",
  },
  gemini: {
    label: "Gemini (Google)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [{ id: "gemini-2.5-flash", note: "มีโควตาใช้ฟรีรายวัน" }],
    keyUrl: "https://aistudio.google.com/apikey",
    priceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  custom: {
    label: "อื่น ๆ (OpenAI-compatible)",
    baseUrl: "",
    models: [],
    keyUrl: "",
    priceUrl: "",
  },
};

/** Builds the provider for saved settings; undefined means the offline wording is used. */
export function createLlm(cfg: AiConfig | undefined, onUsage?: (u: LlmUsage) => void, fetchImpl?: typeof fetch): LlmProvider | undefined {
  if (!cfg || cfg.provider === "off" || !cfg.model) return undefined;
  if (cfg.provider === "claude") return cfg.apiKey ? new AnthropicLlm({ apiKey: cfg.apiKey, model: cfg.model, onUsage, fetchImpl }) : undefined;
  const baseUrl = cfg.provider === "custom" ? cfg.baseUrl ?? "" : AI_PRESETS[cfg.provider].baseUrl;
  // Local servers (Ollama, LM Studio) need no key; cloud ones do.
  if (!baseUrl || (!cfg.apiKey && cfg.provider !== "custom")) return undefined;
  return new OpenAICompatibleLlm({ baseUrl, apiKey: cfg.apiKey, model: cfg.model, onUsage, fetchImpl });
}
