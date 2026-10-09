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

describe("autopilot", () => {
  it("starts a full LIVE with one call, reads promos on its own and ends itself with a goodbye", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const sent: StageCommand[] = [];
    const built = await buildServer({ dataFile: null, freeTalkAfterMs: 1000, promoEveryMs: 60_000 });
    const app = built.app;
    // Record what the stage would receive.
    const origSend = (built.director as unknown as { d: { send: (c: StageCommand) => void } }).d.send;
    (built.director as unknown as { d: { send: (c: StageCommand) => void } }).d.send = (c) => (sent.push(c), origSend(c));

    const r = await app.inject({ method: "POST", url: "/api/autopilot", payload: { minutes: 5 } });
    expect(r.statusCode).toBe(201);
    const { session, active, endsAt } = json(r);
    expect(active).toBe(true);
    expect(endsAt).toBeTruthy();
    expect(session.productIds.length).toBe(3);

    await vi.advanceTimersByTimeAsync(4 * 60_000);
    const said = sent.flatMap((c) => (c.type === "speak" ? [c.segment] : []));
    expect(said.some((s) => s.source === "promo")).toBe(true);
    expect(said.some((s) => s.source === "pitch")).toBe(true);
    expect(built.store.get("sessions", session.id)!.status).toBe("LIVE");

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(built.store.get("sessions", session.id)!.status).toBe("ENDED");
    const last = sent.flatMap((c) => (c.type === "speak" ? [c.segment.text] : [])).join(" ");
    expect(last).toContain("ขอบคุณทุกคนที่แวะมาดู");
    expect(json(await app.inject({ method: "GET", url: "/api/autopilot" })).active).toBe(false);
    await app.close();
  });
});

describe("character gallery", () => {
  it("offers 2 women and 2 men; using one adds an editable copy and makes it the main host", async () => {
    const presets = json(await ctx.app.inject({ method: "GET", url: "/api/characters/presets" }));
    expect(presets).toHaveLength(4);
    expect(presets.filter((p: { character: { politeParticle: string } }) => p.character.politeParticle === "ค่ะ")).toHaveLength(2);
    expect(presets.every((p: { character: { disclosureLabel: string } }) => /AI|Virtual/i.test(p.character.disclosureLabel))).toBe(true);

    const r = await ctx.app.inject({ method: "POST", url: "/api/characters/presets/preset_phum/use" });
    expect(r.statusCode).toBe(201);
    const c = json(r);
    expect(c.name).toBe("ภูมิ");
    expect(c.look.hairStyle).toBe("short");
    expect(json(await ctx.app.inject({ method: "GET", url: "/api/characters/main" })).id).toBe(c.id);
    expect(json(await ctx.app.inject({ method: "GET", url: `/api/characters/${c.id}` })).name).toBe("ภูมิ");

    // Autopilot puts the main host on air.
    const a = await ctx.app.inject({ method: "POST", url: "/api/autopilot", payload: { minutes: 0 } });
    expect(a.statusCode).toBeLessThan(300);
    const live = json(await ctx.app.inject({ method: "GET", url: "/api/live" })).find((s: { status: string }) => s.status === "LIVE");
    expect(live.characterId).toBe(c.id);
  });

  it("switches the main host and rejects unknown ids", async () => {
    expect((await ctx.app.inject({ method: "PUT", url: "/api/characters/main", payload: { id: "char_tem" } })).statusCode).toBe(200);
    expect(json(await ctx.app.inject({ method: "GET", url: "/api/characters/main" })).id).toBe("char_tem");
    expect((await ctx.app.inject({ method: "PUT", url: "/api/characters/main", payload: { id: "nope" } })).statusCode).toBe(404);
  });
});

describe("stage extras", () => {
  it("stores music, ticker and low-stock settings and serves uploaded music", async () => {
    const mp3 = Buffer.from("ID3fake-mp3-data").toString("base64");
    const up = await ctx.app.inject({ method: "POST", url: "/api/uploads", payload: { filename: "song.mp3", dataBase64: mp3 } });
    expect(up.statusCode).toBe(201);
    const { url } = json(up);
    const got = await ctx.app.inject({ method: "GET", url });
    expect(got.headers["content-type"]).toBe("audio/mpeg");
    expect((await ctx.app.inject({ method: "POST", url: "/api/uploads", payload: { filename: "x.exe", dataBase64: mp3 } })).statusCode).toBe(400);

    const r = await ctx.app.inject({ method: "PATCH", url: "/api/settings/stage", payload: { bgmUrl: url, bgmVolume: 0.4, tickerText: "ส่งทุกวัน", lowStockAt: 10 } });
    expect(r.statusCode).toBe(200);
    expect(json(r).stage).toMatchObject({ bgmUrl: url, bgmVolume: 0.4, tickerText: "ส่งทุกวัน", lowStockAt: 10 });
    expect((await ctx.app.inject({ method: "PATCH", url: "/api/settings/stage", payload: { bgmVolume: 3 } })).statusCode).toBe(400);
  });
});

