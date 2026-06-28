/**
 * Progress migrate on stub DB to find next failure after user_personas fix.
 */
import Module from "module";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { pathToFileURL } from "url";

const dataDir = path.resolve("tmp-digest-stub");
if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = "production";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

// Pre-create DB with init base tables only (simulate volume before bookmarks existed in migrate)
const dbPath = path.join(dataDir, "app.db");
fs.mkdirSync(dataDir, { recursive: true });
const stub = new Database(dbPath);
stub.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    nickname TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    is_adult INTEGER NOT NULL DEFAULT 0,
    nsfw_on INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 1000,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL);
  CREATE TABLE characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    greeting TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL DEFAULT '일상',
    tags TEXT NOT NULL DEFAULT '[]',
    nsfw INTEGER NOT NULL DEFAULT 0,
    official INTEGER NOT NULL DEFAULT 0,
    emoji TEXT NOT NULL DEFAULT '✨',
    hue INTEGER NOT NULL DEFAULT 260,
    creator_name TEXT NOT NULL DEFAULT '운영팀',
    likes INTEGER NOT NULL DEFAULT 0,
    chats_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'safe',
    memory TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '익명',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE point_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
stub.close();

const { getDb } = await import(pathToFileURL(path.resolve("src/lib/db.ts")).href);

try {
  getDb();
  console.log("getDb OK");
} catch (e) {
  console.error("FAIL:", e.message);
  console.error(e.stack);
}
