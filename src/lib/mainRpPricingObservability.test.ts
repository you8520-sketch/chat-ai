import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  MAIN_RP_MODEL_IDS,
} from "@/lib/chatModels";
import {
  resetDeepSeekOfficialProviderPricingForTest,
  setDeepSeekOfficialPeakEvidenceForTest,
} from "@/lib/deepseekOfficialProviderPricing";
import {
  buildMainRpPricingObservabilityProjection,
  listMainRpObservabilityModelIds,
} from "@/lib/mainRpPricingObservability";
import { getMarketBenchmarks } from "@/lib/marketUsageBenchmarks";
import { ensureModelPricingTrackingSchema } from "@/lib/modelPricingTrackingSchema";
import { buildOfficialProviderPeakSnapshot } from "@/lib/modelPriceSnapshot";
import { REPRESENTATIVE_TRACKER_WORKLOAD } from "@/lib/modelPricingTracker";
import {
  claimTrackerRun,
  finishTrackerRun,
  insertPriceSnapshot,
} from "@/lib/modelPricingTrackerPersistence";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { computeOpenRouterTurnBilling } from "@/lib/pointsReasoningMargins";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";

const FX_FIXTURE: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-09-22",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

const NOW = new Date("2026-09-22T12:00:00.000Z");
const MAIN_RP_SET = new Set<string>(MAIN_RP_MODEL_IDS);

function withBillingEnv(
  env: { phase1?: string; phase2?: string },
  fn: () => void
): void {
  const savedPhase1 = process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
  const savedPhase2 = process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED;
  try {
    if (env.phase1 === undefined) delete process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
    else process.env.PHASE1_PUBLISHED_BILLING_ENABLED = env.phase1;
    if (env.phase2 === undefined) delete process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED;
    else process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED = env.phase2;
    fn();
  } finally {
    if (savedPhase1 === undefined) delete process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
    else process.env.PHASE1_PUBLISHED_BILLING_ENABLED = savedPhase1;
    if (savedPhase2 === undefined) delete process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED;
    else process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED = savedPhase2;
  }
}

function productionChargeAtBenchmark(
  modelId: string,
  promptTokens: number,
  outputTokens: number
): number {
  const phase1On = process.env.PHASE1_PUBLISHED_BILLING_ENABLED === "1" ||
    process.env.PHASE1_PUBLISHED_BILLING_ENABLED === "true";
  const phase2On = process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED === "1" ||
    process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED === "true";
  const phase1Models = new Set([
    CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  ]);
  const phase2Models = new Set([
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  ]);
  const usesPublished =
    (phase1Models.has(modelId) && phase1On) ||
    (phase2Models.has(modelId) && phase2On);
  return usesPublished
    ? (canonicalPublishedChargeAt(modelId, promptTokens, outputTokens) ?? 0)
    : canonicalLegacyChargeAt(modelId, promptTokens, outputTokens);
}

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  ensureModelPricingTrackingSchema(db);
  return db;
}

function seedCatalog(
  modelId: string,
  input: Partial<CheaperInferenceCatalogPricing> & {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
  }
): void {
  updateCheaperInferenceCatalogPricing({
    modelId,
    inputUsdPerMillion: input.inputUsdPerMillion,
    outputUsdPerMillion: input.outputUsdPerMillion,
    cacheReadUsdPerMillion: input.cacheReadUsdPerMillion ?? input.inputUsdPerMillion * 0.1,
    cacheWriteUsdPerMillion: input.cacheWriteUsdPerMillion ?? input.inputUsdPerMillion,
    referenceInputUsdPerMillion: input.referenceInputUsdPerMillion,
    referenceOutputUsdPerMillion: input.referenceOutputUsdPerMillion,
    discountPercent: input.discountPercent,
    fetchedAt: input.fetchedAt ?? Date.now(),
  });
}

