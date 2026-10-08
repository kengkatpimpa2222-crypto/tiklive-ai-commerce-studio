import { buildServer, providersFromEnv, type CaptureState } from "@tlai/api";
import { parseCopiedComment } from "@tlai/shared";
import { setupAutoUpdate } from "./updater";
import { app, BrowserWindow, clipboard, dialog, globalShortcut, Menu, Notification, powerSaveBlocker, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.API_PORT ?? 4417);
const ORIGIN = `http://127.0.0.1:${PORT}`;

// The stage must be able to speak without a click (it is the on-air output).
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let control: BrowserWindow | null = null;
let stage: BrowserWindow | null = null;
let quick: BrowserWindow | null = null;
let updates: { checkNow: () => void } | null = null;
let server: Awaited<ReturnType<typeof buildServer>>["app"] | null = null;

// ---------- comment capture ----------
// TikTok has no public API that lets an app read LIVE comments, and scraping is off the
// table. So the operator stays in the loop with the lightest possible step: copy a
// comment (Ctrl+C) and the AI host answers it. Nothing here reads TikTok itself.

const SEND_CLIPBOARD = "CommandOrControl+Shift+A";
const QUICK_ASK = "CommandOrControl+Shift+Q";
const capture: CaptureState = { clipboardWatch: false, sendClipboardHotkey: "Ctrl+Shift+A", quickAskHotkey: "Ctrl+Shift+Q" };
let lastClip = "";
const recentlySent = new Map<string, number>();

async function sendAsQuestion(raw: string, source: "clipboard"): Promise<boolean> {
  const c = parseCopiedComment(raw);
  if (!c || !server) return false;
  // Copying the same comment twice within two minutes is a slip, not a new question.
  const key = c.text.toLowerCase();
  const now = Date.now();
  for (const [k, t] of recentlySent) if (now - t > 120_000) recentlySent.delete(k);
  if (recentlySent.has(key)) return false;
  recentlySent.set(key, now);
  const res = await server.inject({ method: "POST", url: "/api/questions", payload: { ...c, source } });
  if (res.statusCode !== 201) return false;
  if (Notification.isSupported()) new Notification({ title: "ส่งให้ AI ตอบแล้ว", body: c.author ? `${c.author}: ${c.text}` : c.text, silent: true }).show();
  return true;
}

function ourWindowFocused(): boolean {
  return BrowserWindow.getFocusedWindow() !== null;
}

setInterval(() => {
  const text = clipboard.readText();
  if (text === lastClip) return;
  lastClip = text;
  // Copies made inside the studio itself (editing products, scripts...) are never questions.
  if (capture.clipboardWatch && !ourWindowFocused()) void sendAsQuestion(text, "clipboard");
}, 400);

const captureControl = {
  get: () => ({ ...capture }),
  set: (p: Partial<Pick<CaptureState, "clipboardWatch">>) => {
    if (p.clipboardWatch !== undefined) {
      capture.clipboardWatch = p.clipboardWatch;
      // Start fresh so whatever was already on the clipboard is not sent.
      lastClip = clipboard.readText();
    }
    buildMenu();
    return { ...capture };
  },
};

function registerHotkeys(): void {
  const ok1 = globalShortcut.register(SEND_CLIPBOARD, () => void sendAsQuestion(clipboard.readText(), "clipboard"));
  const ok2 = globalShortcut.register(QUICK_ASK, openQuick);
  if (!ok1 || !ok2) dialog.showErrorBox("ปุ่มลัดถูกใช้อยู่", "โปรแกรมอื่นจองปุ่มลัด Ctrl+Shift+A หรือ Ctrl+Shift+Q ไว้แล้ว ยังใช้กล่องถามด่วนจากเมนูได้ตามปกติ");
}

function loadEnv(): void {
  const file = join(app.getPath("userData"), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
}

function studioDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "studio") : join(__dirname, "../../studio/dist");
}

function harden(win: BrowserWindow): void {
  // Only our local UI runs inside the app; anything else opens in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN) && url.includes("#/stage")) {
      openStage();
      return { action: "deny" };
    }
    if (url.startsWith(ORIGIN) && url.includes("#/quick")) {
      openQuick();
      return { action: "deny" };
    }
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
}

const webPreferences = { contextIsolation: true, nodeIntegration: false, sandbox: true };

function openControl(): void {
  control = new BrowserWindow({ width: 1440, height: 900, title: "TikLive AI Commerce Studio", backgroundColor: "#0f1117", webPreferences });
  harden(control);
  void control.loadURL(`${ORIGIN}/#/`);
  control.on("closed", () => {
    control = null;
    stage?.close();
    quick?.close();
  });
}

