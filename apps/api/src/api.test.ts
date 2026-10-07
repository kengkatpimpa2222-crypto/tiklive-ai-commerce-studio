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
