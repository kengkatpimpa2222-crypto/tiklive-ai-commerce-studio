import {
  checkClaims,
  deniesBeingAi,
  identityAnswer,
  isBlocked,
  isIdentityQuestion,
  type ClaimIssue,
} from "@tlai/compliance";
import { formatBaht, type HostCharacter, type Product, type Promotion } from "@tlai/shared";
import type { LlmProvider } from "./llm.js";

export interface BrainContext {
  character: HostCharacter;
  products: Product[];
  promotions: Promotion[];
  currentProductId?: string;
  allowedPrices: number[];
}

export interface BrainOutput {
  text: string;
  /** "llm" when generated, "template" when the offline brain or a fallback produced it. */
  via: "llm" | "template" | "identity" | "fallback";
  issues: ClaimIssue[];
}

const end = (c: HostCharacter) => c.politeParticle;
const endQ = (c: HostCharacter) => (c.politeParticle === "ค่ะ" ? "นะคะ" : "นะครับ");

function promosFor(p: Product, promos: Promotion[]): Promotion[] {
  return promos.filter((x) => x.active && (x.productIds.length === 0 || x.productIds.includes(p.id)));
}

/** Facts the host may state about a product, as a compact block for prompts and templates. */
export function productFacts(p: Product, promos: Promotion[]): string {
  const lines = [
    `ชื่อ: ${p.name}`,
    `ราคา: ${formatBaht(p.price)}${p.compareAtPrice ? ` (ราคาปกติ ${formatBaht(p.compareAtPrice)})` : ""}`,
    `สต็อก: ${p.stock > 0 ? "มีสินค้า" : "สินค้าหมด"}`,
    p.description && `รายละเอียด: ${p.description}`,
    p.highlights.length > 0 && `จุดเด่น: ${p.highlights.join(" / ")}`,
    ...Object.entries(p.specs).map(([k, v]) => `${k}: ${v}`),
    ...promosFor(p, promos).map((x) => `โปรโมชั่น: ${x.title} - ${x.detail}`),
  ];
  return lines.filter(Boolean).join("\n");
}

function systemPrompt(ctx: BrainContext): string {
  const c = ctx.character;
  return [
    `คุณคือ "${c.name}" ตัวละคร AI ที่เป็นพิธีกรขายของใน TikTok LIVE ${c.persona}`,
    `พูดภาษาไทยเป็นกันเอง สุภาพ ลงท้ายด้วย "${c.politeParticle}" ประโยคสั้น เหมาะกับการพูดออกเสียง ไม่ใช้อีโมจิหรือสัญลักษณ์`,
    "กฎที่ห้ามละเมิด:",
    "- คุณเป็น AI ห้ามอ้างว่าเป็นคนจริง ถ้าถูกถามให้ยอมรับตรง ๆ",
    "- พูดเฉพาะข้อมูลสินค้าที่ให้ไว้ ถ้าไม่มีข้อมูล ให้บอกว่าจะให้ทีมงานตรวจสอบ ห้ามเดา",
    "- ราคาและโปรโมชั่นต้องตรงตามข้อมูลเท่านั้น",
    "- ห้ามการันตีผลลัพธ์ ห้ามอ้างสรรพคุณทางการแพทย์ ห้ามอ้างจำนวนผู้ชมหรือยอดขาย ห้ามสร้างความเร่งรีบเกินจริง",
    "- ห้ามชวนให้กดไลก์/แชร์/ติดตามแลกของรางวัล หรือเชิญชวนให้คอมเมนต์ซ้ำ ๆ",
  ].join("\n");
}

/**
 * The host's "brain": turns catalog facts into speech and answers viewer
 * questions. Uses an LLM when configured; otherwise deterministic templates.
 * Every output is compliance-checked and falls back to a safe template.
 */
export class HostBrain {
  constructor(private readonly llm?: LlmProvider) {}

