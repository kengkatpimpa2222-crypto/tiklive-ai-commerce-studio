import { AvatarController, type AvatarFrame } from "@tlai/avatar";
import type { HostCharacter, HostPreset } from "@tlai/shared";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "../stage/Avatar";
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

/** Ready-made hosts (2 women, 2 men) plus the photo option, shown at the top of the characters page. */
export function HostGallery({ onUse, onPhoto, busy }: { onUse: (presetId: string) => void; onPhoto: () => void; busy: boolean }) {
  const [presets] = useData<HostPreset[]>("/characters/presets", []);
  return (
    <div className="card">
      <h2>เลือกตัวละครสำเร็จรูป</h2>
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
          <b>เหมือนคนจริง</b>
          <small>ใช้รูปถ่ายหน้าตรงของคุณหรือคนที่ยินยอม (รูปที่สร้างด้วย AI ก็ได้)</small>
          <button onClick={onPhoto}>ใช้รูปถ่าย</button>
        </div>
      </div>
    </div>
  );
}