function seedMainRpCatalogs(fetchedAt: number): void {
  clearCheaperInferenceCatalogPricingForTest();
  seedCatalog(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, {
    inputUsdPerMillion: 0.66,
    outputUsdPerMillion: 1.98,
    referenceInputUsdPerMillion: 1.32,
    referenceOutputUsdPerMillion: 3.96,
    discountPercent: 50,
    fetchedAt,
  });
  seedCatalog(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, {
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
    referenceInputUsdPerMillion: 0.3,
    referenceOutputUsdPerMillion: 1.2,
    discountPercent: 50,
    fetchedAt,
  });
  seedCatalog(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, {
    inputUsdPerMillion: 1.4,
    outputUsdPerMillion: 8.4,
    referenceInputUsdPerMillion: 2,
    referenceOutputUsdPerMillion: 12,
    discountPercent: 30,
    fetchedAt,
  });
  seedCatalog(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, {
    inputUsdPerMillion: 0.2625,
    outputUsdPerMillion: 1.3125,
    referenceInputUsdPerMillion: 0.375,
    referenceOutputUsdPerMillion: 1.875,
    discountPercent: 30,
    fetchedAt,
  });
  seedCatalog(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, {
    inputUsdPerMillion: 1.4,
    outputUsdPerMillion: 8.4,
    referenceInputUsdPerMillion: 2,
    referenceOutputUsdPerMillion: 12,
    discountPercent: 30,
    fetchedAt,
  });
}

function insertCompletedCiSnapshot(
  db: Database.Database,
  modelId: string,
  observedAt: string,
  rates: { input: number; output: number; discount?: number }
): void {
  const claim = claimTrackerRun(db, {
    runDateKey: observedAt.slice(0, 10),
    phase: "OBSERVE_ONLY",
    startedAt: observedAt,
  });
  insertPriceSnapshot(db, claim.attemptId, {
    provider: "cheaperinference",
    modelId,
    providerModelId: modelId,
    pricingMode: "procurement_current",
    sourceKind: "cheaper_inference_models_current",
    sourceUrl: "test://ci-current",
    rates: {
      inputUsdPerMillion: rates.input,
      outputUsdPerMillion: rates.output,
      cacheReadUsdPerMillion: rates.input * 0.1,
      cacheWriteUsdPerMillion: rates.input,
      tierThreshold: null,
      discountPercent: rates.discount ?? null,
    },
    rawFingerprint: `ci-${modelId}-${observedAt}`,
    observedAt,
    validFrom: null,
    validUntil: null,
  });
  finishTrackerRun(db, {
    attemptId: claim.attemptId,
    status: "completed",
    finishedAt: observedAt,
    errorSummary: "",
  });
}

function insertCompletedOfficialSnapshot(
  db: Database.Database,
  modelId: string,
  observedAt: string
): void {
  const claim = claimTrackerRun(db, {
    runDateKey: observedAt.slice(0, 10),
    phase: "OBSERVE_ONLY",
    startedAt: observedAt,
  });
  const snapshot = buildOfficialProviderPeakSnapshot({
    evidence: {
      provider: "deepseek",
      canonicalModelId: modelId,
      providerModelIdentity: modelId.includes("v4.1") ? "deepseek-flash" : "deepseek-v4-pro",
      providerVersionLabel: modelId.includes("v4.1") ? "DeepSeek-V4.1-Flash" : "DeepSeek-V4-Pro-0813",
      pricingMode: "provider_peak",
      inputUsdPerMillion: modelId.includes("v4.1") ? 0.3 : 1.32,
      outputUsdPerMillion: modelId.includes("v4.1") ? 1.2 : 3.96,
      cacheReadUsdPerMillion: modelId.includes("v4.1") ? 0.006 : 0.044,
      cacheWriteUsdPerMillion: null,
      observedAt,
      validFrom: null,
      validUntil: null,
      sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing/",
      rawFingerprint: `official-${modelId}`,
    },
  });
  insertPriceSnapshot(db, claim.attemptId, snapshot);
  finishTrackerRun(db, {
    attemptId: claim.attemptId,
    status: "completed",
    finishedAt: observedAt,
    errorSummary: "",
  });
}

