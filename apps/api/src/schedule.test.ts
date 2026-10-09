import { describe, expect, it } from "vitest";
import type { LiveSchedule } from "@tlai/shared";
import { dueSchedule, localDate, nextRun } from "./schedule.js";

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m); // October 2026, local time
const daily: LiveSchedule = { id: "s1", enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: "20:00", minutes: 120 };

describe("scheduled LIVE timing", () => {
  it("finds the next start today, then tomorrow once today's has run", () => {
    expect(nextRun([daily], at(9, 19))?.at).toEqual(at(9, 20));
    expect(nextRun([daily], at(9, 20, 2))?.at).toEqual(at(9, 20));
    expect(nextRun([{ ...daily, lastRunDate: localDate(at(9, 20)) }], at(9, 20, 2))?.at).toEqual(at(10, 20));
    expect(nextRun([daily], at(9, 21))?.at).toEqual(at(10, 20));
  });
  it("only runs on the chosen days and when enabled", () => {
    const day = at(9, 12).getDay();
    const other = { ...daily, days: [(day + 2) % 7] };
    expect(nextRun([other], at(9, 12))?.at).toEqual(at(11, 20));
    expect(dueSchedule([other], at(9, 20, 1))).toBeUndefined();
    expect(nextRun([{ ...daily, enabled: false }], at(9, 12))).toBeNull();
  });
  it("is due from the start time for a few minutes, once a day", () => {
    expect(dueSchedule([daily], at(9, 19, 59))).toBeUndefined();
    expect(dueSchedule([daily], at(9, 20, 0))?.id).toBe("s1");
    expect(dueSchedule([daily], at(9, 20, 4))?.id).toBe("s1");
    expect(dueSchedule([daily], at(9, 20, 6))).toBeUndefined();
    expect(dueSchedule([{ ...daily, lastRunDate: "2026-10-09" }], at(9, 20, 1))).toBeUndefined();
  });
});
