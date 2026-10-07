import { describe, expect, it } from "vitest";
import { formatBaht, splitSentences } from "./text.js";

describe("splitSentences", () => {
  it("splits on line breaks, punctuation and Thai polite particles", () => {
    expect(splitSentences("สวัสดีค่ะ ทุกคน\nราคา 299 บาทค่ะ วันนี้ส่งฟรี! ใครสนใจบ้าง?")).toEqual(["สวัสดีค่ะ", "ทุกคน", "ราคา 299 บาทค่ะ", "วันนี้ส่งฟรี!", "ใครสนใจบ้าง?"]);
  });
  it("breaks very long clauses", () => {
    const parts = splitSentences("คำ ".repeat(80));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
  });
  it("formats baht", () => {
    expect(formatBaht(1290)).toBe("1,290 บาท");
  });
});
