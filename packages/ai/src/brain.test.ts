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
