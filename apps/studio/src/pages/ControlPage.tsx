import { EMOTIONS, GESTURES, type HostCharacter, type LiveScript, type LiveSession, type Product, type Promotion, type Scene, type ViewerQuestion } from "@tlai/shared";
import { useEffect, useState } from "react";
import { api, connect } from "../lib/api";
import { useData } from "../lib/useData";

interface DirectorState {
  sessionId: string | null;
  status: "idle" | "running" | "paused";
  speaking: { text: string; source: string } | null;
  queue: { id: string; text: string; source: string }[];
  currentProductId: string | null;
  sceneId: string | null;
  scriptIndex: number;
  scriptLength: number;
  qaMode: "auto" | "review";
  stageConnected: boolean;
  lastBlocked: string | null;
}
interface PreflightItem {
  code: string;
  ok: boolean;
  severity: "block" | "warn";
  message: string;
}

const GESTURE_TH: Record<string, string> = { none: "-", wave: "โบกมือ", point_product: "ชี้สินค้า", nod: "พยักหน้า", open_palms: "แบมือ", count_fingers: "นับนิ้ว", thumbs_up: "ยกนิ้ว", heart_hands: "มือหัวใจ", think_chin: "ครุ่นคิด" };
const EMOTION_TH: Record<string, string> = { neutral: "ปกติ", happy: "ยิ้ม", excited: "ตื่นเต้น", thinking: "คิด", surprised: "ประหลาดใจ", calm: "สงบ", apologetic: "ขอโทษ" };

