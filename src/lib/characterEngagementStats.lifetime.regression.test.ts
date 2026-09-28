import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  incrementCharacterTotalTurns,
  registerCharacterChatUser,
} from "@/lib/characterEngagementStats";

function openTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      chats_count INTEGER NOT NULL DEFAULT 0,
      total_turns INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      alternates TEXT NOT NULL DEFAULT '[]'
    );
  `);
  db.prepare("INSERT INTO characters (id) VALUES (1)").run();
  db.prepare("INSERT INTO users (id) VALUES (1), (2)").run();
  return db;
}

function stats(db: Database.Database): { chats_count: number; total_turns: number } {
  return db.prepare("SELECT chats_count, total_turns FROM characters WHERE id=1").get() as {
    chats_count: number;
    total_turns: number;
  };
}

function insertChat(db: Database.Database, userId: number): number {
  const info = db.prepare("INSERT INTO chats (user_id, character_id) VALUES (?, 1)").run(userId);
  return Number(info.lastInsertRowid);
}

function deleteChatRoom(db: Database.Database, chatId: number): void {
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chats WHERE id=?").run(chatId);
}

describe("character lifetime engagement stats policy", () => {
  it("unique users and turns survive room delete and revisit", () => {
    const db = openTestDb();

    // 1. User A first chat → chats_count +1
    assert.equal(registerCharacterChatUser(db, 1, 1), true);
    const chatA1 = insertChat(db, 1);
    assert.equal(stats(db).chats_count, 1);

    // 2. User A more rooms → no increment
    assert.equal(registerCharacterChatUser(db, 1, 1), false);
    const chatA2 = insertChat(db, 1);
    assert.equal(registerCharacterChatUser(db, 1, 1), false);
    assert.equal(stats(db).chats_count, 1);

    // 3. User A 2 user messages + 2 successful regens → total_turns +4
    incrementCharacterTotalTurns(db, 1);
    incrementCharacterTotalTurns(db, 1);
    incrementCharacterTotalTurns(db, 1);
    incrementCharacterTotalTurns(db, 1);
    assert.equal(stats(db).total_turns, 4);

    db.prepare(
      `INSERT INTO messages (chat_id, role, content, alternates) VALUES
        (?, 'user', 'm1', '[]'),
        (?, 'user', 'm2', '[]'),
        (?, 'assistant', 'r2', ?)`
    ).run(chatA1, chatA1, chatA1, JSON.stringify([{ content: "r1" }, { content: "r2" }]));

    // 4. Delete every room → counters must not drop
    deleteChatRoom(db, chatA1);
    deleteChatRoom(db, chatA2);
    assert.equal(stats(db).total_turns, 4);
    assert.equal(stats(db).chats_count, 1);

    // 5. User A starts again → no re-increment
    assert.equal(registerCharacterChatUser(db, 1, 1), false);
    insertChat(db, 1);
    assert.equal(stats(db).chats_count, 1);

    // 6. User B first chat → chats_count +1
    assert.equal(registerCharacterChatUser(db, 1, 2), true);
    insertChat(db, 2);
    const finalStats = stats(db);
    assert.equal(finalStats.chats_count, 2);
    assert.equal(finalStats.total_turns, 4);
  });
});

describe("character total_turn runtime writers", () => {
  it("keeps user-send and successful-regeneration increments wired to the canonical counter", () => {
    const source = readFileSync(
      new URL("../../src/app/api/chat/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(
      source,
      /onUserInserted:[\s\S]{0,500}incrementCharacterTotalTurns\(db, ch\.id\)/
    );
    assert.match(
      source,
      /Successful regenerate counts as an engagement turn[\s\S]{0,300}if \(finalizeWrote\)[\s\S]{0,200}incrementCharacterTotalTurns\(db, ch\.id, 1\)/
    );
  });
});

describe("character public page image count icon", () => {
  it("keeps image-count meaning and uses a photo/gallery glyph", () => {
    const source = readFileSync(
      new URL("../../src/components/CharacterPublicPagePreview.tsx", import.meta.url),
      "utf8"
    );
    assert.match(source, /title="갤러리 이미지 수"/);
    assert.match(source, /aria-label=\{`이미지 \$\{imageCount\.toLocaleString\(\)\}장`\}/);
    assert.match(source, /function ImageStackIcon/);
    assert.doesNotMatch(source, /M3 7l9 6 9-6/);
    assert.match(source, /<rect x="3\.2" y="7\.2" width="15\.6" height="12\.2" rx="2" \/>/);
    assert.match(source, /<circle cx="7\.8" cy="11\.2" r="1\.35" \/>/);
  });

  it("session delete no longer decrements lifetime counters", () => {
    const source = readFileSync(
      new URL("../../src/app/api/chat/session/route.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(source, /adjustCharacterStatsOnChatDelete/);
    assert.match(source, /deleteChatOwnedDerivedRows/);
  });
});
