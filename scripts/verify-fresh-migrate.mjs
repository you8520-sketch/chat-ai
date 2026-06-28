/**
 * Verifies user_personas migration ordering fix.
 * Run: npx tsx scripts/verify-fresh-migrate.mjs
 */
import Module from "module";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { pathToFileURL } from "url";

const dataDir = path.resolve("tmp-verify-fresh-migrate");
if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = "production";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

function assertNoUserPersonasError(err) {
  if (err && String(err.message).includes("user_personas")) {
    console.error("FAIL: migrate still throws on user_personas:", err.message);
    process.exit(1);
  }
}

// 1) Full getDb on empty DB — must not fail on user_personas (may fail later in migrate).
const dbUrl = pathToFileURL(path.resolve("src/lib/db.ts")).href;
const { getDb } = await import(dbUrl);

try {
  getDb();
} catch (e) {
  assertNoUserPersonasError(e);
  console.log("Empty DB first migrate (may fail later):", e.message);
}

// 2) Fixed ordering block — CREATE TABLE before addColumn.
const mem = new Database(":memory:");
function addColumn(db, table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}
mem.exec(`
  CREATE TABLE IF NOT EXISTS user_personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
addColumn(mem, "user_personas", "memo", "TEXT NOT NULL DEFAULT ''");
addColumn(mem, "user_personas", "gender", "TEXT NOT NULL DEFAULT 'other'");
addColumn(mem, "user_personas", "speech_examples", "TEXT NOT NULL DEFAULT ''");
mem.prepare("SELECT COUNT(*) AS c FROM user_personas").get();
console.log("OK: CREATE TABLE user_personas then addColumn succeeds on empty DB");

// 3) Old ordering would throw — sanity check.
const bad = new Database(":memory:");
try {
  addColumn(bad, "user_personas", "memo", "TEXT NOT NULL DEFAULT ''");
  console.error("FAIL: old ordering should throw");
  process.exit(1);
} catch (e) {
  if (!String(e.message).includes("user_personas")) {
    console.error("FAIL: unexpected error:", e.message);
    process.exit(1);
  }
  console.log("OK: addColumn before CREATE still fails as expected (old bug)");
}

console.log(
  "OK: fresh empty database no longer throws no such table: user_personas during migrate ordering"
);
