import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { it } from "node:test";
import {
  clearCheaperInferenceCatalogPricingForTest,
  listLatestCheaperInferenceCatalogSnapshot,
  replaceCheaperInferenceCatalogSnapshot,
  resolveCheaperInferenceCatalogPricing,
  updateCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import { ensureModelPricingTrackingSchema } from "@/lib/modelPricingTrackingSchema";
import {
  isProductKnownProviderModel,
  listProviderModelDiscoveries,
  observeProviderModelCatalog,
} from "@/lib/providerModelDiscovery";

function catalog(modelId: string, fetchedAt: number, output = 2): CheaperInferenceCatalogPricing {
  return {
    modelId,
    inputUsdPerMillion: 0.5,
    outputUsdPerMillion: output,
    cacheReadUsdPerMillion: 0.05,
    cacheWriteUsdPerMillion: 0.5,
    referenceInputUsdPerMillion: 1,
    referenceOutputUsdPerMillion: 4,
    discountPercent: 50,
    fetchedAt,
  };
}

function dbWithAttempt(runDateKey: string): { db: Database.Database; attemptId: number } {
  const db = new Database(":memory:");
  ensureModelPricingTrackingSchema(db);
  const result = db
    .prepare(
      `INSERT INTO model_pricing_tracker_attempts
       (run_date_key, phase, status, started_at)
       VALUES (?, 'OBSERVE_ONLY', 'running', ?)`
    )
    .run(runDateKey, `${runDateKey}T03:00:00.000Z`);
  return { db, attemptId: Number(result.lastInsertRowid) };
}

function addAttempt(db: Database.Database, runDateKey: string): number {
  const result = db
    .prepare(
      `INSERT INTO model_pricing_tracker_attempts
       (run_date_key, phase, status, started_at)
       VALUES (?, 'OBSERVE_ONLY', 'running', ?)`
    )
    .run(runDateKey, `${runDateKey}T03:00:00.000Z`);
  return Number(result.lastInsertRowid);
}

it("product-known includes published and background CI owners, not only Main RP", () => {
  assert.equal(isProductKnownProviderModel("deepseek-v4-pro-0813"), true);
  assert.equal(isProductKnownProviderModel("gpt-6-luna"), true);
  assert.equal(isProductKnownProviderModel("meta/muse-spark-1.1"), true);
  assert.equal(isProductKnownProviderModel("brand-new-rp-model-2026"), false);
});

it("first unknown provider model is discovered once and same-attempt replay is idempotent", () => {
  const { db, attemptId } = dbWithAttempt("2026-09-28");
  const rows = [
    catalog("deepseek-v4-pro-0813", Date.parse("2026-09-28T03:00:00Z")),
    catalog("gpt-6-luna", Date.parse("2026-09-28T03:00:00Z")),
    catalog("brand-new-rp-model-2026", Date.parse("2026-09-28T03:00:00Z")),
  ];

  const first = observeProviderModelCatalog({
    db,
    attemptId,
    runDateKey: "2026-09-28",
    catalog: rows,
  });
  assert.deepEqual(first, {
    observedUnknown: 1,
    newlyDiscoveredModelIds: ["brand-new-rp-model-2026"],
  });

  const replay = observeProviderModelCatalog({
    db,
    attemptId,
    runDateKey: "2026-09-28",
    catalog: rows,
  });
  assert.deepEqual(replay, { observedUnknown: 1, newlyDiscoveredModelIds: [] });

  const [saved] = listProviderModelDiscoveries(db, { unregisteredOnly: false });
  assert.equal(saved!.modelId, "brand-new-rp-model-2026");
  assert.equal(saved!.observationCount, 1);
  assert.equal(saved!.productRegisteredNow, false);
});

it("later observation updates latest rates without creating a second discovery", () => {
  const { db, attemptId } = dbWithAttempt("2026-09-28");
  observeProviderModelCatalog({
    db,
    attemptId,
    runDateKey: "2026-09-28",
    catalog: [catalog("brand-new-rp-model-2026", Date.parse("2026-09-28T03:00:00Z"), 2)],
  });

  const nextAttempt = addAttempt(db, "2026-09-29");
  const second = observeProviderModelCatalog({
    db,
    attemptId: nextAttempt,
    runDateKey: "2026-09-29",
    catalog: [catalog("brand-new-rp-model-2026", Date.parse("2026-09-29T03:00:00Z"), 3)],
  });
  assert.deepEqual(second, { observedUnknown: 1, newlyDiscoveredModelIds: [] });

  const [saved] = listProviderModelDiscoveries(db, { unregisteredOnly: false });
  assert.equal(saved!.observationCount, 2);
  assert.equal(saved!.outputUsdPerMillion, 3);
  assert.equal(saved!.firstSeenRunDateKey, "2026-09-28");
  assert.equal(saved!.lastSeenRunDateKey, "2026-09-29");
});

it("latest catalog inventory is exact while resilient per-model cache keeps older price lookups", () => {
  clearCheaperInferenceCatalogPricingForTest();
  const old = catalog("old-but-cached-model", 1);
  updateCheaperInferenceCatalogPricing(old);

  const fresh = catalog("fresh-model", 2);
  replaceCheaperInferenceCatalogSnapshot([fresh]);

  assert.deepEqual(
    listLatestCheaperInferenceCatalogSnapshot().map((row) => row.modelId),
    ["fresh-model"]
  );
  assert.equal(resolveCheaperInferenceCatalogPricing("old-but-cached-model")?.modelId, "old-but-cached-model");
  assert.equal(resolveCheaperInferenceCatalogPricing("fresh-model")?.modelId, "fresh-model");
  clearCheaperInferenceCatalogPricingForTest();
});
