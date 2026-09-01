/**
 * G37 P0 Pass 2 — exact fixture reproduction from production forensic logs.
 * Diagnostic only — no mock published producer.
 */
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import { resolveChatBillingContract } from "@/lib/chatBillingContractDispatch";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";
import { computeShadowPricing } from "@/lib/shadowPricing";
import { resolveShadowBillingExchangeRateSnapshot } from "@/lib/shadowBillingExchangeRate";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import type { NormalizedBillableUsage } from "@/lib/billingUsage";

function toFxSnapshot(): BillingFxSnapshot {
  const fx = resolveShadowBillingExchangeRateSnapshot();
  return {
    mode: fx.mode,
    dateKey: fx.dateKey,
    usdToKrw: fx.usdToKrw,
    effectiveKrwPerUsd: fx.effectiveKrwPerUsd,
    source: fx.source,
    overseasFeeRate: fx.overseasFeeRate,
    locked: fx.locked,
  };
}

/** Normal turn cr_mtiedirf_thf6vkus — provider-reported usage from logs. */
const NORMAL_USAGE: NormalizedBillableUsage = {
  promptTokens: 26038,
  cacheReadTokens: 20426,
  cacheWriteTokens: 0,
  standardInputTokens: 5612,
  visibleOutputTokens: 2662,
  reasoningTokens: 0,
  billableOutputTokens: 2662,
  reasoningAccounting: "none",
};

/** Regen turn cr_mtiei4j7_c39yk536 — provider-reported usage from logs. */
const REGEN_USAGE: NormalizedBillableUsage = {
  promptTokens: 26681,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  standardInputTokens: 26681,
  visibleOutputTokens: 3184,
  reasoningTokens: 0,
  billableOutputTokens: 3184,
  reasoningAccounting: "none",
};

function summarizeResult(label: string, result: unknown): void {
  const r = result as { status?: string; reason?: string; snapshot?: { finalPoints?: number } } | null | undefined;
  console.log(
    JSON.stringify({
      label,
      isNullish: r == null,
      typeofResult: typeof r,
      status: r?.status ?? null,
      reason: r?.status === "blocked" ? r.reason : null,
      finalPoints: r?.status === "complete" ? r.snapshot?.finalPoints : null,
    })
  );
}

function regenStage(): StageUsage {
  return {
    stage: "Gemini 3.7 Flash",
    model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    input: 26681,
    output: 3184,
    apiOutputTokens: 3184,
    apiReportedInputTokens: 26681,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimated: false,
    usageReportingEvidence: {
      cacheRead: "reported_valid",
      cacheWrite: "reported_valid",
      reasoning: "reported_valid",
    },
  };
}

function main(): void {
  const fxSnapshot = toFxSnapshot();
  console.log("FX_SNAPSHOT", JSON.stringify(fxSnapshot));

  summarizeResult(
    "direct_normal_shadow",
    computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      usage: NORMAL_USAGE,
      usageCoverage: "complete",
      fxSnapshot,
      adjustment: { kind: "none" },
    })
  );

  summarizeResult(
    "direct_regen",
    computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      usage: REGEN_USAGE,
      usageCoverage: "complete",
      fxSnapshot,
      adjustment: { kind: "none" },
    })
  );

  try {
    const shadow = computeShadowPricing({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: NORMAL_USAGE.promptTokens,
      cacheReadTokens: NORMAL_USAGE.cacheReadTokens,
      cacheWriteTokens: NORMAL_USAGE.cacheWriteTokens,
      outputTokens: NORMAL_USAGE.visibleOutputTokens,
    });
    console.log(
      JSON.stringify({
        label: "normal_shadow_path",
        finalShadowPoints: shadow.finalShadowPoints,
        billingReferenceCostStatus: shadow.billingReferenceCostStatus,
        publishedChargeStatus: shadow.publishedChargeStatus,
      })
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        label: "normal_shadow_path",
        threw: (e as Error).message,
      })
    );
  }

  const usageResolution = resolveTurnBillableUsage({
    stages: [regenStage()],
    modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  });
  console.log(
    JSON.stringify({
      label: "regen_usage_resolution",
      status: usageResolution.status,
      usageCoverage: usageResolution.status === "resolved" ? usageResolution.usageCoverage : null,
    })
  );

  const dispatch = resolveChatBillingContract({
    deliveredModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    stages: [regenStage()],
    legacyFinalPoints: 61,
    billingWaiverReason: null,
    legacyWaiverMinimum: 0,
    fxSnapshot,
    phase1PublishedBillingEnabled: true,
  });
  console.log(
    JSON.stringify({
      label: "regen_dispatch",
      contract: dispatch.contract,
      points: dispatch.points,
      reason: dispatch.contract === "legacy" ? dispatch.reason : dispatch.reason,
      publishedCandidateStatus: dispatch.telemetry.publishedCandidateStatus,
    })
  );
}

main();
