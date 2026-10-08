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
