/**
 * Canonical billing-contract dispatcher — published Phase 1 / Phase 2 vs legacy fallback.
 * Does NOT duplicate legacy pricing or published formula logic.
 */

import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { validateBillingFxSnapshotForLiveGrade } from "@/lib/billingFxSnapshot";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import {
  computePublishedUserChargeWithSnapshot,
  type PublishedChargeAdjustment,
  type PublishedChargeBlockedReason,
  type PublishedUserChargeSnapshot,
} from "@/lib/publishedUserCharge";
import type { BillingWaiverReason } from "@/lib/points";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
import type { UserBillableUsageCoverage } from "@/lib/billingUsage";

export const CHAT_BILLING_CONTRACT_DISPATCH_OWNER =
  "resolveChatBillingContract() in chatBillingContractDispatch.ts";

export const PHASE1_PUBLISHED_MODELS = [
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
] as const;

/** Direct user-selected DeepSeek V4 Pro 0813 — Phase 2 Published cutover (not Phase 1). */
export const PHASE2_DEEPSEEK_PUBLISHED_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

const PHASE1_PUBLISHED_MODEL_SET = new Set<string>(PHASE1_PUBLISHED_MODELS);

export type PublishedBillingPhase = "phase1" | "phase2";

export type PublishedBillingContract = "published_phase1" | "published_phase2";

export function isPhase1PublishedBillingModel(modelId: string): boolean {
  return PHASE1_PUBLISHED_MODEL_SET.has(modelId);
}

export function isPhase2DeepSeekPublishedBillingModel(modelId: string): boolean {
  return canonicalizePublishedModelId(modelId) === PHASE2_DEEPSEEK_PUBLISHED_MODEL;
}

export function isPhase1PublishedBillingEnabled(): boolean {
  const raw = process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
  return raw === "1" || raw === "true";
}

export function isPhase2DeepSeekPublishedBillingEnabled(): boolean {
  const raw = process.env.PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED;
  return raw === "1" || raw === "true";
}

/** Route prepares daily-KST FX when any Published path may run this turn. */
export function shouldPreparePublishedBillingFxSnapshot(): boolean {
  return isPhase1PublishedBillingEnabled() || isPhase2DeepSeekPublishedBillingEnabled();
}

export function resolvePublishedBillingPhase(
  modelId: string,
  opts?: { phase1Enabled?: boolean; phase2Enabled?: boolean }
): PublishedBillingPhase | null {
  const phase1Enabled = opts?.phase1Enabled ?? isPhase1PublishedBillingEnabled();
  const phase2Enabled = opts?.phase2Enabled ?? isPhase2DeepSeekPublishedBillingEnabled();
  if (isPhase1PublishedBillingModel(modelId) && phase1Enabled) {
    return "phase1";
  }
  if (isPhase2DeepSeekPublishedBillingModel(modelId) && phase2Enabled) {
    return "phase2";
  }
  return null;
}

export type LegacyFallbackReason =
  | "phase1_billing_disabled"
  | "phase2_deepseek_billing_disabled"
  | "non_published_model"
  | "phase2_refusal_fallback_legacy"
  | "legacy_waiver_minimum_nonzero"
  | "usage_unresolved"
  | "usage_coverage_incomplete"
  | "usage_coverage_unknown"
  | "invalid_fx_snapshot"
  | "published_blocked"
  | PublishedChargeBlockedReason;

export type ChatBillingContractTelemetry = {
  billingContract: PublishedBillingContract | "legacy";
  billingContractReason: string;
  deliveredModelId: string;
  publishedCandidateStatus: "not_attempted" | "resolved" | "blocked" | "unavailable";
  publishedBlockReason: string | null;
  pricingVersion: number | null;
};

export type ChatBillingContractDecision =
  | {
      contract: "published_phase1";
      points: number;
      publishedSnapshot: PublishedUserChargeSnapshot;
      reason: "phase1_live_grade";
      telemetry: ChatBillingContractTelemetry;
    }
  | {
      contract: "published_phase2";
      points: number;
      publishedSnapshot: PublishedUserChargeSnapshot;
      reason: "phase2_deepseek_live_grade";
      telemetry: ChatBillingContractTelemetry;
    }
  | {
      contract: "legacy";
      points: number;
      reason: LegacyFallbackReason;
      telemetry: ChatBillingContractTelemetry;
    };

export type ResolveChatBillingContractInput = {
  deliveredModelId: string;
  stages: StageUsage[];
  refusalFallbackDelivered?: boolean;
  promptAuditTotal?: number | null;
  /** Precomputed legacy final charge from computeTurnBilling + waiver chain. */
  legacyFinalPoints: number;
  billingWaiverReason: BillingWaiverReason | null;
  /** Precomputed waiver minimum from resolve*WaiverMinimumCharge(); 0 when not applicable. */
  legacyWaiverMinimum: number;
  /** Required when Published path may run; omitted when all feature gates are off. */
  fxSnapshot?: BillingFxSnapshot;
  /** Test-only overrides — production uses env gates. */
  phase1PublishedBillingEnabled?: boolean;
  phase2DeepSeekPublishedBillingEnabled?: boolean;
};

function buildTelemetry(
  input: ResolveChatBillingContractInput,
  partial: Partial<ChatBillingContractTelemetry> & Pick<ChatBillingContractTelemetry, "billingContract" | "billingContractReason">
): ChatBillingContractTelemetry {
  return {
    deliveredModelId: input.deliveredModelId,
    publishedCandidateStatus: partial.publishedCandidateStatus ?? "not_attempted",
    publishedBlockReason: partial.publishedBlockReason ?? null,
    pricingVersion: partial.pricingVersion ?? null,
    ...partial,
  };
}

