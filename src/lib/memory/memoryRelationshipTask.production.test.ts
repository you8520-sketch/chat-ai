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
import Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { scheduleMemoryUpdate } from "@/lib/memory/memory-manager";
import { mergeRelationshipMetaFromTurn } from "@/lib/memory/memory-relationship-meta";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { getMemorySourceBoundary } from "@/lib/memory/memory-source-boundary";
import {
  loadMessageMemoryRelationshipTask,
} from "@/lib/memory/memoryRelationshipTask";
import {
  buildPlatformAsyncTurnLedgerContext,
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  startProviderCostAttempt,
  listProviderCostEventsForAssistantMessage,
} from "@/lib/providerCostLedger";
import { ensureAdminFinanceTables } from "@/lib/adminFinance";
import {
  resolveMemoryRelationshipExpectation,
} from "@/lib/asyncTurnCoverage";
import { buildAdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3";

const CHAT_ID = 880001;
const USER_ID = 880002;
const CHAR_ID = 880003;
const ASSISTANT_MSG_ID = 880010;
const USER_MSG_ID = 880009;

let extractCallCount = 0;

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM api_cost_ledger WHERE assistant_message_id=?").run(ASSISTANT_MSG_ID);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
}

function seed() {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER_ID,
    `rel-task-${USER_ID}@test.local`,
    "rel-task",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "TestChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?,?,?,'safe','{}')`).run(
    CHAT_ID,
    USER_ID,
    CHAR_ID
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, memory_relationship_task_json)
     VALUES (?, ?, 'user', 'hello', NULL, NULL)`
  ).run(USER_MSG_ID, CHAT_ID);
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, memory_relationship_task_json)
     VALUES (?, ?, 'assistant', 'hi there', ?, NULL)`
  ).run(ASSISTANT_MSG_ID, CHAT_ID, USER_MSG_ID);
  getOrCreateChatMemory(CHAT_ID, USER_ID, CHAR_ID, "free");
}

function ledgerCount(db: Database.Database = getDb()): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM api_cost_ledger WHERE assistant_message_id=?")
      .get(ASSISTANT_MSG_ID) as { c: number }
  ).c;
}

const GEN0_SCOPE = {
  assistantMessageId: ASSISTANT_MSG_ID,
  generationSequence: 0,
  generationRequestId: null as string | null,
};

function scheduleBase(overrides: Partial<Parameters<typeof scheduleMemoryUpdate>[0]> = {}) {
  return scheduleMemoryUpdate({
    chatId: CHAT_ID,
    userId: USER_ID,
    characterId: CHAR_ID,
    relationshipNames: { charName: "TestChar", userName: "Tester" },
    tier: "free",
    memoryCapacity: 4000,
    userMessage: "hello",
    assistantMessage: "hi there",
    assistantMessageId: ASSISTANT_MSG_ID,
    sourceUserMessageId: USER_MSG_ID,
    route: "safe",
    generationScope: GEN0_SCOPE,
    ...overrides,
  });
}

function mergeBase(overrides: Partial<Parameters<typeof mergeRelationshipMetaFromTurn>[0]> = {}) {
  extractCallCount += 1;
  return mergeRelationshipMetaFromTurn({
    chatId: CHAT_ID,
    names: { charName: "TestChar", userName: "Tester" },
    userMessage: "hello",
    assistantMessage: "hi there",
    route: "safe",
    sourceUserMessageId: USER_MSG_ID,
    boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
    assistantMessageId: ASSISTANT_MSG_ID,
    generationScope: GEN0_SCOPE,
    __testExtract: async () => {
      extractCallCount += 1;
      return { delta: {}, parseOk: true };
    },
    ...overrides,
  });
}

before(() => {
  installIsolatedTestDatabase();
  const db = getDb();
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
});
after(() => uninstallIsolatedTestDatabase());

