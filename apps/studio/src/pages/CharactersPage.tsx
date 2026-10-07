import type { HostCharacter } from "@tlai/shared";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/useData";

export function CharactersPage() {
  const [chars, reload] = useData<HostCharacter[]>("/characters", []);
  const [sel, setSel] = useState<HostCharacter | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    load();
    window.speechSynthesis?.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", load);
  }, []);
  useEffect(() => {
    if (!sel && chars[0]) setSel(chars[0]);
  }, [chars, sel]);

  if (!sel) return <div className="page">กำลังโหลด…</div>;
  const set = (patch: Partial<HostCharacter>) => setSel({ ...sel, ...patch });
  const save = async () => {
    try {
      const { id, ...body } = sel;
      await api(`/characters/${id}`, { method: "PATCH", body });
      setErr("บันทึกแล้ว");
      reload();
    } catch (e) {
      setErr(`⚠ ${(e as Error).message}`);
    }
  };
  const test = () => {
    const u = new SpeechSynthesisUtterance(`สวัสดี${sel.politeParticle} ${sel.name}เป็นตัวละคร AI ที่จะช่วยแนะนำสินค้า${sel.politeParticle}`);
    const v = voices.find((x) => x.name === sel.voice.voice) ?? voices.find((x) => x.lang.startsWith("th"));
    if (v) u.voice = v;
    u.lang = sel.voice.lang;
    u.rate = sel.voice.rate;
    u.pitch = sel.voice.pitch;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

  return (
    <div className="page">
      <h1>ตัวละคร AI</h1>
      <div className="chips">
        {chars.map((c) => (
          <button key={c.id} className={c.id === sel.id ? "on" : ""} onClick={() => setSel(c)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="form card">
        <label>ชื่อ <input value={sel.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label>
          ป้ายแจ้งว่าเป็น AI (แสดงบนจอตลอด ต้องมีคำว่า AI หรือ Virtual)
          <input value={sel.disclosureLabel} onChange={(e) => set({ disclosureLabel: e.target.value })} />
        </label>
        <label>บุคลิก <textarea value={sel.persona} onChange={(e) => set({ persona: e.target.value })} /></label>
        <label>
          คำลงท้าย
          <select value={sel.politeParticle} onChange={(e) => set({ politeParticle: e.target.value as "ค่ะ" | "ครับ" })}>
            <option>ค่ะ</option>
            <option>ครับ</option>
          </select>
        </label>
        <h2>เสียง</h2>
        <label>
          ผู้ให้บริการเสียง
          <select value={sel.voice.provider} onChange={(e) => set({ voice: { ...sel.voice, provider: e.target.value as "browser" | "openai" } })}>
            <option value="browser">เสียงในเครื่อง Windows (ฟรี ออฟไลน์)</option>
            <option value="openai">OpenAI-compatible TTS (ตั้งค่า API key ใน .env)</option>
          </select>
        </label>
        {sel.voice.provider === "browser" ? (
          <label>
            เสียง
            <select value={sel.voice.voice} onChange={(e) => set({ voice: { ...sel.voice, voice: e.target.value } })}>
              <option value="">อัตโนมัติ (เสียงภาษาไทยตัวแรก)</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
              ))}
            </select>
          </label>
        ) : (
          <label>Voice id <input value={sel.voice.voice} onChange={(e) => set({ voice: { ...sel.voice, voice: e.target.value } })} /></label>
        )}
        <div className="row">
          <label>ความเร็ว <input type="range" min={0.6} max={1.6} step={0.05} value={sel.voice.rate} onChange={(e) => set({ voice: { ...sel.voice, rate: Number(e.target.value) } })} /></label>
          <label>ระดับเสียง <input type="range" min={0.5} max={1.5} step={0.05} value={sel.voice.pitch} onChange={(e) => set({ voice: { ...sel.voice, pitch: Number(e.target.value) } })} /></label>
          <button onClick={test}>ทดลองเสียง</button>
        </div>
        <h2>หน้าตา</h2>
        <div className="row">
          {(["skin", "hair", "eyes", "outfit", "accent"] as const).map((k) => (
            <label key={k}>
              {{ skin: "ผิว", hair: "ผม", eyes: "ตา", outfit: "ชุด", accent: "เครื่องประดับ" }[k]}
              <input type="color" value={sel.look[k]} onChange={(e) => set({ look: { ...sel.look, [k]: e.target.value } })} />
            </label>
          ))}
        </div>
        <div className="row">
          <button className="primary" onClick={save}>บันทึก</button>
          {err && <span className="msg">{err}</span>}
        </div>
      </div>
    </div>
  );
}
