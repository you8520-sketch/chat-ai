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
import { scheduleMemoryUpdate } from "@/lib/memory/memory-manager";
import {
  mergeRelationshipMetaAfterRegenerate,
  mergeRelationshipMetaFromTurn,
} from "@/lib/memory/memory-relationship-meta";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { getMemorySourceBoundary } from "@/lib/memory/memory-source-boundary";
import {
  clearMemoryRelationshipTaskMarker,
  loadMessageMemoryRelationshipTask,
  setMemoryRelationshipTaskState,
} from "@/lib/memory/memoryRelationshipTask";
import {
  buildPlatformAsyncTurnLedgerContext,
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  startProviderCostAttempt,
  listProviderCostEventsForAssistantMessage,
} from "@/lib/providerCostLedger";
import { ensureAdminFinanceTables } from "@/lib/adminFinance";
import { resolveMemoryRelationshipExpectation } from "@/lib/asyncTurnCoverage";
import { buildAdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3";
import { bootstrapStreamingTurn } from "@/lib/streamingPersistence";

const CHAT_ID = 881001;
const USER_ID = 881002;
const CHAR_ID = 881003;
const ASSISTANT_MSG_ID = 881010;
const USER_MSG_ID = 881009;

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
    `regen-task-${USER_ID}@test.local`,
    "regen-task",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "TestChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?,?,?,'safe','{}')`).run(
    CHAT_ID,
    USER_ID,
    CHAR_ID
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, memory_relationship_task_json, generation_status)
     VALUES (?, ?, 'user', 'hello', NULL, NULL, 'completed')`
  ).run(USER_MSG_ID, CHAT_ID);
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, memory_relationship_task_json, generation_status)
     VALUES (?, ?, 'assistant', 'old reply', ?, NULL, 'completed')`
  ).run(ASSISTANT_MSG_ID, CHAT_ID, USER_MSG_ID);
  getOrCreateChatMemory(CHAT_ID, USER_ID, CHAR_ID, "free");
}

function startRegen(requestId = "regen-req-1") {
  return bootstrapStreamingTurn(getDb(), {
    chatId: CHAT_ID,
    requestId,
    userContent: "hello",
    skipUserInsert: true,
    existingUserMessageId: USER_MSG_ID,
    regenerateAssistantId: ASSISTANT_MSG_ID,
  });
}

function insertOldMemoryLedger(usd = 0.002) {
  const db = getDb();
  const ctx = buildPlatformAsyncTurnLedgerContext({
    chatId: CHAT_ID,
    assistantMessageId: ASSISTANT_MSG_ID,
    family: "memory_relationship",
    jobAttemptOrdinal: 1,
  });
  const attempt = startProviderCostAttempt({ ...ctx, persistInTests: true }, db);
  finalizeProviderCostAttempt(
    attempt,
    {
      actualProvider: "cheaperinference",
      actualModel: "deepseek-v4-flash",
      cheaperInferenceBilledCostUsd: usd,
      outcome: "success",
    },
    db
  );
}

const FX = {
  dateKey: "2026-08-30",
  source: "api_daily" as const,
  baseUsdKrw: 1560,
  overseasFeeRate: 0.02,
  effectiveKrwPerUsd: 1560.6,
  locked: true,
};

