import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostBrain } from "@tlai/ai";
import type { LiveSession, StageCommand } from "@tlai/shared";
import { LiveDirector } from "./director.js";
import { Store } from "./store.js";

let store: Store;
let sent: StageCommand[];
let director: LiveDirector;

function makeSession(extra: Partial<LiveSession> = {}): LiveSession {
  const s: LiveSession = {
    id: "live_t", title: "t", characterId: "char_mint", productIds: ["prod_serum", "prod_bottle", "prod_tee"], status: "LIVE",
    startedAt: new Date().toISOString(), manualStats: {}, events: [], ...extra,
  };
  store.insert("sessions", s);
  return s;
}
const spoken = () => sent.flatMap((c) => (c.type === "speak" ? [c.segment] : []));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  store = new Store(null);
  sent = [];
  director = new LiveDirector({ store, brain: new HostBrain(), send: (c) => sent.push(c), freeTalkAfterMs: 1000, rotateEveryTurns: 2 });
});
afterEach(() => {
  director.stop();
  vi.useRealTimers();
});

describe("LiveDirector", () => {
  it("re-discloses that the host is AI every 15 minutes", async () => {
    director.start(makeSession());
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    const disclosures = spoken().filter((s) => s.source === "disclosure").map((s) => s.text);
    expect(disclosures.some((t) => t.includes("ตัวละคร AI"))).toBe(true);
    expect(disclosures.filter((t) => t.includes("แจ้งอีกครั้ง")).length).toBeGreaterThanOrEqual(2);
  });

  it("rotates products during free talk", async () => {
    director.start(makeSession());
    director.showProduct("prod_serum");
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    const shown = new Set(sent.flatMap((c) => (c.type === "product" && c.product ? [c.product.id] : [])));
    expect(shown.size).toBe(3);
  });

  it("does not repeat fixed script lines word for word when the script loops", async () => {
    store.insert("scripts", { id: "s_loop", title: "loop", onEnd: "loop", steps: [{ kind: "say", text: "สวัสดีค่ะ ยินดีต้อนรับเข้าสู่ไลฟ์ของร้าน" }, { kind: "pitch_product", productId: "prod_serum" }] });
    director.start(makeSession({ scriptId: "s_loop" }));
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    const greetings = spoken().filter((s) => s.text.includes("ยินดีต้อนรับเข้าสู่ไลฟ์ของร้าน"));
    expect(greetings.length).toBe(1);
    const pitches = spoken().filter((s) => s.source === "pitch").map((s) => s.text);
    // Repeated pitches of the same product are worded differently.
    expect(new Set(pitches).size).toBeGreaterThanOrEqual(12);
  });

  it("answers several viewer questions back-to-back in auto mode", async () => {
    director.start(makeSession());
    await vi.advanceTimersByTimeAsync(30_000);
    const qs = ["ส่งกี่วันคะ", "มีโปรไหม", "เป็นคนจริงไหม"].map((t, i) => director.addQuestion(t, `v${i}`, "clipboard"));
    const before = sent.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(qs.every((q) => store.get("questions", q.id)!.status === "answered")).toBe(true);
    // All three answers come before the host goes back to script/free talk lines.
    // Lines already queued may finish first; after that, all three answers play without script/free talk in between.
    const after = sent.slice(before).flatMap((c) => (c.type === "speak" ? [c.segment] : []));
    const start = after.findIndex((seg) => seg.source === "qa");
    const run = after.slice(start);
    const stop = run.findIndex((seg) => seg.source !== "qa" && seg.source !== "disclosure");
    expect(run.slice(0, stop === -1 ? undefined : stop).filter((seg) => seg.source === "qa").length).toBeGreaterThanOrEqual(3);
  });

  it("drops a slow AI filler line when a question arrives while it is being written", async () => {
    director.stop();
    let calls = 0;
    const slow = { id: "slow", complete: () => (calls++, new Promise<string>((r) => setTimeout(() => r("ประโยคคั่นจาก AI ค่ะ"), 30_000))) };
    director = new LiveDirector({ store, brain: new HostBrain(slow), send: (c) => sent.push(c), freeTalkAfterMs: 1000, rotateEveryTurns: 0 });
    director.start(makeSession({ id: "live_slow", scriptId: undefined }));
    // Wait until the director is waiting on the AI for a filler line.
    for (let i = 0; i < 400 && calls === 0; i++) await vi.advanceTimersByTimeAsync(250);
    expect(calls).toBe(1);
    const before = sent.length;
    const q = director.addQuestion("ส่งกี่วันคะ", "v", "clipboard");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.get("questions", q.id)!.status).toBe("answered");
    const after = sent.slice(before).flatMap((c) => (c.type === "speak" ? [c.segment] : []));
    const firstQa = after.findIndex((seg) => seg.source === "qa");
    expect(firstQa).toBeGreaterThanOrEqual(0);
    expect(after.slice(0, firstQa).some((seg) => seg.text.includes("ประโยคคั่นจาก AI"))).toBe(false);
  });

  it("does not answer on its own in review mode", async () => {
    director.qaMode = "review";
    director.start(makeSession());
    const q = director.addQuestion("ราคาเท่าไหร่", "a");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.get("questions", q.id)!.status).toBe("pending");
    await director.answerQuestion(q.id, "เซรั่มวิตามินซี 30 ml ราคา 299 บาทค่ะ");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(spoken().some((s) => s.source === "qa" && s.text.includes("299 บาท"))).toBe(true);
  });

  it("refuses an edited answer that breaks the rules", async () => {
    director.qaMode = "review";
    director.start(makeSession());
    const q = director.addQuestion("ได้ผลไหม", undefined);
    const r = await director.answerQuestion(q.id, "การันตีได้ผลแน่นอนค่ะ");
    expect(r.ok).toBe(false);
    expect(store.get("questions", q.id)!.status).toBe("pending");
  });

  it("blocks spam and links in questions", () => {
    director.start(makeSession());
    expect(director.addQuestion("ดูที่ www.x.com", undefined).status).toBe("blocked");
    director.addQuestion("ส่งฟรีไหม", undefined);
    director.addQuestion("ส่งฟรีไหม", undefined);
    expect(director.addQuestion("ส่งฟรีไหม", undefined).status).toBe("blocked");
  });

  it("pauses without losing the current sentence and resumes with it", async () => {
    director.start(makeSession());
    const first = director.state().speaking!;
    director.pause();
    expect(director.state().status).toBe("paused");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spoken().length).toBe(1);
    director.resume();
    expect(director.state().speaking!.id).toBe(first.id);
  });
});

