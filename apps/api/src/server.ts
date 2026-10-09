import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { AI_PRESETS, BLOCKED_IMPORT_HOSTS, createLlm, generateScript, importProduct, metaToText, parsePageMeta, HostBrain, OpenAICompatibleLlm, summarizeLive, type AiConfig, type LlmProvider, type LlmUsage } from "@tlai/ai";
import { summaryCsv, summaryMarkdown } from "./export.js";
import { hostPresets } from "./seed.js";
import { DidClient, THAI_VOICES, defaultThaiVoice } from "./avatarService.js";
import { DEFAULT_DISCLOSURE_LABEL, PROHIBITED_CAPABILITIES, runPreflight, UNSUPPORTED_TIKTOK_MESSAGE } from "@tlai/compliance";
import {
  characterInput,
  faqInput,
  stageSettingsInput,
  liveSessionInput,
  manualStatsInput,
  newId,
  productInput,
  scheduleInput,
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
import { dueSchedule, HEADS_UP_MS, localDate, nextRun } from "./schedule.js";
import { Store, type Collection } from "./store.js";

export interface ServerOptions {
  /** JSON data file; null keeps everything in memory (tests). */
  dataFile: string | null;
  /** Built studio UI to serve at "/" (and "/#/stage" for OBS). */
  staticDir?: string;
  /** Provider from environment variables; settings saved in the app take precedence. */
  llm?: LlmProvider;
  /** Test hook for AI provider HTTP calls. */
  llmFetch?: typeof fetch;
  /** Test hook for the avatar service (D-ID) HTTP calls. */
  avatarFetch?: typeof fetch;
  tts?: TtsProvider;
  tiktok?: TikTokProvider;
  freeTalkAfterMs?: number;
  promoEveryMs?: number;
  rotateEveryTurns?: number;
  logger?: boolean;
  /** Desktop-only comment capture (clipboard watch + hotkeys), owned by the Electron main process. */
  capture?: CaptureControl;
  /** Desktop notification for scheduled LIVE reminders and results. */
  notify?: (title: string, body: string) => void;
  /** How often scheduled LIVEs are checked; 0 turns the timer off (tests call runSchedules). */
  scheduleTickMs?: number;
}

export interface CaptureState {
  /** Every text the operator copies (Ctrl+C) outside the app becomes a viewer question. */
  clipboardWatch: boolean;
  /** Global hotkey that sends the current clipboard as a question. */
  sendClipboardHotkey: string;
  /** Global hotkey that shows the Quick Ask box. */
  quickAskHotkey: string;
}

export interface CaptureControl {
  get(): CaptureState;
  set(patch: Partial<Pick<CaptureState, "clipboardWatch">>): CaptureState;
}

export function providersFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const llm = env.LLM_API_KEY && env.LLM_BASE_URL ? new OpenAICompatibleLlm({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL || "gpt-4o-mini" }) : undefined;
  const tts = env.TTS_PROVIDER === "openai" && env.TTS_API_KEY ? new OpenAICompatibleTts({ baseUrl: env.TTS_BASE_URL || "https://api.openai.com/v1", apiKey: env.TTS_API_KEY }) : new BrowserTtsPlan();
  const tiktok = env.TIKTOK_CLIENT_KEY ? new OfficialTikTokProvider({ clientKey: env.TIKTOK_CLIENT_KEY, approvedScopes: (env.TIKTOK_APPROVED_SCOPES ?? "").split(",").filter(Boolean) }) : new ManualTikTokProvider();
  return { llm, tts, tiktok };
}