function buildReceiptWithMarkerAndLedger(
  marker: ReturnType<typeof loadMessageMemoryRelationshipTask>,
  ledgerUsd: number | null
) {
  return buildAdminBillingReceiptV3({
    usage: {
      input: 1000,
      output: 500,
      model: "deepseek/deepseek-v4-pro",
      modelLabel: "DeepSeek V4 Pro",
      provider: "cheaperinference",
      route: "nsfw",
      cost: 80,
      baseCost: 80,
      breakdown: [],
      shadowPricing: {
        pricingVersion: 1,
        billingReferenceInputUsdPerMillion: 1,
        billingReferenceOutputUsdPerMillion: 2,
        billingReferenceCostKrw: 10,
        billingReferenceCostUsd: 0.01,
        fxSnapshot: FX,
        providerListCostStatus: "complete",
        reserveStatus: "complete",
        actualTurnCostCoverage: "complete",
        actualProviderCostKrw: 31.2,
        actualCostUsd: 0.02,
        actualCostSource: "cheaper_inference_billed",
        providerListCostKrw: 35,
        inputCostKrw: 5,
        outputCostKrw: 5,
        reasoningCostKrw: 0,
        cacheReadCostKrw: 0,
        cacheWriteCostKrw: 0,
        targetMargin: 0.5,
        minimumMarginFloor: 0.3,
        standardUserChargeKrw: 80,
        promoPercent: 0,
        finalShadowChargeKrw: 80,
        finalShadowPoints: 80,
        providerSavingsKrw: null,
        providerOverrunKrw: null,
        promoGivebackKrw: 0,
        netPricingBufferDeltaKrw: null,
        actualGrossProfitKrw: 50,
        actualRealizedMargin: 0.625,
        worstCasePromoMargin: null,
        marginFloorViolated: null,
        modelId: "deepseek/deepseek-v4-pro",
        provider: "cheaperinference",
      },
    },
    assistantMessageId: ASSISTANT_MSG_ID,
    chatId: CHAT_ID,
    suggestedRepliesRecord: null,
    statusMetaRecord: null,
    memoryRelationshipTask: marker,
    ledgerRows:
      ledgerUsd == null
        ? []
        : [
            {
              family: "memory_relationship",
              execution_phase: "async_post_turn",
              funding_class: "platform_funded",
              event_status: "settled",
              actual_cost_usd: ledgerUsd,
              actual_cost_source: "cheaper_inference_billed",
            } as never,
          ],
  });
}

async function providerBackedRegen() {
  extractCallCount += 1;
  return mergeRelationshipMetaAfterRegenerate({
    chatId: CHAT_ID,
    names: { charName: "TestChar", userName: "Tester" },
    userMessage: "hello",
    newAssistantMessage: "new reply",
    previousAssistantMessage: "old reply",
    route: "safe",
    sourceUserMessageId: USER_MSG_ID,
    boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
    assistantMessageId: ASSISTANT_MSG_ID,
    __testExtract: async () => {
      extractCallCount += 1;
      return { delta: { items: ["Tester: token"] }, parseOk: true };
    },
  });
}

before(() => {
  installIsolatedTestDatabase();
  const db = getDb();
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
});
after(() => uninstallIsolatedTestDatabase());

