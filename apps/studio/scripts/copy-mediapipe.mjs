// Copies MediaPipe's WebAssembly runtime next to the bundled face model so face
// detection works offline inside the desktop app (no CDN at runtime).
import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve("@mediapipe/tasks-vision"));
const out = join(dirname(fileURLToPath(import.meta.url)), "../public/mediapipe/wasm");
mkdirSync(out, { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
  cpSync(join(pkg, "wasm", f), join(out, f));
}
console.log("mediapipe wasm ->", out);
