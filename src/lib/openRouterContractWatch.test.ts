import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  buildOpenRouterContractWatchProjection,
  OPENROUTER_CONTRACT_REVIEW_MONTHLY_USD,
} from "@/lib/openRouterContractWatch";
import {
  ensureProviderCostLedgerSchema,
  recordBackgroundProviderCost,
} from "@/lib/providerCostLedger";

const NOW = new Date("2026-09-28T09:00:00.000Z");

function db(): Database.Database {
  const value = new Database(":memory:");
  ensureProviderCostLedgerSchema(value);
  return value;
}

function addExact(
  database: Database.Database,
  input: {
    id: string;
    usd: number;
    center: "chat_turn" | "memory" | "status_widget" | "image" | "other";
    provider?: string;
    createdAt?: string;
  }
) {
  recordBackgroundProviderCost(
    {
      provider: input.provider ?? "cheaperinference",
      model: "fixture-model",
      requestKind: "contract-watch-fixture",
      costCenter: input.center,
      providerRequestId: input.id,
      inputTokens: 1000,
      outputTokens: 500,
      cheaperInferenceBilledCostUsd:
        (input.provider ?? "cheaperinference") === "cheaperinference"
          ? input.usd
          : undefined,
      upstreamCostUsd:
        (input.provider ?? "cheaperinference") === "openrouter"
          ? input.usd
          : undefined,
      usageEstimated: false,
      outcome: "success",
      persistInTests: true,
    },
    database
  );
  database
    .prepare("UPDATE api_cost_ledger SET created_at=? WHERE provider_request_id=?")
    .run(input.createdAt ?? "2026-09-20 12:00:00", input.id);
}

describe("OpenRouter contract review watch", () => {
  it("uses settled exact addressable spend and triggers only at the internal marker", () => {
    const database = db();
    addExact(database, { id: "a", usd: 12_500, center: "chat_turn" });
    addExact(database, { id: "b", usd: 12_500, center: "memory" });

    const projection = buildOpenRouterContractWatchProjection(database, NOW);
    assert.equal(projection.reviewMarkerUsd, OPENROUTER_CONTRACT_REVIEW_MONTHLY_USD);
    assert.equal(projection.settledExactUsd, 25_000);
    assert.equal(projection.status, "QUOTE_REVIEW");
    assert.equal(projection.quoteReviewRecommended, true);
    assert.equal(projection.exactCallCount, 2);
    assert.equal(projection.inexactCallCount, 0);
    assert.equal(projection.reviewMarkerKind, "internal_policy");
    assert.match(projection.note, /does not assert OpenRouter Enterprise eligibility/i);
    database.close();
  });

  it("excludes image/unknown, unsupported providers, and rows outside the rolling window", () => {
    const database = db();
    addExact(database, { id: "chat", usd: 9_000, center: "chat_turn" });
    addExact(database, { id: "image", usd: 30_000, center: "image" });
    addExact(database, { id: "other", usd: 30_000, center: "other" });
    addExact(database, {
      id: "foreign",
      usd: 30_000,
      center: "chat_turn",
      provider: "some-direct-provider",
    });
    addExact(database, {
      id: "old",
      usd: 30_000,
      center: "chat_turn",
      createdAt: "2026-08-01 00:00:00",
    });

    const projection = buildOpenRouterContractWatchProjection(database, NOW);
    assert.equal(projection.settledExactUsd, 9_000);
    assert.equal(projection.status, "BELOW_REVIEW_MARKER");
    assert.deepEqual(projection.providers, ["cheaperinference"]);
    assert.deepEqual(projection.costCenters, ["chat_turn"]);
    database.close();
  });

  it("never promotes inexact estimates into settled spend", () => {
    const database = db();
    recordBackgroundProviderCost(
      {
        provider: "cheaperinference",
        model: "fixture-model",
        requestKind: "contract-watch-inexact",
        costCenter: "chat_turn",
        providerRequestId: "inexact",
        inputTokens: 50_000_000,
        outputTokens: 50_000_000,
        outcome: "success",
        persistInTests: true,
      },
      database
    );
    database
      .prepare("UPDATE api_cost_ledger SET created_at='2026-09-20 12:00:00' WHERE provider_request_id='inexact'")
      .run();

    const projection = buildOpenRouterContractWatchProjection(database, NOW, {
      reviewMarkerUsd: 1,
    });
    assert.equal(projection.settledExactUsd, 0);
    assert.equal(projection.quoteReviewRecommended, false);
    assert.equal(projection.exactCallCount, 0);
    assert.equal(projection.inexactCallCount, 1);
    assert.equal(projection.exactCallCoverageRatio, 0);
    database.close();
  });

  it("accepts OpenRouter provider-reported exact settlement without treating it as direct pricing evidence", () => {
    const database = db();
    addExact(database, {
      id: "or",
      usd: 30_000,
      center: "trpg",
      provider: "openrouter",
    });
    const projection = buildOpenRouterContractWatchProjection(database, NOW);
    assert.equal(projection.status, "QUOTE_REVIEW");
    assert.deepEqual(projection.providers, ["openrouter"]);
    assert.match(projection.note, /direct-contract price/i);
    database.close();
  });
});
