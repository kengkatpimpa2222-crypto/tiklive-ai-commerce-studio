import { join, resolve } from "node:path";
import { buildServer, providersFromEnv } from "./server.js";

const port = Number(process.env.API_PORT ?? 4417);
const dataFile = process.env.DATA_FILE ?? resolve(process.cwd(), "../../data/studio.json");
const staticDir = process.env.STATIC_DIR ?? join(process.cwd(), "../studio/dist");

const { app } = await buildServer({ dataFile, staticDir, logger: true, ...providersFromEnv() });
await app.listen({ port, host: "127.0.0.1" });
