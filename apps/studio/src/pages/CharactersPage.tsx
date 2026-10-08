import type { HairStyle, HostCharacter, HostEnergy } from "@tlai/shared";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/useData";
import { HostGallery } from "./HostGallery";
import { PhotoHostEditor } from "./PhotoHostEditor";

export function CharactersPage() {
  const [chars, reload] = useData<HostCharacter[]>("/characters", []);
  const [sel, setSel] = useState<HostCharacter | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [err, setErr] = useState("");
  const [main, reloadMain] = useData<{ id: string | null }>("/characters/main", { id: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    load();
    window.speechSynthesis?.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", load);
  }, []);
  useEffect(() => {
    if (sel || !chars[0]) return;
    // Arriving from the control room's "realistic host" button opens the photo editor straight away.
    setSel(location.hash.includes("/photo") ? { ...chars[0], look: { ...chars[0].look, style: "photo" } } : chars[0]);
  }, [chars, sel]);

  useEffect(() => {
    if (sel && location.hash.includes("/photo")) document.getElementById("look")?.scrollIntoView({ behavior: "smooth" });
  }, [!!sel]);

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
  const usePreset = async (presetId: string) => {
    setBusy(true);
    try {
      const c = await api<HostCharacter>(`/characters/presets/${presetId}/use`, { method: "POST" });
      reload();
      reloadMain();
      setSel(c);
      setErr(`เพิ่ม "${c.name}" แล้ว และตั้งเป็นพิธีกรหลัก`);
      document.getElementById("editor")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setErr(`⚠ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const makeMain = async () => {
    try {
      await api("/characters/main", { method: "PUT", body: { id: sel.id } });
      reloadMain();
      setErr(`ตั้ง "${sel.name}" เป็นพิธีกรหลักแล้ว`);
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
      <h2>เลือกตัวละครสำเร็จรูป</h2>
      <HostGallery
        busy={busy}
        onUsedService={(c) => {
          reload();
          reloadMain();
          setSel(c);
          setErr(`เพิ่ม "${c.name}" แล้ว และตั้งเป็นพิธีกรหลัก`);
          document.getElementById("editor")?.scrollIntoView({ behavior: "smooth" });
        }}
        onUse={usePreset}
        onPhoto={() => {
          set({ look: { ...sel.look, style: "photo" } });
          setTimeout(() => document.getElementById("look")?.scrollIntoView({ behavior: "smooth" }), 50);
        }}
      />
      <h2 id="editor">ตัวละครของฉัน</h2>
      <div className="chips">
        {chars.map((c) => (
          <button key={c.id} className={c.id === sel.id ? "on" : ""} onClick={() => setSel(c)}>
            {c.id === main.id ? "★ " : ""}
            {c.name}
          </button>
        ))}
      </div>
      <p className="muted">★ = พิธีกรหลัก ตัวนี้จะขึ้นไลฟ์เมื่อกด "เริ่มไลฟ์อัตโนมัติ"</p>
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
        <label>
          พลังงานตอนไลฟ์
          <select value={sel.energy ?? "high"} onChange={(e) => set({ energy: e.target.value as HostEnergy })}>
            <option value="high">สดใส มีพลัง ขยับมือบ่อย พูดเร็วขึ้นนิด (แนะนำสำหรับไลฟ์ขายของ)</option>
            <option value="normal">ปกติ</option>
            <option value="calm">สุขุม ใจเย็น</option>
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
        <h2 id="look">หน้าตา</h2>
        {sel.look.style === "service" && sel.look.service ? (
          <div className="row service-look">
            <img src={sel.look.service.imageUrl} alt="" />
            <div>
              <p>ตัวละครคนจริงจาก D-ID หน้าตา การขยับปาก และเสียงมาจากบริการ (ใช้เครดิต D-ID ตอนพูด)</p>
              <label>
                เสียงพากย์ไทย
                <select value={sel.look.service.voiceId} onChange={(e) => set({ look: { ...sel.look, service: { ...sel.look.service!, voiceId: e.target.value } } })}>
                  <option value="th-TH-PremwadeeNeural">เปรมวดี (ผู้หญิง)</option>
                  <option value="th-TH-AcharaNeural">อัจฉรา (ผู้หญิง)</option>
                  <option value="th-TH-NiwatNeural">นิวัฒน์ (ผู้ชาย)</option>
                </select>
              </label>
              <p className="muted">หมายเหตุ: เปลี่ยนเสียงได้ แต่หน้าตาเปลี่ยนไม่ได้ ถ้าอยากได้คนอื่นให้เลือกใหม่จากคลังด้านบน</p>
            </div>
          </div>
        ) : (
        <>
        <div className="chips">
          <button className={sel.look.style !== "photo" ? "on" : ""} onClick={() => set({ look: { ...sel.look, style: "cartoon" } })}>ตัวการ์ตูน</button>
          <button className={sel.look.style === "photo" ? "on" : ""} onClick={() => set({ look: { ...sel.look, style: "photo" } })}>เหมือนคนจริง (จากรูปถ่าย)</button>
        </div>
        {sel.look.style === "photo" ? (
          <PhotoHostEditor character={sel} onChange={(look) => set({ look })} />
        ) : (
        <div className="row">
          <label>
            ทรงผม
            <select value={sel.look.hairStyle ?? "long"} onChange={(e) => set({ look: { ...sel.look, hairStyle: e.target.value as HairStyle } })}>
              <option value="long">ผมยาว</option>
              <option value="bob">ผมบ็อบ</option>
              <option value="ponytail">หางม้า</option>
              <option value="short">ผมสั้น (ชาย)</option>
              <option value="side">ผมปัดข้าง (ชาย)</option>
            </select>
          </label>
          {(["skin", "hair", "eyes", "outfit", "accent"] as const).map((k) => (
            <label key={k}>
              {{ skin: "ผิว", hair: "ผม", eyes: "ตา", outfit: "ชุด", accent: "เครื่องประดับ" }[k]}
              <input type="color" value={sel.look[k]} onChange={(e) => set({ look: { ...sel.look, [k]: e.target.value } })} />
            </label>
          ))}
        </div>
        )}
        </>
        )}
        <div className="row">
          <button className="primary" onClick={save}>บันทึก</button>
          {sel.id !== main.id && <button onClick={makeMain}>ตั้งเป็นพิธีกรหลัก</button>}
          {err && <span className="msg">{err}</span>}
        </div>
      </div>
    </div>
  );
}
