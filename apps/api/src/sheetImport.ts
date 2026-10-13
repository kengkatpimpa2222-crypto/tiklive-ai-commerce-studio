import { inflateRawSync } from "node:zlib";

/**
 * Reads a product list the seller exported from TikTok Shop Seller Center (Excel .xlsx, or .csv)
 * and turns it into products for the seller to check. The file is the seller's own data, so
 * nothing is fetched from TikTok. Column names are matched loosely (English, Thai, snake_case),
 * because export and bulk-edit templates name them differently; one row per variation is grouped
 * back into one product.
 */
export interface SheetProduct {
  sku: string;
  name: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  category: string;
  imageUrl?: string;
  specs: Record<string, string>;
}

export interface SheetImport {
  products: SheetProduct[];
  warnings: string[];
}

const MAX_PRODUCTS = 500;
const MAX_UNZIPPED = 60 * 1024 * 1024;

// ---- xlsx: a zip of XML parts ----

/** The files inside a zip (stored or deflated entries; no zip64, no encryption). */
export function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("bad zip");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED }) : undefined;
    if (!data) continue;
    total += data.length;
    if (total > MAX_UNZIPPED) throw new Error("too large");
    out.set(name.replace(/^\/+/, ""), data);
  }
  return out;
}

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

/** Concatenated <t> runs of a shared or inline string. */
const runs = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1]!)).join("");

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

