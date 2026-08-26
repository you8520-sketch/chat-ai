import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { __setSummarizeTurnBatchCallerForTests } from "./memory-rolling-summary";
import { listMemoryRecordsForChat } from "./memory-turn-summary";
import { getOrCreateChatMemory } from "./memory-db";
import {
  classifyChatForFiveTurnRebuild,
  dryRunMemorySummaryMigration,
  ensureMemorySummaryMigrationsTable,
  migrateChatSummariesToFiveTurn,
  MEMORY_SUMMARY_MIGRATION_VERSION,
} from "./memory-summary-migration";

const CHAT = 880011;
const USER = 880012;
const CHAR = 880013;
const FIXTURE =
  "레온은 정원에서 렌을 만나 약속을 나눴다. 커프링크스를 건네고 다음을 기약했다.";

function cleanup() {
  const db = getDb();
  ensureMemorySummaryMigrationsTable(db);
  db.prepare("DELETE FROM memory_summary_migrations WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function seed() {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `mig-${USER}@test.local`,
    "mig",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "MigChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function seedPlayableTurns(count: number) {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "인사.",
    "greeting"
  );
  for (let t = 1; t <= count; t++) {
    const userId = Number(
      db.prepare(`INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)`).run(
        CHAT,
        "user",
        `유저 턴 ${t} 사건`
      ).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, user_message_id) VALUES (?,?,?,?)`
    ).run(CHAT, "assistant", `캐릭터 턴 ${t} 응답과 사건`, userId);
  }
}

before(() => {
  seed();
});
after(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  cleanup();
});

describe("5-turn summary migration worker", () => {
  it("dry-run mutates nothing and classifies legacy 6-turn chats", () => {
    seed();
    seedPlayableTurns(12);
    assert.equal(
      persistValidatedSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        tier: "free",
        turnStart: 1,
        turnEnd: 6,
        assistantMessageId: null,
        summary: FIXTURE,
        playableTurnCount: 12,
      }).ok,
      true
    );
    assert.equal(
      persistValidatedSummaryBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        tier: "free",
        turnStart: 7,
        turnEnd: 12,
        assistantMessageId: null,
        summary: FIXTURE,
        playableTurnCount: 12,
      }).ok,
      true
    );
    const beforeRows = getDb()
      .prepare("SELECT COUNT(*) AS n FROM chat_turn_summaries WHERE chat_id=?")
      .get(CHAT) as { n: number };
    const classified = classifyChatForFiveTurnRebuild(getDb(), CHAT);
    assert.equal(classified.hasLegacy6, true);
    assert.equal(classified.requiresRebuild, true);
    assert.equal(classified.targetThrough, 10);
    assert.deepEqual(
      classified.batches,
      [
        { turnStart: 1, turnEnd: 5 },
        { turnStart: 6, turnEnd: 10 },
      ]
    );
    const report = dryRunMemorySummaryMigration();
    assert.ok(report.CHATS_WITH_LEGACY_6TURN_ROWS >= 1);
    const afterRows = getDb()
      .prepare("SELECT COUNT(*) AS n FROM chat_turn_summaries WHERE chat_id=?")
      .get(CHAT) as { n: number };
    assert.equal(afterRows.n, beforeRows.n);
    const mig = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM memory_summary_migrations WHERE chat_id=? AND migration_version=?`
      )
      .get(CHAT, MEMORY_SUMMARY_MIGRATION_VERSION) as { n: number };
    assert.equal(mig.n, 0);
  });

  it("chat-atomic apply rebuilds 1-5 / 6-10 and skips incomplete tail 11-12", async () => {
    seed();
    seedPlayableTurns(12);
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 6,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 12,
    });
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 7,
      turnEnd: 12,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 12,
    });
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    const result = await migrateChatSummariesToFiveTurn({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "MigChar",
    });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.batchesCompleted, 2);
    const records = listMemoryRecordsForChat(CHAT);
    assert.deepEqual(
      records.map((r) => [r.turnStart, r.turnEnd]),
      [
        [1, 5],
        [6, 10],
      ]
    );
    const mem = getDb()
      .prepare("SELECT summarized_turn_count FROM chat_memories WHERE chat_id=?")
      .get(CHAT) as { summarized_turn_count: number };
    assert.equal(mem.summarized_turn_count, 10);
  });

  it("provider failure keeps existing 6-turn rows", async () => {
    seed();
    seedPlayableTurns(6);
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 6,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 6,
    });
    __setSummarizeTurnBatchCallerForTests(async () => {
      throw new Error("429 overloaded");
    });
    const result = await migrateChatSummariesToFiveTurn({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "MigChar",
    });
    assert.equal(result.status, "FAILED_PROVIDER");
    const records = listMemoryRecordsForChat(CHAT);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.turnStart, 1);
    assert.equal(records[0]?.turnEnd, 6);
  });

  it("COMPLETED chats are skipped on rerun", async () => {
    seed();
    seedPlayableTurns(5);
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 5,
    });
    getDb()
      .prepare(
        `INSERT INTO memory_summary_migrations
          (chat_id, migration_version, status, batches_total, batches_completed, attempt_count)
         VALUES (?, ?, 'COMPLETED', 1, 1, 1)`
      )
      .run(CHAT, MEMORY_SUMMARY_MIGRATION_VERSION);
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      calls += 1;
      return { text: FIXTURE };
    });
    const result = await migrateChatSummariesToFiveTurn({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "MigChar",
    });
    assert.equal(result.status, "COMPLETED");
    assert.equal(calls, 0);
  });

  it("missing RAW blocks without deleting existing summaries", async () => {
    seed();
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 6,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 6,
    });
    const result = await migrateChatSummariesToFiveTurn({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "MigChar",
    });
    assert.equal(result.status, "BLOCKED_MISSING_RAW");
    const records = listMemoryRecordsForChat(CHAT);
    assert.equal(records[0]?.turnEnd, 6);
  });
});
