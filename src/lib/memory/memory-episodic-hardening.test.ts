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
import {
  detectUnsupportedEvidenceFact,
  persistEpisodicMemoryFactsBestEffort,
  resolveExplicitUserStatementProvenance,
} from "@/lib/episodicMemoryFacts";
import { getOrCreateChatMemory } from "./memory-db";
import {
  __getEpisodicExtractCallCountForTests,
  __resetEpisodicExtractCallCountForTests,
  __setEpisodicExtractCallerForTests,
  extractAndPersistEpisodicFactsForSealedBatch,
} from "./memory-episodic-extract";
import { selectEpisodicEligibleTurnEntries } from "./memory-summary-scope";
import {
  classifyChatForFiveTurnRebuild,
  countLegacySixTurnInventory,
  dryRunMemorySummaryMigration,
  isPhaseCLegacyCleanupAllowed,
  migrateChatSummariesToFiveTurn,
  runMemorySummaryMigrationPass,
} from "./memory-summary-migration";
import {
  __setSummarizeTurnBatchCallerForTests,
  regenerateMemoryRecordBatch,
} from "./memory-rolling-summary";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { listMemoryRecordsForChat } from "./memory-turn-summary";
import {
  executeAtomicMemoryResetCore,
  getMemorySourceBoundaryCore,
} from "./memory-source-boundary";

const CHAT = 890011;
const USER = 890012;
const CHAR = 890013;

const TURN1_FACT = {
  category: "preference" as const,
  subject: "user",
  attribute: "favorite_drink",
  value: "syrup_coffee",
  importance: "important" as const,
  fact_text: "사용자는 커피에 시럽을 두 번 넣어 마신다.",
  evidence_type: "explicit_user_statement" as const,
};

const UNSUPPORTED_FACT = {
  ...TURN1_FACT,
  value: "imaginary_tea",
  fact_text: "사용자는 상상 속 허브차를 매일 마신다.",
};

