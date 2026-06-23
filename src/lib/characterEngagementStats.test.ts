import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  adjustCharacterStatsOnChatDelete,
  backfillCharacterEngagementStats,
  incrementCharacterTotalTurns,
  registerCharacterChatUser,
} from "@/lib/characterEngagementStats";

function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY, chats_count INTEGER NOT NULL DEFAULT 0, total_turns INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE chats (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, character_id INTEGER NOT NULL);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '');
  `);
  db.prepare("INSERT INTO characters (id) VALUES (1)").run();
  db.prepare("INSERT INTO users (id) VALUES (1), (2)").run();
  return db;
}

describe("characterEngagementStats", () => {
  it("registerCharacterChatUser increments only for first chat per user", () => {
    const db = openTestDb();
    assert.equal(registerCharacterChatUser(db, 1, 1), true);
    db.prepare("INSERT INTO chats (user_id, character_id) VALUES (1, 1)").run();
    assert.equal(registerCharacterChatUser(db, 1, 1), false);
    assert.equal(registerCharacterChatUser(db, 1, 2), true);
    const row = db.prepare("SELECT chats_count FROM characters WHERE id=1").get() as { chats_count: number };
    assert.equal(row.chats_count, 2);
  });

  it("incrementCharacterTotalTurns tracks user turns", () => {
    const db = openTestDb();
    incrementCharacterTotalTurns(db, 1, 3);
    incrementCharacterTotalTurns(db, 1, -1);
    const row = db.prepare("SELECT total_turns FROM characters WHERE id=1").get() as { total_turns: number };
    assert.equal(row.total_turns, 2);
  });

  it("adjustCharacterStatsOnChatDelete decrements turns and unique users", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO chats (id, user_id, character_id) VALUES (10, 1, 1)").run();
    db.prepare("INSERT INTO messages (chat_id, role) VALUES (10, 'user'), (10, 'user'), (10, 'assistant')").run();
    db.prepare("UPDATE characters SET chats_count=1, total_turns=2").run();
    adjustCharacterStatsOnChatDelete(db, 1, 1, 10);
    const row = db.prepare("SELECT chats_count, total_turns FROM characters WHERE id=1").get() as {
      chats_count: number;
      total_turns: number;
    };
    assert.equal(row.total_turns, 0);
    assert.equal(row.chats_count, 0);
  });

  it("backfillCharacterEngagementStats aggregates from chats and messages", () => {
    const db = openTestDb();
    db.prepare("INSERT INTO chats (id, user_id, character_id) VALUES (1, 1, 1), (2, 2, 1), (3, 2, 1)").run();
    db.prepare(
      "INSERT INTO messages (chat_id, role) VALUES (1, 'user'), (1, 'user'), (2, 'user'), (3, 'assistant')"
    ).run();
    backfillCharacterEngagementStats(db);
    const row = db.prepare("SELECT chats_count, total_turns FROM characters WHERE id=1").get() as {
      chats_count: number;
      total_turns: number;
    };
    assert.equal(row.chats_count, 2);
    assert.equal(row.total_turns, 3);
  });
});
