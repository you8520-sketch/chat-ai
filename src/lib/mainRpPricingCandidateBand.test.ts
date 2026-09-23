import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  MAIN_RP_MODEL_IDS,
} from "@/lib/chatModels";
import { buildMainRpPricingObservabilityProjection } from "@/lib/mainRpPricingObservability";
import type { ActualProductionEconomicsObservation } from "@/lib/mainRpPricingActualEconomics";
import {
  composePricingCandidateObservation,
  decideSafeBand,
  projectedRepresentativeMargin,
  resolveActualCandidateSignal,
  resolveCandidateLiveApplicability,
  searchMaximumCompetitiveTargetMargin,
  searchMinimumSafeTargetMargin,
  type SafeBandDecisionInput,
} from "@/lib/mainRpPricingCandidateBand";
import { getMarketBenchmarks } from "@/lib/marketUsageBenchmarks";
import { ensureModelPricingTrackingSchema } from "@/lib/modelPricingTrackingSchema";
import {
  claimTrackerRun,
  finishTrackerRun,
  insertPriceSnapshot,
} from "@/lib/modelPricingTrackerPersistence";
import {
  getPublishedPricing,
  listExactPublishedCatalogEntries,
  resolvePublishedCommercialPricingOwner,
  resolvePublishedPricingExact,
  type PublishedModelPricing,
} from "@/lib/publishedModelPricing";
import { computePublishedUserChargeFromResolvedPolicy } from "@/lib/publishedUserCharge";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import { REPRESENTATIVE_TRACKER_WORKLOAD } from "@/lib/modelPricingTracker";

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

function freshBandInput(
  overrides: Partial<SafeBandDecisionInput>
): SafeBandDecisionInput {
  return {
    currentTargetMargin: 0.3,
    minimumMarginFloor: 0.1,
    minimumSafeTargetMargin: 0.2,
    maximumCompetitiveTargetMargin: 0.4,
    competitiveSearchStatus: "FOUND",
    procurementFreshness: "FRESH",
    hardBenchmarkCount: 1,
    representativeFloorPass: true,
    actualSignal: "NON_DECISIVE",
    ...overrides,
  };
}

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  ensureModelPricingTrackingSchema(db);
  return db;
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
    errorSummary: null,
  });
}

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

function snapshotCatalog(): Map<string, PublishedModelPricing> {
  return new Map(
    listExactPublishedCatalogEntries().map((entry) => [
      entry.canonicalModelId,
      { ...entry.pricing },
    ])
  );
}

function assertCatalogUnchanged(before: Map<string, PublishedModelPricing>): void {
  for (const entry of listExactPublishedCatalogEntries()) {
    const prior = before.get(entry.canonicalModelId);
    assert.ok(prior, entry.canonicalModelId);
    assert.deepEqual(entry.pricing, prior);
  }
}

