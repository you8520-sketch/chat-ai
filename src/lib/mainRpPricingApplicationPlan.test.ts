import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MainRpPricingCandidateRecord } from "@/lib/mainRpPricingProposal";
import {
  buildMainRpPricingApplicationPlanFromSnapshot,
  type MainRpPricingApplicationSnapshot,
} from "@/lib/mainRpPricingApplicationPlan";

function record(
  overrides: Partial<MainRpPricingCandidateRecord> = {}
): MainRpPricingCandidateRecord {
  return {
    id: 10,
    modelId: "gemini-3.7-flash",
    candidateFingerprint: "fp-current",
    candidateStatus: "READY",
    candidateDirection: "LOWER_TO_MARKET",
    reviewState: "APPROVED",
    basePricingVersion: 2,
    baseTargetMargin: 0.55,
    proposedTargetMargin: 0.5,
    minimumSafeTargetMargin: 0.45,
    maximumCompetitiveTargetMargin: 0.5,
    liveApplicability: "LIVE_PUBLISHED",
    productionBillingContract: "published_phase1_when_enabled",
    procurementFreshness: "FRESH",
    actualSignal: "CONFIRMS",
    actualMonthKey: "2026-09",
    actualMarginRate: 0.6,
    actualExact: true,
    hardBenchmarkCount: 2,
    evidence: {},
    firstObservedAt: "2026-09-23T00:00:00.000Z",
    lastObservedAt: "2026-09-23T00:00:00.000Z",
    lastObservationKey: "2026-09-23",
    observationCount: 1,
    reviewedAt: "2026-09-23T01:00:00.000Z",
    reviewedByUserId: 1,
    reviewNote: "",
    reviewEvidence: {
      candidate: {
        commercialPricingOwner: "target_margin",
        candidateTargetMargin: 0.5,
      },
    },
    supersededReason: null,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<MainRpPricingApplicationSnapshot> = {}
): MainRpPricingApplicationSnapshot {
  return {
    modelId: "gemini-3.7-flash",
    candidateFingerprint: "fp-current",
    pricingVersion: 2,
    publishedAt: "2026-09-20T00:00:00.000Z",
    currentTargetMargin: 0.55,
    commercialPricingOwner: "target_margin",
    liveApplicability: "LIVE_PUBLISHED",
    sitePromotionActive: false,
    officialPromotionCount: 0,
    representativeCurrentPoints: 60,
    representativeCandidatePoints: 55,
    representativeCandidateProjectedMargin: 0.58,
    marketCases: [
      {
        benchmarkId: "g37-a",
        competitorPoints: 55,
        currentPoints: 60,
        candidatePoints: 55,
        pass: true,
      },
    ],
    actualSignal: "CONFIRMS",
    ...overrides,
  };
}

describe("Phase B2E read-only pricing application plan", () => {
  it("READY plan describes only the canonical target-margin catalog delta", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record(),
      snapshot: snapshot(),
      latestRecordIdForModel: 10,
    });
    assert.equal(plan.status, "READY");
    assert.equal(plan.noMutation, true);
    assert.equal(plan.ownerModule, "src/lib/publishedModelPricing.ts");
    assert.equal(plan.currentPricingVersion, 2);
    assert.equal(plan.nextPricingVersion, 3);
    assert.equal(plan.currentTargetMargin, 0.55);
    assert.equal(plan.proposedTargetMargin, 0.5);
    assert.equal(plan.publishedAtInstruction, "SET_AT_APPLICATION_COMMIT");
    assert.equal(plan.preview.representativeCurrentPoints, 60);
    assert.equal(plan.preview.representativeCandidatePoints, 55);
  });

  it("non-approved records never produce an application-ready plan", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record({ reviewState: "OPEN" }),
      snapshot: snapshot(),
      latestRecordIdForModel: 10,
    });
    assert.equal(plan.status, "HOLD_NOT_APPROVED");
  });

  it("older APPROVED occurrence cannot become READY again after a newer occurrence exists", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record({ id: 10 }),
      snapshot: snapshot({ candidateFingerprint: "fp-current" }),
      latestRecordIdForModel: 12,
    });
    assert.equal(plan.status, "HOLD_NEWER_OCCURRENCE_EXISTS");
    assert.equal(plan.nextPricingVersion, null);
  });

  it("missing latest-occurrence context fails closed", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record(),
      snapshot: snapshot(),
      latestRecordIdForModel: null,
    });
    assert.equal(plan.status, "UNAVAILABLE");
  });

  it("missing immutable review evidence fails closed", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record({ reviewEvidence: null }),
      snapshot: snapshot(),
      latestRecordIdForModel: 10,
    });
    assert.equal(plan.status, "HOLD_MISSING_REVIEW_EVIDENCE");
  });

  it("review-time target mismatch fails closed", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record({
        reviewEvidence: {
          candidate: {
            commercialPricingOwner: "target_margin",
            candidateTargetMargin: 0.49,
          },
        },
      }),
      snapshot: snapshot(),
      latestRecordIdForModel: 10,
    });
    assert.equal(plan.status, "HOLD_REVIEW_EVIDENCE_MISMATCH");
  });

  it("Published base version or target change invalidates the plan", () => {
    assert.equal(
      buildMainRpPricingApplicationPlanFromSnapshot({
        record: record(),
        snapshot: snapshot({ pricingVersion: 3 }),
        latestRecordIdForModel: 10,
      }).status,
      "HOLD_PUBLISHED_BASE_CHANGED"
    );
    assert.equal(
      buildMainRpPricingApplicationPlanFromSnapshot({
        record: record(),
        snapshot: snapshot({ currentTargetMargin: 0.54 }),
        latestRecordIdForModel: 10,
      }).status,
      "HOLD_PUBLISHED_BASE_CHANGED"
    );
  });

  it("current candidate fingerprint change invalidates the plan", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record(),
      snapshot: snapshot({ candidateFingerprint: "fp-new" }),
      latestRecordIdForModel: 10,
    });
    assert.equal(plan.status, "HOLD_CANDIDATE_CHANGED");
  });

  it("commercial owner change fails closed", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record(),
      snapshot: snapshot({ commercialPricingOwner: "derived_reference_rates" }),
      latestRecordIdForModel: 10,
    });
    assert.equal(plan.status, "HOLD_COMMERCIAL_OWNER_CHANGED");
  });

  it("derived-reference-rate owner is never converted into a generic targetMargin change", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record({
        reviewEvidence: {
          candidate: {
            commercialPricingOwner: "derived_reference_rates",
            candidateTargetMargin: 0.5,
          },
        },
      }),
      snapshot: snapshot({ commercialPricingOwner: "derived_reference_rates" }),
      latestRecordIdForModel: 10,
    });
    assert.equal(plan.status, "HOLD_UNSUPPORTED_COMMERCIAL_OWNER");
    assert.equal(plan.ownerModule, null);
    assert.equal(plan.nextPricingVersion, null);
  });

  it("active site promotion blocks a base-price application plan", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record(),
      snapshot: snapshot({ sitePromotionActive: true }),
      latestRecordIdForModel: 10,
    });
    assert.equal(plan.status, "HOLD_SITE_PROMOTION_ACTIVE");
  });

  it("Published shadow-only contract cannot produce a live application plan", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record(),
      snapshot: snapshot({ liveApplicability: "PUBLISHED_SHADOW_ONLY" }),
      latestRecordIdForModel: 10,
    });
    assert.equal(plan.status, "HOLD_PUBLISHED_NOT_LIVE");
  });

  it("direct-selection-only remains READY but keeps the limited live scope", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record(),
      snapshot: snapshot({ liveApplicability: "DIRECT_SELECTION_ONLY" }),
      latestRecordIdForModel: 10,
    });
    assert.equal(plan.status, "READY");
    assert.equal(plan.liveScope, "DIRECT_SELECTION_ONLY");
  });

  it("equal current/proposed target produces no effective change", () => {
    const plan = buildMainRpPricingApplicationPlanFromSnapshot({
      record: record({
        baseTargetMargin: 0.5,
        proposedTargetMargin: 0.5,
      }),
      snapshot: snapshot({ currentTargetMargin: 0.5 }),
      latestRecordIdForModel: 10,
    });
    assert.equal(plan.status, "HOLD_NO_EFFECTIVE_CHANGE");
  });
});
