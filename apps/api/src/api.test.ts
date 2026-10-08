import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StageCommand } from "@tlai/shared";
import { buildServer } from "./server.js";

let ctx: Awaited<ReturnType<typeof buildServer>>;
beforeEach(async () => {
  ctx = await buildServer({ dataFile: null, freeTalkAfterMs: 50 });
});
afterEach(async () => {
  vi.useRealTimers();
  await ctx.app.close();
});

const json = (r: { body: string }) => JSON.parse(r.body);

describe("products API", () => {
  it("lists seed products and validates input", async () => {
    const list = json(await ctx.app.inject({ method: "GET", url: "/api/products" }));
    expect(list.length).toBe(3);
    const bad = await ctx.app.inject({ method: "POST", url: "/api/products", payload: { name: "x" } });
    expect(bad.statusCode).toBe(400);
    const ok = await ctx.app.inject({ method: "POST", url: "/api/products", payload: { sku: "A1", name: "สินค้า A", price: 100, stock: 3 } });
    expect(ok.statusCode).toBe(201);
  });
});

describe("live session", () => {
  async function createLive(extra: Record<string, unknown> = {}) {
    return json(await ctx.app.inject({ method: "POST", url: "/api/live", payload: { title: "ไลฟ์ทดสอบ", characterId: "char_mint", scriptId: "script_demo", productIds: ["prod_serum", "prod_bottle", "prod_tee"], ...extra } }));
  }

  it("refuses to start when preflight fails", async () => {
    await ctx.app.inject({ method: "PATCH", url: "/api/products/prod_serum", payload: { highlights: ["การันตีหน้าใสใน 7 วัน"] } });
    const live = await createLive();
    const r = await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/start` });
    expect(r.statusCode).toBe(422);
    expect(json(r).preflight.items.some((i: { ok: boolean }) => !i.ok)).toBe(true);
  });

  it("refuses a character without an AI disclosure label", async () => {
    const r = await ctx.app.inject({ method: "PATCH", url: "/api/characters/char_mint", payload: { disclosureLabel: "พิธีกร" } });
    expect(r.statusCode).toBe(200);
    const live = await createLive();
    const s = await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/start` });
    expect(s.statusCode).toBe(422);
  });

  it("runs the show: discloses first, speaks the script, answers questions, summarizes", { timeout: 30_000 }, async () => {
    const sent: StageCommand[] = [];
    const live = await createLive();
    const orig = ctx.director["d"].send;
    ctx.director["d"].send = (c: StageCommand) => {
      sent.push(c);
      orig(c);
    };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const start = await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/start` });
    expect(start.statusCode).toBe(200);

    const speak = () => sent.filter((c): c is Extract<StageCommand, { type: "speak" }> => c.type === "speak");
    expect(speak()[0]!.segment.source).toBe("disclosure");
    expect(speak()[0]!.segment.text).toContain("AI");

    await ctx.app.inject({ method: "POST", url: "/api/questions", payload: { text: "เซรั่มขนาดเท่าไหร่คะ", author: "viewer1" } });
    await ctx.app.inject({ method: "POST", url: "/api/questions", payload: { text: "เป็นคนจริงไหม" } });
    await ctx.app.inject({ method: "POST", url: "/api/questions", payload: { text: "ดูที่ www.spam.com" } });

    for (let i = 0; i < 400; i++) await vi.advanceTimersByTimeAsync(1000);

    const texts = speak().map((c) => c.segment.text).join(" ");
    expect(texts).toContain("299 บาท");
    expect(texts).toContain("30 ml");
    expect(texts).toContain("ไม่ใช่คนจริง");
    expect(texts).not.toContain("spam");
    expect(sent.some((c) => c.type === "product")).toBe(true);
    expect(sent.some((c) => c.type === "scene")).toBe(true);

    await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/stats`, payload: { orders: 7, gmv: 2100 } });
    vi.useRealTimers();
    await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/end` });
    const sum = json(await ctx.app.inject({ method: "GET", url: `/api/live/${live.id}/summary` }));
    expect(sum.disclosures).toBeGreaterThanOrEqual(1);
    expect(sum.questionsAnswered).toBe(2);
    expect(sum.productAirtime.length).toBe(3);
    expect(sum.narrative).toContain("คำสั่งซื้อ 7");
  });

  it("rejects operator lines that break the rules", async () => {
    const live = await createLive();
    await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/start` });
    const r = await ctx.app.inject({ method: "POST", url: "/api/director/say", payload: { text: "หนูเป็นคนจริงนะคะ ไม่ใช่ AI" } });
    expect(r.statusCode).toBe(422);
    const r2 = await ctx.app.inject({ method: "POST", url: "/api/director/say", payload: { text: "ตอนนี้มีคนดูเป็นหมื่นเลยค่ะ" } });
    expect(r2.statusCode).toBe(422);
  });
});

