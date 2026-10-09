import { formatBaht, type FlashSale, type Product } from "@tlai/shared";
import { useState } from "react";
import { api } from "../lib/api";

/** A short sale at a price already set in TikTok Shop: countdown on screen, the host announces it. */
export function FlashSalePanel({ products, sale, live, now }: { products: Product[]; sale: FlashSale | null; live: boolean; now: number }) {
  const [f, setF] = useState({ productId: "", price: "", minutes: 10, confirmed: false });
  const [msg, setMsg] = useState("");
  const product = products.find((p) => p.id === f.productId);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg(`⚠ ${(e as Error).message}`);
    }
  };
  const start = () =>
    run(async () => {
      await api("/director/flash-sale", { body: { productId: f.productId, price: Number(f.price), minutes: f.minutes, confirmedInShop: f.confirmed } });
      setF({ ...f, confirmed: false });
    }, "");

  if (sale) {
    const left = Math.max(0, Math.ceil((Date.parse(sale.endsAt) - now) / 1000));
    return (
      <div className="flash-card on">
        <b>
          ⚡ ราคาพิเศษ {sale.name} {formatBaht(sale.price)} เหลือ {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </b>
        <small className="muted">หมดเวลาแล้วต้องเปลี่ยนราคาใน TikTok Shop กลับเป็น {formatBaht(sale.regularPrice)} เอง</small>
        <button onClick={() => run(() => api("/director/flash-sale-end", { body: {} }), "จบราคาพิเศษแล้ว")}>จบก่อนเวลา</button>
      </div>
    );
  }
  return (
    <div className="flash-card">
      <b>⚡ ราคาพิเศษจับเวลา (Flash sale)</b>
      <select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
        <option value="">เลือกสินค้า</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} (ปกติ {formatBaht(p.price)})
          </option>
        ))}
      </select>
      <div className="row">
        <input type="number" placeholder="ราคาพิเศษ (บาท)" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        <select value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })}>
          {[5, 10, 15, 20, 30].map((m) => (
            <option key={m} value={m}>
              {m} นาที
            </option>
          ))}
        </select>
      </div>
      <label className="inline">
        <input type="checkbox" checked={f.confirmed} onChange={(e) => setF({ ...f, confirmed: e.target.checked })} />
        ตั้งราคา {f.price ? formatBaht(Number(f.price)) : "นี้"} ใน TikTok Shop แล้ว ลูกค้ากดซื้อได้ราคานี้จริง
      </label>
      <button className="primary" disabled={!live || !product || !f.price || !f.confirmed} onClick={start}>
        เริ่มราคาพิเศษ
      </button>
      {!live && <small className="muted">ใช้ได้ระหว่างไลฟ์</small>}
      {msg && <small>{msg}</small>}
    </div>
  );
}
