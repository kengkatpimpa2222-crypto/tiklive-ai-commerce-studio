import { annotate, HostBrain, type BrainContext } from "@tlai/ai";
import {
  allowedPricesFor,
  checkClaims,
  deniesBeingAi,
  isBlocked,
  openingDisclosure,
  periodicDisclosure,
  REDISCLOSURE_INTERVAL_MS,
} from "@tlai/compliance";
import {
  newId,
  type Emotion,
  type Gesture,
  type LiveEvent,
  type LiveScript,
  type LiveSession,
  type SpeechSegment,
  type StageCommand,
  type ViewerQuestion,
} from "@tlai/shared";
import { estimateDurationMs } from "@tlai/tts";
import type { Store } from "./store.js";

export type QaMode = "auto" | "review";

export interface DirectorState {
  sessionId: string | null;
  status: "idle" | "running" | "paused";
  speaking: SpeechSegment | null;
  queue: SpeechSegment[];
  currentProductId: string | null;
  sceneId: string | null;
  scriptIndex: number;
  scriptLength: number;
  qaMode: QaMode;
  stageConnected: boolean;
  lastBlocked: string | null;
  startedAt: string | null;
  /** When the next scheduled AI disclosure is due (epoch ms), while running. */
  nextDisclosureAt: number | null;
  pendingQuestions: number;
}

export interface DirectorDeps {
  store: Store;
  brain: HostBrain;
  send: (cmd: StageCommand) => void;
  onState?: (s: DirectorState) => void;
  now?: () => number;
  /** Seconds of silence before the host fills with a free-talk line (script onEnd = free_talk). */
  freeTalkAfterMs?: number;
  /** In free talk, pitch the next product after this many filler lines (0 = never rotate). */
  rotateEveryTurns?: number;
}

const ABUSE = /(ควย|เหี้ย|สัส|fuck|shit)/i;
const LINK = /(https?:\/\/|www\.|\.com\b|line\s*id|@\w{3,})/i;

/**
 * Runs the show: plays the script, keeps the host speaking one sentence at a
 * time, inserts AI disclosures, answers viewer questions and logs everything
 * for the summary. Every sentence is compliance-checked right before it is sent.
 */
const QA_STREAK = 3;

export class LiveDirector {
  private queue: SpeechSegment[] = [];
  private speaking: SpeechSegment | null = null;
  private speakTimer: NodeJS.Timeout | null = null;
  private gapTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private busy = false;
  private status: DirectorState["status"] = "idle";
  private sessionId: string | null = null;
  private script: LiveScript | undefined;
  private scriptIndex = 0;
  private qaBudget = 0;
  /** Questions the host may answer back-to-back before returning to the script; viewers should not wait long. */
  private qaBetweenSteps = QA_STREAK;
  private lastDisclosureAt = 0;
  private freeTalkTurn = 0;
  /** Everything said this session (capped), so the host does not repeat itself. */
  private spoken: { text: string; at: number }[] = [];
  private currentProductId: string | null = null;
  private sceneId: string | null = null;
  private lastBlocked: string | null = null;
  qaMode: QaMode = "auto";
  stageConnected = false;
  private readonly now: () => number;

  constructor(private readonly d: DirectorDeps) {
    this.now = d.now ?? Date.now;
  }

  // ---------- lifecycle ----------

  start(session: LiveSession): void {
    this.reset();
    this.sessionId = session.id;
    this.status = "running";
    this.script = session.scriptId ? this.d.store.get("scripts", session.scriptId) : undefined;
    const c = this.character();
    this.d.send({ type: "character", character: c });
    this.d.send({ type: "settings", settings: this.d.store.db.settings });
    // Shop-wide promotions show on screen from the first second.
    this.showProduct(null);
    const intro = this.d.store.list("scenes").find((s) => s.kind === "intro");
    if (intro) this.setScene(intro.id);
    this.enqueueDisclosure(openingDisclosure(c));
    this.pump();
  }