describe("tiktok", () => {
  it("never pins products itself", async () => {
    const r = json(await ctx.app.inject({ method: "POST", url: "/api/tiktok/pin", payload: { sku: "SER-VC30" } }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("TikTok LIVE Studio");
  });
});

describe("script generator and exports", () => {
  it("generates and saves a script from products", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/scripts/generate", payload: { productIds: ["prod_serum", "prod_tee"], durationMinutes: 30 } });
    expect(r.statusCode).toBe(201);
    const plan = json(r);
    expect(plan.script.steps.filter((s: { kind: string }) => s.kind === "pitch_product").length).toBe(2);
    const saved = json(await ctx.app.inject({ method: "GET", url: `/api/scripts/${plan.script.id}` }));
    expect(saved.title).toBe("สคริปต์อัตโนมัติ");
  });

  it("generated scripts pass the pre-live check", async () => {
    const plan = json(await ctx.app.inject({ method: "POST", url: "/api/scripts/generate", payload: { productIds: ["prod_serum", "prod_bottle", "prod_tee"] } }));
    const live = json(await ctx.app.inject({ method: "POST", url: "/api/live", payload: { title: "g", characterId: "char_mint", scriptId: plan.script.id, productIds: ["prod_serum", "prod_bottle", "prod_tee"] } }));
    const check = json(await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/check` }));
    expect(check.ok).toBe(true);
  });

  it("exports a markdown report and a CSV event log", async () => {
    const live = json(await ctx.app.inject({ method: "POST", url: "/api/live", payload: { title: "ส่งออก", characterId: "char_mint", productIds: ["prod_serum"] } }));
    await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/start` });
    await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/end` });
    const md = await ctx.app.inject({ method: "GET", url: `/api/live/${live.id}/export.md` });
    expect(md.statusCode).toBe(200);
    expect(md.body).toContain("# สรุปผล LIVE: ส่งออก");
    const csv = await ctx.app.inject({ method: "GET", url: `/api/live/${live.id}/export.csv` });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.startsWith("﻿time,type,product,text")).toBe(true);
    expect(csv.body).toContain(",started,");
    expect(csv.body).toContain(",ended,");
  });
});

describe("shop FAQ, settings and uploads", () => {
  it("answers shipping questions from the shop FAQ", async () => {
    const live = json(await ctx.app.inject({ method: "POST", url: "/api/live", payload: { title: "faq", characterId: "char_tem", productIds: ["prod_serum"] } }));
    await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/start` });
    const q = json(await ctx.app.inject({ method: "POST", url: "/api/questions", payload: { text: "ส่งกี่วันครับ" } }));
    const d = json(await ctx.app.inject({ method: "POST", url: `/api/questions/${q.id}/draft` }));
    expect(d.text).toContain("1-2 วันทำการ");
    expect(d.text).toContain("ครับ");
    expect(d.text).not.toContain("ค่ะ");
  });

  it("blocks a live when a shop FAQ answer makes a forbidden claim", async () => {
    await ctx.app.inject({ method: "PATCH", url: "/api/faqs/faq_return", payload: { answer: "การันตีคืนเงิน 100% ได้ผลแน่นอนค่ะ" } });
    const live = json(await ctx.app.inject({ method: "POST", url: "/api/live", payload: { title: "faq2", characterId: "char_mint", productIds: ["prod_serum"] } }));
    expect((await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/start` })).statusCode).toBe(422);
  });

  it("validates and stores stage settings", async () => {
    expect((await ctx.app.inject({ method: "PATCH", url: "/api/settings/stage", payload: { avatarScale: 5 } })).statusCode).toBe(400);
    const s = json(await ctx.app.inject({ method: "PATCH", url: "/api/settings/stage", payload: { shopName: "ร้านมินท์", avatarScale: 1.2 } }));
    expect(s.stage).toMatchObject({ shopName: "ร้านมินท์", avatarScale: 1.2, showCaptions: true });
  });

  it("uploads an image and serves it back; rejects non-images", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");
    const up = await ctx.app.inject({ method: "POST", url: "/api/uploads", payload: { filename: "a.png", dataBase64: png } });
    expect(up.statusCode).toBe(201);
    const { url } = json(up);
    const got = await ctx.app.inject({ method: "GET", url });
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    const prod = await ctx.app.inject({ method: "PATCH", url: "/api/products/prod_serum", payload: { imageUrl: url } });
    expect(prod.statusCode).toBe(200);
    expect((await ctx.app.inject({ method: "POST", url: "/api/uploads", payload: { filename: "x.exe", dataBase64: png } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "GET", url: "/uploads/..%2Fstudio.json" })).statusCode).toBe(404);
  });
});

describe("comment capture", () => {
  it("is unavailable outside the desktop app", async () => {
    expect(json(await ctx.app.inject({ method: "GET", url: "/api/capture" }))).toEqual({ available: false });
    expect((await ctx.app.inject({ method: "PATCH", url: "/api/capture", payload: { clipboardWatch: true } })).statusCode).toBe(404);
  });

  it("toggles clipboard watch through the desktop hook and tags question sources", async () => {
    await ctx.app.close();
    let state = { clipboardWatch: false, sendClipboardHotkey: "Ctrl+Shift+A", quickAskHotkey: "Ctrl+Shift+Q" };
    ctx = await buildServer({ dataFile: null, capture: { get: () => state, set: (p) => (state = { ...state, ...p }) } });
    const r = json(await ctx.app.inject({ method: "PATCH", url: "/api/capture", payload: { clipboardWatch: true } }));
    expect(r).toMatchObject({ available: true, clipboardWatch: true });
    const q = json(await ctx.app.inject({ method: "POST", url: "/api/questions", payload: { text: "ส่งกี่วันคะ", source: "clipboard" } }));
    expect(q.source).toBe("clipboard");
  });
});

describe("AI brain settings", () => {
  it("saves a Claude key without ever returning it, and the host then speaks AI-written lines", async () => {
    const calls: { url: string; headers: Record<string, string>; body: { model: string } }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ช่วงนี้อากาศร้อน เซรั่มตัวนี้เนื้อบางเบาใช้สบายเลยค่ะ" }], usage: { input_tokens: 900, output_tokens: 40 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const app = (await buildServer({ dataFile: null, llmFetch: fakeFetch })).app;
    expect(json(await app.inject({ method: "GET", url: "/api/ai" })).active).toBe(false);
    expect((await app.inject({ method: "PUT", url: "/api/ai", payload: { provider: "claude" } })).statusCode).toBe(400);

    const saved = json(await app.inject({ method: "PUT", url: "/api/ai", payload: { provider: "claude", apiKey: "sk-ant-secret-123456" } }));
    expect(saved).toMatchObject({ active: true, model: "claude-sonnet-5-5", hasKey: true, keyHint: "sk-a…3456" });
    expect(JSON.stringify(saved)).not.toContain("secret");

    const test = json(await app.inject({ method: "POST", url: "/api/ai/test", payload: { provider: "claude" } }));
    expect(test.via).toBe("llm");
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]!.headers["x-api-key"]).toBe("sk-ant-secret-123456");
    expect(json(await app.inject({ method: "GET", url: "/api/ai" })).usage).toMatchObject({ calls: 1, inputTokens: 900, outputTokens: 40 });

    expect(json(await app.inject({ method: "PUT", url: "/api/ai", payload: { provider: "off" } })).active).toBe(false);
    await app.close();
  });

  it("explains a rejected key in plain words", async () => {
    const fakeFetch = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const app = (await buildServer({ dataFile: null, llmFetch: fakeFetch })).app;
    const r = await app.inject({ method: "POST", url: "/api/ai/test", payload: { provider: "openai", apiKey: "sk-bad" } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toContain("API key ไม่ถูกต้อง");
    await app.close();
  });
});

describe("restart", () => {
  it("ends a LIVE left over from a previous run so a new one can start", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const file = join(mkdtempSync(join(tmpdir(), "tlai-")), "studio.json");
    const first = await buildServer({ dataFile: file });
    const body = { title: "ไลฟ์", characterId: "char_mint", productIds: ["prod_serum"] };
    const a = json(await first.app.inject({ method: "POST", url: "/api/live", payload: body }));
    expect((await first.app.inject({ method: "POST", url: `/api/live/${a.id}/start` })).statusCode).toBe(200);
    first.store.flush();
    await first.app.close();

    const second = await buildServer({ dataFile: file });
    expect(second.store.get("sessions", a.id)!.status).toBe("ENDED");
    const b = json(await second.app.inject({ method: "POST", url: "/api/live", payload: body }));
    expect((await second.app.inject({ method: "POST", url: `/api/live/${b.id}/start` })).statusCode).toBe(200);
    await second.app.close();
  });
});

describe("product import API", () => {
  const page = `<meta property="og:title" content="กระบอกน้ำ 750 ml"><meta property="og:description" content="เก็บเย็น 24 ชม. ฝาล็อกกันหก วัสดุสแตนเลส"><meta property="product:price:amount" content="390">`;
  const fakeFetch = (async (u: URL | string) => {
    const url = String(u);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private/\n", { status: 200 });
    return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;

  it("refuses TikTok links and asks for pasted text instead", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/products/import", payload: { url: "https://shop.tiktok.com/view/product/123" } });
    expect(r.statusCode).toBe(422);
    expect(json(r)).toMatchObject({ needsText: true });
  });

  it("drafts from a shop page's preview data and respects robots.txt", async () => {
    const app = (await buildServer({ dataFile: null, llmFetch: fakeFetch })).app;
    const ok = json(await app.inject({ method: "POST", url: "/api/products/import", payload: { url: "https://myshop.example/p/1" } }));
    expect(ok.draft).toMatchObject({ name: "กระบอกน้ำ 750 ml", price: 390 });
    const blocked = await app.inject({ method: "POST", url: "/api/products/import", payload: { url: "https://myshop.example/private/p/1" } });
    expect(blocked.statusCode).toBe(422);
    await app.close();
  });

  it("drafts from pasted text", async () => {
    const r = json(await ctx.app.inject({ method: "POST", url: "/api/products/import", payload: { text: "เสื้อยืดโอเวอร์ไซซ์\nราคา 259 บาท\n- ผ้าคอตตอน 100%\nไซซ์: M, L, XL" } }));
    expect(r.draft).toMatchObject({ name: "เสื้อยืดโอเวอร์ไซซ์", price: 259, highlights: ["ผ้าคอตตอน 100%"], specs: { ไซซ์: "M, L, XL" } });
  });
});
