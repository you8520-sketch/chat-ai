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
  usage: Usage;
  deductionSlicesRaw: string | null;
}): AdminBillingForensicMetadata {
  const dispatch = input.usage.billingContractDispatch;
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
      : input.usage.cost != null
        ? "missing_stored_dispatch"
        : "partial";

  let finalChargeConsistency: FinalChargeConsistencySnapshot | null = null;
  if (
    storedFinalUserChargePoints != null &&
    storedSettledDeductedPoints != null &&
    Number.isFinite(input.usage.cost)
  ) {
    finalChargeConsistency = evaluateFinalChargeConsistency({
      finalUserChargePoints: storedFinalUserChargePoints,
      settledDeductionPoints: storedSettledDeductedPoints,
      usageCostPoints: input.usage.cost,
      deductionSlices: slices,
    });
  }

  return {
    assistantMessageId: input.assistantMessageId,
    chatId: input.chatId,
    requestId: input.requestId,
    selectedModelId: input.usage.selectedAI?.trim() || null,
    deliveredModelId:
      dispatch?.deliveredModelId?.trim() || input.usage.model?.trim() || null,
    billingContract: dispatch?.billingContract ?? null,
    billingContractReason: dispatch?.billingContractReason ?? null,
    publishedCandidateStatus: dispatch?.publishedCandidateStatus ?? null,
    publishedBlockReason: dispatch?.publishedBlockReason ?? null,
    pricingVersion: dispatch?.pricingVersion ?? null,
    publishedFinalPoints: dispatch?.publishedFinalPoints ?? null,
    legacyFinalPoints: dispatch?.legacyFinalPoints ?? null,
    settledDeductedPoints: dispatch?.settledDeductedPoints ?? null,
    usageCost: Number.isFinite(input.usage.cost) ? input.usage.cost : null,
    deductionSliceTotal: slices.length > 0 ? sliceTotals.total : null,
    billingEvidenceStatus,
    billingInputTokens: Number.isFinite(input.usage.input) ? input.usage.input : null,
    billingOutputTokens: Number.isFinite(input.usage.output) ? input.usage.output : null,
    apiInputTokens:
      input.usage.apiInputTokens != null && Number.isFinite(input.usage.apiInputTokens)
        ? input.usage.apiInputTokens
        : null,
    apiOutputTokens:
      input.usage.apiOutputTokens != null && Number.isFinite(input.usage.apiOutputTokens)
        ? input.usage.apiOutputTokens
        : null,
    reasoningTokens:
      input.usage.apiReasoningOutputTokens != null &&
      Number.isFinite(input.usage.apiReasoningOutputTokens)
        ? input.usage.apiReasoningOutputTokens
        : null,
    cacheReadTokens:
      input.usage.cacheReadTokens != null && Number.isFinite(input.usage.cacheReadTokens)
        ? input.usage.cacheReadTokens
        : null,
    cacheWriteTokens:
      input.usage.cacheWriteTokens != null && Number.isFinite(input.usage.cacheWriteTokens)
        ? input.usage.cacheWriteTokens
        : null,
    fx: resolveStoredFxEvidence(input.usage),
    finalChargeConsistency,
  };
}