describe("memoryRelationshipTask regeneration fail-closed", () => {
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

  it("R1 — old skipped marker → provider-backed regenerate stays unverifiable", async () => {
    setMemoryRelationshipTaskState(ASSISTANT_MSG_ID, "skipped", "main_model_tail_satisfied");
    startRegen();
    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID), null);

    await providerBackedRegen();
    assert.equal(extractCallCount, 2);
    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID), null);

    const expectation = resolveMemoryRelationshipExpectation({
      task: null,
      memoryRelationshipLedgerRowCount: 0,
    });
    assert.equal(expectation.expectationState, "unverifiable");

    const receipt = buildReceiptWithMarkerAndLedger(null, null);
    assert.equal(receipt.wholeTurn.exactProviderSpendUsd, null);
    assert.equal(receipt.wholeTurn.contributionMarginKrw, null);
    assert.notEqual(receipt.async.byFamily.find((f) => f.family === "memory_relationship")?.expectationState, "terminal");
  });

  it("R2 — old succeeded + old exact ledger → regen marker absent, old ledger preserved", async () => {
    setMemoryRelationshipTaskState(ASSISTANT_MSG_ID, "succeeded");
    insertOldMemoryLedger(0.002);
    assert.equal(listProviderCostEventsForAssistantMessage(ASSISTANT_MSG_ID).length, 1);

    startRegen();
    await providerBackedRegen();

    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID), null);
    assert.equal(listProviderCostEventsForAssistantMessage(ASSISTANT_MSG_ID).length, 1);

    const expectation = resolveMemoryRelationshipExpectation({
      task: null,
      memoryRelationshipLedgerRowCount: 1,
    });
    assert.equal(expectation.expectationState, "unverifiable");
    assert.equal(expectation.skipReason, "missing_durable_marker_with_ledger_evidence");

    const receipt = buildReceiptWithMarkerAndLedger(null, 0.002);
    assert.equal(receipt.wholeTurn.exactProviderSpendUsd, null);
    assert.equal(receipt.wholeTurn.contributionMarginKrw, null);
  });

  it("R3 — old failed marker cleared; provider-backed regen stays absent/unverifiable", async () => {
    setMemoryRelationshipTaskState(ASSISTANT_MSG_ID, "failed", "parse_failed");
    startRegen();
    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID), null);

    await providerBackedRegen();
    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID), null);
    assert.equal(
      resolveMemoryRelationshipExpectation({ task: null, memoryRelationshipLedgerRowCount: 0 })
        .expectationState,
      "unverifiable"
    );
  });

  it("R4 — pending marker reset blocks late old-task terminal promotion", async () => {
    setMemoryRelationshipTaskState(ASSISTANT_MSG_ID, "pending");
    clearMemoryRelationshipTaskMarker(ASSISTANT_MSG_ID);
    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID), null);

    const lateTerminal = setMemoryRelationshipTaskState(ASSISTANT_MSG_ID, "succeeded");
    assert.equal(lateTerminal, null);
    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID), null);
  });

  it("R4b — deferred original task cannot promote after regen reset", async () => {
    let releaseExtract!: () => void;
    const extractGate = new Promise<void>((resolve) => {
      releaseExtract = resolve;
    });

    const originalTask = mergeRelationshipMetaFromTurn({
      chatId: CHAT_ID,
      names: { charName: "TestChar", userName: "Tester" },
      userMessage: "hello",
      assistantMessage: "old reply",
      route: "safe",
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: ASSISTANT_MSG_ID,
      __testExtract: async () => {
        await extractGate;
        return { delta: {}, parseOk: true };
      },
    });

    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID)?.state, "pending");
    startRegen();
    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID), null);
    releaseExtract();
    await originalTask;

    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID), null);
  });

  it("R5 — regen deterministic no-provider writes new skipped after reset", async () => {
    setMemoryRelationshipTaskState(ASSISTANT_MSG_ID, "skipped", "main_model_tail_satisfied");
    startRegen();

    await scheduleMemoryUpdate({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      relationshipNames: { charName: "TestChar", userName: "Tester" },
      tier: "free",
      memoryCapacity: 4000,
      userMessage: "OOC: 본편과 별개로 이 상황을 샘플 장면으로 한 번 보여줘.",
      assistantMessage: "new reply",
      assistantMessageId: ASSISTANT_MSG_ID,
      sourceUserMessageId: USER_MSG_ID,
      isRegenerate: true,
      previousAssistantMessage: "old reply",
      route: "safe",
    });

    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "skipped");
    assert.equal(marker?.reason, "ooc_scene");
    assert.equal(extractCallCount, 0);
  });

  it("R6 — regen skipped + old ledger fails closed as unverifiable", async () => {
    insertOldMemoryLedger(0.001);
    startRegen();

    await scheduleMemoryUpdate({
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      relationshipNames: { charName: "TestChar", userName: "Tester" },
      tier: "free",
      memoryCapacity: 4000,
      userMessage: "OOC: 본편과 별개로 이 상황을 샘플 장면으로 한 번 보여줘.",
      assistantMessage: "new reply",
      assistantMessageId: ASSISTANT_MSG_ID,
      sourceUserMessageId: USER_MSG_ID,
      isRegenerate: true,
      previousAssistantMessage: "old reply",
      route: "safe",
    });

    const marker = loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID);
    assert.equal(marker?.state, "skipped");
    assert.equal(listProviderCostEventsForAssistantMessage(ASSISTANT_MSG_ID).length, 1);

    const expectation = resolveMemoryRelationshipExpectation({
      task: marker,
      memoryRelationshipLedgerRowCount: 1,
    });
    assert.equal(expectation.expectationState, "unverifiable");
    assert.equal(expectation.skipReason, "skipped_marker_with_physical_ledger_contradiction");
  });

  it("R7 — normal turn lifecycle unchanged", async () => {
    await mergeRelationshipMetaFromTurn({
      chatId: CHAT_ID,
      names: { charName: "TestChar", userName: "Tester" },
      userMessage: "hello",
      assistantMessage: "hi there",
      route: "safe",
      sourceUserMessageId: USER_MSG_ID,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: ASSISTANT_MSG_ID,
      __testExtract: async () => ({ delta: {}, parseOk: true }),
    });
    assert.equal(loadMessageMemoryRelationshipTask(ASSISTANT_MSG_ID)?.state, "succeeded");
  });
});
