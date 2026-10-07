import { z } from "zod";
import { EMOTIONS, GESTURES, SCENE_KINDS } from "./types.js";

export const productInput = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  price: z.number().nonnegative(),
  compareAtPrice: z.number().nonnegative().optional(),
  stock: z.number().int().nonnegative(),
  imageUrl: z.string().url().optional(),
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
  }),
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
});

export const manualStatsInput = z.object({
  peakViewers: z.number().int().nonnegative().optional(),
  orders: z.number().int().nonnegative().optional(),
  gmv: z.number().nonnegative().optional(),
  likes: z.number().int().nonnegative().optional(),
});