describe("mainRpPricingCandidateBand — safe band decision matrix", () => {
  it("A — inside band → KEEP_CURRENT / 30%", () => {
    const decision = decideSafeBand(
      freshBandInput({
        currentTargetMargin: 0.3,
        minimumSafeTargetMargin: 0.2,
        maximumCompetitiveTargetMargin: 0.4,
      })
    );
    assert.equal(decision.status, "KEEP_CURRENT");
    assert.equal(decision.candidateDirection, "KEEP_CURRENT");
    assert.equal(decision.candidateTargetMargin, 0.3);
  });

  it("B — below floor band → RAISE_TO_FLOOR / 30%", () => {
    const decision = decideSafeBand(
      freshBandInput({
        currentTargetMargin: 0.2,
        minimumSafeTargetMargin: 0.3,
        maximumCompetitiveTargetMargin: 0.5,
      })
    );
    assert.equal(decision.status, "READY");
    assert.equal(decision.candidateDirection, "RAISE_TO_FLOOR");
    assert.equal(decision.candidateTargetMargin, 0.3);
  });

  it("C — above market ceiling → LOWER_TO_MARKET / 25%", () => {
    const decision = decideSafeBand(
      freshBandInput({
        currentTargetMargin: 0.4,
        minimumSafeTargetMargin: 0.1,
        maximumCompetitiveTargetMargin: 0.25,
      })
    );
    assert.equal(decision.status, "READY");
    assert.equal(decision.candidateDirection, "LOWER_TO_MARKET");
    assert.equal(decision.candidateTargetMargin, 0.25);
  });

  it("D — no feasible band → NO_FEASIBLE_PRICE / null", () => {
    const decision = decideSafeBand(
      freshBandInput({
        minimumSafeTargetMargin: 0.4,
        maximumCompetitiveTargetMargin: 0.3,
      })
    );
    assert.equal(decision.status, "NO_FEASIBLE_PRICE");
    assert.equal(decision.candidateTargetMargin, null);
    assert.equal(decision.candidateDirection, "HOLD");
  });

  it("E — hard market absent → HOLD_NO_HARD_MARKET_EVIDENCE", () => {
    const decision = decideSafeBand(
      freshBandInput({
        hardBenchmarkCount: 0,
        minimumSafeTargetMargin: 0.08,
      })
    );
    assert.equal(decision.status, "HOLD_NO_HARD_MARKET_EVIDENCE");
    assert.equal(decision.candidateTargetMargin, null);
  });

  it("F — procurement STALE → no actionable candidate", () => {
    const decision = decideSafeBand(
      freshBandInput({ procurementFreshness: "STALE" })
    );
    assert.equal(decision.status, "HOLD_PROCUREMENT_NOT_FRESH");
    assert.equal(decision.candidateTargetMargin, null);
  });

  it("G — procurement ABSENT → no actionable candidate", () => {
    const decision = decideSafeBand(
      freshBandInput({ procurementFreshness: "ABSENT" })
    );
    assert.equal(decision.status, "HOLD_PROCUREMENT_NOT_FRESH");
    assert.equal(decision.candidateTargetMargin, null);
  });

  it("I — exact actual confirms when margin >= floor", () => {
    const actual: ActualProductionEconomicsObservation = {
      domain: "ACTUAL_PRODUCTION",
      monthKey: "2026-09",
      usageState: "HAS_ACTIVITY",
      paidRevenueKrw: 1000,
      freePointSpend: 0,
      apiCostKrw: 400,
      netProfitKrw: 600,
      marginRate: 0.6,
      marginCoverage: "complete",
      realizedMarginExact: true,
      marginDisplay: "Realized margin 60.0%",
      financeModelKey: "gemini-3.7-flash",
      costEvidence: {
        sourceState: null,
        actualKrw: null,
        estimatedKrw: null,
        calls: null,
      },
    };
    assert.equal(resolveActualCandidateSignal(actual, 0.5), "CONFIRMS");
  });

  it("J — actual exact conflict → HOLD_ACTUAL_REPRESENTATIVE_CONFLICT", () => {
    const decision = decideSafeBand(
      freshBandInput({
        currentTargetMargin: 0.2,
        minimumSafeTargetMargin: 0.3,
        maximumCompetitiveTargetMargin: 0.5,
        representativeFloorPass: true,
        actualSignal: "CONFLICTS",
      })
    );
    assert.equal(decision.status, "HOLD_ACTUAL_REPRESENTATIVE_CONFLICT");
    assert.equal(decision.candidateTargetMargin, null);
    assert.equal(decision.candidateDirection, "HOLD");
  });

  it("K — actual partial → NON_DECISIVE", () => {
    const actual: ActualProductionEconomicsObservation = {
      domain: "ACTUAL_PRODUCTION",
      monthKey: "2026-09",
      usageState: "HAS_ACTIVITY",
      paidRevenueKrw: 1000,
      freePointSpend: 0,
      apiCostKrw: 400,
      netProfitKrw: null,
      marginRate: 0.4,
      marginCoverage: "partial",
      realizedMarginExact: false,
      marginDisplay: "partial",
      financeModelKey: "gemini-3.7-flash",
      costEvidence: {
        sourceState: "partial",
        actualKrw: 100,
        estimatedKrw: 300,
        calls: 5,
      },
    };
    assert.equal(resolveActualCandidateSignal(actual, 0.5), "NON_DECISIVE");
  });

  it("L — NO_USAGE → NO_USAGE signal", () => {
    const actual: ActualProductionEconomicsObservation = {
      domain: "ACTUAL_PRODUCTION",
      monthKey: "2026-09",
      usageState: "NO_USAGE",
      paidRevenueKrw: 0,
      freePointSpend: 0,
      apiCostKrw: 0,
      netProfitKrw: null,
      marginRate: null,
      marginCoverage: null,
      realizedMarginExact: false,
      marginDisplay: "NO_USAGE",
      financeModelKey: null,
      costEvidence: {
        sourceState: null,
        actualKrw: null,
        estimatedKrw: null,
        calls: null,
      },
    };
    assert.equal(resolveActualCandidateSignal(actual, 0.5), "NO_USAGE");
  });
});

