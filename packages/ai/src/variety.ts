import { formatBaht, type HostCharacter, type Product, type Promotion } from "@tlai/shared";

/**
 * Keeps the host from sounding like a loop. Every line type has many phrasings,
 * filler talk rotates between kinds of content, and anything said recently is
 * skipped. All lines are built from catalog facts only (no invented popularity,
 * stock pressure or engagement bait), and every line still passes compliance.
 */

export type Rng = () => number;

const norm = (t: string) => t.replace(/\s+/g, "").toLowerCase();

/** "ลด 10%" + "ค่ะ" → "ลด 10% ค่ะ"; Thai text runs straight into the particle. */
export const spaced = (t: string) => (/[a-z0-9%)]$/i.test(t) ? `${t} ` : t);

export interface VoiceBits {
  /** ค่ะ / ครับ */
  e: string;
  /** นะคะ / นะครับ */
  q: string;
  host: string;
}

export const voiceOf = (c: HostCharacter): VoiceBits => ({ e: c.politeParticle, q: c.politeParticle === "ค่ะ" ? "นะคะ" : "นะครับ", host: c.name });

export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** First candidate not said recently; if everything was said, the one said longest ago. */
/** Spoken lines arrive split into sentences, so a line counts as said if it appears in the joined history. */
const history = (recent: readonly string[]) => recent.map(norm).join("");

export function pickFresh(candidates: string[], recent: readonly string[], rng: Rng): string {
  const order = shuffle(candidates.filter(Boolean), rng);
  if (!order.length) return "";
  const h = history(recent);
  const fresh = order.find((t) => !h.includes(norm(t)));
  if (fresh) return fresh;
  return order.reduce((best, t) => (h.lastIndexOf(norm(t)) < h.lastIndexOf(norm(best)) ? t : best));
}

// ---------- pitch ----------

/** Products the seller paired with `p` that are in this LIVE and in stock. */
export function pairsOf(p: Product, lineup: readonly Product[]): Product[] {
  return (p.pairsWith ?? []).flatMap((id) => lineup.filter((x) => x.id === id && x.id !== p.id && x.stock > 0 && x.status === "ACTIVE"));
}

export function pitchLines(p: Product, promos: Promotion[], v: VoiceBits, rng: Rng, pairs: readonly Product[] = []): string[] {
  const { e, q } = v;
  const name = p.name;
  const opener = shuffle(
    [
      `ตัวต่อไปที่อยากแนะนำ${e} ${name}`,
      `มาดูตัวนี้กัน${q} ${name}`,
      `ขอแนะนำ ${spaced(name)}${e}`,
      `ต่อกันที่ ${spaced(name)}${e}`,
      `มาที่ ${name} กันบ้าง${q}`,
      p.category ? `ใครกำลังมองหา${p.category} ตัวนี้น่าสนใจ${e} ${name}` : `ตัวนี้น่าสนใจ${e} ${name}`,
    ],
    rng,
  )[0]!;
  const intros = shuffle(["จุดเด่นคือ", "ที่น่าสนใจคือ", "เด่นอีกอย่างคือ", "อีกข้อคือ", ""], rng);
  const highlights = shuffle(p.highlights, rng)
    .slice(0, 3)
    .map((h, i) => (intros[i] ? `${intros[i]} ${h}` : h));
  const specs = Object.entries(p.specs);
  const spec = specs.length && rng() < 0.6 ? specs[Math.floor(rng() * specs.length)] : undefined;
  const price = p.compareAtPrice
    ? shuffle([`ราคาปกติ ${formatBaht(p.compareAtPrice)} ในไลฟ์นี้ ${formatBaht(p.price)}${e}`, `ในไลฟ์นี้ ${formatBaht(p.price)} จากราคาปกติ ${formatBaht(p.compareAtPrice)}${e}`, `จากปกติ ${formatBaht(p.compareAtPrice)} ตอนนี้ ${formatBaht(p.price)}${e}`], rng)[0]!
    : shuffle([`ราคา ${formatBaht(p.price)}${e}`, `ตัวนี้ราคา ${formatBaht(p.price)}${e}`, `ราคาอยู่ที่ ${formatBaht(p.price)}${e}`], rng)[0]!;
  const promoLines = promos.map((x, i) => `${i === 0 ? shuffle(["แล้วก็มีโปร", "มีโปรด้วย", "ตอนนี้มีโปร"], rng)[0] : "อีกโปรคือ"} ${spaced(`${x.title} ${x.detail}`)}${e}`);
  const closer =
    p.stock > 0
      ? shuffle([`สนใจกดที่ตะกร้าสินค้าได้เลย${e}`, `ดูรายละเอียดเพิ่มได้ที่ตะกร้าด้านล่าง${q}`, `มีคำถามเรื่อง${name} พิมพ์ถามได้เลย${q}`, `กดตะกร้าแล้วเลือก${name}ได้เลย${e}`], rng)[0]!
      : `ตอนนี้สินค้าหมดชั่วคราว${e} กดติดตามร้านไว้เพื่อดูรอบถัดไปได้${e}`;
  // Not every pitch needs the description; alternate so repeats of the same product sound different.
  const desc = p.description && rng() < 0.6 ? p.description : "";
  const pl = pairLines(p, pairs, v);
  const pair = pl.length && rng() < 0.7 ? pl[Math.floor(rng() * pl.length)]! : "";
  return [opener, desc, ...highlights, spec ? `${spec[0]}คือ ${spaced(spec[1])}${e}` : "", price, ...promoLines, pair, closer].filter(Boolean);
}

