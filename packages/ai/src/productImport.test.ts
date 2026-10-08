import { describe, expect, it } from "vitest";
import { basicDraft, importProduct, parsePageMeta, type LlmProvider } from "./index.js";

const PAGE = `<html><head><title>ร้านเรา</title>
<meta property="og:title" content="กระบอกน้ำเก็บอุณหภูมิ 750 ml">
<meta property="og:image" content="/img/bottle.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"กระบอกน้ำสแตนเลส 750 ml","sku":"BT-750",
"description":"เก็บเย็น 24 ชม. เก็บร้อน 12 ชม. ฝาล็อกกันหก","brand":{"@type":"Brand","name":"CoolMate"},
"offers":{"@type":"Offer","price":"390.00","priceCurrency":"THB"},"additionalProperty":[{"name":"วัสดุ","value":"สแตนเลส 304"}]}</script>
</head><body>...</body></html>`;

describe("product import", () => {
  it("reads a page's preview metadata and schema.org Product data", () => {
    const m = parsePageMeta(PAGE, "https://shop.example.com/p/1");
    expect(m).toMatchObject({ title: "กระบอกน้ำสแตนเลส 750 ml", price: 390, sku: "BT-750", image: "https://shop.example.com/img/bottle.jpg" });
    expect(m.specs).toMatchObject({ วัสดุ: "สแตนเลส 304", แบรนด์: "CoolMate" });
  });

  it("drafts a product from pasted text without an AI", () => {
    const d = basicDraft("เซรั่มวิตามินซี 30 ml\nราคาปกติ 450 บาท ลดเหลือ ฿299\n✅ เนื้อบางเบา ซึมไว\n✅ ไม่มีน้ำหอม\nขนาด: 30 ml\nใช้ได้ทุกวัน");
    expect(d).toMatchObject({ name: "เซรั่มวิตามินซี 30 ml", price: 299, compareAtPrice: 450, highlights: ["เนื้อบางเบา ซึมไว", "ไม่มีน้ำหอม"], specs: { ขนาด: "30 ml" } });
  });

  it("uses the AI for selling points but never trusts its prices or risky claims", async () => {
    const llm: LlmProvider = {
      id: "fake",
      complete: async () =>
        'ได้เลย {"name":"เซรั่มวิตามินซี","price":199,"compareAtPrice":450,"category":"ความงาม","description":"เซรั่มบำรุงผิว","highlights":["เนื้อบางเบาซึมไว ทาแล้วไม่เหนอะหนะเลย","การันตีหน้าใสใน 7 วัน"],"specs":{"ขนาด":"30 ml"}}',
    };
    const r = await importProduct("เซรั่มวิตามินซี 30 ml ราคา 299 บาท (ปกติ 450 บาท) เนื้อบางเบา ซึมไว", llm);
    expect(r.via).toBe("llm");
    expect(r.draft.price).toBe(299); // 199 is not in the source
    expect(r.draft.compareAtPrice).toBe(450);
    expect(r.draft.highlights).toEqual(["เนื้อบางเบาซึมไว ทาแล้วไม่เหนอะหนะเลย"]);
    expect(r.warnings.join(" ")).toContain("การันตี");
  });
});
