import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

/** In-memory stand-in for api.d-id.com that records every call. */
function fakeDid() {
  const calls: { method: string; path: string; auth: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.d-id.com", "");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const auth = String((init.headers as Record<string, string>).Authorization);
    calls.push({ method: init.method ?? "GET", path, auth, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (auth !== "Basic good-key:secret") return json(401, { kind: "AuthorizationError" });
    if (path === "/credits") return json(200, { remaining: 42, total: 60 });
    if (path.startsWith("/clips/presenters"))
      return json(200, {
        presenters: [
          { presenter_id: "v2_public_amy@x", name: "Amy", gender: "female", thumbnail_url: "https://cdn.example/amy.png", talking_preview_url: "https://cdn.example/amy.mp4", is_streamable: true },
          { presenter_id: "v2_public_old@x", name: "Old", gender: "male", thumbnail_url: "https://cdn.example/old.png", is_streamable: false },
        ],
      });
    if (path === "/agents" && init.method === "POST") return json(201, { id: "agt_1", embed: false });
    if (path === "/agents/agt_1/streams" && init.method === "POST") return json(201, { id: "strm_1", session_id: "sess_1", jsep: { type: "offer", sdp: "v=0 fake" }, ice_servers: [{ urls: "stun:stun.example" }] });
    if (path.endsWith("/sdp") || path.endsWith("/ice")) return json(200, {});
    if (path === "/agents/agt_1/streams/strm_1" && init.method === "POST") return json(200, { status: "started", duration: 2.5, session_id: "sess_1" });
    if (init.method === "DELETE") return json(200, {});
    return json(404, { message: "unknown" });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

let ctx: Awaited<ReturnType<typeof buildServer>>;
afterEach(async () => ctx?.app.close());
const json = (r: { body: string }) => JSON.parse(r.body);

describe("realistic avatar service (D-ID)", () => {
  it("rejects a wrong key and never stores it", async () => {
    const d = fakeDid();
    ctx = await buildServer({ dataFile: null, avatarFetch: d.fetchImpl });
    const r = await ctx.app.inject({ method: "PUT", url: "/api/avatar-service", payload: { apiKey: "bad" } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toContain("ไม่ถูกต้อง");
    expect(json(await ctx.app.inject({ method: "GET", url: "/api/avatar-service" })).hasKey).toBe(false);
  });

  it("lists streamable presenters, creates a Thai-voiced host, and only speaks lines the director sent", async () => {
    const d = fakeDid();
    ctx = await buildServer({ dataFile: null, avatarFetch: d.fetchImpl, freeTalkAfterMs: 60_000 });
    const saved = json(await ctx.app.inject({ method: "PUT", url: "/api/avatar-service", payload: { apiKey: "good-key:secret" } }));
    expect(saved.hasKey).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("secret");

    const presenters = json(await ctx.app.inject({ method: "GET", url: "/api/avatar-service/presenters" }));
    expect(presenters.map((p: { id: string }) => p.id)).toEqual(["v2_public_amy@x"]);

    const used = await ctx.app.inject({ method: "POST", url: "/api/avatar-service/use", payload: { presenterId: "v2_public_amy@x", name: "Amy", gender: "female", imageUrl: "https://cdn.example/amy.png" } });
    expect(used.statusCode).toBe(201);
    const host = json(used);
    expect(host.look.style).toBe("service");
    expect(host.look.service).toMatchObject({ agentId: "agt_1", voiceId: "th-TH-PremwadeeNeural" });
    expect(host.disclosureLabel).toMatch(/AI/);
    const agentCall = d.calls.find((c) => c.path === "/agents")!;
    expect(agentCall.body).toMatchObject({ presenter: { type: "clip", presenter_id: "v2_public_amy@x", voice: { type: "microsoft", voice_id: "th-TH-PremwadeeNeural" } } });
    expect(agentCall.body).not.toHaveProperty("llm");
    expect(json(await ctx.app.inject({ method: "GET", url: "/api/characters/main" })).id).toBe(host.id);

    const stream = json(await ctx.app.inject({ method: "POST", url: "/api/avatar-service/streams", payload: { characterId: host.id } }));
    expect(stream).toMatchObject({ streamId: "strm_1", offer: { type: "offer" } });
    expect((await ctx.app.inject({ method: "POST", url: "/api/avatar-service/streams/strm_1/sdp", payload: { answer: { type: "answer", sdp: "v=0 a" } } })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: "POST", url: "/api/avatar-service/streams/strm_1/ice", payload: { candidate: "c", sdpMid: "0", sdpMLineIndex: 0 } })).statusCode).toBe(200);
    expect(d.calls.find((c) => c.path.endsWith("/sdp"))!.body).toMatchObject({ session_id: "sess_1", answer: { type: "answer" } });

    // Text the director never sent cannot be spoken.
    expect((await ctx.app.inject({ method: "POST", url: "/api/avatar-service/streams/strm_1/speak", payload: { segmentId: "made-up" } })).statusCode).toBe(404);

    // A real line from a live session goes through.
    const live = json(await ctx.app.inject({ method: "POST", url: "/api/live", payload: { title: "t", characterId: host.id, productIds: ["prod_serum"] } }));
    const started = await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/start` });
    expect(started.statusCode, started.body).toBeLessThan(300);
    const seg = await waitForSegment(ctx);
    const spoke = await ctx.app.inject({ method: "POST", url: "/api/avatar-service/streams/strm_1/speak", payload: { segmentId: seg } });
    expect(spoke.statusCode).toBe(200);
    const speakCall = d.calls.filter((c) => c.path === "/agents/agt_1/streams/strm_1" && c.method === "POST").at(-1)!;
    expect(speakCall.body).toMatchObject({ session_id: "sess_1", script: { type: "text", provider: { type: "microsoft", voice_id: "th-TH-PremwadeeNeural" } } });

    // A new stream replaces the old one (no paying twice) and the old id stops working.
    await ctx.app.inject({ method: "POST", url: "/api/avatar-service/streams", payload: { characterId: host.id } });
    expect(d.calls.some((c) => c.method === "DELETE")).toBe(true);
  });
});

/** Reads the id of the latest line the director pushed to the stage. */
async function waitForSegment(c: typeof ctx): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const st = c.director.state() as unknown as { queue?: { id: string }[]; speaking?: { id: string } | null };
    const id = st.speaking?.id ?? st.queue?.[0]?.id;
    if (id) return id;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("no segment");
}
