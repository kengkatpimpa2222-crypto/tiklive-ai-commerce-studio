import { useRef, useState } from "react";
import { api } from "./api";

/** Picks an image from disk, uploads it to the local app and returns its /uploads URL. */
export function ImageUpload({ value, onChange, label = "เลือกรูป" }: { value?: string; onChange: (url: string) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const pick = async (file: File) => {
    setErr("");
    if (file.size > 5 * 1024 * 1024) return setErr("ไฟล์ใหญ่เกิน 5 MB");
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
    <div className="image-upload">
      <div className="thumb" onClick={() => input.current?.click()}>
        {value ? <img src={value} alt="" /> : <span>ไม่มีรูป</span>}
      </div>
      <div className="col">
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "กำลังอัปโหลด…" : label}
        </button>
        {value && (
          <button type="button" onClick={() => onChange("")}>
            เอารูปออก
          </button>
        )}
        {err && <span className="msg">⚠ {err}</span>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
    </div>
  );
}