const FIXTURE =
  "레온은 연회장 테라스에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
  "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM memory_summary_migrations WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function seedBase() {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `hard-${USER}@test.local`,
    "hard",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "HardChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function seedFiveTurnBatch() {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "인사.",
    "greeting"
  );
  for (let t = 1; t <= 5; t++) {
    const userText =
      t === 1 ? "커피에 시럽을 두 번 넣어 마셔." : t === 3 ? "IF 카피페 번외로 가자." : `유저 턴 ${t}`;
    const userId = Number(
      db.prepare(`INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)`).run(
        CHAT,
        "user",
        userText
      ).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, user_message_id) VALUES (?,?,?,?)`
    ).run(CHAT, "assistant", `캐릭터 턴 ${t}`, userId);
  }
}

before(() => {
  seedBase();
});

after(() => {
  __setEpisodicExtractCallerForTests(null);
  __setSummarizeTurnBatchCallerForTests(null);
  cleanup();
});

describe("memory episodic hardening regression", () => {
  it("A turn1 user durable fact survives turn5 seal evidence validation", async () => {
    seedBase();
    seedFiveTurnBatch();
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({ extracted_facts: [TURN1_FACT] }),
    }));
    const batchUserSources = [
      { turn: 1, messageId: 1, text: "커피에 시럽을 두 번 넣어 마셔." },
      { turn: 2, messageId: 2, text: "유저 턴 2" },
      { turn: 3, messageId: 3, text: "IF 카피페 번외로 가자." },
      { turn: 4, messageId: 4, text: "유저 턴 4" },
      { turn: 5, messageId: 5, text: "유저 턴 5" },
    ];
    const provenance = resolveExplicitUserStatementProvenance(TURN1_FACT, batchUserSources);
    assert.equal(provenance.supported, true);
    assert.equal(provenance.turn, 1);
    const result = await extractAndPersistEpisodicFactsForSealedBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      startTurn: 1,
      endTurn: 5,
      dialogue: "main canon dialogue",
      batchUserSources,
    });
    assert.ok(result.persisted >= 1);
    const row = getDb()
      .prepare(
        `SELECT source_user_message_id, metadata FROM episodic_memory_facts WHERE chat_id=? LIMIT 1`
      )
      .get(CHAT) as { source_user_message_id: number | null; metadata: string };
    assert.notEqual(row.source_user_message_id, 5);
  });

  it("B unsupported user fact is rejected", () => {
    const batchUserSources = [{ turn: 5, messageId: 5, text: "유저 턴 5" }];
    assert.equal(
      detectUnsupportedEvidenceFact(UNSUPPORTED_FACT, null, batchUserSources),
      "unsupported_explicit_user_statement"
    );
    const persisted = persistEpisodicMemoryFactsBestEffort(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      sourceTurn: 5,
      facts: [UNSUPPORTED_FACT],
      batchUserSources,
      metadata: { extraction: "summary_seal_batch", batch_start: 1, batch_end: 5 },
    });
    assert.equal(persisted, 0);
  });

  it("C stale source during in-flight extract rejects persist", async () => {
    seedBase();
    seedFiveTurnBatch();
    const boundary = getMemorySourceBoundaryCore(getDb(), CHAT);
    __setEpisodicExtractCallerForTests(async () => {
      executeAtomicMemoryResetCore(getDb(), {
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        tier: "free",
      });
      return { text: JSON.stringify({ extracted_facts: [TURN1_FACT] }) };
    });
    const result = await extractAndPersistEpisodicFactsForSealedBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      startTurn: 1,
      endTurn: 5,
      dialogue: "dialogue",
      batchUserSources: [{ turn: 1, messageId: 1, text: "커피에 시럽을 두 번 넣어 마셔." }],
      boundarySnapshot: boundary,
    });
    assert.equal(result.staleRejected, true);
    assert.equal(result.persisted, 0);
  });

  it("D mixed main + OOC/noncanon batch excludes noncanonical episodic input", () => {
    const entries = [
      { turnIndex: 1, turn: { user: "본편에서 검을 들었다", assistant: "응답" }, userMessageId: 1 },
      { turnIndex: 2, turn: { user: "IF 카피페 번외로 가자", assistant: "번외" }, userMessageId: 2 },
      {
        turnIndex: 3,
        turn: { user: "현대 회사물 반응 모음으로 가자", assistant: "ok" },
        userMessageId: 3,
      },
    ];
    const eligible = selectEpisodicEligibleTurnEntries(entries);
    assert.deepEqual(
      eligible.map((entry) => entry.turnIndex),
      [1]
    );
  });

  it("E new batch extraction does not delete unrelated legacy episodic row", () => {
    seedBase();
    getDb()
      .prepare(
        `INSERT INTO episodic_memory_facts
          (chat_id, character_id, user_id, source_turn, source_user_message_id,
           category, subject, attribute, value, importance, fact_text, metadata)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        CHAT,
        CHAR,
        USER,
        5,
        null,
        "preference",
        "user",
        "legacy_marker",
        "kept",
        "normal",
        "레거시 사실은 유지되어야 한다.",
        JSON.stringify({ extraction: "per_turn_legacy" })
      );
    persistEpisodicMemoryFactsBestEffort(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      sourceTurn: 5,
      facts: [TURN1_FACT],
      batchUserSources: [{ turn: 1, messageId: null, text: "커피에 시럽을 두 번 넣어 마셔." }],
      replaceSummarySealBatch: { batchStart: 1, batchEnd: 5 },
      metadata: { extraction: "summary_seal_batch", batch_start: 1, batch_end: 5 },
    });
    const legacy = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM episodic_memory_facts
         WHERE chat_id=? AND json_extract(metadata, '$.extraction')='per_turn_legacy'`
      )
      .get(CHAT) as { n: number };
    assert.equal(legacy.n, 1);
  });

  it("F legacy 6-turn summary regen does not invoke seal episodic extract", async () => {
    seedBase();
    seedFiveTurnBatch();
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
    __resetEpisodicExtractCallCountForTests();
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({ extracted_facts: [TURN1_FACT] }),
    }));
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    await regenerateMemoryRecordBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 450,
      turnStart: 1,
    });
    assert.equal(__getEpisodicExtractCallCountForTests(), 0);
  });
});

describe("migration hardening regression", () => {
  it("G migration rebuild preserves non-main scope semantics", async () => {
    seedBase();
    const db = getDb();
    db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "assistant",
      "인사.",
      "greeting"
    );
    for (let t = 1; t <= 5; t++) {
      const userText = "IF 카피페 번외 장면이다.";
      const userId = Number(
        db.prepare(`INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)`).run(
          CHAT,
          "user",
          userText
        ).lastInsertRowid
      );
      db.prepare(
        `INSERT INTO messages (chat_id, role, content, user_message_id) VALUES (?,?,?,?)`
      ).run(CHAT, "assistant", `캐릭터 턴 ${t}`, userId);
    }
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 6,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 5,
    });
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    const result = await migrateChatSummariesToFiveTurn({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
    });
    assert.equal(result.status, "COMPLETED");
    const records = listMemoryRecordsForChat(CHAT);
    assert.ok(records.some((record) => record.summaryKind === "noncanon"));
  });

  it("H dryRun=true performs zero DB mutations", async () => {
    seedBase();
    seedFiveTurnBatch();
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 6,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 5,
    });
    const beforeSummaries = (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM chat_turn_summaries WHERE chat_id=?")
        .get(CHAT) as { n: number }
    ).n;
    const beforeMigrations = (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM memory_summary_migrations WHERE chat_id=?")
        .get(CHAT) as { n: number }
    ).n;
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    const result = await migrateChatSummariesToFiveTurn({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      dryRun: true,
    });
    assert.equal(result.status, "PENDING");
    const afterSummaries = (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM chat_turn_summaries WHERE chat_id=?")
        .get(CHAT) as { n: number }
    ).n;
    const afterMigrations = (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM memory_summary_migrations WHERE chat_id=?")
        .get(CHAT) as { n: number }
    ).n;
    assert.equal(afterSummaries.n, beforeSummaries.n);
    assert.equal(afterMigrations.n, beforeMigrations.n);
    dryRunMemorySummaryMigration();
    assert.equal(afterMigrations.n, beforeMigrations.n);
  });

  it("I dryRun=false enters apply path with stub provider", async () => {
    seedBase();
    seedFiveTurnBatch();
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 6,
      assistantMessageId: null,
      summary: FIXTURE,
      playableTurnCount: 5,
    });
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    const pass = await runMemorySummaryMigrationPass({
      dryRun: false,
      chatIds: [CHAT],
    });
    assert.ok(pass.apply);
    assert.equal(pass.apply!.MIGRATED_CHATS >= 0, true);
  });

  it("J inactive legacy row keeps LEGACY total nonzero and blocks Phase C cleanup", () => {
    seedBase();
    getDb()
      .prepare(
        `INSERT INTO chat_turn_summaries
          (chat_id, turn_number, turn_end, summary, summary_kind, user_edited, inactive)
         VALUES (?, 1, NULL, ?, 'main_canon', 0, 1)`
      )
      .run(CHAT, FIXTURE);
    const inventory = countLegacySixTurnInventory(getDb());
    assert.ok(inventory.INACTIVE_AUTOMATIC_LEGACY_6TURN_ROWS >= 1);
    assert.ok(inventory.TOTAL_AUTOMATIC_LEGACY_6TURN_ROWS >= 1);
    assert.equal(isPhaseCLegacyCleanupAllowed(inventory), false);
  });
});
