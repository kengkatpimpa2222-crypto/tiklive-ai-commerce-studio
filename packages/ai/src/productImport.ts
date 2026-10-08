import { checkClaims, isBlocked } from "@tlai/compliance";
import type { LlmProvider } from "./llm.js";

/** A product filled in from a link or pasted text, for the seller to check before saving. */
export interface ProductDraft {
  name: string;
  sku: string;
  description: string;
  price?: number;
  compareAtPrice?: number;
  category: string;
  imageUrl?: string;
  /** Selling points the host can say, each backed by the source text. */
  highlights: string[];
  specs: Record<string, string>;
}

export interface ImportResult {
  draft: ProductDraft;
  via: "llm" | "basic";
  /** Things the seller must check (dropped claims, missing price, ...). */
  warnings: string[];
}

/** What a product page publishes for link previews: Open Graph and schema.org Product data. */
export interface PageMeta {
  title?: string;
  description?: string;
  image?: string;
  price?: number;
  currency?: string;
  sku?: string;
  brand?: string;
  specs: Record<string, string>;
}

/**
 * TikTok does not allow automated reading of its pages, so TikTok links are never fetched;
 * the seller copies the text from Seller Center instead.
 */
export const BLOCKED_IMPORT_HOSTS = /(^|\.)(tiktok\.com|tiktokv\.com|tiktokshop\.com|tiktokglobalshop\.com|tokopedia\.com)$/i;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

const toNumber = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Reads only the metadata a page publishes for previews (no page text, no scripts run). */
export function parsePageMeta(html: string, pageUrl: string): PageMeta {
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content !== undefined && !(key in meta)) meta[key] = decode(content);
  }
  const out: PageMeta = {
    title: meta["og:title"] ?? meta["twitter:title"] ?? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") ?? undefined,
    description: meta["og:description"] ?? meta["description"] ?? meta["twitter:description"],
    image: meta["og:image"] ?? meta["twitter:image"],
    price: toNumber(meta["product:price:amount"] ?? meta["og:price:amount"] ?? meta["price"]),
    currency: meta["product:price:currency"] ?? meta["og:price:currency"] ?? meta["pricecurrency"],
    specs: {},
  };
  // schema.org Product in JSON-LD wins where present.
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    const nodes: unknown[] = [];
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") {
        nodes.push(x);
        const g = (x as Record<string, unknown>)["@graph"];
        if (g) walk(g);
      }
    };
    walk(data);
    const product = nodes.find((n) => {
      const t = (n as Record<string, unknown>)["@type"];
      return t === "Product" || (Array.isArray(t) && t.includes("Product"));
    }) as Record<string, unknown> | undefined;
    if (!product) continue;
    const str = (v: unknown) => (typeof v === "string" ? decode(v) : undefined);
    out.title = str(product.name) ?? out.title;
    out.description = str(product.description) ?? out.description;
    const img = Array.isArray(product.image) ? product.image[0] : product.image;
    out.image = str(img) ?? str((img as Record<string, unknown> | undefined)?.url) ?? out.image;
    out.sku = str(product.sku) ?? str(product.mpn);
    const brand = product.brand as Record<string, unknown> | string | undefined;
    out.brand = typeof brand === "string" ? brand : str(brand?.name);
    const offers = (Array.isArray(product.offers) ? product.offers[0] : product.offers) as Record<string, unknown> | undefined;
    out.price = toNumber(offers?.price ?? offers?.lowPrice) ?? out.price;
    out.currency = str(offers?.priceCurrency) ?? out.currency;
    const props = Array.isArray(product.additionalProperty) ? product.additionalProperty : [];
    for (const p of props as Record<string, unknown>[]) {
      const k = str(p.name);
      const v = str(p.value) ?? (typeof p.value === "number" ? String(p.value) : undefined);
      if (k && v) out.specs[k] = v;
    }
    if (out.brand) out.specs["แบรนด์"] ??= out.brand;
    break;
  }
  if (out.image) {
    try {
      out.image = new URL(out.image, pageUrl).href;
    } catch {
      out.image = undefined;
    }
  }
  return out;
}

/** The page's metadata as plain text, the same shape as text a seller pastes. */
export function metaToText(m: PageMeta): string {
  return [
    m.title,
    m.price !== undefined ? `ราคา ${m.price}${m.currency && m.currency !== "THB" ? ` ${m.currency}` : " บาท"}` : "",
    m.description,
    ...Object.entries(m.specs).map(([k, v]) => `${k}: ${v}`),
  ]
    .filter(Boolean)
    .join("\n");
}

const PRICE = /(?:฿\s*([\d,]+(?:\.\d+)?))|(?:([\d,]+(?:\.\d+)?)\s*(?:บาท|฿|THB))/gi;
const BULLET = /^\s*(?:[-•*·▪●✓✔✅☑️⭐️★🔥💯👉➤>]|\d+[.)])\s*/u;

/** Prices written in the text, in the order they appear. */
export function pricesIn(text: string): number[] {
  return [...text.matchAll(PRICE)].map((m) => Number((m[1] ?? m[2])!.replace(/,/g, ""))).filter((n) => n > 0);
}

