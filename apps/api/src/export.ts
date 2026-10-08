import type { LiveSession, LiveSummary, Product } from "@tlai/shared";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Human-readable post-live report the seller can keep or share with the team. */
export function summaryMarkdown(s: LiveSession, sum: LiveSummary): string {
  const ms = sum.manualStats;
  const lines = [
    `# สรุปผล LIVE: ${s.title}`,
    "",
    `- เริ่ม: ${s.startedAt ?? "-"}`,
    `- จบ: ${s.endedAt ?? "-"}`,
    `- ระยะเวลา: ${sum.durationMinutes} นาที`,
    `- ผู้ดำเนินรายการ: ตัวละคร AI (แจ้งผู้ชม ${sum.disclosures} ครั้ง)`,
    "",
    sum.narrative,
    "",
    "## ตัวเลขหลัก",
    "",
    "| รายการ | ค่า |",
    "|---|---|",
    `| ประโยคที่พูด | ${sum.sentencesSpoken} |`,
    `| คำถามที่ได้รับ / ตอบแล้ว | ${sum.questionsReceived} / ${sum.questionsAnswered} |`,
    `| ข้อความที่ระบบกันไว้ | ${sum.blockedTexts} |`,
    `| ผู้ชมสูงสุด* | ${ms.peakViewers ?? "-"} |`,
    `| คำสั่งซื้อ* | ${ms.orders ?? "-"} |`,
    `| ยอดขาย (บาท)* | ${ms.gmv?.toLocaleString() ?? "-"} |`,
    `| ไลก์* | ${ms.likes ?? "-"} |`,
    "",
    "\\* ผู้ขายกรอกจาก TikTok LIVE Studio / Seller Center",
    "",
    "## เวลาออกจอของสินค้า",
    "",
    "| สินค้า | เวลาบนจอ | ประโยคที่พูดถึง |",
    "|---|---|---|",
    ...sum.productAirtime.map((p) => `| ${p.name} | ${mmss(p.secondsOnScreen)} | ${p.mentions} |`),
  ];
  if (sum.topQuestions.length) lines.push("", "## คำถามที่พบบ่อย", "", ...sum.topQuestions.map((q, i) => `${i + 1}. ${q}`));
  if (sum.suggestions.length) lines.push("", "## ข้อเสนอแนะ", "", ...sum.suggestions.map((x) => `- ${x}`));
  return lines.join("\n") + "\n";
}

const cell = (v: unknown) => {
  const t = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Full event log, one row per event, with a UTF-8 BOM so Excel shows Thai correctly. */
export function summaryCsv(s: LiveSession, products: Product[]): string {
  const name = (id?: string) => (id ? products.find((p) => p.id === id)?.name ?? id : "");
  const rows = [["time", "type", "product", "text"], ...s.events.map((e) => [e.at, e.type, name(e.productId), e.text ?? ""])];
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