  async pitch(product: Product, ctx: BrainContext): Promise<BrainOutput> {
    const template = this.pitchTemplate(product, ctx);
    if (!this.llm) return this.guard(template, "template", ctx, product, template);
    const text = await this.llm
      .complete([
        { role: "system", content: systemPrompt(ctx) },
        { role: "user", content: `แนะนำสินค้านี้ในไลฟ์ ความยาว 4-6 ประโยค จบด้วยการชวนกดตะกร้าอย่างสุภาพ\n${productFacts(product, ctx.promotions)}` },
      ])
      .catch(() => "");
    return this.guard(text || template, text ? "llm" : "fallback", ctx, product, template);
  }

  promo(promo: Promotion, ctx: BrainContext): BrainOutput {
    const c = ctx.character;
    const text = `โปรโมชั่นตอนนี้${end(c)} ${promo.title} ${promo.detail} ${promo.endsAt ? `ถึงวันที่ ${new Date(promo.endsAt).toLocaleDateString("th-TH")} ` : ""}รายละเอียดเงื่อนไขดูได้ที่ตะกร้าสินค้าเลย${endQ(c)}`;
    return this.guardSync(text, "template", ctx, undefined, `ดูโปรโมชั่นได้ที่ตะกร้าสินค้าเลย${endQ(c)}`);
  }

  async answer(question: string, ctx: BrainContext): Promise<BrainOutput> {
    const c = ctx.character;
    if (isIdentityQuestion(question)) return { text: identityAnswer(c), via: "identity", issues: [] };
    const product = this.findProduct(question, ctx);
    const template = this.answerTemplate(question, product, ctx);
    if (!this.llm) return this.guard(template, "template", ctx, product, template);
    const facts = (product ? [product] : ctx.products).map((p) => productFacts(p, ctx.promotions)).join("\n---\n");
    const text = await this.llm
      .complete([
        { role: "system", content: systemPrompt(ctx) },
        { role: "user", content: `ข้อมูลสินค้า:\n${facts}\n\nคำถามจากผู้ชม: "${question}"\nตอบสั้น 1-3 ประโยค ตอบจากข้อมูลข้างบนเท่านั้น` },
      ], { temperature: 0.3, maxTokens: 200 })
      .catch(() => "");
    return this.guard(text || template, text ? "llm" : "fallback", ctx, product, template);
  }

  freeTalk(product: Product | undefined, ctx: BrainContext, turn: number): BrainOutput {
    const c = ctx.character;
    const lines = product
      ? [
          `ใครมีคำถามเกี่ยวกับ${product.name} พิมพ์ถามได้เลย${endQ(c)}`,
          product.highlights[turn % Math.max(1, product.highlights.length)]
            ? `ย้ำอีกนิด${end(c)} ${product.name} ${product.highlights[turn % product.highlights.length]}`
            : `${product.name} ราคา ${formatBaht(product.price)}${end(c)}`,
          `${product.name} ตอนนี้ราคา ${formatBaht(product.price)} กดดูที่ตะกร้าได้เลย${end(c)}`,
        ]
      : [`ใครสนใจสินค้าตัวไหน พิมพ์ชื่อสินค้ามาได้เลย${endQ(c)}`, `ยินดีต้อนรับทุกคนที่เพิ่งเข้ามา${end(c)} ${c.name}เป็นผู้ช่วย AI ของร้าน${end(c)}`];
    const text = lines[turn % lines.length]!;
    return this.guardSync(text, "template", ctx, product, text);
  }

  findProduct(text: string, ctx: BrainContext): Product | undefined {
    const t = text.toLowerCase();
    const named = ctx.products.find((p) => t.includes(p.name.toLowerCase()) || t.includes(p.sku.toLowerCase()));
    return named ?? ctx.products.find((p) => p.id === ctx.currentProductId);
  }

