import { describe, expect, it } from "vitest";
import type { HostCharacter, LiveSession, Product, Promotion } from "@tlai/shared";
import { annotate, HostBrain, matchProductQa, summarizeLive, type LlmProvider } from "./index.js";

const character: HostCharacter = {
  id: "c1", name: "น้องมินท์", disclosureLabel: "AI Virtual Host", persona: "", politeParticle: "ค่ะ",
  voice: { provider: "browser", voice: "", lang: "th-TH", rate: 1, pitch: 1 },
  look: { skin: "#f1c7a5", hair: "#2b1d1a", eyes: "#3b2a20", outfit: "#ff4f7b", accent: "#ffd166" },
};
const product: Product = {
  id: "p1", sku: "SER-01", name: "เซรั่มวิตามินซี", description: "เซรั่มบำรุงผิวหน้า", price: 299, compareAtPrice: 450, stock: 12,
  category: "ความงาม", highlights: ["เนื้อบางเบา ซึมไว", "ไม่มีน้ำหอม"], specs: { ขนาด: "30 ml" }, status: "ACTIVE",
};
const promo: Promotion = { id: "pr1", title: "ส่งฟรี", detail: "ซื้อครบ 2 ขวด ส่งฟรี", productIds: [], active: true };
const ctx = { character, products: [product], promotions: [promo], currentProductId: "p1", allowedPrices: [299, 450] };

describe("HostBrain (offline)", () => {
  const brain = new HostBrain();
  it("pitches with real price and promo", async () => {
    const out = await brain.pitch(product, ctx);
    expect(out.text).toContain("299 บาท");
    expect(out.text).toContain("ส่งฟรี");
    expect(out.issues).toEqual([]);
  });
  it("answers identity questions honestly", async () => {
    const out = await brain.answer("เป็นคนจริงไหมคะ", ctx);
    expect(out.via).toBe("identity");
    expect(out.text).toContain("AI");
  });
  it("answers from catalog facts and does not invent", async () => {
    expect((await brain.answer("ขนาดเท่าไหร่คะ", ctx)).text).toContain("30 ml");
    expect((await brain.answer("ราคาเท่าไหร่", ctx)).text).toContain("299 บาท");
    expect((await brain.answer("ใช้กับผิวแพ้ง่ายได้ไหม", ctx)).text).toContain("ทีมงาน");
  });
});

describe("HostBrain with no product on screen", () => {
  const none = { ...ctx, currentProductId: undefined };
  it("answers promo and lineup questions from shop data", async () => {
    const brain = new HostBrain();
    expect((await brain.answer("มีโปรอะไรบ้างคะ", none)).text).toContain("ซื้อครบ 2 ขวด ส่งฟรี");
    expect((await brain.answer("วันนี้ขายอะไรบ้าง", none)).text).toContain("299 บาท");
  });
  it("answers the lineup question even while a product is on screen", async () => {
    expect((await new HostBrain().answer("วันนี้ขายอะไรบ้าง", ctx)).text).toContain("วันนี้มี เซรั่มวิตามินซี ราคา 299 บาท");
  });
});

describe("HostBrain free talk", () => {
  const faqs = [{ id: "f1", topic: "การจัดส่ง", keywords: ["ส่ง"], answer: "ร้านจัดส่งภายใน 1-2 วันค่ะ" }];
  const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  it("does not repeat itself over a long stretch and mixes in shop FAQs", async () => {
    const brain = new HostBrain(undefined, { random: seeded(42) });
    const recent: string[] = [];
    for (let i = 0; i < 40; i++) {
      const out = await brain.freeTalk(product, { ...ctx, faqs, recent, hour: 19 });
      expect(out.issues).toEqual([]);
      expect(recent.slice(-20)).not.toContain(out.text);
      recent.push(out.text);
    }
    expect(new Set(recent).size).toBeGreaterThanOrEqual(30);
    expect(recent.some((t) => t.includes("ร้านจัดส่งภายใน 1-2 วัน"))).toBe(true);
    expect(recent.some((t) => t.includes("สวัสดีตอนเย็น"))).toBe(true);
  });

  it("words the same product pitch differently each time", async () => {
    const brain = new HostBrain(undefined, { random: seeded(7) });
    const pitches = await Promise.all([1, 2, 3, 4].map(() => brain.pitch(product, ctx)));
    expect(new Set(pitches.map((p) => p.text)).size).toBe(4);
    for (const p of pitches) {
      expect(p.text).toContain("299 บาท");
      expect(p.issues).toEqual([]);
    }
  });
});

