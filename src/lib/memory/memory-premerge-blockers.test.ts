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
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  invalidateSummarySealBatchEpisodicFactsForSourceMutation,
} from "@/lib/episodicMemoryFacts";
import { getOrCreateChatMemory } from "./memory-db";
import {
  __setEpisodicExtractCallerForTests,
  extractAndPersistEpisodicFactsForSealedBatch,
} from "./memory-episodic-extract";
import {
  applyPendingBranchOpsToShadowRecords,
  shadowRecordFromComposed,
  syntheticShadowRecordId,
} from "./memory-shadow-state";
import { composeBatchScopePayload } from "./memory-rolling-summary";
import { insertAutomaticLegacySixTurnSummaryRow } from "./memory-test-batch";
import {
  __setSummarizeTurnBatchCallerForTests,
  summarizeTurnBatch,
} from "./memory-rolling-summary";
import {
  deleteInactiveAutomaticLegacySixTurnRows,
  materializeUserEditedNullSpanRows,
  migrateChatSummariesToFiveTurn,
} from "./memory-summary-migration";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { buildMemorySourceFingerprintFromEligible } from "./memory-source-fingerprint";
import type { DialogueTurn } from "@/lib/hybridMemory";

const CHAT = 900011;
const USER = 900012;
const CHAR = 900013;

const FIXTURE =
  "레온은 연회장 테라스에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
  "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";

const TURN1_FACT = {
  category: "preference" as const,
  subject: "user",
  attribute: "favorite_drink",
  value: "syrup_coffee",
  importance: "important" as const,
  fact_text: "사용자는 커피에 시럽을 두 번 넣어 마신다.",
  evidence_type: "explicit_user_statement" as const,
};

