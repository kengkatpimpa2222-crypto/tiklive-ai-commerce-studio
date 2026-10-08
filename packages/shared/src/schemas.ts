import { z } from "zod";
import { EMOTIONS, GESTURES, SCENE_KINDS } from "./types.js";

export const productInput = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  price: z.number().nonnegative(),
  compareAtPrice: z.number().nonnegative().optional(),
  stock: z.number().int().nonnegative(),
  /** http(s) URL or an image uploaded to this app (/uploads/...). */
  imageUrl: z.string().regex(/^(https?:\/\/|\/uploads\/)/).optional(),
  category: z.string().default("ทั่วไป"),
  highlights: z.array(z.string().min(1)).default([]),
  specs: z.record(z.string()).default({}),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("ACTIVE"),
});

export const promotionInput = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  productIds: z.array(z.string()).default([]),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  active: z.boolean().default(true),
});

export const sceneInput = z.object({
  name: z.string().min(1),
  kind: z.enum(SCENE_KINDS),
  background: z.string().min(1),
  showProductCard: z.boolean().default(true),
  showPromoBanner: z.boolean().default(true),
  showCaptions: z.boolean().default(true),
});

export const characterInput = z.object({
  name: z.string().min(1),
  disclosureLabel: z.string().min(4),
  persona: z.string().default(""),
  politeParticle: z.enum(["ค่ะ", "ครับ"]).default("ค่ะ"),
  energy: z.enum(["calm", "normal", "high"]).optional(),
  voice: z.object({
    provider: z.enum(["browser", "openai"]).default("browser"),
    voice: z.string().default(""),
    lang: z.string().default("th-TH"),
    rate: z.number().min(0.5).max(2).default(1),
    pitch: z.number().min(0).max(2).default(1),
  }),
  look: z.object({
    skin: z.string(),
    hair: z.string(),
    eyes: z.string(),
    outfit: z.string(),
    accent: z.string(),
    hairStyle: z.enum(["long", "bob", "ponytail", "short", "side"]).optional(),
    style: z.enum(["cartoon", "photo", "service"]).optional(),
    service: z
      .object({
        provider: z.literal("did"),
        agentId: z.string().min(1),
        presenterId: z.string().min(1),
        imageUrl: z.string(),
        voiceId: z.string().regex(/^[a-z]{2}-[A-Z]{2}-\w+$/),
      })
      .optional(),
    photo: z
      .object({
        imageUrl: z.string().regex(/^(https?:\/\/|\/uploads\/)/),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        landmarks: z.array(z.number()).length(478 * 3),
        hands: z.array(z.array(z.number()).length(21 * 3)).max(2).optional(),
        consent: z.literal(true, { errorMap: () => ({ message: "ต้องยืนยันสิทธิ์ในการใช้รูปและความยินยอมของบุคคลในรูป" }) }),
      })
      .optional(),
  })
    .refine((l) => l.style !== "photo" || !!l.photo, { message: "โหมดรูปถ่ายต้องอัปโหลดรูปใบหน้าก่อน" })
    .refine((l) => l.style !== "service" || !!l.service, { message: "ตัวละครเหมือนคนจริงต้องเลือกจากคลังตัวละครของบริการอวตาร AI" }),
});

const scriptStep = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("say"), text: z.string().min(1), emotion: z.enum(EMOTIONS).optional(), gesture: z.enum(GESTURES).optional() }),
  z.object({ kind: z.literal("show_product"), productId: z.string() }),
  z.object({ kind: z.literal("pitch_product"), productId: z.string() }),
  z.object({ kind: z.literal("read_promo"), promotionId: z.string() }),
  z.object({ kind: z.literal("scene"), sceneId: z.string() }),
  z.object({ kind: z.literal("pause"), ms: z.number().int().min(0).max(60_000) }),
  z.object({ kind: z.literal("qa_window"), maxQuestions: z.number().int().min(1).max(20) }),
]);

export const scriptInput = z.object({
  title: z.string().min(1),
  steps: z.array(scriptStep),
  onEnd: z.enum(["loop", "stop", "free_talk"]).default("stop"),
});

export const liveSessionInput = z.object({
  title: z.string().min(1),
  characterId: z.string(),
  scriptId: z.string().optional(),
  productIds: z.array(z.string()).default([]),
});

export const questionInput = z.object({
  text: z.string().min(1).max(500),
  author: z.string().max(60).optional(),
  source: z.enum(["manual", "quick", "clipboard"]).optional(),
});

export const manualStatsInput = z.object({
  peakViewers: z.number().int().nonnegative().optional(),
  orders: z.number().int().nonnegative().optional(),
  gmv: z.number().nonnegative().optional(),
  likes: z.number().int().nonnegative().optional(),
});

export const faqInput = z.object({
  topic: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  answer: z.string().min(1).max(400),
});

export const stageSettingsInput = z.object({
  shopName: z.string().max(40),
  backgroundImage: z.string().max(500).optional(),
  backgroundDim: z.number().min(0).max(0.8),
  avatarScale: z.number().min(0.6).max(1.4),
  avatarX: z.number().min(-0.3).max(0.3),
  avatarY: z.number().min(-0.2).max(0.2),
  showCaptions: z.boolean(),
});
