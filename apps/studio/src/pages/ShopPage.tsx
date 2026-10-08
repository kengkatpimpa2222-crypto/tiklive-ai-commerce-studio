import type { FaqEntry, StudioSettings } from "@tlai/shared";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { ImageUpload } from "../lib/ImageUpload";
import { useData } from "../lib/useData";

type Stage = StudioSettings["stage"];

export function ShopPage() {
  const [faqs, reloadFaqs] = useData<FaqEntry[]>("/faqs", []);
  const [settings] = useData<StudioSettings | null>("/settings", null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [draft, setDraft] = useState({ id: "", topic: "", keywords: "", answer: "" });
  const [msg, setMsg] = useState("");
  const timer = useRef<number>();

  useEffect(() => {
    if (settings && !stage) setStage(settings.stage);
  }, [settings, stage]);

  // Save layout changes shortly after the last slider move; the stage updates live.
  const change = (patch: Partial<Stage>) => {
    if (!stage) return;
    setStage({ ...stage, ...patch });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api("/settings/stage", { method: "PATCH", body: patch }).catch((e: Error) => setMsg(`⚠ ${e.message}`));
    }, 150);
  };

  const saveFaq = async () => {
    const body = { topic: draft.topic, answer: draft.answer, keywords: draft.keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean) };
    try {
      await api(draft.id ? `/faqs/${draft.id}` : "/faqs", { method: draft.id ? "PATCH" : "POST", body });
      setDraft({ id: "", topic: "", keywords: "", answer: "" });
      setMsg("บันทึกคำตอบร้านแล้ว");
      reloadFaqs();
    } catch (e) {
      setMsg(`⚠ ${(e as Error).message}`);
    }
  };

  return (
    <div className="page two-col">
      <div>
        <h1>ข้อมูลร้าน (คำถามที่พบบ่อย)</h1>
        <p className="note">
          AI ใช้คำตอบเหล่านี้เมื่อผู้ชมถามเรื่องร้าน เช่น การจัดส่ง การชำระเงิน การคืนสินค้า โดยจับจากคำสำคัญในคำถาม คำตอบต้องตรงกับนโยบายจริงของร้าน และผ่านการตรวจคำโฆษณาก่อนเริ่มไลฟ์
          ระบบปรับคำลงท้าย ค่ะ/ครับ ให้ตรงกับตัวละครอัตโนมัติ
        </p>
        <table>
          <thead>
            <tr><th>หัวข้อ</th><th>คำสำคัญ</th><th>คำตอบ</th><th /></tr>
          </thead>
          <tbody>
            {faqs.map((f) => (
              <tr key={f.id}>
                <td><b>{f.topic}</b></td>
                <td className="muted">{f.keywords.join(", ")}</td>
                <td>{f.answer}</td>
                <td>
                  <button onClick={() => setDraft({ id: f.id, topic: f.topic, keywords: f.keywords.join(", "), answer: f.answer })}>แก้ไข</button>
                  <button onClick={() => api(`/faqs/${f.id}`, { method: "DELETE" }).then(reloadFaqs)}>ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="card form">
          <h2>{draft.id ? "แก้ไขคำตอบร้าน" : "เพิ่มคำตอบร้าน"}</h2>
          <input placeholder="หัวข้อ เช่น การจัดส่ง" value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} />
          <input placeholder="คำสำคัญ คั่นด้วยจุลภาค เช่น ส่ง, กี่วัน, ขนส่ง" value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} />
          <textarea placeholder="คำตอบที่ให้ AI พูด" value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} />
          <div className="row">
            <button className="primary" disabled={!draft.topic || !draft.keywords || !draft.answer} onClick={saveFaq}>บันทึก</button>
            {draft.id && <button onClick={() => setDraft({ id: "", topic: "", keywords: "", answer: "" })}>ยกเลิก</button>}
            {msg && <span className="msg">{msg}</span>}
          </div>
        </div>
      </div>

      <div>
        <h1>หน้าจอไลฟ์</h1>
        {stage && (
          <div className="card form">
            <label>
              ชื่อร้าน (แสดงมุมขวาบน)
              <input value={stage.shopName} maxLength={40} onChange={(e) => change({ shopName: e.target.value })} />
            </label>
            <label>
              ภาพพื้นหลัง (ถ้าไม่ใส่จะใช้สีของ Scene)
              <ImageUpload value={stage.backgroundImage} onChange={(url) => change({ backgroundImage: url || undefined })} label="เลือกภาพพื้นหลัง" />
            </label>
            <Slider label="ความมืดของพื้นหลัง" min={0} max={0.8} step={0.05} value={stage.backgroundDim} onChange={(v) => change({ backgroundDim: v })} />
            <Slider label="ขนาดตัวละคร" min={0.6} max={1.4} step={0.02} value={stage.avatarScale} onChange={(v) => change({ avatarScale: v })} />
            <Slider label="ตำแหน่งซ้าย-ขวา" min={-0.3} max={0.3} step={0.01} value={stage.avatarX} onChange={(v) => change({ avatarX: v })} />
            <Slider label="ตำแหน่งบน-ล่าง" min={-0.2} max={0.2} step={0.01} value={stage.avatarY} onChange={(v) => change({ avatarY: v })} />
            <label className="inline">
              <input type="checkbox" checked={stage.showCaptions} onChange={(e) => change({ showCaptions: e.target.checked })} /> แสดงคำบรรยายใต้ภาพ
            </label>
            <p className="note">ป้าย "AI Virtual Host" แสดงตลอดและปิดไม่ได้ เพื่อแจ้งผู้ชมว่าเป็นตัวละคร AI</p>
          </div>
        )}
        <div className="preview-frame small">
          <iframe title="stage-preview" src="#/stage?preview" />
        </div>
      </div>
    </div>
  );
}

function Slider({ label, value, onChange, ...r }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label>
      {label} <span className="muted">{value.toFixed(2)}</span>
      <input type="range" value={value} onChange={(e) => onChange(Number(e.target.value))} {...r} />
    </label>
  );
}
