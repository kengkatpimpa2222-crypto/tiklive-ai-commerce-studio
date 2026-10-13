import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { importSheet, readCsv } from "./sheetImport.js";

/** A minimal zip (deflated entries, CRC not checked by the reader). */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text, "utf8"));
    const n = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** An .xlsx with one sheet; every cell is a shared string except numbers. */
function xlsx(rows: (string | number)[][]): Buffer {
  const strings: string[] = [];
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const cols = "ABCDEFGHIJKLMNOP";
  const sheet = rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      if (v === "") return "";
      const ref = `${cols[ci]}${ri + 1}`;
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      strings.push(v);
      return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
    }).join("")}</row>`)
    .join("");
  return zip({
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="Template" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${sheet}</sheetData></worksheet>`,
  });
}

// Shaped like a Seller Center export: a key row, a display row, a note row, then one row per variation.
const exportRows = [
  ["product_id", "product_name", "product_description", "category", "variation_value", "sku_id", "seller_sku", "price", "quantity", "main_image"],
  ["Product ID", "Product Name", "Product Description", "Category", "Variation", "SKU ID", "Seller SKU", "Price", "Quantity", "Main Image"],
  ["", "Required", "", "", "", "", "", "Required, number", "", ""],
  ["1729001", "เสื้อยืดโอเวอร์ไซซ์", "<p>ผ้าคอตตอน 100%</p><p>ใส่สบาย</p>", "เสื้อผ้า/เสื้อยืด", "M", "9001", "TEE-M", 259, 10, "https://img.example/tee.jpg"],
  ["1729001", "เสื้อยืดโอเวอร์ไซซ์", "", "", "XL", "9002", "TEE-XL", 279, 5, ""],
  ["1729002", "เซรั่มวิตามินซี 30 ml", "เนื้อบางเบา", "ความงาม", "", "9003", "SERUM30", "฿1,299.00", 7, ""],
];

describe("TikTok Shop product file import", () => {
  it("groups variations into one product and keeps prices from the file", () => {
    const r = importSheet("products.xlsx", xlsx(exportRows));
    expect(r.products).toHaveLength(2);
    const tee = r.products[0]!;
    expect(tee).toMatchObject({ sku: "1729001", name: "เสื้อยืดโอเวอร์ไซซ์", price: 259, stock: 15, category: "เสื้อยืด", imageUrl: "https://img.example/tee.jpg" });
    expect(tee.description).toBe("ผ้าคอตตอน 100%\nใส่สบาย");
    expect(tee.specs).toMatchObject({ ตัวเลือก: "M, XL", ช่วงราคา: "259 - 279 บาท ตามตัวเลือก" });
    expect(r.products[1]).toMatchObject({ sku: "SERUM30", price: 1299, stock: 7 });
  });

  it("reads Thai headers from a CSV", () => {
    const csv = Buffer.from("﻿ชื่อสินค้า,ราคา,ราคาปกติ,สต็อก,SKU\n\"กระบอกน้ำ, 750 ml\",390,450,12,BOT1\n", "utf8");
    const r = importSheet("x.csv", csv);
    expect(r.products[0]).toMatchObject({ name: "กระบอกน้ำ, 750 ml", price: 390, compareAtPrice: 450, stock: 12, sku: "BOT1" });
  });

  it("reads a CSV saved in the Windows Thai code page", () => {
    const rows = readCsv(Buffer.from([0xaa, 0xd7, 0xe8, 0xcd, 0x2c, 0x50, 0x0a])); // "ชื่อ,P"
    expect(rows[0]).toEqual(["ชื่อ", "P"]);
  });

  it("explains files it cannot use", () => {
    expect(() => importSheet("a.xls", Buffer.from("x"))).toThrow(/\.xlsx/);
    expect(() => importSheet("a.xlsx", Buffer.from("not a zip"))).toThrow(/เปิดไฟล์นี้ไม่ได้/);
    expect(() => importSheet("a.csv", Buffer.from("foo,bar\n1,2\n"))).toThrow(/ไม่พบรายการสินค้า/);
  });

  it("previews, then adds new products and updates price and stock by SKU", async () => {
    const { app } = await buildServer({ dataFile: null, llmFetch: (async () => new Response("no", { status: 404 })) as typeof fetch });
    const existing = JSON.parse((await app.inject({ method: "POST", url: "/api/products", payload: { sku: "SERUM30", name: "เซรั่ม", price: 999, stock: 1, highlights: ["ซึมไว"] } })).body);
    const preview = JSON.parse((await app.inject({ method: "POST", url: "/api/products/import-file", payload: { filename: "p.xlsx", dataBase64: xlsx(exportRows).toString("base64") } })).body);
    expect(preview.products.map((p: { existingId: string | null }) => p.existingId)).toEqual([null, existing.id]);
    const { existingId: _a, ...tee } = preview.products[0];
    const { existingId: _b, ...serum } = preview.products[1];
    const applied = JSON.parse((await app.inject({ method: "POST", url: "/api/products/import-file/apply", payload: { products: [tee, serum] } })).body);
    expect(applied).toEqual({ added: 1, updated: 1 });
    const list = JSON.parse((await app.inject({ method: "GET", url: "/api/products" })).body);
    expect(list.find((p: { sku: string }) => p.sku === "SERUM30")).toMatchObject({ price: 1299, stock: 7, highlights: ["ซึมไว"] });
    expect(list.find((p: { sku: string }) => p.sku === "1729001")).toMatchObject({ price: 259, stock: 15 });
    const bad = await app.inject({ method: "POST", url: "/api/products/import-file", payload: { filename: "p.csv", dataBase64: Buffer.from("a,b\n").toString("base64") } });
    expect(bad.statusCode).toBe(422);
    await app.close();
  });
});