describe("HostBrain (LLM guarded)", () => {
  it("replaces non-compliant LLM output with the safe template", async () => {
    const bad: LlmProvider = { id: "bad", complete: async () => "หนูเป็นคนจริงนะคะ การันตีหน้าใสใน 3 วัน ราคา 99 บาท" };
    const out = await new HostBrain(bad).pitch(product, ctx);
    expect(out.via).toBe("fallback");
    expect(out.text).not.toMatch(/(^|[^0-9,])99 บาท/);
    expect(out.text).toContain("299 บาท");
    expect(out.issues.length).toBeGreaterThan(0);
  });
  it("uses compliant LLM output", async () => {
    const good: LlmProvider = { id: "good", complete: async () => "เซรั่มวิตามินซี ราคา 299 บาทค่ะ" };
    const out = await new HostBrain(good).answer("ราคาเท่าไหร่", ctx);
    expect(out.via).toBe("llm");
  });
  it("composes every free-talk line with the AI, telling it what was said recently", async () => {
    const prompts: string[] = [];
    let n = 0;
    const llm: LlmProvider = { id: "fake", complete: async (m) => (prompts.push(m.at(-1)!.content), `"ประโยคที่คิดเองที่ ${++n} ค่ะ"`) };
    const brain = new HostBrain(llm);
    const outs = [];
    for (let i = 0; i < 6; i++) outs.push(await brain.freeTalk(product, { ...ctx, recent: ["สวัสดีค่ะทุกคน"] }));
    expect(outs.every((o) => o.via === "llm")).toBe(true);
    expect(outs[0]!.text).toBe("ประโยคที่คิดเองที่ 1 ค่ะ");
    expect(prompts[0]).toContain("สวัสดีค่ะทุกคน");
    expect(prompts[0]).toContain("เรื่องที่จะพูด");
  });
  it("words promos and shop FAQ answers itself, and falls back when the AI fails", async () => {
    const llm: LlmProvider = { id: "fake", complete: async () => "ตอนนี้ซื้อครบ 2 ขวดส่งฟรีเลยค่ะ ดูเงื่อนไขที่ตะกร้านะคะ" };
    expect((await new HostBrain(llm).promo(promo, ctx)).via).toBe("llm");
    const faqs = [{ id: "f1", topic: "การจัดส่ง", keywords: ["ส่ง"], answer: "ส่งภายใน 1-2 วันค่ะ" }];
    expect((await new HostBrain(llm).answer("ส่งกี่วันคะ", { ...ctx, faqs })).via).toBe("llm");
    const down: LlmProvider = { id: "down", complete: async () => Promise.reject(new Error("x")) };
    const out = await new HostBrain(down).answer("ส่งกี่วันคะ", { ...ctx, faqs });
    expect(out.via).toBe("fallback");
    expect(out.text).toContain("1-2 วัน");
  });
});

describe("annotate", () => {
  it("adds emotion, gesture and pauses per sentence", () => {
    const segs = annotate("สวัสดีค่ะ ทุกคน วันนี้มีโปรส่งฟรีค่ะ ขอบคุณที่แวะมานะคะ", "script", { energy: "normal" });
    expect(segs.length).toBeGreaterThanOrEqual(3);
    expect(segs[0]!.gesture).toBe("wave");
    expect(segs.some((s) => s.emotion === "excited")).toBe(true);
    expect(segs[segs.length - 1]!.pauseAfterMs).toBe(900);
  });
  it("makes a lively host smile, move more and pause less", () => {
    const text = "เซรั่มตัวนี้เนื้อบางเบา ซึมไวมาก ไม่เหนอะหนะเลย ใช้ได้ทั้งเช้าและก่อนนอน กลิ่นก็ไม่ฉุน พกพาง่ายด้วย";
    const calm = annotate(text, "pitch", { energy: "calm" });
    const high = annotate(text, "pitch", { energy: "high" });
    const moves = (s: typeof high) => s.filter((x) => x.gesture !== "none").length;
    expect(moves(high)).toBeGreaterThan(moves(calm));
    expect(high.every((x) => x.emotion !== "neutral")).toBe(true);
    expect(high.at(-1)!.pauseAfterMs).toBeLessThan(calm.at(-1)!.pauseAfterMs);
    // Lively is the default.
    expect(annotate(text, "pitch").map((x) => x.pauseAfterMs)).toEqual(high.map((x) => x.pauseAfterMs));
  });
});

