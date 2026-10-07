import type { LiveSession, LiveSummary, Product } from "@tlai/shared";

/** Builds the post-LIVE summary from the session's own event log plus figures the seller entered. */
export function summarizeLive(session: LiveSession, products: Product[], nowIso = new Date().toISOString()): LiveSummary {
  const ev = session.events;
  const start = session.startedAt ? Date.parse(session.startedAt) : undefined;
  const stop = Date.parse(session.endedAt ?? nowIso);
  const durationMinutes = start ? Math.max(0, Math.round(((stop - start) / 60000) * 10) / 10) : 0;

  const airtime = new Map<string, { mentions: number; seconds: number }>();
  let shownId: string | undefined;
  let shownAt = 0;
  const flushShown = (at: number) => {
    if (shownId) {
      const a = airtime.get(shownId) ?? { mentions: 0, seconds: 0 };
      a.seconds += Math.max(0, (at - shownAt) / 1000);
      airtime.set(shownId, a);
    }
  };
  for (const e of ev) {
    const at = Date.parse(e.at);
    if (e.type === "product_shown") {
      flushShown(at);
      shownId = e.productId;
      shownAt = at;
    }
    if (e.type === "spoke" && e.productId) {
      const a = airtime.get(e.productId) ?? { mentions: 0, seconds: 0 };
      a.mentions++;
      airtime.set(e.productId, a);
    }
  }
  flushShown(stop);

  const questions = ev.filter((e) => e.type === "question").map((e) => e.text ?? "");
  const answered = ev.filter((e) => e.type === "answer").length;
  const blocked = ev.filter((e) => e.type === "blocked_text").length;
  const counts = new Map<string, number>();
  for (const q of questions) {
    const k = q.trim().toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const topQuestions = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([q, n]) => (n > 1 ? `${q} (×${n})` : q));

  const productAirtime = [...airtime.entries()]
    .map(([productId, a]) => ({ productId, name: products.find((p) => p.id === productId)?.name ?? productId, mentions: a.mentions, secondsOnScreen: Math.round(a.seconds) }))
    .sort((a, b) => b.secondsOnScreen - a.secondsOnScreen);

  const suggestions: string[] = [];
  const unanswered = questions.length - answered;
  if (unanswered > 0) suggestions.push(`มีคำถาม ${unanswered} ข้อที่ยังไม่ได้ตอบ ควรให้ทีมงานตอบในแชตหรือเพิ่มข้อมูลสินค้า`);
  if (blocked > 0) suggestions.push(`ระบบกันข้อความไม่ผ่านเกณฑ์ ${blocked} ครั้ง ตรวจสอบสคริปต์และข้อมูลสินค้า`);
  const low = productAirtime.filter((p) => p.secondsOnScreen < 60);
  if (low.length) suggestions.push(`สินค้าที่ออกจอน้อยกว่า 1 นาที: ${low.map((p) => p.name).join(", ")}`);
  const unshown = session.productIds.filter((id) => !airtime.has(id));
  if (unshown.length) suggestions.push(`สินค้าที่ยังไม่ได้แนะนำ: ${unshown.map((id) => products.find((p) => p.id === id)?.name ?? id).join(", ")}`);
  if (session.manualStats.orders === undefined) suggestions.push("กรอกยอดผู้ชม/คำสั่งซื้อจาก TikTok LIVE Studio หรือ Seller Center เพื่อให้สรุปครบ");

  const ms = session.manualStats;
  const narrative = [
    `ไลฟ์ "${session.title}" ยาว ${durationMinutes} นาที`,
    `โฮสต์ AI พูด ${ev.filter((e) => e.type === "spoke").length} ประโยค แจ้งว่าเป็น AI ${ev.filter((e) => e.type === "disclosure").length} ครั้ง`,
    `รับคำถาม ${questions.length} ข้อ ตอบแล้ว ${answered} ข้อ`,
    productAirtime[0] ? `สินค้าที่ออกจอนานที่สุดคือ ${productAirtime[0].name}` : "",
    ms.orders !== undefined ? `คำสั่งซื้อ ${ms.orders} รายการ${ms.gmv !== undefined ? ` ยอดขาย ${ms.gmv.toLocaleString()} บาท` : ""} (ข้อมูลจากผู้ขาย)` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    sessionId: session.id,
    durationMinutes,
    sentencesSpoken: ev.filter((e) => e.type === "spoke").length,
    disclosures: ev.filter((e) => e.type === "disclosure").length,
    questionsReceived: questions.length,
    questionsAnswered: answered,
    blockedTexts: blocked,
    productAirtime,
    topQuestions,
    manualStats: ms,
    narrative,
    suggestions,
  };
}