describe("flash sale", () => {
  it("announces the sale price, keeps the product on screen, reminds near the end and restores the normal price", async () => {
    director.start(makeSession());
    expect(director.startFlashSale("prod_serum", 500, 10).ok).toBe(false);
    expect(director.startFlashSale("prod_serum", 249, 10).ok).toBe(true);
    expect(sent.some((c) => c.type === "flash_sale" && c.sale?.price === 249)).toBe(true);
    expect(director.state().flashSale?.productId).toBe("prod_serum");
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    const said = spoken().map((s) => s.text).join(" ");
    expect(said).toContain("ราคาพิเศษ 10 นาที");
    expect(said).toContain("249 บาท");
    expect(said).toContain("เหลืออีก 2 นาที");
    // Free-talk rotation does not move away from the sale product.
    const shownDuring = sent.flatMap((c) => (c.type === "product" && c.product ? [c.product.id] : []));
    expect(new Set(shownDuring)).toEqual(new Set(["prod_serum"]));

    const before = sent.length;
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(director.state().flashSale).toBeNull();
    expect(sent.slice(before).some((c) => c.type === "flash_sale" && c.sale === null)).toBe(true);
    expect(spoken().map((s) => s.text).join(" ")).toContain("กลับเป็นราคาปกติ 299 บาท");
    // After the sale the host never says the sale price again.
    const after = sent.length;
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(sent.slice(after).some((c) => c.type === "speak" && c.segment.text.includes("249 บาท"))).toBe(false);
  });

  it("refuses before the LIVE starts", () => {
    expect(director.startFlashSale("prod_serum", 249, 10)).toMatchObject({ ok: false });
  });
});
