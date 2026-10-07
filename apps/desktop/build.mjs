import { build } from "esbuild";

// Bundle Electron main + the local API server into one CommonJS file so the
// installer does not need the pnpm workspace at runtime.
await build({
  entryPoints: ["electron/main.ts"],
  outfile: "out/main.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["electron", "bufferutil", "utf-8-validate"],
  sourcemap: true,
  logLevel: "info",
});
