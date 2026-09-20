import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  assertAdminProviderRequestForensicSafePayload,
  lookupAdminProviderRequestForensic,
  projectAdminProviderRequestForensicRecord,
} from "@/lib/adminProviderRequestLookup";
import { ensureAdminFinanceTables } from "@/lib/adminFinance";
import {
  buildPlatformSyncTurnLedgerContext,
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  recordBackgroundProviderCost,
  startProviderCostAttempt,
} from "@/lib/providerCostLedger";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_gifts (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS chat_image_generations (id INTEGER PRIMARY KEY);
  `);
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
  return db;
}

function insertLegacyDuplicateRow(
  db: Database.Database,
  opts: {
    provider: string;
    providerRequestId: string;
    actualCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    requestKind?: string;
  }
) {
  db.prepare(
    `INSERT INTO api_cost_ledger
      (event_key, provider, model, request_kind, input_tokens, output_tokens,
       exchange_rate_krw_per_usd, cost_krw, estimated, actual_cost_usd,
       actual_cost_source, event_status, provider_request_id, family,
       execution_phase, funding_class, created_at)
     VALUES (?, ?, 'gpt-5.6-luna', ?, ?, ?,
       1500, 1.5, 0, ?, 'cheaper_inference_billed', 'settled', ?,
       'background', 'async_post_turn', 'platform_funded', datetime('now'))`
  ).run(
    randomUUID(),
    opts.provider,
    opts.requestKind ?? "background-prompt-translation",
    opts.inputTokens,
    opts.outputTokens,
    opts.actualCostUsd,
    opts.providerRequestId
  );
}

describe("adminProviderRequestLookup", () => {
  it("returns one canonical physical event for an exact provider request id", () => {
    const db = createDb();
    const requestId = `req-${randomUUID()}`;
    recordBackgroundProviderCost(
      {
        provider: "cheaperinference",
        model: "gpt-5.6-luna",
        requestKind: "background-prompt-translation",
        costCenter: "asset",
        inputTokens: 8553,
        outputTokens: 1655,
        cheaperInferenceBilledCostUsd: 0.0017,
        providerRequestId: requestId,
        persistInTests: true,
      },
      db
    );

    const result = lookupAdminProviderRequestForensic(requestId, { db });
    assert.ok(result);
    assert.equal(result.matchingRowCount, 1);
    assert.equal(result.duplicateDetected, false);
    assert.equal(result.event.providerRequestId, requestId);
    assert.equal(result.event.requestKind, "background-prompt-translation");
    assert.equal(result.event.canonicalOwner, "OTHER_ASYNC");
    assert.equal(result.event.assistantMessageId, null);
    assert.equal(result.event.turnLinked, false);
    assert.equal(result.event.inputTokens, 8553);
    assert.equal(result.event.outputTokens, 1655);
    assert.ok(Math.abs((result.event.actualCostUsd ?? 0) - 0.0017) < 1e-9);
  });

  it("returns null for unknown provider request id", () => {
    const db = createDb();
    assert.equal(
      lookupAdminProviderRequestForensic("00000000-0000-0000-0000-000000000000", { db }),
      null
    );
  });

  it("preserves generation fields for turn-linked ledger rows", () => {
    const db = createDb();
    const requestId = `turn-${randomUUID()}`;
    const ctx = {
      ...buildPlatformSyncTurnLedgerContext({
        chatId: 707,
        assistantMessageId: 4022,
        generationSequence: 1,
        family: "post_turn_shared_initial",
        requestedModel: "gpt-5.6-luna",
        requestKind: "background-post-turn-shared-initial",
      }),
      providerRequestId: requestId,
      persistInTests: true,
    };
    const attempt = startProviderCostAttempt(ctx, db);
    finalizeProviderCostAttempt(
      attempt,
      {
        actualProvider: "cheaperinference",
        actualModel: "gpt-5.6-luna",
        inputTokens: 7712,
        outputTokens: 593,
        cheaperInferenceBilledCostUsd: 0.001056,
        providerRequestId: requestId,
        outcome: "success",
      },
      db
    );

    const result = lookupAdminProviderRequestForensic(requestId, { db });
    assert.ok(result);
    assert.equal(result.event.assistantMessageId, 4022);
    assert.equal(result.event.generationSequence, 1);
    assert.equal(result.event.turnLinked, true);
    assert.equal(result.event.costAttribution, "whole_turn");
    assert.equal(result.event.canonicalOwner, "STATUS_WIDGET");
  });

  it("does not aggregate deduped writer replay into summed cost", () => {
    const db = createDb();
    const requestId = `dedupe-${randomUUID()}`;
    const first = recordBackgroundProviderCost(
      {
        provider: "cheaperinference",
        model: "gpt-5.6-luna",
        requestKind: "background-prompt-translation",
        cheaperInferenceBilledCostUsd: 0.001,
        providerRequestId: requestId,
        persistInTests: true,
      },
      db
    );
    const second = recordBackgroundProviderCost(
      {
        provider: "cheaperinference",
        model: "gpt-5.6-luna",
        requestKind: "background-prompt-translation",
        cheaperInferenceBilledCostUsd: 0.002,
        providerRequestId: requestId,
        persistInTests: true,
      },
      db
    );
    assert.equal(first.recorded, true);
    assert.equal(second.recorded, false);

    const rows = db
      .prepare(
        "SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider = ? AND provider_request_id = ?"
      )
      .get("cheaperinference", requestId) as { c: number };
    assert.equal(rows.c, 1);

    const result = lookupAdminProviderRequestForensic(requestId, { db });
    assert.ok(result);
    assert.equal(result.matchingRowCount, 1);
    assert.equal(result.duplicateDetected, false);
    assert.ok(Math.abs((result.event.actualCostUsd ?? 0) - 0.001) < 1e-9);
  });

  it("surfaces legacy duplicate identity without aggregating cost", () => {
    const db = createDb();
    // Simulate legacy DBs where duplicate billing identity prevented unique index creation.
    db.exec("DROP INDEX IF EXISTS idx_api_cost_ledger_provider_request");
    const requestId = `legacy-dup-${randomUUID()}`;
    insertLegacyDuplicateRow(db, {
      provider: "cheaperinference",
      providerRequestId: requestId,
      actualCostUsd: 0.001,
      inputTokens: 8553,
      outputTokens: 1655,
    });
    insertLegacyDuplicateRow(db, {
      provider: "cheaperinference",
      providerRequestId: requestId,
      actualCostUsd: 0.002,
      inputTokens: 10266,
      outputTokens: 3250,
    });

    const stored = db
      .prepare(
        "SELECT id, actual_cost_usd FROM api_cost_ledger WHERE provider = ? AND provider_request_id = ? ORDER BY id ASC"
      )
      .all("cheaperinference", requestId) as Array<{ id: number; actual_cost_usd: number }>;
    assert.equal(stored.length, 2);

    const result = lookupAdminProviderRequestForensic(requestId, { db });
    assert.ok(result);
    assert.equal(result.matchingRowCount, 2);
    assert.equal(result.duplicateDetected, true);
    assert.equal(result.event.id, stored[0]!.id);
    assert.ok(Math.abs((result.event.actualCostUsd ?? 0) - 0.001) < 1e-9);
    assert.notEqual(result.event.actualCostUsd, 0.003);
  });

  it("scopes lookup by provider — same request id on different providers are distinct", () => {
    const db = createDb();
    const requestId = `shared-id-${randomUUID()}`;
    insertLegacyDuplicateRow(db, {
      provider: "cheaperinference",
      providerRequestId: requestId,
      actualCostUsd: 0.001,
      inputTokens: 100,
      outputTokens: 50,
    });
    insertLegacyDuplicateRow(db, {
      provider: "openrouter",
      providerRequestId: requestId,
      actualCostUsd: 0.002,
      inputTokens: 200,
      outputTokens: 60,
      requestKind: "background-profile-format",
    });

    const ci = lookupAdminProviderRequestForensic(requestId, {
      provider: "cheaperinference",
      db,
    });
    assert.ok(ci);
    assert.equal(ci.matchingRowCount, 1);
    assert.equal(ci.event.provider, "cheaperinference");

    const or = lookupAdminProviderRequestForensic(requestId, {
      provider: "openrouter",
      db,
    });
    assert.ok(or);
    assert.equal(or.matchingRowCount, 1);
    assert.equal(or.event.provider, "openrouter");
  });

  it("projects only canonical ledger fields without prompt/content secrets", () => {
    const db = createDb();
    const requestId = `safe-${randomUUID()}`;
    recordBackgroundProviderCost(
      {
        provider: "cheaperinference",
        model: "gpt-5.6-luna",
        requestKind: "background-prompt-translation",
        providerRequestId: requestId,
        cheaperInferenceBilledCostUsd: 0.001,
        persistInTests: true,
      },
      db
    );
    const row = db
      .prepare("SELECT * FROM api_cost_ledger WHERE provider_request_id = ?")
      .get(requestId) as never;
    const projected = projectAdminProviderRequestForensicRecord(row);
    for (const key of ["prompt", "messages", "content", "authorization", "apiKey", "api_key", "rawResponse", "responseBody"]) {
      assert.equal(key in projected, false, `forbidden key leaked: ${key}`);
    }
    assertAdminProviderRequestForensicSafePayload({
      found: true,
      event: projected,
      matchingRowCount: 1,
      duplicateDetected: false,
    });
  });
});
