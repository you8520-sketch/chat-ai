/**
 * Canonical billing-contract dispatcher — decides published Phase 1 vs legacy fallback.
 * Does NOT duplicate legacy pricing or published formula logic.
 */

import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { validateBillingFxSnapshotForLiveGrade } from "@/lib/billingFxSnapshot";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
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

const PHASE1_PUBLISHED_MODEL_SET = new Set<string>(PHASE1_PUBLISHED_MODELS);

export function isPhase1PublishedBillingModel(modelId: string): boolean {
  return PHASE1_PUBLISHED_MODEL_SET.has(modelId);
}

export type LegacyFallbackReason =
  | "phase1_billing_disabled"
  | "non_phase1_model"
  | "legacy_waiver_minimum_nonzero"
  | "usage_unresolved"
  | "usage_coverage_incomplete"
  | "usage_coverage_unknown"
  | "invalid_fx_snapshot"
  | "published_blocked"
  | PublishedChargeBlockedReason;

export type ChatBillingContractTelemetry = {
  billingContract: "published_phase1" | "legacy";
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
      contract: "legacy";
      points: number;
      reason: LegacyFallbackReason;
      telemetry: ChatBillingContractTelemetry;
    };

export type ChatBillingContractDispatchDiagnosticContext = {
  requestId?: string | null;
  chatId?: number | null;
  messageId?: number | null;
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
  /** Required when Published path may run; omitted when feature gate is off. */
  fxSnapshot?: BillingFxSnapshot;
  /** Test-only override — production uses isPhase1PublishedBillingEnabled(). */
  phase1PublishedBillingEnabled?: boolean;
  /** Optional structural metadata for fail-loud producer invariant logs — no RP prose. */
  diagnosticContext?: ChatBillingContractDispatchDiagnosticContext;
};

export const G37_P0_USAGE_RESOLUTION_UNDEFINED = "G37_P0_USAGE_RESOLUTION_UNDEFINED";
export const G37_P0_PUBLISHED_RESULT_UNDEFINED = "G37_P0_PUBLISHED_RESULT_UNDEFINED";

function safeStageDiagnostics(stages: StageUsage[]): Array<{
  stage: string | null;
  estimated: boolean;
  input: number | null;
  output: number | null;
  hasUsageReportingEvidence: boolean;
}> {
  return stages.map((stage) => ({
    stage: stage.stage ?? null,
    estimated: stage.estimated === true,
    input: typeof stage.input === "number" && Number.isFinite(stage.input) ? stage.input : null,
    output: typeof stage.output === "number" && Number.isFinite(stage.output) ? stage.output : null,
    hasUsageReportingEvidence: stage.usageReportingEvidence != null,
  }));
}

function failBillingDispatchProducerInvariant(
  code: typeof G37_P0_USAGE_RESOLUTION_UNDEFINED | typeof G37_P0_PUBLISHED_RESULT_UNDEFINED,
  input: ResolveChatBillingContractInput,
  extra: Record<string, unknown> = {}
): never {
  console.error("[G37-P0-BILLING-DISPATCH]", {
    code,
    requestId: input.diagnosticContext?.requestId ?? null,
    chatId: input.diagnosticContext?.chatId ?? null,
    messageId: input.diagnosticContext?.messageId ?? null,
    deliveredModelId: input.deliveredModelId,
    stageCount: input.stages.length,
    stageShapes: safeStageDiagnostics(input.stages),
    ...extra,
  });
  throw new Error(code);
}

export function isPhase1PublishedBillingEnabled(): boolean {
  const raw = process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
  return raw === "1" || raw === "true";
}

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

/** Single owner: published Phase 1 vs legacy fallback for main RP turn billing. */
export type ResolveChatBillingContractDeps = {
  resolveTurnBillableUsage?: typeof resolveTurnBillableUsage;
  computePublishedUserChargeWithSnapshot?: typeof computePublishedUserChargeWithSnapshot;
};

export function resolveChatBillingContract(
  input: ResolveChatBillingContractInput,
  deps?: ResolveChatBillingContractDeps
): ChatBillingContractDecision {
  const resolveUsage = deps?.resolveTurnBillableUsage ?? resolveTurnBillableUsage;
  const computePublished =
    deps?.computePublishedUserChargeWithSnapshot ?? computePublishedUserChargeWithSnapshot;

  const phase1Enabled = input.phase1PublishedBillingEnabled ?? isPhase1PublishedBillingEnabled();

  if (!phase1Enabled) {
    return legacyDecision(input, "phase1_billing_disabled");
  }

  if (!isPhase1PublishedBillingModel(input.deliveredModelId)) {
    return legacyDecision(input, "non_phase1_model");
  }

  if (input.legacyWaiverMinimum > 0) {
    return legacyDecision(input, "legacy_waiver_minimum_nonzero");
  }

  const usageResolution = resolveUsage({
    stages: input.stages,
    modelId: input.deliveredModelId,
    refusalFallbackDelivered: input.refusalFallbackDelivered,
    promptAuditTotal: input.promptAuditTotal,
  });

  if (usageResolution == null) {
    failBillingDispatchProducerInvariant(G37_P0_USAGE_RESOLUTION_UNDEFINED, input, {
      producer: "resolveTurnBillableUsage()",
    });
  }

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

  const published = computePublished({
    modelId: input.deliveredModelId,
    usage: usageResolution.usage,
    usageCoverage: usageResolution.usageCoverage,
    fxSnapshot: input.fxSnapshot,
    adjustment: waiverAdjustment(input.billingWaiverReason),
  });

  if (published == null) {
    failBillingDispatchProducerInvariant(G37_P0_PUBLISHED_RESULT_UNDEFINED, input, {
      producer: "computePublishedUserChargeWithSnapshot()",
      usageResolutionStatus: usageResolution.status,
      usageCoverage: usageResolution.usageCoverage,
    });
  }

  if (published.status === "blocked") {
    return legacyDecision(input, published.reason, {
      publishedCandidateStatus: "blocked",
      publishedBlockReason: published.reason,
    });
  }

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
