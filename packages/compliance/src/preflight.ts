import type { HostCharacter, LiveScript, LiveSession, Product, Promotion } from "@tlai/shared";
import { checkClaims, isBlocked, type ClaimIssue } from "./claims.js";
import { deniesBeingAi } from "./disclosure.js";

export interface PreflightItem {
  code: string;
  ok: boolean;
  severity: "block" | "warn";
  message: string;
}

export interface PreflightInput {
  session: LiveSession;
  character: HostCharacter | undefined;
  products: Product[];
  promotions: Promotion[];
  script?: LiveScript;
  /** Shop FAQ answers the host may read out. */
  faqs?: { id: string; topic: string; answer: string }[];
}

export function allowedPricesFor(products: Product[], promotions: Promotion[]): number[] {
  const prices = products.flatMap((p) => [p.price, ...(p.compareAtPrice !== undefined ? [p.compareAtPrice] : [])]);
  for (const promo of promotions) {
    for (const m of promo.detail.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(บาท|฿)/g)) prices.push(Number(m[1]!.replace(/,/g, "")));
  }
  return prices;
}

/** Runs before a LIVE can start. Any failed "block" item prevents starting. */
export function runPreflight(input: PreflightInput): { ok: boolean; items: PreflightItem[] } {
  const items: PreflightItem[] = [];
  const add = (code: string, ok: boolean, message: string, severity: "block" | "warn" = "block") =>
    items.push({ code, ok, severity, message });

  const c = input.character;
  add("CHARACTER", !!c, c ? `ตัวละคร: ${c.name}` : "ยังไม่ได้เลือกตัวละคร");
  add(
    "DISCLOSURE_LABEL",
    !!c && c.disclosureLabel.trim().length >= 4 && /ai|เอไอ|virtual|เสมือน/i.test(c.disclosureLabel),
    "ป้ายแจ้งว่าเป็น AI ต้องมีคำว่า AI/Virtual และแสดงบนจอตลอดเวลา",
  );
  add("PRODUCTS", input.products.length > 0, input.products.length ? `สินค้า ${input.products.length} รายการ` : "ยังไม่ได้เลือกสินค้า");

  for (const p of input.products) {
    add(`PRODUCT_PRICE_${p.sku}`, p.price > 0, `${p.name}: ต้องมีราคาที่ถูกต้อง`);
    if (p.compareAtPrice !== undefined) {
      add(`PRODUCT_COMPARE_${p.sku}`, p.compareAtPrice > p.price, `${p.name}: ราคาเดิมต้องสูงกว่าราคาขาย`);
    }
    add(`PRODUCT_FACTS_${p.sku}`, p.highlights.length > 0 || p.description.length > 0, `${p.name}: ควรมีจุดเด่นที่ตรวจสอบแล้ว`, "warn");
    const issues = [...p.highlights, p.description].flatMap((t) => checkClaims(t, { product: p }));
    pushClaimItems(items, `PRODUCT_CLAIMS_${p.sku}`, p.name, issues);
  }

  const allowed = allowedPricesFor(input.products, input.promotions);
  for (const promo of input.promotions) {
    pushClaimItems(items, `PROMO_${promo.id}`, `โปรโมชั่น "${promo.title}"`, checkClaims(promo.detail));
  }

  for (const f of input.faqs ?? []) {
    pushClaimItems(items, `FAQ_${f.id}`, `คำตอบร้าน "${f.topic}"`, checkClaims(f.answer, { allowedPrices: allowed }));
    if (deniesBeingAi(f.answer)) add(`FAQ_${f.id}_IDENTITY`, false, `คำตอบร้าน "${f.topic}": ห้ามอ้างว่าเป็นคนจริง`);
  }

  if (input.script) {
    input.script.steps.forEach((s, i) => {
      if (s.kind !== "say") return;
      const issues = checkClaims(s.text, { allowedPrices: allowed });
      pushClaimItems(items, `SCRIPT_${i + 1}`, `สคริปต์บรรทัด ${i + 1}`, issues);
      if (deniesBeingAi(s.text)) add(`SCRIPT_${i + 1}_IDENTITY`, false, `สคริปต์บรรทัด ${i + 1}: ห้ามอ้างว่าเป็นคนจริง`);
    });
  }

  const ok = items.every((i) => i.ok || i.severity === "warn");
  return { ok, items };
}

function pushClaimItems(items: PreflightItem[], code: string, label: string, issues: ClaimIssue[]) {
  if (issues.length === 0) {
    items.push({ code, ok: true, severity: "block", message: `${label}: ผ่าน` });
    return;
  }
  for (const i of issues) {
    items.push({ code: `${code}_${i.code}`, ok: false, severity: i.severity, message: `${label}: ${i.message}${i.match ? ` ("${i.match}")` : ""}` });
  }
  void isBlocked;
}
