import Module from "module";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const dataDir = path.resolve("tmp-digest-repro");
const dbPath = path.join(dataDir, "app.db");
if (!fs.existsSync(dbPath)) {
  console.error("Run prod server with tmp-digest-repro first");
  process.exit(1);
}

const stub = new Database(dbPath);
stub.exec(`
  CREATE TABLE IF NOT EXISTS bookmarks (
    user_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, message_id)
  );
`);
stub.close();
console.log("bookmarks table stubbed in", dbPath);
