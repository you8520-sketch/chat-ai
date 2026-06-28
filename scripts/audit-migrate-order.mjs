/**
 * Audit migrate() ordering: addColumn before CREATE TABLE.
 * Run: node scripts/audit-migrate-order.mjs
 */
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.resolve("src/lib/db.ts"), "utf8");

const initTables = new Set();
const initMatch = src.match(/function init\(db[\s\S]*?migrate\(db\)/);
if (initMatch) {
  const re = /CREATE TABLE IF NOT EXISTS (\w+)/g;
  let m;
  while ((m = re.exec(initMatch[0])) !== null) initTables.add(m[1]);
}

const migrateStart = src.indexOf("function migrate(db");
const migrateEnd = src.indexOf("function migrateCharacterEngagementStats");
const migrateBody = src.slice(migrateStart, migrateEnd);

const firstCreateLine = {};
const events = [];

const lines = migrateBody.split("\n");
let baseLine = src.slice(0, migrateStart).split("\n").length;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const lineNo = baseLine + i;

  let m;
  if ((m = line.match(/CREATE TABLE IF NOT EXISTS (\w+)/))) {
    const table = m[1];
    if (!firstCreateLine[table]) firstCreateLine[table] = lineNo;
    events.push({ type: "CREATE", table, line: lineNo });
  }
  if ((m = line.match(/addColumn\("(\w+)"/))) {
    events.push({ type: "addColumn", table: m[1], line: lineNo, col: line.match(/addColumn\("\w+", "(\w+)"/)?.[1] });
  }
}

const bugs = [];
for (const e of events) {
  if (e.type !== "addColumn") continue;
  const inInit = initTables.has(e.table);
  const createLine = firstCreateLine[e.table];
  if (inInit) continue;
  if (!createLine || e.line < createLine) {
    bugs.push({
      table: e.table,
      column: e.col,
      addColumnLine: e.line,
      createLine: createLine ?? "never in migrate()",
    });
  }
}

console.log("init() tables:", [...initTables].sort().join(", "));
console.log("\n=== addColumn BEFORE CREATE (migration ordering bugs) ===");
for (const b of bugs) {
  console.log(
    `${b.table}.${b.column ?? "?"}: addColumn line ${b.addColumnLine}, CREATE line ${b.createLine}`
  );
}
console.log(`\nTotal bugs: ${bugs.length}`);

// Fresh DB verification
import Module from "module";
import { pathToFileURL } from "url";

const dataDir = path.resolve("tmp-audit-fresh-db");
if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = "production";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

try {
  const { getDb } = await import(pathToFileURL(path.resolve("src/lib/db.ts")).href);
  getDb();
  console.log("\n=== Fresh DB migrate: SUCCESS ===");
} catch (e) {
  console.log("\n=== Fresh DB migrate: FAIL ===");
  console.log(e.message);
  const match = e.stack?.match(/db\.ts:(\d+):/);
  if (match) console.log("Failure near db.ts line", match[1]);
}
