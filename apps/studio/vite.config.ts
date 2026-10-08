import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// The installed app's version (shown in the header so the operator can tell an update arrived).
const version = (JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")) as { version: string }).version;

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4417",
      "/ws": { target: "ws://127.0.0.1:4417", ws: true },
    },
  },
});