describe("mainRpPricingCandidateBand — deterministic margin search", () => {
  it("minimum safe search uses published charge engine margin formula", () => {
    const resolved = resolvePublishedPricingExact(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL)!;
    const procurementCostKrw = 20;
    const minimumSafe = searchMinimumSafeTargetMargin({
      resolved,
      minimumMarginFloor: resolved.pricing.minimumMarginFloor,
      fxSnapshot: FX_FIXTURE,
      procurementCostKrw,
    });
    assert.ok(minimumSafe != null);
    const margin = projectedRepresentativeMargin({
      resolved,
      targetMargin: minimumSafe,
      fxSnapshot: FX_FIXTURE,
      procurementCostKrw,
    });
    assert.ok(margin != null && margin >= resolved.pricing.minimumMarginFloor);
    const oneBpLower = minimumSafe - 0.0001;
    if (oneBpLower >= resolved.pricing.minimumMarginFloor) {
      const lowerMargin = projectedRepresentativeMargin({
        resolved,
        targetMargin: oneBpLower,
        fxSnapshot: FX_FIXTURE,
        procurementCostKrw,
      });
      if (lowerMargin != null) {
        assert.ok(lowerMargin < resolved.pricing.minimumMarginFloor);
      }
    }
  });

  it("H — multiple benchmarks require ALL-PASS for maximum competitive margin", () => {
    const resolved = resolvePublishedPricingExact(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL)!;
    const benchmarks = getMarketBenchmarks(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    assert.equal(benchmarks.length, 2);
    const maximumSearch = searchMaximumCompetitiveTargetMargin({
      resolved,
      minimumMarginFloor: resolved.pricing.minimumMarginFloor,
      fxSnapshot: FX_FIXTURE,
      benchmarks,
    });
    assert.equal(maximumSearch.status, "FOUND");
    assert.ok(maximumSearch.targetMargin != null);
    const maximum = maximumSearch.targetMargin;
    for (const benchmark of benchmarks) {
      const usage = normalizeBillableUsage({
        modelId: resolved.requestedModelId,
        promptTokens: benchmark.inputTokens,
        outputTokens: benchmark.displayedOutputTokens,
      });
      const result = computePublishedUserChargeFromResolvedPolicy({
        requestedModelId: resolved.requestedModelId,
        resolvedPricing: {
          ...resolved,
          pricing: { ...resolved.pricing, targetMargin: maximum },
        },
        usage,
        usageCoverage: "complete",
        fxSnapshot: FX_FIXTURE,
        adjustment: { kind: "none" },
      });
      assert.equal(result.status, "complete");
      assert.ok(result.snapshot.finalPoints <= benchmark.competitorChargePoints);
    }
    const aboveMax = Math.min(0.9999, maximum + 0.0001);
    const failsSome = benchmarks.some((benchmark) => {
      const usage = normalizeBillableUsage({
        modelId: resolved.requestedModelId,
        promptTokens: benchmark.inputTokens,
        outputTokens: benchmark.displayedOutputTokens,
      });
      const result = computePublishedUserChargeFromResolvedPolicy({
        requestedModelId: resolved.requestedModelId,
        resolvedPricing: {
          ...resolved,
          pricing: { ...resolved.pricing, targetMargin: aboveMax },
        },
        usage,
        usageCoverage: "complete",
        fxSnapshot: FX_FIXTURE,
        adjustment: { kind: "none" },
      });
      return (
        result.status === "complete" &&
        result.snapshot.finalPoints > benchmark.competitorChargePoints
      );
    });
    assert.equal(failsSome, true);
  });

  it("D-real — compose reports NO_FEASIBLE_PRICE when minimum valid margin already loses hard market", () => {
    const highFx: BillingFxSnapshot = {
      mode: "daily_kst",
      dateKey: "2026-09-22",
      usdToKrw: 2500,
      effectiveKrwPerUsd: 2550,
      source: "api_daily",
      overseasFeeRate: 0.02,
      locked: true,
    };
    const resolved = resolvePublishedPricingExact(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL)!;
    const observation = composePricingCandidateObservation({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      fxSnapshot: highFx,
      procurement: {
        domain: "PROCUREMENT",
        ciInputUsdPerMillion: 0.2625,
        ciOutputUsdPerMillion: 1.3125,
        ciCacheReadUsdPerMillion: null,
        ciDiscountPercent: 30,
        ciObservedAt: NOW.toISOString(),
        ciFreshnessState: "FRESH",
        ciEvidenceSource: "persisted_tracker_completed",
        actualUpstreamBilledUsd: null,
        provenance: "CI_CURRENT_ESTIMATE",
        representativeProcurementCostKrw: 20,
      },
      representative: {
        domain: "REPRESENTATIVE",
        targetMargin: resolved.pricing.targetMargin,
        minimumMarginFloor: resolved.pricing.minimumMarginFloor,
        representativeMarginEstimate: 0.7,
        representativeMarginProvenance: "CI_CURRENT_ESTIMATE",
        representativeMarginRevenueUnit: "published_krw",
        trackerAlignedMarginEstimate: 0.7,
        status: "healthy",
        underlyingFloorVerdict: "healthy",
        procurementCostFreshness: "FRESH",
        trackerMarginFloorBreached: false,
        representativeWorkloadLabel: "10k/2k",
      },
      actual: {
        domain: "ACTUAL_PRODUCTION",
        monthKey: "2026-09",
        usageState: "NO_USAGE",
        paidRevenueKrw: 0,
        freePointSpend: 0,
        apiCostKrw: 0,
        netProfitKrw: null,
        marginRate: null,
        marginCoverage: null,
        realizedMarginExact: false,
        marginDisplay: "NO_USAGE",
        financeModelKey: null,
        costEvidence: {
          sourceState: null,
          actualKrw: null,
          estimatedKrw: null,
          calls: null,
        },
      },
      productionBillingContract: "published_phase1_capable_legacy_fallback",
    });

    assert.ok(observation.minimumSafeTargetMargin != null);
    assert.equal(observation.maximumCompetitiveTargetMargin, null);
    assert.equal(observation.status, "NO_FEASIBLE_PRICE");
    assert.equal(observation.candidateTargetMargin, null);
    assert.equal(observation.candidateDirection, "HOLD");
  });

  it("N — base_tier_only workload above tier blocks candidate charge", () => {
    const resolved = resolvePublishedPricingExact(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)!;
    const usage = normalizeBillableUsage({
      modelId: resolved.requestedModelId,
      promptTokens: 250_000,
      outputTokens: 2_000,
    });
    const result = computePublishedUserChargeFromResolvedPolicy({
      requestedModelId: resolved.requestedModelId,
      resolvedPricing: resolved,
      usage,
      usageCoverage: "complete",
      fxSnapshot: FX_FIXTURE,
      adjustment: { kind: "none" },
    });
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") {
      assert.equal(result.reason, "unsupported_pricing_tier");
    }
  });

  it("O — candidate charge equals canonical published charge engine output", () => {
    const resolved = resolvePublishedPricingExact(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL)!;
    const usage = normalizeBillableUsage({
      modelId: resolved.requestedModelId,
      promptTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
      outputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
    });
    const canonical = computePublishedUserChargeFromResolvedPolicy({
      requestedModelId: resolved.requestedModelId,
      resolvedPricing: resolved,
      usage,
      usageCoverage: "complete",
      fxSnapshot: FX_FIXTURE,
      adjustment: { kind: "none" },
    });
    const observation = composePricingCandidateObservation({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      fxSnapshot: FX_FIXTURE,
      procurement: {
        domain: "PROCUREMENT",
        ciInputUsdPerMillion: 0.2625,
        ciOutputUsdPerMillion: 1.3125,
        ciCacheReadUsdPerMillion: null,
        ciDiscountPercent: 30,
        ciObservedAt: NOW.toISOString(),
        ciFreshnessState: "FRESH",
        ciEvidenceSource: "persisted_tracker_completed",
        actualUpstreamBilledUsd: null,
        provenance: "CI_CURRENT_ESTIMATE",
        representativeProcurementCostKrw: 25,
      },
      representative: {
        domain: "REPRESENTATIVE",
        targetMargin: resolved.pricing.targetMargin,
        minimumMarginFloor: resolved.pricing.minimumMarginFloor,
        representativeMarginEstimate: 0.52,
        representativeMarginProvenance: "CI_CURRENT_ESTIMATE",
        representativeMarginRevenueUnit: "published_krw",
        trackerAlignedMarginEstimate: 0.52,
        status: "healthy",
        underlyingFloorVerdict: "healthy",
        procurementCostFreshness: "FRESH",
        trackerMarginFloorBreached: false,
        representativeWorkloadLabel: "10k/2k",
      },
      actual: {
        domain: "ACTUAL_PRODUCTION",
        monthKey: "2026-09",
        usageState: "NO_USAGE",
        paidRevenueKrw: 0,
        freePointSpend: 0,
        apiCostKrw: 0,
        netProfitKrw: null,
        marginRate: null,
        marginCoverage: null,
        realizedMarginExact: false,
        marginDisplay: "NO_USAGE",
        financeModelKey: null,
        costEvidence: {
          sourceState: null,
          actualKrw: null,
          estimatedKrw: null,
          calls: null,
        },
      },
      productionBillingContract: "published_phase1_capable_legacy_fallback",
    });
    assert.equal(canonical.status, "complete");
    assert.equal(observation.representative.currentPoints, canonical.snapshot.finalPoints);
    for (const marketCase of observation.market.cases) {
      const benchmark = getMarketBenchmarks(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL).find(
        (row) => row.id === marketCase.benchmarkId
      )!;
      const benchmarkUsage = normalizeBillableUsage({
        modelId: resolved.requestedModelId,
        promptTokens: benchmark.inputTokens,
        outputTokens: benchmark.displayedOutputTokens,
      });
      const benchmarkCanonical = computePublishedUserChargeFromResolvedPolicy({
        requestedModelId: resolved.requestedModelId,
        resolvedPricing: resolved,
        usage: benchmarkUsage,
        usageCoverage: "complete",
        fxSnapshot: FX_FIXTURE,
        adjustment: { kind: "none" },
      });
      assert.equal(benchmarkCanonical.status, "complete");
      assert.equal(marketCase.currentPoints, benchmarkCanonical.snapshot.finalPoints);
    }
  });
});

