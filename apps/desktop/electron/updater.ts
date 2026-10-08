import { app, dialog, Notification, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";

/**
 * Updates from the project's public GitHub Releases. New versions download in the
 * background and install when the app closes, so a running LIVE is never cut off.
 */
export function setupAutoUpdate(opts: { isLive: () => Promise<boolean>; window: () => BrowserWindow | null }): { checkNow: () => void } {
  if (!app.isPackaged) return { checkNow: () => void dialog.showMessageBox({ message: "การอัปเดตอัตโนมัติใช้ได้เฉพาะตัวที่ติดตั้งแล้ว" }) };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let manual = false;
  let ready: string | null = null;

  autoUpdater.on("update-available", (info) => {
    if (Notification.isSupported()) new Notification({ title: "มีเวอร์ชันใหม่", body: `กำลังดาวน์โหลด ${info.version} อยู่เบื้องหลัง`, silent: true }).show();
  });
  autoUpdater.on("update-not-available", () => {
    if (manual) void dialog.showMessageBox({ message: `ใช้เวอร์ชันล่าสุดอยู่แล้ว (${app.getVersion()})` });
    manual = false;
  });
  autoUpdater.on("error", (e) => {
    if (manual) void dialog.showMessageBox({ type: "warning", message: "ตรวจหาอัปเดตไม่สำเร็จ", detail: e.message });
    manual = false;
  });
  const offerRestart = async (version: string) => {
    // Never restart in the middle of a LIVE; it installs on the next close instead.
    if (await opts.isLive()) {
      if (Notification.isSupported()) new Notification({ title: `เวอร์ชัน ${version} พร้อมแล้ว`, body: "จะติดตั้งเองตอนปิดโปรแกรมหลังจบไลฟ์" }).show();
      return;
    }
    const win = opts.window();
    const options = {
      type: "info" as const,
      buttons: ["รีสตาร์ทและอัปเดตเลย", "ไว้ทีหลัง (อัปเดตตอนปิดโปรแกรม)"],
      defaultId: 0,
      cancelId: 1,
      message: `เวอร์ชัน ${version} ดาวน์โหลดเสร็จแล้ว`,
      detail: "ข้อมูลสินค้า ตัวละคร และสคริปต์ทั้งหมดจะอยู่ครบหลังอัปเดต",
    };
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (response === 0) autoUpdater.quitAndInstall();
  };
  autoUpdater.on("update-downloaded", (info) => {
    manual = false;
    if (ready === info.version) return;
    ready = info.version;
    void offerRestart(info.version);
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(check, 10_000);
  setInterval(check, 60 * 60 * 1000);
  return {
    checkNow: () => {
      manual = true;
      if (ready) return void offerRestart(ready);
      check();
    },
  };
}