  pitchTemplate(p: Product, ctx: BrainContext): string {
    const c = ctx.character;
    const promos = promosFor(p, ctx.promotions);
    const parts = [
      `ตัวต่อไปที่อยากแนะนำ${end(c)} ${p.name}`,
      p.description,
      ...p.highlights.slice(0, 3).map((h, i) => (i === 0 ? `จุดเด่นคือ ${h}` : h)),
      p.compareAtPrice
        ? `ราคาปกติ ${formatBaht(p.compareAtPrice)} ในไลฟ์นี้ ${formatBaht(p.price)}${end(c)}`
        : `ราคา ${formatBaht(p.price)}${end(c)}`,
      ...promos.map((x, i) => `${i === 0 ? "แล้วก็มีโปร" : "อีกโปรคือ"} ${x.title} ${x.detail}`),
      p.stock > 0 ? `สนใจกดที่ตะกร้าสินค้าได้เลย${end(c)}` : `ตอนนี้สินค้าหมดชั่วคราว${end(c)} กดติดตามร้านไว้เพื่อดูรอบถัดไปได้${end(c)}`,
    ];
    return parts.filter(Boolean).join("\n");
  }

  answerTemplate(q: string, p: Product | undefined, ctx: BrainContext): string {
    const c = ctx.character;
    if (!p) return `ขอบคุณสำหรับคำถาม${end(c)} เรื่องนี้ขอให้ทีมงานตรวจสอบแล้วแจ้งในแชตอีกครั้ง${endQ(c)}`;
    for (const [k, v] of Object.entries(p.specs)) {
      if (q.includes(k)) return `${p.name} ${k} ${v}${end(c)}`;
    }
    if (/ราคา|เท่าไ|กี่บาท|price/i.test(q)) {
      return `${p.name} ราคา ${formatBaht(p.price)}${p.compareAtPrice ? ` จากราคาปกติ ${formatBaht(p.compareAtPrice)}` : ""}${end(c)}`;
    }
    if (/โปร|ลด|ส่วนลด|แถม|ส่งฟรี/i.test(q)) {
      const promos = promosFor(p, ctx.promotions);
      return promos.length
        ? `ตอนนี้มีโปร ${promos.map((x) => `${x.title} ${x.detail}`).join(" และ ")}${end(c)}`
        : `สำหรับ${p.name} ตอนนี้ยังไม่มีโปรเพิ่มเติม${end(c)} ราคา ${formatBaht(p.price)}${end(c)}`;
    }
    if (/มีของ|หมด|สต็อก|เหลือ|พร้อมส่ง/i.test(q)) {
      return p.stock > 0 ? `${p.name} มีสินค้า${end(c)} กดสั่งที่ตะกร้าได้เลย${end(c)}` : `${p.name} หมดชั่วคราว${end(c)} ขออภัย${endQ(c)}`;
    }
    const hit = p.highlights.find((h) => h.split(/\s+/).some((w) => w.length > 2 && q.includes(w)));
    if (hit) return `${p.name} ${hit}${end(c)}`;
    return `ขอบคุณที่ถาม${end(c)} ข้อมูลส่วนนี้ของ${p.name} ${c.name}ยังไม่มี ขอให้ทีมงานตอบในแชตอีกครั้ง${endQ(c)}`;
  }

  private async guard(text: string, via: BrainOutput["via"], ctx: BrainContext, product: Product | undefined, fallback: string): Promise<BrainOutput> {
    return this.guardSync(text, via, ctx, product, fallback);
  }

  private guardSync(text: string, via: BrainOutput["via"], ctx: BrainContext, product: Product | undefined, fallback: string): BrainOutput {
    const clean = text.replace(/[*_#`>]/g, "").replace(/\p{Extended_Pictographic}/gu, "").trim();
    const issues = checkClaims(clean, { product, allowedPrices: ctx.allowedPrices });
    if (!isBlocked(issues) && !deniesBeingAi(clean)) return { text: clean, via, issues };
    const fbIssues = checkClaims(fallback, { product, allowedPrices: ctx.allowedPrices });
    if (!isBlocked(fbIssues) && !deniesBeingAi(fallback)) return { text: fallback, via: "fallback", issues };
    return { text: `ขอให้ทีมงานตรวจสอบข้อมูลก่อน${endQ(ctx.character)}`, via: "fallback", issues };
  }
}