/** Ways to suggest a paired product, with its real price. */
export function pairLines(p: Product, pairs: readonly Product[], v: VoiceBits): string[] {
  const { e, q } = v;
  return pairs.flatMap((x) => [
    `ใครเอา${p.name} ใช้คู่กับ${x.name}ได้ด้วย${e} ${x.name} ราคา ${formatBaht(x.price)}${e}`,
    `${p.name}เข้ากันดีกับ${x.name}${e} ดูในตะกร้าได้เลย${q}`,
    `ร้านแนะนำให้ใช้${p.name}คู่กับ${x.name}${e} ${x.name} อยู่ในตะกร้าเหมือนกัน${e}`,
  ]);
}

// ---------- free talk ----------

export interface TalkContext {
  product?: Product;
  lineup: Product[];
  promos: Promotion[];
  faqs: { topic: string; answer: string }[];
  /** Local hour, for greetings. */
  hour: number;
}

export type TalkKind = "highlight" | "spec" | "price" | "cta" | "invite" | "describe" | "promo" | "welcome" | "lineup" | "faq" | "assistant" | "teaser" | "pair";

/** Every kind of thing the host can say between products, with several phrasings each. */
export function talkCandidates(t: TalkContext, v: VoiceBits): Record<TalkKind, string[]> {
  const { e, q, host } = v;
  const p = t.product;
  const others = t.lineup.filter((x) => x.id !== p?.id);
  const greet = t.hour < 11 ? "สวัสดีตอนเช้า" : t.hour < 16 ? "สวัสดีตอนบ่าย" : t.hour < 21 ? "สวัสดีตอนเย็น" : "สวัสดีทุกคนที่ยังไม่นอน";
  const out: Record<TalkKind, string[]> = { highlight: [], spec: [], price: [], cta: [], invite: [], describe: [], promo: [], welcome: [], lineup: [], faq: [], assistant: [], teaser: [], pair: [] };
  if (p) {
    for (const h of p.highlights) {
      out.highlight.push(
        `ย้ำอีกนิด${e} ${p.name} ${spaced(h)}${e}`,
        `สำหรับคนที่เพิ่งเข้ามา ${p.name} ${spaced(h)}${e}`,
        `เรื่องที่อยากให้รู้เกี่ยวกับ${p.name}คือ ${spaced(h)}${e}`,
        `อีกจุดของ${p.name}${e} ${spaced(h)}${e}`,
        `ถ้าถามว่า${p.name}ดียังไง ข้อหนึ่งคือ ${spaced(h)}${e}`,
      );
    }
    for (const [k, val] of Object.entries(p.specs)) {
      out.spec.push(`${k}ของ${p.name}คือ ${spaced(val)}${e}`, `ข้อมูลเพิ่มเติม${e} ${p.name} ${k} ${spaced(val)}${e}`, `บอก${k}ให้ด้วย${e} ${p.name} ${spaced(val)}${e}`);
    }
    out.price.push(
      `${p.name} ตอนนี้ราคา ${formatBaht(p.price)}${e}`,
      p.compareAtPrice ? `${p.name} ในไลฟ์นี้ ${formatBaht(p.price)} จากราคาปกติ ${formatBaht(p.compareAtPrice)}${e}` : `${p.name} ราคา ${formatBaht(p.price)} ดูได้ที่ตะกร้า${e}`,
    );
    if (p.stock > 0)
      out.cta.push(
        `${p.name} กดดูที่ตะกร้าได้เลย${e}`,
        `สนใจ${p.name} กดตะกร้าด้านล่างได้เลย${q}`,
        `ใครอยากได้${p.name} เลือกได้ที่ตะกร้าสินค้า${e}`,
        `รายละเอียดเต็ม ๆ ของ${p.name} ดูได้ในตะกร้า${e}`,
        `ถ้าพร้อมแล้ว กดตะกร้าแล้วเลือก${p.name}ได้เลย${e}`,
      );
    out.invite.push(
      `ใครมีคำถามเกี่ยวกับ${p.name} พิมพ์ถามได้เลย${q}`,
      `อยากรู้อะไรเพิ่มเรื่อง${p.name} ถามมาได้${e} ${host}ตอบให้`,
      `ถ้าสงสัยเรื่องขนาด ราคา หรือการจัดส่ง พิมพ์มาได้เลย${q}`,
      `ใช้${p.name}แล้วเป็นยังไง มีคำถามตรงไหน พิมพ์มาคุยกันได้${e}`,
    );
    if (p.description) out.describe.push(`${p.name} ${spaced(p.description)}${e}`, `เล่าเพิ่มอีกนิด${e} ${spaced(p.description)}${e}`);
    out.pair.push(...pairLines(p, pairsOf(p, t.lineup), v));
    if (others.length) out.teaser.push(`เดี๋ยวต่อด้วย${others[0]!.name}${e}`, `นอกจาก${p.name} วันนี้ยังมี${others.map((x) => x.name).slice(0, 2).join(" กับ ")}ด้วย${e}`);
  } else {
    out.invite.push(`ใครสนใจสินค้าตัวไหน พิมพ์ชื่อสินค้ามาได้เลย${q}`, `อยากให้${host}แนะนำตัวไหน พิมพ์บอกได้เลย${q}`);
  }
  for (const x of t.promos.filter((x) => x.active && (!p || x.productIds.length === 0 || x.productIds.includes(p.id)))) {
    out.promo.push(`โปรตอนนี้${e} ${spaced(`${x.title} ${x.detail}`)}${e}`, `อย่าลืมโปร${x.title}${e} ${spaced(x.detail)}${e}`);
    if (x.code) out.promo.push(`ใครยังไม่ได้ใช้โค้ด ${spaced(x.code)}${e} ${spaced(`${x.title} ${x.detail}`)}${e}`);
  }
  out.welcome.push(
    `${greet}${e} ยินดีต้อนรับทุกคนที่เพิ่งเข้ามา${e}`,
    `ยินดีต้อนรับ${q} ตอนนี้${p ? `กำลังคุยเรื่อง${p.name}อยู่` : "กำลังแนะนำสินค้าของร้านอยู่"}${e}`,
    `${greet}${e} เข้ามาแล้วถามเรื่องสินค้าได้เลย${q}`,
    `ขอบคุณที่แวะเข้ามาดู${q} ${host}จะเล่าเรื่องสินค้าให้ฟังเรื่อย ๆ${e}`,
  );
  if (t.lineup.length > 1) out.lineup.push(`วันนี้ในไลฟ์มี ${t.lineup.map((x) => x.name).join(" ")}${e}`, `สรุปสินค้าวันนี้${e} ${t.lineup.map((x) => `${x.name} ${formatBaht(x.price)}`).join(" ")}${e}`);
  for (const f of t.faqs) out.faq.push(`เผื่อใครสงสัยเรื่อง${f.topic}${e} ${f.answer}`);
  out.assistant.push(
    `${host}เป็นผู้ช่วย AI ของร้าน ถามเรื่องสินค้าได้ตลอด${e}`,
    `เรื่องคำสั่งซื้อและการจัดส่ง มีทีมงานของร้านดูแลอยู่${e}`,
    `ถ้า${host}ตอบเรื่องไหนไม่ได้ ทีมงานของร้านจะตอบในแชตให้${e}`,
  );
  return out;
}