describe("summarizeLive", () => {
  it("summarizes from the event log", () => {
    const s: LiveSession = {
      id: "l1", title: "ไลฟ์ทดสอบ", characterId: "c1", productIds: ["p1"], status: "ENDED",
      startedAt: "2026-10-07T10:00:00.000Z", endedAt: "2026-10-07T10:30:00.000Z", manualStats: { orders: 5, gmv: 1495 },
      events: [
        { at: "2026-10-07T10:00:00.000Z", type: "disclosure" },
        { at: "2026-10-07T10:01:00.000Z", type: "product_shown", productId: "p1" },
        { at: "2026-10-07T10:02:00.000Z", type: "spoke", productId: "p1", text: "x" },
        { at: "2026-10-07T10:03:00.000Z", type: "question", text: "ราคาเท่าไหร่" },
        { at: "2026-10-07T10:03:10.000Z", type: "answer", text: "299" },
        { at: "2026-10-07T10:04:00.000Z", type: "question", text: "ราคาเท่าไหร่" },
      ],
    };
    const sum = summarizeLive(s, [product]);
    expect(sum.durationMinutes).toBe(30);
    expect(sum.productAirtime[0]!.secondsOnScreen).toBe(29 * 60);
    expect(sum.questionsReceived).toBe(2);
    expect(sum.topQuestions[0]).toContain("×2");
    expect(sum.narrative).toContain("คำสั่งซื้อ 5");
  });
});

import { generateScript } from "./scriptgen.js";
import type { Scene } from "@tlai/shared";

describe("generateScript", () => {
  const scenes: Scene[] = (["intro", "product", "promo", "qa"] as const).map((k) => ({ id: `s_${k}`, name: k, kind: k, background: "#fff", showProductCard: true, showPromoBanner: true, showCaptions: true }));
  const tee: Product = { ...product, id: "p2", sku: "TEE", name: "เสื้อยืด", compareAtPrice: undefined };
  const serumPromo: Promotion = { id: "pr2", title: "เซรั่มคู่", detail: "ซื้อ 2 ขวด ลด 10%", productIds: ["p1"], active: true };

  it("covers every product with show, pitch and Q&A, and reads matching promotions", () => {
    const plan = generateScript({ title: "x", character, products: [product, tee], promotions: [promo, serumPromo], scenes, durationMinutes: 5 });
    const steps = plan.script.steps;
    for (const id of ["p1", "p2"]) {
      expect(steps).toContainEqual({ kind: "show_product", productId: id });
      expect(steps).toContainEqual({ kind: "pitch_product", productId: id });
    }
    expect(steps).toContainEqual({ kind: "read_promo", promotionId: "pr2" });
    expect(steps.filter((s) => s.kind === "qa_window").length).toBe(3);
    expect(steps[0]).toEqual({ kind: "scene", sceneId: "s_intro" });
  });

  it("loops when the planned live is longer than one pass", () => {
    const short = generateScript({ title: "x", character, products: [product], promotions: [], scenes, durationMinutes: 1 });
    const long = generateScript({ title: "x", character, products: [product], promotions: [], scenes, durationMinutes: 60 });
    expect(short.script.onEnd).toBe("free_talk");
    expect(long.script.onEnd).toBe("loop");
    expect(long.passes).toBeGreaterThan(1);
  });

  it("skips products that are not active", () => {
    const plan = generateScript({ title: "x", character, products: [{ ...product, status: "DRAFT" }], promotions: [], scenes, durationMinutes: 10 });
    expect(plan.script.steps.some((s) => s.kind === "pitch_product")).toBe(false);
  });
});

import { matchFaq } from "./brain.js";
describe("shop FAQ", () => {
  const faqs = [
    { id: "f1", topic: "จัดส่ง", keywords: ["ส่ง", "กี่วัน", "ขนส่ง"], answer: "จัดส่งภายใน 1-2 วันทำการค่ะ" },
    { id: "f2", topic: "ชำระเงิน", keywords: ["ปลายทาง", "cod", "โอน"], answer: "มีเก็บเงินปลายทางค่ะ" },
  ];
  it("matches by keywords and prefers more specific hits", () => {
    expect(matchFaq("ส่งกี่วันคะ", faqs)!.id).toBe("f1");
    expect(matchFaq("มี COD ไหม", faqs)!.id).toBe("f2");
    expect(matchFaq("สีอะไรบ้าง", faqs)).toBeUndefined();
  });
  it("answers shop questions from the FAQ, product facts from the catalog", async () => {
    const brain = new HostBrain();
    expect((await brain.answer("ส่งกี่วันคะ", { ...ctx, faqs })).text).toContain("1-2 วัน");
    expect((await brain.answer("ราคาเท่าไหร่ ส่งฟรีไหม", { ...ctx, faqs })).text).toContain("299 บาท");
  });
});

