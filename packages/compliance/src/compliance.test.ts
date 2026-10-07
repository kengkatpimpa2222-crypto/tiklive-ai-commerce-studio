import { describe, expect, it } from "vitest";
import type { Product } from "@tlai/shared";
import { assertCapabilities, checkClaims, deniesBeingAi, isBlocked, isIdentityQuestion, ProhibitedCapabilityError } from "./index.js";

const product: Product = {
  id: "p1", sku: "SER-01", name: "เซรั่มวิตามินซี", description: "เซรั่ม 30 ml", price: 299, compareAtPrice: 450,
  stock: 40, category: "ความงาม", highlights: ["เนื้อบางเบา"], specs: { ขนาด: "30 ml" }, status: "ACTIVE",
};

describe("claims", () => {
  it("blocks guarantees and medical claims", () => {
    expect(isBlocked(checkClaims("ใช้แล้วการันตีหน้าใส"))).toBe(true);
    expect(isBlocked(checkClaims("ช่วยรักษาโรคผิวหนังให้หายขาด"))).toBe(true);
  });
  it("blocks prices that are not the product price", () => {
    expect(isBlocked(checkClaims("วันนี้เหลือ 199 บาท", { allowedPrices: [299, 450] }))).toBe(true);
    expect(isBlocked(checkClaims("วันนี้ 299 บาท จากปกติ 450 บาท", { allowedPrices: [299, 450], product }))).toBe(false);
  });
  it("blocks fake scarcity and fake viewer counts", () => {
    expect(checkClaims("เหลือ 2 ชิ้นสุดท้าย", { product }).map((i) => i.code)).toContain("FAKE_SCARCITY");
    expect(isBlocked(checkClaims("ตอนนี้มีคนดูเป็นพันเลย"))).toBe(true);
  });
  it("allows ordinary factual selling", () => {
    expect(checkClaims("เนื้อบางเบา ซึมไว ขนาด 30 ml ราคา 299 บาท", { product, allowedPrices: [299, 450] })).toEqual([]);
  });
});

describe("disclosure", () => {
  it("detects identity questions", () => {
    expect(isIdentityQuestion("เป็นคนจริงไหมคะ")).toBe(true);
    expect(isIdentityQuestion("are you real?")).toBe(true);
    expect(isIdentityQuestion("ส่งฟรีไหม")).toBe(false);
  });
  it("detects text that claims to be human", () => {
    expect(deniesBeingAi("หนูเป็นคนจริงนะคะ")).toBe(true);
    expect(deniesBeingAi("ไม่ใช่ AI นะครับ")).toBe(true);
    expect(deniesBeingAi("เป็นตัวละคร AI ค่ะ")).toBe(false);
  });
});

describe("capability policy", () => {
  it("rejects prohibited capabilities", () => {
    expect(() => assertCapabilities("x", ["tiktok_scraping"])).toThrow(ProhibitedCapabilityError);
    expect(() => assertCapabilities("x", ["view_botting"])).toThrow(ProhibitedCapabilityError);
    expect(() => assertCapabilities("x", ["manual_viewer_input", "official_tiktok_api"])).not.toThrow();
  });
});
