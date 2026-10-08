import { AvatarController, type AvatarFrame } from "@tlai/avatar";
import type { HostCharacter, PhotoLook } from "@tlai/shared";
import { buildVisemeTimeline, estimateDurationMs } from "@tlai/tts";
import { useEffect, useRef, useState } from "react";
import { detectFace } from "../lib/faceDetect";
import { ImageUpload } from "../lib/ImageUpload";
import { PhotoAvatar } from "../stage/PhotoAvatar";

type Draft = Omit<PhotoLook, "consent"> & { consent: boolean };

/**
 * Turns one portrait photo into a realistic host. The face is found on this PC
 * (MediaPipe, bundled), then the stage animates the photo itself.
 */
export function PhotoHostEditor({ character, onChange }: { character: HostCharacter; onChange: (look: HostCharacter["look"]) => void }) {
  const look = character.look;
  const photo = look.photo as Draft | undefined;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onUpload = async (url: string) => {
    setErr("");
    if (!url) return onChange({ ...look, photo: undefined, style: "cartoon" });
    setBusy(true);
    try {
      const face = await detectFace(url);
      onChange({ ...look, style: "photo", photo: { imageUrl: url, ...face, consent: false } as unknown as PhotoLook });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="photo-host">
      <div className="col">
        <ImageUpload value={photo?.imageUrl} onChange={(u) => void onUpload(u)} label="เลือกรูปใบหน้า" />
        {busy && <p className="note">กำลังหาใบหน้าในรูป…</p>}
        {err && <p className="msg">⚠ {err}</p>}
        <ul className="note tips">
          <li>รูปหน้าตรง มองกล้อง ปากปิด เห็นหน้าชัด ไฟสว่างเท่ากัน</li>
          <li>รูปแนวตั้งครึ่งตัวจะเต็มจอสวยที่สุด ความละเอียดอย่างน้อย 1080 px</li>
          <li>ใช้ได้ทั้งรูปคนจริงที่ยินยอม หรือรูปคนที่สร้างด้วย AI ที่คุณมีสิทธิ์ใช้</li>
        </ul>
        {photo && (
          <label className="consent">
            <input type="checkbox" checked={photo.consent} onChange={(e) => onChange({ ...look, photo: { ...photo, consent: e.target.checked } as unknown as PhotoLook })} />
            ฉันเป็นเจ้าของรูปนี้ หรือบุคคลในรูปยินยอมให้ใช้เป็นตัวละคร AI ขายของ และไม่ใช่รูปคนดัง/บุคคลอื่นที่ไม่ได้อนุญาต
          </label>
        )}
        <p className="note">ป้าย "{character.disclosureLabel}" จะแสดงบนจอตลอดเวลา ผู้ชมจะรู้ว่าเป็นตัวละคร AI แม้หน้าตาจะเหมือนคนจริง</p>
      </div>
      {photo && <PhotoPreview photo={photo as unknown as PhotoLook} name={character.name} particle={character.politeParticle} />}
    </div>
  );
}

function PhotoPreview({ photo, name, particle }: { photo: PhotoLook; name: string; particle: string }) {
  const ctl = useRef(new AvatarController(11));
  const [frame, setFrame] = useState<AvatarFrame | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      setFrame(ctl.current.update(Math.min(64, t - last)));
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const talk = () => {
    const text = `สวัสดี${particle} ${name}เป็นตัวละคร AI ของร้าน วันนี้มีสินค้าดี ๆ มาแนะนำ${particle}`;
    const d = estimateDurationMs(text);
    ctl.current.setEmotion("happy", d);
    ctl.current.startSpeech(buildVisemeTimeline(text, d), d);
  };
  return (
    <div className="photo-preview">
      <div className="frame">{frame && <PhotoAvatar frame={frame} photo={photo} />}</div>
      <button onClick={talk}>ทดลองให้พูด</button>
    </div>
  );
}