export async function buildServer(opts: ServerOptions): Promise<{ app: FastifyInstance; store: Store; director: LiveDirector; runSchedules: (now?: Date) => void }> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 32 * 1024 * 1024 });
  await app.register(cors, { origin: [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] });
  await app.register(websocket);

  const store = new Store(opts.dataFile);
  // A LIVE left over from a previous run (app closed or crashed mid-live) has no director
  // behind it any more; end it so it keeps its summary and does not block the next LIVE.
  for (const s of store.list("sessions")) {
    if (s.status === "LIVE") store.update("sessions", s.id, { status: "ENDED", endedAt: s.events.at(-1)?.at ?? s.startedAt ?? new Date().toISOString() });
  }
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
  // ---- AI provider for the host's speech (switchable from the settings page) ----
  const usage = { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, lastError: null as string | null, since: new Date().toISOString() };
  const count = (u: LlmUsage) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
  };
  /** Records calls and the last error so the settings page can show whether the AI is really answering. */
  const tracked = (inner: LlmProvider | undefined, onError?: (m: string) => void): LlmProvider | undefined =>
    inner && {
      id: inner.id,
      complete: async (m, o) => {
        try {
          const text = await inner.complete(m, o);
          usage.calls++;
          usage.lastError = null;
          return text;
        } catch (e) {
          usage.errors++;
          usage.lastError = (e as Error).message;
          onError?.((e as Error).message);
          throw e;
        }
      },
    };
  const activeLlm = () => tracked(store.db.ai ? createLlm(store.db.ai, count, opts.llmFetch) : opts.llm);
  const brain = new HostBrain(activeLlm());
  // Lines the director sent to the stage. A streaming avatar may only speak these.
  const spokenSegments = new Map<string, string>();
  const rememberSegment = (id: string, text: string) => {
    spokenSegments.set(id, text);
    if (spokenSegments.size > 200) spokenSegments.delete(spokenSegments.keys().next().value!);
  };

  const director: LiveDirector = new LiveDirector({
    store,
    brain,
    freeTalkAfterMs: opts.freeTalkAfterMs,
    promoEveryMs: opts.promoEveryMs,
    rotateEveryTurns: opts.rotateEveryTurns,
    send: (cmd) => {
      if (cmd.type === "speak") rememberSegment(cmd.segment.id, cmd.segment.text);
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
          if (!lastByType.has("character")) socket.send(JSON.stringify({ type: "character", character: store.mainCharacter() }));
          if (!lastByType.has("settings")) socket.send(JSON.stringify({ type: "settings", settings: store.db.settings }));
        } else socket.send(JSON.stringify({ type: "state", state: director.state() }));
      } else if (msg.type === "speech_done" && role === "stage") director.onSpeechDone(msg.segmentId);
      else if (msg.type === "service_status" && role === "stage") broadcast(controls, { type: "service_status", message: String(msg.message).slice(0, 300) });
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
  // Gallery and main host. Registered before the CRUD routes so "/presets" and "/main" are not read as ids.
  app.get("/api/characters/presets", async () => hostPresets);
  app.post<{ Params: { id: string } }>("/api/characters/presets/:id/use", async (req, reply) => {
    const preset = hostPresets.find((p) => p.id === req.params.id);
    if (!preset) return reply.code(404).send({ error: "not found" });
    const c = store.insert("characters", { id: newId("char"), ...structuredClone(preset.character) });
    store.setMainCharacter(c.id);
    return reply.code(201).send(c);
  });
  app.get("/api/characters/main", async () => ({ id: store.mainCharacter()?.id ?? null }));
  app.put("/api/characters/main", async (req, reply) => {
    const { id } = parse(z.object({ id: z.string() }), req.body);
    if (!store.get("characters", id)) return reply.code(404).send({ error: "not found" });
    store.setMainCharacter(id);
    return { id };
  });
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
  const AUDIO_TYPES: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" };
  const MEDIA_TYPES = { ...IMAGE_TYPES, ...AUDIO_TYPES };
  const memoryUploads = new Map<string, Buffer>();
  const uploadsDir = opts.dataFile ? join(dirname(opts.dataFile), "uploads") : null;
  const saveUpload = (buf: Buffer, ext: string): string => {
    const name = `${newId("img")}.${ext}`;
    if (uploadsDir) {
      mkdirSync(uploadsDir, { recursive: true });
      writeFileSync(join(uploadsDir, name), buf);
    } else memoryUploads.set(name, buf);
    return `/uploads/${name}`;
  };
  app.post("/api/uploads", async (req, reply) => {
    const { filename, dataBase64 } = parse(z.object({ filename: z.string().min(1).max(200), dataBase64: z.string().min(1) }), req.body);
    const ext = filename.split(".").pop()!.toLowerCase();
    const audio = !!AUDIO_TYPES[ext];
    if (!IMAGE_TYPES[ext] && !audio) return reply.code(400).send({ error: "รองรับเฉพาะไฟล์รูป png, jpg, webp, gif หรือเพลง mp3, m4a, ogg, wav" });
    const buf = Buffer.from(dataBase64.replace(/^data:[^,]+,/, ""), "base64");
    if (buf.length > (audio ? 20 : 5) * 1024 * 1024) return reply.code(413).send({ error: `ไฟล์ใหญ่เกิน ${audio ? 20 : 5} MB` });
    return reply.code(201).send({ url: saveUpload(buf, ext) });
  });
  app.get<{ Params: { name: string } }>("/uploads/:name", async (req, reply) => {
    const name = req.params.name;
    const ext = name.split(".").pop()!.toLowerCase();
    if (!/^[\w.-]+$/.test(name) || !MEDIA_TYPES[ext]) return reply.code(404).send();
    const buf = uploadsDir ? (existsSync(join(uploadsDir, name)) ? readFileSync(join(uploadsDir, name)) : undefined) : memoryUploads.get(name);
    if (!buf) return reply.code(404).send();
    return reply.type(MEDIA_TYPES[ext]!).header("cache-control", "public, max-age=31536000, immutable").send(buf);
  });
  // ---- product import: a pasted link (its preview metadata) or pasted text → draft for review ----
  const fetchPage = async (url: URL, accept: string, maxBytes: number) => {
    const f = opts.llmFetch ?? fetch;
    const res = await f(url, { headers: { "user-agent": IMPORT_UA, accept }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) throw new Error("too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("too large");
    return { res, buf };
  };
  /** Honour the site's robots.txt for our user agent (and "*"). */
  const robotsAllow = async (url: URL): Promise<boolean> => {
    try {
      const { res, buf } = await fetchPage(new URL("/robots.txt", url), "text/plain", 512 * 1024);
      if (!res.ok) return true;
      return robotsAllows(buf.toString("utf8"), url.pathname + url.search);
    } catch {
      return true;
    }
  };
  app.post("/api/products/import", async (req, reply) => {
    const { url, text } = parse(z.object({ url: z.string().trim().optional(), text: z.string().trim().max(20_000).optional() }), req.body);
    const llm = activeLlm();
    if (text && !url) return importProduct(text, llm);
    let u: URL;
    try {
      u = new URL(url ?? "");
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch {
      return reply.code(400).send({ error: "ลิงก์ไม่ถูกต้อง ต้องขึ้นต้นด้วย http:// หรือ https://" });
    }
    if (BLOCKED_IMPORT_HOSTS.test(u.hostname)) {
      return reply.code(422).send({ error: "ลิงก์ TikTok ดึงข้อมูลอัตโนมัติไม่ได้ เพราะ TikTok ไม่อนุญาตให้โปรแกรมอ่านหน้าเว็บ ให้คัดลอกชื่อ ราคา และรายละเอียดสินค้าจาก TikTok Shop Seller Center มาวางในช่องข้อความแทน", needsText: true });
    }
    if (!(await robotsAllow(u))) return reply.code(422).send({ error: "เว็บนี้ไม่อนุญาตให้โปรแกรมอ่านหน้าสินค้า ให้คัดลอกข้อความสินค้ามาวางแทน", needsText: true });
    let html: string;
    try {
      const { res, buf } = await fetchPage(u, "text/html,application/xhtml+xml", 3 * 1024 * 1024);
      if (!res.ok) throw new Error(String(res.status));
      html = buf.toString("utf8");
    } catch {
      return reply.code(422).send({ error: "เปิดลิงก์นี้ไม่ได้ ให้คัดลอกข้อความสินค้ามาวางแทน", needsText: true });
    }
    const meta = parsePageMeta(html, u.href);
    const pageText = [metaToText(meta), text].filter(Boolean).join("\n");
    if (!meta.title || pageText.length < 20) return reply.code(422).send({ error: "หน้านี้ไม่มีข้อมูลสินค้าให้อ่าน ให้คัดลอกข้อความสินค้ามาวางแทน", needsText: true });
    // Keep the product photo inside the app so the stage never depends on the shop's server.
    let imageUrl: string | undefined;
    if (meta.image) {
      try {
        const img = new URL(meta.image);
        const { res, buf } = await fetchPage(img, "image/*", 5 * 1024 * 1024);
        const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[(res.headers.get("content-type") ?? "").split(";")[0]!.trim()];
        if (res.ok && ext) imageUrl = saveUpload(buf, ext);
      } catch {
        /* no photo is fine */
      }
    }
    const result = await importProduct(pageText, llm, { imageUrl, sku: meta.sku });
    return { ...result, source: u.hostname };
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
    const character = (input.characterId && store.get("characters", input.characterId)) || store.mainCharacter()!;
    const products = input.productIds.map((id) => store.get("products", id)).filter((p): p is NonNullable<typeof p> => !!p);
    if (products.length === 0) return reply.code(400).send({ error: "ไม่พบสินค้าที่เลือก" });
    const plan = generateScript({ ...input, character, products, promotions: store.list("promotions"), scenes: store.list("scenes") });
    if (input.save) store.insert("scripts", plan.script);
    return reply.code(input.save ? 201 : 200).send(plan);
  });
  crud("scripts", "scripts", scriptInput, "script");

  // ---- AI brain settings ----
  const aiInput = z.object({
    provider: z.enum(["off", "claude", "openai", "gemini", "custom"]),
    model: z.string().trim().max(200).default(""),
    baseUrl: z.string().trim().url("ที่อยู่ API ต้องเป็น URL เช่น http://localhost:11434/v1").optional().or(z.literal("")),
    /** Omitted keeps the saved key; "" removes it. */
    apiKey: z.string().trim().max(500).optional(),
  });
  const merged = (body: z.infer<typeof aiInput>): AiConfig => ({
    provider: body.provider,
    model: body.model || (body.provider !== "off" ? AI_PRESETS[body.provider].models[0]?.id ?? "" : ""),
    baseUrl: body.baseUrl || undefined,
    apiKey: body.apiKey ?? (store.db.ai?.provider === body.provider ? store.db.ai.apiKey : ""),
  });
  const aiView = () => {
    const cfg = store.db.ai;
    const key = cfg?.apiKey ?? "";
    return {
      provider: cfg?.provider ?? "off",
      model: cfg?.model ?? "",
      baseUrl: cfg?.baseUrl ?? "",
      hasKey: key.length > 0,
      keyHint: key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key ? "••••" : "",
      source: cfg ? (brain.usesLlm ? "settings" : "off") : opts.llm ? "env" : "off",
      active: brain.usesLlm,
      usage,
      presets: AI_PRESETS,
    };
  };
  app.get("/api/ai", async () => aiView());
  app.put("/api/ai", async (req, reply) => {
    const cfg = merged(parse(aiInput, req.body));
    if (cfg.provider !== "off" && !createLlm(cfg)) {
      return reply.code(400).send({ error: cfg.provider === "custom" ? "ใส่ที่อยู่ API และชื่อโมเดล" : "ใส่ API key ก่อนเปิดใช้" });
    }
    store.setAi(cfg);
    brain.setLlm(activeLlm());
    usage.lastError = null;
    return aiView();
  });
  /** Asks the AI for one real line about the current lineup, without saving anything. */
  app.post("/api/ai/test", async (req, reply) => {
    const cfg = merged(parse(aiInput, req.body ?? { provider: store.db.ai?.provider ?? "off" }));
    let failure = "";
    const llm = tracked(createLlm(cfg, count, opts.llmFetch), (m) => (failure = m));
    if (!llm) return reply.code(400).send({ error: cfg.provider === "custom" ? "ใส่ที่อยู่ API และชื่อโมเดล" : "ใส่ API key ก่อนทดสอบ" });
    const ctx = director.brainContext();
    const product = ctx.products.find((p) => p.id === ctx.currentProductId) ?? ctx.products.find((p) => p.status === "ACTIVE");
    const started = Date.now();
    const out = await new HostBrain(llm).freeTalk(product, ctx);
    if (failure) return reply.code(400).send({ error: failure });
    return { text: out.text, via: out.via, ms: Date.now() - started };
  });

  // ---- realistic streaming avatar (D-ID) ----
  const did = () => (store.db.avatarService?.apiKey ? new DidClient(store.db.avatarService.apiKey, opts.avatarFetch) : null);
  const needDid = () => {
    const c = did();
    if (!c) throw Object.assign(new Error("ยังไม่ได้ใส่ API key ของ D-ID"), { statusCode: 400 });
    return c;
  };
  const serviceView = () => {
    const key = store.db.avatarService?.apiKey ?? "";
    return { provider: "did", hasKey: key.length > 0, keyHint: key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key ? "••••" : "", voices: THAI_VOICES };
  };
  let presenterCache: { at: number; list: Awaited<ReturnType<DidClient["presenters"]>> } | null = null;
  /** One stream at a time: a reloaded stage replaces the old one instead of paying for two. */
  let activeStream: { agentId: string; streamId: string; sessionId: string; characterId: string } | null = null;
  const closeActiveStream = async () => {
    const s = activeStream;
    activeStream = null;
    if (s) await did()?.closeStream(s.agentId, s.streamId, s.sessionId).catch(() => undefined);
  };
  const streamFor = (id: string) => {
    if (!activeStream || activeStream.streamId !== id) throw Object.assign(new Error("การเชื่อมต่ออวตารหมดอายุ กำลังเชื่อมใหม่"), { statusCode: 410 });
    return activeStream;
  };

  app.get("/api/avatar-service", async () => serviceView());
  app.put("/api/avatar-service", async (req) => {
    const { apiKey } = parse(z.object({ apiKey: z.string().trim().max(500) }), req.body);
    if (!apiKey) {
      await closeActiveStream();
      store.setAvatarService(undefined);
    } else {
      // Only keep a key that works.
      await new DidClient(apiKey, opts.avatarFetch).credits();
      store.setAvatarService({ provider: "did", apiKey });
    }
    presenterCache = null;
    return serviceView();
  });
  app.post("/api/avatar-service/test", async () => needDid().credits());
  app.get("/api/avatar-service/presenters", async () => {
    const c = needDid();
    if (!presenterCache || Date.now() - presenterCache.at > 30 * 60_000) presenterCache = { at: Date.now(), list: await c.presenters() };
    return presenterCache.list;
  });
  app.post("/api/avatar-service/use", async (req, reply) => {
    const c = needDid();
    const body = parse(z.object({ presenterId: z.string().min(1), name: z.string().trim().min(1).max(60), gender: z.string().default(""), imageUrl: z.string().url() }), req.body);
    const voiceId = defaultThaiVoice(body.gender);
    const agentId = await c.createAgent(body.name, body.presenterId, voiceId);
    const female = body.gender !== "male";
    const ch = store.insert("characters", {
      id: newId("char"),
      name: body.name,
      disclosureLabel: DEFAULT_DISCLOSURE_LABEL,
      persona: female ? "สดใส เป็นกันเอง อธิบายสินค้าชัดเจนและตรงไปตรงมา" : "สุภาพ น่าเชื่อถือ อธิบายจุดเด่นสินค้าเป็นภาษาง่าย",
      politeParticle: female ? "ค่ะ" : "ครับ",
      energy: "high",
      voice: { provider: "browser", voice: "", lang: "th-TH", rate: 1, pitch: 1 },
      look: { skin: "#f3cfb3", hair: "#2a1b17", eyes: "#3a2418", outfit: "#ff4f7b", accent: "#ffd166", style: "service", service: { provider: "did", agentId, presenterId: body.presenterId, imageUrl: body.imageUrl, voiceId } },
    });
    store.setMainCharacter(ch.id);
    return reply.code(201).send(ch);
  });
  app.post("/api/avatar-service/streams", async (req) => {
    const c = needDid();
    const { characterId } = parse(z.object({ characterId: z.string() }), req.body);
    const ch = store.get("characters", characterId);
    const svc = ch?.look.style === "service" ? ch.look.service : undefined;
    if (!svc) throw Object.assign(new Error("ตัวละครนี้ไม่ได้ใช้บริการอวตาร AI"), { statusCode: 400 });
    await closeActiveStream();
    const init = await c.createStream(svc.agentId);
    activeStream = { agentId: svc.agentId, streamId: init.streamId, sessionId: init.sessionId, characterId };
    return { streamId: init.streamId, offer: init.offer, iceServers: init.iceServers };
  });
  app.post<{ Params: { id: string } }>("/api/avatar-service/streams/:id/sdp", async (req) => {
    const s = streamFor(req.params.id);
    const { answer } = parse(z.object({ answer: z.object({ type: z.literal("answer"), sdp: z.string() }) }), req.body);
    await needDid().sdp(s.agentId, s.streamId, s.sessionId, answer);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/avatar-service/streams/:id/ice", async (req) => {
    const s = streamFor(req.params.id);
    const c = parse(z.object({ candidate: z.string().optional(), sdpMid: z.string().nullable().optional(), sdpMLineIndex: z.number().nullable().optional() }), req.body ?? {});
    await needDid().ice(s.agentId, s.streamId, s.sessionId, c);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/avatar-service/streams/:id/speak", async (req, reply) => {
    const s = streamFor(req.params.id);
    const { segmentId } = parse(z.object({ segmentId: z.string() }), req.body);
    const text = spokenSegments.get(segmentId);
    if (!text) return reply.code(404).send({ error: "ไม่พบประโยคนี้ในไลฟ์" });
    const ch = store.get("characters", s.characterId);
    const voiceId = ch?.look.service?.voiceId ?? defaultThaiVoice(undefined);
    const r = await needDid().speak(s.agentId, s.streamId, s.sessionId, text, voiceId);
    return { duration: r.duration ?? null };
  });
  app.delete<{ Params: { id: string } }>("/api/avatar-service/streams/:id", async (req) => {
    if (activeStream?.streamId === req.params.id) await closeActiveStream();
    return { ok: true };
  });

  app.get("/api/health", async () => ({ ok: true, llm: brain.usesLlm ? store.db.ai?.provider ?? opts.llm?.id : "offline-templates", tts: tts.id, tiktok: tiktok.id }));
  app.get("/api/policy", async () => ({ prohibited: PROHIBITED_CAPABILITIES, tiktokProvider: tiktok.id, tiktokCapabilities: tiktok.capabilities, unsupportedMessage: UNSUPPORTED_TIKTOK_MESSAGE }));

  // ---- TTS (remote provider audio for the stage) ----
  app.post("/api/tts", async (req, reply) => {
    const { text, characterId } = parse(z.object({ text: z.string().min(1).max(600), characterId: z.string().optional() }), req.body);
    const c = (characterId && store.get("characters", characterId)) || store.mainCharacter()!;
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
  let autopilot: { sessionId: string; endsAt: string | null; timer: NodeJS.Timeout | null } | null = null;
  const autopilotView = () => {
    const live = autopilot && store.get("sessions", autopilot.sessionId)?.status === "LIVE";
    return { active: !!live, sessionId: live ? autopilot!.sessionId : null, endsAt: live ? autopilot!.endsAt : null };
  };
  const startSession = (s: LiveSession) => {
    store.update("sessions", s.id, { status: "LIVE", startedAt: new Date().toISOString(), endedAt: undefined, events: [] });
    s.events.push({ at: s.startedAt!, type: "started" });
    director.start(s);
    return store.get("sessions", s.id);
  };
  const endSession = (s: LiveSession) => {
    if (s.status === "LIVE") s.events.push({ at: new Date().toISOString(), type: "ended" });
    store.update("sessions", s.id, { status: "ENDED", endedAt: s.endedAt ?? new Date().toISOString() });
    if (director.state().sessionId === s.id) director.stop();
    if (autopilot?.sessionId === s.id) {
      if (autopilot.timer) clearTimeout(autopilot.timer);
      autopilot = null;
    }
    store.flush();
    return store.get("sessions", s.id);
  };
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
    return startSession(s);
  });
  app.post<{ Params: { id: string } }>("/api/live/:id/end", async (req, reply) => {
    const s = store.get("sessions", req.params.id);
    if (!s) return reply.code(404).send({ error: "not found" });
    return endSession(s);
  });

  // ---- autopilot: one button starts a complete LIVE that runs and ends on its own ----
  app.get("/api/autopilot", async () => autopilotView());
  type AutopilotResult = { ok: true; session: LiveSession } | { ok: false; code: number; body: { error: string; preflight?: unknown } };
  const startAutopilot = (minutes: number, characterId?: string): AutopilotResult => {
    if (store.list("sessions").some((x) => x.status === "LIVE")) return { ok: false, code: 409, body: { error: "มีไลฟ์กำลังดำเนินอยู่" } };
    const products = store.list("products").filter((p) => p.status === "ACTIVE");
    if (!products.length) return { ok: false, code: 422, body: { error: "ยังไม่มีสินค้าที่เปิดขาย เพิ่มสินค้าก่อน" } };
    const chars = store.list("characters");
    // The host the seller picked as main goes on air; otherwise a realistic photo host if one is set up; otherwise the first.
    const character =
      (characterId && store.get("characters", characterId)) ||
      (store.db.mainCharacterId && store.get("characters", store.db.mainCharacterId)) ||
      chars.find((c) => c.look.style === "photo" && c.look.photo) ||
      chars[0];
    if (!character) return { ok: false, code: 422, body: { error: "ยังไม่มีตัวละคร" } };
    const now = new Date();
    const s: LiveSession = {
      id: newId("live"),
      title: `ไลฟ์อัตโนมัติ ${now.toLocaleDateString("th-TH", { day: "numeric", month: "short" })} ${now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`,
      characterId: character.id,
      productIds: products.map((p) => p.id),
      status: "DRAFT",
      manualStats: {},
      events: [],
    };
    store.insert("sessions", s);
    const r = preflightFor(s);
    if (!r.ok) {
      store.remove("sessions", s.id);
      return { ok: false, code: 422, body: { error: "ตรวจสอบไม่ผ่าน เริ่มไลฟ์ไม่ได้", preflight: r } };
    }
    director.qaMode = "auto";
    opts.capture?.set({ clipboardWatch: true });
    startSession(s);
    autopilot = { sessionId: s.id, endsAt: minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null, timer: null };
    if (minutes) {
      autopilot.timer = setTimeout(() => {
        const live = store.get("sessions", s.id);
        if (live?.status === "LIVE") director.finish(() => endSession(live));
      }, minutes * 60_000);
    }
    return { ok: true, session: store.get("sessions", s.id)! };
  };
  app.post("/api/autopilot", async (req, reply) => {
    const { minutes, characterId } = parse(z.object({ minutes: z.number().int().min(0).max(720).default(0), characterId: z.string().optional() }), req.body ?? {});
    const r = startAutopilot(minutes, characterId);
    if (!r.ok) return reply.code(r.code).send(r.body);
    return reply.code(201).send({ session: r.session, ...autopilotView() });
  });

  // ---- scheduled LIVEs: the autopilot starts on its own at set times; going live in TikTok stays manual ----
  const notice = (title: string, body: string) => {
    broadcast(controls, { type: "schedule_notice", message: `${title}: ${body}` });
    opts.notify?.(title, body);
  };
  const headsUpSent = new Set<string>();
  const runSchedules = (now = new Date()) => {
    const schedules = store.list("schedules");
    const next = nextRun(schedules, now);
    if (next) {
      const key = `${next.schedule.id}@${next.at.toISOString()}`;
      const until = next.at.getTime() - now.getTime();
      if (until > 0 && until <= HEADS_UP_MS && !headsUpSent.has(key)) {
        headsUpSent.add(key);
        notice("อีกไม่กี่นาทีถึงเวลาไลฟ์", `ไลฟ์อัตโนมัติจะเริ่ม ${next.schedule.start} น. เปิด TikTok LIVE Studio แล้วกด Go LIVE ให้พร้อม`);
      }
    }
    const due = dueSchedule(schedules, now);
    if (!due) return;
    const r = startAutopilot(due.minutes, due.characterId);
    const result = r.ok ? `เริ่มแล้ว ${now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.` : `เริ่มไม่ได้: ${r.body.error}`;
    store.update("schedules", due.id, { lastRunDate: localDate(now), lastResult: result });
    store.flush();
    if (r.ok) notice("เริ่มไลฟ์ตามเวลาแล้ว", "ตัวละครเริ่มพูดแล้ว ตรวจว่า TikTok LIVE Studio กำลังไลฟ์อยู่ และคอยดูแลไลฟ์ตลอด");
    else notice("ไลฟ์ตามเวลาเริ่มไม่ได้", r.body.error);
  };
  app.get("/api/schedules/next", async () => {
    const n = nextRun(store.list("schedules"), new Date());
    return n ? { scheduleId: n.schedule.id, at: n.at.toISOString(), minutes: n.schedule.minutes } : { scheduleId: null, at: null, minutes: null };
  });
  crud("schedules", "schedules", scheduleInput, "sched");
  const scheduleTimer = opts.scheduleTickMs === 0 ? null : setInterval(() => runSchedules(), opts.scheduleTickMs ?? 15_000);

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
      case "promo": await director.readPromo(parse(z.object({ promotionId: z.string() }), body).promotionId); break;
      case "scene": director.setScene(parse(z.object({ sceneId: z.string() }), body).sceneId); break;
      case "gesture": director.gesture(parse(z.object({ gesture: z.enum(GESTURES) }), body).gesture); break;
      case "emotion": director.emotion(parse(z.object({ emotion: z.enum(EMOTIONS) }), body).emotion); break;
      case "flash-sale": {
        const f = parse(z.object({ productId: z.string(), price: z.number().positive(), minutes: z.number().int().min(1).max(60), confirmedInShop: z.literal(true, { errorMap: () => ({ message: "ตั้งราคานี้ใน TikTok Shop ก่อน แล้วติ๊กยืนยัน" }) }) }), body);
        const r = director.startFlashSale(f.productId, f.price, f.minutes);
        if (!r.ok) return reply.code(422).send({ error: r.reason });
        break;
      }
      case "flash-sale-end": director.endFlashSale(true); break;
      case "order": {
        const o = parse(z.object({ productId: z.string(), qty: z.number().int().min(1).max(99).default(1) }), body);
        const r = director.orderPlaced(o.productId, o.qty);
        if (!r.ok) return reply.code(422).send({ error: r.reason });
        break;
      }
      case "qa-mode": director.qaMode = parse(z.object({ mode: z.enum(["auto", "review"]) }), body).mode; break;
      default: return reply.code(404).send({ error: "unknown action" });
    }
    return director.state();
  });

  // ---- viewer questions (typed/pasted by the operator, or from an approved API) ----
  app.get("/api/questions", async () => store.list("questions").slice(-200).reverse());
  app.post("/api/questions", async (req, reply) => {
    const { text, author, source } = parse(questionInput, req.body);
    return reply.code(201).send(director.addQuestion(text, author, source));
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

  // ---- comment capture helpers (desktop app only; the operator copies, nothing is read from TikTok) ----
  app.get("/api/capture", async () => (opts.capture ? { available: true, ...opts.capture.get() } : { available: false }));
  app.patch("/api/capture", async (req, reply) => {
    if (!opts.capture) return reply.code(404).send({ error: "ใช้ได้เฉพาะในแอป Windows" });
    return { available: true, ...opts.capture.set(parse(z.object({ clipboardWatch: z.boolean() }), req.body)) };
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
    if (autopilot?.timer) clearTimeout(autopilot.timer);
    if (scheduleTimer) clearInterval(scheduleTimer);
    await closeActiveStream();
    director.stop();
    store.flush();
  });
  return { app, store, director, runSchedules };
}

const IMPORT_UA = "TikLiveAIStudio/1.0 (product link preview; one request per pasted link)";

/** Minimal robots.txt check: the longest matching Allow/Disallow rule for our agent or "*" wins. */
export function robotsAllows(robots: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === "allow" || key === "disallow") && val) cur.rules.push({ allow: key === "allow", path: val });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && "tikliveaistudio".includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: { allow: boolean; len: number } = { allow: true, len: -1 };
  for (const r of rules) {
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && r.path.length > best.len) best = { allow: r.allow, len: r.path.length };
  }
  return best.allow;
}
