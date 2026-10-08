import type { ViewerQuestion } from "@tlai/shared";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { CaptureToggle } from "../lib/CaptureToggle";

interface Director {
  status: "idle" | "running" | "paused";
  qaMode: "auto" | "review";
}

const STATUS_TH: Record<ViewerQuestion["status"], string> = { pending: "รอคิว", answered: "ตอบแล้ว", skipped: "ข้าม", blocked: "ไม่ตอบ (สแปม/ลิงก์)" };

/**
 * The always-on-top box the operator keeps beside TikTok LIVE Studio. Type (or paste)
 * what a viewer asked, press Enter, and the AI host answers on air.
 */
export function QuickAskPage() {
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");
  const [list, setList] = useState<ViewerQuestion[]>([]);
  const [d, setD] = useState<Director | null>(null);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "ถามด่วน (AI ตอบ)";
    const load = () => {
      api<ViewerQuestion[]>("/questions").then((q) => setList(q.slice(0, 8))).catch(() => {});
      api<Director>("/director").then(setD).catch(() => {});
    };
    load();
    const t = window.setInterval(load, 1500);
    return () => clearInterval(t);
  }, []);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      const q = await api<ViewerQuestion>("/questions", { body: { text: t, author: author.trim() || undefined, source: "quick" } });
      setList((l) => [q, ...l].slice(0, 8));
      setText("");
      setAuthor("");
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
    input.current?.focus();
  };

  return (
    <div className="quick">
      <header>
        <b>ถามด่วน</b>
        <span className={`pill ${d?.status === "running" ? "live" : ""}`}>{d?.status === "running" ? "กำลัง LIVE" : d?.status === "paused" ? "พักอยู่" : "ยังไม่เริ่ม LIVE"}</span>
      </header>
      {d?.qaMode === "review" && (
        <div className="warn">
          ตอนนี้ตั้งเป็น "ให้คนอนุมัติก่อน" คำถามจะรอในห้องควบคุม{" "}
          <button onClick={() => api("/director/qa-mode", { body: { mode: "auto" } }).then(() => setD({ ...d, qaMode: "auto" }))}>ให้ AI ตอบเองเลย</button>
        </div>
      )}
      <input ref={input} autoFocus className="big" placeholder="พิมพ์หรือวางคำถามลูกค้า แล้วกด Enter" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void send()} />
      <div className="row">
        <input placeholder="ชื่อลูกค้า (ไม่บังคับ)" value={author} onChange={(e) => setAuthor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void send()} />
        <button className="primary" onClick={() => void send()}>ส่งให้ AI ตอบ</button>
      </div>
      {err && <div className="warn">{err}</div>}
      <CaptureToggle compact />
      <ul className="recent">
        {list.map((q) => (
          <li key={q.id} className={q.status}>
            <div>
              {q.author && <b>{q.author}: </b>}
              {q.text}
            </div>
            <small>{STATUS_TH[q.status]}{q.answer ? ` · ${q.answer}` : ""}</small>
          </li>
        ))}
        {list.length === 0 && <li className="empty">ยังไม่มีคำถาม</li>}
      </ul>
    </div>
  );
}
