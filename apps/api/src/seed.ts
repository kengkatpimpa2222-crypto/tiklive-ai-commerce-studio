import { DEFAULT_DISCLOSURE_LABEL } from "@tlai/compliance";
import type { HostCharacter, LiveScript, Product, Promotion, Scene } from "@tlai/shared";

export const seedCharacters: HostCharacter[] = [
  {
    id: "char_mint",
    name: "มินท์",
    disclosureLabel: DEFAULT_DISCLOSURE_LABEL,
    persona: "สดใส เป็นกันเอง อธิบายสินค้าละเอียดและตรงไปตรงมา",
    politeParticle: "ค่ะ",
    voice: { provider: "browser", voice: "", lang: "th-TH", rate: 1, pitch: 1.05 },
    look: { skin: "#f3cfb3", hair: "#2a1b17", eyes: "#3a2418", outfit: "#ff4f7b", accent: "#ffd166" },
  },
  {
    id: "char_tem",
    name: "เต็ม",
    disclosureLabel: DEFAULT_DISCLOSURE_LABEL,
    persona: "สุขุม อธิบายสเปกเก่ง เหมาะกับสินค้าไอที",
    politeParticle: "ครับ",
    voice: { provider: "browser", voice: "", lang: "th-TH", rate: 1, pitch: 0.9 },
    look: { skin: "#e8b995", hair: "#151515", eyes: "#2b1d12", outfit: "#2f6fed", accent: "#7ee0c3" },
  },
];

export const seedProducts: Product[] = [
  {
    id: "prod_serum", sku: "SER-VC30", name: "เซรั่มวิตามินซี 30 ml", category: "ความงาม",
    description: "เซรั่มบำรุงผิวหน้าสูตรวิตามินซี", price: 299, compareAtPrice: 450, stock: 120,
    highlights: ["เนื้อบางเบา ซึมไว ไม่เหนอะหนะ", "ไม่มีน้ำหอม", "มีเลขที่จดแจ้ง อย."],
    specs: { ขนาด: "30 ml", วิธีใช้: "หยด 2-3 หยด เช้าและก่อนนอน", "เลขที่จดแจ้ง": "10-1-0000000000" }, status: "ACTIVE",
  },
  {
    id: "prod_bottle", sku: "BTL-750", name: "กระบอกน้ำเก็บอุณหภูมิ 750 ml", category: "ของใช้",
    description: "กระบอกน้ำสแตนเลส 2 ชั้น", price: 390, stock: 45,
    highlights: ["เก็บความเย็นได้นานตามผลทดสอบของผู้ผลิต", "ฝาล็อกกันหก", "มี 4 สี"],
    specs: { ความจุ: "750 ml", วัสดุ: "สแตนเลส 304", สี: "ขาว ดำ ชมพู เขียว" }, status: "ACTIVE",
  },
  {
    id: "prod_tee", sku: "TEE-OS", name: "เสื้อยืดโอเวอร์ไซซ์ผ้าคอตตอน", category: "แฟชั่น",
    description: "เสื้อยืดคอตตอน 100% ทรงโอเวอร์ไซซ์", price: 259, compareAtPrice: 329, stock: 80,
    highlights: ["ผ้านุ่ม ใส่สบาย", "มีไซซ์ M L XL"], specs: { ผ้า: "คอตตอน 100%", ไซซ์: "M L XL", "รอบอก XL": "48 นิ้ว" }, status: "ACTIVE",
  },
];

export const seedPromotions: Promotion[] = [
  { id: "promo_ship", title: "ส่งฟรี", detail: "ซื้อครบ 2 ชิ้นขึ้นไป ส่งฟรีทั่วประเทศ", productIds: [], active: true },
  { id: "promo_serum", title: "เซรั่มคู่", detail: "ซื้อเซรั่ม 2 ขวด ลดเพิ่ม 10%", productIds: ["prod_serum"], active: true },
];

export const seedScenes: Scene[] = [
  { id: "scene_intro", name: "เปิดไลฟ์", kind: "intro", background: "linear-gradient(160deg,#ffe3ec 0%,#ffd3b6 55%,#fff1c9 100%)", showProductCard: false, showPromoBanner: true, showCaptions: true },
  { id: "scene_product", name: "แนะนำสินค้า", kind: "product", background: "linear-gradient(170deg,#e9f1ff 0%,#f7f0ff 60%,#ffffff 100%)", showProductCard: true, showPromoBanner: true, showCaptions: true },
  { id: "scene_promo", name: "โปรโมชั่น", kind: "promo", background: "linear-gradient(160deg,#ff9a8b 0%,#ff6a88 55%,#ff99ac 100%)", showProductCard: true, showPromoBanner: true, showCaptions: true },
  { id: "scene_qa", name: "ตอบคำถาม", kind: "qa", background: "linear-gradient(160deg,#d4fc79 0%,#96e6a1 100%)", showProductCard: true, showPromoBanner: false, showCaptions: true },
  { id: "scene_break", name: "พักสักครู่", kind: "break", background: "linear-gradient(160deg,#a1c4fd 0%,#c2e9fb 100%)", showProductCard: false, showPromoBanner: false, showCaptions: true },
  { id: "scene_outro", name: "ปิดไลฟ์", kind: "outro", background: "linear-gradient(160deg,#fbc2eb 0%,#a6c1ee 100%)", showProductCard: false, showPromoBanner: false, showCaptions: true },
];

export const seedScripts: LiveScript[] = [
  {
    id: "script_demo",
    title: "ไลฟ์ตัวอย่าง 3 สินค้า",
    onEnd: "free_talk",
    steps: [
      { kind: "scene", sceneId: "scene_intro" },
      { kind: "say", text: "วันนี้มีสินค้าน่าสนใจมาแนะนำสามตัวค่ะ ใครมีคำถามพิมพ์ถามได้ตลอดเลยนะคะ", emotion: "happy" },
      { kind: "scene", sceneId: "scene_product" },
      { kind: "show_product", productId: "prod_serum" },
      { kind: "pitch_product", productId: "prod_serum" },
      { kind: "read_promo", promotionId: "promo_serum" },
      { kind: "qa_window", maxQuestions: 3 },
      { kind: "show_product", productId: "prod_bottle" },
      { kind: "pitch_product", productId: "prod_bottle" },
      { kind: "pause", ms: 1500 },
      { kind: "show_product", productId: "prod_tee" },
      { kind: "pitch_product", productId: "prod_tee" },
      { kind: "scene", sceneId: "scene_promo" },
      { kind: "read_promo", promotionId: "promo_ship" },
      { kind: "scene", sceneId: "scene_qa" },
      { kind: "qa_window", maxQuestions: 5 },
    ],
  },
];
