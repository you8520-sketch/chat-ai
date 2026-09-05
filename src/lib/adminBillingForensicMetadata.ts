import "server-only";

import type { FinalChargeConsistencySnapshot } from "@/lib/chatBillingFinalCharge";
import {
  evaluateFinalChargeConsistency,
  sumDeductionSliceTotals,
} from "@/lib/chatBillingFinalCharge";
import { parseDeductionSlicesJson } from "@/lib/chatBillingSettlement";
import type { Usage } from "@/lib/chatUsage";
import type { DeductionSlice } from "@/lib/points";
import type {
  AdminBillingForensicFxEvidence,
  AdminBillingForensicMetadata,
} from "@/lib/adminBillingForensicMetadataShared";
import type { StoredTurnChargeEvidence } from "@/lib/storedTurnChargeEvidenceShared";

export type {
  AdminBillingForensicFxEvidence,
  AdminBillingForensicMetadata,
} from "@/lib/adminBillingForensicMetadataShared";

function resolveStoredFxEvidence(usage: Usage): AdminBillingForensicFxEvidence {
  const shadowFx = usage.shadowPricing?.fxSnapshot;
  if (shadowFx) {
    return {
      available: true,
      dateKey: shadowFx.dateKey,
      source: shadowFx.source,
      baseUsdKrw: shadowFx.baseUsdKrw,
      overseasFeeRate: shadowFx.overseasFeeRate,
      effectiveKrwPerUsd: shadowFx.effectiveKrwPerUsd,
      locked: usage.exchangeRateMode === "daily_kst" ? true : null,
    };
  }

  if (
    usage.exchangeRateDateKey &&
    usage.exchangeRateKrwPerUsd != null &&
    Number.isFinite(usage.exchangeRateKrwPerUsd)
  ) {
    return {
      available: true,
      dateKey: usage.exchangeRateDateKey,
      source: usage.exchangeRateSource ?? "unknown",
      baseUsdKrw: null,
      overseasFeeRate: null,
      effectiveKrwPerUsd: usage.exchangeRateKrwPerUsd,
      locked: usage.exchangeRateMode === "daily_kst" ? true : null,
    };
  }

  return { available: false, status: "UNAVAILABLE" };
}

function parseStoredDeductionSlices(raw: string | null): DeductionSlice[] {
  if (!raw?.trim()) return [];
  return parseDeductionSlicesJson(raw) ?? [];
}

/** Read-only forensic projection from persisted message billing fields. */
export function buildAdminBillingForensicMetadata(input: {
  assistantMessageId: number;
  chatId: number;
  requestId: string | null;
  usage: Usage | null;
  deductionSlicesRaw: string | null;
  generationStatus?: string | null;
  chargeEvidence?: StoredTurnChargeEvidence;
}): AdminBillingForensicMetadata {
  const usage = input.usage;
  const dispatch = usage?.billingContractDispatch;
  const slices = parseStoredDeductionSlices(input.deductionSlicesRaw);
  const sliceTotals = sumDeductionSliceTotals(slices);

  const storedSettledDeductedPoints =
    dispatch?.settledDeductedPoints != null &&
    Number.isFinite(dispatch.settledDeductedPoints)
      ? dispatch.settledDeductedPoints
      : null;

  const storedFinalUserChargePoints =
    dispatch == null
      ? null
      : dispatch.billingContract === "published_phase1" ||
          dispatch.billingContract === "published_phase2"
        ? dispatch.publishedFinalPoints != null &&
          Number.isFinite(dispatch.publishedFinalPoints)
          ? dispatch.publishedFinalPoints
          : null
        : dispatch.legacyFinalPoints != null &&
            Number.isFinite(dispatch.legacyFinalPoints)
          ? dispatch.legacyFinalPoints
          : null;

  const billingEvidenceStatus: AdminBillingForensicMetadata["billingEvidenceStatus"] =
    dispatch?.billingContract != null
      ? "complete"
      : usage?.cost != null
        ? "missing_stored_dispatch"
        : input.chargeEvidence?.status === "charged" ||
            input.chargeEvidence?.status === "not_charged"
          ? "partial"
          : "partial";

  let finalChargeConsistency: FinalChargeConsistencySnapshot | null = null;
  if (
    usage &&
    storedFinalUserChargePoints != null &&
    storedSettledDeductedPoints != null &&
    Number.isFinite(usage.cost)
  ) {
    finalChargeConsistency = evaluateFinalChargeConsistency({
      finalUserChargePoints: storedFinalUserChargePoints,
      settledDeductionPoints: storedSettledDeductedPoints,
      usageCostPoints: usage.cost,
      deductionSlices: slices,
    });
  }

  return {
    assistantMessageId: input.assistantMessageId,
    chatId: input.chatId,
    requestId: input.requestId,
    selectedModelId: usage?.selectedAI?.trim() || null,
    deliveredModelId:
      dispatch?.deliveredModelId?.trim() || usage?.model?.trim() || null,
    billingContract: dispatch?.billingContract ?? null,
    billingContractReason: dispatch?.billingContractReason ?? null,
    publishedCandidateStatus: dispatch?.publishedCandidateStatus ?? null,
    publishedBlockReason: dispatch?.publishedBlockReason ?? null,
    pricingVersion: dispatch?.pricingVersion ?? null,
    publishedFinalPoints: dispatch?.publishedFinalPoints ?? null,
    legacyFinalPoints: dispatch?.legacyFinalPoints ?? null,
    settledDeductedPoints: dispatch?.settledDeductedPoints ?? null,
    chargeEvidenceSettledPoints: input.chargeEvidence?.settledPoints ?? null,
    usageCost:
      usage && Number.isFinite(usage.cost) ? usage.cost : null,
    deductionSliceTotal: slices.length > 0 ? sliceTotals.total : null,
    billingEvidenceStatus,
    billingInputTokens:
      usage && Number.isFinite(usage.input) ? usage.input : null,
    billingOutputTokens:
      usage && Number.isFinite(usage.output) ? usage.output : null,
    apiInputTokens:
      usage?.apiInputTokens != null && Number.isFinite(usage.apiInputTokens)
        ? usage.apiInputTokens
        : null,
    apiOutputTokens:
      usage?.apiOutputTokens != null && Number.isFinite(usage.apiOutputTokens)
        ? usage.apiOutputTokens
        : null,
    reasoningTokens:
      usage?.apiReasoningOutputTokens != null &&
      Number.isFinite(usage.apiReasoningOutputTokens)
        ? usage.apiReasoningOutputTokens
        : null,
    cacheReadTokens:
      usage?.cacheReadTokens != null && Number.isFinite(usage.cacheReadTokens)
        ? usage.cacheReadTokens
        : null,
    cacheWriteTokens:
      usage?.cacheWriteTokens != null && Number.isFinite(usage.cacheWriteTokens)
        ? usage.cacheWriteTokens
        : null,
    fx: usage ? resolveStoredFxEvidence(usage) : { available: false, status: "UNAVAILABLE" },
    finalChargeConsistency,
    generationStatus: input.generationStatus ?? null,
    chargeStatus: input.chargeEvidence?.status,
    usageSnapshotAvailable: usage != null,
    chargeEvidenceStatus: input.chargeEvidence?.evidenceStatus,
    chargeEvidenceViolations: input.chargeEvidence?.violations,
  };
}
