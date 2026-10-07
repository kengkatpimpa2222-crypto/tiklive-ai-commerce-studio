import { describe, expect, it } from "vitest";
import { buildVisemeTimeline } from "@tlai/tts";
import { AvatarController } from "./controller.js";

function run(c: AvatarController, ms: number, step = 16) {
  const frames = [];
  for (let t = 0; t < ms; t += step) frames.push(c.update(step));
  return frames;
}

describe("AvatarController", () => {
  it("blinks while idle", () => {
    const frames = run(new AvatarController(1), 10_000);
    expect(frames.some((f) => f.eyeOpenL < 0.2)).toBe(true);
    expect(frames.filter((f) => f.eyeOpenL < 0.2).length).toBeLessThan(frames.length * 0.1);
  });
  it("keeps the mouth closed when silent and moves it when speaking", () => {
    const c = new AvatarController(2);
    expect(Math.max(...run(c, 1000).map((f) => f.mouthOpen))).toBe(0);
    c.startSpeech(buildVisemeTimeline("สวัสดีค่ะทุกคน", 1200), 1200);
    const talking = run(c, 1200);
    expect(Math.max(...talking.map((f) => f.mouthOpen))).toBeGreaterThan(0.4);
    const after = run(c, 800);
    expect(after[after.length - 1]!.mouthOpen).toBeLessThan(0.05);
    expect(after[after.length - 1]!.speaking).toBe(false);
  });
  it("moves the head naturally without large jumps", () => {
    const frames = run(new AvatarController(3), 5000);
    for (let i = 1; i < frames.length; i++) {
      expect(Math.abs(frames[i]!.headYaw - frames[i - 1]!.headYaw)).toBeLessThan(2);
    }
    expect(Math.max(...frames.map((f) => Math.abs(f.headYaw)))).toBeLessThan(15);
  });
  it("blends emotions over time", () => {
    const c = new AvatarController(4);
    c.update(16);
    c.setEmotion("excited");
    const first = c.update(16).face.smile;
    const later = run(c, 1500).pop()!.face.smile;
    expect(first).toBeLessThan(later);
    expect(later).toBeGreaterThan(0.9);
  });
  it("plays a gesture and returns to rest", () => {
    const c = new AvatarController(5);
    c.playGesture("wave");
    const mid = run(c, 900).pop()!;
    expect(mid.arms.rightShoulder).toBeLessThan(-60);
    const end = run(c, 1200).pop()!;
    expect(end.gesture).toBe("none");
  });
});
