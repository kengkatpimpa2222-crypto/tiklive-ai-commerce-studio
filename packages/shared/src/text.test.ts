import { describe, expect, it } from "vitest";
import { formatBaht, parseCopiedComment, splitSentences } from "./text.js";

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

describe("parseCopiedComment", () => {
  it("splits a name line from the comment", () => {
    expect(parseCopiedComment("@nok_shop\nเซรั่มส่งกี่วันคะ")).toEqual({ author: "nok_shop", text: "เซรั่มส่งกี่วันคะ" });
  });
  it("splits name: comment", () => {
    expect(parseCopiedComment("แอน: มีโปรไหม")).toEqual({ author: "แอน", text: "มีโปรไหม" });
  });
  it("keeps a bare comment", () => {
    expect(parseCopiedComment("  ราคาเท่าไหร่คะ  ")).toEqual({ text: "ราคาเท่าไหร่คะ" });
  });
  it("ignores things that are not comments", () => {
    expect(parseCopiedComment("")).toBeNull();
    expect(parseCopiedComment("https://example.com/x")).toBeNull();
    expect(parseCopiedComment("a\nb\nc\nd\ne")).toBeNull();
    expect(parseCopiedComment("ก".repeat(301))).toBeNull();
  });
});
