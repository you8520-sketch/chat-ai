import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { createChatSession } from "@/lib/chatSessionCreate";
import { createExplicitChatSession } from "@/lib/chatSessionExplicitCreate";
import { resolveChatPageGetDecision } from "@/lib/chatPageGetSession";

const USER_ID = 77101;
const CHARACTER_ID = 77102;

const greetingSchedules: Array<{ messageId: number; chatId: number }> = [];

function seedUserAndCharacter(opts?: { nsfw?: number }): void {
  const db = getDb();
  db.prepare("DELETE FROM messages").run();
  db.prepare("DELETE FROM chats").run();
  db.prepare("DELETE FROM user_personas WHERE user_id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHARACTER_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare(
    "INSERT INTO users (id, email, nickname, pw_hash, points) VALUES (?,?,?,?,2000)"
  ).run(USER_ID, "get-prefetch-luna@test.local", "tester", "x");
  db.prepare(
    `INSERT INTO characters (id, name, greeting, nsfw, visibility, moderation_status, official)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    CHARACTER_ID,
    "유나",
    "창가에서 천천히 고개를 돌렸다.",
    opts?.nsfw ?? 0,
    "public",
    "approved",
    1
  );
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

function applyChatPageGet(query: { chatParam?: string; freshParam?: string }): {
  decisionKind: string;
  chatId?: number;
} {
  const decision = resolveChatPageGetDecision({
    userId: USER_ID,
    characterId: CHARACTER_ID,
    chatParam: query.chatParam,
    freshParam: query.freshParam,
  });
  if (decision.kind === "open" || decision.kind === "redirect-existing") {
    return { decisionKind: decision.kind, chatId: decision.chatId };
  }
  return { decisionKind: decision.kind };
}

function explicitCreate(fresh = false) {
  return createExplicitChatSession({
    user: { id: USER_ID, nickname: "tester", email: "get-prefetch-luna@test.local" },
    characterId: CHARACTER_ID,
    fresh,
    __testOnGreetingSchedule: (messageId, chatId) => {
      greetingSchedules.push({ messageId, chatId });
    },
  });
}

describe("chat GET/prefetch stays read-only; explicit POST owns creation", () => {
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

  it("CASE D: GET/prefetch with no existing room creates nothing and schedules nothing", () => {
    assert.equal(countChats(), 0);
    const result = applyChatPageGet({});
    assert.equal(result.decisionKind, "missing-room");
    assert.equal(countChats(), 0);
    assert.equal(countGreetings(), 0);
    assert.equal(greetingSchedules.length, 0);
  });

  it("GET ?fresh=1 is also read-only", () => {
    const result = applyChatPageGet({ freshParam: "1" });
    assert.equal(result.decisionKind, "missing-room");
    assert.equal(countChats(), 0);
    assert.equal(countGreetings(), 0);
    assert.equal(greetingSchedules.length, 0);
  });

  it("CASE A: explicit new room schedules greeting provider work once and persists the greeting", () => {
    const created = explicitCreate(true);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.created, true);
    assert.equal(countChats(), 1);
    assert.equal(countGreetings(), 1);
    assert.equal(greetingSchedules.length, 1);
    assert.equal(greetingSchedules[0]?.chatId, created.chatId);
  });

  it("CASE B: same chatId re-entry 10x adds zero provider schedules", () => {
    const created = explicitCreate(true);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(greetingSchedules.length, 1);

    for (let i = 0; i < 10; i += 1) {
      const again = applyChatPageGet({ chatParam: String(created.chatId) });
      assert.equal(again.decisionKind, "open");
      assert.equal(again.chatId, created.chatId);
    }

    assert.equal(countChats(), 1);
    assert.equal(countGreetings(), 1);
    assert.equal(greetingSchedules.length, 1);
  });

  it("CASE C: character GET with existing latest chat does not create or schedule", () => {
    const created = explicitCreate(false);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    greetingSchedules.length = 0;
    const again = applyChatPageGet({});
    assert.equal(again.decisionKind, "redirect-existing");
    assert.equal(again.chatId, created.chatId);
    assert.equal(countChats(), 1);
    assert.equal(countGreetings(), 1);
    assert.equal(greetingSchedules.length, 0);
  });

  it("CASE E: explicit fresh create makes a NEW room with at most one greeting schedule", () => {
    const first = explicitCreate(false);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = explicitCreate(true);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.created, true);
    assert.notEqual(second.chatId, first.chatId);
    assert.equal(countChats(), 2);
    assert.equal(countGreetings(), 2);
    assert.equal(greetingSchedules.length, 2);
  });

  it("duplicate !fresh POST reuses the same room and does not fan out Luna work", () => {
    const first = explicitCreate(false);
    const second = explicitCreate(false);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(second.created, false);
    assert.equal(second.chatId, first.chatId);
    assert.equal(countChats(), 1);
    assert.equal(countGreetings(), 1);
    assert.equal(greetingSchedules.length, 1);
  });

  it("createChatSession remains the greeting scheduler domain writer", () => {
    const source = readFileSync(new URL("./chatSessionCreate.ts", import.meta.url), "utf8");
    assert.match(source, /scheduleGreetingSuggestedRepliesExtraction\(/);
    const create = createChatSession({
      userId: USER_ID,
      characterId: CHARACTER_ID,
      greeting: "창가에서 천천히 고개를 돌렸다.",
      __testOnGreetingSchedule: (messageId, chatId) => {
        greetingSchedules.push({ messageId, chatId });
      },
    });
    assert.ok(create > 0);
    assert.equal(greetingSchedules.length, 1);
  });
});

describe("architecture sentinel: GET page does not own greeting provider work", () => {
  it("chat page and GET decision do not import createChatSession or the greeting scheduler", () => {
    const pageSource = readFileSync(
      path.join(process.cwd(), "src/app/chat/[id]/page.tsx"),
      "utf8"
    );
    const decisionSource = readFileSync(
      path.join(process.cwd(), "src/lib/chatPageGetSession.ts"),
      "utf8"
    );
    assert.doesNotMatch(pageSource, /createChatSession/);
    assert.doesNotMatch(pageSource, /scheduleGreetingSuggestedRepliesExtraction/);
    assert.doesNotMatch(pageSource, /create-missing-or-fresh/);
    assert.match(pageSource, /missing-room/);
    assert.doesNotMatch(decisionSource, /createChatSession/);
    assert.doesNotMatch(decisionSource, /scheduleGreetingSuggestedRepliesExtraction/);
    assert.match(decisionSource, /kind: "missing-room"/);
  });

  it("CASE E owner: post-turn shared extract budget stays in /api/chat and greeting job", () => {
    const chatRoute = readFileSync(
      path.join(process.cwd(), "src/app/api/chat/route.ts"),
      "utf8"
    );
    const job = readFileSync(
      path.join(process.cwd(), "src/lib/suggestedReplies/job.ts"),
      "utf8"
    );
    assert.match(chatRoute, /scheduleSuggestedRepliesExtraction\(/);
    assert.match(job, /resolveSuggestedRepliesExtractMaxAttempts/);
    assert.match(job, /postTurnPhysicalAttemptConsumed \? 0 : 1/);
    assert.match(job, /scheduleGreetingSuggestedRepliesExtraction/);
  });
});