/** Every sheet of a workbook as rows of cell text, in workbook order. */
export function readXlsx(buf: Buffer): string[][][] {
  const files = readZip(buf);
  const text = (name: string) => files.get(name)?.toString("utf8");
  const shared = [...(text("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1]!));
  const rels = new Map([...(text("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const sheetPaths = [...(text("xl/workbook.xml") ?? "").matchAll(/<sheet\b[^>]*>/g)]
    .map((m) => rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1]))
    .filter((t): t is string => !!t)
    .map((t) => (t.startsWith("/") ? t.slice(1) : `xl/${t}`).replace(/\/[^/]+\/\.\.\//g, "/"));
  if (!sheetPaths.length) sheetPaths.push(...[...files.keys()].filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort());
  return sheetPaths.map((path) => {
    const rows: string[][] = [];
    for (const r of (text(path) ?? "").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      let next = 0;
      for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1];
        const i = ref ? colIndex(ref) : next;
        next = i + 1;
        const body = c[2] ?? "";
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        row[i] = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? runs(body) : xmlText(v ?? "");
      }
      rows.push(Array.from(row, (x) => (x ?? "").trim()));
    }
    return rows;
  });
}

// ---- csv ----

export function readCsv(buf: Buffer): string[][] {
  let s = new TextDecoder("utf-8").decode(buf);
  // Thai Excel saves "CSV" in the Windows Thai code page.
  if (s.includes("�")) s = new TextDecoder("windows-874").decode(buf);
  s = s.replace(/^﻿/, "");
  const first = s.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) row.push(cell.trim()), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell.trim()]);
  return rows;
}

// ---- columns → products ----

type Field = "productId" | "name" | "sellerSku" | "skuId" | "price" | "compareAt" | "stock" | "description" | "category" | "image" | "variation" | "brand";

const norm = (h: string) => h.toLowerCase().replace(/\(.*?\)|\[.*?\]|[\s_\-*:.]/g, "");

/** Which product field a column header names, if any. Order matters: the first match wins. */
function fieldOf(header: string): Field | undefined {
  const h = norm(header);
  if (!h) return undefined;
  if (/^(productid|idสินค้า|รหัสสินค้า)$/.test(h)) return "productId";
  if (/^skuid$/.test(h)) return "skuId";
  if (/sellersku|skuของผู้ขาย|รหัสsku|^sku$|skuผู้ขาย/.test(h)) return "sellerSku";
  if (/productname|ชื่อสินค้า|^title$|^name$|^ชื่อ$/.test(h)) return "name";
  if (/originalprice|ราคาปกติ|ราคาเดิม|ราคาก่อนลด|listprice|compareat/.test(h)) return "compareAt";
  if (/(price|ราคา)/.test(h) && !/cost|ต้นทุน|deal|promo|discount|ส่วนลด|ค่าส่ง|shipping/.test(h)) return "price";
  if (/stock|quantity|^qty|สต็อก|สต๊อก|คลังสินค้า|คงเหลือ|inventory|^จำนวน/.test(h)) return "stock";
  if (/description|รายละเอียด|คำอธิบาย/.test(h)) return "description";
  if (/category|หมวดหมู่/.test(h)) return "category";
  if (/mainimage|productimage|^image|imageurl|รูปหลัก|รูปสินค้า|^รูป|^ภาพ/.test(h)) return "image";
  if (/variation|variant|^option|ตัวเลือก|ตัวแปร|^สี$|^ขนาด$|^size$|^color$/.test(h)) return "variation";
  if (/brand|แบรนด์|ยี่ห้อ/.test(h)) return "brand";
  return undefined;
}

const money = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const n = Number(v.replace(/,/g, "").replace(/[^\d.]/g, ""));
  return /\d/.test(v) && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
};

const plain = (html: string) =>
  xmlText(html.replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

/** Finds the header row (it must name the product and its price) and the column of each field. */
function findHeader(rows: string[][]): { at: number; cols: Map<Field, number[]> } | undefined {
  let best: { at: number; cols: Map<Field, number[]>; score: number } | undefined;
  for (let at = 0; at < Math.min(rows.length, 15); at++) {
    const cols = new Map<Field, number[]>();
    rows[at]!.forEach((h, i) => {
      const f = fieldOf(h);
      if (f) cols.set(f, [...(cols.get(f) ?? []), i]);
    });
    if (!cols.has("name") || !cols.has("price")) continue;
    if (!best || cols.size > best.score) best = { at, cols, score: cols.size };
  }
  return best;
}

/** Products from the rows of one sheet; rows that are not products (notes, examples' headers) are skipped. */
export function productsFromRows(rows: string[][]): SheetImport | undefined {
  const head = findHeader(rows);
  if (!head) return undefined;
  const get = (row: string[], f: Field) => (head.cols.get(f) ?? []).map((i) => row[i] ?? "").filter(Boolean);
  const one = (row: string[], f: Field) => get(row, f)[0];
  const groups = new Map<string, string[][]>();
  for (const row of rows.slice(head.at + 1)) {
    const name = one(row, "name");
    if (!name || money(one(row, "price")) === undefined) continue;
    const key = one(row, "productId") ?? name;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const warnings: string[] = [];
  const products: SheetProduct[] = [];
  const seenSku = new Set<string>();
  for (const variants of groups.values()) {
    if (products.length >= MAX_PRODUCTS) {
      warnings.push(`นำเข้าได้ครั้งละ ${MAX_PRODUCTS} สินค้า ที่เหลือแบ่งไฟล์แล้วนำเข้าอีกครั้ง`);
      break;
    }
    const first = variants[0]!;
    const prices = variants.map((r) => money(one(r, "price"))!);
    const price = Math.min(...prices);
    const high = Math.max(...prices);
    const compare = Math.max(0, ...variants.map((r) => money(one(r, "compareAt")) ?? 0));
    const stocks = variants.map((r) => one(r, "stock")).filter((s): s is string => s !== undefined);
    const stock = stocks.reduce((sum, s) => sum + Math.max(0, Math.floor(Number(s.replace(/[^\d.]/g, "")) || 0)), 0);
    let sku = one(first, "sellerSku") ?? one(first, "productId") ?? one(first, "skuId") ?? `TT-${products.length + 1}`;
    if (variants.length > 1 && one(first, "productId")) sku = one(first, "productId")!;
    if (seenSku.has(sku)) sku = `${sku}-${products.length + 1}`;
    seenSku.add(sku);
    const specs: Record<string, string> = {};
    const options = [...new Set(variants.map((r) => get(r, "variation").join(" / ")).filter(Boolean))];
    if (options.length) specs["ตัวเลือก"] = options.slice(0, 30).join(", ");
    if (high > price) specs["ช่วงราคา"] = `${price} - ${high} บาท ตามตัวเลือก`;
    const brand = one(first, "brand");
    if (brand) specs["แบรนด์"] = brand;
    const image = variants.map((r) => get(r, "image").find((u) => /^https?:\/\//i.test(u))).find(Boolean);
    const name = one(first, "name")!.slice(0, 120);
    if (!stocks.length) warnings.push(`"${name}" ไม่มีจำนวนสต็อกในไฟล์ ใส่เองหลังนำเข้า`);
    products.push({
      sku,
      name,
      description: plain(one(first, "description") ?? "").slice(0, 600),
      price,
      compareAtPrice: compare > price ? compare : undefined,
      stock,
      category: one(first, "category")?.split(/[>/]/).pop()?.trim() || "ทั่วไป",
      imageUrl: image,
      specs,
    });
  }
  return { products, warnings };
}

/** The products in an exported .xlsx or .csv file. Throws with a Thai message the seller can act on. */
export function importSheet(filename: string, buf: Buffer): SheetImport {
  const ext = filename.split(".").pop()?.toLowerCase();
  let sheets: string[][][];
  try {
    if (ext === "xlsx") sheets = readXlsx(buf);
    else if (ext === "csv" || ext === "txt") sheets = [readCsv(buf)];
    else throw Object.assign(new Error("รองรับไฟล์ .xlsx หรือ .csv (ไฟล์ .xls แบบเก่า ให้เปิดใน Excel แล้วบันทึกเป็น .xlsx ก่อน)"), { user: true });
  } catch (e) {
    if ((e as { user?: boolean }).user) throw e;
    throw new Error("เปิดไฟล์นี้ไม่ได้ ลองเปิดใน Excel แล้วบันทึกเป็น .xlsx ใหม่");
  }
  for (const rows of sheets) {
    const r = productsFromRows(rows);
    if (r?.products.length) return r;
  }
  throw new Error("ไม่พบรายการสินค้าในไฟล์ ไฟล์ต้องมีคอลัมน์ชื่อสินค้าและราคา (เช่น ไฟล์ที่ส่งออกจาก Seller Center → สินค้า → จัดการสินค้า)");
}
