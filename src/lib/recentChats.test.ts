import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  fetchLatestSessionsPerCharacter,
  fetchUserChatSessions,
  fetchUserChatSessionsForRecentCharacters,
} from "@/lib/recentChats";

function uniqueUserId(): number {
  return 9_700_000 + Math.floor(Math.random() * 90_000);
}

function seedCharacter(db: ReturnType<typeof getDb>, id: number, name: string): void {
  db.prepare(`INSERT OR REPLACE INTO characters (id, name) VALUES (?, ?)`).run(id, name);
}

describe("recent chats character-first listing", () => {
  it("keeps distinct characters even when one character has many branch sessions", () => {
    const db = getDb();
    const userId = uniqueUserId();
    const busyChar = 9_810_001;
    const quietChar = 9_810_002;
    seedCharacter(db, busyChar, "분기다수");
    seedCharacter(db, quietChar, "오래된캐릭");

    db.prepare(
      `INSERT INTO users (id, email, nickname, pw_hash) VALUES (?, ?, ?, ?)`
    ).run(userId, `recent-${userId}@test.local`, `recent${userId}`, "x");

    const insertChat = db.prepare(
      `INSERT INTO chats (user_id, character_id, mode, created_at) VALUES (?, ?, 'safe', ?)`
    );
    const insertMsg = db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, created_at) VALUES (?, 'user', ?, 'test', ?)`
    );

    // Quiet character: only one older chat
    const quietChat = Number(
      insertChat.run(userId, quietChar, "2026-07-01 10:00:00").lastInsertRowid
    );
    insertMsg.run(quietChat, "오래된 대화", "2026-07-01 10:00:00");

    // Busy character: 30 recent branches that would fill a session window of 25
    for (let i = 0; i < 30; i++) {
      const chatId = Number(
        insertChat.run(userId, busyChar, `2026-07-28 12:${String(i).padStart(2, "0")}:00`)
          .lastInsertRowid
      );
      insertMsg.run(
        chatId,
        `분기 ${i}`,
        `2026-07-28 12:${String(i).padStart(2, "0")}:00`
      );
    }

    const sessionWindow = fetchUserChatSessions(db, userId, 25);
    const sessionChars = new Set(sessionWindow.map((s) => s.character_id));
    assert.equal(sessionChars.has(quietChar), false, "session window crowds out quieter characters");

    const perCharacter = fetchLatestSessionsPerCharacter(db, userId, 40);
    const perCharacterIds = perCharacter.map((s) => s.character_id);
    assert.ok(perCharacterIds.includes(busyChar));
    assert.ok(perCharacterIds.includes(quietChar));
    assert.equal(perCharacter.filter((s) => s.character_id === busyChar).length, 1);
    assert.equal(perCharacter.filter((s) => s.character_id === quietChar).length, 1);

    const chatsPage = fetchUserChatSessionsForRecentCharacters(db, userId, 40);
    const chatsPageChars = new Set(chatsPage.map((s) => s.character_id));
    assert.ok(chatsPageChars.has(quietChar));
    assert.ok(chatsPageChars.has(busyChar));
    assert.equal(chatsPage.filter((s) => s.character_id === busyChar).length, 30);
  });
});
