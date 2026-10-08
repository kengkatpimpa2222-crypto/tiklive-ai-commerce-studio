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
            <label>
              ข้อความวิ่งด้านล่างจอ (เช่น เวลาส่งของ โปรประจำวัน) เว้นว่างเพื่อซ่อน
              <input value={stage.tickerText} maxLength={200} placeholder="ส่งทุกวัน ตัดรอบ 14:00 น. · สอบถามพิมพ์ในแชทได้เลย" onChange={(e) => change({ tickerText: e.target.value })} />
            </label>
            <label>
              ป้าย "เหลือ N ชิ้น" บนการ์ดสินค้า
              <select value={stage.lowStockAt} onChange={(e) => change({ lowStockAt: Number(e.target.value) })}>
                <option value={0}>ไม่แสดง</option>
                <option value={5}>เมื่อเหลือ 5 ชิ้นหรือน้อยกว่า</option>
                <option value={10}>เมื่อเหลือ 10 ชิ้นหรือน้อยกว่า</option>
                <option value={20}>เมื่อเหลือ 20 ชิ้นหรือน้อยกว่า</option>
              </select>
              <span className="muted">ใช้ตัวเลขสต็อกที่ใส่ไว้ในหน้าสินค้า อัปเดตให้ตรงกับร้านจริงเสมอ (ห้ามใส่ตัวเลขหลอกเพื่อเร่งคนซื้อ)</span>
            </label>
            <h3>เพลงพื้นหลัง</h3>
            <MusicUpload value={stage.bgmUrl} onChange={(url) => change({ bgmUrl: url })} />
            <Slider label="ความดังเพลง (ตอน AI พูด เพลงจะเบาลงเอง)" min={0} max={1} step={0.05} value={stage.bgmVolume} onChange={(v) => change({ bgmVolume: v })} />
            <p className="note">ใช้เพลงที่มีสิทธิ์ใช้ เช่น เพลงฟรีลิขสิทธิ์ หรือเพลงจากคลังเพลงของ TikTok LIVE Studio เพลงติดลิขสิทธิ์อาจทำให้ไลฟ์ถูกปิดเสียง</p>
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

/** Picks the seller's own music file and uploads it next to the app data. */
function MusicUpload({ value, onChange }: { value?: string; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = async (file: File) => {
    setErr("");
    if (file.size > 20 * 1024 * 1024) return setErr("ไฟล์ใหญ่เกิน 20 MB");
    setBusy(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const { url } = await api<{ url: string }>("/uploads", { body: { filename: file.name, dataBase64 } });
      onChange(url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row">
      {value ? <audio src={value} controls /> : <span className="muted">ยังไม่มีเพลง</span>}
      <button disabled={busy} onClick={() => input.current?.click()}>{busy ? "กำลังอัปโหลด…" : value ? "เปลี่ยนเพลง" : "เลือกไฟล์เพลง (mp3, m4a)"}</button>
      {value && <button onClick={() => onChange("")}>ลบเพลง</button>}
      <input ref={input} type="file" accept=".mp3,.m4a,.ogg,.wav,audio/*" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      {err && <span className="msg">⚠ {err}</span>}
    </div>
  );
}
