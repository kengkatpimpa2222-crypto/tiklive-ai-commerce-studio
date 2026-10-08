import type { LiveSession, LiveSummary } from "@tlai/shared";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/useData";

export function SummaryPage({ id }: { id?: string }) {
  const [sessions] = useData<LiveSession[]>("/live", []);
  const [sel, setSel] = useState(id ?? "");
  const [sum, setSum] = useState<LiveSummary | null>(null);
  const [stats, setStats] = useState({ peakViewers: "", orders: "", gmv: "", likes: "" });
  const target = sel || sessions.filter((s) => s.status === "ENDED").at(-1)?.id || "";

  const load = () => target && api<LiveSummary>(`/live/${target}/summary`).then(setSum);
  useEffect(() => {
    void load();
  }, [target]);

  const save = async () => {
    const body = Object.fromEntries(Object.entries(stats).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]));
    await api(`/live/${target}/stats`, { body });
    void load();
  };

  return (
    <div className="page">
      <h1>สรุปผล LIVE</h1>
      <select value={target} onChange={(e) => setSel(e.target.value)}>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title} ({s.status})
          </option>
        ))}
      </select>
      {sum && (
        <>
          <p className="narrative">{sum.narrative}</p>
          <div className="row">
            <a href={`/api/live/${target}/export.md`} download>ดาวน์โหลดรายงาน (.md)</a>
            <a href={`/api/live/${target}/export.csv`} download>ดาวน์โหลด event log (.csv)</a>
          </div>
          <div className="kpis">
            <Kpi label="ระยะเวลา (นาที)" v={sum.durationMinutes} />
            <Kpi label="ประโยคที่พูด" v={sum.sentencesSpoken} />
            <Kpi label="แจ้งว่าเป็น AI" v={sum.disclosures} />
            <Kpi label="คำถาม / ตอบแล้ว" v={`${sum.questionsReceived} / ${sum.questionsAnswered}`} />
            <Kpi label="ข้อความถูกกัน" v={sum.blockedTexts} />
            <Kpi label="คำสั่งซื้อ*" v={sum.manualStats.orders ?? "—"} />
            <Kpi label="ยอดขาย (บาท)*" v={sum.manualStats.gmv?.toLocaleString() ?? "—"} />
            <Kpi label="ผู้ชมสูงสุด*" v={sum.manualStats.peakViewers ?? "—"} />
          </div>
          <h2>เวลาออกจอของสินค้า</h2>
          <table>
            <thead>
              <tr>
                <th>สินค้า</th>
                <th>เวลาบนจอ</th>
                <th>ประโยคที่พูดถึง</th>
              </tr>
            </thead>
            <tbody>
              {sum.productAirtime.map((p) => (
                <tr key={p.productId}>
                  <td>{p.name}</td>
                  <td>
                    {Math.floor(p.secondsOnScreen / 60)}:{String(p.secondsOnScreen % 60).padStart(2, "0")}
                  </td>
                  <td>{p.mentions}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sum.topQuestions.length > 0 && (
            <>
              <h2>คำถามที่พบบ่อย</h2>
              <ol>
                {sum.topQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </>
          )}
          <h2>ข้อเสนอแนะ</h2>
          <ul>
            {sum.suggestions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h2>กรอกยอดจาก TikTok LIVE Studio / Seller Center</h2>
          <p className="note">* ตัวเลขที่มีดอกจันมาจากผู้ขายกรอกเอง แอปนี้ไม่ดึงข้อมูลจาก TikTok แบบไม่เป็นทางการ</p>
          <div className="row">
            {(["peakViewers", "orders", "gmv", "likes"] as const).map((k) => (
              <input key={k} type="number" min={0} placeholder={{ peakViewers: "ผู้ชมสูงสุด", orders: "คำสั่งซื้อ", gmv: "ยอดขาย (บาท)", likes: "ไลก์" }[k]} value={stats[k]} onChange={(e) => setStats({ ...stats, [k]: e.target.value })} />
            ))}
            <button onClick={save}>บันทึก</button>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, v }: { label: string; v: string | number }) {
  return (
    <div className="kpi">
      <div className="kv">{v}</div>
      <div className="kl">{label}</div>
    </div>
  );
}