function turnOneUserMessageId(): number {
  return (
    getDb()
      .prepare(`SELECT id FROM messages WHERE chat_id=? AND role='user' ORDER BY id ASC LIMIT 1`)
      .get(CHAT) as { id: number }
  ).id;
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
    `blk-${USER}@test.local`,
    "blk",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "BlkChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function seedTurns(specs: Array<{ turn: number; user: string; assistant: string }>) {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "인사.",
    "greeting"
  );
  for (const spec of specs) {
    const userId = Number(
      db.prepare(`INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)`).run(
        CHAT,
        "user",
        spec.user
      ).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, user_message_id) VALUES (?,?,?,?)`
    ).run(CHAT, "assistant", spec.assistant, userId);
  }
}

before(() => seedBase());
after(() => {
  __setEpisodicExtractCallerForTests(null);
  __setSummarizeTurnBatchCallerForTests(null);
  cleanup();
});

describe("pre-merge blocker regression", () => {
  it("A migration 1~5 compose ignores future legacy 7~12 prior rows", async () => {
    seedBase();
    seedTurns(
      Array.from({ length: 18 }, (_, i) => ({
        turn: i + 1,
        user: `유저 ${i + 1}`,
        assistant: `캐릭터 ${i + 1}`,
      }))
    );
    insertAutomaticLegacySixTurnSummaryRow({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 6,
      summary: FIXTURE,
    });
    insertAutomaticLegacySixTurnSummaryRow({
      chatId: CHAT,
      turnStart: 7,
      turnEnd: 12,
      summary: FIXTURE,
    });
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: FIXTURE }));
    let shadowRecords: ReturnType<typeof shadowRecordFromComposed>[] = [];
    const batch1Turns = Array.from({ length: 5 }, (_, i) => ({
      turnIndex: i + 1,
      turn: { user: `유저 ${i + 1}`, assistant: `캐릭터 ${i + 1}` } satisfies DialogueTurn,
      userMessageId: i + 2,
    }));
    const composed1 = await composeBatchScopePayload({
      chatId: CHAT,
      batchStart: 1,
      endTurn: 5,
      allEntries: batch1Turns,
      charName: "BlkChar",
      mode: "seal",
      existingRecord: null,
      previousWasNoncanonOrBranch: false,
      priorRecords: shadowRecords,
    });
    assert.equal(composed1.ok, true);
    if (!composed1.ok) return;
    shadowRecords = [
      shadowRecordFromComposed({
        id: syntheticShadowRecordId(1),
        turnStart: 1,
        turnEnd: 5,
        summaryKind: composed1.summaryKind,
        scopes: composed1.scopes,
        branchId: composed1.branchId,
        branchStatus: composed1.branchStatus,
        promotedBy: composed1.promotedBy,
        promotedAt: composed1.promotedAt,
        assistantMessageId: null,
        displaySummary: composed1.displaySummary,
      }),
    ];
    assert.equal(shadowRecords.length, 1);
    assert.equal(shadowRecords[0]?.turnEnd, 5);
    const batch2Turns = Array.from({ length: 5 }, (_, i) => ({
      turnIndex: i + 6,
      turn: { user: `유저 ${i + 6}`, assistant: `캐릭터 ${i + 6}` } satisfies DialogueTurn,
      userMessageId: i + 7,
    }));
    const composed2 = await composeBatchScopePayload({
      chatId: CHAT,
      batchStart: 6,
      endTurn: 10,
      allEntries: batch2Turns,
      charName: "BlkChar",
      mode: "seal",
      existingRecord: null,
      previousWasNoncanonOrBranch: false,
      priorRecords: shadowRecords,
    });
    assert.equal(composed2.ok, true);
    assert.equal(shadowRecords.every((row) => row.turnEnd <= 5), true);
  });

  it("B shadow branch promote pending op updates prior noncanon row", () => {
    const noncanon = shadowRecordFromComposed({
      id: syntheticShadowRecordId(1),
      turnStart: 1,
      turnEnd: 5,
      summaryKind: "noncanon",
      scopes: { noncanon: "IF 장면" },
      branchId: null,
      branchStatus: null,
      promotedBy: null,
      promotedAt: null,
      assistantMessageId: null,
      displaySummary: "IF 장면",
    });
    const updated = applyPendingBranchOpsToShadowRecords([noncanon], [
      {
        op: "promote_noncanon_records",
        recordIds: [noncanon.id],
        branchId: "branch-test",
        promotedBy: "user_continue",
        sourceTurn: 6,
        control: { source: "user_turn", sourceUserMessageId: 99, sourceTurn: 6 },
      },
    ]);
    assert.equal(updated[0]?.summaryKind, "branch_canon");
    assert.equal(updated[0]?.branchId, "branch-test");
  });

  it("C batch 2 provider failure leaves summary rows unchanged", async () => {
    seedBase();
    seedTurns(
      Array.from({ length: 10 }, (_, i) => ({
        turn: i + 1,
        user: `유저 ${i + 1}`,
        assistant: `캐릭터 ${i + 1}`,
      }))
    );
    insertAutomaticLegacySixTurnSummaryRow({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 6,
      summary: FIXTURE,
    });
    const before = (
      getDb()
        .prepare("SELECT summary FROM chat_turn_summaries WHERE chat_id=?")
        .get(CHAT) as { summary: string }
    ).summary;
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
      calls += 1;
      const content = history[0]?.content ?? "";
      if (/\[6~10턴/.test(content)) throw new Error("provider fail batch2");
      return { text: FIXTURE };
    });
    const result = await migrateChatSummariesToFiveTurn({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BlkChar",
    });
    assert.equal(result.status, "FAILED_PROVIDER");
    const after = (
      getDb()
        .prepare("SELECT summary FROM chat_turn_summaries WHERE chat_id=?")
        .get(CHAT) as { summary: string }
    ).summary;
    assert.equal(after, before);
    assert.ok(calls >= 1);
  });

  it("D variant content change during episodic LLM rejects persist via fingerprint", async () => {
    seedBase();
    seedTurns([{ turn: 1, user: "커피 시럽", assistant: "알겠어" }]);
    __setEpisodicExtractCallerForTests(async () => {
      getDb()
        .prepare(`UPDATE messages SET content='변경된 assistant' WHERE chat_id=? AND role='assistant' AND content='알겠어'`)
        .run(CHAT);
      return { text: JSON.stringify({ extracted_facts: [TURN1_FACT] }) };
    });
    const result = await extractAndPersistEpisodicFactsForSealedBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BlkChar",
      startTurn: 1,
      endTurn: 1,
      dialogue: "dialogue",
      batchUserSources: [{ turn: 1, messageId: 2, text: "커피 시럽" }],
    });
    assert.equal(result.staleRejected, true);
    assert.equal(result.persisted, 0);
  });

  it("E manual prose edit changes fingerprint and blocks migration swap", async () => {
    seedBase();
    seedTurns(
      Array.from({ length: 6 }, (_, i) => ({
        turn: i + 1,
        user: `유저 ${i + 1}`,
        assistant: `캐릭터 ${i + 1}`,
      }))
    );
    insertAutomaticLegacySixTurnSummaryRow({
      chatId: CHAT,
      turnStart: 1,
      turnEnd: 6,
      summary: FIXTURE,
    });
    __setSummarizeTurnBatchCallerForTests(async () => {
      const userMsgId = turnOneUserMessageId();
      getDb()
        .prepare(`UPDATE messages SET content='edited prose' WHERE chat_id=? AND id=?`)
        .run(CHAT, userMsgId);
      return { text: FIXTURE };
    });
    const result = await migrateChatSummariesToFiveTurn({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BlkChar",
    });
    assert.equal(result.status, "SOURCE_CHANGED");
    assert.equal(
      (
        getDb()
          .prepare("SELECT COUNT(*) AS n FROM chat_turn_summaries WHERE chat_id=? AND turn_number=1 AND turn_end=6")
          .get(CHAT) as { n: number }
      ).n,
      1
    );
  });

  it("F source mutation invalidates summary_seal_batch episodic rows", () => {
    seedBase();
    getDb()
      .prepare(
        `INSERT INTO episodic_memory_facts
          (chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        CHAT,
        CHAR,
        USER,
        5,
        TURN1_FACT.category,
        TURN1_FACT.subject,
        TURN1_FACT.attribute,
        TURN1_FACT.value,
        TURN1_FACT.importance,
        TURN1_FACT.fact_text,
        JSON.stringify({
          extraction: "summary_seal_batch",
          batch_start: 1,
          batch_end: 5,
          source_user_message_ids: [41, 42, 43, 44, 45],
          source_assistant_message_ids: [51, 52, 53, 54, 55],
          source_fingerprint: "abc123",
        })
      );
    const deleted = invalidateSummarySealBatchEpisodicFactsForSourceMutation(getDb(), {
      chatId: CHAT,
      affectedUserMessageIds: [42],
    });
    assert.equal(deleted, 1);
  });

  it("G inactive automatic legacy row removed on successful migration swap", async () => {
    seedBase();
    seedTurns(
      Array.from({ length: 5 }, (_, i) => ({
        turn: i + 1,
        user: `유저 ${i + 1}`,
        assistant: `캐릭터 ${i + 1}`,
      }))
    );
    getDb()
      .prepare(
        `INSERT INTO chat_turn_summaries
          (chat_id, turn_number, turn_end, summary, summary_kind, user_edited, inactive)
         VALUES (?, 7, 12, ?, 'main_canon', 0, 1)`
      )
      .run(CHAT, FIXTURE);
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
      charName: "BlkChar",
    });
    assert.equal(result.status, "COMPLETED");
    const inactiveLegacy = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM chat_turn_summaries
         WHERE chat_id=? AND user_edited=0 AND inactive=1`
      )
      .get(CHAT) as { n: number };
    assert.equal(inactiveLegacy.n, 0);
  });

  it("H user-edited NULL span materializes explicit turn_end without prose change", () => {
    seedBase();
    getDb()
      .prepare(
        `INSERT INTO chat_turn_summaries
          (chat_id, turn_number, turn_end, summary, summary_kind, user_edited, inactive)
         VALUES (?, 3, NULL, ?, 'main_canon', 1, 0)`
      )
      .run(CHAT, "USER LOCKED PROSE");
    const n = materializeUserEditedNullSpanRows(getDb(), CHAT);
    assert.equal(n, 1);
    const row = getDb()
      .prepare(
        `SELECT summary, turn_end FROM chat_turn_summaries WHERE chat_id=? AND turn_number=3`
      )
      .get(CHAT) as { summary: string; turn_end: number };
    assert.equal(row.summary, "USER LOCKED PROSE");
    assert.equal(row.turn_end, 8);
  });

  it("I episodic memory layer does not import status episodic aliases", () => {
    const src = readFileSync("/workspace/src/lib/episodicMemoryFacts.ts", "utf8");
    assert.equal(src.includes("@/lib/statusWidget/types"), false);
    assert.equal(src.includes("statusWidget"), false);
  });

  it("fingerprint detects same-id content edit", () => {
    const before = [
      {
        turnNumber: 1,
        userMessageId: 10,
        assistantMessageId: 11,
        user: "hello",
        assistant: "world",
      },
    ];
    const after = [
      {
        turnNumber: 1,
        userMessageId: 10,
        assistantMessageId: 11,
        user: "hello edited",
        assistant: "world",
      },
    ];
    assert.notEqual(
      buildMemorySourceFingerprintFromEligible(before),
      buildMemorySourceFingerprintFromEligible(after)
    );
  });
});
