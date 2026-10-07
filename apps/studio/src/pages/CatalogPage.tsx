import type { Product, Promotion } from "@tlai/shared";
import { useState } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/useData";

const emptyProduct = { sku: "", name: "", description: "", price: "", compareAtPrice: "", stock: "", category: "", highlights: "", specs: "", imageUrl: "" };

export function CatalogPage() {
  const [products, reload] = useData<Product[]>("/products", []);
  const [promos, reloadPromos] = useData<Promotion[]>("/promotions", []);
  const [f, setF] = useState(emptyProduct);
  const [editing, setEditing] = useState<string | null>(null);
  const [promo, setPromo] = useState({ title: "", detail: "", productIds: [] as string[] });
  const [err, setErr] = useState("");

  const edit = (p: Product) => {
    setEditing(p.id);
    setF({
      sku: p.sku, name: p.name, description: p.description, price: String(p.price), compareAtPrice: p.compareAtPrice ? String(p.compareAtPrice) : "",
      stock: String(p.stock), category: p.category, highlights: p.highlights.join("\n"), imageUrl: p.imageUrl ?? "",
      specs: Object.entries(p.specs).map(([k, v]) => `${k}: ${v}`).join("\n"),
    });
  };

  const save = async () => {
    const body = {
      sku: f.sku, name: f.name, description: f.description, category: f.category || "ทั่วไป",
      price: Number(f.price), stock: Number(f.stock), compareAtPrice: f.compareAtPrice ? Number(f.compareAtPrice) : undefined,
      imageUrl: f.imageUrl || undefined,
      highlights: f.highlights.split("\n").map((s) => s.trim()).filter(Boolean),
      specs: Object.fromEntries(f.specs.split("\n").map((l) => l.split(/:(.*)/s).map((s) => s.trim())).filter(([k, v]) => k && v)),
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
            <tr><th>SKU</th><th>ชื่อ</th><th>ราคา</th><th>สต็อก</th><th /></tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
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
              </label>
              <button onClick={() => api(`/promotions/${p.id}`, { method: "DELETE" }).then(reloadPromos)}>ลบ</button>
            </li>
          ))}
        </ul>
        <div className="form">
          <input placeholder="ชื่อโปร" value={promo.title} onChange={(e) => setPromo({ ...promo, title: e.target.value })} />
          <input placeholder="รายละเอียดที่ให้ AI อ่าน (ตรงตามเงื่อนไขจริง)" value={promo.detail} onChange={(e) => setPromo({ ...promo, detail: e.target.value })} />
          <button disabled={!promo.title || !promo.detail} onClick={() => api("/promotions", { body: promo }).then(() => { setPromo({ title: "", detail: "", productIds: [] }); reloadPromos(); })}>
            เพิ่มโปรโมชั่น
          </button>
        </div>
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
        <input placeholder="URL รูปสินค้า" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} />
        <textarea placeholder={"จุดเด่นที่ตรวจสอบแล้ว (บรรทัดละข้อ)"} value={f.highlights} onChange={(e) => setF({ ...f, highlights: e.target.value })} />
        <textarea placeholder={"ข้อมูลจำเพาะ เช่น\nขนาด: 30 ml\nวัสดุ: สแตนเลส"} value={f.specs} onChange={(e) => setF({ ...f, specs: e.target.value })} />
        <p className="note">AI จะพูดและตอบคำถามจากข้อมูลในหน้านี้เท่านั้น ถ้าไม่มีข้อมูลจะบอกผู้ชมว่าให้ทีมงานตอบ</p>
        {err && <div className="msg">⚠ {err}</div>}
        <div className="row">
          <button className="primary" onClick={save}>บันทึก</button>
          {editing && <button onClick={() => { setEditing(null); setF(emptyProduct); }}>ยกเลิก</button>}
        </div>
      </div>
    </div>
  );
}