  stop(): void {
    this.clearTimers();
    if (this.speaking) this.d.send({ type: "stop_speaking" });
    this.reset();
    this.emit();
  }

  pause(): void {
    if (this.status !== "running") return;
    this.status = "paused";
    this.clearTimers();
    if (this.speaking) {
      this.queue.unshift(this.speaking);
      this.speaking = null;
      this.d.send({ type: "stop_speaking" });
    }
    this.emit();
  }

  resume(): void {
    if (this.status !== "paused") return;
    this.status = "running";
    this.pump();
  }

  skip(): void {
    if (!this.speaking) return;
    this.d.send({ type: "stop_speaking" });
    this.finishSegment(this.speaking.id);
  }

  // ---------- stage reports ----------

  onSpeechDone(segmentId: string): void {
    if (this.speaking?.id === segmentId) this.finishSegment(segmentId);
  }

  setStageConnected(v: boolean): void {
    this.stageConnected = v;
    this.emit();
  }

  // ---------- operator actions ----------

  say(text: string, opts: { emotion?: Emotion; gesture?: Gesture; priority?: boolean } = {}): { ok: boolean; reason?: string } {
    const check = this.check(text);
    if (!check.ok) return check;
    const segs = this.seg(text, "system", { productId: this.currentProductId ?? undefined });
    if (segs[0] && opts.emotion) segs[0].emotion = opts.emotion;
    if (segs[0] && opts.gesture) segs[0].gesture = opts.gesture;
    this.enqueue(segs, opts.priority ?? true);
    return { ok: true };
  }

  showProduct(productId: string | null): void {
    this.currentProductId = productId;
    const product = productId ? this.d.store.get("products", productId) ?? null : null;
    const promotions = this.d.store.list("promotions").filter((p) => p.active && (!product || p.productIds.length === 0 || p.productIds.includes(product.id)));
    this.d.send({ type: "product", product, promotions });
    if (productId) this.log({ type: "product_shown", productId });
    this.emit();
  }

  async pitch(productId: string, priority = true, filler = false): Promise<void> {
    const p = this.d.store.get("products", productId);
    if (!p) return;
    if (this.currentProductId !== productId) this.showProduct(productId);
    const out = await this.d.brain.pitch(p, this.brainCtx());
    if (filler && this.questionsWaiting()) return;
    if (out.issues.length) this.log({ type: "blocked_text", productId, text: out.issues.map((i) => i.code).join(",") });
    this.enqueue(this.seg(out.text, "pitch", { productId }), priority);
  }

  async readPromo(promotionId: string, priority = true): Promise<void> {
    const promo = this.d.store.get("promotions", promotionId);
    if (!promo || !promo.active) return;
    const out = await this.d.brain.promo(promo, this.brainCtx());
    this.log({ type: "promo_read", text: promo.title });
    this.enqueue(this.seg(out.text, "promo", { productId: this.currentProductId ?? undefined, baseEmotion: "excited" }), priority);
  }

  setScene(sceneId: string): void {
    const scene = this.d.store.get("scenes", sceneId);
    if (!scene) return;
    this.sceneId = sceneId;
    this.d.send({ type: "scene", scene });
    this.log({ type: "scene", text: scene.name });
    this.emit();
  }

  gesture(g: Gesture): void {
    this.d.send({ type: "gesture", gesture: g });
  }

  emotion(e: Emotion): void {
    this.d.send({ type: "emotion", emotion: e });
  }

  // ---------- viewer questions ----------

  addQuestion(text: string, author: string | undefined, source: ViewerQuestion["source"] = "manual"): ViewerQuestion {
    const recent = this.d.store
      .list("questions")
      .filter((q) => this.now() - Date.parse(q.receivedAt) < 60_000 && q.text.trim() === text.trim());
    const blocked = ABUSE.test(text) || LINK.test(text) || recent.length >= 2;
    const q: ViewerQuestion = { id: newId("q"), text: text.trim(), author, source, receivedAt: new Date(this.now()).toISOString(), status: blocked ? "blocked" : "pending" };
    this.d.store.insert("questions", q);
    this.log({ type: "question", text: q.text });
    if (!blocked) this.pump();
    this.emit();
    return q;
  }

