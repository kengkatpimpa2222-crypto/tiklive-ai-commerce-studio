import { useEffect, useState } from "react";
import { api } from "./api";

interface Capture {
  available: boolean;
  clipboardWatch?: boolean;
  sendClipboardHotkey?: string;
  quickAskHotkey?: string;
}

/** Desktop-only switches for getting viewer comments to the AI with as little effort as possible. */
export function CaptureToggle({ compact = false }: { compact?: boolean }) {
  const [cap, setCap] = useState<Capture | null>(null);
  useEffect(() => {
    const load = () => api<Capture>("/capture").then(setCap).catch(() => setCap({ available: false }));
    load();
    const t = window.setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  if (!cap) return null;
  if (!cap.available) return compact ? null : <p className="note">ปุ่มลัดและการคัดลอกคอมเมนต์ใช้ได้ในแอป Windows</p>;
  return (
    <div className={`capture ${cap.clipboardWatch ? "on" : ""}`}>
      <label className="switch">
        <input type="checkbox" checked={!!cap.clipboardWatch} onChange={(e) => api<Capture>("/capture", { method: "PATCH", body: { clipboardWatch: e.target.checked } }).then(setCap)} />
        <span>
          <b>คัดลอกคอมเมนต์ = AI ตอบทันที</b>
          <small>เปิดไว้แล้วกด Ctrl+C ที่คอมเมนต์ใน TikTok LIVE Studio (หรือที่ไหนก็ได้นอกแอปนี้) AI จะตอบให้เอง</small>
        </span>
      </label>
      {!compact && (
        <ul className="hotkeys">
          <li><kbd>{cap.sendClipboardHotkey}</kbd> ส่งข้อความที่คัดลอกไว้ให้ AI ตอบ (ใช้ได้ตลอด แม้ปิดสวิตช์)</li>
          <li><kbd>{cap.quickAskHotkey}</kbd> เปิดกล่องถามด่วนลอยเหนือทุกหน้าต่าง</li>
        </ul>
      )}
    </div>
  );
}
