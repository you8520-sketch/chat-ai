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
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  filterLedgerRowsForGenerationScope,
  generationJobKey,
  resolveActiveAssistantGenerationScope,
  resolveActiveAssistantGenerationScopeFromRow,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import {
  buildPlatformAsyncTurnLedgerContext,
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  listProviderCostEventsForAssistantGeneration,
  listProviderCostEventsForAssistantMessage,
  startProviderCostAttempt,
  type ProviderCostLedgerRow,
} from "@/lib/providerCostLedger";
import { ensureAdminFinanceTables } from "@/lib/adminFinance";
import { resolveAsyncTurnCoverage, resolveMemoryRelationshipExpectation } from "@/lib/asyncTurnCoverage";
import { buildAdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3";
import type { Usage } from "@/lib/chatUsage";
import { markMessageSuggestedRepliesPending, loadMessageSuggestedReplies, scheduleSuggestedRepliesExtraction, isSuggestedRepliesJobRunning, requeueSuggestedRepliesExtractionIfNeeded } from "@/lib/suggestedReplies/job";
import { markMessageStatusMetaPending, loadMessageStatusMeta, scheduleStatusMetaExtraction, isStatusMetaJobRunning, requeueStatusMetaExtractionIfNeeded } from "@/lib/statusMeta/job";
import { SUGGESTED_REPLY_KINDS } from "@/lib/suggestedReplies/types";
import { bootstrapStreamingTurn } from "@/lib/streamingPersistence";
import { loadAdminBillingReceiptV3ForMessage } from "@/lib/adminBillingReceiptV3Server";
import { serializeSuggestedRepliesRecord } from "@/lib/suggestedReplies/parse";
import { serializeStatusMetaRecord } from "@/lib/statusMeta/types";
import type { SuggestedReplyItem } from "@/lib/suggestedReplies/types";
import type { StatusMeta } from "@/lib/statusMeta/types";

const CHAT_ID = 991001;
const MSG_ID = 991010;
const USER_ID = 991002;
const USER_MSG_ID = 991009;

function validReplies(prefix: string): SuggestedReplyItem[] {
  return SUGGESTED_REPLY_KINDS.map((kind) => ({
    kind,
    text: `${prefix}-${kind}-${"x".repeat(40)}`,
  }));
}

function validStatusMeta(label: string): StatusMeta {
  return {
    tableMarkdown: `| ${label} |\n| --- |\n| value |`,
    datetime: "09:00",
    location: "room",
    relationship: "ok",
    npcEmotion: "calm",
    npcIntent: "talk",
    nextObjective: "go",
    hiddenThought: "none",
    sceneSummary: "scene",
  };
}

function seedRegenHarness() {
  const db = getDb();
  db.prepare("DELETE FROM api_cost_ledger WHERE assistant_message_id=?").run(MSG_ID);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id IN (1)").run();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER_ID,
    "gen-scope@test.local",
    "gen-scope",
    "x"
  );
  db.prepare(`INSERT OR REPLACE INTO characters (id, name) VALUES (1,'Char')`).run();
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?,?,1,'safe','{}')`).run(
    CHAT_ID,
    USER_ID
  );
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model)
     VALUES (?, ?, 'user', 'hi', NULL, 'completed', '[]', 0, 'm')`
  ).run(USER_MSG_ID, CHAT_ID);
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, user_message_id, generation_status, alternates, active_variant, model)
     VALUES (?, ?, 'assistant', 'gen0 text', ?, 'completed', '[]', 0, 'm')`
  ).run(MSG_ID, CHAT_ID, USER_MSG_ID);
}

function startRegenHarness(requestId = "regen-scope-test") {
  bootstrapStreamingTurn(getDb(), {
    chatId: CHAT_ID,
    requestId,
    userContent: "hi",
    skipUserInsert: true,
    existingUserMessageId: USER_MSG_ID,
    regenerateAssistantId: MSG_ID,
  });
}

function usageWithInput(input: number): Usage {
  return {
    ...baseUsage(),
    input,
    cost: input / 10,
    shadowPricing: {
      pricingVersion: 1,
      billingReferenceInputUsdPerMillion: 1,
      billingReferenceOutputUsdPerMillion: 2,
      billingReferenceCostKrw: 10,
      billingReferenceCostUsd: 0.01,
      fxSnapshot: {
        dateKey: "2026-08-30",
        source: "api_daily" as const,
        baseUsdKrw: 1560,
        overseasFeeRate: 0.02,
        effectiveKrwPerUsd: 1560.6,
      },
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
  };
}

function scheduleBase() {
  return {
    messageId: MSG_ID,
    chatId: CHAT_ID,
    charName: "Char",
    personaName: "Tester",
    userMessage: "hi",
    assistantProse: "gen0 text",
  };
}

function baseUsage(): Usage {
  return {
    input: 100,
    output: 50,
    model: "deepseek/deepseek-v4-pro",
    modelLabel: "DeepSeek V4 Pro",
    provider: "cheaperinference",
    route: "safe",
    cost: 10,
    baseCost: 10,
    breakdown: [],
  };
}

function seedMessage(alternates: string | null, activeVariant: number | null) {
  const db = getDb();
  db.prepare("DELETE FROM api_cost_ledger WHERE assistant_message_id=?").run(MSG_ID);
  db.prepare("DELETE FROM messages WHERE id=?").run(MSG_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?, 1, 1, 'safe', '{}')`
  ).run(CHAT_ID);
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, model, usage, alternates, active_variant, generation_status)
     VALUES (?, ?, 'assistant', 'active content', 'm', NULL, ?, ?, 'completed')`
  ).run(MSG_ID, CHAT_ID, alternates ?? "[]", activeVariant ?? 0);
}

function insertLedgerRow(generationSequence: number | null, usd: number): void {
  const db = getDb();
  const ctx = buildPlatformAsyncTurnLedgerContext({
    chatId: CHAT_ID,
    assistantMessageId: MSG_ID,
    generationSequence: generationSequence ?? 0,
    family: "suggested_replies_repair",
    jobAttemptOrdinal: 1,
  });
  const attempt = startProviderCostAttempt({ ...ctx, persistInTests: true }, db);
  if (generationSequence == null) {
    db.prepare("UPDATE api_cost_ledger SET generation_sequence=NULL WHERE event_key=?").run(
      attempt.physicalAttemptId
    );
  }
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

function scope(gen: number): AssistantGenerationScope {
  return {
    assistantMessageId: MSG_ID,
    generationSequence: gen,
    generationRequestId: null,
  };
}

before(() => {
  installIsolatedTestDatabase();
  const db = getDb();
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
});
after(() => uninstallIsolatedTestDatabase());

describe("generation-scoped async provenance", () => {
  it("G1 — initial generation ledger stays on generation 0", () => {
    seedMessage(null, null);
    insertLedgerRow(0, 0.002);
    const rows = listProviderCostEventsForAssistantGeneration(MSG_ID, 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.generation_sequence, 0);
  });

  it("G2/G4 — regen receipt ignores gen0 ledger when active is gen1", () => {
    seedMessage(
      JSON.stringify([
        { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
        { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
      ]),
      1
    );
    insertLedgerRow(0, 0.01);
    insertLedgerRow(1, 0.002);

    const allRows = listProviderCostEventsForAssistantMessage(MSG_ID);
    const filtered = filterLedgerRowsForGenerationScope(allRows, scope(1));
    assert.equal(filtered.scopedRows.length, 1);
    assert.equal(filtered.scopedRows[0]?.actual_cost_usd, 0.002);
    assert.equal(filtered.hasOtherGenerationRows, true);

    const knownUsd = filtered.scopedRows.reduce(
      (sum, row) => sum + Number(row.actual_cost_usd ?? 0),
      0
    );
    assert.equal(knownUsd, 0.002);
  });

  it("G3 — three generations preserve all physical rows", () => {
    seedMessage(null, null);
    insertLedgerRow(0, 0.001);
    insertLedgerRow(1, 0.002);
    insertLedgerRow(2, 0.003);
    assert.equal(listProviderCostEventsForAssistantMessage(MSG_ID).length, 3);
  });

  it("G5 — old incomplete gen0 does not poison gen1 exact receipt", () => {
    seedMessage(
      JSON.stringify([
        { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
        { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
      ]),
      1
    );
    const db = getDb();
    const failedCtx = buildPlatformAsyncTurnLedgerContext({
      chatId: CHAT_ID,
      assistantMessageId: MSG_ID,
      generationSequence: 0,
      family: "memory_relationship",
      jobAttemptOrdinal: 1,
    });
    const failedAttempt = startProviderCostAttempt({ ...failedCtx, persistInTests: true }, db);
    finalizeProviderCostAttempt(
      failedAttempt,
      { actualProvider: "cheaperinference", actualModel: "m", outcome: "failed_without_usage" },
      db
    );
    insertLedgerRow(1, 0.002);

    const filtered = filterLedgerRowsForGenerationScope(
      listProviderCostEventsForAssistantMessage(MSG_ID),
      scope(1)
    );
    assert.equal(filtered.scopedRows.length, 1);
    assert.equal(filtered.scopedRows[0]?.event_status, "settled");
  });

  it("L1 — unscoped ledger rows fail closed for current generation exact", () => {
    seedMessage(null, null);
    insertLedgerRow(null, 0.002);
    const filtered = filterLedgerRowsForGenerationScope(
      listProviderCostEventsForAssistantMessage(MSG_ID),
      scope(0)
    );
    assert.equal(filtered.scopedRows.length, 0);
    assert.equal(filtered.hasUnscopedRows, true);

    const coverage = resolveAsyncTurnCoverage({
      usage: baseUsage(),
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      memoryRelationshipTask: null,
      ledgerAsyncRows: filtered.scopedRows as ProviderCostLedgerRow[],
      hasUnscopedLedgerRows: true,
    });
    assert.equal(coverage.overallCoverage, "unverifiable");
  });

  it("M3 — gen1 skipped with gen0 ledger uses scoped zero-cost expectation", () => {
    const expectation = resolveMemoryRelationshipExpectation({
      task: {
        state: "skipped",
        updatedAt: new Date().toISOString(),
        reason: "ooc_scene",
        generationSequence: 1,
      },
      memoryRelationshipLedgerRowCount: 0,
    });
    assert.equal(expectation.expectationState, "not_expected");
  });

  it("M4 — gen1 skipped with gen1 ledger remains contradiction", () => {
    const expectation = resolveMemoryRelationshipExpectation({
      task: {
        state: "skipped",
        updatedAt: new Date().toISOString(),
        reason: "ooc_scene",
        generationSequence: 1,
      },
      memoryRelationshipLedgerRowCount: 1,
    });
    assert.equal(expectation.expectationState, "unverifiable");
    assert.equal(expectation.skipReason, "skipped_marker_with_physical_ledger_contradiction");
  });

  it("W1 — stale gen0 suggested replies pending write is rejected on gen1 active", () => {
    seedMessage(
      JSON.stringify([
        { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
        { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
      ]),
      1
    );
    markMessageSuggestedRepliesPending(MSG_ID, scope(0));
    const record = loadMessageSuggestedReplies(MSG_ID);
    assert.notEqual(record?.generationSequence, 0);
  });

  it("W2 — stale gen0 status meta pending write is rejected on gen1 active", () => {
    seedMessage(
      JSON.stringify([
        { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
        { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
      ]),
      1
    );
    markMessageStatusMetaPending(MSG_ID, "| 🕒 |", scope(0));
    const record = loadMessageStatusMeta(MSG_ID);
    assert.notEqual(record?.generationSequence, 0);
  });

  it("W3 — generation-scoped running keys do not collide across generations", () => {
    assert.notEqual(generationJobKey(scope(0)), generationJobKey(scope(1)));
  });

  it("variant switch — receipt generation follows active_variant", () => {
    const row = {
      id: MSG_ID,
      alternates: JSON.stringify([
        { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
        { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
      ]),
      active_variant: 0,
      request_id: null,
      generation_status: "completed",
      content: "gen0",
      model: "m",
      usage: null,
    };
    const active = resolveActiveAssistantGenerationScopeFromRow(row);
    assert.equal(active?.generationSequence, 0);

    row.active_variant = 1;
    const switched = resolveActiveAssistantGenerationScopeFromRow(row);
    assert.equal(switched?.generationSequence, 1);
  });

  it("admin receipt v3 honors generation-scoped ledger only", () => {
    seedMessage(
      JSON.stringify([
        { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
        { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
      ]),
      1
    );
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage(),
      assistantMessageId: MSG_ID,
      chatId: CHAT_ID,
      generationScope: scope(1),
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      memoryRelationshipTask: null,
      ledgerRows: [
        {
          family: "suggested_replies_repair",
          execution_phase: "async_post_turn",
          funding_class: "platform_funded",
          event_status: "settled",
          actual_cost_usd: 0.002,
          actual_cost_source: "cheaper_inference_billed",
          generation_sequence: 1,
        } as ProviderCostLedgerRow,
      ],
    });
    assert.equal(receipt.async.knownActualCostUsd, 0.002);
  });

  it("W1 — deferred gen0 suggested replies scheduler cannot overwrite gen1 record", async () => {
    seedRegenHarness();
    let releaseGen0!: () => void;
    const gen0Gate = new Promise<void>((resolve) => {
      releaseGen0 = resolve;
    });

    scheduleSuggestedRepliesExtraction({
      ...scheduleBase(),
      generationScope: scope(0),
      __testExtract: async () => {
        await gen0Gate;
        return validReplies("STALE");
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(isSuggestedRepliesJobRunning(scope(0)), true);

    startRegenHarness();

    const activeScope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(activeScope);

    let gen1Started = false;
    scheduleSuggestedRepliesExtraction({
      ...scheduleBase(),
      generationScope: activeScope,
      __testExtract: async () => {
        gen1Started = true;
        return validReplies("CURRENT");
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(gen1Started, true);
    assert.equal(isSuggestedRepliesJobRunning(activeScope), false);

    releaseGen0();
    await new Promise((r) => setTimeout(r, 50));

    const record = loadMessageSuggestedReplies(MSG_ID);
    assert.equal(record?.generationSequence, activeScope.generationSequence);
    assert.ok(record?.replies[0]?.text.startsWith("CURRENT"));
    assert.ok(!record?.replies.some((r) => r.text.startsWith("STALE")));
  });

  it("W2 — deferred gen0 status meta scheduler cannot overwrite gen1 record", async () => {
    seedRegenHarness();
    let releaseGen0!: () => void;
    const gen0Gate = new Promise<void>((resolve) => {
      releaseGen0 = resolve;
    });

    scheduleStatusMetaExtraction({
      ...scheduleBase(),
      generationScope: scope(0),
      formatSpec: "| 🕒 |",
      __testExtract: async () => {
        await gen0Gate;
        return validStatusMeta("STALE");
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(isStatusMetaJobRunning(scope(0)), true);

    startRegenHarness();
    const activeScope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(activeScope);

    let gen1Started = false;
    scheduleStatusMetaExtraction({
      ...scheduleBase(),
      generationScope: activeScope,
      formatSpec: "| 🕒 |",
      __testExtract: async () => {
        gen1Started = true;
        return validStatusMeta("CURRENT");
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(gen1Started, true);

    releaseGen0();
    await new Promise((r) => setTimeout(r, 50));

    const record = loadMessageStatusMeta(MSG_ID);
    assert.equal(record?.generationSequence, activeScope.generationSequence);
    assert.match(record?.meta.tableMarkdown ?? "", /CURRENT/);
    assert.doesNotMatch(record?.meta.tableMarkdown ?? "", /STALE/);
  });

  it("W3 — gen0 running does not block gen1 scheduler extraction", async () => {
    seedRegenHarness();
    let releaseGen0!: () => void;
    const gen0Gate = new Promise<void>((resolve) => {
      releaseGen0 = resolve;
    });

    scheduleSuggestedRepliesExtraction({
      ...scheduleBase(),
      generationScope: scope(0),
      __testExtract: async () => {
        await gen0Gate;
        return validReplies("OLD");
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(isSuggestedRepliesJobRunning(scope(0)), true);

    startRegenHarness();
    const activeScope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(activeScope);

    let gen1ExtractInvoked = false;
    scheduleSuggestedRepliesExtraction({
      ...scheduleBase(),
      generationScope: activeScope,
      __testExtract: async () => {
        gen1ExtractInvoked = true;
        return validReplies("NEW");
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(gen1ExtractInvoked, true);
    releaseGen0();
  });

  it("W4 — gen0 deferred completion after regen does not write gen1 state", async () => {
    seedRegenHarness();
    let releaseGen0!: () => void;
    const gen0Gate = new Promise<void>((resolve) => {
      releaseGen0 = resolve;
    });

    scheduleSuggestedRepliesExtraction({
      ...scheduleBase(),
      generationScope: scope(0),
      __testExtract: async () => {
        await gen0Gate;
        return validReplies("LATE");
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    startRegenHarness();
    const activeScope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(activeScope);
    markMessageSuggestedRepliesPending(MSG_ID, activeScope);

    releaseGen0();
    await new Promise((r) => setTimeout(r, 50));

    const record = loadMessageSuggestedReplies(MSG_ID);
    assert.equal(record?.generationSequence, activeScope.generationSequence);
    assert.equal(record?.pending, true);
    assert.ok(!record?.replies.some((r) => r.text.startsWith("LATE")));
  });

  it("Q1 — old-generation stale pending is not requeued", () => {
    seedMessage(
      JSON.stringify([
        { content: "gen0", model: "m", usage: null, created_at: "", generationSequence: 0 },
        { content: "gen1", model: "m", usage: null, created_at: "", generationSequence: 1 },
      ]),
      1
    );
    const db = getDb();
    const staleGen0 = {
      replies: [],
      extractedAt: new Date(Date.now() - 120_000).toISOString(),
      source: "background-deepseek" as const,
      pending: true,
      failed: false,
      generationSequence: 0,
    };
    db.prepare("UPDATE messages SET suggested_replies_json=? WHERE id=?").run(
      serializeSuggestedRepliesRecord(staleGen0),
      MSG_ID
    );
    assert.equal(requeueSuggestedRepliesExtractionIfNeeded(MSG_ID), false);
  });

  it("Q2 — current-generation stale pending is requeued", () => {
    seedRegenHarness();
    startRegenHarness();
    const activeScope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(activeScope);
    const db = getDb();
    const staleGen1 = {
      replies: [],
      extractedAt: new Date(Date.now() - 120_000).toISOString(),
      source: "background-deepseek" as const,
      pending: true,
      failed: false,
      generationSequence: activeScope.generationSequence,
      generationRequestId: activeScope.generationRequestId,
    };
    db.prepare("UPDATE messages SET suggested_replies_json=? WHERE id=?").run(
      serializeSuggestedRepliesRecord(staleGen1),
      MSG_ID
    );
    assert.equal(requeueSuggestedRepliesExtractionIfNeeded(MSG_ID), true);

    const staleStatusGen1 = {
      meta: validStatusMeta("pending"),
      extractedAt: new Date(Date.now() - 120_000).toISOString(),
      source: "background-deepseek" as const,
      pending: true,
      failed: false,
      generationSequence: activeScope.generationSequence,
      generationRequestId: activeScope.generationRequestId,
    };
    db.prepare("UPDATE messages SET status_meta=? WHERE id=?").run(
      serializeStatusMetaRecord(staleStatusGen1),
      MSG_ID
    );
    assert.equal(requeueStatusMetaExtractionIfNeeded(MSG_ID), true);
  });

  it("regen bootstrap — post-bootstrap pending write is effective for current generation", () => {
    seedRegenHarness();
    startRegenHarness();
    const activeScope = resolveActiveAssistantGenerationScope(MSG_ID);
    assert.ok(activeScope);
    markMessageSuggestedRepliesPending(MSG_ID, activeScope);
    const record = loadMessageSuggestedReplies(MSG_ID);
    assert.equal(record?.pending, true);
    assert.equal(record?.generationSequence, activeScope.generationSequence);
  });

  it("variant switch — server receipt follows active variant usage and ledger", () => {
    const usageA = usageWithInput(100);
    const usageB = usageWithInput(200);
    const db = getDb();
    db.prepare("DELETE FROM api_cost_ledger WHERE assistant_message_id=?").run(MSG_ID);
    db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
    db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
    db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
    db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
      USER_ID,
      "receipt@test.local",
      "receipt",
      "x"
    );
    db.prepare("DELETE FROM characters WHERE id IN (1)").run();
    db.prepare(`INSERT OR REPLACE INTO characters (id, name) VALUES (1,'Char')`).run();
    db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?,?,1,'safe','{}')`).run(
      CHAT_ID,
      USER_ID
    );
    const alternates = JSON.stringify([
      { content: "gen0", model: "m", usage: usageA, created_at: "", generationSequence: 0 },
      { content: "gen1", model: "m", usage: usageB, created_at: "", generationSequence: 1 },
    ]);
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, usage, alternates, active_variant, generation_status, user_message_id)
       VALUES (?, ?, 'assistant', 'gen0', 'm', ?, ?, 0, 'completed', NULL)`
    ).run(MSG_ID, CHAT_ID, JSON.stringify(usageA), alternates);

    insertLedgerRow(0, 0.01);
    insertLedgerRow(1, 0.002);

    const gen0Receipt = loadAdminBillingReceiptV3ForMessage({ userId: USER_ID, messageId: MSG_ID });
    assert.equal(gen0Receipt.ok, true);
    if (gen0Receipt.ok) {
      assert.equal(gen0Receipt.receipt.syncReceipt.userCharge.inputTokens, 100);
      assert.equal(gen0Receipt.receipt.async.knownActualCostUsd, 0.01);
    }

    db.prepare("UPDATE messages SET active_variant=1, content='gen1' WHERE id=?").run(MSG_ID);
    const gen1Receipt = loadAdminBillingReceiptV3ForMessage({ userId: USER_ID, messageId: MSG_ID });
    assert.equal(gen1Receipt.ok, true);
    if (gen1Receipt.ok) {
      assert.equal(gen1Receipt.receipt.syncReceipt.userCharge.inputTokens, 200);
      assert.equal(gen1Receipt.receipt.async.knownActualCostUsd, 0.002);
    }
  });
});