  async draftAnswer(questionId: string): Promise<string | null> {
    const q = this.d.store.get("questions", questionId);
    if (!q) return null;
    return (await this.d.brain.answer(q.text, this.brainCtx())).text;
  }

  /** Speak an answer now. In review mode the operator may have edited the text. */
  async answerQuestion(questionId: string, editedText?: string): Promise<{ ok: boolean; reason?: string }> {
    const q = this.d.store.get("questions", questionId);
    if (!q || q.status !== "pending") return { ok: false, reason: "ไม่พบคำถามที่รอตอบ" };
    const text = editedText?.trim() || (await this.draftAnswer(questionId))!;
    const check = this.check(text);
    if (!check.ok) return check;
    this.d.store.update("questions", q.id, { status: "answered", answer: text });
    this.d.send({ type: "question", question: { ...q, status: "answered", answer: text } });
    this.log({ type: "answer", text });
    this.enqueue(this.seg(text, "qa", { productId: this.currentProductId ?? undefined }), true);
    return { ok: true };
  }

  skipQuestion(questionId: string): void {
    this.d.store.update("questions", questionId, { status: "skipped" });
    this.emit();
  }

  // ---------- state ----------

  state(): DirectorState {
    return {
      sessionId: this.sessionId,
      status: this.status,
      speaking: this.speaking,
      queue: [...this.queue],
      currentProductId: this.currentProductId,
      sceneId: this.sceneId,
      scriptIndex: this.scriptIndex,
      scriptLength: this.script?.steps.length ?? 0,
      qaMode: this.qaMode,
      stageConnected: this.stageConnected,
      lastBlocked: this.lastBlocked,
      startedAt: this.session()?.startedAt ?? null,
      nextDisclosureAt: this.sessionId ? this.lastDisclosureAt + REDISCLOSURE_INTERVAL_MS : null,
      pendingQuestions: this.sessionId ? this.pendingQuestions().length : 0,
    };
  }

  // ---------- internals ----------

  private pump(): void {
    if (this.status !== "running" || this.speaking || this.busy || this.gapTimer) return;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.now() - this.lastDisclosureAt >= REDISCLOSURE_INTERVAL_MS) {
      this.enqueueDisclosure(periodicDisclosure(this.character()));
    }
    const next = this.queue.shift();
    if (next) return this.speak(next);

