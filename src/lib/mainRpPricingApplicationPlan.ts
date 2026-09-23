/**
 * Phase B2E — read-only application plan for APPROVED pricing proposals.
 *
 * This module never mutates Published pricing. It converts an approved B2D record
 * plus the current B2C control-plane row into a fail-closed change plan.
 */

import type {
  CandidateLiveApplicability,
  PricingCandidateMarketCase,
} from "@/lib/mainRpPricingCandidateBand";
import type { MainRpPricingObservabilityRow } from "@/lib/mainRpPricingObservability";
import {
  buildMainRpPricingCandidateFingerprint,
  type MainRpPricingCandidateRecord,
} from "@/lib/mainRpPricingProposal";
import {
  resolvePublishedCommercialPricingOwner,
  resolvePublishedPricingExact,
  type PublishedCommercialPricingOwner,
} from "@/lib/publishedModelPricing";

export type MainRpPricingApplicationPlanStatus =
  | "READY"
  | "HOLD_NOT_APPROVED"
  | "HOLD_MISSING_REVIEW_EVIDENCE"
  | "HOLD_REVIEW_EVIDENCE_MISMATCH"
  | "HOLD_PUBLISHED_BASE_CHANGED"
  | "HOLD_CANDIDATE_CHANGED"
  | "HOLD_COMMERCIAL_OWNER_CHANGED"
  | "HOLD_UNSUPPORTED_COMMERCIAL_OWNER"
  | "HOLD_SITE_PROMOTION_ACTIVE"
  | "HOLD_PUBLISHED_NOT_LIVE"
  | "HOLD_NO_EFFECTIVE_CHANGE"
  | "UNAVAILABLE";

export type MainRpPricingApplicationSnapshot = {
  modelId: string;
  candidateFingerprint: string;
  pricingVersion: number;
  publishedAt: string;
  currentTargetMargin: number;
  commercialPricingOwner: PublishedCommercialPricingOwner;
  liveApplicability: CandidateLiveApplicability;
  sitePromotionActive: boolean;
  officialPromotionCount: number;
  representativeCurrentPoints: number | null;
  representativeCandidatePoints: number | null;
  representativeCandidateProjectedMargin: number | null;
  marketCases: PricingCandidateMarketCase[];
  actualSignal: MainRpPricingObservabilityRow["candidate"]["actual"]["signal"];
};

export type MainRpPricingApplicationPlan = {
  proposalId: number;
  modelId: string;
  status: MainRpPricingApplicationPlanStatus;
  noMutation: true;
  commercialPricingOwner: PublishedCommercialPricingOwner | null;
  liveScope: CandidateLiveApplicability | null;
  ownerModule: "src/lib/publishedModelPricing.ts" | null;
  currentPricingVersion: number | null;
  nextPricingVersion: number | null;
  currentTargetMargin: number | null;
  proposedTargetMargin: number | null;
  currentPublishedAt: string | null;
  publishedAtInstruction: "SET_AT_APPLICATION_COMMIT" | null;
  blockers: string[];
  preview: {
    representativeCurrentPoints: number | null;
    representativeCandidatePoints: number | null;
    representativeCandidateProjectedMargin: number | null;
    marketCases: PricingCandidateMarketCase[];
    actualSignal: MainRpPricingObservabilityRow["candidate"]["actual"]["signal"] | null;
    officialPromotionCount: number;
  };
};

type ReviewedCandidateEvidence = {
  commercialPricingOwner: PublishedCommercialPricingOwner;
  candidateTargetMargin: number;
};

function isPricingOwner(value: unknown): value is PublishedCommercialPricingOwner {
  return value === "target_margin" || value === "derived_reference_rates";
}

function readReviewedCandidateEvidence(
  evidence: Record<string, unknown> | null
): ReviewedCandidateEvidence | null {
  if (!evidence) return null;
  const candidate = evidence.candidate;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const object = candidate as Record<string, unknown>;
  if (!isPricingOwner(object.commercialPricingOwner)) return null;
  if (
    typeof object.candidateTargetMargin !== "number" ||
    !Number.isFinite(object.candidateTargetMargin)
  ) {
    return null;
  }
  return {
    commercialPricingOwner: object.commercialPricingOwner,
    candidateTargetMargin: object.candidateTargetMargin,
  };
}

