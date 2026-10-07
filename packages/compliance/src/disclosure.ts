import type { HostCharacter } from "@tlai/shared";

export const DEFAULT_DISCLOSURE_LABEL = "AI Virtual Host · ผู้ดำเนินรายการเป็นตัวละคร AI";

/** How often the host re-states that it is an AI character while live. */
export const REDISCLOSURE_INTERVAL_MS = 15 * 60 * 1000;

export function openingDisclosure(c: Pick<HostCharacter, "name" | "politeParticle">): string {
  return `สวัสดี${c.politeParticle}ทุกคน ${c.politeParticle === "ค่ะ" ? "ดิฉัน" : "ผม"}ชื่อ${c.name} เป็นตัวละคร AI ที่ช่วยแนะนำสินค้าในไลฟ์นี้${c.politeParticle} มีทีมงานคนจริงดูแลร้านและคำสั่งซื้ออยู่เบื้องหลังนะ${c.politeParticle === "ค่ะ" ? "คะ" : "ครับ"}`;
}

export function periodicDisclosure(c: Pick<HostCharacter, "name" | "politeParticle">): string {
  return `แจ้งอีกครั้งนะ${c.politeParticle === "ค่ะ" ? "คะ" : "ครับ"} ${c.name}เป็นผู้ช่วย AI ข้อมูลสินค้าทั้งหมดมาจากร้านโดยตรง${c.politeParticle}`;
}

export function identityAnswer(c: Pick<HostCharacter, "name" | "politeParticle">): string {
  return `${c.name}เป็นตัวละคร AI ไม่ใช่คนจริง${c.politeParticle} เสียงและภาพสร้างด้วย AI ส่วนเรื่องคำสั่งซื้อและการจัดส่งมีทีมงานคนจริงดูแลให้${c.politeParticle}`;
}

const IDENTITY_PATTERNS = [
  /คนจริง/,
  /เป็นคน(หรือ|ไหม|มั้ย|รึ|ป่ะ)/,
  /เป็น\s*(ai|เอไอ|บอท|bot|หุ่นยนต์)/i,
  /\b(are|r) (you|u) (real|human|a bot|an ai|ai)\b/i,
  /\bis this (an )?(ai|bot|real)\b/i,
  /(ai|เอไอ|บอท)\s*(หรือ|ไหม|มั้ย|รึเปล่า|ป่ะ)/i,
  /ใครพูด|เสียงจริง/,
];

/** True when a viewer is asking whether the host is a real person. Always answered honestly. */
export function isIdentityQuestion(text: string): boolean {
  return IDENTITY_PATTERNS.some((p) => p.test(text));
}

const DENIAL_PATTERNS = [
  /(ฉัน|ผม|ดิฉัน|หนู|เรา)(เป็น|คือ)คน(จริง)?(นะ|ค่ะ|ครับ|จ้า|\s|$)/,
  /ไม่ใช่\s*(ai|เอไอ|บอท|bot|หุ่นยนต์)/i,
  /\bi('?m| am) (a )?(real|human)( person)?\b/i,
  /\bnot (an? )?(ai|bot)\b/i,
];

/** True when generated text would claim the host is human. Such text is never spoken. */
export function deniesBeingAi(text: string): boolean {
  return DENIAL_PATTERNS.some((p) => p.test(text));
}