const WEIGHTS: Record<TalkKind, number> = { highlight: 3, spec: 2, price: 2, cta: 2, invite: 2, describe: 1.5, promo: 1.5, welcome: 1, lineup: 1, faq: 1.5, assistant: 0.5, teaser: 1, pair: 1.5 };

/**
 * Picks the next filler line: a different kind from the last couple of lines,
 * weighted toward product facts, and never something said recently.
 */
export function nextTalk(t: TalkContext, v: VoiceBits, recent: readonly string[], lastKinds: readonly TalkKind[], rng: Rng): { text: string; kind: TalkKind } {
  const cands = talkCandidates(t, v);
  const h = history(recent);
  const kinds = (Object.keys(cands) as TalkKind[]).filter((k) => cands[k].some((x) => !h.includes(norm(x))));
  if (!kinds.length) {
    // Everything has been said at least once: reuse whatever was said longest ago.
    const all = (Object.keys(cands) as TalkKind[]).flatMap((k) => cands[k].map((text) => ({ text, kind: k, at: h.lastIndexOf(norm(text)) })));
    if (!all.length) return { text: "", kind: "invite" };
    return all.reduce((a, b) => (b.at < a.at ? b : a));
  }
  const pool = kinds.filter((k) => !lastKinds.slice(-2).includes(k));
  const usable = pool.length ? pool : kinds;
  const total = usable.reduce((s, k) => s + WEIGHTS[k], 0);
  let r = rng() * total;
  let kind = usable[0]!;
  for (const k of usable) {
    r -= WEIGHTS[k];
    if (r <= 0) {
      kind = k;
      break;
    }
  }
  return { text: pickFresh(cands[kind], recent, rng), kind };
}
