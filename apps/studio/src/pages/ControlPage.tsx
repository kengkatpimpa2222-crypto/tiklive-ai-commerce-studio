import { EMOTIONS, GESTURES, type HostCharacter, type LiveScript, type LiveSession, type Product, type Promotion, type Scene, type ViewerQuestion } from "@tlai/shared";
import { useEffect, useState } from "react";
import { api, connect } from "../lib/api";
import { CaptureToggle } from "../lib/CaptureToggle";
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
  startedAt: string | null;
  nextDisclosureAt: number | null;
  pendingQuestions: number;
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
  const [thaiVoice, setThaiVoice] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const check = () => {
      const voices = window.speechSynthesis?.getVoices() ?? [];
      if (voices.length === 0) return;
      setThaiVoice(voices.find((v) => v.lang.replace("_", "-").startsWith("th"))?.name ?? null);
    };
    check();
    window.speechSynthesis?.addEventListener("voiceschanged", check);
    const t = window.setTimeout(() => setThaiVoice((v) => (v === undefined ? null : v)), 3000);
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", check);
      clearTimeout(t);
    };
  }, []);
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

  // Clock for the live timer and disclosure countdown.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Operator shortcuts that work anywhere in the control window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F8") {
        e.preventDefault();
        void director(state?.status === "paused" ? "resume" : "pause");
      } else if (e.key === "F9") {
        e.preventDefault();
        void director("skip");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const preflightOk = preflight ? preflight.every((i) => i.ok || i.severity === "warn") : current?.status === "READY" || current?.status === "LIVE";
  const ready: [boolean, string][] = [
    [thaiVoice !== null, thaiVoice ? `เสียงไทย: ${thaiVoice}` : thaiVoice === undefined ? "กำลังตรวจเสียงไทย…" : "ยังไม่มีเสียงภาษาไทยในเครื่อง"],
    [!!state?.stageConnected, state?.stageConnected ? "หน้าต่าง Stage เปิดอยู่" : "ยังไม่ได้เปิดหน้าต่าง Stage"],
    [!!current, current ? `เลือกไลฟ์: ${current.title}` : "ยังไม่ได้สร้างหรือเลือกไลฟ์"],
    [!!current?.scriptId, current?.scriptId ? "มีสคริปต์" : "ยังไม่ได้เลือกสคริปต์ (ควบคุมเองได้)"],
    [!!preflightOk, preflightOk ? "ตรวจเนื้อหาผ่าน" : "ยังไม่ได้กดตรวจสอบ หรือยังไม่ผ่าน"],
  ];
  const elapsed = state?.startedAt ? now - Date.parse(state.startedAt) : 0;
  const disclosureIn = state?.nextDisclosureAt ? Math.max(0, state.nextDisclosureAt - now) : null;

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
        {!live && (
          <>
            <h3>ความพร้อมก่อนไลฟ์</h3>
            <ul className="readiness">
              {ready.map(([ok, text]) => (
                <li key={text} className={ok ? "ok" : "todo"}>
                  {ok ? "✓" : "○"} {text}
                </li>
              ))}
            </ul>
          </>
        )}
        {live && state?.startedAt && (
          <div className="live-clock">
            <div>
              <span className="rec" /> ออกอากาศ <b>{fmtClock(elapsed)}</b>
            </div>
            {disclosureIn !== null && <div className="muted">แจ้งว่าเป็น AI ครั้งถัดไปใน {fmtClock(disclosureIn)}</div>}
            <div className="muted">คำถามรอตอบ {state.pendingQuestions}</div>
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
        {thaiVoice === null && (
          <div className="voice-warn">
            ไม่พบเสียงภาษาไทยในเครื่อง ตัวละครจะขยับปากแต่ไม่มีเสียง ติดตั้งที่ Windows Settings → Time &amp; language → Speech → Add voices → ภาษาไทย แล้วเปิดแอปใหม่
          </div>
        )}
        {thaiVoice && <div className="note">เสียงที่ใช้: {thaiVoice}</div>}
        <div className="note">
          นำภาพเข้า TikTok LIVE Studio ด้วย Window Capture ของหน้าต่าง "Stage (AI Virtual Host)" และเปิดเสียงของแอปนี้ (หรือผ่าน OBS)
          ส่วนการปักสินค้าและดูยอดผู้ชมทำใน TikTok LIVE Studio / Seller Center
        </div>
        {msg && <div className="msg">{msg}</div>}
      </section>

      <section className="panel preview-panel">
        <div className="preview-head">
          <h2>หน้าจอออกอากาศ</h2>
          <span className={`pill ${state?.stageConnected ? "on" : "off"}`}>{state?.stageConnected ? "Stage เชื่อมต่อแล้ว" : "ยังไม่เปิด Stage"}</span>
        </div>
        {characters.length > 0 && !characters.some((c) => c.look.style === "photo") && (
          <div className="realistic-cta">
            <div>
              <b>ตอนนี้ตัวละครเป็นแบบการ์ตูน</b> อยากได้แบบคนเหมือนจริง ให้ใส่รูปคน 1 รูป (รูปคนที่สร้างจาก AI หรือรูปคนจริงที่ยินยอม) แล้วตัวละครจะพูด กะพริบตา ขยับหัวได้จากรูปนั้น
            </div>
            <a className="button primary" href="#/characters/photo">ตั้งค่าตัวละครเหมือนคนจริง</a>
          </div>
        )}
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
          <span className="muted kbd-hint">F8 หยุด/ต่อ · F9 ข้าม</span>
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
        <CaptureToggle />
        <a className="button" href="#/quick" target="_blank" rel="noreferrer">เปิดกล่องถามด่วน (ลอยเหนือ TikTok LIVE Studio) ↗</a>
        <div className="q-input">
          <input placeholder="ชื่อผู้ถาม (ไม่บังคับ)" value={qAuthor} onChange={(e) => setQAuthor(e.target.value)} />
          <input
            placeholder="คัดลอกคำถามจากแชต TikTok มาวาง"
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && qText.trim() && run(async () => { await api("/questions", { body: { text: qText, author: qAuthor || undefined, source: "manual" } }); setQText(""); reloadQuestions(); })}
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
        <p className="note">TikTok ยังไม่มี API ทางการให้แอปอ่านคอมเมนต์ LIVE ระบบจึงไม่ดึงคอมเมนต์เอง (ไม่ scrape) ผู้ควบคุมแค่คัดลอกคอมเมนต์ แล้ว AI ตอบให้อัตโนมัติ</p>
      </section>
    </div>
  );
}

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
