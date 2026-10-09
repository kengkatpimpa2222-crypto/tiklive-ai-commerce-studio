import { afterEach, describe, expect, it } from "vitest";
import { azureSsml } from "@tlai/tts";
import { buildServer } from "./server.js";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("Azure neural Thai voices", () => {
  let app: Awaited<ReturnType<typeof buildServer>>["app"] | undefined;
  afterEach(async () => app?.close());

  it("builds SSML with the character's speed and pitch, escaping text", () => {
    const ssml = azureSsml("ราคา <ถูก> & ดี", { voice: "th-TH-PremwadeeNeural", rate: 1.1, pitch: 1.2 });
    expect(ssml).toContain('name="th-TH-PremwadeeNeural"');
    expect(ssml).toContain('rate="+10%" pitch="+10%"');
    expect(ssml).toContain("&lt;ถูก&gt; &amp;");
    expect(azureSsml("x", { voice: '"><evil', rate: 1, pitch: 1 })).toContain('name="th-TH-PremwadeeNeural"');
  });

  it("checks the key, keeps it out of responses, and returns audio for an Azure voice", async () => {
    const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const fake: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, headers, body: init?.body as string | undefined });
      if (headers["Ocp-Apim-Subscription-Key"] !== "good-key-123456") return new Response("", { status: 401 });
      if (url.endsWith("/voices/list")) return new Response("[]", { status: 200 });
      return new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    };
    const s = await buildServer({ dataFile: null, scheduleTickMs: 0, speechFetch: fake });
    app = s.app;
    const voice = { provider: "azure", voice: "th-TH-PremwadeeNeural", lang: "th-TH", rate: 1.1, pitch: 1.2 };
    expect((await app.inject({ method: "POST", url: "/api/tts", payload: { text: "สวัสดีค่ะ", voice } })).statusCode).toBe(400);
    const bad = await app.inject({ method: "PUT", url: "/api/speech-service", payload: { key: "wrong-key-123456", region: "southeastasia" } });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error).toContain("ไม่ถูกต้อง");
    const ok = await app.inject({ method: "PUT", url: "/api/speech-service", payload: { key: "good-key-123456", region: "southeastasia" } });
    expect(ok.body).not.toContain("good-key-123456");
    expect(json(ok)).toMatchObject({ hasKey: true, region: "southeastasia" });
    const r = json(await app.inject({ method: "POST", url: "/api/tts", payload: { text: "สวัสดีค่ะ", voice } }));
    expect(r.mime).toBe("audio/mpeg");
    expect(Buffer.from(r.audio, "base64")[0]).toBe(0x49);
    const synth = calls.at(-1)!;
    expect(synth.url).toBe("https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(synth.body).toContain("th-TH-PremwadeeNeural");
  });
});