function emptyPreview(): MainRpPricingApplicationPlan["preview"] {
  return {
    representativeCurrentPoints: null,
    representativeCandidatePoints: null,
    representativeCandidateProjectedMargin: null,
    marketCases: [],
    actualSignal: null,
    officialPromotionCount: 0,
  };
}

function holdPlan(params: {
  record: MainRpPricingCandidateRecord;
  status: Exclude<MainRpPricingApplicationPlanStatus, "READY">;
  blocker: string;
  snapshot?: MainRpPricingApplicationSnapshot | null;
}): MainRpPricingApplicationPlan {
  const snapshot = params.snapshot ?? null;
  return {
    proposalId: params.record.id,
    modelId: params.record.modelId,
    status: params.status,
    noMutation: true,
    commercialPricingOwner: snapshot?.commercialPricingOwner ?? null,
    liveScope: snapshot?.liveApplicability ?? null,
    ownerModule:
      snapshot?.commercialPricingOwner === "target_margin"
        ? "src/lib/publishedModelPricing.ts"
        : null,
    currentPricingVersion: snapshot?.pricingVersion ?? null,
    nextPricingVersion: null,
    currentTargetMargin: snapshot?.currentTargetMargin ?? null,
    proposedTargetMargin: params.record.proposedTargetMargin,
    currentPublishedAt: snapshot?.publishedAt ?? null,
    publishedAtInstruction: null,
    blockers: [params.blocker],
    preview: snapshot
      ? {
          representativeCurrentPoints: snapshot.representativeCurrentPoints,
          representativeCandidatePoints: snapshot.representativeCandidatePoints,
          representativeCandidateProjectedMargin:
            snapshot.representativeCandidateProjectedMargin,
          marketCases: snapshot.marketCases,
          actualSignal: snapshot.actualSignal,
          officialPromotionCount: snapshot.officialPromotionCount,
        }
      : emptyPreview(),
  };
}

export function buildMainRpPricingApplicationSnapshot(
  row: MainRpPricingObservabilityRow
): MainRpPricingApplicationSnapshot | null {
  const resolved = resolvePublishedPricingExact(row.modelId);
  if (!resolved) return null;
  return {
    modelId: row.modelId,
    candidateFingerprint: buildMainRpPricingCandidateFingerprint(row),
    pricingVersion: resolved.pricing.pricingVersion,
    publishedAt: resolved.pricing.publishedAt,
    currentTargetMargin: resolved.pricing.targetMargin,
    commercialPricingOwner: resolvePublishedCommercialPricingOwner(resolved.pricing),
    liveApplicability: row.candidate.liveApplicability,
    sitePromotionActive: row.promotion.sitePromotionActive,
    officialPromotionCount: row.promotion.officialPromotionCount,
    representativeCurrentPoints: row.candidate.representative.currentPoints,
    representativeCandidatePoints: row.candidate.representative.candidatePoints,
    representativeCandidateProjectedMargin:
      row.candidate.representative.candidateProjectedMargin,
    marketCases: row.candidate.market.cases,
    actualSignal: row.candidate.actual.signal,
  };
}

