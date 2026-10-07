import type { LiveScript, Product, Promotion, Scene, ScriptStep } from "@tlai/shared";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/useData";

const KIND_TH: Record<ScriptStep["kind"], string> = {
  say: "พูด", show_product: "แสดงสินค้า", pitch_product: "AI แนะนำสินค้า", read_promo: "อ่านโปรโมชั่น", scene: "เปลี่ยน Scene", pause: "หยุดพัก", qa_window: "ช่วงตอบคำถาม",
};

export function ScriptsPage() {
  const [scripts, reload] = useData<LiveScript[]>("/scripts", []);
  const [products] = useData<Product[]>("/products", []);
  const [promos] = useData<Promotion[]>("/promotions", []);
  const [scenes] = useData<Scene[]>("/scenes", []);
  const [sel, setSel] = useState<LiveScript | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!sel && scripts[0]) setSel(scripts[0]);
  }, [scripts, sel]);

  const setStep = (i: number, s: ScriptStep) => sel && setSel({ ...sel, steps: sel.steps.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, d: number) => {
    if (!sel) return;
    const steps = [...sel.steps];
    const [s] = steps.splice(i, 1);
    steps.splice(Math.max(0, Math.min(steps.length, i + d)), 0, s!);
    setSel({ ...sel, steps });
  };
  const add = (kind: ScriptStep["kind"]) => {
    if (!sel) return;
    const p = products[0]?.id ?? "";
    const step: ScriptStep =
      kind === "say" ? { kind, text: "" }
      : kind === "show_product" || kind === "pitch_product" ? { kind, productId: p }
      : kind === "read_promo" ? { kind, promotionId: promos[0]?.id ?? "" }
      : kind === "scene" ? { kind, sceneId: scenes[0]?.id ?? "" }
      : kind === "pause" ? { kind, ms: 2000 }
      : { kind: "qa_window", maxQuestions: 3 };
    setSel({ ...sel, steps: [...sel.steps, step] });
  };
  const save = async () => {
    if (!sel) return;
    try {
      const { id, ...body } = sel;
      if (id) await api(`/scripts/${id}`, { method: "PATCH", body });
      else setSel(await api<LiveScript>("/scripts", { body }));
      setMsg("บันทึกแล้ว");
      reload();
    } catch (e) {
      setMsg(`⚠ ${(e as Error).message}`);
    }
  };

  return (
    <div className="page">
      <h1>สคริปต์ไลฟ์</h1>
      <div className="chips">
        {scripts.map((s) => (
          <button key={s.id} className={s.id === sel?.id ? "on" : ""} onClick={() => setSel(s)}>{s.title}</button>
        ))}
        <button onClick={() => setSel({ id: "", title: "สคริปต์ใหม่", onEnd: "free_talk", steps: [] })}>+ สคริปต์ใหม่</button>
      </div>
      {sel && (
        <div className="card">
          <div className="row">
            <input value={sel.title} onChange={(e) => setSel({ ...sel, title: e.target.value })} />
            <select value={sel.onEnd} onChange={(e) => setSel({ ...sel, onEnd: e.target.value as LiveScript["onEnd"] })}>
              <option value="free_talk">จบแล้วคุยต่อเรื่องสินค้าปัจจุบัน</option>
              <option value="loop">จบแล้ววนใหม่</option>
              <option value="stop">จบแล้วรอคำสั่ง</option>
            </select>
          </div>
          <ol className="steps">
            {sel.steps.map((s, i) => (
              <li key={i}>
                <span className="kind">{KIND_TH[s.kind]}</span>
                {s.kind === "say" && <textarea value={s.text} onChange={(e) => setStep(i, { ...s, text: e.target.value })} />}
                {(s.kind === "show_product" || s.kind === "pitch_product") && (
                  <select value={s.productId} onChange={(e) => setStep(i, { ...s, productId: e.target.value })}>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                {s.kind === "read_promo" && (
                  <select value={s.promotionId} onChange={(e) => setStep(i, { ...s, promotionId: e.target.value })}>
                    {promos.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                )}
                {s.kind === "scene" && (
                  <select value={s.sceneId} onChange={(e) => setStep(i, { ...s, sceneId: e.target.value })}>
                    {scenes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                {s.kind === "pause" && <input type="number" value={s.ms} onChange={(e) => setStep(i, { ...s, ms: Number(e.target.value) })} />}
                {s.kind === "qa_window" && <input type="number" min={1} max={20} value={s.maxQuestions} onChange={(e) => setStep(i, { ...s, maxQuestions: Number(e.target.value) })} />}
                <button onClick={() => move(i, -1)}>↑</button>
                <button onClick={() => move(i, 1)}>↓</button>
                <button onClick={() => setSel({ ...sel, steps: sel.steps.filter((_, j) => j !== i) })}>✕</button>
              </li>
            ))}
          </ol>
          <div className="chips">
            {(Object.keys(KIND_TH) as ScriptStep["kind"][]).map((k) => (
              <button key={k} onClick={() => add(k)}>+ {KIND_TH[k]}</button>
            ))}
          </div>
          <div className="row">
            <button className="primary" onClick={save}>บันทึก</button>
            {msg && <span className="msg">{msg}</span>}
          </div>
          <p className="note">ประโยคที่ผิดกฎ (การันตีผล อ้างสรรพคุณการแพทย์ ราคาไม่ตรง อ้างว่าเป็นคนจริง) จะไม่ผ่านการตรวจก่อนเริ่มไลฟ์</p>
        </div>
      )}
    </div>
  );
}
