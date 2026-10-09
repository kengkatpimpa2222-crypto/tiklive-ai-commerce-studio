import type { VoiceConfig } from "@tlai/shared";
import { AZURE_THAI_VOICES } from "@tlai/tts";
import { useState } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/useData";

/** Ready-made voice characters built on Microsoft's Thai neural voices. */
const PRESETS: { label: string; voice: string; rate: number; pitch: number }[] = [
  { label: "สาววัยรุ่น สดใส", voice: "th-TH-PremwadeeNeural", rate: 1.1, pitch: 1.2 },
  { label: "สาวใส พูดเร็ว แม่ค้าไลฟ์", voice: "th-TH-PremwadeeNeural", rate: 1.2, pitch: 1.14 },
  { label: "ผู้หญิง นุ่มนวล", voice: "th-TH-AcharaNeural", rate: 1, pitch: 1.06 },
  { label: "หนุ่ม สดใส", voice: "th-TH-NiwatNeural", rate: 1.08, pitch: 1.06 },
];

interface SpeechView {
  hasKey: boolean;
  region: string;
  keyHint: string;
}

/** Azure voice choice for one character, with the one-time key setup when it is missing. */
export function VoicePicker({ voice, onChange }: { voice: VoiceConfig; onChange: (v: VoiceConfig) => void }) {
  const [svc, reload] = useData<SpeechView>("/speech-service", { hasKey: false, region: "", keyHint: "" });
  const [form, setForm] = useState({ key: "", region: "southeastasia" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const saveKey = async () => {
    setBusy(true);
    try {
      await api("/speech-service", { method: "PUT", body: form });
      setForm({ ...form, key: "" });
      setMsg("ใช้ key นี้ได้แล้ว");
      reload();
    } catch (e) {
      setMsg(`⚠ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="voice-picker">
      <div className="chips">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className={voice.voice === p.voice && voice.rate === p.rate && voice.pitch === p.pitch ? "primary" : ""}
            onClick={() => onChange({ ...voice, provider: "azure", voice: p.voice, rate: p.rate, pitch: p.pitch, lang: "th-TH" })}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label>
        เสียง
        <select value={voice.voice} onChange={(e) => onChange({ ...voice, voice: e.target.value })}>
          {!AZURE_THAI_VOICES.some((v) => v.id === voice.voice) && <option value="">เลือกเสียง</option>}
          {AZURE_THAI_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      {svc.hasKey ? (
        <small className="muted">
          ใช้ Azure Speech key {svc.keyHint} ({svc.region}){" "}
          <button onClick={() => api("/speech-service", { method: "DELETE" }).then(reload)}>ลบ key</button>
        </small>
      ) : (
        <div className="card form">
          <b>ตั้งค่าครั้งเดียว: Azure Speech key (ฟรี)</b>
          <ol className="note">
            <li>สมัคร Azure ที่ portal.azure.com (ต้องใช้บัตรเพื่อยืนยันตัวตน แต่แพ็กเกจ Free F0 ไม่ตัดเงิน)</li>
            <li>สร้าง "Speech service" เลือกราคา Free F0 และ region Southeast Asia</li>
            <li>เปิด "Keys and Endpoint" คัดลอก KEY 1 และ Location/Region มาวางด้านล่าง</li>
          </ol>
          <input placeholder="KEY 1" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.trim() })} />
          <input placeholder="Region เช่น southeastasia" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value.trim().toLowerCase() })} />
          <button className="primary" disabled={busy || form.key.length < 10} onClick={saveKey}>
            {busy ? "กำลังตรวจ key…" : "บันทึก key"}
          </button>
        </div>
      )}
      {msg && <span className="msg">{msg}</span>}
    </div>
  );
}