describe("memoryRelationshipTask production path regression", () => {
  let prevMemoryFeature: string | undefined;
  let prevGeminiIsolation: string | undefined;

  beforeEach(() => {
    seed();
    extractCallCount = 0;
    prevMemoryFeature = process.env.MEMORY_FEATURE_ENABLED;
    prevGeminiIsolation = process.env.GEMINI_ISOLATION_MODE;
    process.env.MEMORY_FEATURE_ENABLED = "1";
    process.env.GEMINI_ISOLATION_MODE = "0";
  });

  afterEach(() => {
    if (prevMemoryFeature === undefined) delete process.env.MEMORY_FEATURE_ENABLED;
    else process.env.MEMORY_FEATURE_ENABLED = prevMemoryFeature;
    if (prevGeminiIsolation === undefined) delete process.env.GEMINI_ISOLATION_MODE;
    else process.env.GEMINI_ISOLATION_MODE = prevGeminiIsolation;
    cleanup();
  });

  it("C1 — feature disabled skip writes durable marker without provider call", async () => {
    process.env.MEMORY_FEATURE_ENABLED = "0";
    await scheduleBase();
    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "skipped");
    assert.equal(marker?.reason, "feature_disabled");
    assert.equal(ledgerCount(), 0);
  });

  it("C2 — OOC skip writes durable marker without provider call", async () => {
    await scheduleBase({
      userMessage: "OOC: 본편과 별개로 이 상황을 샘플 장면으로 한 번 보여줘.",
    });
    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "skipped");
    assert.equal(marker?.reason, "ooc_scene");
    assert.equal(ledgerCount(), 0);
  });

  it("C3 — gemini isolation skip writes durable marker without provider call", async () => {
    process.env.GEMINI_ISOLATION_MODE = "1";
    await scheduleBase();
    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "skipped");
    assert.equal(marker?.reason, "gemini_isolation");
    assert.equal(ledgerCount(), 0);
  });

  it("C4 — main tail skip writes durable marker without provider call", async () => {
    await scheduleBase({
      relationshipTailParsed: true,
      relationshipDeltaFromMain: { items: ["Tester: ring"] },
    });
    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "skipped");
    assert.equal(marker?.reason, "main_model_tail_satisfied");
    assert.equal(ledgerCount(), 0);
  });

  it("C5 — pre-reset skip writes durable marker without provider call", async () => {
    getDb()
      .prepare(`UPDATE chat_memories SET memory_reset_after_message_id=? WHERE chat_id=?`)
      .run(USER_MSG_ID, CHAT_ID);
    await scheduleBase();
    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "skipped");
    assert.equal(marker?.reason, "memory_source_pre_reset");
    assert.equal(ledgerCount(), 0);
  });

  it("C6 — provider success + zero delta + accepted commit writes succeeded", async () => {
    await mergeBase({
      __testExtract: async () => ({ delta: {}, parseOk: true }),
    });
    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "succeeded");
    assert.notEqual(marker?.reason, "parse_failed");
  });

  it("C7 — stale epoch after provider extraction writes failed, preserves ledger", async () => {
    const db = getDb();
    const boundarySnapshot = getMemorySourceBoundary(CHAT_ID);
    const ctx = {
      ...buildPlatformAsyncTurnLedgerContext({
        chatId: CHAT_ID,
        assistantMessageId: ASSISTANT_MSG_ID,
        generationSequence: 0,
        family: "memory_relationship",
        jobAttemptOrdinal: 1,
      }),
      persistInTests: true,
    };
    const attempt = startProviderCostAttempt(ctx, db);
    finalizeProviderCostAttempt(
      attempt,
      {
        actualProvider: "cheaperinference",
        actualModel: "deepseek-v4-flash",
        cheaperInferenceBilledCostUsd: 0.002,
        outcome: "success",
      },
      db
    );

    db.prepare(`UPDATE chat_memories SET memory_epoch=memory_epoch+1 WHERE chat_id=?`).run(CHAT_ID);

    await mergeRelationshipMetaFromTurn({
      chatId: CHAT_ID,
      names: { charName: "TestChar", userName: "Tester" },
      userMessage: "hello",
      assistantMessage: "hi there",
      route: "safe",
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot,
      assistantMessageId: ASSISTANT_MSG_ID,
      generationScope: GEN0_SCOPE,
      __testExtract: async () => ({ delta: { items: ["Tester: coin"] }, parseOk: true }),
    });

    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "failed");
    assert.equal(marker?.reason, "stale_epoch_rejected");
    assert.notEqual(marker?.state, "succeeded");
    assert.notEqual(marker?.state, "skipped");
    assert.equal(listProviderCostEventsForAssistantMessage(ASSISTANT_MSG_ID, db).length, 1);

    const failedExpectation = resolveMemoryRelationshipExpectation({
      task: marker,
      memoryRelationshipLedgerRowCount: 1,
    });
    assert.equal(failedExpectation.taskFailed, true);
    assert.equal(failedExpectation.expectationState, "terminal");
  });

  it("C8 — commit throw closes pending as failed", async () => {
    await mergeBase({
      __testExtract: async () => ({ delta: { items: ["Tester: sword"] }, parseOk: true }),
      __testThrowOnSave: true,
    });
    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "failed");
    assert.equal(marker?.reason, "commit_failed");
    assert.notEqual(marker?.state, "pending");
    assert.notEqual(marker?.state, "succeeded");
  });

  it("C9 — absent marker stays unverifiable", () => {
    const exp = resolveMemoryRelationshipExpectation({
      task: null,
      memoryRelationshipLedgerRowCount: 0,
    });
    assert.equal(exp.expectationState, "unverifiable");
  });

  it("C10 — skipped + stray ledger fails closed", () => {
    const receipt = buildAdminBillingReceiptV3({
      usage: {
        input: 1,
        output: 1,
        model: "x",
        cost: 80,
        baseCost: 80,
        breakdown: [],
      },
      assistantMessageId: ASSISTANT_MSG_ID,
      chatId: CHAT_ID,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      memoryRelationshipTask: {
        state: "skipped",
        updatedAt: new Date().toISOString(),
        reason: "main_model_tail_satisfied",
      },
      ledgerRows: [
        {
          family: "memory_relationship",
          execution_phase: "async_post_turn",
          funding_class: "platform_funded",
          event_status: "settled",
          actual_cost_usd: 0.001,
          actual_cost_source: "cheaper_inference_billed",
        } as never,
      ],
    });
    assert.equal(
      receipt.async.byFamily.find((f) => f.family === "memory_relationship")?.expectationState,
      "unverifiable"
    );
    assert.equal(receipt.wholeTurn.exactProviderSpendUsd, null);
  });
});
