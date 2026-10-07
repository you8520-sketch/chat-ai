import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { createChatSession } from "@/lib/chatSessionCreate";
import { resolveChatPageGetDecision } from "@/lib/chatPageGetSession";

const USER_ID = 77101;
const CHARACTER_ID = 77102;

const greetingSchedules: Array<{ messageId: number; chatId: number }> = [];

function seedUserAndCharacter(): void {
  const db = getDb();
  db.prepare("DELETE FROM messages").run();
  db.prepare("DELETE FROM chats").run();
  db.prepare("DELETE FROM characters WHERE id=?").run(CHARACTER_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare(
    "INSERT INTO users (id, email, nickname, pw_hash, points) VALUES (?,?,?,?,2000)"
  ).run(USER_ID, "get-prefetch-luna@test.local", "tester", "x");
  db.prepare(
    `INSERT INTO characters (id, name, greeting, nsfw, visibility, moderation_status, official)
     VALUES (?,?,?,?,?,?,?)`
  ).run(CHARACTER_ID, "유나", "창가에서 천천히 고개를 돌렸다.", 0, "public", "approved", 1);
}

function countChats(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM chats WHERE user_id=? AND character_id=?").get(
    USER_ID,
    CHARACTER_ID
  ) as { n: number }).n;
}

function countGreetings(): number {
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM messages m
         JOIN chats c ON c.id = m.chat_id
         WHERE c.user_id=? AND c.character_id=? AND m.role='assistant' AND m.model='greeting'`
      )
      .get(USER_ID, CHARACTER_ID) as { n: number }
  ).n;
}

/** Same mutation the current /chat/[id] page applies after resolveChatPageGetDecision. */
function applyCurrentChatPageGet(query: { chatParam?: string; freshParam?: string }): {
  decisionKind: string;
  chatId?: number;
} {
  const decision = resolveChatPageGetDecision({
    userId: USER_ID,
    characterId: CHARACTER_ID,
    chatParam: query.chatParam,
    freshParam: query.freshParam,
  });
  if (decision.kind === "create-missing-or-fresh") {
    const chatId = createChatSession({
      userId: USER_ID,
      characterId: CHARACTER_ID,
      greeting: "창가에서 천천히 고개를 돌렸다.",
      mode: "safe",
      __testOnGreetingSchedule: (messageId, scheduledChatId) => {
        greetingSchedules.push({ messageId, chatId: scheduledChatId });
      },
    });
    return { decisionKind: decision.kind, chatId };
  }
  if (decision.kind === "open" || decision.kind === "redirect-existing") {
    return { decisionKind: decision.kind, chatId: decision.chatId };
  }
  return { decisionKind: decision.kind };
}

describe("FAIL-BEFORE /chat GET implicit create + greeting Luna schedule", () => {
  before(() => {
    installIsolatedTestDatabase();
  });

  after(() => {
    uninstallIsolatedTestDatabase();
  });

  beforeEach(() => {
    greetingSchedules.length = 0;
    seedUserAndCharacter();
  });

  it("createChatSession still owns the real greeting scheduler", () => {
    const source = readFileSync(new URL("./chatSessionCreate.ts", import.meta.url), "utf8");
    assert.match(source, /scheduleGreetingSuggestedRepliesExtraction\(/);
    assert.match(source, /__testOnGreetingSchedule/);
  });

  it("current GET/prefetch with no existing room creates chat + greeting + schedules provider work", () => {
    assert.equal(countChats(), 0);
    const result = applyCurrentChatPageGet({});
    assert.equal(result.decisionKind, "create-missing-or-fresh");
    assert.equal(countChats(), 1);
    assert.equal(countGreetings(), 1);
    assert.equal(greetingSchedules.length, 1);
    assert.equal(greetingSchedules[0]?.chatId, result.chatId);
  });

  it("CASE B current: same chatId re-entry 10x does not reschedule greeting provider work", () => {
    const created = applyCurrentChatPageGet({});
    assert.equal(greetingSchedules.length, 1);
    const chatId = created.chatId;
    assert.ok(chatId);

    for (let i = 0; i < 10; i += 1) {
      const again = applyCurrentChatPageGet({ chatParam: String(chatId) });
      assert.equal(again.decisionKind, "open");
      assert.equal(again.chatId, chatId);
    }

    assert.equal(countChats(), 1);
    assert.equal(countGreetings(), 1);
    assert.equal(greetingSchedules.length, 1);
  });

  it("CASE C current: character GET with existing latest chat does not create or schedule", () => {
    const created = applyCurrentChatPageGet({});
    greetingSchedules.length = 0;
    const again = applyCurrentChatPageGet({});
    assert.equal(again.decisionKind, "redirect-existing");
    assert.equal(again.chatId, created.chatId);
    assert.equal(countChats(), 1);
    assert.equal(countGreetings(), 1);
    assert.equal(greetingSchedules.length, 0);
  });
});
