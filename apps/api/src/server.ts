import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { generateScript, HostBrain, OpenAICompatibleLlm, summarizeLive, type LlmProvider } from "@tlai/ai";
import { summaryCsv, summaryMarkdown } from "./export.js";
import { PROHIBITED_CAPABILITIES, runPreflight, UNSUPPORTED_TIKTOK_MESSAGE } from "@tlai/compliance";
import {
  characterInput,
  faqInput,
  stageSettingsInput,
  liveSessionInput,
  manualStatsInput,
  newId,
  productInput,
  promotionInput,
  questionInput,
  sceneInput,
  scriptInput,
  EMOTIONS,
  GESTURES,
  type LiveSession,
  type StageCommand,
  type StageReport,
} from "@tlai/shared";
import { ManualTikTokProvider, OfficialTikTokProvider, type TikTokProvider } from "@tlai/tiktok";
import { BrowserTtsPlan, OpenAICompatibleTts, type TtsProvider } from "@tlai/tts";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { WebSocket } from "ws";
import { z, type ZodTypeAny } from "zod";
import { LiveDirector } from "./director.js";
import { Store, type Collection } from "./store.js";

export interface ServerOptions {
  /** JSON data file; null keeps everything in memory (tests). */
  dataFile: string | null;
  /** Built studio UI to serve at "/" (and "/#/stage" for OBS). */
  staticDir?: string;
  llm?: LlmProvider;
  tts?: TtsProvider;
  tiktok?: TikTokProvider;
  freeTalkAfterMs?: number;
  rotateEveryTurns?: number;
  logger?: boolean;
}

export function providersFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const llm = env.LLM_API_KEY && env.LLM_BASE_URL ? new OpenAICompatibleLlm({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL || "gpt-4o-mini" }) : undefined;
  const tts = env.TTS_PROVIDER === "openai" && env.TTS_API_KEY ? new OpenAICompatibleTts({ baseUrl: env.TTS_BASE_URL || "https://api.openai.com/v1", apiKey: env.TTS_API_KEY }) : new BrowserTtsPlan();
  const tiktok = env.TIKTOK_CLIENT_KEY ? new OfficialTikTokProvider({ clientKey: env.TIKTOK_CLIENT_KEY, approvedScopes: (env.TIKTOK_APPROVED_SCOPES ?? "").split(",").filter(Boolean) }) : new ManualTikTokProvider();
  return { llm, tts, tiktok };
}

