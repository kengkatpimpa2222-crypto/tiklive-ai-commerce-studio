import { describe, expect, it } from "vitest";
import type { HostCharacter, LiveSession, Product, Promotion } from "@tlai/shared";
import { annotate, HostBrain, summarizeLive, type LlmProvider } from "./index.js";

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

describe("HostBrain (LLM guarded)", () => {
  it("replaces non-compliant LLM output with the safe template", async () => {
    const bad: LlmProvider = { id: "bad", complete: async () => "หนูเป็นคนจริงนะคะ การันตีหน้าใสใน 3 วัน ราคา 99 บาท" };
    const out = await new HostBrain(bad).pitch(product, ctx);
    expect(out.via).toBe("fallback");
    expect(out.text).not.toContain("99 บาท ");
    expect(out.text).toContain("299 บาท");
    expect(out.issues.length).toBeGreaterThan(0);
  });
  it("uses compliant LLM output", async () => {
    const good: LlmProvider = { id: "good", complete: async () => "เซรั่มวิตามินซี ราคา 299 บาทค่ะ" };
    const out = await new HostBrain(good).answer("ราคาเท่าไหร่", ctx);
    expect(out.via).toBe("llm");
  });
});

describe("annotate", () => {
  it("adds emotion, gesture and pauses per sentence", () => {
    const segs = annotate("สวัสดีค่ะ ทุกคน วันนี้มีโปรส่งฟรีค่ะ ขอบคุณที่แวะมานะคะ", "script");
    expect(segs.length).toBeGreaterThanOrEqual(3);
    expect(segs[0]!.gesture).toBe("wave");
    expect(segs.some((s) => s.emotion === "excited")).toBe(true);
    expect(segs[segs.length - 1]!.pauseAfterMs).toBe(900);
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
