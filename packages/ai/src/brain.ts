import {
  checkClaims,
  deniesBeingAi,
  identityAnswer,
  isBlocked,
  isIdentityQuestion,
  type ClaimIssue,
} from "@tlai/compliance";
import { formatBaht, type FaqEntry, type HostCharacter, type Product, type Promotion } from "@tlai/shared";
import type { LlmProvider } from "./llm.js";
import { nextTalk, pitchLines, spaced, voiceOf, type Rng, type TalkKind } from "./variety.js";

export interface BrainContext {
  character: HostCharacter;
  products: Product[];
  promotions: Promotion[];
  currentProductId?: string;
  allowedPrices: number[];
  /** Shop-wide answers for shipping, payment, returns and similar. */
  faqs?: FaqEntry[];
  /** Lines spoken recently (newest last); the host avoids repeating them. */
  recent?: string[];
  /** Local hour 0-23 for greetings. */
  hour?: number;
}

const PRODUCT_FACT_QUESTION = /ราคา|เท่าไ|กี่บาท|โปร|ส่วนลด|ลดไหม|สต็อก|มีของ|ขนาด|ไซซ์|สี|วัสดุ|ส่วนผสม/;

/** Rewrites polite particles so shop-written answers match the host's voice (ค่ะ / ครับ). */
export function matchParticle(text: string, c: Pick<HostCharacter, "politeParticle">): string {
  return c.politeParticle === "ครับ"
    ? text.replace(/นะคะ/g, "นะครับ").replace(/ค่ะ/g, "ครับ")
    : text.replace(/นะครับ/g, "นะคะ").replace(/ครับ/g, "ค่ะ");
}

/** Best shop FAQ for a question: the entry with the most keyword hits (longer keywords count more). */
export function matchFaq(question: string, faqs: FaqEntry[] = []): FaqEntry | undefined {
  const q = question.toLowerCase();
  let best: { f: FaqEntry; score: number } | undefined;
  for (const f of faqs) {
    const score = f.keywords.reduce((s, k) => (k && q.includes(k.toLowerCase()) ? s + k.length : s), 0);
    if (score > 0 && (!best || score > best.score)) best = { f, score };
  }
  return best?.f;
}

export interface BrainOutput {
  text: string;
  /** "llm" when generated, "template" when the offline brain or a fallback produced it. */
  via: "llm" | "template" | "identity" | "fallback";
  issues: ClaimIssue[];
}