describe("product Q&A", () => {
  it("saves the shop's answers and blocks ones that break the rules at preflight", async () => {
    const qa = [{ question: "มีกลิ่นไหม", answer: "ไม่มีน้ำหอมค่ะ" }];
    const r = await ctx.app.inject({ method: "PATCH", url: "/api/products/prod_bottle", payload: { qa } });
    expect(json(r).qa).toEqual(qa);
    expect((await ctx.app.inject({ method: "PATCH", url: "/api/products/prod_bottle", payload: { qa: [{ question: "", answer: "x" }] } })).statusCode).toBe(400);
    const pf = await ctx.app.inject({ method: "PATCH", url: "/api/products/prod_bottle", payload: { qa: [{ question: "ดีไหม", answer: "การันตีหายขาดใน 7 วัน" }] } });
    expect(pf.statusCode).toBe(200);
    const live = json(await ctx.app.inject({ method: "POST", url: "/api/live", payload: { title: "ไลฟ์ทดสอบ", characterId: "char_mint", scriptId: "script_demo", productIds: ["prod_bottle"] } }));
    const r2 = await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/start` });
    expect(r2.statusCode).toBe(422);
    expect(JSON.stringify(json(r2).preflight.items.filter((i: { ok: boolean }) => !i.ok))).toContain("กระบอกน้ำ");
  });
});

describe("scheduled LIVE", () => {
  it("starts the autopilot at the set time once, and reports why when it cannot", async () => {
    const s = await buildServer({ dataFile: null, freeTalkAfterMs: 50, scheduleTickMs: 0, notify: () => undefined });
    try {
      const bad = await s.app.inject({ method: "POST", url: "/api/schedules", payload: { days: [1], start: "25:00", minutes: 60 } });
      expect(bad.statusCode).toBe(400);
      const today = new Date(2026, 9, 9, 20, 1);
      const r = await s.app.inject({ method: "POST", url: "/api/schedules", payload: { days: [today.getDay(), today.getDay()], start: "20:00", minutes: 60 } });
      expect(r.statusCode).toBe(201);
      const sched = json(r);
      expect(sched.days).toEqual([today.getDay()]);

      s.runSchedules(new Date(2026, 9, 9, 19, 30));
      expect(json(await s.app.inject({ method: "GET", url: "/api/autopilot" })).active).toBe(false);
      s.runSchedules(today);
      const auto = json(await s.app.inject({ method: "GET", url: "/api/autopilot" }));
      expect(auto.active).toBe(true);
      expect(json(await s.app.inject({ method: "GET", url: `/api/schedules/${sched.id}` }))).toMatchObject({ lastRunDate: "2026-10-09", lastResult: expect.stringContaining("เริ่มแล้ว") });

      // Same day again: nothing new starts even after the LIVE ends.
      await s.app.inject({ method: "POST", url: `/api/live/${auto.sessionId}/end` });
      s.runSchedules(new Date(2026, 9, 9, 20, 3));
      expect(json(await s.app.inject({ method: "GET", url: "/api/autopilot" })).active).toBe(false);

      // Next day, with nothing on sale: it records why it did not start.
      for (const p of json(await s.app.inject({ method: "GET", url: "/api/products" }))) await s.app.inject({ method: "PATCH", url: `/api/products/${p.id}`, payload: { status: "DRAFT" } });
      const tomorrow = new Date(2026, 9, 10, 20, 0);
      await s.app.inject({ method: "PATCH", url: `/api/schedules/${sched.id}`, payload: { days: [tomorrow.getDay()] } });
      s.runSchedules(tomorrow);
      expect(json(await s.app.inject({ method: "GET", url: `/api/schedules/${sched.id}` })).lastResult).toContain("เริ่มไม่ได้");
    } finally {
      await s.app.close();
    }
  });
});

describe("flash sale API", () => {
  it("needs the seller to confirm the price is set in TikTok Shop", async () => {
    const live = json(await ctx.app.inject({ method: "POST", url: "/api/live", payload: { title: "t", characterId: "char_mint", productIds: ["prod_serum"] } }));
    expect((await ctx.app.inject({ method: "POST", url: `/api/live/${live.id}/start` })).statusCode).toBe(200);
    const body = { productId: "prod_serum", price: 249, minutes: 10 };
    const no = await ctx.app.inject({ method: "POST", url: "/api/director/flash-sale", payload: body });
    expect(no.statusCode).toBe(400);
    const ok = await ctx.app.inject({ method: "POST", url: "/api/director/flash-sale", payload: { ...body, confirmedInShop: true } });
    expect(json(ok).flashSale).toMatchObject({ productId: "prod_serum", price: 249, regularPrice: 299 });
    const end = await ctx.app.inject({ method: "POST", url: "/api/director/flash-sale-end", payload: {} });
    expect(json(end).flashSale).toBeNull();
  });
});

describe("promotion codes", () => {
  it("accepts a code and rejects symbols", async () => {
    const ok = await ctx.app.inject({ method: "POST", url: "/api/promotions", payload: { title: "ลด", detail: "ลด 20 บาท", code: "LIVE20" } });
    expect(json(ok).code).toBe("LIVE20");
    const empty = await ctx.app.inject({ method: "POST", url: "/api/promotions", payload: { title: "ลด", detail: "ลด 20 บาท", code: "" } });
    expect(json(empty).code).toBeUndefined();
    expect((await ctx.app.inject({ method: "POST", url: "/api/promotions", payload: { title: "ลด", detail: "x", code: "<b>" } })).statusCode).toBe(400);
  });
});
