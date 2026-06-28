/**
 * Reproduce homepage getDb() error on fresh SQLite (Railway-like).
 */
import Module from "module";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const dataDir = path.resolve("tmp-digest-repro");
if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = "production";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

const dbUrl = pathToFileURL(path.resolve("src/lib/db.ts")).href;

try {
  const { getDb } = await import(dbUrl);
  getDb();
  console.log("getDb OK");
} catch (e) {
  console.error("EXCEPTION:", e.message);
  console.error("STACK:", e.stack);
  process.exit(1);
}