describe("mainRpPricingCandidateBand — integration", () => {
  it("projection includes CANDIDATE domain for all Main RP models", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const db = makeDb();
    insertCompletedCiSnapshot(db, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, "2026-09-22T03:00:00.000Z", {
      input: 0.2625,
      output: 1.3125,
      discount: 30,
    });
    updateCheaperInferenceCatalogPricing({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      inputUsdPerMillion: 0.2625,
      outputUsdPerMillion: 1.3125,
      discountPercent: 30,
      fetchedAt: Date.parse("2026-09-22T03:00:00.000Z"),
    });
    const projection = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
      db,
    });
    assert.equal(projection.models.length, MAIN_RP_MODEL_IDS.length);
    for (const row of projection.models) {
      assert.equal(row.candidate.domain, "CANDIDATE");
      assert.equal(row.candidate.currentTargetMargin, getPublishedPricing(row.modelId).targetMargin);
      assert.equal(
        row.candidate.commercialPricingOwner,
        row.modelId === CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL
          ? "derived_reference_rates"
          : "target_margin"
      );
    }
  });

  it("M — legacy live contract → PUBLISHED_SHADOW_ONLY", () => {
    clearCheaperInferenceCatalogPricingForTest();
    withBillingEnv({}, () => {
      const row = buildMainRpPricingObservabilityProjection({
        fxSnapshot: FX_FIXTURE,
        now: NOW,
      }).models.find((candidate) => candidate.modelId === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL)!;
      assert.equal(row.candidate.liveApplicability, "PUBLISHED_SHADOW_ONLY");
      assert.equal(
        resolveCandidateLiveApplicability(
          row.product.productionBillingContract
        ),
        "PUBLISHED_SHADOW_ONLY"
      );
    });
  });

  it("live applicability is derived only from canonical production billing contract", () => {
    assert.equal(resolveCandidateLiveApplicability("published_phase1_mandatory"), "LIVE_PUBLISHED");
    assert.equal(resolveCandidateLiveApplicability("published_phase1_when_enabled"), "LIVE_PUBLISHED");
    assert.equal(resolveCandidateLiveApplicability("published_phase2_when_direct_selected"), "DIRECT_SELECTION_ONLY");
    assert.equal(
      resolveCandidateLiveApplicability("published_phase1_capable_legacy_fallback"),
      "PUBLISHED_SHADOW_ONLY"
    );
    assert.equal(
      resolveCandidateLiveApplicability("published_phase2_capable_legacy_fallback"),
      "PUBLISHED_SHADOW_ONLY"
    );
    assert.equal(
      resolveCandidateLiveApplicability("legacy_proportional_ci_catalog"),
      "PUBLISHED_SHADOW_ONLY"
    );
  });

  it("Opus 5.5 derived-reference-rate owner cannot produce a targetMargin proposal", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const published = getPublishedPricing(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL);
    assert.equal(resolvePublishedCommercialPricingOwner(published), "derived_reference_rates");

    const row = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
    }).models.find(
      (candidate) => candidate.modelId === CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL
    )!;

    assert.equal(row.candidate.commercialPricingOwner, "derived_reference_rates");
    assert.equal(row.candidate.status, "HOLD_NON_TARGET_MARGIN_PRICING_OWNER");
    assert.equal(row.candidate.candidateDirection, "HOLD");
    assert.equal(row.candidate.candidateTargetMargin, null);
  });

  it("DeepSeek without hard benchmark → HOLD_NO_HARD_MARKET_EVIDENCE with floor diagnostic optional", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const db = makeDb();
    insertCompletedCiSnapshot(db, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, "2026-09-22T03:00:00.000Z", {
      input: 0.66,
      output: 1.98,
      discount: 50,
    });
    const row = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
      db,
    }).models.find((candidate) => candidate.modelId === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)!;
    assert.equal(row.candidate.market.hardBenchmarkCount, 0);
    assert.equal(row.candidate.status, "HOLD_NO_HARD_MARKET_EVIDENCE");
    assert.equal(row.candidate.candidateTargetMargin, null);
    assert.ok(row.candidate.minimumSafeTargetMargin != null);
  });

  it("Terra published anchor does not become hard comparable ceiling", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const db = makeDb();
    insertCompletedCiSnapshot(db, CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, "2026-09-22T03:00:00.000Z", {
      input: 1.4,
      output: 8.4,
      discount: 30,
    });
    const row = buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
      db,
    }).models.find((candidate) => candidate.modelId === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL)!;
    assert.equal(row.market.comparabilityStatus, "published_anchor");
    assert.equal(row.candidate.market.hardBenchmarkCount, 0);
    assert.equal(row.candidate.maximumCompetitiveTargetMargin, null);
    assert.equal(row.candidate.status, "HOLD_NO_HARD_MARKET_EVIDENCE");
  });

  it("P — candidate projection does not mutate published catalog", () => {
    const before = snapshotCatalog();
    clearCheaperInferenceCatalogPricingForTest();
    const db = makeDb();
    insertCompletedCiSnapshot(db, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, "2026-09-22T03:00:00.000Z", {
      input: 0.2625,
      output: 1.3125,
      discount: 30,
    });
    buildMainRpPricingObservabilityProjection({
      fxSnapshot: FX_FIXTURE,
      now: NOW,
      db,
    });
    assertCatalogUnchanged(before);
    for (const entry of listExactPublishedCatalogEntries()) {
      assert.equal(entry.pricing.targetMargin, before.get(entry.canonicalModelId)!.targetMargin);
      assert.equal(entry.pricing.pricingVersion, before.get(entry.canonicalModelId)!.pricingVersion);
      assert.equal(entry.pricing.publishedAt, before.get(entry.canonicalModelId)!.publishedAt);
    }
  });
});

describe("mainRpPricingCandidateBand — old calibration audit classification", () => {
  it("premiumPricingCalibration and gemini37PricingPolicy are not imported by B2C runtime", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./mainRpPricingCandidateBand.ts", import.meta.url), "utf8")
    );
    assert.doesNotMatch(source, /premiumPricingCalibration/);
    assert.doesNotMatch(source, /gemini37PricingPolicy/);
  });
});
