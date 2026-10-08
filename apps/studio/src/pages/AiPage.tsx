import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/useData";

type Provider = "off" | "claude" | "openai" | "gemini" | "custom";
interface Preset {
  label: string;
  baseUrl: string;
  models: { id: string; note: string }[];
  keyUrl: string;
  priceUrl: string;
}
interface AiView {
  provider: Provider;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  keyHint: string;
  source: "settings" | "env" | "off";
  active: boolean;
  usage: { calls: number; errors: number; inputTokens: number; outputTokens: number; lastError: string | null; since: string };
  presets: Record<Exclude<Provider, "off">, Preset>;
}

const fmt = (n: number) => n.toLocaleString("th-TH");

/** Where the host's words come from: an AI service the shop pays for, or the free offline wording. */
export function AiPage() {
  const [view, reload] = useData<AiView | null>("/ai", null);
  const [form, setForm] = useState({ provider: "claude" as Provider, model: "", baseUrl: "", apiKey: "" });
  const [msg, setMsg] = useState("");
  const [sample, setSample] = useState<{ text: string; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (view && view.provider !== "off") setForm((f) => ({ ...f, provider: view.provider, model: view.model, baseUrl: view.baseUrl }));
  }, [view?.provider, view?.model, view?.baseUrl]);
  // Usage counters move during a LIVE.
  useEffect(() => {
    const t = window.setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload]);

  if (!view) return <div className="page">กำลังโหลด…</div>;
  const preset = form.provider !== "off" ? view.presets[form.provider] : null;
  const sameProvider = view.provider === form.provider;
  const body = () => ({ provider: form.provider, model: form.model, baseUrl: form.baseUrl, ...(form.apiKey || !sameProvider ? { apiKey: form.apiKey } : {}) });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setMsg(`⚠ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const test = () =>
    run(async () => {
      setSample(null);
      setSample(await api<{ text: string; ms: number }>("/ai/test", { body: body() }));
    });
  const save = () =>
    run(async () => {
      await api("/ai", { method: "PUT", body: body() });
      setForm((f) => ({ ...f, apiKey: "" }));
      setMsg("บันทึกแล้ว ตั้งแต่ประโยคถัดไป AI จะคิดคำพูดเอง");
      reload();
    });
  const turnOff = () =>
    run(async () => {
      await api("/ai", { method: "PUT", body: { provider: "off" } });
      setMsg("ปิดแล้ว ตัวละครกลับไปใช้ประโยคสำเร็จรูปแบบออฟไลน์");
      reload();
    });
  const u = view.usage;
  const tokens = u.inputTokens + u.outputTokens;

  return (
    <div className="page two-col">
      <div>
        <h1>สมอง AI (ให้ตัวละครคิดคำพูดเอง)</h1>
        <div className="row">
          {view.active ? (
            <span className="pill on">● เปิดอยู่ AI คิดคำพูดเองทุกประโยค ({view.source === "env" ? "ตั้งค่าจากระบบ" : view.presets[view.provider as Exclude<Provider, "off">]?.label} {view.model})</span>
          ) : (
            <span className="pill off">● ยังไม่เปิด ตอนนี้ใช้ประโยคสำเร็จรูปแบบออฟไลน์ (สลับคำไม่ซ้ำ แต่ไม่ได้คิดเอง)</span>
          )}
        </div>
        <p className="note">
          เมื่อเปิดใช้ ตัวละครจะคิดประโยคใหม่เองทุกครั้งจากข้อมูลสินค้า โปรโมชั่น และข้อมูลร้านที่คุณใส่ไว้ ทั้งตอนแนะนำสินค้า พูดคั่นรายการ อ่านโปร และตอบคำถามลูกค้า
          โดยจำได้ว่าเพิ่งพูดอะไรไปเพื่อไม่ให้พูดซ้ำ ทุกประโยคยังผ่านการตรวจเหมือนเดิม (ราคาต้องตรง ห้ามอ้างเกินจริง ห้ามบอกว่าเป็นคนจริง) ถ้า AI ตอบช้าเกิน 15 วินาที ตอบผิดกฎ
          หรืออินเทอร์เน็ตหลุด ระบบจะใช้ประโยคสำเร็จรูปแทนทันที ไลฟ์ไม่สะดุด
        </p>

        <div className="card form ai-form">
          <h2>1. เลือกผู้ให้บริการ AI</h2>
          <div className="row">
            {(Object.keys(view.presets) as Exclude<Provider, "off">[]).map((p) => (
              <button key={p} className={form.provider === p ? "primary" : ""} onClick={() => setForm({ provider: p, model: view.presets[p].models[0]?.id ?? "", baseUrl: "", apiKey: "" })}>
                {view.presets[p].label}
              </button>
            ))}
          </div>
          {preset && preset.models.length > 0 && (
            <label>
              โมเดล
              <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
                {preset.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} ({m.note})
                  </option>
                ))}
              </select>
            </label>
          )}
          {form.provider === "custom" && (
            <>
              <input placeholder="ที่อยู่ API เช่น http://localhost:11434/v1 (Ollama) หรือ https://openrouter.ai/api/v1" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
              <input placeholder="ชื่อโมเดล" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </>
          )}

          <h2>2. ใส่ API key</h2>
          <input
            type="password"
            autoComplete="off"
            placeholder={sameProvider && view.hasKey ? `ใช้ key เดิม (${view.keyHint}) หรือวาง key ใหม่` : form.provider === "custom" ? "API key (ถ้ามี)" : "วาง API key ที่นี่"}
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          />
          {preset?.keyUrl && (
            <p className="muted">
              สร้าง key ได้ที่ <a href={preset.keyUrl} target="_blank" rel="noreferrer">{preset.keyUrl}</a> key เก็บไว้ในเครื่องนี้เท่านั้น ส่งไปที่ผู้ให้บริการที่เลือกตอนเรียกใช้ ไม่ส่งไปที่อื่น
            </p>
          )}

          <h2>3. ทดสอบแล้วเปิดใช้</h2>
          <div className="row">
            <button disabled={busy} onClick={test}>{busy ? "กำลังลอง…" : "ทดลองให้ AI คิดประโยค"}</button>
            <button className="primary" disabled={busy} onClick={save}>บันทึกและเปิดใช้</button>
            {view.active && <button disabled={busy} onClick={turnOff}>ปิด ใช้แบบออฟไลน์</button>}
          </div>
          {sample && (
            <div className="ai-sample">
              <b>AI พูดว่า:</b> {sample.text} <span className="muted">({(sample.ms / 1000).toFixed(1)} วินาที)</span>
            </div>
          )}
          {msg && <div className="msg">{msg}</div>}
        </div>
      </div>

      <div>
        <div className="card">
          <h2>ต้องเตรียมอะไร และค่าใช้จ่าย</h2>
          <ul className="ai-help">
            <li>บัญชีกับผู้ให้บริการ AI หนึ่งเจ้า และ API key (เหมือนรหัสผ่านสำหรับโปรแกรม)</li>
            <li>ค่าใช้จ่ายจ่ายให้ผู้ให้บริการโดยตรงตามจำนวนที่ใช้ (คิดเป็น token) ส่วนใหญ่ต้องเติมเครดิตล่วงหน้าด้วยบัตร โปรแกรมนี้ไม่เก็บเงินเพิ่ม</li>
            <li>ไลฟ์ 1 ชั่วโมง AI พูดประมาณ 150-250 ครั้ง ดูจำนวน token ที่ใช้จริงได้ที่ช่องด้านล่าง แล้วเทียบกับราคาของผู้ให้บริการ{preset?.priceUrl && <> (<a href={preset.priceUrl} target="_blank" rel="noreferrer">ดูราคา</a>)</>}</li>
            <li>อยากประหยัด: เลือกโมเดลที่เขียนว่า "ถูกกว่า" หรือใช้ Gemini ที่มีโควตาฟรีรายวัน อยากได้ภาษาไทยลื่นที่สุด: Claude Sonnet</li>
            <li>ตั้งวงเงินสูงสุดต่อเดือนในหน้าเว็บของผู้ให้บริการไว้ด้วย กันค่าใช้จ่ายบานปลาย</li>
            <li>ต้องต่ออินเทอร์เน็ตตลอดไลฟ์ ถ้าหลุด ตัวละครยังพูดต่อได้ด้วยประโยคสำเร็จรูป</li>
          </ul>
        </div>
        <div className="card">
          <h2>การใช้งานตั้งแต่เปิดโปรแกรม</h2>
          <table>
            <tbody>
              <tr><td>AI คิดประโยคไปแล้ว</td><td><b>{fmt(u.calls)}</b> ครั้ง</td></tr>
              <tr><td>token ที่ใช้ (ส่ง / รับ)</td><td><b>{fmt(u.inputTokens)}</b> / <b>{fmt(u.outputTokens)}</b></td></tr>
              <tr><td>เฉลี่ยต่อประโยค</td><td>{u.calls ? fmt(Math.round(tokens / u.calls)) : "-"} token</td></tr>
              <tr><td>เรียกไม่สำเร็จ (ใช้ประโยคสำรองแทน)</td><td>{fmt(u.errors)} ครั้ง</td></tr>
            </tbody>
          </table>
          {u.lastError && <p className="msg">⚠ ล่าสุด: {u.lastError}</p>}
        </div>
      </div>
    </div>
  );
}