function openStage(): void {
  if (stage) return stage.focus();
  stage = new BrowserWindow({ width: 540, height: 960, title: "Stage (AI Virtual Host)", backgroundColor: "#000000", webPreferences: { ...webPreferences, backgroundThrottling: false } });
  harden(stage);
  stage.setMenuBarVisibility(false);
  // Keep a fixed, recognisable title so it is easy to pick in OBS / TikTok LIVE Studio window capture.
  stage.on("page-title-updated", (e) => e.preventDefault());
  void stage.loadURL(`${ORIGIN}/#/stage`);
  stage.on("closed", () => (stage = null));
  // If the page crashes or hangs, reload it: the director re-sends the current state on reconnect.
  stage.webContents.on("render-process-gone", () => stage?.webContents.reload());
  stage.on("unresponsive", () => stage?.webContents.reload());
}

/** Small always-on-top box that sits next to TikTok LIVE Studio: type a comment, press Enter. */
function openQuick(): void {
  if (quick) {
    quick.show();
    return quick.focus();
  }
  quick = new BrowserWindow({ width: 420, height: 560, title: "ถามด่วน (AI ตอบ)", alwaysOnTop: true, backgroundColor: "#0f1117", webPreferences });
  harden(quick);
  quick.setMenuBarVisibility(false);
  void quick.loadURL(`${ORIGIN}/#/quick`);
  quick.on("closed", () => (quick = null));
}

function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Studio",
        submenu: [
          { label: "เปิดหน้าต่าง Stage", accelerator: "CmdOrCtrl+Shift+S", click: openStage },
          { label: "คัดลอก URL สำหรับ OBS Browser Source", click: () => clipboard.writeText(`${ORIGIN}/#/stage`) },
          { label: "เปิดโฟลเดอร์ข้อมูล", click: () => void shell.openPath(app.getPath("userData")) },
          { type: "separator" },
          { label: `ตรวจหาอัปเดต (ตอนนี้ ${app.getVersion()})`, click: () => updates?.checkNow() },
          { type: "separator" },
          { role: "quit", label: "ออก" },
        ],
      },
      {
        label: "คำถามลูกค้า",
        submenu: [
          { label: "เปิดกล่องถามด่วน", accelerator: "CmdOrCtrl+Shift+Q", click: openQuick },
          { label: "ส่งข้อความที่คัดลอกไว้ให้ AI ตอบ", accelerator: "CmdOrCtrl+Shift+A", click: () => void sendAsQuestion(clipboard.readText(), "clipboard") },
          { label: "คัดลอกคอมเมนต์ = ส่งให้ AI ตอบทันที", type: "checkbox", checked: capture.clipboardWatch, click: (item) => captureControl.set({ clipboardWatch: item.checked }) },
        ],
      },
      {
        label: "TikTok",
        submenu: [
          { label: "เปิด TikTok LIVE Studio (ดาวน์โหลด)", click: () => void shell.openExternal("https://www.tiktok.com/studio/download") },
          { label: "เปิด TikTok Shop Seller Center", click: () => void shell.openExternal("https://seller-th.tiktok.com/") },
        ],
      },
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { role: "togglefullscreen" }] },
    ]),
  );
}

app.whenReady().then(async () => {
  loadEnv();
  // Windows only shows toast notifications ("ส่งให้ AI ตอบแล้ว") for apps with an AppUserModelID.
  if (process.platform === "win32") app.setAppUserModelId("studio.tiklive.ai-commerce");
  try {
    const built = await buildServer({
      dataFile: join(app.getPath("userData"), "studio.json"),
      staticDir: studioDir(),
      capture: captureControl,
      ...providersFromEnv(),
    });
    server = built.app;
    await server.listen({ port: PORT, host: "127.0.0.1" });
    app.on("before-quit", () => void server?.close());
  } catch (e) {
    dialog.showErrorBox("เริ่มระบบไม่สำเร็จ", `เปิดเซิร์ฟเวอร์ภายในที่พอร์ต ${PORT} ไม่ได้: ${(e as Error).message}`);
    app.quit();
    return;
  }
  updates = setupAutoUpdate({
    isLive: async () => {
      const r = await server?.inject({ method: "GET", url: "/api/director" });
      return !!r && (JSON.parse(r.body) as { status: string }).status !== "idle";
    },
    window: () => control,
  });
  buildMenu();
  registerHotkeys();
  openControl();
  openStage();
  watchLive();
});

/**
 * While a LIVE runs nobody may be at the PC: keep the screen and PC awake, and bring the
 * stage window back if it was closed by accident (it is what TikTok LIVE Studio captures).
 */
function watchLive(): void {
  let blocker: number | null = null;
  setInterval(async () => {
    const r = await server?.inject({ method: "GET", url: "/api/director" }).catch(() => null);
    const live = !!r && (JSON.parse(r.body) as { status: string }).status !== "idle";
    if (live && blocker === null) blocker = powerSaveBlocker.start("prevent-display-sleep");
    if (!live && blocker !== null) {
      powerSaveBlocker.stop(blocker);
      blocker = null;
    }
    if (live && !stage && control) openStage();
  }, 5000);
}

app.on("will-quit", () => globalShortcut.unregisterAll());

app.on("window-all-closed", () => app.quit());
