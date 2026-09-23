import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { ensureModelPricingTrackingSchema } from "@/lib/modelPricingTrackingSchema";
import type {
  MainRpPricingObservabilityProjection,
  MainRpPricingObservabilityRow,
} from "@/lib/mainRpPricingObservability";
import {
  buildMainRpPricingCandidateFingerprint,
  listMainRpPricingCandidateRecords,
  reviewMainRpPricingCandidateRecord,
  syncMainRpPricingCandidateRecords,
} from "@/lib/mainRpPricingProposal";
import { getPublishedPricing } from "@/lib/publishedModelPricing";

const MODEL = "gemini-3.7-flash";
const OBSERVED_1 = "2026-09-23T03:00:00.000Z";
const OBSERVED_2 = "2026-09-24T03:00:00.000Z";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  ensureModelPricingTrackingSchema(db);
  return db;
}

function makeRow(params?: {
  status?: MainRpPricingObservabilityRow["candidate"]["status"];
  direction?: MainRpPricingObservabilityRow["candidate"]["candidateDirection"];
  candidateTargetMargin?: number | null;
  minimumSafe?: number | null;
  maximumCompetitive?: number | null;
}): MainRpPricingObservabilityRow {
  const published = getPublishedPricing(MODEL);
  const status = params?.status ?? "READY";
  const direction = params?.direction ?? "LOWER_TO_MARKET";
  const candidateTargetMargin =
    params?.candidateTargetMargin === undefined ? 0.5 : params.candidateTargetMargin;
  return {
    modelId: MODEL,
    market: {
      domain: "MARKET",
      benchmarkId: "g37-a",
      competitorService: "fixture",
      inputTokens: 24_952,
      outputTokens: 2_367,
      outputChars: null,
      competitorPoints: 55,
      observedAt: null,
      sourceLabel: "fixture",
      comparabilityStatus: "hard_comparable",
      ourChargeAtBenchmarkPoints: 60,
      publishedChargeAtBenchmarkPoints: 60,
      ourProductionBillingBasis: "published",
      ourProductionBillingContract: "published_phase1_when_enabled",
      ourBenchmarkWorkloadLabel: "fixture",
      differenceVsBenchmarkPoints: 5,
      benchmarkAgeLabel: "UNKNOWN",
    },
    provider: {
      domain: "PROVIDER",
      officialInputUsdPerMillion: published.billingReferenceInputUsdPerMillion,
      officialOutputUsdPerMillion: published.billingReferenceOutputUsdPerMillion,
      officialCacheReadUsdPerMillion: published.billingReferenceCacheReadUsdPerMillion ?? null,
      pricingMode: "PROVIDER_STANDARD",
      observedAt: OBSERVED_1,
      sourceLabel: "fixture",
      evidenceStatus: "persisted_live",
    },
    procurement: {
      domain: "PROCUREMENT",
      ciInputUsdPerMillion: 0.2625,
      ciOutputUsdPerMillion: 1.3125,
      ciCacheReadUsdPerMillion: 0.03,
      ciDiscountPercent: 30,
      ciObservedAt: OBSERVED_1,
      ciFreshnessState: "FRESH",
      ciEvidenceSource: "persisted_tracker_completed",
      actualUpstreamBilledUsd: null,
      provenance: "CI_CURRENT_ESTIMATE",
      representativeProcurementCostKrw: 20,
    },
    product: {
      domain: "PRODUCT",
      publishedInputUsdPerMillion: published.billingReferenceInputUsdPerMillion,
      publishedOutputUsdPerMillion: published.billingReferenceOutputUsdPerMillion,
      publishedCacheReadUsdPerMillion: published.billingReferenceCacheReadUsdPerMillion ?? null,
      publishedCacheWriteUsdPerMillion: published.billingReferenceCacheWriteUsdPerMillion ?? null,
      pricingVersion: published.pricingVersion,
      publishedAt: published.publishedAt,
      productionBillingContract: "published_phase1_when_enabled",
      productionBillingContractNotes: null,
      representativePublishedChargePoints: 40,
      representativeLegacyChargePoints: 38,
      representativeProductionChargePoints: 40,
      representativeProductionChargeKrw: 40,
      representativeWorkloadLabel: "10000 prompt / 2000 output (uncached)",
    },
    promotion: {
      domain: "PROMOTION",
      sitePromotionActive: false,
      siteDiscountPercent: null,
      sitePromotionEndsAt: null,
      officialPromotionCount: 0,
      officialPromotionSummary: null,
    },
    representative: {
      domain: "REPRESENTATIVE",
      targetMargin: published.targetMargin,
      minimumMarginFloor: published.minimumMarginFloor,
      representativeMarginEstimate: 0.6,
      representativeMarginProvenance: "CI_CURRENT_ESTIMATE",
      representativeMarginRevenueUnit: "published_krw",
      trackerAlignedMarginEstimate: 0.6,
      status: "healthy",
      underlyingFloorVerdict: "healthy",
      procurementCostFreshness: "FRESH",
      trackerMarginFloorBreached: false,
      representativeWorkloadLabel: "10000 prompt / 2000 output (uncached)",
    },
    actual: {
      domain: "ACTUAL_PRODUCTION",
      monthKey: "2026-09",
      usageState: "HAS_ACTIVITY",
      paidRevenueKrw: 1000,
      freePointSpend: 0,
      apiCostKrw: 300,
      netProfitKrw: 700,
      marginRate: 0.7,
      marginCoverage: "complete",
      realizedMarginExact: true,
      marginDisplay: "70.0%",
      financeModelKey: MODEL,
      costEvidence: {
        sourceState: "exact",
        actualKrw: 300,
        estimatedKrw: 0,
        calls: 1,
      },
    },
    candidate: {
      domain: "CANDIDATE",
      status,
      currentTargetMargin: published.targetMargin,
      minimumSafeTargetMargin: params?.minimumSafe ?? published.minimumMarginFloor,
      maximumCompetitiveTargetMargin: params?.maximumCompetitive ?? 0.5,
      candidateTargetMargin,
      candidateDirection: direction,
      representative: {
        currentPoints: 60,
        candidatePoints: candidateTargetMargin == null ? null : 55,
        candidateProjectedMargin: candidateTargetMargin == null ? null : 0.6,
        floorPass: true,
      },
      market: {
        hardBenchmarkCount: 1,
        allPass: candidateTargetMargin == null ? null : true,
        cases: [{
          benchmarkId: "g37-a",
          competitorPoints: 55,
          currentPoints: 60,
          candidatePoints: candidateTargetMargin == null ? null : 55,
          pass: candidateTargetMargin == null ? null : true,
        }],
      },
      actual: {
        monthKey: "2026-09",
        marginRate: 0.7,
        exact: true,
        signal: "CONFIRMS",
      },
      procurementFreshness: "FRESH",
      liveApplicability: "LIVE_PUBLISHED",
      productionBillingContract: "published_phase1_when_enabled",
    },
  };
}

