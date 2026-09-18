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
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  detectUnsupportedEvidenceFact,
  getEpisodicMemoryForPrompt,
  persistEpisodicMemoryFactsBestEffort,
  resolveExplicitUserStatementProvenance,
} from "@/lib/episodicMemoryFacts";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveProviderRawPoolExchangeCount,
} from "@/lib/hybridMemory";
import { buildContext } from "@/services/contextBuilder";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { buildMemoryContextForChat } from "./memory-manager";
import {
  __getEpisodicExtractCallCountForTests,
  __resetEpisodicExtractCallCountForTests,
  __setEpisodicExtractCallerForTests,
  extractAndPersistEpisodicFactsForSealedBatch,
  parseEpisodicExtractOutcome,
} from "./memory-episodic-extract";
import type { EpisodicExtractedFact } from "./memory-episodic-types";
import { selectEpisodicEligibleTurnEntries } from "./memory-summary-scope";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import {
  countLegacySixTurnInventory,
  dryRunMemorySummaryMigration,
  isPhaseCLegacyCleanupAllowed,
  migrateChatSummariesToFiveTurn,
  runMemorySummaryMigrationPass,
} from "./memory-summary-migration";
import {
  __setCompactCurrentMemoryTestOverride,
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
  refreshRollingSummaryForRegeneratedAssistant,
  regenerateMemoryRecordBatch,
} from "./memory-rolling-summary";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { listMemoryRecordsForChat } from "./memory-turn-summary";
import { insertAutomaticLegacySixTurnSummaryRow } from "./memory-test-batch";
import {
  getMemorySourceBoundaryCore,
  invalidateDerivedMemoryGenerationCore,
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

const OLD_BATCH_MARKER = "REGEN_EPISODIC_OLD_MARKER_9";
const NEW_BATCH_MARKER = "REGEN_EPISODIC_NEW_MARKER_7";
const BATCH_B_MARKER = "REGEN_EPISODIC_BATCH_B_MARKER_5";

const REGEN_SUMMARY_NO_INTIMACY =
  "본편에서 사건_C가 발생했다 → 인물이 다른 반응을 보이며 관계가 정리되었다 → " +
  "새로운 약속 없이 감정선만 이어갔다 → 다음 장면을 향해 호흡을 맞췄다.";
const REGEN_SUMMARY_NEW_ROLE =
  "본편에서 사건_D가 발생했다 → 역할 방향이 바뀌며 새 사실이 기록되었다 → " +
  "둘의 관계 흐름이 갱신되었고 다음 행동을 준비했다 → 장면을 마무리하며 여운을 남겼다.";
const REGEN_SUMMARY_BATCH_A =
  "본편에서 사건_E가 발생했다 → batch A regen 후 감정선만 정리되었다 → " +
  "약속 없이 대화 흐름을 이어갔다 → 다음 만남을 암시하며 장면을 닫았다.";

const EPISODIC_RECALL_ENV = {
  NODE_ENV: "development",
  EPISODIC_MEMORY_RECALL_ENABLED: "1",
  EPISODIC_MEMORY_MIN_AGE_TURNS: "5",
} as NodeJS.ProcessEnv;

function episodicMarkerFact(marker: string, value: string): EpisodicExtractedFact {
  return {
    category: "relationship",
    subject: "regen_char_user",
    attribute: "scene_role_marker",
    value,
    importance: "important",
    fact_text: `${marker} 조건으로 과거 장면 역할 이벤트가 있었다.`,
    evidence_type: "explicit_scene_event",
  };
}

function batchSealEpisodicCount(batchStart: number, batchEnd: number): number {
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM episodic_memory_facts
         WHERE chat_id=?
           AND json_extract(metadata, '$.extraction')='summary_seal_batch'
           AND json_extract(metadata, '$.batch_start')=?
           AND json_extract(metadata, '$.batch_end')=?`
      )
      .get(CHAT, batchStart, batchEnd) as { n: number }
  ).n;
}

function insertPlayableTurns(count: number): number[] {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "인사.",
    "greeting"
  );
  const assistantIds: number[] = [];
  for (let t = 1; t <= count; t++) {
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "user",
      `유저 턴 ${t}`,
      "user"
    );
    const r = db
      .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
      .run(CHAT, "assistant", `캐릭터 턴 ${t}`, "test");
    assistantIds.push(Number(r.lastInsertRowid));
  }
  updateChatMemory(CHAT, USER, CHAR, { message_count: count, membership_tier: "free" });
  return assistantIds;
}

async function assembleFinalMainRpEpisodic(opts: {
  completedTurns: number;
  currentUserMessage: string;
  recallEnv?: NodeJS.ProcessEnv;
}) {
  const rows = getDb()
    .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
    .all(CHAT) as { role: "user" | "assistant"; content: string; model?: string }[];
  const turns = messagesToTurns(rows);
  const summarized = highestContiguousCompletedTurn(listMemoryRecordsForChat(CHAT), rows.length);
  const rawPool = resolveProviderRawPoolExchangeCount({
    memoryFeatureEnabled: true,
    completedTurns: opts.completedTurns,
    summarizedTurnCount: summarized,
  });
  const raw = rawRecentTurnsToHistory(turns, rawPool, {
    summarizedTurnCount: summarized,
    memoryFeatureEnabled: true,
  });
  const injection = await buildMemoryContextForChat({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    memoryCapacity: 8000,
    userMessage: opts.currentUserMessage,
  });
  const db = getDb();
  const episodicMemory = getEpisodicMemoryForPrompt(
    db,
    {
      chatId: CHAT,
      characterId: CHAR,
      userId: USER,
      currentTurn: opts.completedTurns + 1,
      currentUserMessage: opts.currentUserMessage,
      recentChatText: raw.map((m) => m.content).join("\n"),
      longTermMemoryText: injection.text,
      relationshipMemoryText: "",
      lorebookText: "",
      triggeredEventText: "",
      dynamicMemoryTotalMaxChars: 10_000,
    },
    opts.recallEnv ?? EPISODIC_RECALL_ENV
  );
  const built = buildContext({
    charName: "HardChar",
    chunks: [],
    userNickname: "유저",
    shortTermHistory: raw,
    currentUserMessage: opts.currentUserMessage,
    longTermMemory: injection.text,
    episodicMemoryBlock: episodicMemory.promptBlock,
    nsfw: true,
    provider: "openrouter",
    completedTurns: opts.completedTurns,
    summarizedTurnCount: summarized,
  });
  return { built, episodicBlock: episodicMemory.promptBlock, episodicFacts: episodicMemory.facts };
}

async function sealTwoBatches(opts: {
  batchAFact: EpisodicExtractedFact;
  batchBFact: EpisodicExtractedFact;
}): Promise<void> {
  __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
  __setEpisodicExtractCallerForTests(async () => ({
    text: JSON.stringify({ extracted_facts: [opts.batchAFact] }),
  }));
  await processRollingSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    charName: "HardChar",
    tier: "free",
    memoryCapacity: 8000,
  });
  __setEpisodicExtractCallerForTests(async () => ({
    text: JSON.stringify({ extracted_facts: [opts.batchBFact] }),
  }));
  await processRollingSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    charName: "HardChar",
    tier: "free",
    memoryCapacity: 8000,
  });
}

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

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

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
      invalidateDerivedMemoryGenerationCore(getDb(), CHAT);
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

  it("F user-edited explicit 1~6 summary regen preserves span", async () => {
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
      userEdited: true,
      playableTurnCount: 6,
    });
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
    const records = listMemoryRecordsForChat(CHAT);
    const row = records.find((r) => r.turnStart === 1);
    assert.ok(row);
    assert.equal(row.turnEnd, 6);
    assert.equal(row.userEdited, true);
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
    insertAutomaticLegacySixTurnSummaryRow({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 6,
      summary: FIXTURE,
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
    insertAutomaticLegacySixTurnSummaryRow({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 6,
      summary: FIXTURE,
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
    insertAutomaticLegacySixTurnSummaryRow({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 6,
      summary: FIXTURE,
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

describe("regen summary-seal episodic batch replacement", () => {
  beforeEach(() => {
    __setCompactCurrentMemoryTestOverride(async (text) => text);
  });

  afterEach(() => {
    __setEpisodicExtractCallerForTests(null);
    __setSummarizeTurnBatchCallerForTests(null);
    __setCompactCurrentMemoryTestOverride(null);
  });

  it("R1 assistant regen + semantic empty removes stale batch fact (E6)", async () => {
    seedBase();
    const assistantIds = insertPlayableTurns(10);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({
        extracted_facts: [episodicMarkerFact(OLD_BATCH_MARKER, "old_marker")],
      }),
    }));
    await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);

    getDb()
      .prepare(`UPDATE messages SET content=? WHERE id=?`)
      .run("캐릭터 턴 3 revised", assistantIds[2]!);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: REGEN_SUMMARY_NO_INTIMACY }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({ extracted_facts: [] }),
    }));
    await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: assistantIds[2]!,
    });
    assert.equal(batchSealEpisodicCount(1, 5), 0);
  });

  it("E1 initial success persists batch fact", async () => {
    seedBase();
    insertPlayableTurns(5);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({
        extracted_facts: [episodicMarkerFact(OLD_BATCH_MARKER, "initial")],
      }),
    }));
    await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);
  });

  it("E2 same-source semantic empty clears current batch only (FIX-A)", async () => {
    seedBase();
    insertPlayableTurns(15);
    await sealTwoBatches({
      batchAFact: episodicMarkerFact(OLD_BATCH_MARKER, "batch_a"),
      batchBFact: episodicMarkerFact(BATCH_B_MARKER, "batch_b"),
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);
    assert.equal(batchSealEpisodicCount(6, 10), 1);

    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({ extracted_facts: [] }),
    }));
    assert.equal(
      await regenerateMemoryRecordBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "HardChar",
        tier: "free",
        memoryCapacity: 8000,
        turnStart: 1,
      }),
      true
    );
    assert.equal(batchSealEpisodicCount(1, 5), 0);
    assert.equal(batchSealEpisodicCount(6, 10), 1);
  });

  it("E3 same-source provider failure preserves batch rows (FIX-B / R2)", async () => {
    seedBase();
    insertPlayableTurns(10);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({
        extracted_facts: [episodicMarkerFact(OLD_BATCH_MARKER, "keep")],
      }),
    }));
    await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);

    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    __setEpisodicExtractCallerForTests(async () => {
      throw new Error("provider 503");
    });
    assert.equal(
      await regenerateMemoryRecordBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "HardChar",
        tier: "free",
        memoryCapacity: 8000,
        turnStart: 1,
      }),
      true
    );
    assert.equal(batchSealEpisodicCount(1, 5), 1);
  });

  it("E4 same-source malformed response preserves batch rows (FIX-C / R4)", async () => {
    seedBase();
    insertPlayableTurns(10);
    persistEpisodicMemoryFactsBestEffort(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      sourceTurn: 5,
      facts: [episodicMarkerFact(OLD_BATCH_MARKER, "keep")],
      replaceSummarySealBatch: { batchStart: 1, batchEnd: 5 },
      metadata: { extraction: "summary_seal_batch", batch_start: 1, batch_end: 5 },
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);

    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    __setEpisodicExtractCallerForTests(async () => ({ text: "not json at all" }));
    await regenerateMemoryRecordBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
      turnStart: 1,
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);
  });

  it("E5 same-source blank response preserves batch rows (FIX-D / R3)", async () => {
    seedBase();
    insertPlayableTurns(10);
    persistEpisodicMemoryFactsBestEffort(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      sourceTurn: 5,
      facts: [episodicMarkerFact(OLD_BATCH_MARKER, "keep")],
      replaceSummarySealBatch: { batchStart: 1, batchEnd: 5 },
      metadata: { extraction: "summary_seal_batch", batch_start: 1, batch_end: 5 },
    });
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    __setEpisodicExtractCallerForTests(async () => ({ text: "   " }));
    await regenerateMemoryRecordBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
      turnStart: 1,
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);
  });

  it("E11 sanitizer rejects all invalid entries as contract failure (FIX-E / R5)", async () => {
    const outcome = parseEpisodicExtractOutcome(
      JSON.stringify({
        extracted_facts: [
          {
            category: "relationship",
            subject: "bad",
            attribute: "x",
            value: "y",
            importance: "important",
            fact_text: "too short",
            evidence_type: "explicit_scene_event",
          },
        ],
      })
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.reason, "invalid_contract");
    }

    seedBase();
    insertPlayableTurns(10);
    persistEpisodicMemoryFactsBestEffort(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      sourceTurn: 5,
      facts: [episodicMarkerFact(OLD_BATCH_MARKER, "keep")],
      replaceSummarySealBatch: { batchStart: 1, batchEnd: 5 },
      metadata: { extraction: "summary_seal_batch", batch_start: 1, batch_end: 5 },
    });
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({
        extracted_facts: [
          {
            category: "relationship",
            subject: "bad",
            attribute: "x",
            value: "y",
            importance: "important",
            fact_text: "too short",
            evidence_type: "explicit_scene_event",
          },
        ],
      }),
    }));
    await regenerateMemoryRecordBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
      turnStart: 1,
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);
  });

  it("E6 assistant source mutation + provider failure clears via invalidation (FIX-F)", async () => {
    seedBase();
    const assistantIds = insertPlayableTurns(10);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({
        extracted_facts: [episodicMarkerFact(OLD_BATCH_MARKER, "old_marker")],
      }),
    }));
    await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);

    getDb()
      .prepare(`UPDATE messages SET content=? WHERE id=?`)
      .run("캐릭터 턴 3 revised", assistantIds[2]!);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: REGEN_SUMMARY_NO_INTIMACY }));
    __setEpisodicExtractCallerForTests(async () => {
      throw new Error("provider 503");
    });
    await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: assistantIds[2]!,
    });
    assert.equal(batchSealEpisodicCount(1, 5), 0);
    const ctx = await assembleFinalMainRpEpisodic({
      completedTurns: 10,
      currentUserMessage: "이어서",
    });
    assert.equal(ctx.episodicFacts.length, 0);
    assert.doesNotMatch(ctx.episodicBlock, new RegExp(OLD_BATCH_MARKER));
    assert.doesNotMatch(ctx.built.systemPrompt, new RegExp(OLD_BATCH_MARKER));
  });

  it("E7 regen + non-empty replacement keeps only new marker (FIX-H)", async () => {
    seedBase();
    const assistantIds = insertPlayableTurns(10);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({
        extracted_facts: [episodicMarkerFact(OLD_BATCH_MARKER, "old_marker")],
      }),
    }));
    await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
    });

    getDb()
      .prepare(`UPDATE messages SET content=? WHERE id=?`)
      .run("캐릭터 턴 3 revised again", assistantIds[2]!);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: REGEN_SUMMARY_NEW_ROLE }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({
        extracted_facts: [episodicMarkerFact(NEW_BATCH_MARKER, "new_marker")],
      }),
    }));
    await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: assistantIds[2]!,
    });

    assert.equal(batchSealEpisodicCount(1, 5), 1);
    const rows = getDb()
      .prepare(
        `SELECT fact_text FROM episodic_memory_facts
         WHERE chat_id=? AND json_extract(metadata, '$.batch_start')=1 AND json_extract(metadata, '$.batch_end')=5`
      )
      .all(CHAT) as { fact_text: string }[];
    assert.equal(rows.length, 1);
    assert.match(rows[0]!.fact_text, new RegExp(NEW_BATCH_MARKER));
    assert.doesNotMatch(rows[0]!.fact_text, new RegExp(OLD_BATCH_MARKER));
  });

  it("E9 regen on batch A preserves batch B episodic facts (FIX-I)", async () => {
    seedBase();
    const assistantIds = insertPlayableTurns(15);
    await sealTwoBatches({
      batchAFact: episodicMarkerFact(OLD_BATCH_MARKER, "batch_a"),
      batchBFact: episodicMarkerFact(BATCH_B_MARKER, "batch_b"),
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);
    assert.equal(batchSealEpisodicCount(6, 10), 1);

    getDb()
      .prepare(`UPDATE messages SET content=? WHERE id=?`)
      .run("캐릭터 턴 3 batch-a regen", assistantIds[2]!);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: REGEN_SUMMARY_BATCH_A }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({ extracted_facts: [] }),
    }));
    await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: assistantIds[2]!,
    });

    assert.equal(batchSealEpisodicCount(1, 5), 0);
    assert.equal(batchSealEpisodicCount(6, 10), 1);
  });

  it("E10 legacy per_turn rows untouched on semantic empty (FIX-4)", async () => {
    seedBase();
    seedFiveTurnBatch();
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
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({ extracted_facts: [] }),
    }));
    const result = await extractAndPersistEpisodicFactsForSealedBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      startTurn: 1,
      endTurn: 5,
      dialogue: "dialogue",
      batchUserSources: [{ turn: 1, messageId: null, text: "커피에 시럽을 두 번 넣어 마셔." }],
    });
    assert.equal(result.persisted, 0);
    const legacy = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM episodic_memory_facts
         WHERE chat_id=? AND json_extract(metadata, '$.extraction')='per_turn_legacy'`
      )
      .get(CHAT) as { n: number };
    assert.equal(legacy.n, 1);
    assert.equal(batchSealEpisodicCount(1, 5), 0);
  });

  it("E8 stale fingerprint during extract rejects mutation (FIX-J)", async () => {
    seedBase();
    seedFiveTurnBatch();
    persistEpisodicMemoryFactsBestEffort(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      sourceTurn: 5,
      facts: [episodicMarkerFact(OLD_BATCH_MARKER, "seed")],
      replaceSummarySealBatch: { batchStart: 1, batchEnd: 5 },
      metadata: { extraction: "summary_seal_batch", batch_start: 1, batch_end: 5 },
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);

    const boundary = getMemorySourceBoundaryCore(getDb(), CHAT);
    __setEpisodicExtractCallerForTests(async () => {
      invalidateDerivedMemoryGenerationCore(getDb(), CHAT);
      return { text: JSON.stringify({ extracted_facts: [] }) };
    });
    const result = await extractAndPersistEpisodicFactsForSealedBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      startTurn: 1,
      endTurn: 5,
      dialogue: "dialogue",
      batchUserSources: [{ turn: 1, messageId: null, text: "커피에 시럽을 두 번 넣어 마셔." }],
      boundarySnapshot: boundary,
    });
    assert.equal(result.staleRejected, true);
    assert.equal(result.persisted, 0);
    assert.equal(batchSealEpisodicCount(1, 5), 1);
  });

  it("E12 NODE_TEST network suppression preserves batch rows (FIX-K / R6)", async () => {
    seedBase();
    seedFiveTurnBatch();
    persistEpisodicMemoryFactsBestEffort(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      sourceTurn: 5,
      facts: [episodicMarkerFact(OLD_BATCH_MARKER, "keep")],
      replaceSummarySealBatch: { batchStart: 1, batchEnd: 5 },
      metadata: { extraction: "summary_seal_batch", batch_start: 1, batch_end: 5 },
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);

    __setEpisodicExtractCallerForTests(null);
    const prevNodeTest = process.env.NODE_TEST_CONTEXT;
    process.env.NODE_TEST_CONTEXT = "1";
    try {
      const result = await extractAndPersistEpisodicFactsForSealedBatch({
        chatId: CHAT,
        userId: USER,
        characterId: CHAR,
        charName: "HardChar",
        startTurn: 1,
        endTurn: 5,
        dialogue: "dialogue",
        batchUserSources: [{ turn: 1, messageId: null, text: "커피에 시럽을 두 번 넣어 마셔." }],
      });
      assert.equal(result.extractFailed, true);
      assert.equal(result.failureReason, "test_network_suppressed");
      assert.equal(result.persisted, 0);
      assert.equal(batchSealEpisodicCount(1, 5), 1);
    } finally {
      if (prevNodeTest == null) delete process.env.NODE_TEST_CONTEXT;
      else process.env.NODE_TEST_CONTEXT = prevNodeTest;
    }
  });

  it("E13 final Main RP omits stale marker after assistant regen (FIX-L)", async () => {
    seedBase();
    const assistantIds = insertPlayableTurns(10);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({
        extracted_facts: [episodicMarkerFact(OLD_BATCH_MARKER, "old_marker")],
      }),
    }));
    await processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);

    getDb()
      .prepare(`UPDATE messages SET content=? WHERE id=?`)
      .run("캐릭터 턴 3 revised for final RP", assistantIds[2]!);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: REGEN_SUMMARY_NEW_ROLE }));
    __setEpisodicExtractCallerForTests(async () => ({
      text: JSON.stringify({
        extracted_facts: [episodicMarkerFact(NEW_BATCH_MARKER, "new_marker")],
      }),
    }));
    await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: assistantIds[2]!,
    });

    const ctx = await assembleFinalMainRpEpisodic({
      completedTurns: 10,
      currentUserMessage: "이어서",
    });
    assert.match(ctx.episodicBlock, new RegExp(NEW_BATCH_MARKER));
    assert.doesNotMatch(ctx.episodicBlock, new RegExp(OLD_BATCH_MARKER));
    assert.doesNotMatch(ctx.built.systemPrompt, new RegExp(OLD_BATCH_MARKER));
  });

  it("E14 refresh not reached before canonical commit preserves batch facts", async () => {
    seedBase();
    insertPlayableTurns(10);
    persistEpisodicMemoryFactsBestEffort(getDb(), {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      sourceTurn: 5,
      facts: [episodicMarkerFact(OLD_BATCH_MARKER, "old_marker")],
      replaceSummarySealBatch: { batchStart: 1, batchEnd: 5 },
      metadata: { extraction: "summary_seal_batch", batch_start: 1, batch_end: 5 },
    });
    assert.equal(batchSealEpisodicCount(1, 5), 1);

    // No assistant mutation committed — refreshRollingSummary never invoked (pre-commit path).
    const ok = await refreshRollingSummaryForRegeneratedAssistant({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "HardChar",
      tier: "free",
      memoryCapacity: 8000,
      assistantMessageId: 999_999,
    });
    assert.equal(ok, false);
    assert.equal(batchSealEpisodicCount(1, 5), 1);
  });
});