function insertFailedOfficialSnapshot(db: Database.Database, modelId: string): void {
  const observedAt = "2026-09-22T06:00:00.000Z";
  const claim = claimTrackerRun(db, {
    runDateKey: "2026-09-22",
    phase: "OBSERVE_ONLY",
    startedAt: observedAt,
  });
  insertPriceSnapshot(db, claim.attemptId, {
    provider: "cheaperinference",
    modelId,
    providerModelId: modelId,
    pricingMode: "provider_peak",
    sourceKind: "official_provider_pricing",
    sourceUrl: "failed://should-not-show",
    rates: {
      inputUsdPerMillion: 9.99,
      outputUsdPerMillion: 9.99,
      cacheReadUsdPerMillion: null,
      cacheWriteUsdPerMillion: null,
      tierThreshold: null,
      discountPercent: null,
    },
    rawFingerprint: "failed-official",
    observedAt,
    validFrom: null,
    validUntil: null,
  });
  finishTrackerRun(db, {
    attemptId: claim.attemptId,
    status: "failed",
    finishedAt: observedAt,
    errorSummary: "official_provider_peak_evidence_missing",
  });
}

function canonicalPublishedChargeAt(
  modelId: string,
  promptTokens: number,
  outputTokens: number
): number | null {
  const result = computePublishedUserChargeWithSnapshot({
    modelId,
    usage: normalizeBillableUsage({ modelId, promptTokens, outputTokens }),
    usageCoverage: "complete",
    fxSnapshot: FX_FIXTURE,
    adjustment: { kind: "none" },
  });
  return result.status === "complete" ? result.snapshot.finalPoints : null;
}

function canonicalLegacyChargeAt(
  modelId: string,
  promptTokens: number,
  outputTokens: number
): number {
  return computeOpenRouterTurnBilling({
    modelId,
    inputTokens: promptTokens,
    outputTokens,
    apiPromptTokens: promptTokens,
    apiCompletionTokens: outputTokens,
  }).total;
}