function projection(row: MainRpPricingObservabilityRow): MainRpPricingObservabilityProjection {
  return {
    generatedAt: OBSERVED_1,
    fxSnapshot: {
      mode: "daily_kst",
      dateKey: "2026-09-23",
      usdToKrw: 1500,
      effectiveKrwPerUsd: 1530,
      source: "api_daily",
      overseasFeeRate: 0.02,
      locked: true,
    },
    trackerPhase: "OBSERVE_ONLY",
    actualEconomicsMonthKey: "2026-09",
    financeGeneratedAt: OBSERVED_1,
    models: [row],
  };
}

describe("Phase B2D candidate history + review lifecycle", () => {
  it("READY candidate creates one OPEN proposal and identical observation refreshes it", () => {
    const db = makeDb();
    const row = makeRow();

    const first = syncMainRpPricingCandidateRecords(db, [row], OBSERVED_1, "2026-09-23");
    assert.deepEqual(first, { inserted: 1, refreshed: 0, superseded: 0, open: 1 });

    const sameDayRetry = syncMainRpPricingCandidateRecords(
      db,
      [row],
      "2026-09-23T04:00:00.000Z",
      "2026-09-23"
    );
    assert.deepEqual(sameDayRetry, { inserted: 0, refreshed: 1, superseded: 0, open: 1 });
    assert.equal(listMainRpPricingCandidateRecords(db)[0]!.observationCount, 1);

    const nextDay = syncMainRpPricingCandidateRecords(db, [row], OBSERVED_2, "2026-09-24");
    assert.deepEqual(nextDay, { inserted: 0, refreshed: 1, superseded: 0, open: 1 });

    const records = listMainRpPricingCandidateRecords(db);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.reviewState, "OPEN");
    assert.equal(records[0]!.observationCount, 2);
    assert.equal(records[0]!.lastObservationKey, "2026-09-24");
    assert.equal(records[0]!.lastObservedAt, OBSERVED_2);
  });

  it("candidate state change supersedes the previous OPEN and creates a new history row", () => {
    const db = makeDb();
    const firstRow = makeRow({ candidateTargetMargin: 0.5, maximumCompetitive: 0.5 });
    const secondRow = makeRow({ candidateTargetMargin: 0.48, maximumCompetitive: 0.48 });

    syncMainRpPricingCandidateRecords(db, [firstRow], OBSERVED_1, "2026-09-23");
    const result = syncMainRpPricingCandidateRecords(db, [secondRow], OBSERVED_2, "2026-09-24");
    assert.equal(result.superseded, 1);
    assert.equal(result.inserted, 1);
    assert.equal(result.open, 1);

    const records = listMainRpPricingCandidateRecords(db);
    assert.equal(records.length, 2);
    assert.equal(records[0]!.reviewState, "OPEN");
    assert.equal(records[0]!.proposedTargetMargin, 0.48);
    assert.equal(records[1]!.reviewState, "SUPERSEDED");
    assert.equal(records[1]!.supersededReason, "candidate_state_changed");
  });

  it("non-reviewable HOLD state closes OPEN proposal and is retained as NOT_REVIEWABLE history", () => {
    const db = makeDb();
    syncMainRpPricingCandidateRecords(db, [makeRow()], OBSERVED_1);

    const hold = makeRow({
      status: "HOLD_PROCUREMENT_NOT_FRESH",
      direction: "HOLD",
      candidateTargetMargin: null,
      minimumSafe: null,
    });
    const result = syncMainRpPricingCandidateRecords(db, [hold], OBSERVED_2, "2026-09-24");
    assert.equal(result.open, 0);

    const records = listMainRpPricingCandidateRecords(db);
    assert.equal(records[0]!.reviewState, "NOT_REVIEWABLE");
    assert.equal(records[0]!.candidateStatus, "HOLD_PROCUREMENT_NOT_FRESH");
    assert.equal(records[1]!.reviewState, "SUPERSEDED");
  });

  it("approval records review only and does not mutate published pricing", () => {
    const db = makeDb();
    const row = makeRow();
    const before = { ...getPublishedPricing(MODEL) };
    syncMainRpPricingCandidateRecords(db, [row], OBSERVED_1, "2026-09-23");
    const open = listMainRpPricingCandidateRecords(db)[0]!;

    const result = reviewMainRpPricingCandidateRecord({
      db,
      id: open.id,
      adminUserId: 99,
      action: "approve",
      note: "reviewed",
      currentProjection: projection(row),
      reviewedAt: OBSERVED_2,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.record.reviewState, "APPROVED");
    assert.equal(result.appliesPrice, false);
    assert.equal(result.record.reviewedByUserId, 99);
    assert.equal(result.record.reviewNote, "reviewed");
    assert.deepEqual(getPublishedPricing(MODEL), before);
  });

  it("stale candidate cannot be approved and is superseded", () => {
    const db = makeDb();
    const row = makeRow();
    syncMainRpPricingCandidateRecords(db, [row], OBSERVED_1, "2026-09-23");
    const open = listMainRpPricingCandidateRecords(db)[0]!;

    const changed = makeRow({ candidateTargetMargin: 0.48, maximumCompetitive: 0.48 });
    assert.notEqual(
      buildMainRpPricingCandidateFingerprint(changed),
      open.candidateFingerprint
    );

    const result = reviewMainRpPricingCandidateRecord({
      db,
      id: open.id,
      adminUserId: 99,
      action: "approve",
      currentProjection: projection(changed),
      reviewedAt: OBSERVED_2,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "STALE_CANDIDATE");
    assert.equal(listMainRpPricingCandidateRecords(db)[0]!.reviewState, "SUPERSEDED");
  });

  it("rejected identical candidate stays terminal instead of reopening every daily sync", () => {
    const db = makeDb();
    const row = makeRow();
    syncMainRpPricingCandidateRecords(db, [row], OBSERVED_1, "2026-09-23");
    const open = listMainRpPricingCandidateRecords(db)[0]!;

    const reviewed = reviewMainRpPricingCandidateRecord({
      db,
      id: open.id,
      adminUserId: 99,
      action: "reject",
      currentProjection: projection(row),
      reviewedAt: OBSERVED_1,
    });
    assert.equal(reviewed.ok, true);

    const sync = syncMainRpPricingCandidateRecords(db, [row], OBSERVED_2, "2026-09-24");
    assert.equal(sync.inserted, 0);
    assert.equal(sync.refreshed, 1);
    assert.equal(sync.open, 0);
    assert.equal(listMainRpPricingCandidateRecords(db).length, 1);
    assert.equal(listMainRpPricingCandidateRecords(db)[0]!.reviewState, "REJECTED");
  });
});