export function ControlPage() {
  const [sessions, reloadSessions] = useData<LiveSession[]>("/live", []);
  const [products] = useData<Product[]>("/products", []);
  const [promos] = useData<Promotion[]>("/promotions", []);
  const [scenes] = useData<Scene[]>("/scenes", []);
  const [characters] = useData<HostCharacter[]>("/characters", []);
  const [scripts] = useData<LiveScript[]>("/scripts", []);
  const [questions, reloadQuestions] = useData<ViewerQuestion[]>("/questions", []);
  const [state, setState] = useState<DirectorState | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [preflight, setPreflight] = useState<PreflightItem[] | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [sayText, setSayText] = useState("");
  const [qText, setQText] = useState("");
  const [qAuthor, setQAuthor] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ title: "", characterId: "", scriptId: "", productIds: [] as string[] });

  useEffect(() => {
    const link = connect("control", (m) => {
      if (m.type === "state") {
        setState(m.state);
        reloadQuestions();
      }
    });
    return () => link.close();
  }, [reloadQuestions]);

  const live = sessions.find((s) => s.status === "LIVE");
  const current = sessions.find((s) => s.id === (live?.id ?? selected));
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      setMsg(ok ?? "");
    } catch (e) {
      const err = e as Error & { data?: { preflight?: { items: PreflightItem[] } } };
      if (err.data?.preflight) setPreflight(err.data.preflight.items);
      setMsg(`⚠ ${err.message}`);
    }
  };
  const director = (action: string, body: unknown = {}) => run(() => api(`/director/${action}`, { body }));

  const create = () =>
    run(async () => {
      const s = await api<LiveSession>("/live", { body: { ...form, scriptId: form.scriptId || undefined } });
      setSelected(s.id);
      reloadSessions();
    }, "สร้างไลฟ์แล้ว");

  const check = () =>
    current &&
    run(async () => {
      const r = await api<{ ok: boolean; items: PreflightItem[] }>(`/live/${current.id}/check`, { body: {} });
      setPreflight(r.items);
      reloadSessions();
      setMsg(r.ok ? "ตรวจสอบผ่าน พร้อมเริ่ม" : "ตรวจสอบไม่ผ่าน แก้ไขรายการสีแดงก่อน");
    });

  const pending = questions.filter((q) => q.status === "pending");

  return (
    <div className="control">
      <section className="panel session-panel">
        <h2>ไลฟ์</h2>
        {!live && (
          <>
            <label>
              เลือกไลฟ์
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">— สร้างใหม่ —</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.status})
                  </option>
                ))}
              </select>
            </label>
            {!selected && (
              <div className="form">
                <input placeholder="ชื่อไลฟ์" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <select value={form.characterId} onChange={(e) => setForm({ ...form, characterId: e.target.value })}>
                  <option value="">เลือกตัวละคร AI</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select value={form.scriptId} onChange={(e) => setForm({ ...form, scriptId: e.target.value })}>
                  <option value="">ไม่ใช้สคริปต์ (ควบคุมเอง)</option>
                  {scripts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
                <div className="checks">
                  {products.map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={form.productIds.includes(p.id)}
                        onChange={(e) => setForm({ ...form, productIds: e.target.checked ? [...form.productIds, p.id] : form.productIds.filter((x) => x !== p.id) })}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
                <button disabled={!form.title || !form.characterId} onClick={create}>
                  สร้างไลฟ์
                </button>
              </div>
            )}
          </>
        )}
        {current && (
          <div className="session-actions">
            <div className="session-title">
              {current.title} <span className={`badge ${current.status}`}>{current.status}</span>
            </div>
            {current.status !== "LIVE" && current.status !== "ENDED" && <button onClick={check}>ตรวจสอบ</button>}
            {current.status !== "LIVE" && current.status !== "ENDED" && (
              <button className="primary" onClick={() => run(async () => { await api(`/live/${current.id}/start`, { body: {} }); reloadSessions(); }, "เริ่มแล้ว")}>
                เริ่ม LIVE
              </button>
            )}
            {current.status === "LIVE" && (
              <button className="danger" onClick={() => run(async () => { await api(`/live/${current.id}/end`, { body: {} }); reloadSessions(); location.hash = `#/summary/${current.id}`; })}>
                จบ LIVE
              </button>
            )}
            {current.status === "ENDED" && <a href={`#/summary/${current.id}`}>ดูสรุปผล</a>}
          </div>
        )}
        {preflight && (
          <ul className="preflight">
            {preflight.map((i) => (
              <li key={i.code} className={i.ok ? "ok" : i.severity}>
                {i.ok ? "✓" : i.severity === "block" ? "✕" : "!"} {i.message}
              </li>
            ))}
          </ul>
        )}
        <div className="note">
          ภาพและเสียงออกอากาศผ่าน OBS (Browser Source: <code>{location.origin}/#/stage</code>) ไปยัง TikTok LIVE Studio หรือ stream key ทางการ
          ส่วนการปักสินค้าและดูยอดผู้ชมทำใน TikTok LIVE Studio / Seller Center
        </div>
        {msg && <div className="msg">{msg}</div>}
      </section>

      <section className="panel preview-panel">
        <div className="preview-head">
          <h2>หน้าจอออกอากาศ</h2>
          <span className={`pill ${state?.stageConnected ? "on" : "off"}`}>{state?.stageConnected ? "Stage เชื่อมต่อแล้ว" : "ยังไม่เปิด Stage"}</span>
        </div>
        <div className="preview-frame">
          <iframe title="stage-preview" src="#/stage?preview" />
        </div>
        <div className="now">
          <b>{state?.status === "running" ? "กำลังพูด" : state?.status === "paused" ? "หยุดชั่วคราว" : "รอ"}</b>: {state?.speaking?.text ?? "—"}
          {state && state.scriptLength > 0 && (
            <div className="progress">
              สคริปต์ {Math.min(state.scriptIndex, state.scriptLength)}/{state.scriptLength} · คิว {state.queue.length} ประโยค
            </div>
          )}
          {state?.lastBlocked && <div className="blocked">ระบบกันข้อความ: {state.lastBlocked}</div>}
        </div>
        <div className="row">
          <button onClick={() => director("pause")}>⏸ หยุด</button>
          <button onClick={() => director("resume")}>▶ ต่อ</button>
          <button onClick={() => director("skip")}>⏭ ข้ามประโยค</button>
        </div>
        <div className="say">
          <textarea placeholder="พิมพ์ให้ AI พูดทันที (ตรวจกฎก่อนพูด)" value={sayText} onChange={(e) => setSayText(e.target.value)} />
          <button disabled={!sayText.trim()} onClick={() => director("say", { text: sayText }).then(() => setSayText(""))}>
            พูด
          </button>
        </div>
        <h3>ท่าทาง</h3>
        <div className="chips">
          {GESTURES.filter((g) => g !== "none").map((g) => (
            <button key={g} onClick={() => director("gesture", { gesture: g })}>
              {GESTURE_TH[g]}
            </button>
          ))}
        </div>
        <h3>อารมณ์</h3>
        <div className="chips">
          {EMOTIONS.map((e) => (
            <button key={e} onClick={() => director("emotion", { emotion: e })}>
              {EMOTION_TH[e]}
            </button>
          ))}
        </div>
        <h3>Scene</h3>
        <div className="chips">
          {scenes.map((s) => (
            <button key={s.id} className={state?.sceneId === s.id ? "on" : ""} onClick={() => director("scene", { sceneId: s.id })}>
              {s.name}
            </button>
          ))}
        </div>
      </section>

      <section className="panel side-panel">
        <h2>สินค้า</h2>
        <div className="product-list">
          {products
            .filter((p) => !current?.productIds.length || current.productIds.includes(p.id))
            .map((p) => (
              <div key={p.id} className={`product-row ${state?.currentProductId === p.id ? "on" : ""}`}>
                <div>
                  <b>{p.name}</b>
                  <small>
                    {p.price} บาท · สต็อก {p.stock}
                  </small>
                </div>
                <button onClick={() => director("product", { productId: p.id })}>แสดง</button>
                <button onClick={() => director("pitch", { productId: p.id })}>แนะนำ</button>
              </div>
            ))}
        </div>
        <h3>โปรโมชั่น</h3>
        <div className="chips">
          {promos.filter((p) => p.active).map((p) => (
            <button key={p.id} onClick={() => director("promo", { promotionId: p.id })}>
              อ่าน "{p.title}"
            </button>
          ))}
        </div>

        <h2>คำถามจากผู้ชม</h2>
        <div className="qa-mode">
          <label>
            <input type="radio" checked={state?.qaMode !== "review"} onChange={() => director("qa-mode", { mode: "auto" })} /> AI ตอบอัตโนมัติ
          </label>
          <label>
            <input type="radio" checked={state?.qaMode === "review"} onChange={() => director("qa-mode", { mode: "review" })} /> ให้คนอนุมัติก่อน
          </label>
        </div>
        <div className="q-input">
          <input placeholder="ชื่อผู้ถาม (ไม่บังคับ)" value={qAuthor} onChange={(e) => setQAuthor(e.target.value)} />
          <input
            placeholder="คัดลอกคำถามจากแชต TikTok มาวาง"
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && qText.trim() && run(async () => { await api("/questions", { body: { text: qText, author: qAuthor || undefined } }); setQText(""); reloadQuestions(); })}
          />
        </div>
        <ul className="questions">
          {pending.map((q) => (
            <li key={q.id}>
              <div>
                {q.author && <b>{q.author}: </b>}
                {q.text}
              </div>
              {drafts[q.id] !== undefined && <textarea value={drafts[q.id]} onChange={(e) => setDrafts({ ...drafts, [q.id]: e.target.value })} />}
              <div className="row">
                {drafts[q.id] === undefined && (
                  <button onClick={() => run(async () => { const d = await api<{ text: string }>(`/questions/${q.id}/draft`, { body: {} }); setDrafts({ ...drafts, [q.id]: d.text }); })}>ร่างคำตอบ</button>
                )}
                <button className="primary" onClick={() => run(async () => { await api(`/questions/${q.id}/answer`, { body: { text: drafts[q.id] } }); reloadQuestions(); })}>
                  ให้ AI ตอบ
                </button>
                <button onClick={() => run(async () => { await api(`/questions/${q.id}/skip`, { body: {} }); reloadQuestions(); })}>ข้าม</button>
              </div>
            </li>
          ))}
          {pending.length === 0 && <li className="empty">ยังไม่มีคำถามที่รอตอบ</li>}
        </ul>
        <p className="note">ระบบไม่ดึงคอมเมนต์จาก TikTok เอง ผู้ควบคุมคัดลอกคำถามมาวาง หรือใช้ API ทางการเมื่อได้รับอนุมัติ</p>
      </section>
    </div>
  );
}
