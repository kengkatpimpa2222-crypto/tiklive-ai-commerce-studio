import type { HostCharacter, LiveSchedule } from "@tlai/shared";
import { useState } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/useData";

const DAY_NAMES = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const daysLabel = (d: number[]) => (d.length === 7 ? "ทุกวัน" : d.map((x) => DAY_NAMES[x]).join(" "));
const durationLabel = (m: number) => (m >= 60 ? `${m / 60} ชั่วโมง` : `${m} นาที`);

/** Lets the autopilot start on its own at set times. Going live in TikTok LIVE Studio stays the seller's step. */
export function SchedulePanel({ characters }: { characters: HostCharacter[] }) {
  const [schedules, reload] = useData<LiveSchedule[]>("/schedules", []);
  const [next, reloadNext] = useData<{ at: string | null }>("/schedules/next", { at: null });
  const [f, setF] = useState({ days: [0, 1, 2, 3, 4, 5, 6], start: "20:00", minutes: 120, characterId: "" });
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const refresh = () => {
    reload();
    reloadNext();
  };
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setErr("");
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const add = () =>
    run(async () => {
      await api("/schedules", { body: { ...f, characterId: f.characterId || undefined } });
      setOpen(false);
    });
  const toggleDay = (d: number) => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] });

  return (
    <div className="schedule-card">
      <b>ตั้งเวลาไลฟ์อัตโนมัติ</b>
      {next.at && (
        <p>
          ครั้งถัดไป {new Date(next.at).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "short" })} เวลา{" "}
          {new Date(next.at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.
        </p>
      )}
      {schedules.map((s) => (
        <div className="schedule-row" key={s.id}>
          <label className="inline">
            <input type="checkbox" checked={s.enabled} onChange={(e) => run(() => api(`/schedules/${s.id}`, { method: "PATCH", body: { enabled: e.target.checked } }))} />
            <span>
              {daysLabel(s.days)} {s.start} น. นาน {durationLabel(s.minutes)}
              {s.characterId && ` · ${characters.find((c) => c.id === s.characterId)?.name ?? ""}`}
            </span>
          </label>
          <button onClick={() => run(() => api(`/schedules/${s.id}`, { method: "DELETE" }))}>ลบ</button>
          {s.lastResult && <small className="muted">ล่าสุด {s.lastRunDate}: {s.lastResult}</small>}
        </div>
      ))}
      {!open ? (
        <button onClick={() => setOpen(true)}>+ เพิ่มเวลาไลฟ์</button>
      ) : (
        <div className="form">
          <div className="day-picks">
            {DAY_NAMES.map((n, i) => (
              <button key={i} className={f.days.includes(i) ? "primary" : ""} onClick={() => toggleDay(i)}>
                {n}
              </button>
            ))}
          </div>
          <div className="row">
            <input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
            <select value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })}>
              {[30, 60, 90, 120, 180, 240, 360].map((m) => (
                <option key={m} value={m}>
                  นาน {durationLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <select value={f.characterId} onChange={(e) => setF({ ...f, characterId: e.target.value })}>
            <option value="">พิธีกรหลัก</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="row">
            <button className="primary" onClick={add} disabled={!f.days.length}>
              บันทึกเวลา
            </button>
            <button onClick={() => setOpen(false)}>ยกเลิก</button>
          </div>
        </div>
      )}
      {err && <div className="msg">⚠ {err}</div>}
      <small className="muted">
        ต้องเปิดแอปนี้ไว้ เครื่องจะไม่พักหน้าจอก่อนถึงเวลา 30 นาที แอปจะเตือนก่อน 10 นาที ให้เปิด TikTok LIVE Studio แล้วกด Go LIVE เอง และมีคนคอยดูแลไลฟ์ตลอด
      </small>
    </div>
  );
}