describe("mainRpPricingObservability", () => {
  it("covers all five Main RP models with separated semantic domains", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));
    const projection = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
    });
    assert.equal(listMainRpObservabilityModelIds().length, 5);
    assert.equal(projection.models.length, 5);
    assert.equal("mainHead" in projection, false);
    for (const row of projection.models) {
      assert.ok(MAIN_RP_SET.has(row.modelId));
      assert.equal(row.market.domain, "MARKET");
      assert.equal(row.provider.domain, "PROVIDER");
      assert.equal(row.procurement.domain, "PROCUREMENT");
      assert.equal(row.product.domain, "PRODUCT");
    }
  });

  it("same-workload market comparability uses production contract charge owner", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));
    withBillingEnv({}, () => {
      const projection = buildMainRpPricingObservabilityProjection({
        fxSnapshot: FX_FIXTURE,
        now: NOW,
      });
      const g37Bench = getMarketBenchmarks(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL)[0];
      const g37 = projection.models.find((r) => r.modelId === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL)!;
      assert.equal(g37.market.comparabilityStatus, "hard_comparable");
      assert.equal(g37.market.inputTokens, 24_952);
      assert.equal(g37.market.outputTokens, 2_367);
      assert.equal(g37.market.ourProductionBillingBasis, "legacy");
      const expectedG37 = productionChargeAtBenchmark(
        CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        g37Bench.inputTokens,
        g37Bench.displayedOutputTokens
      );
      assert.equal(g37.market.ourChargeAtBenchmarkPoints, expectedG37);
      assert.notEqual(g37.market.publishedChargeAtBenchmarkPoints, null);
      assert.notEqual(
        g37.market.publishedChargeAtBenchmarkPoints,
        g37.market.ourChargeAtBenchmarkPoints
      );
      assert.equal(
        g37.market.differenceVsBenchmarkPoints,
        expectedG37 - g37Bench.competitorChargePoints
      );

      const g31Bench = getMarketBenchmarks(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)[0];
      const g31 = projection.models.find((r) => r.modelId === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)!;
      assert.equal(g31.market.inputTokens, 40_689);
      assert.equal(g31.market.outputTokens, 4_307);
      assert.equal(g31.market.ourProductionBillingBasis, "legacy");
      const expectedG31 = productionChargeAtBenchmark(
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        g31Bench.inputTokens,
        g31Bench.displayedOutputTokens
      );
      assert.equal(g31.market.ourChargeAtBenchmarkPoints, expectedG31);
      assert.equal(
        g31.market.differenceVsBenchmarkPoints,
        expectedG31 - g31Bench.competitorChargePoints
      );
    });
  });

  it("Phase1 gate toggles MARKET our @ benchmark between published and legacy", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));
    const g31Bench = getMarketBenchmarks(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)[0];

    withBillingEnv({}, () => {
      const off = buildMainRpPricingObservabilityProjection({
        fxSnapshot: FX_FIXTURE,
        now: NOW,
      }).models.find((r) => r.modelId === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)!;
      assert.equal(off.market.ourProductionBillingBasis, "legacy");
      assert.equal(
        off.market.ourChargeAtBenchmarkPoints,
        canonicalLegacyChargeAt(
          CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          g31Bench.inputTokens,
          g31Bench.displayedOutputTokens
        )
      );
      assert.equal(off.product.productionBillingContract, "published_phase1_capable_legacy_fallback");
    });

    withBillingEnv({ phase1: "1" }, () => {
      const on = buildMainRpPricingObservabilityProjection({
        fxSnapshot: FX_FIXTURE,
        now: NOW,
      }).models.find((r) => r.modelId === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)!;
      assert.equal(on.market.ourProductionBillingBasis, "published");
      assert.equal(
        on.market.ourChargeAtBenchmarkPoints,
        canonicalPublishedChargeAt(
          CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
          g31Bench.inputTokens,
          g31Bench.displayedOutputTokens
        )
      );
      assert.equal(on.product.productionBillingContract, "published_phase1_when_enabled");
    });
  });

  it("Phase2 gate toggles DeepSeek production contract in MARKET metadata", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));

    withBillingEnv({}, () => {
      const off = buildMainRpPricingObservabilityProjection({
        fxSnapshot: FX_FIXTURE,
        now: NOW,
      }).models.find((r) => r.modelId === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)!;
      assert.equal(off.market.ourProductionBillingBasis, "legacy");
      assert.equal(off.product.productionBillingContract, "published_phase2_capable_legacy_fallback");
      assert.equal(
        off.product.representativeProductionChargePoints,
        off.product.representativeLegacyChargePoints
      );
    });

    withBillingEnv({ phase2: "1" }, () => {
      const on = buildMainRpPricingObservabilityProjection({
        fxSnapshot: FX_FIXTURE,
        now: NOW,
      }).models.find((r) => r.modelId === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)!;
      assert.equal(on.market.ourProductionBillingBasis, "published");
      assert.equal(on.product.productionBillingContract, "published_phase2_when_direct_selected");
      assert.equal(
        on.product.representativeProductionChargePoints,
        on.product.representativePublishedChargePoints
      );
    });
  });

  it("published anchor (Terra) has no arbitrary token delta", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));
    const projection = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
    });
    const terra = projection.models.find((r) => r.modelId === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL)!;
    assert.equal(terra.market.comparabilityStatus, "published_anchor");
    assert.equal(terra.market.differenceVsBenchmarkPoints, null);
    assert.equal(terra.market.ourChargeAtBenchmarkPoints, null);
  });

  it("DeepSeek without token benchmark is absent — not hard_comparable", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));
    const projection = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
    });
    const deepseek = projection.models.find((r) => r.modelId === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)!;
    assert.equal(deepseek.market.comparabilityStatus, "absent");
    assert.equal(deepseek.market.differenceVsBenchmarkPoints, null);
  });

  it("persisted official DeepSeek evidence survives adapter cache clear", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));
    const db = makeDb();
    insertCompletedOfficialSnapshot(
      db,
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      "2026-09-22T03:00:00.000Z"
    );
    resetDeepSeekOfficialProviderPricingForTest();
    const projection = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
      db,
    });
    const deepseek = projection.models.find((r) => r.modelId === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)!;
    assert.equal(deepseek.provider.evidenceStatus, "persisted_live");
    assert.equal(deepseek.provider.officialInputUsdPerMillion, 1.32);
    assert.equal(deepseek.provider.officialOutputUsdPerMillion, 3.96);
  });

  it("failed official attempt snapshot is excluded from provider truth", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));
    const db = makeDb();
    insertCompletedOfficialSnapshot(
      db,
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      "2026-09-21T03:00:00.000Z"
    );
    insertFailedOfficialSnapshot(db, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    resetDeepSeekOfficialProviderPricingForTest();
    const projection = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
      db,
    });
    const deepseek = projection.models.find((r) => r.modelId === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)!;
    assert.equal(deepseek.provider.evidenceStatus, "persisted_live");
    assert.equal(deepseek.provider.officialInputUsdPerMillion, 1.32);
    assert.notEqual(deepseek.provider.officialInputUsdPerMillion, 9.99);
  });

  it("procurement freshness: FRESH vs STALE vs ABSENT", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const db = makeDb();
    insertCompletedCiSnapshot(db, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, "2026-09-22T03:00:00.000Z", {
      input: 0.2625,
      output: 1.3125,
      discount: 30,
    });
    const fresh = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
      db,
    }).models.find((r) => r.modelId === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL)!;
    assert.equal(fresh.procurement.ciFreshnessState, "FRESH");
    assert.equal(fresh.procurement.ciEvidenceSource, "persisted_tracker_completed");

    insertCompletedCiSnapshot(db, CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, "2026-09-20T03:00:00.000Z", {
      input: 1.4,
      output: 8.4,
      discount: 30,
    });
    const stale = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
      db,
    }).models.find((r) => r.modelId === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)!;
    assert.equal(stale.procurement.ciFreshnessState, "STALE");

    seedCatalog(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, {
      inputUsdPerMillion: 1.4,
      outputUsdPerMillion: 8.4,
      fetchedAt: Date.parse("2026-09-22T03:00:00.000Z"),
    });
    const cacheFallbackDb = makeDb();
    const cacheFallback = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
      db: cacheFallbackDb,
    }).models.find((r) => r.modelId === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL)!;
    assert.equal(cacheFallback.procurement.ciFreshnessState, "STALE");
    assert.equal(cacheFallback.procurement.ciEvidenceSource, "live_catalog_cache");
    assert.equal(cacheFallback.procurement.provenance, "CI_STALE_ESTIMATE");
  });

  it("procurement ABSENT when no persisted snapshot and no live catalog", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const db = makeDb();
    const absent = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
      db,
    }).models.find((r) => r.modelId === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL)!;
    assert.equal(absent.procurement.ciFreshnessState, "ABSENT");
    assert.equal(absent.procurement.ciEvidenceSource, "none");
    assert.equal(absent.procurement.provenance, "UNKNOWN");
    assert.equal(absent.procurement.representativeProcurementCostKrw, null);
    assert.equal(absent.representative.procurementCostFreshness, "ABSENT");
    assert.equal(absent.representative.status, "unavailable");
  });

  it("stale procurement prevents unqualified healthy/below-floor margin status", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const db = makeDb();
    insertCompletedCiSnapshot(db, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, "2026-09-20T03:00:00.000Z", {
      input: 0.5,
      output: 2.5,
      discount: 10,
    });
    const row = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
      db,
    }).models.find((r) => r.modelId === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL)!;
    assert.equal(row.procurement.ciFreshnessState, "STALE");
    assert.equal(row.procurement.provenance, "CI_STALE_ESTIMATE");
    assert.equal(row.representative.procurementCostFreshness, "STALE");
    assert.notEqual(row.representative.status, "healthy");
    assert.notEqual(row.representative.status, "below_floor");
    assert.equal(row.representative.status, "unavailable");
    assert.ok(
      row.representative.underlyingFloorVerdict != null ||
        row.representative.trackerAlignedMarginEstimate != null
    );
  });

  it("Gemini models show historical_evidence provider status — not live observer", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));
    const projection = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
    });
    const g31 = projection.models.find((r) => r.modelId === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)!;
    const g37 = projection.models.find((r) => r.modelId === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL)!;
    assert.equal(g31.provider.evidenceStatus, "historical_evidence");
    assert.equal(g37.provider.evidenceStatus, "historical_evidence");
  });

  it("5-model billing parity — projection does not mutate canonical charge owners", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));
    const before = new Map<string, { published: unknown; legacy: number; version: number }>();
    for (const modelId of MAIN_RP_MODEL_IDS) {
      const usage = normalizeBillableUsage({
        modelId,
        promptTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
        outputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
      });
      before.set(modelId, {
        published: computePublishedUserChargeWithSnapshot({
          modelId,
          usage,
          usageCoverage: "complete",
          fxSnapshot: FX_FIXTURE,
          adjustment: { kind: "none" },
        }),
        legacy: canonicalLegacyChargeAt(
          modelId,
          REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
          REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens
        ),
        version: getPublishedPricing(modelId).pricingVersion,
      });
    }

    buildMainRpPricingObservabilityProjection({ fxSnapshot: FX_FIXTURE, now: NOW });

    for (const modelId of MAIN_RP_MODEL_IDS) {
      const usage = normalizeBillableUsage({
        modelId,
        promptTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
        outputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
      });
      const publishedAfter = computePublishedUserChargeWithSnapshot({
        modelId,
        usage,
        usageCoverage: "complete",
        fxSnapshot: FX_FIXTURE,
        adjustment: { kind: "none" },
      });
      const legacyAfter = canonicalLegacyChargeAt(
        modelId,
        REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
        REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens
      );
      const prev = before.get(modelId)!;
      assert.deepEqual(publishedAfter, prev.published);
      assert.equal(legacyAfter, prev.legacy);
      assert.equal(getPublishedPricing(modelId).pricingVersion, prev.version);
    }
  });

  it("adapter cache without DB is supplemental only", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));
    setDeepSeekOfficialPeakEvidenceForTest([
      {
        provider: "deepseek",
        canonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        providerModelIdentity: "deepseek-v4-pro",
        providerVersionLabel: "DeepSeek-V4-Pro-0813",
        pricingMode: "provider_peak",
        inputUsdPerMillion: 1.32,
        outputUsdPerMillion: 3.96,
        cacheReadUsdPerMillion: 0.044,
        cacheWriteUsdPerMillion: null,
        observedAt: "2026-09-22T03:00:00.000Z",
        validFrom: null,
        validUntil: null,
        sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing/",
        rawFingerprint: "cache-only",
      },
    ]);
    const projection = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
    });
    const deepseek = projection.models.find((r) => r.modelId === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)!;
    assert.equal(deepseek.provider.evidenceStatus, "live_cached_supplemental");
    resetDeepSeekOfficialProviderPricingForTest();
  });

  it("Gemini 3.7 includes margin-floor root-cause investigation report", () => {
    seedMainRpCatalogs(Date.parse("2026-09-22T03:00:00.000Z"));
    const projection = buildMainRpPricingObservabilityProjection({ fxSnapshot: FX_FIXTURE, now: NOW });
    const g37 = projection.models.find((r) => r.modelId === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.ok(g37?.gemini37RootCause);
    assert.equal(typeof g37.gemini37RootCause.observedMarginFloorBreach, "boolean");
  });
});