    const pending = this.pendingQuestions();
    if (this.qaMode === "auto" && pending.length && (this.qaBudget > 0 || this.qaBetweenSteps > 0)) {
      if (this.qaBudget > 0) this.qaBudget--;
      else this.qaBetweenSteps--;
      return void this.runAsync(() => this.answerQuestion(pending[0]!.id));
    }
    this.qaBudget = 0;
    this.qaBetweenSteps = QA_STREAK;
    if (this.script && this.scriptIndex < this.script.steps.length) {
      const step = this.script.steps[this.scriptIndex++]!;
      return void this.runAsync(() => this.runStep(step));
    }
    if (this.script && this.script.onEnd === "loop" && this.script.steps.length) {
      this.scriptIndex = 0;
      return this.pump();
    }
    this.emit();
    if (!this.script || this.script.onEnd === "free_talk") {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        const turn = this.freeTalkTurn++;
        // Every few lines of free talk, move on to the next product so every item gets airtime.
        const every = this.d.rotateEveryTurns ?? 4;
        const lineup = this.brainCtx().products.filter((p) => p.status === "ACTIVE");
        if (every > 0 && turn > 0 && turn % every === 0 && lineup.length > 1) {
          const i = lineup.findIndex((p) => p.id === this.currentProductId);
          const next = lineup[(i + 1) % lineup.length]!;
          return void this.runAsync(() => this.pitch(next.id, false, true));
        }
        const product = this.currentProductId ? this.d.store.get("products", this.currentProductId) : undefined;
        return void this.runAsync(async () => {
          const out = await this.d.brain.freeTalk(product, this.brainCtx());
          // Writing a line can take a few seconds with an AI provider; questions that came in
          // meanwhile go first, and this line is dropped rather than wedged between answers.
          if (this.questionsWaiting()) return;
          this.queue.push(...this.seg(out.text, "system", { productId: product?.id }));
        });
        // Uneven gaps sound like someone thinking, not a timer.
      }, (this.d.freeTalkAfterMs ?? 15_000) * (0.6 + Math.random() * 0.8));
    }
  }

  private async runStep(step: NonNullable<LiveScript["steps"][number]>): Promise<void> {
    switch (step.kind) {
      case "say": {
        // When a script loops, its fixed lines would repeat word for word; skip any said in the last 20 minutes.
        if (this.saidWithin(step.text, 20 * 60_000)) return;
        const check = this.check(step.text);
        if (!check.ok) return;
        const segs = this.seg(step.text, "script", { productId: this.currentProductId ?? undefined });
        if (segs[0] && step.emotion) segs[0].emotion = step.emotion;
        if (segs[0] && step.gesture) segs[0].gesture = step.gesture;
        this.queue.push(...segs);
        return;
      }
      case "show_product":
        return this.showProduct(step.productId);
      case "pitch_product":
        return this.pitch(step.productId, false);
      case "read_promo":
        return this.readPromo(step.promotionId, false);
      case "scene":
        return this.setScene(step.sceneId);
      case "pause":
        await new Promise((r) => (this.gapTimer = setTimeout(r, step.ms)));
        this.gapTimer = null;
        return;
      case "qa_window": {
        const qa = this.d.store.list("scenes").find((s) => s.kind === "qa");
        if (qa && this.pendingQuestions().length && this.sceneId !== qa.id) this.setScene(qa.id);
        this.qaBudget = step.maxQuestions;
        return;
      }
    }
  }

  private async runAsync(fn: () => Promise<unknown> | unknown): Promise<void> {
    this.busy = true;
    try {
      await fn();
    } finally {
      this.busy = false;
    }
    this.pump();
  }

  private speak(seg: SpeechSegment): void {
    const check = this.check(seg.text, seg.productId);
    if (!check.ok) return this.pump();
    this.speaking = seg;
    this.spoken.push({ text: seg.text, at: this.now() });
    if (this.spoken.length > 200) this.spoken.splice(0, this.spoken.length - 200);
    this.d.send({ type: "speak", segment: seg });
    // If no stage confirms, fall back to the estimated duration so the show never stalls.
    const voice = this.character().voice;
    const timeout = estimateDurationMs(seg.text, voice.rate) * 1.6 + (this.stageConnected ? 4000 : 0);
    this.speakTimer = setTimeout(() => this.finishSegment(seg.id), timeout);
    this.emit();
  }

  private finishSegment(id: string): void {
    const seg = this.speaking;
    if (!seg || seg.id !== id) return;
    if (this.speakTimer) clearTimeout(this.speakTimer);
    this.speakTimer = null;
    this.speaking = null;
    this.log({ type: seg.source === "disclosure" ? "disclosure" : "spoke", text: seg.text, productId: seg.productId });
    if (this.status !== "running") return this.emit();
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      this.pump();
    }, seg.pauseAfterMs);
    this.emit();
  }

  private enqueue(segs: SpeechSegment[], priority: boolean): void {
    if (priority) {
      // Operator lines and answers go next, but never interrupt a sentence mid-way.
      const firstNonPriority = this.queue.findIndex((s) => s.source !== "qa" && s.source !== "system" && s.source !== "disclosure");
      const at = firstNonPriority < 0 ? this.queue.length : firstNonPriority;
      this.queue.splice(at, 0, ...segs);
    } else this.queue.push(...segs);
    this.pump();
    this.emit();
  }

  private enqueueDisclosure(text: string): void {
    this.lastDisclosureAt = this.now();
    this.queue.unshift(...this.seg(text, "disclosure", { baseEmotion: "calm" }).map((s) => ({ ...s, source: "disclosure" as const })));
  }

  private check(text: string, productId?: string): { ok: boolean; reason?: string } {
    const product = productId ? this.d.store.get("products", productId) : undefined;
    const issues = checkClaims(text, { product, allowedPrices: this.brainCtx().allowedPrices });
    if (deniesBeingAi(text)) issues.push({ code: "DENIES_AI", severity: "block", message: "ห้ามอ้างว่าเป็นคนจริง" });
    if (!isBlocked(issues)) return { ok: true };
    const reason = issues.filter((i) => i.severity === "block").map((i) => i.message).join(", ");
    this.lastBlocked = `${text.slice(0, 60)} → ${reason}`;
    this.log({ type: "blocked_text", text: this.lastBlocked });
    this.emit();
    return { ok: false, reason };
  }

  private questionsWaiting(): boolean {
    return this.qaMode === "auto" && this.pendingQuestions().length > 0;
  }

  private pendingQuestions(): ViewerQuestion[] {
    const since = this.session()?.startedAt ?? "";
    return this.d.store.list("questions").filter((q) => q.status === "pending" && q.receivedAt >= since);
  }

  private session(): LiveSession | undefined {
    return this.sessionId ? this.d.store.get("sessions", this.sessionId) : undefined;
  }

  private character() {
    const id = this.session()?.characterId;
    return (id && this.d.store.get("characters", id)) || this.d.store.list("characters")[0]!;
  }

  private saidWithin(text: string, ms: number): boolean {
    const t = text.replace(/\s+/g, "");
    const since = this.now() - ms;
    // Script lines are split into sentences when spoken, so compare against the joined recent speech.
    const recent = this.spoken.filter((s) => s.at >= since).map((s) => s.text.replace(/\s+/g, "")).join("");
    return t.length > 0 && recent.includes(t);
  }

  /** Splits text into speech segments in the current character's energy. */
  private seg(text: string, source: SpeechSegment["source"], opts: Parameters<typeof annotate>[2] = {}): SpeechSegment[] {
    return annotate(text, source, { ...opts, energy: this.character().energy });
  }

  /** What the host currently knows (lineup, promos, FAQ, recent speech), e.g. for trying out an AI provider. */
  brainContext(): BrainContext {
    return this.brainCtx();
  }

  private brainCtx(): BrainContext {
    const s = this.session();
    const all = this.d.store.list("products");
    const products = s?.productIds.length ? all.filter((p) => s.productIds.includes(p.id)) : all;
    const promotions = this.d.store.list("promotions").filter((p) => p.active);
    return {
      character: this.character(),
      products,
      promotions,
      currentProductId: this.currentProductId ?? undefined,
      allowedPrices: allowedPricesFor(all, promotions),
      faqs: this.d.store.list("faqs"),
      recent: this.spoken.slice(-60).map((s) => s.text),
      hour: new Date(this.now()).getHours(),
    };
  }

  private log(e: Omit<LiveEvent, "at">): void {
    const s = this.session();
    if (!s || s.status !== "LIVE") return;
    s.events.push({ at: new Date(this.now()).toISOString(), ...e });
    this.d.store.save();
  }

  private emit(): void {
    this.d.onState?.(this.state());
  }

  private clearTimers(): void {
    for (const t of [this.speakTimer, this.gapTimer, this.idleTimer]) if (t) clearTimeout(t);
    this.speakTimer = this.gapTimer = this.idleTimer = null;
  }

  private reset(): void {
    this.clearTimers();
    this.queue = [];
    this.speaking = null;
    this.busy = false;
    this.status = "idle";
    this.sessionId = null;
    this.script = undefined;
    this.scriptIndex = 0;
    this.qaBudget = 0;
    this.qaBetweenSteps = QA_STREAK;
    this.lastDisclosureAt = 0;
    this.freeTalkTurn = 0;
    this.spoken = [];
    this.currentProductId = null;
    this.lastBlocked = null;
  }
}
