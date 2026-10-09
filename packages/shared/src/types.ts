/** Emotions the virtual host can express. Kept small so every one has a clear face. */
export const EMOTIONS = ["neutral", "happy", "excited", "thinking", "surprised", "calm", "apologetic"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const GESTURES = [
  "none",
  "wave",
  "point_product",
  "nod",
  "open_palms",
  "count_fingers",
  "thumbs_up",
  "heart_hands",
  "think_chin",
] as const;
export type Gesture = (typeof GESTURES)[number];

export const SCENE_KINDS = ["intro", "product", "promo", "qa", "break", "outro"] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

export type SpeechSource = "script" | "pitch" | "promo" | "qa" | "disclosure" | "system";

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  imageUrl?: string;
  category: string;
  /** Verified selling points. The host only states facts that appear here or in description/specs. */
  highlights: string[];
  /** Verified spec facts, e.g. { "ขนาด": "250 ml" }. Used to ground Q&A answers. */
  specs: Record<string, string>;
  /** Seller-written answers to questions viewers often ask about this product; used first when answering. */
  qa?: ProductQa[];
  /** Other products the seller says go well with this one; the host suggests them together. */
  pairsWith?: string[];
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
}

export interface ProductQa {
  question: string;
  answer: string;
}

export interface Promotion {
  id: string;
  title: string;
  /** Exactly what may be said on air, e.g. "ซื้อ 2 ชิ้น ลด 10%". */
  detail: string;
  productIds: string[];
  startsAt?: string;
  endsAt?: string;
  active: boolean;
  /** Discount code exactly as set in TikTok Shop; shown on screen and read by the host. */
  code?: string;
}

/** Shop-level answers (shipping, payment, returns) the host may give for any product. */
export interface FaqEntry {
  id: string;
  topic: string;
  /** Words that point a viewer question at this entry, e.g. ["ส่ง", "กี่วัน"]. */
  keywords: string[];
  answer: string;
}

/** A LIVE the autopilot starts by itself on chosen days, e.g. every day 20:00 for 2 hours. */
export interface LiveSchedule {
  id: string;
  enabled: boolean;
  /** Days of the week, 0 = Sunday ... 6 = Saturday. */
  days: number[];
  /** Local start time "HH:MM". */
  start: string;
  minutes: number;
  /** Host to put on air; the main host when unset. */
  characterId?: string;
  /** Local date "YYYY-MM-DD" of the last start attempt, so a schedule runs at most once a day. */
  lastRunDate?: string;
  /** What happened last time, shown to the seller. */
  lastResult?: string;
}

export interface StageSettings {
  shopName: string;
  /** Uploaded or remote image shown behind the host (cover). */
  backgroundImage?: string;
  backgroundDim: number; // 0..0.8 darkening over the background image
  avatarScale: number; // 0.6..1.4
  avatarX: number; // -0.3..0.3 of stage width
  avatarY: number; // -0.2..0.2 of stage height
  showCaptions: boolean;
  /** Seller's own background music (uploaded file). It ducks automatically while the host speaks. */
  bgmUrl?: string;
  /** Music volume when the host is quiet, 0..1. */
  bgmVolume: number;
  /** Scrolling announcement strip at the bottom of the stage; empty hides it. */
  tickerText: string;
  /** Show "เหลือ N ชิ้น" on the product card when stock is at or below this; 0 turns it off. Uses the stock the seller entered. */
  lowStockAt: number;
}

export interface StudioSettings {
  stage: StageSettings;
}

export interface Scene {
  id: string;
  name: string;
  kind: SceneKind;
  /** CSS background (color, gradient or url()). */
  background: string;
  showProductCard: boolean;
  showPromoBanner: boolean;
  showCaptions: boolean;
}

export interface VoiceConfig {
  provider: "browser" | "openai";
  /** Browser voice name or remote voice id. */
  voice: string;
  lang: string;
  rate: number;
  pitch: number;
}

export const HOST_ENERGIES = ["calm", "normal", "high"] as const;
export type HostEnergy = (typeof HOST_ENERGIES)[number];

