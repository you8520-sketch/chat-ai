import type { FinalChargeConsistencySnapshot } from "@/lib/chatBillingFinalCharge";
import type {
  StoredTurnChargeEvidenceStatus,
  StoredTurnChargeStatus,
} from "@/lib/storedTurnChargeEvidenceShared";

export type AdminBillingForensicFxEvidence =
  | {
      available: true;
      dateKey: string;
      source: string;
      baseUsdKrw: number | null;
      overseasFeeRate: number | null;
      effectiveKrwPerUsd: number | null;
      locked: boolean | null;
    }
  | { available: false; status: "UNAVAILABLE" };

export type AdminBillingForensicMetadata = {
  assistantMessageId: number;
  chatId: number;
  requestId: string | null;
  selectedModelId: string | null;
  deliveredModelId: string | null;
  billingContract: "published_phase1" | "published_phase2" | "legacy" | null;
  billingContractReason: string | null;
  publishedCandidateStatus: string | null;
  publishedBlockReason: string | null;
  pricingVersion: number | null;
  publishedFinalPoints: number | null;
  legacyFinalPoints: number | null;
  settledDeductedPoints: number | null;
  usageCost: number | null;
  deductionSliceTotal: number | null;
  billingEvidenceStatus: "complete" | "missing_stored_dispatch" | "partial";
  billingInputTokens: number | null;
  billingOutputTokens: number | null;
  apiInputTokens: number | null;
  apiOutputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  fx: AdminBillingForensicFxEvidence;
  finalChargeConsistency: FinalChargeConsistencySnapshot | null;
  generationStatus?: string | null;
  chargeStatus?: StoredTurnChargeStatus;
  usageSnapshotAvailable?: boolean;
  chargeEvidenceStatus?: StoredTurnChargeEvidenceStatus;
  chargeEvidenceViolations?: string[];
};
