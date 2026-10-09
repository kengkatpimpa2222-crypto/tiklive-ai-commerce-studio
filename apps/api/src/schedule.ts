import type { LiveSchedule } from "@tlai/shared";

/** How long after the start time a missed tick (PC busy, app just opened) may still start the LIVE. */
export const START_GRACE_MS = 5 * 60_000;
/** The seller is reminded this long before a scheduled LIVE, to open TikTok LIVE Studio. */
export const HEADS_UP_MS = 10 * 60_000;

const pad = (n: number) => String(n).padStart(2, "0");
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Today's start time of a schedule, in local time. */
function startOn(day: Date, s: LiveSchedule): Date {
  const [h, m] = s.start.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h!, m!, 0, 0);
  return d;
}

/** The next start of any enabled schedule at or after `now` (within the next 8 days). */
export function nextRun(schedules: LiveSchedule[], now: Date): { schedule: LiveSchedule; at: Date } | null {
  let best: { schedule: LiveSchedule; at: Date } | null = null;
  for (const s of schedules) {
    if (!s.enabled) continue;
    for (let i = 0; i < 8; i++) {
      const day = new Date(now);
      day.setDate(now.getDate() + i);
      if (!s.days.includes(day.getDay())) continue;
      const at = startOn(day, s);
      // Today's run still counts while it can start, unless it already ran.
      if (at.getTime() + START_GRACE_MS <= now.getTime() || (i === 0 && s.lastRunDate === localDate(now))) continue;
      if (!best || at < best.at) best = { schedule: s, at };
      break;
    }
  }
  return best;
}

/** A schedule whose start time has come today and that has not run yet. */
export function dueSchedule(schedules: LiveSchedule[], now: Date): LiveSchedule | undefined {
  return schedules.find((s) => {
    if (!s.enabled || !s.days.includes(now.getDay()) || s.lastRunDate === localDate(now)) return false;
    const t = now.getTime() - startOn(now, s).getTime();
    return t >= 0 && t < START_GRACE_MS;
  });
}
