import type { Product } from "@tlai/shared";

export type Severity = "block" | "warn";

export interface ClaimIssue {
  code: string;
  severity: Severity;
  message: string;
  match?: string;
}

interface Rule {
  code: string;
  severity: Severity;
  pattern: RegExp;
  message: string;
}

/**
 * Advertising claims a host must not make on its own authority (Thai consumer
 * protection / FDA advertising rules and TikTok Shop content policy themes).
 */
const RULES: Rule[] = [
  { code: "GUARANTEE", severity: "block", pattern: /การันตี|รับประกันผล|100\s*%\s*(ได้ผล|หาย|ปลอดภัย)|ได้ผลแน่นอน|guaranteed? (results?|to work)/i, message: "การันตีผลลัพธ์ที่พิสูจน์ไม่ได้" },
  { code: "MEDICAL_CURE", severity: "block", pattern: /รักษา(โรค|หาย|ให้หาย)|หายขาด|ป้องกันโรค|ต้านมะเร็ง|รักษามะเร็ง|ลดเบาหวาน|cures?\b|treats? (cancer|diabetes|disease)/i, message: "อ้างสรรพคุณทางการแพทย์" },
  { code: "WEIGHT_LOSS", severity: "block", pattern: /ลด(น้ำหนัก|ได้)\s*\d+\s*(กิโล|kg)|ผอมใน\s*\d+\s*วัน|lose \d+\s*(kg|lbs)/i, message: "อ้างผลลดน้ำหนักเป็นตัวเลข" },
  { code: "WHITENING_FAST", severity: "block", pattern: /ขาวใน\s*\d+\s*(วัน|ชั่วโมง)|ขาวทันที|ขาวถาวร/i, message: "อ้างผลผิวขาวเกินจริง" },
  { code: "NO_SIDE_EFFECT", severity: "block", pattern: /ไม่มีผลข้างเคียง(เลย)?|ปลอดภัย\s*100|no side effects?/i, message: "อ้างว่าปลอดภัยสมบูรณ์" },
  { code: "UNVERIFIED_RANK", severity: "warn", pattern: /อันดับ\s*1|ขายดีที่สุดใน(ประเทศ|โลก)|best ?seller in|#1\b/i, message: "อ้างอันดับ/ยอดขายที่ต้องมีหลักฐาน" },
  { code: "FAKE_AUTHORITY", severity: "block", pattern: /แพทย์(แนะนำ|รับรอง)|หมอ(แนะนำ|รับรอง)|doctor[- ]recommended/i, message: "อ้างการรับรองจากบุคลากรทางการแพทย์" },
  { code: "PRESSURE", severity: "warn", pattern: /รีบ(ซื้อ|กด)ด่วน|ไม่ซื้อ(ตอนนี้)?จะเสียใจ|หมดแล้วหมดเลย|last chance ever/i, message: "เร่งเร้าการซื้อเกินควร" },
  { code: "FAKE_SOCIAL_PROOF", severity: "block", pattern: /คนดู(เป็น)?(พัน|หมื่น|แสน)|มีคนสั่ง(ไป)?แล้ว\s*\d+|\d+\s*คน(กำลัง)?ดูอยู่/i, message: "อ้างจำนวนผู้ชม/ยอดสั่งที่ระบบไม่ได้ยืนยัน" },
];

const PRICE_IN_TEXT = /(\d[\d,]*(?:\.\d+)?)\s*(บาท|฿|baht)/gi;
const LOW_STOCK_CLAIM = /เหลือ(?:อีก)?\s*(\d+)\s*(?:ชิ้น|pieces?)|ชิ้นสุดท้าย|last (?:one|piece)/i;

export interface ClaimContext {
  product?: Product;
  /** Every price the host is allowed to say: product prices and promo-detail prices. */
  allowedPrices?: number[];
}

export function checkClaims(text: string, ctx: ClaimContext = {}): ClaimIssue[] {
  const issues: ClaimIssue[] = [];
  for (const r of RULES) {
    const m = text.match(r.pattern);
    if (m) issues.push({ code: r.code, severity: r.severity, message: r.message, match: m[0] });
  }

  if (ctx.allowedPrices && ctx.allowedPrices.length) {
    for (const m of text.matchAll(PRICE_IN_TEXT)) {
      const n = Number(m[1]!.replace(/,/g, ""));
      if (!ctx.allowedPrices.some((p) => Math.abs(p - n) < 0.005)) {
        issues.push({ code: "PRICE_MISMATCH", severity: "block", message: `ราคา ${m[1]} บาท ไม่ตรงกับข้อมูลสินค้า`, match: m[0] });
      }
    }
  }

  const p = ctx.product;
  if (p) {
    if (p.stock === 0 && /(มีของ|พร้อมส่ง|in stock)/i.test(text)) {
      issues.push({ code: "OUT_OF_STOCK", severity: "block", message: "สินค้าหมดสต็อกแต่ข้อความบอกว่ามีของ" });
    }
    const low = text.match(LOW_STOCK_CLAIM);
    if (low) {
      const claimed = low[1] ? Number(low[1]) : 1;
      if (claimed < p.stock) {
        issues.push({ code: "FAKE_SCARCITY", severity: "block", message: `อ้างว่าเหลือ ${claimed} ชิ้น แต่สต็อกจริง ${p.stock}`, match: low[0] });
      }
    }
    if (p.compareAtPrice === undefined && /(ลดจาก|จากปกติ|ราคาเต็ม|ลด\s*\d+\s*%)/.test(text)) {
      issues.push({ code: "UNBACKED_DISCOUNT", severity: "block", message: "อ้างส่วนลดโดยไม่มีราคาเดิมอ้างอิง" });
    }
  }
  return issues;
}

export function isBlocked(issues: ClaimIssue[]): boolean {
  return issues.some((i) => i.severity === "block");
}