describe("findProduct", () => {
  const bottle: Product = { ...product, id: "p3", sku: "BTL", name: "กระบอกน้ำเก็บอุณหภูมิ 750 ml", specs: { ความจุ: "750 ml" } };
  const c2 = { ...ctx, products: [product, bottle], currentProductId: undefined };
  it("finds a product from a partial name", async () => {
    const brain = new HostBrain();
    expect(brain.findProduct("เซรั่มขนาดเท่าไหร่คะ", c2)!.id).toBe("p1");
    expect(brain.findProduct("กระบอกน้ำมีสีอะไร", c2)!.id).toBe("p3");
    expect((await brain.answer("เซรั่มขนาดเท่าไหร่คะ", c2)).text).toContain("30 ml");
  });
  it("falls back to the product on screen", () => {
    expect(new HostBrain().findProduct("ราคาเท่าไหร่", { ...c2, currentProductId: "p3" })!.id).toBe("p3");
  });
});

describe("summary disclosure count", () => {
  it("counts a multi-sentence disclosure once", () => {
    const s: LiveSession = {
      id: "l2", title: "t", characterId: "c1", productIds: [], status: "ENDED", startedAt: "2026-10-07T10:00:00.000Z", endedAt: "2026-10-07T10:40:00.000Z", manualStats: {},
      events: [
        { at: "2026-10-07T10:00:03.000Z", type: "disclosure" },
        { at: "2026-10-07T10:00:08.000Z", type: "disclosure" },
        { at: "2026-10-07T10:15:01.000Z", type: "disclosure" },
        { at: "2026-10-07T10:15:05.000Z", type: "disclosure" },
      ],
    };
    expect(summarizeLive(s, []).disclosures).toBe(2);
  });
});

describe("per-product Q&A", () => {
  const withQa: Product = {
    ...product,
    qa: [
      { question: "ใช้กับผิวแพ้ง่ายได้ไหม", answer: "ใช้ได้ค่ะ สูตรไม่มีน้ำหอม แนะนำทดสอบที่ท้องแขนก่อน" },
      { question: "ใช้ตอนเช้าหรือกลางคืน", answer: "ใช้ได้ทั้งเช้าและเย็นค่ะ ตอนเช้าทากันแดดทับ" },
    ],
  };
  const qaCtx = { ...ctx, products: [withQa], faqs: [{ id: "f1", topic: "ส่ง", keywords: ["ส่ง", "กี่วัน"], answer: "ส่งภายใน 1-2 วันค่ะ" }] };
  const brain = new HostBrain();
  it("answers with the seller's own answer when worded differently", async () => {
    expect(matchProductQa("ผิวแพ้ง่ายใช้ได้มั้ยคะ", withQa)?.answer).toContain("ท้องแขน");
    expect((await brain.answer("แม่ ผิวแพ้ง่ายใช้ได้มั้ย", qaCtx)).text).toContain("ท้องแขน");
    expect((await brain.answer("เซรั่มวิตามินซีใช้ตอนกลางคืนได้ไหม", qaCtx)).text).toContain("เช้าและเย็น");
  });
  it("matches the host's particle", async () => {
    const out = await brain.answer("ผิวแพ้ง่ายใช้ได้ไหม", { ...qaCtx, character: { ...character, politeParticle: "ครับ" } });
    expect(out.text).toContain("ใช้ได้ครับ");
  });
  it("leaves other questions to facts and the shop FAQ", async () => {
    expect(matchProductQa("ราคาเท่าไหร่คะ", withQa)).toBeUndefined();
    expect(matchProductQa("ได้ไหมคะ", withQa)).toBeUndefined();
    expect((await brain.answer("ราคาเท่าไหร่คะ", qaCtx)).text).toContain("299 บาท");
    expect((await brain.answer("ส่งกี่วัน", qaCtx)).text).toContain("1-2 วัน");
  });
  it("blocks a seller answer that breaks advertising rules", async () => {
    const bad = { ...withQa, qa: [{ question: "รักษาสิวได้ไหม", answer: "รักษาสิวหายขาด 100% ค่ะ" }] };
    const out = await brain.answer("รักษาสิวได้ไหม", { ...qaCtx, products: [bad] });
    expect(out.text).not.toContain("หายขาด");
  });
  it("hands a matched answer to the AI provider", async () => {
    let prompt = "";
    const llm: LlmProvider = { id: "fake", complete: async (m) => ((prompt = m.map((x) => x.content).join("\n")), "ใช้ได้ค่ะ ลองที่ท้องแขนก่อนนะคะ") };
    const out = await new HostBrain(llm).answer("ผิวแพ้ง่ายใช้ได้ไหม", qaCtx);
    expect(prompt).toContain("ร้านเขียนคำตอบของคำถามนี้ไว้แล้ว");
    expect(out.via).toBe("llm");
  });
});
