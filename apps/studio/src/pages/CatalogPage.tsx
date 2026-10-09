import type { Product, ProductQa, Promotion } from "@tlai/shared";
import { useState } from "react";
import { api } from "../lib/api";
import { ImageUpload } from "../lib/ImageUpload";
import { useData } from "../lib/useData";

const emptyProduct = { sku: "", name: "", description: "", price: "", compareAtPrice: "", stock: "", category: "", highlights: "", specs: "", imageUrl: "", qa: [] as ProductQa[], pairsWith: [] as string[] };

export function CatalogPage() {
  const [products, reload] = useData<Product[]>("/products", []);
  const [promos, reloadPromos] = useData<Promotion[]>("/promotions", []);
  const [f, setF] = useState(emptyProduct);
  const [editing, setEditing] = useState<string | null>(null);
  const [promo, setPromo] = useState({ title: "", detail: "", productIds: [] as string[], endsAt: "" });
  const [err, setErr] = useState("");
  const [imp, setImp] = useState({ input: "", busy: false, msg: "", warnings: [] as string[], needsText: false });

  /** A link (its preview data) or pasted product text → fills the form below for the seller to check. */
  const runImport = async () => {
    const input = imp.input.trim();
    const isUrl = /^https?:\/\/\S+$/i.test(input);
    setImp({ ...imp, busy: true, msg: "", warnings: [], needsText: false });
    try {
      const r = await api<{ draft: Record<string, unknown> & { highlights: string[]; specs: Record<string, string> }; via: string; warnings: string[] }>("/products/import", { body: isUrl ? { url: input } : { text: input } });
      const d = r.draft;
      setEditing(null);
      setF({
        sku: String(d.sku || ""), name: String(d.name ?? ""), description: String(d.description ?? ""),
        price: d.price !== undefined ? String(d.price) : "", compareAtPrice: d.compareAtPrice !== undefined ? String(d.compareAtPrice) : "",
        stock: "", category: String(d.category ?? ""), imageUrl: String(d.imageUrl ?? ""),
        highlights: d.highlights.join("\n"), specs: Object.entries(d.specs).map(([k, v]) => `${k}: ${v}`).join("\n"), qa: [], pairsWith: [],
      });
      setImp({ input: "", busy: false, warnings: r.warnings, needsText: false, msg: r.via === "llm" ? "AI กรอกข้อมูลและเขียนจุดขายให้แล้ว ตรวจให้ถูกต้อง ใส่ SKU และสต็อก แล้วกดบันทึก" : "กรอกข้อมูลเบื้องต้นให้แล้ว ตรวจ ใส่ SKU และสต็อก แล้วกดบันทึก (เปิดสมอง AI จะได้จุดขายที่พร้อมพูดในไลฟ์)" });
    } catch (e) {
      const data = (e as { data?: { needsText?: boolean } }).data;
      setImp({ ...imp, busy: false, msg: `⚠ ${(e as Error).message}`, warnings: [], needsText: !!data?.needsText });
    }
  };

  const edit = (p: Product) => {
    setEditing(p.id);
    setF({
      sku: p.sku, name: p.name, description: p.description, price: String(p.price), compareAtPrice: p.compareAtPrice ? String(p.compareAtPrice) : "",
      stock: String(p.stock), category: p.category, highlights: p.highlights.join("\n"), imageUrl: p.imageUrl ?? "",
      specs: Object.entries(p.specs).map(([k, v]) => `${k}: ${v}`).join("\n"), qa: p.qa ?? [], pairsWith: p.pairsWith ?? [],
    });
  };

  const save = async () => {
    const body = {
      sku: f.sku, name: f.name, description: f.description, category: f.category || "ทั่วไป",
      price: Number(f.price), stock: Number(f.stock), compareAtPrice: f.compareAtPrice ? Number(f.compareAtPrice) : undefined,
      imageUrl: f.imageUrl || undefined,
      highlights: f.highlights.split("\n").map((s) => s.trim()).filter(Boolean),
      specs: Object.fromEntries(f.specs.split("\n").map((l) => l.split(/:(.*)/s).map((s) => s.trim())).filter(([k, v]) => k && v)),
      pairsWith: f.pairsWith,
      qa: f.qa.map((x) => ({ question: x.question.trim(), answer: x.answer.trim() })).filter((x) => x.question && x.answer),
    };
    try {
      await api(editing ? `/products/${editing}` : "/products", { method: editing ? "PATCH" : "POST", body });
      setF(emptyProduct);
      setEditing(null);
      setErr("");
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="page two-col">
      <div>
        <h1>สินค้า</h1>
        <table>
          <thead>
            <tr><th /><th>SKU</th><th>ชื่อ</th><th>ราคา</th><th>สต็อก</th><th /></tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.imageUrl ? <img className="mini" src={p.imageUrl} alt="" /> : <span className="mini ph-mini">{p.name.slice(0, 1)}</span>}</td>
                <td>{p.sku}</td>
                <td>{p.name}</td>
                <td>{p.price}{p.compareAtPrice ? <s> {p.compareAtPrice}</s> : null}</td>
                <td>{p.stock}</td>
                <td>
                  <button onClick={() => edit(p)}>แก้ไข</button>
                  <button onClick={() => api(`/products/${p.id}`, { method: "DELETE" }).then(reload)}>ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h1>โปรโมชั่น</h1>
        <ul className="promo-list">
          {promos.map((p) => (
            <li key={p.id}>
              <label>
                <input type="checkbox" checked={p.active} onChange={(e) => api(`/promotions/${p.id}`, { method: "PATCH", body: { active: e.target.checked } }).then(reloadPromos)} />
                <b>{p.title}</b> {p.detail}
                {p.endsAt && <small className="muted"> · หมดเขต {new Date(p.endsAt).toLocaleString("th-TH")}</small>}
                {p.productIds.length > 0 && <small className="muted"> · {p.productIds.map((id) => products.find((x) => x.id === id)?.name ?? id).join(", ")}</small>}
              </label>
              <button onClick={() => api(`/promotions/${p.id}`, { method: "DELETE" }).then(reloadPromos)}>ลบ</button>
            </li>
          ))}
        </ul>
        <div className="form">
          <input placeholder="ชื่อโปร" value={promo.title} onChange={(e) => setPromo({ ...promo, title: e.target.value })} />
          <input placeholder="รายละเอียดที่ให้ AI อ่าน (ตรงตามเงื่อนไขจริง)" value={promo.detail} onChange={(e) => setPromo({ ...promo, detail: e.target.value })} />
          <div className="row">
            <label>
              ใช้กับสินค้า
              <select value={promo.productIds[0] ?? ""} onChange={(e) => setPromo({ ...promo, productIds: e.target.value ? [e.target.value] : [] })}>
                <option value="">ทุกสินค้า (ทั้งร้าน)</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>
              หมดเขต (ถ้ามี จะแสดงนับถอยหลังบนจอ)
              <input type="datetime-local" value={promo.endsAt} onChange={(e) => setPromo({ ...promo, endsAt: e.target.value })} />
            </label>
          </div>
          <button
            disabled={!promo.title || !promo.detail}
            onClick={() =>
              api("/promotions", { body: { ...promo, endsAt: promo.endsAt ? new Date(promo.endsAt).toISOString() : undefined } }).then(() => {
                setPromo({ title: "", detail: "", productIds: [], endsAt: "" });
                reloadPromos();
              })
            }
          >
            เพิ่มโปรโมชั่น
          </button>
        </div>
      </div>

      <div>
      <div className="form card import-card">
        <h2>เพิ่มสินค้าจากลิงก์หรือข้อความ</h2>
        <textarea
          placeholder={"วางลิงก์หน้าสินค้าจากเว็บร้าน หรือคัดลอกชื่อ ราคา รายละเอียดสินค้า (เช่น จาก TikTok Shop Seller Center) มาวางที่นี่"}
          value={imp.input}
          onChange={(e) => setImp({ ...imp, input: e.target.value })}
        />
        <div className="row">
          <button className="primary" disabled={!imp.input.trim() || imp.busy} onClick={runImport}>{imp.busy ? "กำลังประมวลผล…" : "ประมวลผล"}</button>
        </div>
        {imp.msg && <div className="msg">{imp.msg}</div>}
        {imp.warnings.length > 0 && <ul className="warn-list">{imp.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <p className="note">
          ลิงก์เว็บร้านทั่วไปอ่านได้จากข้อมูลตัวอย่างสินค้าที่เว็บเปิดให้ (ชื่อ ราคา รูป รายละเอียด) ส่วนลิงก์ TikTok ระบบไม่เปิดอ่าน เพราะ TikTok ไม่อนุญาต ให้คัดลอกข้อความสินค้ามาวางแทน
          ราคาที่ใช้ต้องมีอยู่ในข้อมูลต้นทางเท่านั้น และจุดขายที่อาจผิดกฎโฆษณาจะถูกตัดออก
        </p>
      </div>
      <div className="form card">
        <h2>{editing ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}</h2>
        <input placeholder="SKU" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
        <input placeholder="ชื่อสินค้า" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <textarea placeholder="รายละเอียด" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <div className="row">
          <input placeholder="ราคาขาย" type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <input placeholder="ราคาปกติ (ถ้ามี)" type="number" value={f.compareAtPrice} onChange={(e) => setF({ ...f, compareAtPrice: e.target.value })} />
          <input placeholder="สต็อก" type="number" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} />
        </div>
        <input placeholder="หมวดหมู่" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <label>
          รูปสินค้า (แสดงบนการ์ดสินค้าในไลฟ์)
          <ImageUpload value={f.imageUrl} onChange={(url) => setF({ ...f, imageUrl: url })} />
        </label>
        <textarea placeholder={"จุดเด่นที่ตรวจสอบแล้ว (บรรทัดละข้อ)"} value={f.highlights} onChange={(e) => setF({ ...f, highlights: e.target.value })} />
        <textarea placeholder={"ข้อมูลจำเพาะ เช่น\nขนาด: 30 ml\nวัสดุ: สแตนเลส"} value={f.specs} onChange={(e) => setF({ ...f, specs: e.target.value })} />
        <QaEditor value={f.qa} onChange={(qa) => setF({ ...f, qa })} />
        {products.some((p) => p.id !== editing) && (
          <div className="pair-picks">
            <strong>สินค้าที่ใช้คู่กัน</strong>
            <p className="note">ตัวละครจะแนะนำสินค้าที่เลือกไว้ตอนพูดถึงสินค้านี้ พร้อมราคาจริง (สูงสุด 5 ชิ้น)</p>
            {products
              .filter((p) => p.id !== editing)
              .map((p) => (
                <label key={p.id} className="inline">
                  <input
                    type="checkbox"
                    checked={f.pairsWith.includes(p.id)}
                    disabled={!f.pairsWith.includes(p.id) && f.pairsWith.length >= 5}
                    onChange={(e) => setF({ ...f, pairsWith: e.target.checked ? [...f.pairsWith, p.id] : f.pairsWith.filter((x) => x !== p.id) })}
                  />
                  {p.name}
                </label>
              ))}
          </div>
        )}
        <p className="note">AI จะพูดและตอบคำถามจากข้อมูลในหน้านี้เท่านั้น ถ้าไม่มีข้อมูลจะบอกผู้ชมว่าให้ทีมงานตอบ</p>
        {err && <div className="msg">⚠ {err}</div>}
        <div className="row">
          <button className="primary" onClick={save}>บันทึก</button>
          {editing && <button onClick={() => { setEditing(null); setF(emptyProduct); }}>ยกเลิก</button>}
        </div>
      </div>
      </div>
    </div>
  );
}

/** Questions viewers often ask about this product, with the shop's own answers. */
function QaEditor({ value, onChange }: { value: ProductQa[]; onChange: (v: ProductQa[]) => void }) {
  const set = (i: number, patch: Partial<ProductQa>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="qa-editor">
      <strong>คำถามที่ลูกค้าถามบ่อย ({value.length})</strong>
      <p className="note">เขียนคำตอบของร้านเองได้ เมื่อมีคนถามคล้าย ๆ กัน AI จะตอบตามนี้ก่อน เช่น ผิวแพ้ง่ายใช้ได้ไหม, ใช้ตอนไหน, มีกลิ่นไหม</p>
      {value.map((x, i) => (
        <div className="qa-row" key={i}>
          <input placeholder="คำถาม เช่น ใช้กับผิวแพ้ง่ายได้ไหม" value={x.question} onChange={(e) => set(i, { question: e.target.value })} />
          <textarea placeholder="คำตอบของร้าน" value={x.answer} onChange={(e) => set(i, { answer: e.target.value })} />
          <button onClick={() => onChange(value.filter((_, j) => j !== i))}>ลบ</button>
        </div>
      ))}
      {value.length < 30 && <button onClick={() => onChange([...value, { question: "", answer: "" }])}>+ เพิ่มคำถาม</button>}
    </div>
  );
}