function legacyDecision(
  input: ResolveChatBillingContractInput,
  reason: LegacyFallbackReason,
  telemetryPartial: Partial<ChatBillingContractTelemetry> = {}
): ChatBillingContractDecision {
  return {
    contract: "legacy",
    points: input.legacyFinalPoints,
    reason,
    telemetry: buildTelemetry(input, {
      billingContract: "legacy",
      billingContractReason: reason,
      ...telemetryPartial,
    }),
  };
}

function mapUsageCoverageToFallbackReason(
  coverage: UserBillableUsageCoverage
): LegacyFallbackReason {
  switch (coverage) {
    case "partial":
      return "usage_coverage_incomplete";
    case "unknown":
      return "usage_coverage_unknown";
    case "complete":
      return "usage_unresolved";
    default: {
      const _exhaustive: never = coverage;
      return _exhaustive;
    }
  }
}

function waiverAdjustment(
  billingWaiverReason: BillingWaiverReason | null
): PublishedChargeAdjustment {
  return billingWaiverReason ? { kind: "waiver", reason: billingWaiverReason } : { kind: "none" };
}

function resolveLegacyEligibilityReason(
  input: ResolveChatBillingContractInput,
  phase1Enabled: boolean,
  phase2Enabled: boolean
): LegacyFallbackReason {
  if (isPhase1PublishedBillingModel(input.deliveredModelId) && !phase1Enabled) {
    return "phase1_billing_disabled";
  }
  if (isPhase2DeepSeekPublishedBillingModel(input.deliveredModelId) && !phase2Enabled) {
    return "phase2_deepseek_billing_disabled";
  }
  return "non_published_model";
}

function resolvePublishedContract(
  phase: PublishedBillingPhase,
  input: ResolveChatBillingContractInput,
  published: {
    snapshot: PublishedUserChargeSnapshot;
  }
): ChatBillingContractDecision {
  if (phase === "phase1") {
    return {
      contract: "published_phase1",
      points: published.snapshot.finalPoints,
      publishedSnapshot: published.snapshot,
      reason: "phase1_live_grade",
      telemetry: buildTelemetry(input, {
        billingContract: "published_phase1",
        billingContractReason: "phase1_live_grade",
        publishedCandidateStatus: "resolved",
        publishedBlockReason: null,
        pricingVersion: published.snapshot.pricingVersion,
      }),
    };
  }
  return {
    contract: "published_phase2",
    points: published.snapshot.finalPoints,
    publishedSnapshot: published.snapshot,
    reason: "phase2_deepseek_live_grade",
    telemetry: buildTelemetry(input, {
      billingContract: "published_phase2",
      billingContractReason: "phase2_deepseek_live_grade",
      publishedCandidateStatus: "resolved",
      publishedBlockReason: null,
      pricingVersion: published.snapshot.pricingVersion,
    }),
  };
}

/** Single owner: published Phase 1 / Phase 2 vs legacy fallback for main RP turn billing. */
export function resolveChatBillingContract(
  input: ResolveChatBillingContractInput
): ChatBillingContractDecision {
  const phase1Enabled = input.phase1PublishedBillingEnabled ?? isPhase1PublishedBillingEnabled();
  const phase2Enabled =
    input.phase2DeepSeekPublishedBillingEnabled ?? isPhase2DeepSeekPublishedBillingEnabled();

  if (input.refusalFallbackDelivered === true) {
    return legacyDecision(input, "phase2_refusal_fallback_legacy");
  }

  const publishedPhase = resolvePublishedBillingPhase(input.deliveredModelId, {
    phase1Enabled,
    phase2Enabled,
  });
  if (publishedPhase == null) {
    return legacyDecision(
      input,
      resolveLegacyEligibilityReason(input, phase1Enabled, phase2Enabled)
    );
  }

  if (input.legacyWaiverMinimum > 0) {
    return legacyDecision(input, "legacy_waiver_minimum_nonzero");
  }

  const usageResolution = resolveTurnBillableUsage({
    stages: input.stages,
    modelId: input.deliveredModelId,
    refusalFallbackDelivered: input.refusalFallbackDelivered,
    promptAuditTotal: input.promptAuditTotal,
  });

  if (usageResolution.status !== "resolved" || !usageResolution.usage) {
    return legacyDecision(input, "usage_unresolved", {
      publishedCandidateStatus: "unavailable",
      publishedBlockReason: usageResolution.reason,
    });
  }

  if (usageResolution.usageCoverage !== "complete") {
    return legacyDecision(input, mapUsageCoverageToFallbackReason(usageResolution.usageCoverage), {
      publishedCandidateStatus: "resolved",
      publishedBlockReason: usageResolution.usageCoverage,
    });
  }

  if (!input.fxSnapshot || !validateBillingFxSnapshotForLiveGrade(input.fxSnapshot)) {
    return legacyDecision(input, "invalid_fx_snapshot", {
      publishedCandidateStatus: "resolved",
    });
  }

  const published = computePublishedUserChargeWithSnapshot({
    modelId: input.deliveredModelId,
    usage: usageResolution.usage,
    usageCoverage: usageResolution.usageCoverage,
    fxSnapshot: input.fxSnapshot,
    adjustment: waiverAdjustment(input.billingWaiverReason),
  });

  if (published.status === "blocked") {
    return legacyDecision(input, published.reason, {
      publishedCandidateStatus: "blocked",
      publishedBlockReason: published.reason,
    });
  }

  return resolvePublishedContract(publishedPhase, input, published);
}
