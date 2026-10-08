import { AvatarController, type AvatarFrame } from "@tlai/avatar";
import type { HostCharacter, HostPreset } from "@tlai/shared";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "../stage/Avatar";
import { api } from "../lib/api";
import { useData } from "../lib/useData";

/** A small, idling copy of the cartoon host so the gallery shows each preset alive. */
function LivePreview({ character, seed }: { character: HostCharacter; seed: number }) {
  const ctl = useRef(new AvatarController(seed));
  const [frame, setFrame] = useState<AvatarFrame>(() => ctl.current.update(16));
  useEffect(() => {
    ctl.current.setEnergy(character.energy);
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      setFrame(ctl.current.update(Math.min(64, t - last)));
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [character.energy]);
  return (
    <div className="gallery-preview">
      <Avatar frame={frame} character={character} />
    </div>
  );
}

interface ServiceView {
  hasKey: boolean;
  keyHint: string;
}
interface Presenter {
  id: string;
  name: string;
  gender: string;
  imageUrl: string;
  previewUrl?: string;
}

/** Realistic hosts from D-ID's stock presenters; the seller's own key unlocks them. */
function RealisticHosts({ onUsed }: { onUsed: (c: HostCharacter) => void }) {
  const [view, reloadView] = useData<ServiceView | null>("/avatar-service", null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [presenters, setPresenters] = useState<Presenter[] | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [gender, setGender] = useState("all");
  const [hover, setHover] = useState("");

  useEffect(() => {
    if (!view?.hasKey) return;
    api<Presenter[]>("/avatar-service/presenters").then(setPresenters, (e: Error) => setMsg(`⚠ ${e.message}`));
    api<{ remaining: number }>("/avatar-service/test", { method: "POST" }).then((r) => setCredits(r.remaining), () => undefined);
  }, [view?.hasKey]);

  const saveKey = async (apiKey: string) => {
    setBusy(true);
    setMsg(apiKey ? "กำลังตรวจ API key…" : "");
    try {
      await api("/avatar-service", { method: "PUT", body: { apiKey } });
      setKey("");
      setMsg(apiKey ? "ใช้ได้แล้ว เลือกตัวละครด้านล่าง" : "ลบ API key แล้ว");
      setPresenters(null);
      reloadView();
    } catch (e) {
      setMsg(`⚠ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const use = async (p: Presenter) => {
    setBusy(true);
    setMsg(`กำลังสร้าง "${p.name}"…`);
    try {
      const c = await api<HostCharacter>("/avatar-service/use", { body: { presenterId: p.id, name: p.name, gender: p.gender, imageUrl: p.imageUrl } });
      setMsg("");
      onUsed(c);
    } catch (e) {
      setMsg(`⚠ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!view) return null;
  if (!view.hasKey)
    return (
      <div className="realistic-setup">
        <h3>ตัวละครคนจริง (บริการอวตาร AI ของ D-ID)</h3>
        <p className="muted">หน้าเหมือนคนจริง ขยับปากตรงเสียง พูดไทยได้ เสียค่าบริการกับ D-ID ตามนาทีที่พูด</p>
        <ol>
          <li>สมัครที่ <b>studio.d-id.com</b> แล้วเลือกแพ็กเกจ API ที่มี Streaming</li>
          <li>ไปที่เมนู API (มุมขวาบน → API Key) กด Generate แล้วคัดลอก key</li>
          <li>วาง key ด้านล่าง แล้วกดบันทึก</li>
        </ol>
        <div className="row">
          <input type="password" placeholder="วาง API key ของ D-ID" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="primary" disabled={busy || !key.trim()} onClick={() => saveKey(key.trim())}>บันทึก</button>
        </div>
        {msg && <p className="msg">{msg}</p>}
      </div>
    );
  const shown = (presenters ?? []).filter((p) => gender === "all" || p.gender === gender);
  return (
    <div className="realistic-setup">
      <h3>ตัวละครคนจริง (D-ID)</h3>
      <div className="row">
        <span className="muted">
          key {view.keyHint}
          {credits !== null && ` · เครดิตคงเหลือ ${credits}`}
        </span>
        <div className="chips">
          {([["all", "ทั้งหมด"], ["female", "ผู้หญิง"], ["male", "ผู้ชาย"]] as const).map(([g, l]) => (
            <button key={g} className={gender === g ? "on" : ""} onClick={() => setGender(g)}>{l}</button>
          ))}
        </div>
        <button disabled={busy} onClick={() => saveKey("")}>ลบ key</button>
      </div>
      {msg && <p className="msg">{msg}</p>}
      {presenters === null ? (
        <p className="muted">กำลังโหลดรายชื่อตัวละคร…</p>
      ) : (
        <div className="host-gallery">
          {shown.map((p) => (
            <div key={p.id} className="gallery-card" onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover("")}>
              <div className="gallery-preview real">
                {hover === p.id && p.previewUrl ? <video src={p.previewUrl} autoPlay muted loop playsInline /> : <img src={p.imageUrl} alt="" loading="lazy" />}
              </div>
              <b>{p.name}</b>
              <small>{p.gender === "male" ? "ผู้ชาย · เสียงไทย นิวัฒน์" : "ผู้หญิง · เสียงไทย เปรมวดี"}</small>
              <button className="primary" disabled={busy} onClick={() => use(p)}>ใช้ตัวนี้</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ready-made hosts (2 women, 2 men), realistic service hosts and the photo option, shown at the top of the characters page. */
export function HostGallery({ onUse, onPhoto, onUsedService, busy }: { onUse: (presetId: string) => void; onPhoto: () => void; onUsedService: (c: HostCharacter) => void; busy: boolean }) {
  const [presets] = useData<HostPreset[]>("/characters/presets", []);
  return (
    <div className="card">
      <RealisticHosts onUsed={onUsedService} />
      <h3>ตัวการ์ตูนสำเร็จรูป (ฟรี)</h3>
      <p className="muted">กด "ใช้ตัวนี้" แล้วตัวละครจะถูกเพิ่มเข้าไปและตั้งเป็นพิธีกรหลักทันที ปรับชื่อ เสียง สีได้ด้านล่าง</p>
      <div className="host-gallery">
        {presets.map((p, i) => (
          <div key={p.id} className="gallery-card">
            <LivePreview character={{ id: p.id, ...p.character }} seed={11 + i * 37} />
            <b>{p.character.name}</b>
            <small>{p.tagline}</small>
            <button className="primary" disabled={busy} onClick={() => onUse(p.id)}>ใช้ตัวนี้</button>
          </div>
        ))}
        <div className="gallery-card photo">
          <div className="gallery-preview photo-slot">📷</div>
          <b>จากรูปถ่าย</b>
          <small>ใช้รูปถ่ายหน้าตรงของคุณหรือคนที่ยินยอม (รูปที่สร้างด้วย AI ก็ได้)</small>
          <button onClick={onPhoto}>ใช้รูปถ่าย</button>
        </div>
      </div>
    </div>
  );
}
