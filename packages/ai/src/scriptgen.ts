import { newId, type HostCharacter, type LiveScript, type Product, type Promotion, type Scene, type ScriptStep } from "@tlai/shared";

export interface ScriptPlanInput {
  title: string;
  character: HostCharacter;
  products: Product[];
  promotions: Promotion[];
  scenes: Scene[];
  /** Planned live length. The script loops when one pass is shorter than this. */
  durationMinutes: number;
  /** Viewer questions to take after each product. */
  questionsPerProduct?: number;
}

export interface ScriptPlan {
  script: LiveScript;
  /** Rough length of one pass through the script, for the operator. */
  minutesPerPass: number;
  passes: number;
}

/** Approximate airtime of each step kind, used only for planning. */
const STEP_SECONDS: Record<ScriptStep["kind"], number> = {
  say: 8, show_product: 0, pitch_product: 45, read_promo: 12, scene: 0, pause: 2, qa_window: 60,
};

/**
 * Builds a complete live run-sheet from the selected products: welcome, one
 * block per product (show, pitch, its promotions, Q&A), shop-wide promotions,
 * and a closing. Only catalog facts are spoken; the director adds the AI
 * disclosure itself, so the script never has to.
 */
export function generateScript(input: ScriptPlanInput): ScriptPlan {
  const c = input.character;
  const p = c.politeParticle;
  const q = p === "ค่ะ" ? "นะคะ" : "นะครับ";
  const sceneOf = (kind: Scene["kind"]) => input.scenes.find((s) => s.kind === kind)?.id;
  const sell = input.products.filter((x) => x.status === "ACTIVE");
  const active = input.promotions.filter((x) => x.active);
  const shopWide = active.filter((x) => x.productIds.length === 0);
  const qa = Math.max(1, input.questionsPerProduct ?? 3);

  const steps: ScriptStep[] = [];
  const scene = (kind: Scene["kind"]) => {
    const id = sceneOf(kind);
    if (id) steps.push({ kind: "scene", sceneId: id });
  };

  scene("intro");
  steps.push({
    kind: "say",
    text: `วันนี้มีสินค้า ${sell.length} รายการมาแนะนำ${p} ใครมีคำถามเรื่องไหน พิมพ์ถามในแชตได้ตลอด${q}`,
    emotion: "happy",
    gesture: "wave",
  });
  if (shopWide[0]) steps.push({ kind: "read_promo", promotionId: shopWide[0].id });

  sell.forEach((prod, i) => {
    scene("product");
    if (i > 0) steps.push({ kind: "say", text: i === sell.length - 1 ? `มาถึงสินค้าตัวสุดท้ายของรอบนี้แล้ว${p}` : `ต่อไปเป็นสินค้าตัวที่ ${i + 1}${p}`, emotion: "excited" });
    steps.push({ kind: "show_product", productId: prod.id });
    steps.push({ kind: "pitch_product", productId: prod.id });
    for (const promo of active.filter((x) => x.productIds.includes(prod.id))) steps.push({ kind: "read_promo", promotionId: promo.id });
    steps.push({ kind: "qa_window", maxQuestions: qa });
    steps.push({ kind: "pause", ms: 1200 });
  });

  if (shopWide.length) {
    scene("promo");
    for (const promo of shopWide) steps.push({ kind: "read_promo", promotionId: promo.id });
  }
  scene("qa");
  steps.push({ kind: "say", text: `ช่วงนี้ตอบคำถามทุกสินค้าเลย${p} ใครสงสัยตรงไหนพิมพ์มาได้${q}`, emotion: "calm", gesture: "open_palms" });
  steps.push({ kind: "qa_window", maxQuestions: Math.max(5, qa * 2) });

  const passSeconds = steps.reduce((s, x) => s + STEP_SECONDS[x.kind] + (x.kind === "pause" ? x.ms / 1000 : 0), 0);
  const minutesPerPass = Math.max(1, Math.round((passSeconds / 60) * 10) / 10);
  const passes = Math.max(1, Math.ceil(input.durationMinutes / minutesPerPass));

  return {
    script: { id: newId("script"), title: input.title, steps, onEnd: passes > 1 ? "loop" : "free_talk" },
    minutesPerPass,
    passes,
  };
}
