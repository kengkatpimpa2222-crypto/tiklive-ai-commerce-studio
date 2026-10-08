import { describe, expect, it } from "vitest";
import { AmplitudeLipSync, buildVisemeTimeline, estimateDurationMs, sampleTimeline, textToVisemeTokens } from "./visemes.js";

describe("visemes", () => {
  it("maps Thai vowels and bilabials", () => {
    const v = textToVisemeTokens("มา").map((t) => t.viseme);
    expect(v).toEqual(["MBP", "A"]);
    expect(textToVisemeTokens("ปู").map((t) => t.viseme)).toEqual(["MBP", "U"]);
  });
  it("builds a timeline that starts and ends at rest-ready points", () => {
    const tl = buildVisemeTimeline("สวัสดีค่ะ ทุกคน", 1500);
    expect(tl[0]!.t).toBe(0);
    expect(tl[tl.length - 1]).toEqual({ t: 1500, viseme: "rest", open: 0 });
    for (let i = 1; i < tl.length; i++) expect(tl[i]!.t).toBeGreaterThanOrEqual(tl[i - 1]!.t);
  });
  it("closes the mouth on bilabials and opens on A", () => {
    const tl = buildVisemeTimeline("มามา", 1000);
    expect(tl.find((f) => f.viseme === "MBP")!.open).toBeLessThan(0.3);
    expect(tl.find((f) => f.viseme === "A")!.open).toBeGreaterThan(0.6);
  });
  it("samples smoothly", () => {
    const tl = buildVisemeTimeline("อา", 1000);
    const a = sampleTimeline(tl, 10).open;
    const b = sampleTimeline(tl, 500).open;
    expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true);
    expect(sampleTimeline(tl, 5000).open).toBe(0);
  });
  it("estimates longer text as longer speech", () => {
    expect(estimateDurationMs("สวัสดีค่ะทุกคน วันนี้มีของดีมาแนะนำ")).toBeGreaterThan(estimateDurationMs("สวัสดี"));
  });
  it("smooths amplitude", () => {
    const l = new AmplitudeLipSync();
    const up = l.update(0.3);
    expect(up).toBeGreaterThan(0);
    let v = up;
    for (let i = 0; i < 30; i++) v = l.update(0);
    expect(v).toBeLessThan(0.01);
  });
});

import { prosodyFor } from "./prosody.js";
describe("prosodyFor", () => {
  it("speeds up when excited and slows when apologetic, within limits", () => {
    const base = { rate: 1, pitch: 1 };
    expect(prosodyFor("excited", base).rate).toBeGreaterThan(1);
    expect(prosodyFor("apologetic", base).rate).toBeLessThan(1);
    expect(prosodyFor("excited", { rate: 1.95, pitch: 1.95 })).toEqual({ rate: 2, pitch: 2 });
  });
});