const end = (c: HostCharacter) => c.politeParticle;
const LINEUP_QUESTION = /ขายอะไร|มีอะไรบ้าง|มีสินค้าอะไร|มีของอะไร|มีกี่แบบ|มีกี่อย่าง/;
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
  private readonly rng: Rng;
  private lastKinds: TalkKind[] = [];

  constructor(private readonly llm?: LlmProvider, opts: { random?: Rng } = {}) {
    this.rng = opts.random ?? Math.random;
  }

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
    const faq = matchFaq(question, ctx.faqs);
    // Shop questions (shipping, payment, returns) are answered from the FAQ unless the viewer asks about product facts.
    if (faq && !PRODUCT_FACT_QUESTION.test(question)) {
      const text = matchParticle(faq.answer, c);
      return this.guard(text, "template", ctx, product, text);
    }
    const template = this.answerTemplate(question, product, ctx);
    if (!this.llm) return this.guard(template, "template", ctx, product, template);
    const facts = [
      ...(product ? [product] : ctx.products).map((p) => productFacts(p, ctx.promotions)),
      ...(ctx.faqs ?? []).map((f) => `ข้อมูลร้าน (${f.topic}): ${f.answer}`),
    ].join("\n---\n");
    const text = await this.llm
      .complete([
        { role: "system", content: systemPrompt(ctx) },
        { role: "user", content: `ข้อมูลสินค้า:\n${facts}\n\nคำถามจากผู้ชม: "${question}"\nตอบสั้น 1-3 ประโยค ตอบจากข้อมูลข้างบนเท่านั้น` },
      ], { temperature: 0.3, maxTokens: 200 })
      .catch(() => "");
    return this.guard(text || template, text ? "llm" : "fallback", ctx, product, template);
  }

  /**
   * One line of in-between talk. Rotates through kinds of content (facts, price,
   * promos, FAQ, welcomes, invitations to ask) and never repeats a recent line.
   */
  async freeTalk(product: Product | undefined, ctx: BrainContext): Promise<BrainOutput> {
    const recent = ctx.recent ?? [];
    const talk = nextTalk(
      { product, lineup: ctx.products.filter((p) => p.status === "ACTIVE"), promos: ctx.promotions, faqs: ctx.faqs ?? [], hour: ctx.hour ?? new Date().getHours() },
      voiceOf(ctx.character),
      recent,
      this.lastKinds,
      this.rng,
    );
    this.lastKinds = [...this.lastKinds, talk.kind].slice(-4);
    const template = matchParticle(talk.text, ctx.character);
    // With an LLM, about half the lines are freshly worded; the guard falls back to the template.
    if (!this.llm || this.rng() < 0.5) return this.guard(template, "template", ctx, product, template);
    const facts = (product ? [product] : ctx.products).map((p) => productFacts(p, ctx.promotions)).join("\n---\n");
    const text = await this.llm
      .complete([
        { role: "system", content: systemPrompt(ctx) },
        {
          role: "user",
          content: `ข้อมูลสินค้า:\n${facts}\n\nพูดคั่นรายการ 1 ประโยคสั้น ๆ แนวเดียวกับ: "${template}" แต่ใช้คำพูดใหม่ ห้ามซ้ำกับประโยคที่พูดไปแล้วเหล่านี้:\n${recent.slice(-12).join("\n")}`,
        },
      ], { temperature: 0.9, maxTokens: 120 })
      .catch(() => "");
    return this.guard(text || template, text ? "llm" : "fallback", ctx, product, template);
  }

  /**
   * Which product a question is about. Viewers rarely type the full name ("เซรั่ม" for
   * "เซรั่มวิตามินซี 30 ml"), so the longest shared run of characters with each name decides;
   * otherwise it is the product on screen.
   */
  findProduct(text: string, ctx: BrainContext): Product | undefined {
    const t = text.toLowerCase();
    const exact = ctx.products.find((p) => t.includes(p.name.toLowerCase()) || t.includes(p.sku.toLowerCase()));
    if (exact) return exact;
    let best: { p: Product; n: number } | undefined;
    for (const p of ctx.products) {
      const n = longestCommonRun(t, p.name.toLowerCase().replace(/\s+/g, ""));
      if (n >= 4 && (!best || n > best.n)) best = { p, n };
    }
    return best?.p ?? ctx.products.find((p) => p.id === ctx.currentProductId);
  }

  pitchTemplate(p: Product, ctx: BrainContext): string {
    return pitchLines(p, promosFor(p, ctx.promotions), voiceOf(ctx.character), this.rng).join("\n");
  }

  answerTemplate(q: string, p: Product | undefined, ctx: BrainContext): string {
    const c = ctx.character;
    const lineup = ctx.products.filter((x) => x.status === "ACTIVE").slice(0, 3);
    const lineupAnswer = () => `วันนี้มี ${lineup.map((x) => `${x.name} ราคา ${formatBaht(x.price)}`).join(" ")}${end(c)} สนใจตัวไหนพิมพ์ชื่อมาได้เลย${endQ(c)}`;
    if (lineup.length && LINEUP_QUESTION.test(q)) return lineupAnswer();
    if (!p) {
      // No product on screen and none named: answer about the shop as a whole where the facts allow.
      if (/โปร|ลด|ส่วนลด|แถม|ส่งฟรี|โค้ด/i.test(q)) {
        const promos = ctx.promotions.filter((x) => x.active);
        if (promos.length) return `ตอนนี้มีโปร ${spaced(promos.map((x) => `${x.title} ${x.detail}`).join(" และ "))}${end(c)}`;
      }
      if (lineup.length && /ราคา|เท่าไ|กี่บาท|สินค้า/i.test(q)) return lineupAnswer();
      return `ขอบคุณสำหรับคำถาม${end(c)} เรื่องนี้ขอให้ทีมงานตรวจสอบแล้วแจ้งในแชตอีกครั้ง${endQ(c)}`;
    }
    for (const [k, v] of Object.entries(p.specs)) {
      if (q.includes(k)) return `${k}ของ${p.name}${/[a-z0-9]$/i.test(p.name) ? " " : ""}คือ ${v}${/[a-z0-9]$/i.test(v) ? " " : ""}${end(c)}`;
    }
    if (/ราคา|เท่าไ|กี่บาท|price/i.test(q)) {
      return `${p.name} ราคา ${formatBaht(p.price)}${p.compareAtPrice ? ` จากราคาปกติ ${formatBaht(p.compareAtPrice)}` : ""}${end(c)}`;
    }
    if (/โปร|ลด|ส่วนลด|แถม|ส่งฟรี/i.test(q)) {
      const promos = promosFor(p, ctx.promotions);
      return promos.length
        ? `ตอนนี้มีโปร ${spaced(promos.map((x) => `${x.title} ${x.detail}`).join(" และ "))}${end(c)}`
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

/** Length of the longest substring shared by a and b (spaces in a ignored). */
function longestCommonRun(a: string, b: string): number {
  const x = a.replace(/\s+/g, "");
  let best = 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = x[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j]! > best) best = prev[j]!;
      diag = tmp;
    }
  }
  return best;
}
