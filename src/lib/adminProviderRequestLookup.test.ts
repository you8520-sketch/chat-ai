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
    assert.equal(result.providerRequestId, requestId);
    assert.equal(result.requestKind, "background-prompt-translation");
    assert.equal(result.canonicalOwner, "OTHER_ASYNC");
    assert.equal(result.assistantMessageId, null);
    assert.equal(result.turnLinked, false);
    assert.equal(result.inputTokens, 8553);
    assert.equal(result.outputTokens, 1655);
    assert.ok(Math.abs((result.actualCostUsd ?? 0) - 0.0017) < 1e-9);
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
    assert.equal(result.assistantMessageId, 4022);
    assert.equal(result.generationSequence, 1);
    assert.equal(result.turnLinked, true);
    assert.equal(result.costAttribution, "whole_turn");
    assert.equal(result.canonicalOwner, "STATUS_WIDGET");
  });

  it("does not aggregate duplicate lookup into summed cost", () => {
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
    assert.ok(Math.abs((result.actualCostUsd ?? 0) - 0.001) < 1e-9);
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
    assertAdminProviderRequestForensicSafePayload({ found: true, event: projected });
  });
});