export async function buildServer(opts: ServerOptions): Promise<{ app: FastifyInstance; store: Store; director: LiveDirector }> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 8 * 1024 * 1024 });
  await app.register(cors, { origin: [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] });
  await app.register(websocket);

  const store = new Store(opts.dataFile);
  const tts = opts.tts ?? new BrowserTtsPlan();
  const tiktok = opts.tiktok ?? new ManualTikTokProvider();
  const stages = new Set<WebSocket>();
  /** Real output windows (OBS / Electron stage). Previews receive commands but do not speak or report. */
  const outputs = new Set<WebSocket>();
  const controls = new Set<WebSocket>();
  const lastByType = new Map<string, StageCommand>();

  const broadcast = (set: Set<WebSocket>, msg: unknown) => {
    const data = JSON.stringify(msg);
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  };
  const director: LiveDirector = new LiveDirector({
    store,
    brain: new HostBrain(opts.llm),
    freeTalkAfterMs: opts.freeTalkAfterMs,
    rotateEveryTurns: opts.rotateEveryTurns,
    send: (cmd) => {
      if (cmd.type !== "speak" && cmd.type !== "stop_speaking" && cmd.type !== "gesture" && cmd.type !== "emotion" && cmd.type !== "question") lastByType.set(cmd.type, cmd);
      broadcast(stages, cmd);
      broadcast(controls, { type: "stage", cmd });
    },
    onState: (s) => broadcast(controls, { type: "state", state: s }),
  });

  // ---- realtime ----
  app.get("/ws", { websocket: true }, (socket) => {
    let role: "stage" | "preview" | "control" | null = null;
    socket.on("message", (raw: Buffer) => {
      let msg: StageReport;
      try {
        msg = JSON.parse(raw.toString()) as StageReport;
      } catch {
        return;
      }
      if (msg.type === "hello") {
        role = msg.role;
        (role === "control" ? controls : stages).add(socket);
        if (role === "stage") outputs.add(socket);
        if (role !== "control") {
          if (role === "stage") director.setStageConnected(true);
          // Bring a freshly opened stage (e.g. OBS reload) up to date.
          for (const cmd of lastByType.values()) socket.send(JSON.stringify(cmd));
          if (!lastByType.has("character")) socket.send(JSON.stringify({ type: "character", character: store.list("characters")[0] }));
          if (!lastByType.has("settings")) socket.send(JSON.stringify({ type: "settings", settings: store.db.settings }));
        } else socket.send(JSON.stringify({ type: "state", state: director.state() }));
      } else if (msg.type === "speech_done" && role === "stage") director.onSpeechDone(msg.segmentId);
    });
    socket.on("close", () => {
      stages.delete(socket);
      controls.delete(socket);
      outputs.delete(socket);
      if (role === "stage") director.setStageConnected(outputs.size > 0);
    });
  });

  // ---- helpers ----
  const parse = <S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> => {
    const r = schema.safeParse(body);
    if (!r.success) throw Object.assign(new Error(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")), { statusCode: 400 });
    return r.data;
  };
  const crud = (path: string, k: Collection, schema: z.AnyZodObject, prefix: string) => {
    app.get(`/api/${path}`, async () => store.list(k));
    app.get<{ Params: { id: string } }>(`/api/${path}/:id`, async (req, reply) => store.get(k, req.params.id) ?? reply.code(404).send({ error: "not found" }));
    app.post(`/api/${path}`, async (req, reply) => reply.code(201).send(store.insert(k, { id: newId(prefix), ...parse(schema, req.body) } as never)));
    app.patch<{ Params: { id: string } }>(`/api/${path}/:id`, async (req, reply) =>
      store.update(k, req.params.id, parse(schema.partial(), req.body) as never) ?? reply.code(404).send({ error: "not found" }),
    );
    app.delete<{ Params: { id: string } }>(`/api/${path}/:id`, async (req, reply) => (store.remove(k, req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: "not found" })));
  };

  crud("products", "products", productInput, "prod");
  crud("promotions", "promotions", promotionInput, "promo");
  crud("scenes", "scenes", sceneInput, "scene");
  crud("characters", "characters", characterInput, "char");
  crud("faqs", "faqs", faqInput, "faq");

  // ---- studio settings (stage layout, shop name, background) ----
  app.get("/api/settings", async () => store.db.settings);
  app.patch("/api/settings/stage", async (req) => {
    const settings = store.updateStage(parse(stageSettingsInput.partial(), req.body));
    const cmd: StageCommand = { type: "settings", settings };
    lastByType.set("settings", cmd);
    broadcast(stages, cmd);
    return settings;
  });

  // ---- image uploads (product photos, stage backgrounds) ----
  const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  const memoryUploads = new Map<string, Buffer>();
  const uploadsDir = opts.dataFile ? join(dirname(opts.dataFile), "uploads") : null;
  app.post("/api/uploads", async (req, reply) => {
    const { filename, dataBase64 } = parse(z.object({ filename: z.string().min(1).max(200), dataBase64: z.string().min(1) }), req.body);
    const ext = filename.split(".").pop()!.toLowerCase();
    if (!IMAGE_TYPES[ext]) return reply.code(400).send({ error: "รองรับเฉพาะไฟล์รูป png, jpg, webp, gif" });
    const buf = Buffer.from(dataBase64.replace(/^data:[^,]+,/, ""), "base64");
    if (buf.length > 5 * 1024 * 1024) return reply.code(413).send({ error: "ไฟล์ใหญ่เกิน 5 MB" });
    const name = `${newId("img")}.${ext}`;
    if (uploadsDir) {
      mkdirSync(uploadsDir, { recursive: true });
      writeFileSync(join(uploadsDir, name), buf);
    } else memoryUploads.set(name, buf);
    return reply.code(201).send({ url: `/uploads/${name}` });
  });
  app.get<{ Params: { name: string } }>("/uploads/:name", async (req, reply) => {
    const name = req.params.name;
    const ext = name.split(".").pop()!.toLowerCase();
    if (!/^[\w.-]+$/.test(name) || !IMAGE_TYPES[ext]) return reply.code(404).send();
    const buf = uploadsDir ? (existsSync(join(uploadsDir, name)) ? readFileSync(join(uploadsDir, name)) : undefined) : memoryUploads.get(name);
    if (!buf) return reply.code(404).send();
    return reply.type(IMAGE_TYPES[ext]!).header("cache-control", "public, max-age=31536000, immutable").send(buf);
  });
  // Registered before the CRUD routes so "generate" is not read as a script id.
  app.post("/api/scripts/generate", async (req, reply) => {
    const input = parse(
      z.object({
        title: z.string().min(1).default("สคริปต์อัตโนมัติ"),
        characterId: z.string().optional(),
        productIds: z.array(z.string()).min(1),
        durationMinutes: z.number().int().min(5).max(600).default(60),
        questionsPerProduct: z.number().int().min(1).max(10).default(3),
        save: z.boolean().default(true),
      }),
      req.body,
    );
    const character = (input.characterId && store.get("characters", input.characterId)) || store.list("characters")[0]!;
    const products = input.productIds.map((id) => store.get("products", id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (products.length === 0) return reply.code(400).send({ error: "ไม่พบสินค้าที่เลือก" });
    const plan = generateScript({ ...input, character, products, promotions: store.list("promotions"), scenes: store.list("scenes") });
    if (input.save) store.insert("scripts", plan.script);
    return reply.code(input.save ? 201 : 200).send(plan);
  });
  crud("scripts", "scripts", scriptInput, "script");

  app.get("/api/health", async () => ({ ok: true, llm: opts.llm?.id ?? "offline-templates", tts: tts.id, tiktok: tiktok.id }));
  app.get("/api/policy", async () => ({ prohibited: PROHIBITED_CAPABILITIES, tiktokProvider: tiktok.id, tiktokCapabilities: tiktok.capabilities, unsupportedMessage: UNSUPPORTED_TIKTOK_MESSAGE }));

  // ---- TTS (remote provider audio for the stage) ----
  app.post("/api/tts", async (req, reply) => {
    const { text, characterId } = parse(z.object({ text: z.string().min(1).max(600), characterId: z.string().optional() }), req.body);
    const c = (characterId && store.get("characters", characterId)) || store.list("characters")[0]!;
    const r = await tts.synthesize(text, c.voice);
    if (!r.audio) return { durationMs: r.durationMs, visemes: r.visemes, audio: null };
    return { durationMs: r.durationMs, visemes: r.visemes, mime: r.mime, audio: Buffer.from(r.audio).toString("base64") };
  });

  // ---- live sessions ----
  app.get("/api/live", async () => store.list("sessions"));
  app.get<{ Params: { id: string } }>("/api/live/:id", async (req, reply) => store.get("sessions", req.params.id) ?? reply.code(404).send({ error: "not found" }));
  app.post("/api/live", async (req, reply) => {
    const input = parse(liveSessionInput, req.body);
    const s: LiveSession = { id: newId("live"), ...input, status: "DRAFT", manualStats: {}, events: [] };
    return reply.code(201).send(store.insert("sessions", s));
  });
  app.patch<{ Params: { id: string } }>("/api/live/:id", async (req, reply) => {
    const s = store.get("sessions", req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    if (s.status === "LIVE") return reply.code(409).send({ error: "แก้ไขระหว่างไลฟ์ไม่ได้" });
    return store.update("sessions", s.id, { ...parse(liveSessionInput.partial(), req.body), status: "DRAFT" });
  });
  const preflightFor = (s: LiveSession) =>
    runPreflight({
      session: s,
      character: store.get("characters", s.characterId),
      products: store.list("products").filter((p) => s.productIds.includes(p.id)),
      promotions: store.list("promotions").filter((p) => p.active),
      script: s.scriptId ? store.get("scripts", s.scriptId) : undefined,
      faqs: store.list("faqs"),
    });
  app.post<{ Params: { id: string } }>("/api/live/:id/check", async (req, reply) => {
    const s = store.get("sessions", req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    const r = preflightFor(s);
    if (s.status === "DRAFT" || s.status === "READY") store.update("sessions", s.id, { status: r.ok ? "READY" : "DRAFT" });
    return r;
  });
  app.post<{ Params: { id: string } }>("/api/live/:id/start", async (req, reply) => {
    const s = store.get("sessions", req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    if (store.list("sessions").some((x) => x.status === "LIVE" && x.id !== s.id)) return reply.code(409).send({ error: "มีไลฟ์อื่นกำลังดำเนินอยู่" });
    const r = preflightFor(s);
    if (!r.ok) return reply.code(422).send({ error: "ตรวจสอบไม่ผ่าน เริ่มไลฟ์ไม่ได้", preflight: r });
    store.update("sessions", s.id, { status: "LIVE", startedAt: new Date().toISOString(), endedAt: undefined, events: [] });
    s.events.push({ at: s.startedAt!, type: "started" });
    director.start(s);
    return store.get("sessions", s.id);
  });
  app.post<{ Params: { id: string } }>("/api/live/:id/end", async (req, reply) => {
    const s = store.get("sessions", req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    if (s.status === "LIVE") s.events.push({ at: new Date().toISOString(), type: "ended" });
    store.update("sessions", s.id, { status: "ENDED", endedAt: s.endedAt ?? new Date().toISOString() });
    if (director.state().sessionId === s.id) director.stop();
    store.flush();
    return store.get("sessions", s.id);
  });
  app.post<{ Params: { id: string } }>("/api/live/:id/stats", async (req, reply) => {
    const s = store.get("sessions", req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    return store.update("sessions", s.id, { manualStats: { ...s.manualStats, ...parse(manualStatsInput, req.body) } });
  });
  app.get<{ Params: { id: string } }>("/api/live/:id/summary", async (req, reply) => {
    const s = store.get("sessions", req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    return summarizeLive(s, store.list("products"));
  });

  app.get<{ Params: { id: string; fmt: string } }>("/api/live/:id/export.:fmt", async (req, reply) => {
    const s = store.get("sessions", req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    const sum = summarizeLive(s, store.list("products"));
    const name = `live-${s.startedAt?.slice(0, 10) ?? "draft"}-${s.id}`;
    if (req.params.fmt === "md")
      return reply.type("text/markdown; charset=utf-8").header("content-disposition", `attachment; filename="${name}.md"`).send(summaryMarkdown(s, sum));
    if (req.params.fmt === "csv")
      return reply.type("text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${name}-events.csv"`).send(summaryCsv(s, store.list("products")));
    return reply.code(404).send({ error: "รองรับ .md และ .csv" });
  });

  // ---- director controls ----
  app.get("/api/director", async () => director.state());
  app.post("/api/director/:action", async (req, reply) => {
    const action = (req.params as { action: string }).action;
    const body = (req.body ?? {}) as Record<string, unknown>;
    switch (action) {
      case "pause": director.pause(); break;
      case "resume": director.resume(); break;
      case "skip": director.skip(); break;
      case "say": {
        const { text, emotion, gesture } = parse(z.object({ text: z.string().min(1).max(600), emotion: z.enum(EMOTIONS).optional(), gesture: z.enum(GESTURES).optional() }), body);
        const r = director.say(text, { emotion, gesture });
        if (!r.ok) return reply.code(422).send({ error: r.reason });
        break;
      }
      case "product": director.showProduct(parse(z.object({ productId: z.string().nullable() }), body).productId); break;
      case "pitch": await director.pitch(parse(z.object({ productId: z.string() }), body).productId); break;
      case "promo": director.readPromo(parse(z.object({ promotionId: z.string() }), body).promotionId); break;
      case "scene": director.setScene(parse(z.object({ sceneId: z.string() }), body).sceneId); break;
      case "gesture": director.gesture(parse(z.object({ gesture: z.enum(GESTURES) }), body).gesture); break;
      case "emotion": director.emotion(parse(z.object({ emotion: z.enum(EMOTIONS) }), body).emotion); break;
      case "qa-mode": director.qaMode = parse(z.object({ mode: z.enum(["auto", "review"]) }), body).mode; break;
      default: return reply.code(404).send({ error: "unknown action" });
    }
    return director.state();
  });

  // ---- viewer questions (typed/pasted by the operator, or from an approved API) ----
  app.get("/api/questions", async () => store.list("questions").slice(-200).reverse());
  app.post("/api/questions", async (req, reply) => {
    const { text, author } = parse(questionInput, req.body);
    return reply.code(201).send(director.addQuestion(text, author));
  });
  app.post<{ Params: { id: string } }>("/api/questions/:id/draft", async (req, reply) => {
    const t = await director.draftAnswer(req.params.id);
    return t === null ? reply.code(404).send({ error: "not found" }) : { text: t };
  });
  app.post<{ Params: { id: string } }>("/api/questions/:id/answer", async (req, reply) => {
    const { text } = parse(z.object({ text: z.string().max(600).optional() }), req.body ?? {});
    const r = await director.answerQuestion(req.params.id, text);
    return r.ok ? director.state() : reply.code(422).send({ error: r.reason });
  });
  app.post<{ Params: { id: string } }>("/api/questions/:id/skip", async (req) => {
    director.skipQuestion(req.params.id);
    return { ok: true };
  });

  // ---- TikTok (official channels only) ----
  app.get("/api/tiktok/status", async () => ({ provider: tiktok.id, capabilities: tiktok.capabilities, live: await tiktok.getLiveStatus() }));
  app.post("/api/tiktok/pin", async (req) => tiktok.pinProduct(parse(z.object({ sku: z.string() }), req.body).sku));

  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, { root: resolve(opts.staticDir), prefix: "/" });
  }

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    reply.code(err.statusCode ?? 500).send({ error: err.message });
  });
  app.addHook("onClose", async () => {
    director.stop();
    store.flush();
  });
  return { app, store, director };
}
