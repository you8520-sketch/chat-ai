import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  collectEngagedCharacterIds,
  collectTasteSignals,
  fetchRecommendedCharacters,
  buildHomeListFilter,
} from "@/lib/homeSections";
import { ensureCharacterClicksTable, recordCharacterClick } from "@/lib/characterClicks";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      genres TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      nsfw INTEGER NOT NULL DEFAULT 0,
      official INTEGER NOT NULL DEFAULT 0,
      emoji TEXT NOT NULL DEFAULT '✨',
      hue INTEGER NOT NULL DEFAULT 260,
      creator_id INTEGER,
      creator_name TEXT NOT NULL DEFAULT '',
      likes INTEGER NOT NULL DEFAULT 0,
      chats_count INTEGER NOT NULL DEFAULT 0,
      total_turns INTEGER NOT NULL DEFAULT 0,
      audience TEXT NOT NULL DEFAULT 'all',
      visibility TEXT NOT NULL DEFAULT 'public',
      moderation_status TEXT NOT NULL DEFAULT 'approved',
      images TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE likes (
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, character_id)
    );
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY, nickname TEXT, creator_tier TEXT);
  `);
  ensureCharacterClicksTable(db);

  // Seed: user engaged with romance A; similar romance B should rank above fantasy C.
  // official=1 so listableWhere matches and tier decorate skips getDb()
  db.prepare(
    `INSERT INTO characters (id, name, genre, genres, tags, likes, total_turns, creator_id, official)
     VALUES
       (1, 'A', '로맨스', '["로맨스"]', '["순애"]', 10, 100, NULL, 1),
       (2, 'B', '로맨스', '["로맨스"]', '["순애","달달"]', 5, 50, NULL, 1),
       (3, 'C', '판타지', '["판타지"]', '["모험"]', 80, 200, NULL, 1)`
  ).run();
  return db;
}

describe("home recommended taste signals", () => {
  it("weights likes, chat volume, open rooms, and clicks", () => {
    const db = openDb();
    db.prepare("INSERT INTO likes (user_id, character_id) VALUES (1, 1)").run();
    db.prepare("INSERT INTO chats (id, user_id, character_id) VALUES (10, 1, 1)").run();
    for (let i = 0; i < 12; i++) {
      db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (10, 'user', 'hi')").run();
    }
    recordCharacterClick(db, 1, 1);
    recordCharacterClick(db, 1, 1);

    const taste = collectTasteSignals(db, 1);
    assert.ok((taste.genres.get("로맨스") ?? 0) > 5);
    assert.ok((taste.tags.get("순애") ?? 0) > 0);
  });

  it("excludes liked and chatted characters from recommendation pool", () => {
    const db = openDb();
    db.prepare("INSERT INTO likes (user_id, character_id) VALUES (1, 1)").run();
    db.prepare("INSERT INTO chats (id, user_id, character_id) VALUES (10, 1, 1)").run();
    db.prepare("INSERT INTO messages (chat_id, role) VALUES (10, 'user')").run();

    const engaged = collectEngagedCharacterIds(db, 1);
    assert.ok(engaged.includes(1));

    const filter = buildHomeListFilter(null, false);
    const rec = fetchRecommendedCharacters(db, { id: 1 }, filter, 10);
    assert.equal(rec.some((c) => c.id === 1), false);
    assert.ok(rec.some((c) => c.id === 2));
    assert.ok(rec[0]?.id === 2 || rec.some((c) => c.id === 2));
  });

  it("prefers similar genre over popular unrelated when taste exists", () => {
    const db = openDb();
    db.prepare("INSERT INTO likes (user_id, character_id) VALUES (1, 1)").run();
    const filter = buildHomeListFilter(null, false);
    const rec = fetchRecommendedCharacters(db, { id: 1 }, filter, 5);
    assert.equal(rec[0]?.id, 2);
  });

  it("falls back to popular characters when every listable char is already engaged", () => {
    const db = openDb();
    db.prepare("INSERT INTO likes (user_id, character_id) VALUES (1, 1), (1, 2), (1, 3)").run();
    const filter = buildHomeListFilter(null, false);
    const rec = fetchRecommendedCharacters(db, { id: 1 }, filter, 10);
    assert.ok(rec.length > 0, "recommended row must not go empty");
    assert.ok(rec.some((c) => c.id === 3), "allows engaged chars as last-resort fill");
  });
});
