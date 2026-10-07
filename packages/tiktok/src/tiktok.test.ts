import { describe, expect, it } from "vitest";
import { ManualTikTokProvider, UNSUPPORTED_TIKTOK_MESSAGE } from "./index.js";

describe("ManualTikTokProvider", () => {
  it("reports unsupported actions with the official-tool message", async () => {
    const p = new ManualTikTokProvider();
    const r = await p.pinProduct("SKU");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(UNSUPPORTED_TIKTOK_MESSAGE);
  });
});
