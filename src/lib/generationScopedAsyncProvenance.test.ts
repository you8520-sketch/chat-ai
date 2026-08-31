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
import { markMessageSuggestedRepliesPending, loadMessageSuggestedReplies } from "@/lib/suggestedReplies/job";
import { markMessageStatusMetaPending, loadMessageStatusMeta } from "@/lib/statusMeta/job";
import type { Usage } from "@/lib/chatUsage";

const CHAT_ID = 991001;
const MSG_ID = 991010;

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
});