export function buildMainRpPricingApplicationPlanFromSnapshot(params: {
  record: MainRpPricingCandidateRecord;
  snapshot: MainRpPricingApplicationSnapshot | null;
}): MainRpPricingApplicationPlan {
  const { record, snapshot } = params;

  if (record.reviewState !== "APPROVED") {
    return holdPlan({
      record,
      status: "HOLD_NOT_APPROVED",
      blocker: "Only APPROVED B2D proposals can produce an application plan.",
      snapshot,
    });
  }

  const reviewed = readReviewedCandidateEvidence(record.reviewEvidence);
  if (!reviewed) {
    return holdPlan({
      record,
      status: "HOLD_MISSING_REVIEW_EVIDENCE",
      blocker: "Immutable review evidence is missing or lacks commercial-owner/target data.",
      snapshot,
    });
  }

  if (
    record.proposedTargetMargin == null ||
    !Number.isFinite(record.proposedTargetMargin) ||
    record.proposedTargetMargin < 0 ||
    record.proposedTargetMargin >= 1
  ) {
    return holdPlan({
      record,
      status: "UNAVAILABLE",
      blocker: "Approved proposal has no valid target-margin value.",
      snapshot,
    });
  }

  if (reviewed.candidateTargetMargin !== record.proposedTargetMargin) {
    return holdPlan({
      record,
      status: "HOLD_REVIEW_EVIDENCE_MISMATCH",
      blocker: "Review-time target does not match the stored proposal target.",
      snapshot,
    });
  }

  if (!snapshot) {
    return holdPlan({
      record,
      status: "UNAVAILABLE",
      blocker: "Current Main RP Published/candidate snapshot is unavailable.",
      snapshot,
    });
  }

  if (
    snapshot.pricingVersion !== record.basePricingVersion ||
    snapshot.currentTargetMargin !== record.baseTargetMargin
  ) {
    return holdPlan({
      record,
      status: "HOLD_PUBLISHED_BASE_CHANGED",
      blocker: "Current Published version/target no longer matches the approved base.",
      snapshot,
    });
  }

  if (snapshot.candidateFingerprint !== record.candidateFingerprint) {
    return holdPlan({
      record,
      status: "HOLD_CANDIDATE_CHANGED",
      blocker: "Current B2C candidate evidence no longer matches the approved candidate.",
      snapshot,
    });
  }

  if (reviewed.commercialPricingOwner !== snapshot.commercialPricingOwner) {
    return holdPlan({
      record,
      status: "HOLD_COMMERCIAL_OWNER_CHANGED",
      blocker: "Commercial pricing owner changed since review.",
      snapshot,
    });
  }

  if (snapshot.commercialPricingOwner !== "target_margin") {
    return holdPlan({
      record,
      status: "HOLD_UNSUPPORTED_COMMERCIAL_OWNER",
      blocker: "Generic B2E application planning supports only target_margin owners.",
      snapshot,
    });
  }

  if (snapshot.sitePromotionActive) {
    return holdPlan({
      record,
      status: "HOLD_SITE_PROMOTION_ACTIVE",
      blocker: "A live site promotion is active; base-price application must be reviewed outside the promotion window.",
      snapshot,
    });
  }

  if (snapshot.liveApplicability === "PUBLISHED_SHADOW_ONLY") {
    return holdPlan({
      record,
      status: "HOLD_PUBLISHED_NOT_LIVE",
      blocker: "Published pricing is not the current live user-charge path.",
      snapshot,
    });
  }

  if (record.proposedTargetMargin === snapshot.currentTargetMargin) {
    return holdPlan({
      record,
      status: "HOLD_NO_EFFECTIVE_CHANGE",
      blocker: "Approved target equals the current Published target.",
      snapshot,
    });
  }

  return {
    proposalId: record.id,
    modelId: record.modelId,
    status: "READY",
    noMutation: true,
    commercialPricingOwner: snapshot.commercialPricingOwner,
    liveScope: snapshot.liveApplicability,
    ownerModule: "src/lib/publishedModelPricing.ts",
    currentPricingVersion: snapshot.pricingVersion,
    nextPricingVersion: snapshot.pricingVersion + 1,
    currentTargetMargin: snapshot.currentTargetMargin,
    proposedTargetMargin: record.proposedTargetMargin,
    currentPublishedAt: snapshot.publishedAt,
    publishedAtInstruction: "SET_AT_APPLICATION_COMMIT",
    blockers: [],
    preview: {
      representativeCurrentPoints: snapshot.representativeCurrentPoints,
      representativeCandidatePoints: snapshot.representativeCandidatePoints,
      representativeCandidateProjectedMargin:
        snapshot.representativeCandidateProjectedMargin,
      marketCases: snapshot.marketCases,
      actualSignal: snapshot.actualSignal,
      officialPromotionCount: snapshot.officialPromotionCount,
    },
  };
}

export function buildMainRpPricingApplicationPlan(params: {
  record: MainRpPricingCandidateRecord;
  currentRow: MainRpPricingObservabilityRow | null;
}): MainRpPricingApplicationPlan {
  return buildMainRpPricingApplicationPlanFromSnapshot({
    record: params.record,
    snapshot: params.currentRow
      ? buildMainRpPricingApplicationSnapshot(params.currentRow)
      : null,
  });
}
