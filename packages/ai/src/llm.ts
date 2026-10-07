export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmProvider {
  readonly id: string;
  complete(messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number }): Promise<string>;
}

/** Works with OpenAI, Azure OpenAI-compatible gateways, OpenRouter, local LM Studio/Ollama OpenAI endpoints, etc. */
export class OpenAICompatibleLlm implements LlmProvider {
  readonly id = "openai-compatible";
  constructor(private readonly opts: { baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch }) {}
  async complete(messages: ChatMessage[], o: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({ model: this.opts.model, messages, temperature: o.temperature ?? 0.6, max_tokens: o.maxTokens ?? 400 }),
    });
    if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  }
}
