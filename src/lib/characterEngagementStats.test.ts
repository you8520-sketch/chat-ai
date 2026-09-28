import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  incrementCharacterTotalTurns,
  registerCharacterChatUser,
  seedCharacterChatUsersLedgerFromChats,
} from "@/lib/characterEngagementStats";

function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY, chats_count INTEGER NOT NULL DEFAULT 0, total_turns INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE chats (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, character_id INTEGER NOT NULL);
  `);
  db.prepare("INSERT INTO characters (id) VALUES (1)").run();
  db.prepare("INSERT INTO users (id) VALUES (1), (2), (3)").run();
  return db;
}

describe("characterEngagementStats", () => {
  it("registerCharacterChatUser increments once per lifetime user even after every room is deleted", () => {
    const db = openTestDb();
    assert.equal(registerCharacterChatUser(db, 1, 1), true);
    db.prepare("INSERT INTO chats (user_id, character_id) VALUES (1, 1)").run();
    assert.equal(registerCharacterChatUser(db, 1, 1), false);
    assert.equal(registerCharacterChatUser(db, 1, 2), true);

    db.prepare("DELETE FROM chats").run();

    assert.equal(registerCharacterChatUser(db, 1, 1), false);
    assert.equal(registerCharacterChatUser(db, 1, 2), false);
    const row = db.prepare("SELECT chats_count FROM characters WHERE id=1").get() as {
      chats_count: number;
    };
    assert.equal(row.chats_count, 2);
  });

  it("incrementCharacterTotalTurns remains the single event counter, including explicit negative last-turn adjustments", () => {
    const db = openTestDb();
    incrementCharacterTotalTurns(db, 1, 3);
    incrementCharacterTotalTurns(db, 1, -1);
    const row = db.prepare("SELECT total_turns FROM characters WHERE id=1").get() as {
      total_turns: number;
    };
    assert.equal(row.total_turns, 2);
  });

  it("ledger seed is idempotent and never rewrites lifetime counters", () => {
    const db = openTestDb();
    db.prepare(
      "INSERT INTO chats (id, user_id, character_id) VALUES (1, 1, 1), (2, 2, 1), (3, 2, 1)"
    ).run();
    db.prepare("UPDATE characters SET chats_count=9, total_turns=40").run();

    seedCharacterChatUsersLedgerFromChats(db);
    seedCharacterChatUsersLedgerFromChats(db);

    const row = db.prepare("SELECT chats_count, total_turns FROM characters WHERE id=1").get() as {
      chats_count: number;
      total_turns: number;
    };
    assert.equal(row.chats_count, 9);
    assert.equal(row.total_turns, 40);
    assert.equal(registerCharacterChatUser(db, 1, 1), false);
    assert.equal(registerCharacterChatUser(db, 1, 2), false);
    assert.equal(registerCharacterChatUser(db, 1, 3), true);

    const after = db.prepare("SELECT chats_count, total_turns FROM characters WHERE id=1").get() as {
      chats_count: number;
      total_turns: number;
    };
    assert.equal(after.chats_count, 10);
    assert.equal(after.total_turns, 40);
  });
});