export const HAIR_STYLES = ["long", "bob", "ponytail", "short", "side"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export interface HostCharacter {
  id: string;
  name: string;
  /** Always shown on stage. Cannot be blank; compliance rejects it. */
  disclosureLabel: string;
  persona: string;
  politeParticle: "ค่ะ" | "ครับ";
  /** How lively the host is on air: gestures, head motion, smiles, speaking pace. Default "high". */
  energy?: HostEnergy;
  voice: VoiceConfig;
  look: {
    skin: string;
    hair: string;
    eyes: string;
    outfit: string;
    accent: string;
    /** Cartoon hair cut. "short" and "side" are men's cuts (no lashes or earrings). Default "long". */
    hairStyle?: HairStyle;
    /** "cartoon" draws the built-in SVG character; "photo" animates an uploaded portrait; "service" streams a realistic avatar from an AI avatar service. */
    style?: "cartoon" | "photo" | "service";
    photo?: PhotoLook;
    service?: ServiceLook;
  };
}

/**
 * A realistic host made from one portrait photo. Face landmarks are detected once on
 * upload (on the user's own PC) and the stage animates the photo by warping a mesh.
 */
/** A ready-made host in the character gallery; using one adds a copy the seller can edit. */
export interface HostPreset {
  id: string;
  /** Short description shown on the gallery card. */
  tagline: string;
  character: Omit<HostCharacter, "id">;
}

/**
 * A realistic streaming avatar from an AI avatar service (D-ID). The service renders the face,
 * lip sync and voice; the app still decides every word, so the compliance guard applies.
 */
export interface ServiceLook {
  provider: "did";
  /** The D-ID agent created for this host (holds the presenter and voice). */
  agentId: string;
  presenterId: string;
  /** Still picture shown before the stream connects and in the control-room preview. */
  imageUrl: string;
  /** Microsoft Thai neural voice, e.g. th-TH-PremwadeeNeural. */
  voiceId: string;
}

export interface PhotoLook {
  imageUrl: string;
  width: number;
  height: number;
  /** 478 MediaPipe face landmarks, flattened [x, y, z, ...]; x/y in 0..1 of the image, z relative depth. */
  landmarks: number[];
  /** Hands visible in the photo (21 MediaPipe hand landmarks each, flattened like `landmarks`); they stay still while the face moves. */
  hands?: number[][];
  /** The uploader confirmed they own the photo or the person in it agreed to this use. */
  consent: true;
}

export interface SpeechSegment {
  id: string;
  text: string;
  emotion: Emotion;
  gesture: Gesture;
  /** Natural pause after this sentence. */
  pauseAfterMs: number;
  source: SpeechSource;
  productId?: string;
}

export type ScriptStep =
  | { kind: "say"; text: string; emotion?: Emotion; gesture?: Gesture }
  | { kind: "show_product"; productId: string }
  | { kind: "pitch_product"; productId: string }
  | { kind: "read_promo"; promotionId: string }
  | { kind: "scene"; sceneId: string }
  | { kind: "pause"; ms: number }
  | { kind: "qa_window"; maxQuestions: number };

export interface LiveScript {
  id: string;
  title: string;
  steps: ScriptStep[];
  /** When the script ends: loop it, stop, or keep chatting about the current product. */
  onEnd: "loop" | "stop" | "free_talk";
}

export interface ViewerQuestion {
  id: string;
  text: string;
  /** Display name typed by the operator or delivered by an approved API. Never scraped. */
  author?: string;
  /** manual: typed in Studio; quick: Quick Ask box; clipboard: copied by the operator; official_api: an approved TikTok API. */
  source: "manual" | "quick" | "clipboard" | "official_api";
  receivedAt: string;
  status: "pending" | "answered" | "skipped" | "blocked";
  answer?: string;
  /** The host could not answer from the shop's data and told the viewer the team will reply. */
  needsTeam?: boolean;
  /** The product the question was about, when known. */
  productId?: string;
}

export type LiveStatus = "DRAFT" | "READY" | "LIVE" | "ENDED";

export type LiveEventType =
  | "started"
  | "ended"
  | "spoke"
  | "scene"
  | "product_shown"
  | "promo_read"
  | "question"
  | "answer"
  | "blocked_text"
  | "disclosure"
  | "manual_stat"
  | "order";

export interface LiveEvent {
  at: string;
  type: LiveEventType;
  productId?: string;
  text?: string;
  data?: Record<string, number | string>;
}

export interface LiveSession {
  id: string;
  title: string;
  characterId: string;
  scriptId?: string;
  productIds: string[];
  status: LiveStatus;
  startedAt?: string;
  endedAt?: string;
  /** Figures the seller copies from TikTok LIVE Studio / Seller Center after the stream. */
  manualStats: { peakViewers?: number; orders?: number; gmv?: number; likes?: number };
  events: LiveEvent[];
}

export interface LiveSummary {
  sessionId: string;
  durationMinutes: number;
  sentencesSpoken: number;
  disclosures: number;
  questionsReceived: number;
  questionsAnswered: number;
  blockedTexts: number;
  productAirtime: { productId: string; name: string; mentions: number; secondsOnScreen: number }[];
  topQuestions: string[];
  manualStats: LiveSession["manualStats"];
  narrative: string;
  suggestions: string[];
}

/** A short sale at a price the seller has already set in TikTok Shop, with a countdown on screen. */
export interface FlashSale {
  productId: string;
  name: string;
  price: number;
  /** The product's normal price in this LIVE. */
  regularPrice: number;
  startedAt: string;
  endsAt: string;
}

/** Messages sent from the API to the stage window (OBS Browser Source or Electron window). */
export type StageCommand =
  | { type: "speak"; segment: SpeechSegment }
  | { type: "stop_speaking" }
  | { type: "scene"; scene: Scene }
  | { type: "product"; product: Product | null; promotions: Promotion[] }
  | { type: "character"; character: HostCharacter }
  | { type: "settings"; settings: StudioSettings }
  | { type: "question"; question: ViewerQuestion | null }
  | { type: "emotion"; emotion: Emotion }
  | { type: "gesture"; gesture: Gesture }
  | { type: "flash_sale"; sale: FlashSale | null }
  /** A discount code shown large for a few seconds while the host reads it. */
  | { type: "coupon"; promotion: Promotion }
  /** A real order the operator saw in Seller Center; shown briefly, never with the buyer's name. */
  | { type: "order"; productName: string };

/** Messages sent from the stage back to the API. */
export type StageReport =
  | { type: "hello"; role: "stage" | "preview" | "control" }
  | { type: "speech_started"; segmentId: string }
  | { type: "speech_done"; segmentId: string }
  /** Realistic avatar connection problems, shown in the control room instead of on air. Empty clears it. */
  | { type: "service_status"; message: string };
