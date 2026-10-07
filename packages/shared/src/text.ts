/** Formats a price the way Thai sellers say it on air: "299 บาท", "1,290 บาท". */
export function formatBaht(n: number): string {
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} บาท`;
}

const THAI_SENTENCE_END = /(ค่ะ|คะ|ครับ|นะคะ|นะครับ|จ้า|จ้ะ|เลย|นะ)(?=\s)/g;

/**
 * Splits host text into speakable sentences. Thai rarely uses full stops, so we
 * also break after polite particles followed by a space, and on long clauses.
 */
export function splitSentences(text: string, maxLen = 100): string[] {
  const marked = text
    .replace(/\s*\n+\s*/g, "\u0000")
    .replace(/[^\S\u0000]+/g, " ")
    .trim()
    .replace(/([.!?…]+)\s+/g, "$1\u0000")
    .replace(/([!?])(?=\S)/g, "$1\u0000")
    .replace(THAI_SENTENCE_END, "$1\u0000");
  const out: string[] = [];
  for (const raw of marked.split("\u0000")) {
    let s = raw.trim();
    while (s.length > maxLen) {
      const cut = s.lastIndexOf(" ", maxLen);
      const at = cut > maxLen / 3 ? cut : maxLen;
      out.push(s.slice(0, at).trim());
      s = s.slice(at).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