/** Works without an AI provider: name from the first line, prices, "key: value" specs, bullets as highlights. */
export function basicDraft(text: string): ProductDraft {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const name = (lines[0] ?? "").replace(BULLET, "").slice(0, 120);
  const prices = pricesIn(text);
  const specs: Record<string, string> = {};
  const highlights: string[] = [];
  const desc: string[] = [];
  for (const l of lines.slice(1)) {
    const kv = /^([^:：]{1,24})[:：]\s*(.+)$/.exec(l.replace(BULLET, ""));
    if (kv && !/https?$/i.test(kv[1]!) && !PRICE.test(l)) specs[kv[1]!.trim()] = kv[2]!.trim();
    else if (BULLET.test(l)) highlights.push(l.replace(BULLET, "").trim());
    else if (!/^ราคา|^\s*฿/.test(l)) desc.push(l);
    PRICE.lastIndex = 0;
  }
  const sorted = [...new Set(prices)].sort((a, b) => a - b);
  return {
    name,
    sku: "",
    description: desc.join(" ").slice(0, 600),
    price: sorted[0],
    compareAtPrice: sorted.length > 1 ? sorted[sorted.length - 1] : undefined,
    category: "ทั่วไป",
    highlights: highlights.slice(0, 8),
    specs,
  };
}

const PROMPT = `คุณช่วยร้านค้าเตรียมข้อมูลสินค้าสำหรับไลฟ์ขายของ จากข้อความด้านล่าง ตอบเป็น JSON อย่างเดียว รูปแบบ:
{"name": "...", "price": 0, "compareAtPrice": 0, "category": "...", "description": "...", "highlights": ["..."], "specs": {"ชื่อสเปก": "ค่า"}}
กฎ:
- ใช้เฉพาะข้อเท็จจริงที่อยู่ในข้อความ ห้ามเติมสรรพคุณหรือตัวเลขที่ไม่มี
- price คือราคาขาย compareAtPrice คือราคาปกติก่อนลด (ถ้าไม่มีให้ใส่ null) ตัวเลขต้องมีอยู่ในข้อความจริง
- description สรุป 1-2 ประโยค
- highlights คือจุดขาย 4-8 ข้อ เขียนเป็นประโยคพูดสั้น ๆ ที่พิธีกรไลฟ์พูดได้เลย เป็นภาษาไทยเป็นกันเอง แต่ละข้อต้องมาจากข้อมูลจริง
- ห้ามการันตีผล ห้ามอ้างรักษาโรค ห้ามคำว่า ดีที่สุด/อันดับ 1 ถ้าไม่มีหลักฐานในข้อความ
- specs ใส่ขนาด น้ำหนัก วัสดุ สี ส่วนผสม วิธีใช้ ฯลฯ ที่มีในข้อความ`;

/**
 * Turns product text (pasted, or a page's preview metadata) into a product draft and
 * live-ready selling points. Prices the source does not contain and claims the
 * compliance rules block are dropped and reported, so the seller reviews before saving.
 */
export async function importProduct(text: string, llm?: LlmProvider, extra: { imageUrl?: string; sku?: string } = {}): Promise<ImportResult> {
  const source = text.trim().slice(0, 6000);
  const basic = basicDraft(source);
  let draft = basic;
  let via: ImportResult["via"] = "basic";
  if (llm) {
    const raw = await llm
      .complete([{ role: "system", content: PROMPT }, { role: "user", content: source }], { temperature: 0.3, maxTokens: 900 })
      .catch(() => "");
    const json = /\{[\s\S]*\}/.exec(raw)?.[0];
    if (json) {
      try {
        const d = JSON.parse(json) as Partial<Record<keyof ProductDraft, unknown>>;
        const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);
        const specs = d.specs && typeof d.specs === "object" ? Object.fromEntries(Object.entries(d.specs as Record<string, unknown>).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, String(v)])) : {};
        draft = {
          name: typeof d.name === "string" && d.name.trim() ? d.name.trim().slice(0, 120) : basic.name,
          sku: "",
          description: typeof d.description === "string" ? d.description.trim() : basic.description,
          price: toNumber(d.price) ?? basic.price,
          compareAtPrice: toNumber(d.compareAtPrice),
          category: typeof d.category === "string" && d.category.trim() ? d.category.trim() : "ทั่วไป",
          highlights: strs(d.highlights).slice(0, 8),
          specs: { ...basic.specs, ...specs },
        };
        via = "llm";
      } catch {
        /* keep the basic draft */
      }
    }
  }
  const warnings: string[] = [];
  // Prices must come from the source, never from the AI.
  const known = new Set(pricesIn(source).concat(source.match(/\d[\d,]*(?:\.\d+)?/g)?.map((n) => Number(n.replace(/,/g, ""))) ?? []));
  if (draft.price !== undefined && !known.has(draft.price)) draft.price = basic.price;
  if (draft.compareAtPrice !== undefined && (!known.has(draft.compareAtPrice) || (draft.price !== undefined && draft.compareAtPrice <= draft.price))) draft.compareAtPrice = undefined;
  if (draft.price === undefined) warnings.push("ไม่พบราคาในข้อมูล ใส่ราคาขายเอง");
  const kept: string[] = [];
  for (const h of draft.highlights) {
    if (isBlocked(checkClaims(h))) warnings.push(`ตัดจุดขายที่อาจผิดกฎโฆษณาออก: "${h}"`);
    else kept.push(h);
  }
  draft.highlights = kept;
  if (!draft.highlights.length) warnings.push(llm ? "ยังไม่มีจุดขาย เพิ่มเองได้" : "ยังไม่มีจุดขาย เปิดสมอง AI เพื่อให้ช่วยเขียนจุดขาย หรือเพิ่มเอง");
  draft.imageUrl = extra.imageUrl;
  draft.sku = extra.sku ?? "";
  return { draft, via, warnings };
}
