import { buildServer, providersFromEnv } from "@tlai/api";
import { app, BrowserWindow, clipboard, dialog, Menu, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.API_PORT ?? 4417);
const ORIGIN = `http://127.0.0.1:${PORT}`;

// The stage must be able to speak without a click (it is the on-air output).
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let control: BrowserWindow | null = null;
let stage: BrowserWindow | null = null;

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
  });
}

function openStage(): void {
  if (stage) return stage.focus();
  stage = new BrowserWindow({ width: 540, height: 960, title: "Stage (AI Virtual Host)", backgroundColor: "#000000", webPreferences: { ...webPreferences, backgroundThrottling: false } });
  harden(stage);
  stage.setMenuBarVisibility(false);
  void stage.loadURL(`${ORIGIN}/#/stage`);
  stage.on("closed", () => (stage = null));
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
          { role: "quit", label: "ออก" },
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
  try {
    const { app: server } = await buildServer({
      dataFile: join(app.getPath("userData"), "studio.json"),
      staticDir: studioDir(),
      ...providersFromEnv(),
    });
    await server.listen({ port: PORT, host: "127.0.0.1" });
    app.on("before-quit", () => void server.close());
  } catch (e) {
    dialog.showErrorBox("เริ่มระบบไม่สำเร็จ", `เปิดเซิร์ฟเวอร์ภายในที่พอร์ต ${PORT} ไม่ได้: ${(e as Error).message}`);
    app.quit();
    return;
  }
  buildMenu();
  openControl();
  openStage();
});

app.on("window-all-closed", () => app.quit());
